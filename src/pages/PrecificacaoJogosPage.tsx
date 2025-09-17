// src/pages/PrecificacaoJogosPage.tsx
import { useEffect, useMemo, useState } from "react";

/** Modelo de registro de precificação */
export type Precificacao = {
  id: string;
  cod: number;              // gerado por ordem alfabética do Jogo
  jogo: string;             // "Jogo PS4/PS5"
  plataforma: "PS4" | "PS5" | "Ambos";
  valor: number;            // preço de venda
  revenda: number;          // preço para revenda (R$)
  ps4Est: number;           // estoque PS4
  ps5Est: number;           // estoque PS5
  estoqueTotal: number;     // calculado = ps4Est + ps5Est
  totalValor: number;       // calculado = valor * estoqueTotal
  promoInicio?: string;     // yyyy-mm-dd
  promoFim?: string;        // yyyy-mm-dd
  pais: string;
  status: "disponivel" | "esgotado";
  idadeMinima: number;      // idade para comprar
};

const STORAGE_KEY = "zion.precificacao";

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** Ordena por nome do jogo (case-insensitive) e reatribui COD 1..N */
function recomputarCod(lista: Precificacao[]): Precificacao[] {
  const ordenada = [...lista].sort((a, b) =>
    a.jogo.localeCompare(b.jogo, "pt-BR", { sensitivity: "base" })
  );
  return ordenada.map((r, idx) => ({ ...r, cod: idx + 1 }));
}

function carregar(): Precificacao[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Precificacao[];
    return recomputarCod(parsed);
  } catch {
    return [];
  }
}
function salvar(lista: Precificacao[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(lista));
}

/** helpers de formatação */
const fmtBRL = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n || 0);

export function PrecificacaoJogosPage() {
  const [lista, setLista] = useState<Precificacao[]>(() => carregar());
  const [busca, setBusca] = useState("");

  const [form, setForm] = useState<Omit<
    Precificacao,
    "id" | "cod" | "estoqueTotal" | "totalValor"
  >>({
    jogo: "",
    plataforma: "PS4",
    valor: 0,
    revenda: 0,
    ps4Est: 0,
    ps5Est: 0,
    promoInicio: "",
    promoFim: "",
    pais: "Brasil",
    status: "disponivel",
    idadeMinima: 0,
  });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRow, setEditRow] = useState<Omit<Precificacao, "cod" | "estoqueTotal" | "totalValor"> | null>(null);

  useEffect(() => salvar(lista), [lista]);

  const filtrada = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const base = recomputarCod(lista);
    if (!q) return base;
    return base.filter((r) =>
      [r.jogo, r.plataforma, r.pais, r.status].some((x) =>
        String(x).toLowerCase().includes(q)
      )
    );
  }, [lista, busca]);

  // ---- calcular campos derivados
  function derivar(r: Omit<Precificacao, "estoqueTotal" | "totalValor">): Precificacao {
    const estoqueTotal = (r.ps4Est || 0) + (r.ps5Est || 0);
    const totalValor = (r.valor || 0) * estoqueTotal; // total baseado no preço de venda
    return { ...r, estoqueTotal, totalValor };
  }

  // ---- criar
  function adicionar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!form.jogo.trim()) return;

    const novo: Precificacao = derivar({
      id: uid(),
      cod: 0,
      ...form,
    });

    const atualizada = recomputarCod([...lista, novo]);
    setLista(atualizada);
    setForm({
      jogo: "",
      plataforma: "PS4",
      valor: 0,
      revenda: 0,
      ps4Est: 0,
      ps5Est: 0,
      promoInicio: "",
      promoFim: "",
      pais: "Brasil",
      status: "disponivel",
      idadeMinima: 0,
    });
  }

  // ---- deletar
  function remover(id: string) {
    if (!confirm("Confirma excluir este registro?")) return;
    const atualizada = recomputarCod(lista.filter((r) => r.id !== id));
    setLista(atualizada);
    if (editingId === id) {
      setEditingId(null);
      setEditRow(null);
    }
  }

  // ---- editar
  function iniciarEdicao(r: Precificacao) {
    setEditingId(r.id);
    const { cod, estoqueTotal, totalValor, ...resto } = r;
    setEditRow(resto);
  }
  function cancelarEdicao() {
    setEditingId(null);
    setEditRow(null);
  }
  function salvarEdicao() {
    if (!editingId || !editRow) return;
    const normalizada = derivar({ ...editRow, id: editingId, cod: 0 });
    const nova = lista.map((r) => (r.id === editingId ? normalizada : r));
    const atualizada = recomputarCod(nova);
    setLista(atualizada);
    setEditingId(null);
    setEditRow(null);
  }

  // ---- handlers genéricos numéricos
  const setNumForm = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: Number(e.target.value) || 0 }));

  const setNumEdit = (k: keyof NonNullable<typeof editRow>) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setEditRow((r) => (r ? { ...r, [k]: Number(e.target.value) || 0 } : r));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Precificação de Jogos</h1>
        <p className="text-slate-600 text-sm">
          Controle preços (venda e revenda), estoque por plataforma, promoções e status. <b>COD</b> é gerado pela ordem alfabética do <b>Jogo</b>.
        </p>
      </div>

      {/* Busca */}
      <div className="flex flex-col md:flex-row gap-2 md:items-center">
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por jogo, plataforma, país, status..."
          className="flex-1 border rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-brand-100"
        />
        <div className="text-sm text-slate-500">{filtrada.length} registro(s)</div>
      </div>

      {/* Formulário novo registro */}
      <form onSubmit={adicionar} className="bg-white rounded-2xl shadow-card border border-slate-100 p-4 space-y-4">
        <div className="grid md:grid-cols-7 gap-3">
          <div className="md:col-span-2">
            <label className="text-sm block mb-1">Jogo (PS4/PS5)</label>
            <input
              value={form.jogo}
              onChange={(e) => setForm((f) => ({ ...f, jogo: e.target.value }))}
              className="w-full border rounded-lg px-3 py-2"
              placeholder="Nome do jogo"
              required
            />
          </div>
          <div>
            <label className="text-sm block mb-1">Plataforma</label>
            <select
              value={form.plataforma}
              onChange={(e) => setForm((f) => ({ ...f, plataforma: e.target.value as any }))}
              className="w-full border rounded-lg px-3 py-2 bg-white"
            >
              <option value="PS4">PS4</option>
              <option value="PS5">PS5</option>
              <option value="Ambos">Ambos</option>
            </select>
          </div>
          <div>
            <label className="text-sm block mb-1">Valor (R$)</label>
            <input
              type="number"
              step="0.01"
              value={form.valor}
              onChange={setNumForm("valor")}
              className="w-full border rounded-lg px-3 py-2"
              placeholder="0,00"
            />
          </div>
          <div>
            <label className="text-sm block mb-1">Revenda (R$)</label>
            <input
              type="number"
              step="0.01"
              value={form.revenda}
              onChange={setNumForm("revenda")}
              className="w-full border rounded-lg px-3 py-2"
              placeholder="0,00"
            />
          </div>
          <div>
            <label className="text-sm block mb-1">PS4est</label>
            <input type="number" value={form.ps4Est} onChange={setNumForm("ps4Est")}
              className="w-full border rounded-lg px-3 py-2" />
          </div>
          <div>
            <label className="text-sm block mb-1">PS5est</label>
            <input type="number" value={form.ps5Est} onChange={setNumForm("ps5Est")}
              className="w-full border rounded-lg px-3 py-2" />
          </div>
        </div>

        <div className="grid md:grid-cols-6 gap-3">
          <div>
            <label className="text-sm block mb-1">Promoção (início)</label>
            <input type="date" value={form.promoInicio}
              onChange={(e) => setForm((f) => ({ ...f, promoInicio: e.target.value }))}
              className="w-full border rounded-lg px-3 py-2" />
          </div>
          <div>
            <label className="text-sm block mb-1">Promoção (fim)</label>
            <input type="date" value={form.promoFim}
              onChange={(e) => setForm((f) => ({ ...f, promoFim: e.target.value }))}
              className="w-full border rounded-lg px-3 py-2" />
          </div>
          <div>
            <label className="text-sm block mb-1">País</label>
            <input value={form.pais} onChange={(e) => setForm((f) => ({ ...f, pais: e.target.value }))}
              className="w-full border rounded-lg px-3 py-2" placeholder="Brasil" />
          </div>
          <div>
            <label className="text-sm block mb-1">Status</label>
            <select
              value={form.status}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as any }))}
              className="w-full border rounded-lg px-3 py-2 bg-white"
            >
              <option value="disponivel">Disponível</option>
              <option value="esgotado">Esgotado</option>
            </select>
          </div>
          <div>
            <label className="text-sm block mb-1">Idade mínima</label>
            <input type="number" value={form.idadeMinima} onChange={setNumForm("idadeMinima")}
              className="w-full border rounded-lg px-3 py-2" />
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
                jogo: "",
                plataforma: "PS4",
                valor: 0,
                revenda: 0,
                ps4Est: 0,
                ps5Est: 0,
                promoInicio: "",
                promoFim: "",
                pais: "Brasil",
                status: "disponivel",
                idadeMinima: 0,
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
              <th className="text-left px-3 py-2">Jogo</th>
              <th className="text-left px-3 py-2">Plataforma</th>
              <th className="text-right px-3 py-2">Valor</th>
              <th className="text-right px-3 py-2">Revenda</th>
              <th className="text-right px-3 py-2">PS4est</th>
              <th className="text-right px-3 py-2">PS5est</th>
              <th className="text-right px-3 py-2">Estoque(total)</th>
              <th className="text-right px-3 py-2">Total(valor)</th>
              <th className="text-left px-3 py-2">Promoção</th>
              <th className="text-left px-3 py-2">País</th>
              <th className="text-left px-3 py-2">Status</th>
              <th className="text-right px-3 py-2">Idade</th>
              <th className="text-right px-3 py-2">Ações</th>
            </tr>
          </thead>
          <tbody>
            {filtrada.map((r) => {
              const emEdicao = editingId === r.id;
              return (
                <tr key={r.id} className="border-t">
                  <td className="px-3 py-2">{r.cod}</td>
                  <td className="px-3 py-2">
                    {emEdicao ? (
                      <input
                        value={editRow?.jogo || ""}
                        onChange={(e) => setEditRow((x) => (x ? { ...x, jogo: e.target.value } : x))}
                        className="border rounded px-2 py-1 w-56"
                      />
                    ) : (
                      r.jogo
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {emEdicao ? (
                      <select
                        value={editRow?.plataforma || "PS4"}
                        onChange={(e) => setEditRow((x) => (x ? { ...x, plataforma: e.target.value as any } : x))}
                        className="border rounded px-2 py-1 bg-white"
                      >
                        <option value="PS4">PS4</option>
                        <option value="PS5">PS5</option>
                        <option value="Ambos">Ambos</option>
                      </select>
                    ) : (
                      r.plataforma
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {emEdicao ? (
                      <input
                        type="number" step="0.01" value={editRow?.valor ?? 0}
                        onChange={setNumEdit("valor")}
                        className="border rounded px-2 py-1 w-28 text-right"
                      />
                    ) : (
                      fmtBRL(r.valor)
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {emEdicao ? (
                      <input
                        type="number" step="0.01" value={editRow?.revenda ?? 0}
                        onChange={setNumEdit("revenda")}
                        className="border rounded px-2 py-1 w-28 text-right"
                      />
                    ) : (
                      fmtBRL(r.revenda)
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {emEdicao ? (
                      <input type="number" value={editRow?.ps4Est ?? 0} onChange={setNumEdit("ps4Est")}
                        className="border rounded px-2 py-1 w-20 text-right" />
                    ) : (
                      r.ps4Est
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {emEdicao ? (
                      <input type="number" value={editRow?.ps5Est ?? 0} onChange={setNumEdit("ps5Est")}
                        className="border rounded px-2 py-1 w-20 text-right" />
                    ) : (
                      r.ps5Est
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">{r.estoqueTotal}</td>
                  <td className="px-3 py-2 text-right">{fmtBRL(r.totalValor)}</td>
                  <td className="px-3 py-2">
                    {emEdicao ? (
                      <div className="flex gap-1 items-center">
                        <input type="date" value={editRow?.promoInicio || ""} onChange={(e) =>
                          setEditRow((x) => (x ? { ...x, promoInicio: e.target.value } : x))}
                          className="border rounded px-2 py-1" />
                        <span className="text-slate-500">—</span>
                        <input type="date" value={editRow?.promoFim || ""} onChange={(e) =>
                          setEditRow((x) => (x ? { ...x, promoFim: e.target.value } : x))}
                          className="border rounded px-2 py-1" />
                      </div>
                    ) : (
                      r.promoInicio && r.promoFim ? `${r.promoInicio} — ${r.promoFim}` : "—"
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {emEdicao ? (
                      <input
                        value={editRow?.pais || ""}
                        onChange={(e) => setEditRow((x) => (x ? { ...x, pais: e.target.value } : x))}
                        className="border rounded px-2 py-1 w-28"
                      />
                    ) : (
                      r.pais
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {emEdicao ? (
                      <select
                        value={editRow?.status || "disponivel"}
                        onChange={(e) => setEditRow((x) => (x ? { ...x, status: e.target.value as any } : x))}
                        className="border rounded px-2 py-1 bg-white"
                      >
                        <option value="disponivel">Disponível</option>
                        <option value="esgotado">Esgotado</option>
                      </select>
                    ) : (
                      r.status === "disponivel" ? "Disponível" : "Esgotado"
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {emEdicao ? (
                      <input type="number" value={editRow?.idadeMinima ?? 0} onChange={setNumEdit("idadeMinima")}
                        className="border rounded px-2 py-1 w-16 text-right" />
                    ) : (
                      r.idadeMinima
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {!emEdicao ? (
                      <div className="flex gap-3 justify-end">
                        <button onClick={() => iniciarEdicao(r)} className="text-brand-700 hover:underline">
                          Editar
                        </button>
                        <button onClick={() => remover(r.id)} className="text-red-600 hover:underline">
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
                <td colSpan={14} className="px-3 py-6 text-center text-slate-500">
                  Nenhum registro.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
