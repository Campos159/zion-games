// src/pages/ClientesPage.tsx
import { useEffect, useMemo, useState } from "react";
import {
  listarPedidos,
  listarItens,
  type PedidoRead,
  type ItemRead,
} from "../services/pedidos";

export type Cliente = {
  id: string;
  cod: number;
  nome: string;
  telefone: string;
  data: string;
  email: string;
};

const STORAGE_KEY = "zion.clientes";

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** Recalcula COD pela ordem alfabética do Nome (1..N) */
function recomputarCod(lista: Cliente[]): Cliente[] {
  const ordenada = [...lista].sort((a, b) =>
    a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" })
  );
  return ordenada.map((c, idx) => ({ ...c, cod: idx + 1 }));
}

function carregar(): Cliente[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Cliente[];
    return recomputarCod(parsed);
  } catch {
    return [];
  }
}

function salvar(lista: Cliente[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(lista));
}

/** Mantém só dígitos */
function soDigitos(v: string) {
  return (v || "").replace(/\D+/g, "");
}

/** Formata telefone dinâmico: (99) 99999-9999 ou (99) 9999-9999 */
function formatTelefone(v: string) {
  const d = soDigitos(v).slice(0, 11); // máximo 11 dígitos
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  // 11 dígitos: (99) 99999-9999
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

type Compra = {
  pedidoId: number;
  pedidoCodigo?: string | null;
  dataPedido: string; // yyyy-mm-dd
  item: ItemRead;
};

export function ClientesPage() {
  const [lista, setLista] = useState<Cliente[]>(() => carregar());
  const [busca, setBusca] = useState("");

  const [form, setForm] = useState<Omit<Cliente, "id" | "cod">>({
    nome: "",
    telefone: "",
    data: new Date().toISOString().slice(0, 10),
    email: "",
  });

  // edição inline
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRow, setEditRow] = useState<Omit<Cliente, "cod"> | null>(null);

  useEffect(() => salvar(lista), [lista]);

  // escuta refresh de outras telas e o evento 'storage'
  useEffect(() => {
    const refresh = () => setLista(carregar());

    window.addEventListener("zion.clientes:refresh", refresh);

    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) refresh();
    };
    window.addEventListener("storage", onStorage);

    return () => {
      window.removeEventListener("zion.clientes:refresh", refresh);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const filtrada = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const base = recomputarCod(lista); // garante COD atualizado na visão
    if (!q) return base;
    return base.filter((c) =>
      [c.nome, c.telefone, c.email].some((x) => x?.toLowerCase().includes(q))
    );
  }, [lista, busca]);

  // ---- criar
  function adicionar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!form.nome.trim()) return;

    const novo: Cliente = {
      id: uid(),
      cod: 0,
      ...form,
      telefone: formatTelefone(form.telefone),
    };

    const atualizada = recomputarCod([...lista, novo]);
    setLista(atualizada);
    setForm({
      nome: "",
      telefone: "",
      data: new Date().toISOString().slice(0, 10),
      email: "",
    });
  }

  // ---- deletar
  function remover(id: string) {
    if (!confirm("Confirma excluir este cliente?")) return;
    const atualizada = recomputarCod(lista.filter((c) => c.id !== id));
    setLista(atualizada);
    if (editingId === id) {
      setEditingId(null);
      setEditRow(null);
    }
  }

  // ---- edição inline
  function iniciarEdicao(c: Cliente) {
    setEditingId(c.id);
    const { cod, ...resto } = c;
    setEditRow({ ...resto });
  }
  function cancelarEdicao() {
    setEditingId(null);
    setEditRow(null);
  }
  function salvarEdicao() {
    if (!editingId || !editRow) return;

    const normalizada: Cliente = {
      ...editRow,
      id: editingId,
      cod: 0,
      telefone: formatTelefone(editRow.telefone),
    };

    const nova = lista.map((c) => (c.id === editingId ? normalizada : c));
    const atualizada = recomputarCod(nova);
    setLista(atualizada);
    setEditingId(null);
    setEditRow(null);
  }

  // ---- handlers formatados
  function onChangeTelefoneForm(e: React.ChangeEvent<HTMLInputElement>) {
    const value = formatTelefone(e.target.value);
    setForm((f) => ({ ...f, telefone: value }));
  }
  function onChangeTelefoneEdit(e: React.ChangeEvent<HTMLInputElement>) {
    const value = formatTelefone(e.target.value);
    setEditRow((r) => (r ? { ...r, telefone: value } : r));
  }

  // ========= HISTÓRICO (MODAL) =========
  const [historicoOpen, setHistoricoOpen] = useState(false);
  const [clienteSel, setClienteSel] = useState<Cliente | null>(null);
  const [compras, setCompras] = useState<Compra[]>([]);
  const [loadingCompras, setLoadingCompras] = useState(false);
  const [erroCompras, setErroCompras] = useState<string | null>(null);
  const [itemAbertoId, setItemAbertoId] = useState<number | null>(null);

  function normalizaEmail(s: string) {
    return (s || "").trim().toLowerCase();
  }

  async function abrirHistorico(c: Cliente) {
    setClienteSel(c);
    setHistoricoOpen(true);
    setCompras([]);
    setErroCompras(null);
    setItemAbertoId(null);

    try {
      setLoadingCompras(true);
      const allPedidos: PedidoRead[] = await listarPedidos();

      const alvoEmail = normalizaEmail(c.email);
      const alvoNome = (c.nome || "").trim().toLowerCase();

      const pedidosDoCliente = allPedidos.filter((p) => {
        const pe = normalizaEmail(p.cliente_email || "");
        const pn = (p.cliente_nome || "").trim().toLowerCase();

        // prioridade: e-mail; fallback: nome (quando não houver e-mail salvo)
        return (alvoEmail && pe === alvoEmail) || (!alvoEmail && pn === alvoNome);
      });

      // Busca itens de cada pedido
      const entradas: Compra[] = [];
      for (const p of pedidosDoCliente) {
        const items = await listarItens(p.id);
        for (const it of items) {
          entradas.push({
            pedidoId: p.id,
            pedidoCodigo: p.codigo ?? null,
            dataPedido: p.data_criacao,
            item: it,
          });
        }
      }

      // ordena por data do pedido (desc) e depois pelo id do item
      entradas.sort((a, b) => {
        if (a.dataPedido === b.dataPedido) return a.item.id - b.item.id;
        return a.dataPedido < b.dataPedido ? 1 : -1;
      });

      setCompras(entradas);
    } catch (e: any) {
      setErroCompras("Falha ao carregar histórico do cliente.");
    } finally {
      setLoadingCompras(false);
    }
  }

  function fecharHistorico() {
    setHistoricoOpen(false);
    setClienteSel(null);
    setCompras([]);
    setItemAbertoId(null);
    setErroCompras(null);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Clientes</h1>
        <p className="text-slate-600 text-sm">
          Gerencie clientes. O <b>COD</b> é gerado automaticamente pela ordem alfabética do <b>Nome</b>.
        </p>
      </div>

      {/* Busca */}
      <div className="flex flex-col md:flex-row gap-2 md:items-center">
        <input
          value={busca}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setBusca(e.target.value)}
          placeholder="Buscar por nome, telefone ou e-mail..."
          className="flex-1 border rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-brand-100"
        />
        <div className="text-sm text-slate-500">{filtrada.length} registro(s)</div>
      </div>

      {/* Formulário novo cliente */}
      <form onSubmit={adicionar} className="bg-white rounded-2xl shadow-card border border-slate-100 p-4 space-y-4">
        <div className="grid md:grid-cols-4 gap-3">
          <div className="md:col-span-2">
            <label className="text-sm block mb-1">Nome</label>
            <input
              value={form.nome}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setForm((f) => ({ ...f, nome: e.target.value }))
              }
              className="w-full border rounded-lg px-3 py-2"
              placeholder="Nome completo"
              required
            />
          </div>
          <div>
            <label className="text-sm block mb-1">Telefone</label>
            <input
              value={form.telefone}
              onChange={onChangeTelefoneForm}
              className="w-full border rounded-lg px-3 py-2"
              placeholder="(11) 98888-7777"
              inputMode="numeric"
            />
          </div>
          <div>
            <label className="text-sm block mb-1">Data</label>
            <input
              type="date"
              value={form.data}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setForm((f) => ({ ...f, data: e.target.value }))
              }
              className="w-full border rounded-lg px-3 py-2"
              required
            />
          </div>
        </div>

        <div className="grid md:grid-cols-4 gap-3">
          <div className="md:col-span-2">
            <label className="text-sm block mb-1">Endereço de e-mail</label>
            <input
              type="email"
              value={form.email}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setForm((f) => ({ ...f, email: e.target.value }))
              }
              className="w-full border rounded-lg px-3 py-2"
              placeholder="cliente@exemplo.com"
            />
          </div>
        </div>

        <div className="flex gap-2">
          <button className="rounded-lg bg-brand-600 text-white px-4 py-2 hover:bg-brand-700 transition">
            Adicionar
          </button>
          <button
            type="button"
            onClick={() =>
              setForm({
                nome: "",
                telefone: "",
                data: new Date().toISOString().slice(0, 10),
                email: "",
              })
            }
            className="rounded-lg border px-4 py-2 hover:bg-slate-50"
          >
            Limpar
          </button>
        </div>
      </form>

      {/* Tabela */}
      <div className="bg-white rounded-2xl shadow-card border border-slate-100 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-slate-700">
            <tr>
              <th className="text-left px-3 py-2">COD</th>
              <th className="text-left px-3 py-2">Nome</th>
              <th className="text-left px-3 py-2">Telefone</th>
              <th className="text-left px-3 py-2">Data</th>
              <th className="text-left px-3 py-2">E-mail</th>
              <th className="text-right px-3 py-2">Ações</th>
            </tr>
          </thead>
          <tbody>
            {filtrada.map((c) => {
              const emEdicao = editingId === c.id;
              return (
                <tr key={c.id} className="border-t">
                  <td className="px-3 py-2">{c.cod}</td>
                  <td className="px-3 py-2">
                    {emEdicao ? (
                      <input
                        value={editRow?.nome || ""}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                          setEditRow((r) => (r ? { ...r, nome: e.target.value } : r))
                        }
                        className="border rounded px-2 py-1 w-56"
                      />
                    ) : (
                      c.nome
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {emEdicao ? (
                      <input
                        value={editRow?.telefone || ""}
                        onChange={onChangeTelefoneEdit}
                        className="border rounded px-2 py-1 w-40"
                        inputMode="numeric"
                      />
                    ) : (
                      c.telefone
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {emEdicao ? (
                      <input
                        type="date"
                        value={editRow?.data || ""}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                          setEditRow((r) => (r ? { ...r, data: e.target.value } : r))
                        }
                        className="border rounded px-2 py-1"
                      />
                    ) : (
                      c.data
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {emEdicao ? (
                      <input
                        type="email"
                        value={editRow?.email || ""}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                          setEditRow((r) => (r ? { ...r, email: e.target.value } : r))
                        }
                        className="border rounded px-2 py-1 w-64"
                      />
                    ) : (
                      c.email
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {!emEdicao ? (
                      <div className="flex gap-3 justify-end">
                        <button
                          onClick={() => abrirHistorico(c)}
                          className="text-brand-700 hover:underline"
                        >
                          Histórico
                        </button>
                        <button
                          onClick={() => iniciarEdicao(c)}
                          className="text-brand-700 hover:underline"
                        >
                          Editar
                        </button>
                        <button
                          onClick={() => remover(c.id)}
                          className="text-red-600 hover:underline"
                        >
                          Excluir
                        </button>
                      </div>
                    ) : (
                      <div className="flex gap-3 justify-end">
                        <button onClick={salvarEdicao} className="text-brand-700 hover:underline">
                          Salvar
                        </button>
                        <button onClick={cancelarEdicao} className="text-slate-600 hover:underline">
                          Cancelar
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {filtrada.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                  Nenhum registro.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ===== Modal Histórico ===== */}
      {historicoOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* backdrop */}
          <div
            className="absolute inset-0 bg-black/40"
            onClick={fecharHistorico}
          />
          {/* card */}
          <div className="relative bg-white rounded-2xl shadow-xl border border-slate-200 w-[95vw] max-w-4xl max-h-[85vh] overflow-hidden">
            <div className="p-4 border-b flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-slate-900">
                  Histórico de compras — {clienteSel?.nome}
                </h3>
                <p className="text-sm text-slate-600">
                  {clienteSel?.email || "sem e-mail"} • {clienteSel?.telefone || "sem telefone"}
                </p>
              </div>
              <button
                onClick={fecharHistorico}
                className="rounded-lg border px-3 py-1.5 text-sm hover:bg-slate-50"
              >
                Fechar
              </button>
            </div>

            <div className="p-4 overflow-auto max-h-[70vh]">
              {loadingCompras && (
                <div className="text-sm text-slate-600">Carregando histórico…</div>
              )}

              {erroCompras && (
                <div className="text-sm text-red-600">{erroCompras}</div>
              )}

              {!loadingCompras && !erroCompras && compras.length === 0 && (
                <div className="text-sm text-slate-600">Nenhum jogo encontrado para este cliente.</div>
              )}

              {!loadingCompras && compras.length > 0 && (
                <div className="space-y-2">
                  {compras.map((c) => {
                    const aberto = itemAbertoId === c.item.id;
                    return (
                      <div key={`${c.pedidoId}-${c.item.id}`} className="border rounded-lg">
                        <button
                          onClick={() => setItemAbertoId((id) => (id === c.item.id ? null : c.item.id))}
                          className="w-full text-left px-3 py-2 flex items-center justify-between hover:bg-slate-50"
                        >
                          <div className="flex flex-col">
                            <span className="font-medium text-slate-900">
                              {c.item.nome_produto} <span className="text-slate-500">({c.item.plataforma})</span>
                            </span>
                            <span className="text-xs text-slate-600">
                              Pedido #{c.pedidoCodigo || c.pedidoId} • {c.dataPedido}
                            </span>
                          </div>
                          <span className="text-xs text-slate-600">
                            {aberto ? "Ocultar" : "Ver detalhes"}
                          </span>
                        </button>

                        {aberto && (
                          <div className="px-3 pb-3">
                            <div className="grid sm:grid-cols-2 gap-3 text-sm">
                              <div>
                                <div className="text-slate-500">E-mail/Usuário</div>
                                <div className="font-medium break-all">{c.item.email_conta || "—"}</div>
                              </div>
                              <div>
                                <div className="text-slate-500">Senha</div>
                                <div className="font-medium">{c.item.senha_conta || "—"}</div>
                              </div>
                              <div>
                                <div className="text-slate-500">Nick</div>
                                <div className="font-medium">{c.item.nick_conta || "—"}</div>
                              </div>
                              <div>
                                <div className="text-slate-500">Código de ativação</div>
                                <div className="font-medium">{c.item.codigo_ativacao || "—"}</div>
                              </div>
                              <div>
                                <div className="text-slate-500">Quantidade</div>
                                <div className="font-medium">{c.item.quantidade}</div>
                              </div>
                              <div>
                                <div className="text-slate-500">Enviado</div>
                                <div className="font-medium">{c.item.enviado ? "Sim" : "Não"}</div>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
