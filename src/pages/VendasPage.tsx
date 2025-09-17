// src/pages/VendasPage.tsx
import { useEffect, useMemo, useState } from "react";

export type Venda = {
  id: string;

  data: string;          // yyyy-mm-dd
  emailConta: string;    // Email (da conta do jogo)
  senha: string;         // Senha (da conta do jogo)
  nick: string;          // Nick

  jogo: string;          // Nome do jogo
  valor: number;         // Valor (R$)
  plataforma: "PS4" | "PS5" | "PS4s" | "PS5s"; // único campo

  cliente: string;       // Nome do cliente
  telefone: string;      // Telefone do cliente
  ativacao: string;      // Código de ativação
  emailCliente: string;  // Endereço de email do cliente
};

const STORAGE_KEY = "zion.vendas";

/** UID simples para localStorage */
function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** Mantém só dígitos */
function soDigitos(v: string) {
  return (v || "").replace(/\D+/g, "");
}

/** Formata telefone dinâmico: (99) 99999-9999 ou (99) 9999-9999 */
function formatTelefone(v: string) {
  const d = soDigitos(v).slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

const fmtBRL = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n || 0);

function carregar(): Venda[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Venda[];
    // ordenar por data desc para exibir recentes primeiro
    return [...parsed].sort((a, b) => b.data.localeCompare(a.data));
  } catch {
    return [];
  }
}
function salvar(lista: Venda[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(lista));
}

export function VendasPage() {
  const [lista, setLista] = useState<Venda[]>(() => carregar());
  const [busca, setBusca] = useState("");

  const [form, setForm] = useState<Venda>({
    id: "",
    data: new Date().toISOString().slice(0, 10),
    emailConta: "",
    senha: "",
    nick: "",
    jogo: "",
    valor: 0,
    plataforma: "PS4",
    cliente: "",
    telefone: "",
    ativacao: "",
    emailCliente: "",
  });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRow, setEditRow] = useState<Venda | null>(null);

  useEffect(() => salvar(lista), [lista]);

  const filtrada = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return lista;
    return lista.filter((v) =>
      [
        v.jogo,
        v.cliente,
        v.emailCliente,
        v.emailConta,
        v.plataforma,
        v.nick,
        v.ativacao,
        v.telefone,
      ]
        .join(" | ")
        .toLowerCase()
        .includes(q)
    );
  }, [lista, busca]);

  // ------ criar
  function adicionar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!form.jogo.trim() || !form.cliente.trim()) return;

    const novo: Venda = {
      ...form,
      id: uid(),
      telefone: formatTelefone(form.telefone),
    };

    const novaLista = [novo, ...lista]; // adiciona no topo
    setLista(novaLista);
    setForm({
      id: "",
      data: new Date().toISOString().slice(0, 10),
      emailConta: "",
      senha: "",
      nick: "",
      jogo: "",
      valor: 0,
      plataforma: "PS4",
      cliente: "",
      telefone: "",
      ativacao: "",
      emailCliente: "",
    });
  }

  // ------ remover
  function remover(id: string) {
    if (!confirm("Confirma excluir esta venda?")) return;
    setLista((l) => l.filter((v) => v.id !== id));
    if (editingId === id) {
      setEditingId(null);
      setEditRow(null);
    }
  }

  // ------ editar
  function iniciarEdicao(v: Venda) {
    setEditingId(v.id);
    setEditRow({ ...v });
  }
  function cancelarEdicao() {
    setEditingId(null);
    setEditRow(null);
  }
  function salvarEdicao() {
    if (!editingId || !editRow) return;
    const normalizada: Venda = { ...editRow, telefone: formatTelefone(editRow.telefone) };
    setLista((l) => l.map((v) => (v.id === editingId ? normalizada : v)));
    setEditingId(null);
    setEditRow(null);
  }

  // handlers numéricos
  const setNumForm = (k: keyof Venda) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: Number(e.target.value) || 0 }));

  const setNumEdit = (k: keyof Venda) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setEditRow((r) => (r ? { ...r, [k]: Number(e.target.value) || 0 } : r));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Vendas</h1>
        <p className="text-slate-600 text-sm">
          Registre as vendas com dados do jogo, conta e cliente. A plataforma é selecionada em um único campo.
        </p>
      </div>

      {/* Busca */}
      <div className="flex flex-col md:flex-row gap-2 md:items-center">
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por jogo, cliente, e-mail, nick, plataforma..."
          className="flex-1 border rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-brand-100"
        />
        <div className="text-sm text-slate-500">{filtrada.length} registro(s)</div>
      </div>

      {/* Formulário nova venda */}
      <form onSubmit={adicionar} className="bg-white rounded-2xl shadow-card border border-slate-100 p-4 space-y-4">
        <div className="grid md:grid-cols-6 gap-3">
          <div>
            <label className="text-sm block mb-1">Data</label>
            <input
              type="date"
              value={form.data}
              onChange={(e) => setForm((f) => ({ ...f, data: e.target.value }))}
              className="w-full border rounded-lg px-3 py-2"
              required
            />
          </div>
          <div className="md:col-span-2">
            <label className="text-sm block mb-1">Email (conta do jogo)</label>
            <input
              type="email"
              value={form.emailConta}
              onChange={(e) => setForm((f) => ({ ...f, emailConta: e.target.value }))}
              className="w-full border rounded-lg px-3 py-2"
              placeholder="conta@exemplo.com"
            />
          </div>
          <div>
            <label className="text-sm block mb-1">Senha</label>
            <input
              value={form.senha}
              onChange={(e) => setForm((f) => ({ ...f, senha: e.target.value }))}
              className="w-full border rounded-lg px-3 py-2"
              placeholder="••••••••"
            />
          </div>
          <div>
            <label className="text-sm block mb-1">Nick</label>
            <input
              value={form.nick}
              onChange={(e) => setForm((f) => ({ ...f, nick: e.target.value }))}
              className="w-full border rounded-lg px-3 py-2"
              placeholder="Apelido da conta"
            />
          </div>
          <div className="md:col-span-2">
            <label className="text-sm block mb-1">Jogo</label>
            <input
              value={form.jogo}
              onChange={(e) => setForm((f) => ({ ...f, jogo: e.target.value }))}
              className="w-full border rounded-lg px-3 py-2"
              placeholder="Nome do jogo"
              required
            />
          </div>
          <div>
            <label className="text-sm block mb-1">Valor (R$)</label>
            <input
              type="number" step="0.01"
              value={form.valor}
              onChange={setNumForm("valor")}
              className="w-full border rounded-lg px-3 py-2"
              placeholder="0,00"
            />
          </div>
          <div>
            <label className="text-sm block mb-1">Plataforma</label>
            <select
              value={form.plataforma}
              onChange={(e) => setForm((f) => ({ ...f, plataforma: e.target.value as any }))}
              className="w-full border rounded-lg px-3 py-2 bg-white"
            >
              <option value="PS4">PS4 (primária)</option>
              <option value="PS4s">PS4s (secundária)</option>
              <option value="PS5">PS5 (primária)</option>
              <option value="PS5s">PS5s (secundária)</option>
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="text-sm block mb-1">Cliente</label>
            <input
              value={form.cliente}
              onChange={(e) => setForm((f) => ({ ...f, cliente: e.target.value }))}
              className="w-full border rounded-lg px-3 py-2"
              placeholder="Nome do cliente"
              required
            />
          </div>
          <div>
            <label className="text-sm block mb-1">Telefone</label>
            <input
              value={form.telefone}
              onChange={(e) => setForm((f) => ({ ...f, telefone: formatTelefone(e.target.value) }))}
              className="w-full border rounded-lg px-3 py-2"
              placeholder="(11) 98888-7777"
              inputMode="numeric"
            />
          </div>
          <div>
            <label className="text-sm block mb-1">Ativação</label>
            <input
              value={form.ativacao}
              onChange={(e) => setForm((f) => ({ ...f, ativacao: e.target.value }))}
              className="w-full border rounded-lg px-3 py-2"
              placeholder="Código / instruções"
            />
          </div>
          <div className="md:col-span-2">
            <label className="text-sm block mb-1">Endereço de Email (cliente)</label>
            <input
              type="email"
              value={form.emailCliente}
              onChange={(e) => setForm((f) => ({ ...f, emailCliente: e.target.value }))}
              className="w-full border rounded-lg px-3 py-2"
              placeholder="cliente@exemplo.com"
            />
          </div>
        </div>

        <div className="flex gap-2">
          <button className="rounded-lg bg-brand-600 text-white px-4 py-2 hover:bg-brand-700 transition">
            Adicionar venda
          </button>
          <button
            type="button"
            onClick={() =>
              setForm({
                id: "",
                data: new Date().toISOString().slice(0, 10),
                emailConta: "",
                senha: "",
                nick: "",
                jogo: "",
                valor: 0,
                plataforma: "PS4",
                cliente: "",
                telefone: "",
                ativacao: "",
                emailCliente: "",
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
              <th className="text-left px-3 py-2">Data</th>
              <th className="text-left px-3 py-2">Jogo</th>
              <th className="text-left px-3 py-2">Plataforma</th>
              <th className="text-right px-3 py-2">Valor</th>
              <th className="text-left px-3 py-2">Email (conta)</th>
              <th className="text-left px-3 py-2">Nick</th>
              <th className="text-left px-3 py-2">Cliente</th>
              <th className="text-left px-3 py-2">Telefone</th>
              <th className="text-left px-3 py-2">Ativação</th>
              <th className="text-left px-3 py-2">Email (cliente)</th>
              <th className="text-right px-3 py-2">Ações</th>
            </tr>
          </thead>
          <tbody>
            {filtrada.map((v) => {
              const emEdicao = editingId === v.id;
              return (
                <tr key={v.id} className="border-t">
                  <td className="px-3 py-2">
                    {emEdicao ? (
                      <input
                        type="date"
                        value={editRow?.data || ""}
                        onChange={(e) => setEditRow((r) => (r ? { ...r, data: e.target.value } : r))}
                        className="border rounded px-2 py-1"
                      />
                    ) : (
                      v.data
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {emEdicao ? (
                      <input
                        value={editRow?.jogo || ""}
                        onChange={(e) => setEditRow((r) => (r ? { ...r, jogo: e.target.value } : r))}
                        className="border rounded px-2 py-1 w-56"
                      />
                    ) : (
                      v.jogo
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {emEdicao ? (
                      <select
                        value={editRow?.plataforma || "PS4"}
                        onChange={(e) => setEditRow((r) => (r ? { ...r, plataforma: e.target.value as any } : r))}
                        className="border rounded px-2 py-1 bg-white"
                      >
                        <option value="PS4">PS4 (primária)</option>
                        <option value="PS4s">PS4s (secundária)</option>
                        <option value="PS5">PS5 (primária)</option>
                        <option value="PS5s">PS5s (secundária)</option>
                      </select>
                    ) : (
                      v.plataforma
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {emEdicao ? (
                      <input
                        type="number" step="0.01"
                        value={editRow?.valor ?? 0}
                        onChange={setNumEdit("valor")}
                        className="border rounded px-2 py-1 w-24 text-right"
                      />
                    ) : (
                      fmtBRL(v.valor)
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {emEdicao ? (
                      <input
                        type="email"
                        value={editRow?.emailConta || ""}
                        onChange={(e) => setEditRow((r) => (r ? { ...r, emailConta: e.target.value } : r))}
                        className="border rounded px-2 py-1 w-56"
                      />
                    ) : (
                      v.emailConta
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {emEdicao ? (
                      <input
                        value={editRow?.nick || ""}
                        onChange={(e) => setEditRow((r) => (r ? { ...r, nick: e.target.value } : r))}
                        className="border rounded px-2 py-1 w-40"
                      />
                    ) : (
                      v.nick
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {emEdicao ? (
                      <input
                        value={editRow?.cliente || ""}
                        onChange={(e) => setEditRow((r) => (r ? { ...r, cliente: e.target.value } : r))}
                        className="border rounded px-2 py-1 w-48"
                      />
                    ) : (
                      v.cliente
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {emEdicao ? (
                      <input
                        value={editRow?.telefone || ""}
                        onChange={(e) =>
                          setEditRow((r) => (r ? { ...r, telefone: formatTelefone(e.target.value) } : r))
                        }
                        className="border rounded px-2 py-1 w-40"
                        inputMode="numeric"
                      />
                    ) : (
                      v.telefone
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {emEdicao ? (
                      <input
                        value={editRow?.ativacao || ""}
                        onChange={(e) => setEditRow((r) => (r ? { ...r, ativacao: e.target.value } : r))}
                        className="border rounded px-2 py-1 w-56"
                      />
                    ) : (
                      v.ativacao
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {emEdicao ? (
                      <input
                        type="email"
                        value={editRow?.emailCliente || ""}
                        onChange={(e) => setEditRow((r) => (r ? { ...r, emailCliente: e.target.value } : r))}
                        className="border rounded px-2 py-1 w-56"
                      />
                    ) : (
                      v.emailCliente
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {!emEdicao ? (
                      <div className="flex gap-3 justify-end">
                        <button
                          onClick={() => iniciarEdicao(v)}
                          className="text-brand-700 hover:underline"
                        >
                          Editar
                        </button>
                        <button
                          onClick={() => remover(v.id)}
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
                <td colSpan={11} className="px-3 py-6 text-center text-slate-500">
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
