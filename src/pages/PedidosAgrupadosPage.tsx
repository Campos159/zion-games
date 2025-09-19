// src/pages/PedidosAgrupadosPage.tsx
import React, { useEffect, useMemo, useState } from "react";
import { api } from "../services/api";
import { cn } from "../utils/cn";

/** Tipos alinhados ao backend (schemas.GrupoPedidosRead) */
type Plataforma = "PS4" | "PS4s" | "PS5" | "PS5s";

type ItemRead = {
  id: number;
  pedido_id: number;
  sku?: string | null;
  nome_produto: string;
  plataforma: Plataforma;
  quantidade: number;
  preco_unitario: number;
  email_conta?: string | null;
  senha_conta?: string | null;
  nick_conta?: string | null;
  codigo_ativacao?: string | null;
  enviado: boolean;
  enviado_em?: string | null;
  total_item: number; // backend já envia calculado
};

type PedidoReadWithItens = {
  id: number;
  codigo?: string | null; // id da Yampi
  status: string;         // pode ser forma de pagamento, etc
  data_criacao: string;
  cliente_nome: string;
  cliente_email: string;
  telefone?: string | null;
  enviado: boolean;
  enviado_em?: string | null;
  itens: ItemRead[];
};

type GrupoPedidosRead = {
  codigo?: string | null; // id Yampi usado no agrupamento
  total_pedidos: number;
  total_itens: number;
  valor_total: number;
  pedidos: PedidoReadWithItens[];
};

/** Estrutura “flattened” só com entregues (para renderizar) */
type PedidoEntregue = {
  pedido_id: number;
  yampi_codigo?: string | null;
  cliente_nome: string;
  cliente_email: string;
  telefone?: string | null;
  status: string;
  enviado_em?: string | null;
  total: number;
  itens: ItemRead[];
};

const PedidosAgrupadosPage: React.FC = () => {
  const [grupos, setGrupos] = useState<GrupoPedidosRead[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aberto, setAberto] = useState<Record<number, boolean>>({});

  const toggle = (pedidoId: number) =>
    setAberto((prev) => ({ ...prev, [pedidoId]: !prev[pedidoId] }));

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        setErro(null);
        const res = await api.get<GrupoPedidosRead[]>("/pedidos/agrupados");
        setGrupos(res.data);
      } catch (e) {
        console.error(e);
        setErro("Não foi possível carregar os pedidos entregues.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Mantém apenas pedidos com enviado=true e já calcula total por pedido
  const entregues: PedidoEntregue[] = useMemo(() => {
    if (!grupos) return [];
    const out: PedidoEntregue[] = [];
    for (const g of grupos) {
      for (const p of g.pedidos) {
        if (p.enviado) {
          const total =
            p.itens?.reduce((acc, it) => acc + (it.total_item ?? it.quantidade * it.preco_unitario), 0) ?? 0;
          out.push({
            pedido_id: p.id,
            yampi_codigo: p.codigo ?? g.codigo ?? null,
            cliente_nome: p.cliente_nome,
            cliente_email: p.cliente_email,
            telefone: p.telefone,
            status: p.status,
            enviado_em: p.enviado_em ?? undefined,
            total,
            itens: p.itens ?? [],
          });
        }
      }
    }
    // opcional: ordenar do mais novo para o mais antigo pelo id
    out.sort((a, b) => b.pedido_id - a.pedido_id);
    return out;
  }, [grupos]);

  return (
    <div className="max-w-6xl mx-auto p-4">
      <h1 className="text-2xl font-semibold mb-4">Pedidos Entregues</h1>

      {loading && <div>Carregando…</div>}
      {erro && <div className="text-red-600">{erro}</div>}

      {!loading && !erro && (
        <>
          {entregues.length === 0 ? (
            <div className="text-sm text-gray-500">Nenhum pedido entregue encontrado.</div>
          ) : (
            <ul className="space-y-3">
              {entregues.map((p) => {
                const isOpen = !!aberto[p.pedido_id];
                return (
                  <li key={p.pedido_id} className="border rounded-lg bg-white">
                    <button
                      className={cn(
                        "w-full flex items-center justify-between px-4 py-3 text-left",
                        "hover:bg-gray-50"
                      )}
                      onClick={() => toggle(p.pedido_id)}
                      aria-expanded={isOpen}
                    >
                      <div className="min-w-0">
                        <div className="font-medium truncate">
                          Pedido #{p.pedido_id} — {p.cliente_nome}
                          {p.yampi_codigo ? (
                            <span className="ml-2 text-xs rounded-full px-2 py-0.5 bg-blue-100 text-blue-700">
                              Yampi: {p.yampi_codigo}
                            </span>
                          ) : null}
                        </div>
                        <div className="text-xs text-gray-500 truncate">{p.cliente_email}</div>
                      </div>
                      <div className="text-sm font-semibold flex items-center gap-3">
                        <span>Total: R$ {p.total.toFixed(2)}</span>
                        <span
                          className={cn(
                            "inline-block transform transition",
                            isOpen ? "rotate-90" : ""
                          )}
                        >
                          ▶
                        </span>
                      </div>
                    </button>

                    {isOpen && (
                      <div className="px-4 pb-4 space-y-4">
                        {/* Metadados do pedido */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
                          <div>
                            <div className="text-xs text-gray-500">Status / Pagamento</div>
                            <div className="font-medium">{p.status || "-"}</div>
                          </div>
                          <div>
                            <div className="text-xs text-gray-500">Enviado em</div>
                            <div className="font-medium">{p.enviado_em || "-"}</div>
                          </div>
                          <div>
                            <div className="text-xs text-gray-500">Telefone</div>
                            <div className="font-medium">{p.telefone || "-"}</div>
                          </div>
                          <div>
                            <div className="text-xs text-gray-500">E-mail</div>
                            <div className="font-medium break-all">{p.cliente_email}</div>
                          </div>
                        </div>

                        {/* Tabela de itens */}
                        <div className="overflow-x-auto">
                          <table className="min-w-full text-sm">
                            <thead className="text-left bg-gray-50">
                              <tr>
                                <th className="p-2">Jogo</th>
                                <th className="p-2">Plataforma</th>
                                <th className="p-2">Qtd</th>
                                <th className="p-2">Preço Unit.</th>
                                <th className="p-2">Subtotal</th>
                              </tr>
                            </thead>
                            <tbody>
                              {p.itens.map((it) => (
                                <React.Fragment key={it.id}>
                                  <tr className="border-t">
                                    <td className="p-2">{it.nome_produto}</td>
                                    <td className="p-2">{it.plataforma ?? "-"}</td>
                                    <td className="p-2">{it.quantidade}</td>
                                    <td className="p-2">R$ {it.preco_unitario.toFixed(2)}</td>
                                    <td className="p-2">R$ {(it.total_item ?? it.quantidade * it.preco_unitario).toFixed(2)}</td>
                                  </tr>
                                  {/* Linha extra com credenciais/dados enviados */}
                                  {(it.email_conta || it.senha_conta || it.nick_conta || it.codigo_ativacao) && (
                                    <tr className="bg-gray-50/50">
                                      <td colSpan={5} className="p-2">
                                        <div className="grid grid-cols-1 md:grid-cols-4 gap-2 text-xs">
                                          <div>
                                            <div className="text-gray-500">Email conta</div>
                                            <div className="font-medium break-all">{it.email_conta || "-"}</div>
                                          </div>
                                          <div>
                                            <div className="text-gray-500">Senha</div>
                                            <div className="font-medium">{it.senha_conta || "-"}</div>
                                          </div>
                                          <div>
                                            <div className="text-gray-500">Nick</div>
                                            <div className="font-medium">{it.nick_conta || "-"}</div>
                                          </div>
                                          <div>
                                            <div className="text-gray-500">Código de ativação</div>
                                            <div className="font-medium">{it.codigo_ativacao || "-"}</div>
                                          </div>
                                        </div>
                                      </td>
                                    </tr>
                                  )}
                                </React.Fragment>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
};

export default PedidosAgrupadosPage;
