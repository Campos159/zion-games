// src/services/pedidos.ts
import { api } from "./api";

/* ===== Tipos ===== */

export type Plataforma = "PS4" | "PS4s" | "PS5" | "PS5s";
export type Status = "PAID" | "PENDING" | "CANCELLED" | "REFUNDED";

export type PedidoRead = {
  id: number;
  codigo?: string | null;
  status: Status;
  data_criacao: string; // yyyy-mm-dd
  cliente_nome: string;
  cliente_email: string;
  telefone?: string | null;
  enviado: boolean;
  enviado_em?: string | null;
};

export type PedidoCreate = {
  codigo?: string | null;
  status: Status;
  data_criacao: string;
  cliente_nome: string;
  cliente_email: string;
  telefone?: string | null;
};

export type PedidoUpdate = Partial<PedidoCreate>;

export type ItemRead = {
  id: number;
  pedido_id: number;
  sku?: string | null;
  nome_produto: string;
  plataforma: Plataforma;
  quantidade: number;
  // backend pode mandar como number; mas para segurança aceitamos string tb
  preco_unitario: number | string;

  // === CAMPOS DE CREDENCIAIS (precisávamos e não estavam tipados) ===
  email_conta?: string | null;
  senha_conta?: string | null;
  nick_conta?: string | null;
  codigo_ativacao?: string | null;

  enviado: boolean;
  enviado_em?: string | null;

  // derivado pelo backend
  total_item: number;
};

export type ItemCreate = {
  sku?: string | null;
  nome_produto: string;
  plataforma: Plataforma;
  quantidade: number;
  preco_unitario: number;

  email_conta?: string | null;
  senha_conta?: string | null;
  nick_conta?: string | null;
  codigo_ativacao?: string | null;

  enviado?: boolean;
};

export type ItemUpdate = Partial<ItemCreate>;

/* ===== Pedidos ===== */

export async function listarPedidos(): Promise<PedidoRead[]> {
  const { data } = await api.get<PedidoRead[]>("/pedidos");
  return data;
}

export async function criarPedido(payload: PedidoCreate): Promise<PedidoRead> {
  const { data } = await api.post<PedidoRead>("/pedidos", payload);
  return data;
}

export async function atualizarPedido(id: number, payload: PedidoUpdate): Promise<PedidoRead> {
  const { data } = await api.patch<PedidoRead>(`/pedidos/${id}`, payload);
  return data;
}

export async function excluirPedido(id: number): Promise<void> {
  await api.delete(`/pedidos/${id}`);
}

export async function totalDoPedido(id: number): Promise<number> {
  const { data } = await api.get<{ pedido_id: number; total: number }>(`/pedidos/${id}/total`);
  return Number(data.total || 0);
}

/* ===== Itens ===== */

export async function listarItens(pedidoId: number): Promise<ItemRead[]> {
  const { data } = await api.get<ItemRead[]>(`/pedidos/${pedidoId}/itens`);
  // normaliza preco_unitario para number quando vier string
  return data.map(i => ({
    ...i,
    preco_unitario: typeof i.preco_unitario === "string" ? Number(i.preco_unitario) : i.preco_unitario,
  }));
}

export async function criarItem(pedidoId: number, payload: ItemCreate): Promise<ItemRead> {
  const { data } = await api.post<ItemRead>(`/pedidos/${pedidoId}/itens`, payload);
  return {
    ...data,
    preco_unitario: typeof data.preco_unitario === "string" ? Number(data.preco_unitario) : data.preco_unitario,
  };
}

export async function atualizarItem(id: number, payload: ItemUpdate): Promise<ItemRead> {
  const { data } = await api.patch<ItemRead>(`/itens/${id}`, payload);
  return {
    ...data,
    preco_unitario: typeof data.preco_unitario === "string" ? Number(data.preco_unitario) : data.preco_unitario,
  };
}

export async function excluirItem(id: number): Promise<void> {
  await api.delete(`/itens/${id}`);
}

export async function toggleEnviado(id: number): Promise<ItemRead> {
  const { data } = await api.post<ItemRead>(`/itens/${id}/toggle-enviado`);
  return {
    ...data,
    preco_unitario: typeof data.preco_unitario === "string" ? Number(data.preco_unitario) : data.preco_unitario,
  };
}
