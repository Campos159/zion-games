# backend/main.py
from __future__ import annotations

from decimal import Decimal
from typing import Optional

from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from .database import Base, engine, get_db
from . import schemas, crud

# ---------------------------------------------------------------------
# DB boot
# ---------------------------------------------------------------------
Base.metadata.create_all(bind=engine)

# ---------------------------------------------------------------------
# App + CORS
# ---------------------------------------------------------------------
app = FastAPI(title="Zion Admin API", version="0.2")

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
# Helpers de saneamento (evitam 422)
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
    Tenta manter o e-mail do jeito mais próximo possível do original,
    mas garantindo que passe na validação do EmailStr para não dar 422.
    - remove 'mailto:' e espaços/comas
    - converte '(at)', '[at]', ' at ' -> '@'
    - se faltar domínio com ponto, adiciona '.local'
    - se não houver '@', cai em 'no-reply@zion.local'
    """
    if value is None:
        return "no-reply@zion.local"
    s = str(value).strip()

    # remover prefixo mailto:
    if s.lower().startswith("mailto:"):
        s = s[7:].strip()

    # normalizações comuns
    s = (
        s.replace("(at)", "@")
         .replace("[at]", "@")
         .replace(" at ", "@")
         .replace(" ", "")
         .replace(",", "")
         .replace(";", "")
    )

    # se não tem '@', não tem como salvar o original sem quebrar a validação
    if "@" not in s:
        return "no-reply@zion.local"

    # garantir que o domínio tenha um ponto
    local, _, domain = s.rpartition("@")
    if "." not in domain:
        domain = domain + ".local"
    s = f"{local}@{domain}"

    return s

# =====================================================================
# Coloque rotas estáticas antes das dinâmicas com {pedido_id}
# =====================================================================

# ---------------------------------------------------------------------
# Pedidos agrupados (para a tela Pedidos Entregues)
# ---------------------------------------------------------------------
@app.get("/pedidos/agrupados", response_model=list[schemas.GrupoPedidosRead])
def pedidos_agrupados_por_codigo(
    codigo: Optional[str] = None, db: Session = Depends(get_db)
):
    """
    IMPORTANTE: esta rota vem antes de /pedidos/{pedido_id} para evitar conflito
    de path e erro 422 quando o literal 'agrupados' tenta ser parseado como int.
    """
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
        enviado_em_str = _safe_datetime_str(i.enviado_em)
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
            enviado_em=enviado_em_str,
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
    enviado_em_str = _safe_datetime_str(it.enviado_em)
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
        enviado_em=enviado_em_str,
        total_item=total_item,
    )

@app.patch("/itens/{item_id}", response_model=schemas.ItemRead)
def atualizar_item(item_id: int, data: schemas.ItemUpdate, db: Session = Depends(get_db)):
    it = crud.atualizar_item(db, item_id, data)
    if not it:
        raise HTTPException(status_code=404, detail="Item não encontrado")
    total_item = float((it.quantidade or 0) * float(it.preco_unitario or 0))
    enviado_em_str = _safe_datetime_str(it.enviado_em)
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
        enviado_em=enviado_em_str,
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
    enviado_em_str = _safe_datetime_str(it.enviado_em)
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
        enviado_em=enviado_em_str,
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
