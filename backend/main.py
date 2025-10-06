# backend/main.py
from __future__ import annotations

import os
import json
import hmac
import uuid
import hashlib
from datetime import datetime
from decimal import Decimal
from typing import Optional, Any, Dict, Tuple

# Sem dependências externas: usar urllib
import urllib.request
from urllib.error import URLError, HTTPError

from fastapi import FastAPI, Depends, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from .database import Base, engine, get_db
from . import schemas, crud, emailer
import re  # <--- (usado na sanitização do email)

# ---------------------------------------------------------------------
# DB boot
# ---------------------------------------------------------------------
Base.metadata.create_all(bind=engine)

# ---------------------------------------------------------------------
# App + CORS
# ---------------------------------------------------------------------
app = FastAPI(title="Zion Admin API", version="0.5.0")

ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "https://zion-admin-beta.vercel.app",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
def health():
    return {"status": "ok"}

# ---------------------------------------------------------------------
# Helpers (saneamento para evitar 422)
# ---------------------------------------------------------------------
def _safe_platform(value: str | None) -> schemas.Plataforma:
    allowed = {"PS4", "PS4s", "PS5", "PS5s"}
    return value if isinstance(value, str) and value in allowed else "PS4"

def _safe_float(v) -> float:
    try:
        return float(v or 0)
    except Exception:
        return 0.0

def _safe_int(v) -> int:
    try:
        return int(v or 0)
    except Exception:
        return 0

def _safe_date_str(v) -> str:
    if v is None:
        return ""
    if isinstance(v, str):
        return v
    if hasattr(v, "isoformat"):
        s = v.isoformat()
        return s.split("T")[0]
    return str(v)

def _safe_datetime_str(v) -> str | None:
    if not v:
        return None
    if isinstance(v, str):
        return v
    if hasattr(v, "isoformat"):
        return v.isoformat()
    return str(v)

def _normalize_email_for_response(value) -> str:
    """
    Normaliza e-mail para evitar 422 por formatos ruins e garante TLD público válido.

    Mudanças importantes:
    - Fallback agora usa domínio público 'zion.games' (válido para EmailStr).
    - Rejeita domínios 'special-use' (.local, localhost, example, invalid, test).
    - Se não houver TLD, acrescenta '.com'.
    - Limpa local-part para caracteres aceitos.
    """
    FALLBACK = "no-reply@zion.games"

    if value is None:
        return FALLBACK

    s = str(value).strip()
    if s.lower().startswith("mailto:"):
        s = s[7:].strip()

    # Correções básicas frequentes
    s = (
        s.replace("(at)", "@")
         .replace("[at]", "@")
         .replace(" at ", "@")
         .replace(" ", "")
         .replace(",", "")
         .replace(";", "")
         .replace("<", "")
         .replace(">", "")
    )

    if "@" not in s:
        return FALLBACK

    local, _, domain = s.rpartition("@")
    local = local or "no-reply"
    domain = (domain or "").lower()

    # Se veio 'Nome <email@dominio>' e algo escapou, já removemos <> acima.
    # Trata domínios reservados / inválidos
    reserved_roots = {"localhost", "local", "example", "invalid", "test"}
    if domain.endswith(".local") or domain in reserved_roots:
        domain = "zion.games"

    # Se o domínio não possui ponto (sem TLD), acrescente '.com'
    if "." not in domain:
        domain = f"{domain}.com"

    # Sanitiza local-part (mantém alfanum, . _ + -)
    local = re.sub(r"[^A-Za-z0-9._+-]", "", local) or "no-reply"

    return f"{local}@{domain}"

# =====================================================================
# Configs de Integração (n8n + Yampi)
# =====================================================================
# n8n (fulfillment)
N8N_WEBHOOK_URL = os.getenv("N8N_WEBHOOK_URL")  # ex.: https://seu-n8n.com/webhook/dispatch
N8N_HMAC_SECRET = (os.getenv("N8N_HMAC_SECRET") or "").encode("utf-8")
N8N_DRY_RUN = (os.getenv("N8N_DRY_RUN") or "").lower() in ("1", "true", "yes")

# Yampi API
YAMPI_API_BASE = os.getenv("YAMPI_API_BASE", "https://api.yampi.com.br/v1")
YAMPI_API_TOKEN = os.getenv("YAMPI_API_TOKEN", "")  # Bearer token
YAMPI_WEBHOOK_SECRET = (os.getenv("YAMPI_WEBHOOK_SECRET") or "").encode("utf-8")  # HMAC do webhook

# Idempotência simples em memória (trocar por Redis/DB em prod)
_IDEM_CACHE: set[str] = set()

# =====================================================================
# Utilitários HTTP + HMAC
# =====================================================================
def _hmac_sign(raw_bytes: bytes, secret: bytes) -> str:
    return hmac.new(secret, raw_bytes, hashlib.sha256).hexdigest()

def _http_json(method: str, url: str, body: dict | None = None,
               headers: dict | None = None, timeout: int = 30) -> Tuple[int, dict]:
    data = None
    if body is not None:
        data = json.dumps(body, separators=(",", ":")).encode("utf-8")
    req = urllib.request.Request(url, data=data, method=method.upper())
    hdrs = headers or {}
    for k, v in hdrs.items():
        req.add_header(k, v)
    if body is not None and "Content-Type" not in (k.title() for k in hdrs.keys()):
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            code = resp.getcode()
            b = resp.read() or b"{}"
            try:
                j = json.loads(b.decode("utf-8", "ignore"))
            except Exception:
                j = {"raw": b.decode("utf-8", "ignore")}
            return code, j
    except HTTPError as e:
        try:
            b = e.read() or b"{}"
            j = json.loads(b.decode("utf-8", "ignore"))
        except Exception:
            j = {"raw": ""}
        return e.code, j
    except URLError as e:
        raise HTTPException(status_code=502, detail=f"Falha HTTP para {url}: {e.reason}")

# =====================================================================
# Fulfillment: Site ⇄ n8n (HMAC + Idempotency)
# =====================================================================

@app.post("/fulfillment/create")
async def fulfillment_create(req: Request):
    """
    Recebe payload do site, garante idempotência, assina com HMAC e repassa ao Webhook do n8n.
    Em N8N_DRY_RUN ou sem config do n8n, responde 200 com dry_run.
    """
    try:
        body = await req.json()
        if not isinstance(body, dict):
            raise ValueError("JSON inválido")
    except Exception:
        raise HTTPException(status_code=400, detail="JSON inválido")

    body["idempotency_key"] = body.get("idempotency_key") or str(uuid.uuid4())
    idem_key = str(body["idempotency_key"]).strip()
    if idem_key in _IDEM_CACHE:
        return {"ok": True, "status": 200, "data": {"dedup": True}}

    if N8N_DRY_RUN or not N8N_WEBHOOK_URL or not N8N_HMAC_SECRET:
        _IDEM_CACHE.add(idem_key)
        return {"ok": True, "status": 200, "data": {"dry_run": True, "idempotency_key": idem_key}}

    # Assina e chama o n8n
    raw = json.dumps(body, separators=(",", ":")).encode("utf-8")
    signature = _hmac_sign(raw, N8N_HMAC_SECRET)
    code, j = _http_json(
        "POST",
        N8N_WEBHOOK_URL,
        body=body,
        headers={"X-Signature": signature, "Idempotency-Key": idem_key, "Content-Type": "application/json"},
    )
    if 200 <= code < 300:
        _IDEM_CACHE.add(idem_key)
    return {"ok": 200 <= code < 300, "status": code, "data": j}

@app.post("/fulfillment/status")
async def fulfillment_status(req: Request, db: Session = Depends(get_db)):
    """
    Callback do n8n (HMAC). Se status == "delivered", marca entregue na Yampi.
    """
    raw = await req.body()
    if not N8N_HMAC_SECRET:
        raise HTTPException(status_code=500, detail="N8N_HMAC_SECRET ausente")

    provided = req.headers.get("x-signature", "")
    expected = _hmac_sign(raw, N8N_HMAC_SECRET)
    if provided != expected:
        raise HTTPException(status_code=401, detail="Assinatura inválida")

    payload = json.loads(raw or b"{}")
    order_id = str(payload.get("order_id", "")).strip()
    status = str(payload.get("status", "")).strip().lower()

    # TODO: persistir timeline de fulfillment se desejar

    if order_id and status == "delivered":
        _yampi_mark_delivered(order_id)

    return {"ok": True}

# =====================================================================
# Yampi: Webhook + Cliente de API + Estoque bidirecional
# =====================================================================

def _yampi_auth_headers() -> dict:
    if not YAMPI_API_TOKEN:
        raise HTTPException(status_code=500, detail="YAMPI_API_TOKEN ausente")
    return {"Authorization": f"Bearer {YAMPI_API_TOKEN}"}

def _yampi_mark_delivered(order_id: str):
    """
    Marca pedido como 'delivered' na Yampi.
    """
    url = f"{YAMPI_API_BASE}/orders/{order_id}"
    body = {"status": "delivered"}
    code, j = _http_json("PUT", url, body=body, headers=_yampi_auth_headers())
    if not (200 <= code < 300):
        print(f"[YAMPI] Falha ao marcar entregue {order_id}: {code} {j}")

def _yampi_update_stock_by_sku(sku: str, quantity: int):
    """
    Atualiza estoque na Yampi por SKU.
    OBS: confirme o endpoint exato da sua conta Yampi (products/variants/inventory).
    """
    url = f"{YAMPI_API_BASE}/products/{sku}/stock"  # ajuste se necessário
    body = {"quantity": int(quantity)}
    code, j = _http_json("PUT", url, body=body, headers=_yampi_auth_headers())
    if not (200 <= code < 300):
        print(f"[YAMPI] Falha ao atualizar estoque SKU={sku}: {code} {j}")

def _yampi_verify_webhook(req: Request, raw: bytes) -> None:
    """
    Verifica HMAC do webhook da Yampi (ajuste o header se o seu for diferente).
    """
    if not YAMPI_WEBHOOK_SECRET:
        return  # sem HMAC configurado → não valida (recomendado: usar HMAC)
    provided = req.headers.get("x-yampi-signature", "") or req.headers.get("X-Yampi-Signature", "")
    expected = _hmac_sign(raw, YAMPI_WEBHOOK_SECRET)
    if not provided or provided != expected:
        raise HTTPException(status_code=401, detail="Assinatura Yampi inválida")

def _criar_pedido_local_de_yampi(db: Session, yampi_order: dict) -> tuple[schemas.PedidoRead, list[schemas.ItemRead]]:
    """
    Converte um pedido vindo da Yampi para seu modelo e grava no DB.
    Ajuste os campos conforme o payload real da Yampi.
    """
    # --- cliente: normaliza e-mail para evitar ValidationError
    customer = (yampi_order.get("customer") or {})
    safe_email = _normalize_email_for_response(customer.get("email") or "")

    # 1) Pedido
    pedido_in = schemas.PedidoCreate(
        codigo=str(yampi_order.get("code") or yampi_order.get("id") or ""),
        status="PAID" if str(yampi_order.get("status", "")).lower() in ("paid", "approved") else "PENDING",
        cliente_nome=(customer.get("name") or "") or "",
        cliente_email=safe_email,  # <<< garantia de e-mail válido
        telefone=customer.get("phone", "") or "",
        data_criacao=_safe_date_str(datetime.utcnow()),
    )
    pedido = crud.criar_pedido(db, pedido_in)
    ped_out = schemas.PedidoRead.model_validate(pedido)

    # 2) Itens
    itens_out: list[schemas.ItemRead] = []
    for it in (yampi_order.get("items") or []):
        plataformas = {
            "PS4": "PS4", "PS5": "PS5",
            "PS4 Primária": "PS4", "PS4 Secundária": "PS4s",
            "PS5 Primária": "PS5", "PS5 Secundária": "PS5s",
        }
        plataforma = plataformas.get(str(it.get("platform") or it.get("variant_name") or "").strip(), "PS5")
        item_in = schemas.ItemCreate(
            sku=str(it.get("sku") or ""),
            nome_produto=str(it.get("name") or ""),
            plataforma=_safe_platform(plataforma),
            quantidade=_safe_int(it.get("quantity") or 1),
            preco_unitario=_safe_float(it.get("price") or 0),
            email_conta=None, senha_conta=None, nick_conta=None, codigo_ativacao=None,
        )
        row = crud.criar_item(db, pedido.id, item_in)
        it_out = schemas.ItemRead.model_validate(row)
        it_out.total_item = float((row.quantidade or 0) * float(row.preco_unitario or 0))
        itens_out.append(it_out)

    return ped_out, itens_out

def _disparar_fulfillment_n8n(pedido: schemas.PedidoRead, itens: list[schemas.ItemRead]):
    """
    Monta payload para seu fluxo do n8n e dispara via /fulfillment/create local.
    """
    first = itens[0] if itens else None
    variant_map = {"PS4": "PS4 Secundária", "PS4s": "PS4 Secundária", "PS5": "PS5 Primária", "PS5s": "PS5 Secundária"}
    variant = variant_map.get(first.plataforma if first else "PS5", "PS5 Primária")
    items_payload = [
        {
            "sku": it.sku,
            "qty": it.quantidade,
            "name": it.nome_produto or "",
            "variant_name": "PlayStation 5" if it.plataforma in ("PS5", "PS5s") else "PlayStation 4",
        } for it in itens
    ]
    body = {
        "triggered_by": "yampi_webhook",
        "order": {
            "order_id": str(pedido.codigo or pedido.id),
            "sale_channel": "yampi",
            "variant": variant,
            "items": items_payload,
            "customer": {
                "name": pedido.cliente_nome or "",
                "email": pedido.cliente_email or "",
                "phone_e164": pedido.telefone or "",
                "login": "", "senha": "", "codigo": "",
                "nome_jogo": first.nome_produto if first else "",
            },
        },
        "options": {"send_via": ["email"]},
        "metadata": {"source": "yampi"},
    }
    code, j = _http_json("POST", "http://127.0.0.1:8000/fulfillment/create", body)
    if not (200 <= code < 300):
        print("[FULFILLMENT] Falha ao disparar:", code, j)

@app.post("/yampi/webhook")
async def yampi_webhook(req: Request, db: Session = Depends(get_db)):
    """
    Webhook da Yampi:
      - order.created / order.paid → cria pedido local + dispara fulfillment (se pago)
      - order.delivered → (opcional) marcar local
      - product.updated / inventory.updated → sincroniza estoque local
    Validação HMAC via YAMPI_WEBHOOK_SECRET (recomendada).
    """
    raw = await req.body()
    _yampi_verify_webhook(req, raw)

    try:
        payload = json.loads(raw.decode("utf-8"))
    except Exception:
        raise HTTPException(status_code=400, detail="JSON inválido")

    event = str(payload.get("event", "")).strip()
    order = payload.get("order") or {}
    product = payload.get("product") or {}
    inventory = payload.get("inventory") or {}

    # ---- Pedidos
    if event in ("order.created", "order.paid"):
        codigo = str((order.get("code") or order.get("id") or "")).strip()

        # existing = crud.obter_pedido_por_codigo(db, codigo)  # se você tiver essa função
        existing = None

        if existing:
            ped_out = schemas.PedidoRead.model_validate(existing)
            itens_out: list[schemas.ItemRead] = []
        else:
            ped_out, itens_out = _criar_pedido_local_de_yampi(db, order)

        status = str(order.get("status", "")).lower()
        if event == "order.paid" or status in ("paid", "approved"):
            _disparar_fulfillment_n8n(ped_out, itens_out)

        return {"ok": True}

    if event == "order.delivered":
        # crud.marcar_entregue_por_codigo(db, order.get("code"))
        return {"ok": True}

    # ---- Estoque vindo da Yampi → Site
    if event in ("product.updated", "inventory.updated"):
        sku = str(product.get("sku") or inventory.get("sku") or "").strip()
        qty = int(inventory.get("quantity") or product.get("quantity") or 0)
        if sku:
            try:
                # crud.atualizar_estoque_por_sku(db, sku, qty)
                pass
            except Exception as e:
                print(f"[YAMPI→SITE] Falha ao atualizar estoque {sku}: {e}")
        return {"ok": True}

    return {"ok": True}

# ---- Rota utilitária: Site → Yampi (atualiza estoque de 1 SKU)
class StockPushPayload(BaseModel):
    sku: str
    quantity: int

@app.post("/estoque/site-to-yampi")
def estoque_site_para_yampi(data: StockPushPayload):
    _yampi_update_stock_by_sku(data.sku, data.quantity)
    return {"ok": True}

# =====================================================================
# Rotas estáticas antes de dinâmicas (seu código original)
# =====================================================================

# ---------------------------------------------------------------------
# Pedidos agrupados (tela "Pedidos Entregues")
# ---------------------------------------------------------------------
@app.get("/pedidos/agrupados", response_model=list[schemas.GrupoPedidosRead])
def pedidos_agrupados_por_codigo(
    codigo: Optional[str] = None, db: Session = Depends(get_db)
):
    grupos = crud.agrupar_pedidos_por_codigo(db, codigo)

    result: list[schemas.GrupoPedidosRead] = []
    for g in grupos:
        pedidos_out: list[schemas.PedidoReadWithItens] = []

        for p in g["pedidos"]:
            itens_out: list[schemas.ItemRead] = []
            for it in (p.itens or []):
                itens_out.append(
                    schemas.ItemRead(
                        id=it.id,
                        pedido_id=it.pedido_id,
                        sku=it.sku,
                        nome_produto=it.nome_produto or "",
                        plataforma=_safe_platform(it.plataforma),
                        quantidade=_safe_int(it.quantidade),
                        preco_unitario=_safe_float(it.preco_unitario),
                        email_conta=it.email_conta,
                        senha_conta=it.senha_conta,
                        nick_conta=it.nick_conta,
                        codigo_ativacao=it.codigo_ativacao,
                        enviado=bool(it.enviado),
                        enviado_em=_safe_datetime_str(it.enviado_em),
                        total_item=_safe_int(it.quantidade) * _safe_float(it.preco_unitario),
                    )
                )

            pedidos_out.append(
                schemas.PedidoReadWithItens(
                    id=p.id,
                    codigo=p.codigo,
                    status=str(p.status or "PAID"),
                    data_criacao=_safe_date_str(p.data_criacao),
                    cliente_nome=p.cliente_nome or "",
                    cliente_email=_normalize_email_for_response(p.cliente_email),
                    telefone=p.telefone,
                    enviado=bool(p.enviado),
                    enviado_em=_safe_datetime_str(p.enviado_em),
                    itens=itens_out,
                )
            )

        result.append(
            schemas.GrupoPedidosRead(
                codigo=g.get("codigo"),
                total_pedidos=int(g.get("total_pedidos", 0)),
                total_itens=int(g.get("total_itens", 0)),
                valor_total=_safe_float(g.get("valor_total", 0)),
                pedidos=pedidos_out,
            )
        )
    return result

# ---------------------------------------------------------------------
# Pedidos
# ---------------------------------------------------------------------
@app.get("/pedidos", response_model=list[schemas.PedidoRead])
def listar_pedidos(db: Session = Depends(get_db)):
    return crud.listar_pedidos(db)

@app.post("/pedidos", response_model=schemas.PedidoRead, status_code=201)
def criar_pedido(data: schemas.PedidoCreate, db: Session = Depends(get_db)):
    return crud.criar_pedido(db, data)

@app.get("/pedidos/{pedido_id}", response_model=schemas.PedidoRead)
def obter_pedido(pedido_id: int, db: Session = Depends(get_db)):
    p = crud.obter_pedido(db, pedido_id)
    if not p:
        raise HTTPException(status_code=404, detail="Pedido não encontrado")
    return p

@app.patch("/pedidos/{pedido_id}", response_model=schemas.PedidoRead)
def atualizar_pedido(
    pedido_id: int, data: schemas.PedidoUpdate, db: Session = Depends(get_db)
):
    p = crud.atualizar_pedido(db, pedido_id, data)
    if not p:
        raise HTTPException(status_code=404, detail="Pedido não encontrado")
    return p

@app.delete("/pedidos/{pedido_id}", status_code=204)
def excluir_pedido(pedido_id: int, db: Session = Depends(get_db)):
    ok = crud.excluir_pedido(db, pedido_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Pedido não encontrado")
    return

@app.get("/pedidos/{pedido_id}/total")
def total_pedido(pedido_id: int, db: Session = Depends(get_db)):
    if not crud.obter_pedido(db, pedido_id):
        raise HTTPException(status_code=404, detail="Pedido não encontrado")
    total: Decimal = crud.total_do_pedido(db, pedido_id)
    return {"pedido_id": pedido_id, "total": float(total)}

# ---------------------------------------------------------------------
# Itens
# ---------------------------------------------------------------------
@app.get("/pedidos/{pedido_id}/itens", response_model=list[schemas.ItemRead])
def listar_itens(pedido_id: int, db: Session = Depends(get_db)):
    if not crud.obter_pedido(db, pedido_id):
        raise HTTPException(status_code=404, detail="Pedido não encontrado")
    itens = crud.listar_itens(db, pedido_id)
    out: list[schemas.ItemRead] = []
    for i in itens:
        total_item = float((i.quantidade or 0) * float(i.preco_unitario or 0))
        s = schemas.ItemRead(
            id=i.id,
            pedido_id=i.pedido_id,
            sku=i.sku,
            nome_produto=i.nome_produto,
            plataforma=_safe_platform(i.plataforma),
            quantidade=_safe_int(i.quantidade),
            preco_unitario=_safe_float(i.preco_unitario),
            email_conta=i.email_conta,
            senha_conta=i.senha_conta,
            nick_conta=i.nick_conta,
            codigo_ativacao=i.codigo_ativacao,
            enviado=bool(i.enviado),
            enviado_em=_safe_datetime_str(i.enviado_em),
            total_item=total_item,
        )
        out.append(s)
    return out

@app.post("/pedidos/{pedido_id}/itens", response_model=schemas.ItemRead, status_code=201)
def criar_item(pedido_id: int, data: schemas.ItemCreate, db: Session = Depends(get_db)):
    it = crud.criar_item(db, pedido_id, data)
    if not it:
        raise HTTPException(status_code=404, detail="Pedido não encontrado")
    total_item = float((it.quantidade or 0) * float(it.preco_unitario or 0))
    return schemas.ItemRead(
        id=it.id,
        pedido_id=it.pedido_id,
        sku=it.sku,
        nome_produto=it.nome_produto,
        plataforma=_safe_platform(it.plataforma),
        quantidade=_safe_int(it.quantidade),
        preco_unitario=_safe_float(it.preco_unitario),
        email_conta=it.email_conta,
        senha_conta=it.senha_conta,
        nick_conta=it.nick_conta,
        codigo_ativacao=it.codigo_ativacao,
        enviado=bool(it.enviado),
        enviado_em=_safe_datetime_str(it.enviado_em),
        total_item=total_item,
    )

@app.patch("/itens/{item_id}", response_model=schemas.ItemRead)
def atualizar_item(item_id: int, data: schemas.ItemUpdate, db: Session = Depends(get_db)):
    it = crud.atualizar_item(db, item_id, data)
    if not it:
        raise HTTPException(status_code=404, detail="Item não encontrado")
    total_item = float((it.quantidade or 0) * float(it.preco_unitario or 0))
    return schemas.ItemRead(
        id=it.id,
        pedido_id=it.pedido_id,
        sku=it.sku,
        nome_produto=it.nome_produto,
        plataforma=_safe_platform(it.plataforma),
        quantidade=_safe_int(it.quantidade),
        preco_unitario=_safe_float(it.preco_unitario),
        email_conta=it.email_conta,
        senha_conta=it.senha_conta,
        nick_conta=it.nick_conta,
        codigo_ativacao=it.codigo_ativacao,
        enviado=bool(it.enviado),
        enviado_em=_safe_datetime_str(it.enviado_em),
        total_item=total_item,
    )

@app.delete("/itens/{item_id}", status_code=204)
def excluir_item(item_id: int, db: Session = Depends(get_db)):
    ok = crud.excluir_item(db, item_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Item não encontrado")
    return

@app.post("/itens/{item_id}/toggle-enviado", response_model=schemas.ItemRead)
def toggle_enviado(item_id: int, db: Session = Depends(get_db)):
    it = crud.toggle_enviado(db, item_id)
    if not it:
        raise HTTPException(status_code=404, detail="Item não encontrado")
    total_item = float((it.quantidade or 0) * float(it.preco_unitario or 0))
    return schemas.ItemRead(
        id=it.id,
        pedido_id=it.pedido_id,
        sku=it.sku,
        nome_produto=it.nome_produto,
        plataforma=_safe_platform(it.plataforma),
        quantidade=_safe_int(it.quantidade),
        preco_unitario=_safe_float(it.preco_unitario),
        email_conta=it.email_conta,
        senha_conta=it.senha_conta,
        nick_conta=it.nick_conta,
        codigo_ativacao=it.codigo_ativacao,
        enviado=bool(it.enviado),
        enviado_em=_safe_datetime_str(it.enviado_em),
        total_item=total_item,
    )

# ---------------------------------------------------------------------
# Venda (atalho: cria Pedido + 1 Item)
# ---------------------------------------------------------------------
@app.post("/vendas", response_model=schemas.VendaRead, status_code=201)
def criar_venda(data: schemas.VendaCreate, db: Session = Depends(get_db)):
    pedido, item = crud.criar_venda(db, data)
    ped_out = schemas.PedidoRead.model_validate(pedido)
    it_out = schemas.ItemRead.model_validate(item)
    it_out.total_item = float((item.quantidade or 0) * float(item.preco_unitario or 0))
    return {"pedido": ped_out, "item": it_out}

# ---------------------------------------------------------------------
# Emails: enviar por ITEM e marcar como enviado
# ---------------------------------------------------------------------
class SendItemPayload(BaseModel):
    """
    Payload flexível para evitar 422 e aceitar FormData/JSON com chaves variadas.
    """
    model_config = ConfigDict(extra="allow")
    item_id: int | str
    destinatario: str
    cliente_nome: str = ""
    pedido_codigo: str | int | None = None
    jogo: str = ""
    template_tipo: str = "PS4_Primaria"
    login: Optional[str] = ""
    senha: Optional[str] = ""
    codigo: Optional[str] = ""

def _coerce_send_item_payload(raw: Dict[str, Any]) -> Dict[str, Any]:
    def pick(*keys):
        for k in keys:
            if k in raw and raw[k] is not None:
                return raw[k]
        return None
    return {
        "item_id": pick("item_id", "itemId", "id"),
        "destinatario": pick("destinatario", "to", "email", "cliente_email"),
        "cliente_nome": pick("cliente_nome", "clienteNome", "nome", "cliente") or "",
        "pedido_codigo": pick("pedido_codigo", "pedidoCodigo", "codigo_pedido", "codigoPedido"),
        "jogo": pick("jogo", "game", "nome_jogo") or "",
        "template_tipo": pick("template_tipo", "templateTipo", "template") or "PS4_Primaria",
        "login": pick("login", "email_conta", "usuario") or "",
        "senha": pick("senha", "senha_conta", "password") or "",
        "codigo": pick("codigo", "codigo_ativacao", "code") or "",
    }

@app.post("/emails/send-item")
async def emails_send_item(request: Request, db: Session = Depends(get_db)):
    """
    Aceita JSON e FormData, monta e envia o e-mail e marca apenas o item como enviado.
    """
    ct = (request.headers.get("content-type") or "").lower()
    if ct.startswith("application/json"):
        raw = await request.json()
        if not isinstance(raw, dict):
            raise HTTPException(status_code=400, detail="JSON inválido.")
    elif "multipart/form-data" in ct or "application/x-www-form-urlencoded" in ct:
        form = await request.form()
        raw = dict(form)
    else:
        try:
            raw = await request.json()
            if not isinstance(raw, dict):
                raise ValueError()
        except Exception:
            raise HTTPException(status_code=400, detail="Conteúdo inválido. Envie JSON ou FormData.")

    payload = _coerce_send_item_payload(raw)

    try:
        item_id_int = int(str(payload["item_id"]).strip())
    except Exception:
        raise HTTPException(status_code=400, detail="item_id deve ser um inteiro válido")
    if item_id_int <= 0:
        raise HTTPException(status_code=400, detail="item_id deve ser > 0")

    to_email = _normalize_email_for_response(payload["destinatario"])
    if not to_email or "@" not in to_email:
        raise HTTPException(status_code=400, detail="destinatario inválido")

    try:
        msg = emailer.montar_email_entrega_item(
            destinatario=to_email,
            cliente_nome=payload["cliente_nome"] or "",
            pedido_codigo=payload["pedido_codigo"] or item_id_int,
            jogo=payload["jogo"] or "",
            template_tipo=payload["template_tipo"] or "PS4_Primaria",
            login=payload["login"] or "",
            senha=payload["senha"] or "",
            codigo=payload["codigo"] or "",
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Erro ao montar e-mail: {e}")

    result = emailer.send_email(msg)

    upd = schemas.ItemUpdate(enviado=True, enviado_em=datetime.utcnow())
    it = crud.atualizar_item(db, item_id_int, upd)
    if not it:
        raise HTTPException(status_code=404, detail="Item não encontrado para marcar como enviado")

    return {"ok": True, "email": result, "item_id": it.id, "enviado_em": _safe_datetime_str(it.enviado_em)}
