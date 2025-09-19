# backend/crud.py
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import List, Optional, Tuple

from sqlalchemy.orm import Session, joinedload

from . import models, schemas


# ---------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------
def _now_iso() -> str:
    return datetime.utcnow().isoformat(timespec="seconds")


def _decimal(v) -> Decimal:
    try:
        return Decimal(str(v or 0))
    except Exception:
        return Decimal("0")


def total_do_pedido(db: Session, pedido_id: int) -> Decimal:
    itens = (
        db.query(models.ItemPedido)
        .filter(models.ItemPedido.pedido_id == pedido_id)
        .all()
    )
    total = Decimal("0")
    for i in itens:
        total += _decimal(i.quantidade) * _decimal(i.preco_unitario)
    return total


def recompute_pedido_enviado(db: Session, pedido_id: int) -> None:
    itens = (
        db.query(models.ItemPedido)
        .filter(models.ItemPedido.pedido_id == pedido_id)
        .all()
    )
    p = db.get(models.Pedido, pedido_id)
    if not p:
        return

    if not itens:
        p.enviado = False
        p.enviado_em = None
        return

    all_sent = all(bool(i.enviado) for i in itens)
    if all_sent:
        p.enviado = True
        if not p.enviado_em:
            p.enviado_em = _now_iso()
    else:
        p.enviado = False
        p.enviado_em = None


# ---------------------------------------------------------------------
# Pedidos
# ---------------------------------------------------------------------
def listar_pedidos(db: Session) -> List[models.Pedido]:
    return (
        db.query(models.Pedido)
        .order_by(models.Pedido.data_criacao.desc(), models.Pedido.id.desc())
        .all()
    )


def obter_pedido(db: Session, pedido_id: int) -> Optional[models.Pedido]:
    return db.get(models.Pedido, pedido_id)


def criar_pedido(db: Session, data: schemas.PedidoCreate) -> models.Pedido:
    p = models.Pedido(
        codigo=data.codigo,
        status=data.status,
        data_criacao=data.data_criacao,
        cliente_nome=data.cliente_nome,
        cliente_email=str(data.cliente_email),
        telefone=data.telefone,
        enviado=False,
        enviado_em=None,
    )
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


def atualizar_pedido(
    db: Session, pedido_id: int, data: schemas.PedidoUpdate
) -> Optional[models.Pedido]:
    p = obter_pedido(db, pedido_id)
    if not p:
        return None

    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(p, k, v)

    db.commit()
    db.refresh(p)
    return p


def excluir_pedido(db: Session, pedido_id: int) -> bool:
    p = obter_pedido(db, pedido_id)
    if not p:
        return False
    db.delete(p)
    db.commit()
    return True


# ---------------------------------------------------------------------
# Itens
# ---------------------------------------------------------------------
def listar_itens(db: Session, pedido_id: int) -> List[models.ItemPedido]:
    return (
        db.query(models.ItemPedido)
        .filter(models.ItemPedido.pedido_id == pedido_id)
        .order_by(models.ItemPedido.id.asc())
        .all()
    )


def obter_item(db: Session, item_id: int) -> Optional[models.ItemPedido]:
    return db.get(models.ItemPedido, item_id)


def criar_item(
    db: Session, pedido_id: int, data: schemas.ItemCreate
) -> Optional[models.ItemPedido]:
    if not obter_pedido(db, pedido_id):
        return None

    item = models.ItemPedido(
        pedido_id=pedido_id,
        sku=data.sku,
        nome_produto=data.nome_produto,
        plataforma=data.plataforma,
        quantidade=int(data.quantidade),
        preco_unitario=data.preco_unitario,
        email_conta=data.email_conta,
        senha_conta=data.senha_conta,
        nick_conta=data.nick_conta,
        codigo_ativacao=data.codigo_ativacao,
        enviado=bool(data.enviado),
        enviado_em=_now_iso() if data.enviado else None,
    )
    db.add(item)
    db.commit()
    db.refresh(item)

    recompute_pedido_enviado(db, pedido_id)
    db.commit()
    db.refresh(item)
    return item


def atualizar_item(
    db: Session, item_id: int, data: schemas.ItemUpdate
) -> Optional[models.ItemPedido]:
    item = obter_item(db, item_id)
    if not item:
        return None

    antigo_enviado = bool(item.enviado)

    for k, v in data.model_dump(exclude_unset=True).items():
        setattr(item, k, v)

    if data.enviado is not None:
        if data.enviado and not antigo_enviado:
            item.enviado_em = _now_iso()
        if (not data.enviado) and antigo_enviado:
            item.enviado_em = None

    db.commit()
    db.refresh(item)

    recompute_pedido_enviado(db, item.pedido_id)
    db.commit()
    db.refresh(item)
    return item


def excluir_item(db: Session, item_id: int) -> bool:
    item = obter_item(db, item_id)
    if not item:
        return False
    pedido_id = item.pedido_id
    db.delete(item)
    db.commit()
    recompute_pedido_enviado(db, pedido_id)
    db.commit()
    return True


def toggle_enviado(db: Session, item_id: int) -> Optional[models.ItemPedido]:
    item = obter_item(db, item_id)
    if not item:
        return None
    item.enviado = not bool(item.enviado)
    item.enviado_em = _now_iso() if item.enviado else None
    db.commit()
    db.refresh(item)

    recompute_pedido_enviado(db, item.pedido_id)
    db.commit()
    db.refresh(item)
    return item


# ---------------------------------------------------------------------
# Consultas para "Pedidos Agrupados"
# ---------------------------------------------------------------------
def listar_pedidos_com_itens_por_codigo(
    db: Session, codigo: Optional[str] = None
) -> List[models.Pedido]:
    """
    Retorna pedidos com seus itens (eager load), opcionalmente filtrando por `codigo` (ID Yampi).
    """
    q = db.query(models.Pedido).options(joinedload(models.Pedido.itens))
    if codigo is not None:
        q = q.filter(models.Pedido.codigo == codigo)
    return q.order_by(models.Pedido.codigo.asc(), models.Pedido.id.asc()).all()


def agrupar_pedidos_por_codigo(
    db: Session, codigo: Optional[str] = None
):
    """
    Retorna uma lista de dicionários no formato esperado pelo endpoint /pedidos/agrupados,
    mantendo `pedidos` como **modelos SQLAlchemy** (com itens carregados). Exemplo:

    [
      {
        "codigo": "YAMPI123",
        "total_pedidos": 3,
        "total_itens": 5,
        "valor_total": 299.9,
        "pedidos": [<Pedido>, <Pedido>, ...]   # cada Pedido tem .itens
      },
      ...
    ]
    """
    pedidos = listar_pedidos_com_itens_por_codigo(db, codigo)

    grupos: dict[str, dict] = {}
    for p in pedidos:
        key = p.codigo or "(sem código)"
        if key not in grupos:
            grupos[key] = {
                "codigo": p.codigo,
                "total_pedidos": 0,
                "total_itens": 0,
                "valor_total": Decimal("0"),
                "pedidos": [],
            }

        grp = grupos[key]
        grp["total_pedidos"] += 1

        subtotal_itens = 0
        valor_pedido = Decimal("0")
        for it in (p.itens or []):
            q = _decimal(it.quantidade)
            vu = _decimal(it.preco_unitario)
            subtotal_itens += int(q)
            valor_pedido += q * vu

        grp["total_itens"] += subtotal_itens
        grp["valor_total"] += valor_pedido
        # IMPORTANTE: mantemos o modelo `p` aqui; o endpoint normaliza depois
        grp["pedidos"].append(p)

    # Ordena por código e normaliza os tipos numéricos/decimais
    out: List[dict] = []
    for key in sorted(grupos.keys(), key=lambda s: "" if s is None else str(s)):
        g = grupos[key]
        out.append(
            {
                "codigo": g["codigo"],
                "total_pedidos": int(g["total_pedidos"]),
                "total_itens": int(g["total_itens"]),
                "valor_total": float(g["valor_total"]),
                "pedidos": g["pedidos"],
            }
        )
    return out
