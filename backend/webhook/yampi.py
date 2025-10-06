# backend/webhooks/yampi.py
from fastapi import APIRouter, Request, HTTPException, Depends
from pydantic import BaseModel, Field
from typing import List, Optional, Union
import os, hmac, hashlib, json
from sqlalchemy.orm import Session
from datetime import datetime

from backend.database import get_db
from backend import crud, schemas

router = APIRouter(prefix="/yampi", tags=["yampi-webhook"])

# ===================== MODELOS Pydantic =====================

class YampiCustomer(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None

class YampiItem(BaseModel):
    id: Optional[int] = None
    sku: str
    name: Optional[str] = None
    quantity: Optional[int] = 1
    price: Optional[float] = 0.0
    variant_name: Optional[str] = None
    platform: Optional[str] = None

class YampiOrder(BaseModel):
    id: Union[int, str]
    code: Optional[str] = None
    status: Optional[str] = None
    created_at: Optional[str] = None
    customer: Optional[YampiCustomer] = None
    items: List[YampiItem] = Field(default_factory=list)

class YampiWebhookBody(BaseModel):
    event: str
    order: YampiOrder

# ===================== UTILIDADES =====================

def verify_hmac_signature(raw_body: bytes, signature_header: Optional[str]) -> None:
    """Valida o HMAC SHA256 do corpo do webhook"""
    secret = os.getenv("YAMPI_WEBHOOK_SECRET", "")
    if not secret:
        return  # sem HMAC → não valida (modo desenvolvimento)
    expected = hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature_header or ""):
        raise HTTPException(status_code=401, detail="Assinatura Yampi inválida")

# ===================== LÓGICA DE NEGÓCIO =====================

def criar_pedido_local(db: Session, order: YampiOrder):
    """Cria o pedido e itens no banco local (tabelas já usadas pelo painel)."""
    pedido_in = schemas.PedidoCreate(
        codigo=str(order.code or order.id),
        status="PAID" if (order.status or "").lower() in ("paid", "approved") else "PENDING",
        cliente_nome=order.customer.name if order.customer else "",
        cliente_email=order.customer.email if order.customer else "",
        telefone=order.customer.phone if order.customer else "",
        data_criacao=datetime.utcnow().strftime("%Y-%m-%d"),
    )
    pedido = crud.criar_pedido(db, pedido_in)

    for it in order.items:
        plataforma = "PS5"
        if (it.platform or "").upper().startswith("PS4"):
            plataforma = "PS4"
        elif (it.variant_name or "").lower().startswith("ps4"):
            plataforma = "PS4"
        elif (it.variant_name or "").lower().startswith("secund"):
            plataforma = "PS5s"

        item_in = schemas.ItemCreate(
            sku=it.sku,
            nome_produto=it.name or "",
            plataforma=plataforma,
            quantidade=int(it.quantity or 1),
            preco_unitario=float(it.price or 0),
        )
        crud.criar_item(db, pedido.id, item_in)

    print(f"[YAMPI] Pedido importado: {pedido_in.codigo}")
    return pedido

# ===================== ENDPOINT =====================

@router.post("/webhook", status_code=200)
async def yampi_webhook(request: Request, db: Session = Depends(get_db)):
    """
    Endpoint real da Yampi → usado no painel Configurações → Webhooks
    """
    raw = await request.body()
    sig = request.headers.get("X-Yampi-Signature", "")

    verify_hmac_signature(raw, sig)

    try:
        payload = json.loads(raw.decode("utf-8"))
    except Exception:
        raise HTTPException(status_code=400, detail="JSON inválido")

    event = payload.get("event")
    order_data = payload.get("order")

    if not order_data:
        raise HTTPException(status_code=400, detail="Pedido ausente no payload")

    order = YampiOrder(**order_data)

    if event in ("order.created", "order.paid"):
        criar_pedido_local(db, order)
        print(f"[YAMPI] Evento recebido: {event} (pedido {order.id})")

    return {"ok": True, "event": event}
