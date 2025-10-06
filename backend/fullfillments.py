# fulfillment.py
import os, json, hmac, hashlib, uuid, httpx
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import JSONResponse

router = APIRouter()

N8N_WEBHOOK_URL = os.getenv("N8N_WEBHOOK_URL")           # ex.: https://seu-n8n.com/webhook/dispatch
N8N_HMAC_SECRET = (os.getenv("N8N_HMAC_SECRET") or "").encode("utf-8")

# idempotência simples em memória (trocar por Redis/DB em prod)
IDEM_CACHE = set()

def sign(raw: bytes) -> str:
    return hmac.new(N8N_HMAC_SECRET, raw, hashlib.sha256).hexdigest()

@router.post("/fulfillment/create")
async def fulfillment_create(req: Request):
    if not N8N_WEBHOOK_URL or not N8N_HMAC_SECRET:
        raise HTTPException(status_code=500, detail="Configuração ausente (N8N_WEBHOOK_URL / N8N_HMAC_SECRET)")

    body = await req.json()
    body["idempotency_key"] = body.get("idempotency_key") or str(uuid.uuid4())

    key = body["idempotency_key"]
    if key in IDEM_CACHE:
        return JSONResponse({"ok": True, "status": 200, "data": {"dedup": True}})

    raw = json.dumps(body, separators=(",", ":")).encode("utf-8")
    signature = sign(raw)

    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(
            N8N_WEBHOOK_URL,
            headers={
                "Content-Type": "application/json",
                "X-Signature": signature,
                "Idempotency-Key": key
            },
            content=raw
        )
        try:
            data = r.json()
        except Exception:
            data = {"raw": await r.aread()}
        if r.is_success:
            IDEM_CACHE.add(key)
        return JSONResponse({"ok": r.is_success, "status": r.status_code, "data": data},
                            status_code=(200 if r.is_success else r.status_code))

@router.post("/fulfillment/status")
async def fulfillment_status(req: Request):
    raw = await req.body()  # precisa ser o body bruto
    if not N8N_HMAC_SECRET:
        raise HTTPException(status_code=500, detail="N8N_HMAC_SECRET ausente")

    provided = req.headers.get("x-signature", "")
    expected = sign(raw)
    if provided != expected:
        raise HTTPException(status_code=401, detail="Assinatura inválida")

    payload = json.loads(raw or b"{}")
    # TODO: persistir status/timeline no seu banco
    # ex.: await repos.pedidos.atualiza_status(payload["order_id"], payload["status"], payload.get("timeline", []))
    return {"ok": True}
