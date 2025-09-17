// src/pages/JogosPage.tsx
import { useEffect, useMemo, useState } from "react";

// ===== Tipos =====
export type Jogo = {
  id: string;            // id interno (não é o COD)
  cod: number;           // gerado automaticamente (sequência ordenada por nome)
  data: string;          // ISO (yyyy-mm-dd)
  jogo: string;          // nome do jogo
  valor: number;         // preço
  // Quantidades por plataforma/slot (0 = não tem)
  ps4: number;           // quantidade PS4 primária
  ps5: number;           // quantidade PS5 primária
  ps4s: number;          // quantidade PS4 secundária
  ps5s: number;          // quantidade PS5 secundária
  email: string;
  nick: string;
  senha: string;
  ativacao: string;
  sku_ps4?: string;
  sku_ps5?: string;
  sku_ps4s?: string;
  sku_ps5s?: string;
};

const STORAGE_KEY = "zion.jogos";

// ===== Helpers =====
function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/**
 * Regra do COD:
 * - Reordena alfabeticamente por "jogo" (case-insensitive)
 * - Reatribui COD sequencial a partir de 1
 */
function recomputarCod(lista: Jogo[]): Jogo[] {
  const ordenada = [...lista].sort((a, b) =>
    a.jogo.localeCompare(b.jogo, "pt-BR", { sensitivity: "base" })
  );
  return ordenada.map((j, idx) => ({ ...j, cod: idx + 1 }));
}

/** Carrega e faz "migração" se algum registro antigo tiver booleanos nas plataformas */
function carregar(): Jogo[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as any[];

    const migrada = parsed.map((j: any) => ({
      ...j,
      ps4: typeof j.ps4 === "boolean" ? (j.ps4 ? 1 : 0) : Number(j.ps4 || 0),
      ps5: typeof j.ps5 === "boolean" ? (j.ps5 ? 1 : 0) : Number(j.ps5 || 0),
      ps4s: typeof j.ps4s === "boolean" ? (j.ps4s ? 1 : 0) : Number(j.ps4s || 0),
      ps5s: typeof j.ps5s === "boolean" ? (j.ps5s ? 1 : 0) : Number(j.ps5s || 0),
      valor: Number(j.valor || 0),
    })) as Jogo[];

    return recomputarCod(migrada);
  } catch {
    return [];
  }
}

function salvar(lista: Jogo[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(lista));
}

// ===== Componente =====
export function JogosPage() {
  const [lista, setLista] = useState<Jogo[]>(() => carregar());
  const [busca, setBusca] = useState("");

  // formulário de novo registro
  const [form, setForm] = useState<Omit<Jogo, "id" | "cod">>({
    data: new Date().toISOString().slice(0, 10),
    jogo: "",
    valor: 0,
    ps4: 0,
    ps5: 0,
    ps4s: 0,
    ps5s: 0,
    email: "",
    nick: "",
    senha: "",
    ativacao: "",
    sku_ps4: "",
    sku_ps5: "",
    sku_ps4s: "",
    sku_ps5s: "",
  });

  // estado de edição inline
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRow, setEditRow] = useState<Omit<Jogo, "cod"> | null>(null);

  useEffect(() => {
    salvar(lista);
  }, [lista]);

  const filtrada = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const base = recomputarCod(lista); // garante CODs atualizados visualmente
    if (!q) return base;
    return base.filter((j) =>
      [
        j.jogo,
        j.email,
        j.nick,
        j.sku_ps4,
        j.sku_ps5,
        j.sku_ps4s,
        j.sku_ps5s,
        j.ativacao,
      ]
        .filter(Boolean)
        .some((x) => String(x).toLowerCase().includes(q))
    );
  }, [lista, busca]);

  // ----- CRUD: criar -----
  function limparForm() {
    setForm({
      data: new Date().toISOString().slice(0, 10),
      jogo: "",
      valor: 0,
      ps4: 0,
      ps5: 0,
      ps4s: 0,
      ps5s: 0,
      email: "",
      nick: "",
      senha: "",
      ativacao: "",
      sku_ps4: "",
      sku_ps5: "",
      sku_ps4s: "",
      sku_ps5s: "",
    });
  }

  function adicionar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!form.jogo.trim()) return;

    const novo: Jogo = {
      id: uid(),
      cod: 0, // temporário; reatribuído pelo recomputarCod
      ...form,
      valor: Number(form.valor) || 0,
      ps4: Number(form.ps4) || 0,
      ps5: Number(form.ps5) || 0,
      ps4s: Number(form.ps4s) || 0,
      ps5s: Number(form.ps5s) || 0,
    };

    const atualizada = recomputarCod([...lista, novo]);
    setLista(atualizada);
    limparForm();
  }

  // ----- CRUD: deletar -----
  function remover(id: string) {
    if (!confirm("Confirma excluir este jogo?")) return;
    const atualizada = recomputarCod(lista.filter((j) => j.id !== id));
    setLista(atualizada);
    if (editingId === id) {
      setEditingId(null);
      setEditRow(null);
    }
  }

  // ----- Edição inline -----
  function iniciarEdicao(j: Jogo) {
    setEditingId(j.id);
    // mantemos o cod fora (ele será recalculado depois ao salvar)
    const { cod, ...resto } = j;
    setEditRow({ ...resto });
  }

  function cancelarEdicao() {
    setEditingId(null);
    setEditRow(null);
  }

  function salvarEdicao() {
    if (!editingId || !editRow) return;

    const normalizada: Jogo = {
      ...editRow,
      id: editingId,
      cod: 0, // será reatribuído
      valor: Number(editRow.valor) || 0,
      ps4: Number((editRow as any).ps4) || 0,
      ps5: Number((editRow as any).ps5) || 0,
      ps4s: Number((editRow as any).ps4s) || 0,
      ps5s: Number((editRow as any).ps5s) || 0,
    };

    const nova = lista.map((j) => (j.id === editingId ? normalizada : j));
    const atualizada = recomputarCod(nova);
    setLista(atualizada);
    setEditingId(null);
    setEditRow(null);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Jogos</h1>
        <p className="text-slate-600 text-sm">
          Cadastre os jogos. O <b>COD</b> é gerado automaticamente conforme a ordem alfabética do campo <b>Jogo</b>.
          Os campos <b>PS4/PS5/PS4s/PS5s</b> representam <b>quantidade</b> (0 = não possui).
        </p>
      </div>

      {/* Busca */}
      <div className="flex flex-col md:flex-row gap-2 md:items-center">
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por nome, e-mail, nick ou SKU..."
          className="flex-1 border rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-brand-100"
        />
        <div className="text-sm text-slate-500">{filtrada.length} registro(s)</div>
      </div>

      {/* Formulário de cadastro */}
      <form
        onSubmit={adicionar}
        className="bg-white rounded-2xl shadow-card border border-slate-100 p-4 space-y-4"
      >
        <div className="grid md:grid-cols-4 gap-3">
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
            <label className="text-sm block mb-1">Valor</label>
            <input
              type="number" step="0.01" min="0"
              value={form.valor}
              onChange={(e) => setForm((f) => ({ ...f, valor: Number(e.target.value) }))}
              className="w-full border rounded-lg px-3 py-2"
            />
          </div>
        </div>

        {/* Quantidades */}
        <div className="grid md:grid-cols-4 gap-3">
          <div>
            <label className="text-sm block mb-1">PS4 (primária) – Qtde</label>
            <input
              type="number" min={0}
              value={form.ps4}
              onChange={(e) => setForm((f) => ({ ...f, ps4: Number(e.target.value) }))}
              className="w-full border rounded-lg px-3 py-2"
              placeholder="0"
            />
          </div>
          <div>
            <label className="text-sm block mb-1">PS5 (primária) – Qtde</label>
            <input
              type="number" min={0}
              value={form.ps5}
              onChange={(e) => setForm((f) => ({ ...f, ps5: Number(e.target.value) }))}
              className="w-full border rounded-lg px-3 py-2"
              placeholder="0"
            />
          </div>
          <div>
            <label className="text-sm block mb-1">PS4s (secundária) – Qtde</label>
            <input
              type="number" min={0}
              value={form.ps4s}
              onChange={(e) => setForm((f) => ({ ...f, ps4s: Number(e.target.value) }))}
              className="w-full border rounded-lg px-3 py-2"
              placeholder="0"
            />
          </div>
          <div>
            <label className="text-sm block mb-1">PS5s (secundária) – Qtde</label>
            <input
              type="number" min={0}
              value={form.ps5s}
              onChange={(e) => setForm((f) => ({ ...f, ps5s: Number(e.target.value) }))}
              className="w-full border rounded-lg px-3 py-2"
              placeholder="0"
            />
          </div>
        </div>

        <div className="grid md:grid-cols-4 gap-3">
          <div>
            <label className="text-sm block mb-1">E-mail (conta)</label>
            <input
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              className="w-full border rounded-lg px-3 py-2"
              placeholder="email@conta.com"
            />
          </div>
          <div>
            <label className="text-sm block mb-1">Nick</label>
            <input
              value={form.nick}
              onChange={(e) => setForm((f) => ({ ...f, nick: e.target.value }))}
              className="w-full border rounded-lg px-3 py-2"
            />
          </div>
          <div>
            <label className="text-sm block mb-1">Senha</label>
            <input
              value={form.senha}
              onChange={(e) => setForm((f) => ({ ...f, senha: e.target.value }))}
              className="w-full border rounded-lg px-3 py-2"
              type="password"
            />
          </div>
          <div>
            <label className="text-sm block mb-1">Ativação</label>
            <input
              value={form.ativacao}
              onChange={(e) => setForm((f) => ({ ...f, ativacao: e.target.value }))}
              className="w-full border rounded-lg px-3 py-2"
              placeholder="Código de ativação"
            />
          </div>
        </div>

        <div className="grid md:grid-cols-4 gap-3">
          <div>
            <label className="text-sm block mb-1">SKU_PS4</label>
            <input
              value={form.sku_ps4}
              onChange={(e) => setForm((f) => ({ ...f, sku_ps4: e.target.value }))}
              className="w-full border rounded-lg px-3 py-2"
            />
          </div>
          <div>
            <label className="text-sm block mb-1">SKU_PS5</label>
            <input
              value={form.sku_ps5}
              onChange={(e) => setForm((f) => ({ ...f, sku_ps5: e.target.value }))}
              className="w-full border rounded-lg px-3 py-2"
            />
          </div>
          <div>
            <label className="text-sm block mb-1">SKU_PS4s</label>
            <input
              value={form.sku_ps4s}
              onChange={(e) => setForm((f) => ({ ...f, sku_ps4s: e.target.value }))}
              className="w-full border rounded-lg px-3 py-2"
            />
          </div>
          <div>
            <label className="text-sm block mb-1">SKU_PS5s</label>
            <input
              value={form.sku_ps5s}
              onChange={(e) => setForm((f) => ({ ...f, sku_ps5s: e.target.value }))}
              className="w-full border rounded-lg px-3 py-2"
            />
          </div>
        </div>

        <div className="flex gap-2">
          <button className="rounded-lg bg-brand-600 text-white px-4 py-2 hover:bg-brand-700 transition">
            Adicionar
          </button>
          <button
            type="button"
            onClick={limparForm}
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
              <th className="text-left px-3 py-2">Data</th>
              <th className="text-left px-3 py-2">Jogo</th>
              <th className="text-right px-3 py-2">Valor</th>
              <th className="text-center px-3 py-2">PS4</th>
              <th className="text-center px-3 py-2">PS5</th>
              <th className="text-center px-3 py-2">PS4s</th>
              <th className="text-center px-3 py-2">PS5s</th>
              <th className="text-left px-3 py-2">Email</th>
              <th className="text-left px-3 py-2">Nick</th>
              <th className="text-left px-3 py-2">Senha</th>
              <th className="text-left px-3 py-2">Ativação</th>
              <th className="text-left px-3 py-2">SKU_PS4</th>
              <th className="text-left px-3 py-2">SKU_PS5</th>
              <th className="text-left px-3 py-2">SKU_PS4s</th>
              <th className="text-left px-3 py-2">SKU_PS5s</th>
              <th className="text-right px-3 py-2">Ações</th>
            </tr>
          </thead>
          <tbody>
            {filtrada.map((j) => {
              const emEdicao = editingId === j.id;
              return (
                <tr key={j.id} className="border-t">
                  <td className="px-3 py-2">{j.cod}</td>
                  <td className="px-3 py-2">
                    {emEdicao ? (
                      <input
                        type="date"
                        value={editRow?.data || ""}
                        onChange={(e) => setEditRow((r) => r ? { ...r, data: e.target.value } : r)}
                        className="border rounded px-2 py-1"
                      />
                    ) : (
                      j.data
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {emEdicao ? (
                      <input
                        value={editRow?.jogo || ""}
                        onChange={(e) => setEditRow((r) => r ? { ...r, jogo: e.target.value } : r)}
                        className="border rounded px-2 py-1 w-56"
                      />
                    ) : (
                      j.jogo
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {emEdicao ? (
                      <input
                        type="number" step="0.01" min="0"
                        value={editRow?.valor ?? 0}
                        onChange={(e) => setEditRow((r) => r ? { ...r, valor: Number(e.target.value) } : r)}
                        className="border rounded px-2 py-1 w-28 text-right"
                      />
                    ) : (
                      j.valor?.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
                    )}
                  </td>
                  {/* Quantidades */}
                  {(["ps4","ps5","ps4s","ps5s"] as const).map((k) => (
                    <td key={k} className="px-3 py-2 text-center">
                      {emEdicao ? (
                        <input
                          type="number" min={0}
                          value={(editRow as any)?.[k] ?? 0}
                          onChange={(e) =>
                            setEditRow((r) =>
                              r ? { ...r, [k]: Number(e.target.value) } as any : r
                            )
                          }
                          className="border rounded px-2 py-1 w-16 text-center"
                        />
                      ) : (
                        (j as any)[k] || 0
                      )}
                    </td>
                  ))}
                  <td className="px-3 py-2">
                    {emEdicao ? (
                      <input
                        value={editRow?.email || ""}
                        onChange={(e) => setEditRow((r) => r ? { ...r, email: e.target.value } : r)}
                        className="border rounded px-2 py-1 w-56"
                      />
                    ) : (
                      j.email
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {emEdicao ? (
                      <input
                        value={editRow?.nick || ""}
                        onChange={(e) => setEditRow((r) => r ? { ...r, nick: e.target.value } : r)}
                        className="border rounded px-2 py-1 w-36"
                      />
                    ) : (
                      j.nick
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {emEdicao ? (
                      <input
                        value={editRow?.senha || ""}
                        onChange={(e) => setEditRow((r) => r ? { ...r, senha: e.target.value } : r)}
                        className="border rounded px-2 py-1 w-36"
                        type="text"
                      />
                    ) : (
                      j.senha
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {emEdicao ? (
                      <input
                        value={editRow?.ativacao || ""}
                        onChange={(e) => setEditRow((r) => r ? { ...r, ativacao: e.target.value } : r)}
                        className="border rounded px-2 py-1 w-44"
                      />
                    ) : (
                      j.ativacao
                    )}
                  </td>
                  {/* SKUs */}
                  {(["sku_ps4","sku_ps5","sku_ps4s","sku_ps5s"] as const).map((k) => (
                    <td key={k} className="px-3 py-2">
                      {emEdicao ? (
                        <input
                          value={(editRow as any)?.[k] || ""}
                          onChange={(e) =>
                            setEditRow((r) => r ? { ...r, [k]: e.target.value } as any : r)
                          }
                          className="border rounded px-2 py-1 w-40"
                        />
                      ) : (
                        (j as any)[k]
                      )}
                    </td>
                  ))}
                  {/* Ações */}
                  <td className="px-3 py-2 text-right">
                    {!emEdicao ? (
                      <div className="flex gap-3 justify-end">
                        <button
                          onClick={() => iniciarEdicao(j)}
                          className="text-brand-700 hover:underline"
                        >
                          Editar
                        </button>
                        <button
                          onClick={() => remover(j.id)}
                          className="text-red-600 hover:underline"
                        >
                          Excluir
                        </button>
                      </div>
                    ) : (
                      <div className="flex gap-3 justify-end">
                        <button
                          onClick={salvarEdicao}
                          className="text-brand-700 hover:underline"
                        >
                          Salvar
                        </button>
                        <button
                          onClick={cancelarEdicao}
                          className="text-slate-600 hover:underline"
                        >
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
                <td colSpan={17} className="px-3 py-6 text-center text-slate-500">
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
