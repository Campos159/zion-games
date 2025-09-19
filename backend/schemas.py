# backend/schemas.py
from typing import Optional, List, Literal
from pydantic import BaseModel, EmailStr, Field, conint, confloat

# ----------------------------------------
# Tipos auxiliares
# ----------------------------------------
Plataforma = Literal["PS4", "PS4s", "PS5", "PS5s"]

# ========================================
#                PEDIDOS
# ========================================
class PedidoBase(BaseModel):
    codigo: Optional[str] = None            # ID externo (ex.: Yampi)
    status: str = "PENDING"                 # livre (ex.: forma de pagamento)
    data_criacao: str                       # yyyy-mm-dd
    cliente_nome: str
    cliente_email: EmailStr
    telefone: Optional[str] = None

class PedidoCreate(PedidoBase):
    pass

class PedidoUpdate(BaseModel):
    codigo: Optional[str] = None
    status: Optional[str] = None
    data_criacao: Optional[str] = None
    cliente_nome: Optional[str] = None
    cliente_email: Optional[EmailStr] = None
    telefone: Optional[str] = None

class PedidoRead(PedidoBase):
    id: int
    enviado: bool
    enviado_em: Optional[str] = None

    model_config = {"from_attributes": True}

# ========================================
#                 ITENS
# ========================================
class ItemBase(BaseModel):
    sku: Optional[str] = None
    nome_produto: str
    plataforma: Plataforma
    quantidade: conint(ge=1) = 1
    preco_unitario: confloat(ge=0) = 0

    # credenciais / ativação (por item)
    email_conta: Optional[str] = None
    senha_conta: Optional[str] = None
    nick_conta: Optional[str] = None
    codigo_ativacao: Optional[str] = None

class ItemCreate(ItemBase):
    enviado: bool = False

class ItemUpdate(BaseModel):
    sku: Optional[str] = None
    nome_produto: Optional[str] = None
    plataforma: Optional[Plataforma] = None
    quantidade: Optional[conint(ge=1)] = None
    preco_unitario: Optional[confloat(ge=0)] = None
    email_conta: Optional[str] = None
    senha_conta: Optional[str] = None
    nick_conta: Optional[str] = None
    codigo_ativacao: Optional[str] = None
    enviado: Optional[bool] = None

class ItemRead(ItemBase):
    id: int
    pedido_id: int
    enviado: bool
    enviado_em: Optional[str] = None
    total_item: float = Field(0, description="quantidade * preco_unitario (derivado)")

    model_config = {"from_attributes": True}

# ========================================
#            VENDA (atalho)
#  Cria Pedido + 1 Item em uma chamada
# ========================================
class VendaCreate(BaseModel):
    # cabeçalho do pedido
    codigo: Optional[str] = None
    status: str = "PAID"
    data_criacao: str
    cliente_nome: str
    cliente_email: EmailStr
    telefone: Optional[str] = None

    # item
    sku: Optional[str] = None
    nome_produto: str
    plataforma: Plataforma
    quantidade: conint(ge=1) = 1
    preco_unitario: confloat(ge=0) = 0
    email_conta: Optional[str] = None
    senha_conta: Optional[str] = None
    nick_conta: Optional[str] = None
    codigo_ativacao: Optional[str] = None
    enviado: bool = False

class VendaRead(BaseModel):
    pedido: PedidoRead
    item: ItemRead

# ========================================
#   AGREGAÇÃO POR CÓDIGO (Yampi)
#   /pedidos/agrupados  -> lista grupos
# ========================================
class PedidoReadWithItens(PedidoRead):
    itens: List[ItemRead] = Field(default_factory=list)

class GrupoPedidosRead(BaseModel):
    codigo: Optional[str] = None            # ID externo agrupador
    total_pedidos: int
    total_itens: int
    valor_total: float
    pedidos: List[PedidoReadWithItens]

    model_config = {"from_attributes": True}
