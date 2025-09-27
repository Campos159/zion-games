// src/pages/JogosPage.tsx
import { useEffect, useMemo, useState } from "react";

/* ============================================================
   Tipos e constantes
   ============================================================ */
export type Midia = "PRIMARIA" | "SECUNDARIA";

export type ContaJogo = {
  id: string;
  email: string;
  nick: string;
  senha: string;
  ativacao: string;
  midia: Midia; // PRIMARIA | SECUNDARIA
};

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

  // coleção de contas por jogo
  contas?: ContaJogo[];

  // SKUs por slot
  sku_ps4?: string;
  sku_ps5?: string;
  sku_ps4s?: string;
  sku_ps5s?: string;

  // LEGADO: mantidos apenas para migração/criação inicial
  email?: string;
  nick?: string;
  senha?: string;
  ativacao?: string;
};

export type PlataformaKey = "ps4" | "ps5" | "ps4s" | "ps5s";

export const JOGOS_STORAGE_KEY = "zion.jogos";

/* ============================================================
   Helpers compartilhados (exportados para outras telas)
   ============================================================ */

/** Normaliza SKU: trim + sem espaços internos */
export function normalizeSku(s: string | undefined | null): string {
  return (s ?? "").toString().trim().replace(/\s+/g, "");
}

/** Reatribui COD ordenando por nome do jogo */
function recomputarCod(lista: Jogo[]): Jogo[] {
  const ordenada = [...lista].sort((a, b) =>
    a.jogo.localeCompare(b.jogo, "pt-BR", { sensitivity: "base" })
  );
  return ordenada.map((j, idx) => ({ ...j, cod: idx + 1 }));
}

/** Gera um id simples */
function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** Lê e migra jogos do localStorage (inclui migração para `contas`) */
export function getJogosFromStorage(): Jogo[] {
  try {
    const raw = localStorage.getItem(JOGOS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as any[];

    const migrada = parsed.map((j: any) => {
      // migração de quantidades e skus
      const base: Jogo = {
        ...j,
        ps4: typeof j.ps4 === "boolean" ? (j.ps4 ? 1 : 0) : Number(j.ps4 || 0),
        ps5: typeof j.ps5 === "boolean" ? (j.ps5 ? 1 : 0) : Number(j.ps5 || 0),
        ps4s: typeof j.ps4s === "boolean" ? (j.ps4s ? 1 : 0) : Number(j.ps4s || 0),
        ps5s: typeof j.ps5s === "boolean" ? (j.ps5s ? 1 : 0) : Number(j.ps5s || 0),
        valor: Number(j.valor || 0),
        sku_ps4: normalizeSku(j.sku_ps4),
        sku_ps5: normalizeSku(j.sku_ps5),
        sku_ps4s: normalizeSku(j.sku_ps4s),
        sku_ps5s: normalizeSku(j.sku_ps5s),
      };

      // migração das credenciais legadas (email/nick/senha/ativacao) para contas[0]
      const jaTemContas = Array.isArray(j.contas);
      const temLegado =
        (j.email && String(j.email).trim()) ||
        (j.nick && String(j.nick).trim()) ||
        (j.senha && String(j.senha).trim()) ||
        (j.ativacao && String(j.ativacao).trim());

      if (!jaTemContas && temLegado) {
        const conta: ContaJogo = {
          id: uid(),
          email: String(j.email || ""),
          nick: String(j.nick || ""),
          senha: String(j.senha || ""),
          ativacao: String(j.ativacao || ""),
          // heurística simples para midia inicial
          midia:
            (Number(j.ps4 || 0) + Number(j.ps5 || 0)) >= (Number(j.ps4s || 0) + Number(j.ps5s || 0))
              ? "PRIMARIA"
              : "SECUNDARIA",
        };
        (base as any).contas = [conta];
      } else if (jaTemContas) {
        // normaliza estrutura das contas
        (base as any).contas = (j.contas as any[]).map((c: any) => ({
          id: c.id || uid(),
          email: String(c.email || ""),
          nick: String(c.nick || ""),
          senha: String(c.senha || ""),
          ativacao: String(c.ativacao || ""),
          midia: (c.midia === "PRIMARIA" || c.midia === "SECUNDARIA") ? c.midia : "PRIMARIA",
        })) as ContaJogo[];
      }

      return base;
    }) as Jogo[];

    return recomputarCod(migrada);
  } catch {
    return [];
  }
}

/** Persiste lista e avisa quem estiver ouvindo. */
export function setJogosToStorage(lista: Jogo[]) {
  localStorage.setItem(JOGOS_STORAGE_KEY, JSON.stringify(lista));
  // dois eventos por compatibilidade com versões anteriores
  try { window.dispatchEvent(new CustomEvent("zion:jogos-updated")); } catch {}
  try { window.dispatchEvent(new Event("zion.jogos:refresh")); } catch {}
}

/** Procura por um SKU em qualquer coluna. */
export function findJogoBySku(
  skuRaw: string
): { jogo: Jogo; plataforma: PlataformaKey } | null {
  const sku = normalizeSku(skuRaw);
  if (!sku) return null;
  const lista = getJogosFromStorage();
  for (const j of lista) {
    if (normalizeSku(j.sku_ps4) === sku) return { jogo: j, plataforma: "ps4" };
    if (normalizeSku(j.sku_ps5) === sku) return { jogo: j, plataforma: "ps5" };
    if (normalizeSku(j.sku_ps4s) === sku) return { jogo: j, plataforma: "ps4s" };
    if (normalizeSku(j.sku_ps5s) === sku) return { jogo: j, plataforma: "ps5s" };
  }
  return null;
}

/** Existe SKU? */
export function skuExists(skuRaw: string): boolean {
  return !!findJogoBySku(skuRaw);
}

/* ============================================================
   Componente
   ============================================================ */
export function JogosPage() {
  const [lista, setLista] = useState<Jogo[]>(() => getJogosFromStorage());
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

  // edição inline
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRow, setEditRow] = useState<Omit<Jogo, "cod"> | null>(null);

  // modal de contas
  const [modalJogoId, setModalJogoId] = useState<string | null>(null);
  const jogoModal = useMemo(() => lista.find(j => j.id === modalJogoId) || null, [lista, modalJogoId]);

  // form de nova conta (no modal)
  const [novaConta, setNovaConta] = useState<ContaJogo>({
    id: "",
    email: "",
    nick: "",
    senha: "",
    ativacao: "",
    midia: "PRIMARIA",
  });

  // edição de conta (no modal)
  const [editContaId, setEditContaId] = useState<string | null>(null);
  const [editConta, setEditConta] = useState<ContaJogo | null>(null);

  // salva quando muda
  useEffect(() => setJogosToStorage(lista), [lista]);

  // ouve mudanças feitas por OUTRAS telas (ex.: Pedidos dá baixa no estoque)
  useEffect(() => {
    const onRefresh = () => setLista(getJogosFromStorage());
    window.addEventListener("zion:jogos-updated", onRefresh);
    window.addEventListener("zion.jogos:refresh", onRefresh); // compat.
    return () => {
      window.removeEventListener("zion:jogos-updated", onRefresh);
      window.removeEventListener("zion.jogos:refresh", onRefresh);
    };
  }, []);

  const filtrada = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const base = recomputarCod(lista);
    if (!q) return base;
    return base.filter((j) => {
      const camposBase = [
        j.jogo,
        j.sku_ps4, j.sku_ps5, j.sku_ps4s, j.sku_ps5s,
      ].filter(Boolean).map(String);

      // inclui busca dentro das contas
      const camposContas = (j.contas || []).flatMap(c => [
        c.email, c.nick, c.senha, c.ativacao, c.midia
      ]).filter(Boolean).map(String);

      const todos = [...camposBase, ...camposContas].join("|").toLowerCase();
      return todos.includes(q);
    });
  }, [lista, busca]);

  /* ----------------- CRUD JOGO ----------------- */
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

    const contasIniciais: ContaJogo[] = [];
    // se o usuário preencheu credenciais no cadastro, cria a primeira conta
    if (form.email || form.nick || form.senha || form.ativacao) {
      contasIniciais.push({
        id: uid(),
        email: String(form.email || ""),
        nick: String(form.nick || ""),
        senha: String(form.senha || ""),
        ativacao: String(form.ativacao || ""),
        midia: "PRIMARIA",
      });
    }

    const novo: Jogo = {
      id: uid(),
      cod: 0,
      jogo: form.jogo,
      data: form.data,
      valor: Number(form.valor) || 0,
      ps4: Number(form.ps4) || 0,
      ps5: Number(form.ps5) || 0,
      ps4s: Number(form.ps4s) || 0,
      ps5s: Number(form.ps5s) || 0,
      sku_ps4: normalizeSku(form.sku_ps4),
      sku_ps5: normalizeSku(form.sku_ps5),
      sku_ps4s: normalizeSku(form.sku_ps4s),
      sku_ps5s: normalizeSku(form.sku_ps5s),
      contas: contasIniciais.length ? contasIniciais : [],
    };

    const atualizada = recomputarCod([...lista, novo]);
    setLista(atualizada);
    limparForm();
  }

  function remover(id: string) {
    if (!confirm("Confirma excluir este jogo?")) return;
    const atualizada = recomputarCod(lista.filter((j) => j.id !== id));
    setLista(atualizada);
    if (editingId === id) {
      setEditingId(null);
      setEditRow(null);
    }
    if (modalJogoId === id) {
      setModalJogoId(null);
    }
  }

  function iniciarEdicao(j: Jogo) {
    setEditingId(j.id);
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
      cod: 0,
      valor: Number(editRow.valor) || 0,
      ps4: Number((editRow as any).ps4) || 0,
      ps5: Number((editRow as any).ps5) || 0,
      ps4s: Number((editRow as any).ps4s) || 0,
      ps5s: Number((editRow as any).ps5s) || 0,
      sku_ps4: normalizeSku((editRow as any).sku_ps4),
      sku_ps5: normalizeSku((editRow as any).sku_ps5),
      sku_ps4s: normalizeSku((editRow as any).sku_ps4s),
      sku_ps5s: normalizeSku((editRow as any).sku_ps5s),
      // mantém contas como estão
      contas: (editRow as any).contas || [],
    };

    const nova = lista.map((j) => (j.id === editingId ? normalizada : j));
    const atualizada = recomputarCod(nova);
    setLista(atualizada);
    setEditingId(null);
    setEditRow(null);
  }

  /* ----------------- MODAL CONTAS ----------------- */
  function abrirModal(j: Jogo) {
    setModalJogoId(j.id);
    setNovaConta({
      id: "",
      email: "",
      nick: "",
      senha: "",
      ativacao: "",
      midia: "PRIMARIA",
    });
    setEditContaId(null);
    setEditConta(null);
  }
  function fecharModal() {
    setModalJogoId(null);
    setEditContaId(null);
    setEditConta(null);
  }

  function adicionarConta() {
    if (!jogoModal) return;
    if (!novaConta.email.trim() && !novaConta.nick.trim() && !novaConta.senha.trim() && !novaConta.ativacao.trim()) {
      alert("Preencha ao menos um campo da conta.");
      return;
    }
    const nova: ContaJogo = { ...novaConta, id: uid() };
    const atualizada = lista.map(j => j.id === jogoModal.id
      ? { ...j, contas: [ ...(j.contas || []), nova ] }
      : j
    );
    setLista(recomputarCod(atualizada));
    // limpa form
    setNovaConta({ id: "", email: "", nick: "", senha: "", ativacao: "", midia: "PRIMARIA" });
  }

  function iniciarEdicaoConta(c: ContaJogo) {
    setEditContaId(c.id);
    setEditConta({ ...c });
  }
  function cancelarEdicaoConta() {
    setEditContaId(null);
    setEditConta(null);
  }
  function salvarEdicaoConta() {
    if (!jogoModal || !editContaId || !editConta) return;
    const atualizada = lista.map(j => {
      if (j.id !== jogoModal.id) return j;
      return {
        ...j,
        contas: (j.contas || []).map(c => c.id === editContaId ? { ...editConta, id: editContaId } : c),
      };
    });
    setLista(recomputarCod(atualizada));
    setEditContaId(null);
    setEditConta(null);
  }
  function excluirConta(cId: string) {
    if (!jogoModal) return;
    if (!confirm("Confirma excluir esta conta?")) return;
    const atualizada = lista.map(j => j.id === jogoModal.id
      ? { ...j, contas: (j.contas || []).filter(c => c.id !== cId) }
      : j
    );
    setLista(recomputarCod(atualizada));
  }

  /* ----------------- RENDER ----------------- */
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
          placeholder="Buscar por jogo, SKU ou credenciais das contas..."
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

        {/* Credenciais iniciais (opcional) */}
        <div className="grid md:grid-cols-5 gap-3">
          <div>
            <label className="text-sm block mb-1">E-mail (conta) — opcional</label>
            <input
              value={form.email || ""}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              className="w-full border rounded-lg px-3 py-2"
              placeholder="email@conta.com"
            />
          </div>
          <div>
            <label className="text-sm block mb-1">Nick — opcional</label>
            <input
              value={form.nick || ""}
              onChange={(e) => setForm((f) => ({ ...f, nick: e.target.value }))}
              className="w-full border rounded-lg px-3 py-2"
            />
          </div>
          <div>
            <label className="text-sm block mb-1">Senha — opcional</label>
            <input
              value={form.senha || ""}
              onChange={(e) => setForm((f) => ({ ...f, senha: e.target.value }))}
              className="w-full border rounded-lg px-3 py-2"
              type="password"
            />
          </div>
          <div>
            <label className="text-sm block mb-1">Ativação — opcional</label>
            <input
              value={form.ativacao || ""}
              onChange={(e) => setForm((f) => ({ ...f, ativacao: e.target.value }))}
              className="w-full border rounded-lg px-3 py-2"
              placeholder="Código de ativação"
            />
          </div>
          <div className="self-end text-xs text-slate-500">
            Se preencher, será criada a 1ª conta (mídia PRIMÁRIA).
          </div>
        </div>

        {/* SKUs */}
        <div className="grid md:grid-cols-4 gap-3">
          <div>
            <label className="text-sm block mb-1">SKU_PS4</label>
            <input
              value={form.sku_ps4}
              onChange={(e) => setForm((f) => ({ ...f, sku_ps4: normalizeSku(e.target.value) }))}
              className="w-full border rounded-lg px-3 py-2"
              placeholder="ex.: EAFC26-PS4-P"
            />
          </div>
          <div>
            <label className="text-sm block mb-1">SKU_PS5</label>
            <input
              value={form.sku_ps5}
              onChange={(e) => setForm((f) => ({ ...f, sku_ps5: normalizeSku(e.target.value) }))}
              className="w-full border rounded-lg px-3 py-2"
              placeholder="ex.: EAFC26-PS5-P"
            />
          </div>
          <div>
            <label className="text-sm block mb-1">SKU_PS4s</label>
            <input
              value={form.sku_ps4s}
              onChange={(e) => setForm((f) => ({ ...f, sku_ps4s: normalizeSku(e.target.value) }))}
              className="w-full border rounded-lg px-3 py-2"
              placeholder="ex.: EAFC26-PS4-S"
            />
          </div>
          <div>
            <label className="text-sm block mb-1">SKU_PS5s</label>
            <input
              value={form.sku_ps5s}
              onChange={(e) => setForm((f) => ({ ...f, sku_ps5s: normalizeSku(e.target.value) }))}
              className="w-full border rounded-lg px-3 py-2"
              placeholder="ex.: EAFC26-PS5-S"
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
              <th className="text-left px-3 py-2">SKUs</th>
              <th className="text-left px-3 py-2">Informações</th>
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
                        onChange={(e) => setEditRow((r) => (r ? { ...r, data: e.target.value } : r))}
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
                        onChange={(e) => setEditRow((r) => (r ? { ...r, jogo: e.target.value } : r))}
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
                        onChange={(e) => setEditRow((r) => (r ? { ...r, valor: Number(e.target.value) } : r))}
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
                              r ? ({ ...r, [k]: Number(e.target.value) } as any) : r
                            )
                          }
                          className="border rounded px-2 py-1 w-16 text-center"
                        />
                      ) : (
                        (j as any)[k] || 0
                      )}
                    </td>
                  ))}

                  {/* SKUs compactos */}
                  <td className="px-3 py-2">
                    <div className="flex flex-col text-xs text-slate-700">
                      {j.sku_ps4 && <span>PS4: {j.sku_ps4}</span>}
                      {j.sku_ps5 && <span>PS5: {j.sku_ps5}</span>}
                      {j.sku_ps4s && <span>PS4s: {j.sku_ps4s}</span>}
                      {j.sku_ps5s && <span>PS5s: {j.sku_ps5s}</span>}
                      {(!j.sku_ps4 && !j.sku_ps5 && !j.sku_ps4s && !j.sku_ps5s) && <span>—</span>}
                    </div>
                  </td>

                  {/* Botão para abrir pop-up de contas */}
                  <td className="px-3 py-2">
                    <button
                      onClick={() => abrirModal(j)}
                      className="text-brand-700 hover:underline"
                    >
                      Ver informações ({(j.contas || []).length})
                    </button>
                  </td>

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
                <td colSpan={11} className="px-3 py-6 text-center text-slate-500">
                  Nenhum registro.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* --------- MODAL: Contas do jogo --------- */}
      {jogoModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => {
            // fecha ao clicar fora do conteúdo
            if (e.target === e.currentTarget) fecharModal();
          }}
        >
          {/* AQUI aumentamos a largura de max-w-3xl -> max-w-6xl */}
          <div className="w-full max-w-6xl bg-white rounded-2xl shadow-xl border border-slate-200 p-4">
            <div className="flex items-start justify-between gap-4 mb-3">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">
                  Contas — {jogoModal.jogo}
                </h3>
                <p className="text-slate-600 text-sm">
                  Gerencie as contas deste jogo. Cada conta indica se a mídia é <b>primária</b> ou <b>secundária</b>.
                </p>
              </div>
              <button onClick={fecharModal} className="text-slate-600 hover:text-slate-800">
                fechar ✕
              </button>
            </div>

            {/* Lista de contas */}
            <div className="overflow-x-auto mb-4">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-slate-700">
                  <tr>
                    <th className="text-left px-3 py-2">E-mail</th>
                    <th className="text-left px-3 py-2">Nick</th>
                    <th className="text-left px-3 py-2">Senha</th>
                    <th className="text-left px-3 py-2">Ativação</th>
                    <th className="text-left px-3 py-2">Mídia</th>
                    <th className="text-right px-3 py-2">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {(jogoModal.contas || []).map((c) => {
                    const emEdicao = editContaId === c.id;
                    return (
                      <tr key={c.id} className="border-t">
                        <td className="px-3 py-2">
                          {emEdicao ? (
                            <input
                              value={editConta?.email ?? ""}
                              onChange={(e) => setEditConta((x) => (x ? { ...x, email: e.target.value } : x))}
                              className="border rounded px-2 py-1 w-56"
                            />
                          ) : c.email || "—"}
                        </td>
                        <td className="px-3 py-2">
                          {emEdicao ? (
                            <input
                              value={editConta?.nick ?? ""}
                              onChange={(e) => setEditConta((x) => (x ? { ...x, nick: e.target.value } : x))}
                              className="border rounded px-2 py-1 w-40"
                            />
                          ) : c.nick || "—"}
                        </td>
                        <td className="px-3 py-2">
                          {emEdicao ? (
                            <input
                              value={editConta?.senha ?? ""}
                              onChange={(e) => setEditConta((x) => (x ? { ...x, senha: e.target.value } : x))}
                              className="border rounded px-2 py-1 w-40"
                              type="text"
                            />
                          ) : c.senha || "—"}
                        </td>
                        <td className="px-3 py-2">
                          {emEdicao ? (
                            <input
                              value={editConta?.ativacao ?? ""}
                              onChange={(e) => setEditConta((x) => (x ? { ...x, ativacao: e.target.value } : x))}
                              className="border rounded px-2 py-1 w-48"
                            />
                          ) : c.ativacao || "—"}
                        </td>
                        <td className="px-3 py-2">
                          {emEdicao ? (
                            <select
                              value={editConta?.midia ?? "PRIMARIA"}
                              onChange={(e) => setEditConta((x) => (x ? { ...x, midia: e.target.value as Midia } : x))}
                              className="border rounded px-2 py-1 bg-white"
                            >
                              <option value="PRIMARIA">PRIMÁRIA</option>
                              <option value="SECUNDARIA">SECUNDÁRIA</option>
                            </select>
                          ) : (
                            <span
                              className={`text-[10px] uppercase tracking-wide border rounded-full px-2 py-0.5 ${
                                c.midia === "PRIMARIA"
                                  ? "bg-blue-100 text-blue-800 border-blue-200"
                                  : "bg-amber-100 text-amber-800 border-amber-200"
                              }`}
                            >
                              {c.midia === "PRIMARIA" ? "Primária" : "Secundária"}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {!emEdicao ? (
                            <div className="flex gap-3 justify-end">
                              <button
                                onClick={() => iniciarEdicaoConta(c)}
                                className="text-brand-700 hover:underline"
                              >
                                Editar
                              </button>
                              <button
                                onClick={() => excluirConta(c.id)}
                                className="text-red-600 hover:underline"
                              >
                                Excluir
                              </button>
                            </div>
                          ) : (
                            <div className="flex gap-3 justify-end">
                              <button onClick={salvarEdicaoConta} className="text-brand-700 hover:underline">
                                Salvar
                              </button>
                              <button onClick={cancelarEdicaoConta} className="text-slate-600 hover:underline">
                                Cancelar
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {(jogoModal.contas || []).length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                        Nenhuma conta cadastrada para este jogo.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Adicionar nova conta */}
            <div className="border-t pt-4">
              <h4 className="font-medium text-slate-900 mb-2">Adicionar conta</h4>
              <div className="grid md:grid-cols-5 gap-3">
                <input
                  placeholder="E-mail"
                  value={novaConta.email}
                  onChange={(e) => setNovaConta((c) => ({ ...c, email: e.target.value }))}
                  className="border rounded-lg px-3 py-2"
                />
                <input
                  placeholder="Nick"
                  value={novaConta.nick}
                  onChange={(e) => setNovaConta((c) => ({ ...c, nick: e.target.value }))}
                  className="border rounded-lg px-3 py-2"
                />
                <input
                  placeholder="Senha"
                  value={novaConta.senha}
                  onChange={(e) => setNovaConta((c) => ({ ...c, senha: e.target.value }))}
                  className="border rounded-lg px-3 py-2"
                  type="text"
                />
                <input
                  placeholder="Ativação"
                  value={novaConta.ativacao}
                  onChange={(e) => setNovaConta((c) => ({ ...c, ativacao: e.target.value }))}
                  className="border rounded-lg px-3 py-2"
                />
                <select
                  value={novaConta.midia}
                  onChange={(e) => setNovaConta((c) => ({ ...c, midia: e.target.value as Midia }))}
                  className="border rounded-lg px-3 py-2 bg-white"
                >
                  <option value="PRIMARIA">Primária</option>
                  <option value="SECUNDARIA">Secundária</option>
                </select>
              </div>
              <div className="mt-3">
                <button
                  onClick={adicionarConta}
                  className="rounded-lg bg-brand-600 text-white px-4 py-2 hover:bg-brand-700 transition"
                >
                  Adicionar conta
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* --------- /MODAL --------- */}
    </div>
  );
}
