from sqlalchemy import Column, Integer, String, Boolean, Numeric, ForeignKey
from sqlalchemy.orm import relationship
from .database import Base

class Pedido(Base):
    __tablename__ = "pedidos"

    id = Column(Integer, primary_key=True, index=True)
    codigo = Column(String, nullable=True)
    status = Column(String, nullable=False, default="PENDING")  # PAID|PENDING|CANCELLED|REFUNDED
    data_criacao = Column(String, nullable=False)               # yyyy-mm-dd
    cliente_nome = Column(String, nullable=False)
    cliente_email = Column(String, nullable=False)
    telefone = Column(String, nullable=True)
    enviado = Column(Boolean, nullable=False, default=False)
    enviado_em = Column(String, nullable=True)                  # ISO datetime

    itens = relationship("ItemPedido", back_populates="pedido", cascade="all, delete-orphan")

class ItemPedido(Base):
    __tablename__ = "itens_pedido"

    id = Column(Integer, primary_key=True, index=True)
    pedido_id = Column(Integer, ForeignKey("pedidos.id", ondelete="CASCADE"), nullable=False)

    sku = Column(String, nullable=True)
    nome_produto = Column(String, nullable=False)
    plataforma = Column(String, nullable=False)  # PS4|PS4s|PS5|PS5s
    quantidade = Column(Integer, nullable=False, default=1)
    preco_unitario = Column(Numeric(10, 2), nullable=False, default=0)

    # --- campos de "venda" por item (credenciais / ativação) ---
    email_conta = Column(String, nullable=True)
    senha_conta = Column(String, nullable=True)
    nick_conta = Column(String, nullable=True)
    codigo_ativacao = Column(String, nullable=True)

    enviado = Column(Boolean, nullable=False, default=False)
    enviado_em = Column(String, nullable=True)   # ISO datetime

    pedido = relationship("Pedido", back_populates="itens")
