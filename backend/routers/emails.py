from fastapi import APIRouter, Depends, BackgroundTasks, HTTPException
from pydantic import BaseModel, EmailStr
from typing import Optional
from ..services.email_service import EmailClient
from ..email_templates import template_envio_item

router = APIRouter(prefix="/emails", tags=["emails"])

class SendItemEmailPayload(BaseModel):
    to: EmailStr
    nome_cliente: str
    nome_jogo: str
    plataforma_variacao: str  # "PS4 Primária", "PS4 Secundária", etc.
    login: str
    senha: str
    codigo: Optional[str] = None
    observacoes_html: Optional[str] = None
    subject: Optional[str] = None  # se None, monta automático

def get_email_client() -> EmailClient:
    return EmailClient()

def _send_email_sync(payload: SendItemEmailPayload, client: EmailClient):
    html = template_envio_item(
        nome_cliente=payload.nome_cliente,
        nome_jogo=payload.nome_jogo,
        plataforma_variacao=payload.plataforma_variacao,
        login=payload.login,
        senha=payload.senha,
        codigo=payload.codigo,
        observacoes_html=payload.observacoes_html,
    )
    subject = payload.subject or f"[Zion Games] {payload.nome_jogo} — Dados de acesso"
    result = client.send_email(
        to=str(payload.to),
        subject=subject,
        html=html,
    )
    if result.get("errors"):
        raise RuntimeError(f"Falha parcial no SMTP: {result['errors']}")

@router.post("/send-item")
def send_item_email(
    payload: SendItemEmailPayload,
    bg: BackgroundTasks,
    client: EmailClient = Depends(get_email_client),
):
    try:
        # executa o envio em background para não travar o request do painel
        bg.add_task(_send_email_sync, payload, client)
        return {"ok": True, "queued": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
