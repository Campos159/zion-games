# app/api/yampi_webhook.py
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import JSONResponse
import os, hmac, hashlib, base64, httpx, json, logging

router = APIRouter()

# Segredo da Yampi (o mesmo configurado lá na Yampi)
YAMPI_WEBHOOK_SECRET = os.getenv("YAMPI_WEBHOOK_SECRET", "")

# URL do seu Webhook no n8n (produção, sem -test)
# Ex.: https://seu-n8n.onrender.com/webhook/webhook-yampi  (mesmo path do seu nó atual)
N8N_WEBHOOK_URL = os.getenv("N8N_WEBHOOK_URL", "").rstrip("/")

# Chave interna (somente seu backend e seu n8n conhecem)
INTERNAL_API_KEY = os.getenv("INTERNAL_API_KEY", "troque-esta-chave")

HOP_BY_HOP = {
    "connection","keep-alive","proxy-authenticate","proxy-authorization",
    "te","trailers","transfer-encoding","upgrade","host","content-length",
}

def verify_yampi_hmac(raw_body: bytes, signature: str) -> bool:
    if not YAMPI_WEBHOOK_SECRET or not signature:
        return False
    calc = base64.b64encode(
        hmac.new(YAMPI_WEBHOOK_SECRET.encode("utf-8"), raw_body, hashlib.sha256).digest()
    ).decode("utf-8")
    # compare constant-time
    return hmac.compare_digest(calc, signature)

@router.post("/yampi/webhook")
async def yampi_webhook(request: Request):
    if not N8N_WEBHOOK_URL:
        raise HTTPException(status_code=500, detail="N8N_WEBHOOK_URL não configurada")

    try:
        # 1) Corpo bruto + headers originais (para validar HMAC aqui)
        raw = await request.body()
        sig = request.headers.get("X-Yampi-Hmac-SHA256") or request.headers.get("x-yampi-hmac-sha256")

        if not verify_yampi_hmac(raw, sig):
            raise HTTPException(status_code=401, detail="HMAC inválido")

        # 2) Parse do JSON original da Yampi
        try:
            payload = json.loads(raw.decode("utf-8"))
        except Exception:
            raise HTTPException(status_code=400, detail="JSON inválido")

        # 3) Normalização leve (mantém a mesma estrutura que seu n8n já espera)
        # A Yampi costuma enviar: { event, resource: { order: {...} } }
        event = payload.get("event", "")
        resource = payload.get("resource") or {}
        order = resource.get("order") if isinstance(resource.get("order"), dict) else resource

        # Monta um envelope que seu nó atual já entende:
        site_body = {
            "event": event,
            "order": order,             # preserva order/customer/items
        }

        # 4) Repassa ao n8n com uma "API" interna (para bater no seu IF atual)
        #    Se quiser migrar para header, veja seção 3.
        forward_json = {
            "API": INTERNAL_API_KEY,
            "email_data": { "event": event, "customer": order.get("customer", {}), "order": order },
            "body": site_body
        }

        # 5) Chamada ao n8n
        fwd_headers = {
            "Content-Type": "application/json",
            "X-Internal-Api-Key": INTERNAL_API_KEY,   # já mando também por header (opcional)
        }
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(N8N_WEBHOOK_URL, json=forward_json, headers=fwd_headers)

        if resp.status_code >= 400:
            logging.error(f"[n8n] {resp.status_code}: {resp.text}")
            raise HTTPException(status_code=502, detail=f"Falha ao repassar ao n8n: {resp.text}")

        return JSONResponse({"ok": True})
    except HTTPException:
        raise
    except Exception as e:
        logging.exception("Erro no webhook Yampi")
        raise HTTPException(status_code=500, detail=f"Erro interno: {str(e)}")
