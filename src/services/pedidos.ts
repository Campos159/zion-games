// src/services/pedidos.ts
import { api } from "./api";

/** Tipos espelhando os DTOs do backend */
export type Status = "PAID" | "PENDING" | "CANCELLED" | "REFUNDED";
export type Plataforma = "PS4" | "PS4s" | "PS5" | "PS5s";

export type PedidoRead = {
  id: number;
  codigo?: string | null;
  status: Status;
  data_criacao: string;      // yyyy-mm-dd
  cliente_nome: string;
  cliente_email: string;
  telefone?: string | null;
  enviado: boolean;
  enviado_em?: string | null;
};

export type PedidoCreate = {
  codigo?: string | null;
  status: Status;
  data_criacao: string;      // yyyy-mm-dd
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
  preco_unitario: number;
  enviado: boolean;
  enviado_em?: string | null;
  total_item: number;        // derivado pelo backend
};

export type ItemCreate = {
  sku?: string | null;
  nome_produto: string;
  plataforma: Plataforma;
  quantidade: number;
  preco_unitario: number;
  enviado?: boolean;
};

export type ItemUpdate = Partial<Omit<ItemCreate, "enviado">> & { enviado?: boolean };

/** -------- Pedidos -------- */
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
  await api.delete<void>(`/pedidos/${id}`);
}

export async function totalDoPedido(id: number): Promise<number> {
  const { data } = await api.get<{ pedido_id: number; total: number }>(`/pedidos/${id}/total`);
  return data.total;
}

/** -------- Itens -------- */
export async function listarItens(pedidoId: number): Promise<ItemRead[]> {
  const { data } = await api.get<ItemRead[]>(`/pedidos/${pedidoId}/itens`);
  return data;
}

export async function criarItem(pedidoId: number, payload: ItemCreate): Promise<ItemRead> {
  const { data } = await api.post<ItemRead>(`/pedidos/${pedidoId}/itens`, payload);
  return data;
}

export async function atualizarItem(itemId: number, payload: ItemUpdate): Promise<ItemRead> {
  const { data } = await api.patch<ItemRead>(`/itens/${itemId}`, payload);
  return data;
}

export async function excluirItem(itemId: number): Promise<void> {
  await api.delete<void>(`/itens/${itemId}`);
}

export async function toggleEnviado(itemId: number): Promise<ItemRead> {
  const { data } = await api.post<ItemRead>(`/itens/${itemId}/toggle-enviado`);
  return data;
}

export interface Item {
  id: number;
  pedido_id: number;
  sku?: string | null;
  nome_produto?: string | null;
  plataforma?: string | null;
  quantidade?: number | null;
  preco_unitario?: number | null;
  email_conta?: string | null;
  senha_conta?: string | null;
  nick_conta?: string | null;
  codigo_ativacao?: string | null;
  enviado?: boolean | null;
  enviado_em?: string | null;
  total_item?: number | null;
}

export interface Pedido {
  id: number;
  codigo?: string | null;       // ID da Yampi
  status?: string | null;       // "forma de pagamento" por enquanto
  data_criacao?: string | null;
  cliente_nome?: string | null;
  cliente_email?: string | null;
  telefone?: string | null;
  total?: number | null;
  enviado?: boolean | null;
  enviado_em?: string | null;
}

export interface PedidoComItens extends Pedido {
  itens: Item[];
}

export interface GrupoPedidos {
  codigo?: string | null;
  total_pedidos: number;
  total_itens: number;
  valor_total: number;
  pedidos: PedidoComItens[];
}

export async function listarGruposPedidos(codigo?: string) {
  const url = codigo ? `/pedidos/grouped?codigo=${encodeURIComponent(codigo)}` : "/pedidos/grouped";
  const { data } = await api.get<GrupoPedidos[]>(url);
  return data;
}