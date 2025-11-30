# backend/main.py
from __future__ import annotations
from fastapi import Body
import json
import hmac
import uuid
import hashlib
import re
import smtplib
from email.message import EmailMessage
from datetime import datetime
from decimal import Decimal
from typing import Optional, Any, Dict, Tuple, Iterable, List, cast

import urllib.request
from urllib.error import URLError, HTTPError

from fastapi import FastAPI, Depends, HTTPException, Request, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.routing import APIRouter
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from .database import Base, engine, get_db
from . import schemas, crud
from .settings import settings  # <- ÚNICA fonte de config
from .email_templates import template_envio_item, subject_for

# ======================================================
# Importa o router de promoções com fallback
# ======================================================
try:
    from .promocoes import router as promocoes_router  # type: ignore
    HAS_PROMO_ROUTER = True
except Exception as e:
    print(f"[WARN] Falha ao importar promocoes.py: {e}")
    promocoes_router = None
    HAS_PROMO_ROUTER = False

# ---------------------------------------------------------------------
# App + CORS
# ---------------------------------------------------------------------
app = FastAPI(title="Zion Admin API", version="0.6.5")

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

# ---------------------------------------------------------------------
# Email Client (SMTP)
# ---------------------------------------------------------------------
class EmailClient:
    """Envio SMTP simples (STARTTLS por padrão)."""
    def __init__(
        self,
        host: str | None = None,
        port: int | None = None,
        username: str | None = None,
        password: str | None = None,
        use_tls: bool | None = None,
        use_ssl: bool | None = None,
        default_from: Optional[str] = None,
    ):
        self.host = host or settings.EMAIL_HOST
        self.port = port or settings.EMAIL_PORT
        self.username = username or str(settings.EMAIL_USERNAME)
        # remove espaços por segurança (Gmail mostra com espaços no app password)
        raw_pwd = password or settings.EMAIL_PASSWORD
        self.password = str(raw_pwd).replace(" ", "")
        self.use_tls = settings.EMAIL_USE_TLS if use_tls is None else use_tls
        self.use_ssl = settings.EMAIL_USE_SSL if use_ssl is None else use_ssl
        self.default_from = default_from or settings.EMAIL_FROM or self.username

    def _connect(self) -> smtplib.SMTP:
        if self.use_ssl:
            smtp = smtplib.SMTP_SSL(self.host, self.port)
        else:
            smtp = smtplib.SMTP(self.host, self.port)
        smtp.ehlo()
        if self.use_tls and not self.use_ssl:
            smtp.starttls()
            smtp.ehlo()
        if self.username and self.password:
            smtp.login(self.username, self.password)
        return smtp

    @staticmethod
    def _to_plain(html: str) -> str:
        import re
        return re.sub("<[^<]+?>", "", html)

    def send_email(
        self,
        to: str | Iterable[str],
        subject: str,
        html: str,
        text: Optional[str] = None,
        cc: Optional[List[str]] = None,
        bcc: Optional[List[str]] = None,
        reply_to: Optional[str] = None,
        from_addr: Optional[str] = None,
    ) -> dict:
        to_list = [to] if isinstance(to, str) else list(to)
        msg = EmailMessage()
        msg["Subject"] = subject
        msg["From"] = from_addr or self.default_from
        msg["To"] = ", ".join(to_list)
        if cc:
            msg["Cc"] = ", ".join(cc)
        if reply_to:
            msg["Reply-To"] = reply_to

        if text:
            msg.set_content(text)
            msg.add_alternative(html, subtype="html")
        else:
            plain = self._to_plain(html)
            msg.set_content(plain)
            msg.add_alternative(html, subtype="html")

        all_recipients = to_list + (cc or []) + (bcc or [])
        with self._connect() as smtp:
            result = smtp.send_message(msg, to_addrs=all_recipients)
        # dict vazio == sucesso
        return {"errors": result}

email_client = EmailClient()

# ---------------------------------------------------------------------
# Startup
# ---------------------------------------------------------------------
@app.on_event("startup")
async def _startup_notice():
    print("✅ Zion Admin API iniciada.")
    print("   - Banco conectando...")
    try:
        Base.metadata.create_all(bind=engine)
        print("   - Tabelas OK.")
    except Exception as e:
        print(f"   - ERRO ao criar tabelas: {e}")
    print(f"   - Rota /promocoes ativada: {HAS_PROMO_ROUTER}")
    print("   - Banco conectado (ou em tentativa).")
    print(f"   - BACKEND_BASE_URL = {settings.BACKEND_BASE_URL}")
    print(f"   - EMAIL_USERNAME = {settings.EMAIL_USERNAME}")
    print(f"   - EMAIL_FROM = {settings.EMAIL_FROM or settings.EMAIL_USERNAME}")
    print(f"   - EMAIL_HOST/PORT/TLS = {settings.EMAIL_HOST}/{settings.EMAIL_PORT}/{settings.EMAIL_USE_TLS}")

@app.get("/health")
def health():
    return {"status": "ok"}

# ---------------------------------------------------------------------
# Registra router de promoções ou rota mock
# ---------------------------------------------------------------------
if HAS_PROMO_ROUTER and isinstance(promocoes_router, APIRouter):
    app.include_router(promocoes_router)
else:
    @app.get("/promocoes/listar")
    def _promocoes_mock():
        return {
            "fonte": "mock",
            "promocoes": [
                {
                    "nome": "GTA V PS4",
                    "preco_original": 199.90,
                    "preco_atual": 79.90,
                    "desconto": 60.0,
                    "fim_promocao": "2025-10-31",
                    "preco_zion": 59.90,
                    "url": "https://store.playstation.com/pt-br/product/UP1004-CUSA00419_00-GTAVDIGITALDOWNL",
                },
                {
                    "nome": "EA SPORTS FC 25 PS5",
                    "preco_original": 399.90,
                    "preco_atual": 249.90,
                    "desconto": 38.0,
                    "fim_promocao": "2025-10-28",
                    "preco_zion": 189.90,
                    "url": "https://store.playstation.com/pt-br/product/UP0006-PPSA07408_00-EASPORTSFC25PS5",
                },
            ],
        }

# ---------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------
def _safe_platform(value: str | None) -> schemas.Plataforma:
    allowed: tuple[schemas.Plataforma, ...] = cast(
        tuple[schemas.Plataforma, ...], ("PS4", "PS4s", "PS5", "PS5s")
    )
    v: schemas.Plataforma = cast(
        schemas.Plataforma,
        value if isinstance(value, str) and value in allowed else "PS4",
    )
    return v

def _safe_float(v: Any) -> float:
    try:
        return float(v or 0)
    except Exception:
        return 0.0

def _safe_int(v: Any) -> int:
    try:
        return int(v or 0)
    except Exception:
        return 0

def _safe_date_str(v: Any) -> str:
    if v is None:
        return ""
    if isinstance(v, str):
        return v
    if hasattr(v, "isoformat"):
        return v.isoformat().split("T")[0]
    return str(v)

def _safe_datetime_str(v: Any) -> Optional[str]:
    if not v:
        return None
    if isinstance(v, str):
        return v
    if hasattr(v, "isoformat"):
        return v.isoformat()  # type: ignore[no-any-return]
    return str(v)

def _normalize_email_for_response(value: Any) -> str:
    FALLBACK = "no-reply@zion.games"
    if value is None:
        return FALLBACK
    s = str(value).strip()
    if s.lower().startswith("mailto:"):
        s = s[7:].strip()
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
    reserved_roots = {"localhost", "local", "example", "invalid", "test"}
    if domain.endswith(".local") or domain in reserved_roots:
        domain = "zion.games"
    if "." not in domain:
        domain = f"{domain}.com"
    local = re.sub(r"[^A-Za-z0-9._+-]", "", local) or "no-reply"
    return f"{local}@{domain}"

# =====================================================================
# Configs de Integração (n8n + Yampi) — usando Settings
# =====================================================================
N8N_WEBHOOK_URL = settings.N8N_WEBHOOK_URL
N8N_HMAC_SECRET = (settings.N8N_HMAC_SECRET or "").encode("utf-8") if settings.N8N_HMAC_SECRET else b""
N8N_DRY_RUN = bool(settings.N8N_DRY_RUN)

BACKEND_BASE_URL = (settings.BACKEND_BASE_URL or "http://127.0.0.1:8000").rstrip("/")

YAMPI_API_BASE = settings.YAMPI_API_BASE
YAMPI_API_TOKEN = settings.YAMPI_API_TOKEN
YAMPI_WEBHOOK_SECRET = (settings.YAMPI_WEBHOOK_SECRET or "").encode("utf-8") if settings.YAMPI_WEBHOOK_SECRET else b""

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
# Fulfillment: Site ⇄ n8n
# =====================================================================
@app.post("/fulfillment/create")
async def fulfillment_create(req: Request):
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
    if not YAMPI_API_BASE:
        return
    url = f"{YAMPI_API_BASE}/orders/{order_id}"
    body = {"status": "delivered"}
    code, j = _http_json("PUT", url, body=body, headers=_yampi_auth_headers())
    if not (200 <= code < 300):
        print(f"[YAMPI] Falha ao marcar entregue {order_id}: {code} {j}")

def _yampi_update_stock_by_sku(sku: str, quantity: int):
    if not YAMPI_API_BASE:
        return
    url = f"{YAMPI_API_BASE}/products/{sku}/stock"
    body = {"quantity": int(quantity)}
    code, j = _http_json("PUT", url, body=body, headers=_yampi_auth_headers())
    if not (200 <= code < 300):
        print(f"[YAMPI] Falha ao atualizar estoque SKU={sku}: {code} {j}")

def _yampi_verify_webhook(req: Request, raw: bytes) -> None:
    """
    Verifica a assinatura HMAC da Yampi.
    Em DEV, só loga problema de assinatura e NÃO levanta HTTPException.
    Em produção, você pode voltar a dar raise.
    """
    if not YAMPI_WEBHOOK_SECRET:
        print("[YAMPI] YAMPI_WEBHOOK_SECRET não configurado. Pulando verificação.")
        return

    provided = req.headers.get("x-yampi-signature", "") or req.headers.get("X-Yampi-Signature", "")
    expected = _hmac_sign(raw, YAMPI_WEBHOOK_SECRET)

    if not provided:
        print("[YAMPI] Sem header x-yampi-signature. (DEV: aceitando mesmo assim)")
        return

    if provided != expected:
        print(f"[YAMPI] Assinatura inválida. Provided={provided} Expected={expected}")
        # 🔴 EM PRODUÇÃO: aqui você usaria:
        # raise HTTPException(status_code=401, detail="Assinatura Yampi inválida")
        # 🔵 EM DEV: só loga
        return

    print("[YAMPI] Assinatura HMAC OK.")


def _criar_pedido_local_de_yampi(db: Session, yampi_order: dict) -> tuple[schemas.PedidoRead, list[schemas.ItemRead]]:
    """
    Cria o Pedido + Itens localmente a partir do payload da Yampi
    (formato novo, usando 'resource', 'customer.data', 'items.data', etc.)
    e devolve os modelos de leitura (PedidoRead + [ItemRead]).
    """

    # ---------- CUSTOMER ----------
    customer_block = yampi_order.get("customer") or {}
    if isinstance(customer_block, dict) and "data" in customer_block:
        customer = customer_block.get("data") or {}
    else:
        customer = customer_block or {}

    # E-mail normalizado
    safe_email = _normalize_email_for_response(customer.get("email") or "")

    # Telefone: phone.full_number ou phone.formated_number
    phone_obj = customer.get("phone") or ""
    if isinstance(phone_obj, dict):
        telefone = str(
            phone_obj.get("full_number")
            or phone_obj.get("formated_number")
            or ""
        )
    else:
        telefone = str(phone_obj or "")

    # Nome do cliente
    cliente_nome = (
        customer.get("name")
        or customer.get("generic_name")
        or ""
    )

    # ---------- CAMPOS DO PEDIDO ----------
    # Código do pedido: tenta 'number' (número que você vê na Yampi), depois 'id'
    codigo = str(
        yampi_order.get("number")
        or yampi_order.get("code")
        or yampi_order.get("id")
        or ""
    )

    # Status: vem em status.data.alias = "paid", "waiting_payment", etc.
    status_alias = ""
    status_block = yampi_order.get("status") or {}
    if isinstance(status_block, dict):
        status_data = status_block.get("data") or {}
        status_alias = str(status_data.get("alias", "")).lower()

    status_local = "PAID" if status_alias in ("paid", "approved") else "PENDING"

    pedido_in = schemas.PedidoCreate(
        codigo=codigo,
        status=status_local,
        cliente_nome=str(cliente_nome),
        cliente_email=safe_email,
        telefone=telefone,
        # por enquanto uso a data atual; se quiser posso puxar de created_at.data
        data_criacao=_safe_date_str(datetime.utcnow()),
    )

    # Cria o pedido no banco
    pedido_row = crud.criar_pedido(db, pedido_in)
    ped_out = schemas.PedidoRead.model_validate(pedido_row)
    pid = int(getattr(pedido_row, "id", 0) or ped_out.id or 0)

    # ---------- ITENS ----------
    raw_items = yampi_order.get("items") or []
    # Se vier no formato { "data": [ ... ] }
    if isinstance(raw_items, dict) and "data" in raw_items:
        items_iter = raw_items.get("data") or []
    else:
        items_iter = raw_items

    itens_out: list[schemas.ItemRead] = []

    for it in items_iter:
        # SKU: tenta item_sku, depois sku.data.sku
        sku_str = str(
            it.get("item_sku")
            or (
                ((it.get("sku") or {}).get("data") or {}).get("sku")
            )
            or ""
        )

        # Nome do produto: sku.data.title ou 'product'/'name'
        sku_data = (it.get("sku") or {}).get("data") or {}
        nome_produto = (
            sku_data.get("title")
            or it.get("product")
            or it.get("name")
            or ""
        )

        # Plataforma: por enquanto default PS5, até mapear por SKU/variante
        plataformas = {
            "PS4": "PS4", "PS5": "PS5",
            "PS4 Primária": "PS4", "PS4 Secundária": "PS4s",
            "PS5 Primária": "PS5", "PS5 Secundária": "PS5s",
        }
        plataforma_str = str(it.get("platform") or it.get("variant_name") or "").strip()
        plataforma = _safe_platform(plataformas.get(plataforma_str, "PS5"))

        quantidade = _safe_int(it.get("quantity") or 1)
        preco_unitario = _safe_float(it.get("price") or 0)

        item_in = schemas.ItemCreate(
            sku=sku_str,
            nome_produto=str(nome_produto),
            plataforma=plataforma,
            quantidade=quantidade,
            preco_unitario=preco_unitario,
            email_conta=None,
            senha_conta=None,
            nick_conta=None,
            codigo_ativacao=None,
        )

        row = crud.criar_item(db, pid, item_in)
        if row is None:
            raise HTTPException(status_code=500, detail="Falha ao criar item do pedido")

        row = cast(object, row)
        total_item = _safe_int(getattr(row, "quantidade", 0)) * _safe_float(getattr(row, "preco_unitario", 0))

        it_out = schemas.ItemRead(
            id=int(getattr(row, "id", 0)),
            pedido_id=int(getattr(row, "pedido_id", pid)),
            sku=str(getattr(row, "sku", "") or ""),
            nome_produto=str(getattr(row, "nome_produto", "") or ""),
            plataforma=_safe_platform(str(getattr(row, "plataforma", "PS4"))),
            quantidade=_safe_int(getattr(row, "quantidade", 0)),
            preco_unitario=_safe_float(getattr(row, "preco_unitario", 0)),
            email_conta=cast(Optional[str], getattr(row, "email_conta", None)),
            senha_conta=cast(Optional[str], getattr(row, "senha_conta", None)),
            nick_conta=cast(Optional[str], getattr(row, "nick_conta", None)),
            codigo_ativacao=cast(Optional[str], getattr(row, "codigo_ativacao", None)),
            enviado=bool(getattr(row, "enviado", False)),
            enviado_em=_safe_datetime_str(getattr(row, "enviado_em", None)),
            total_item=float(total_item),
        )
        itens_out.append(it_out)

    return ped_out, itens_out


def _disparar_fulfillment_n8n(pedido: schemas.PedidoRead, itens: list[schemas.ItemRead]):
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
    url = f"{settings.BACKEND_BASE_URL.rstrip('/')}/fulfillment/create"
    code, j = _http_json("POST", url, body)
    if not (200 <= code < 300):
        print("[FULFILLMENT] Falha ao disparar:", code, j)

@app.post("/yampi/webhook")
async def yampi_webhook(req: Request, db: Session = Depends(get_db)):
    raw = await req.body()

        # 🔍 LOG DE DEBUG – VOLTOU!
    print("==== YAMPI WEBHOOK RAW PAYLOAD ====")
    try:
        print(raw.decode("utf-8", "ignore"))
    except Exception:
        print("<falha ao decodar body>")
    print("====================================")

    try:
        payload = json.loads(raw.decode("utf-8"))
    except Exception:
        raise HTTPException(status_code=400, detail="JSON inválido")

    event = str(payload.get("event", "")).strip()

    # Yampi envia o pedido em "resource" (formato novo)
    resource = payload.get("resource") or {}
    # fallback: se algum dia vier em "order"
    if not resource:
        resource = payload.get("order") or {}

    product = payload.get("product") or {}
    inventory = payload.get("inventory") or {}

    if event in ("order.created", "order.paid"):
        ped_out, itens_out = _criar_pedido_local_de_yampi(db, resource)

        # lê o alias do status se precisar, mas o principal é o próprio event
        status_alias = ""
        status_block = resource.get("status") or {}
        if isinstance(status_block, dict):
            status_data = status_block.get("data") or {}
            status_alias = str(status_data.get("alias", "")).lower()

        if event == "order.paid" or status_alias in ("paid", "approved"):
            # não vamos deixar o webhook cair se o fulfillment der erro
            try:
                _disparar_fulfillment_n8n(ped_out, itens_out)
            except Exception as e:
                print(f"[FULFILLMENT] erro ao disparar n8n: {e}")

        return {"ok": True}

    if event == "order.delivered":
        oid = str(resource.get("id") or resource.get("code") or resource.get("number") or "").strip()
        if oid:
            _yampi_mark_delivered(oid)
        return {"ok": True}

    if event in ("product.updated", "inventory.updated"):
        sku = str(product.get("sku") or inventory.get("sku") or "").strip()
        qty = int(inventory.get("quantity") or product.get("quantity") or 0)
        if sku:
            try:
                # espelhamento opcional site <- Yampi
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
                        id=int(getattr(it, "id", 0)),
                        pedido_id=int(getattr(it, "pedido_id", 0)),
                        sku=str(getattr(it, "sku", "") or ""),
                        nome_produto=str(getattr(it, "nome_produto", "") or ""),
                        plataforma=_safe_platform(str(getattr(it, "plataforma", "PS4"))),
                        quantidade=_safe_int(getattr(it, "quantidade", 0)),
                        preco_unitario=_safe_float(getattr(it, "preco_unitario", 0)),
                        email_conta=cast(Optional[str], getattr(it, "email_conta", None)),
                        senha_conta=cast(Optional[str], getattr(it, "senha_conta", None)),
                        nick_conta=cast(Optional[str], getattr(it, "nick_conta", None)),
                        codigo_ativacao=cast(Optional[str], getattr(it, "codigo_ativacao", None)),
                        enviado=bool(getattr(it, "enviado", False)),
                        enviado_em=_safe_datetime_str(getattr(it, "enviado_em", None)),
                        total_item=_safe_int(getattr(it, "quantidade", 0))
                        * _safe_float(getattr(it, "preco_unitario", 0)),
                    )
                )

            pedidos_out.append(
                schemas.PedidoReadWithItens(
                    id=int(getattr(p, "id", 0)),
                    codigo=str(getattr(p, "codigo", "") or ""),
                    status=str(getattr(p, "status", "PAID") or "PAID"),
                    data_criacao=_safe_date_str(getattr(p, "data_criacao", "")),
                    cliente_nome=str(getattr(p, "cliente_nome", "") or ""),
                    cliente_email=_normalize_email_for_response(getattr(p, "cliente_email", "")),
                    telefone=str(getattr(p, "telefone", "") or ""),
                    enviado=bool(getattr(p, "enviado", False)),
                    enviado_em=_safe_datetime_str(getattr(p, "enviado_em", None)),
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
        total_item = _safe_int(getattr(i, "quantidade", 0)) * _safe_float(getattr(i, "preco_unitario", 0))
        s = schemas.ItemRead(
            id=int(getattr(i, "id", 0)),
            pedido_id=int(getattr(i, "pedido_id", 0)),
            sku=str(getattr(i, "sku", "") or ""),
            nome_produto=str(getattr(i, "nome_produto", "") or ""),
            plataforma=_safe_platform(str(getattr(i, "plataforma", "PS4"))),
            quantidade=_safe_int(getattr(i, "quantidade", 0)),
            preco_unitario=_safe_float(getattr(i, "preco_unitario", 0)),
            email_conta=cast(Optional[str], getattr(i, "email_conta", None)),
            senha_conta=cast(Optional[str], getattr(i, "senha_conta", None)),
            nick_conta=cast(Optional[str], getattr(i, "nick_conta", None)),
            codigo_ativacao=cast(Optional[str], getattr(i, "codigo_ativacao", None)),
            enviado=bool(getattr(i, "enviado", False)),
            enviado_em=_safe_datetime_str(getattr(i, "enviado_em", None)),
            total_item=float(total_item),
        )
        out.append(s)
    return out

@app.post("/pedidos/{pedido_id}/itens", response_model=schemas.ItemRead, status_code=201)
def criar_item(pedido_id: int, data: schemas.ItemCreate, db: Session = Depends(get_db)):
    it = crud.criar_item(db, pedido_id, data)
    if not it:
        raise HTTPException(status_code=404, detail="Pedido não encontrado")
    total_item = _safe_int(getattr(it, "quantidade", 0)) * _safe_float(getattr(it, "preco_unitario", 0))
    return schemas.ItemRead(
        id=int(getattr(it, "id", 0)),
        pedido_id=int(getattr(it, "pedido_id", pedido_id)),
        sku=str(getattr(it, "sku", "") or ""),
        nome_produto=str(getattr(it, "nome_produto", "") or ""),
        plataforma=_safe_platform(str(getattr(it, "plataforma", "PS4"))),
        quantidade=_safe_int(getattr(it, "quantidade", 0)),
        preco_unitario=_safe_float(getattr(it, "preco_unitario", 0)),
        email_conta=cast(Optional[str], getattr(it, "email_conta", None)),
        senha_conta=cast(Optional[str], getattr(it, "senha_conta", None)),
        nick_conta=cast(Optional[str], getattr(it, "nick_conta", None)),
        codigo_ativacao=cast(Optional[str], getattr(it, "codigo_ativacao", None)),
        enviado=bool(getattr(it, "enviado", False)),
        enviado_em=_safe_datetime_str(getattr(it, "enviado_em", None)),
        total_item=float(total_item),
    )

@app.patch("/itens/{item_id}", response_model=schemas.ItemRead)
def atualizar_item(item_id: int, data: schemas.ItemUpdate, db: Session = Depends(get_db)):
    it = crud.atualizar_item(db, item_id, data)
    if not it:
        raise HTTPException(status_code=404, detail="Item não encontrado")
    total_item = _safe_int(getattr(it, "quantidade", 0)) * _safe_float(getattr(it, "preco_unitario", 0))
    return schemas.ItemRead(
        id=int(getattr(it, "id", 0)),
        pedido_id=int(getattr(it, "pedido_id", 0)),
        sku=str(getattr(it, "sku", "") or ""),
        nome_produto=str(getattr(it, "nome_produto", "") or ""),
        plataforma=_safe_platform(str(getattr(it, "plataforma", "PS4"))),
        quantidade=_safe_int(getattr(it, "quantidade", 0)),
        preco_unitario=_safe_float(getattr(it, "preco_unitario", 0)),
        email_conta=cast(Optional[str], getattr(it, "email_conta", None)),
        senha_conta=cast(Optional[str], getattr(it, "senha_conta", None)),
        nick_conta=cast(Optional[str], getattr(it, "nick_conta", None)),
        codigo_ativacao=cast(Optional[str], getattr(it, "codigo_ativacao", None)),
        enviado=bool(getattr(it, "enviado", False)),
        enviado_em=_safe_datetime_str(getattr(it, "enviado_em", None)),
        total_item=float(total_item),
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
    total_item = _safe_int(getattr(it, "quantidade", 0)) * _safe_float(getattr(it, "preco_unitario", 0))
    return schemas.ItemRead(
        id=int(getattr(it, "id", 0)),
        pedido_id=int(getattr(it, "pedido_id", 0)),
        sku=str(getattr(it, "sku", "") or ""),
        nome_produto=str(getattr(it, "nome_produto", "") or ""),
        plataforma=_safe_platform(str(getattr(it, "plataforma", "PS4"))),
        quantidade=_safe_int(getattr(it, "quantidade", 0)),
        preco_unitario=_safe_float(getattr(it, "preco_unitario", 0)),
        email_conta=cast(Optional[str], getattr(it, "email_conta", None)),
        senha_conta=cast(Optional[str], getattr(it, "senha_conta", None)),
        nick_conta=cast(Optional[str], getattr(it, "nick_conta", None)),
        codigo_ativacao=cast(Optional[str], getattr(it, "codigo_ativacao", None)),
        enviado=bool(getattr(it, "enviado", False)),
        enviado_em=_safe_datetime_str(getattr(it, "enviado_em", None)),
        total_item=float(total_item),
    )

# ---------------------------------------------------------------------
# Venda / Envio por e-mail (nativo, sem n8n)
# ---------------------------------------------------------------------
class SendItemPayload(BaseModel):
    model_config = ConfigDict(extra="allow")
    item_id: int | str
    destinatario: str
    cliente_nome: str = ""
    pedido_codigo: str | int | None = None
    jogo: str = ""
    template_tipo: str = "PS4_Primaria"  # mantido apenas por compat.
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

def _send_email_item_sync(
    to_email: str,
    cliente_nome: str,
    jogo: str,
    plataforma_variacao: str,
    login: str,
    senha: str,
    codigo: Optional[str],
    subject: Optional[str] = None,
) -> dict:
    html = template_envio_item(
        nome_cliente=cliente_nome or "",
        nome_jogo=jogo or "",
        plataforma_variacao=plataforma_variacao,
        login=login or "",
        senha=senha or "",
        codigo=codigo or None,
        observacoes_html=None,
    )
    subj = subject or subject_for(plataforma_variacao, jogo or "Seu jogo")
    return email_client.send_email(to=to_email, subject=subj, html=html)

@app.post("/emails/send-item")
async def emails_send_item(request: Request, bg: BackgroundTasks, db: Session = Depends(get_db)):
    # aceita JSON ou form-data, mantendo compatibilidade
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

    # Determina plataforma/variação visual do template com base no item
    it = crud.obter_item(db, item_id_int)
    if not it:
        raise HTTPException(status_code=404, detail="Item não encontrado")
    plataforma_variacao = {
        "PS4": "PS4 Secundária",
        "PS4s": "PS4 Secundária",
        "PS5": "PS5 Primária",
        "PS5s": "PS5 Secundária",
    }.get(_safe_platform(str(getattr(it, "plataforma", "PS5"))), "PS5 Primária")

    jogo_str = str(payload["jogo"] or getattr(it, "nome_produto", "") or "")

    # Dispara o envio em background
    bg.add_task(
        _send_email_item_sync,
        to_email,
        str(payload["cliente_nome"] or ""),
        jogo_str,
        plataforma_variacao,
        str(payload["login"] or ""),
        str(payload["senha"] or ""),
        str(payload["codigo"] or ""),
        None,
    )

    # Marca como enviado (sem 'enviado_em' — o modelo não aceita esse campo no update)
    upd = schemas.ItemUpdate(enviado=True)
    it2 = crud.atualizar_item(db, item_id_int, upd)
    if not it2:
        raise HTTPException(status_code=404, detail="Item não encontrado para marcar como enviado")

    return {
        "ok": True,
        "queued": True,
        "item_id": int(getattr(it2, "id", item_id_int)),
        "enviado_em": _safe_datetime_str(getattr(it2, "enviado_em", None)),
        "to": to_email,
    }

@app.post("/yampi/mark-delivered")
def yampi_mark_delivered_api(payload: dict = Body(...)):
    """
    Marca um pedido como 'delivered' na Yampi.
    Expects: { "order_id": "<codigo ou id do pedido na Yampi>" }
    """
    order_id = str(payload.get("order_id", "")).strip()
    if not order_id:
        raise HTTPException(status_code=400, detail="order_id obrigatório")

    try:
        _yampi_mark_delivered(order_id)
    except HTTPException as e:
        # Propaga erro HTTP do cliente Yampi
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Falha ao marcar entregue: {e}")

    return {"ok": True, "order_id": order_id, "status": "delivered"}