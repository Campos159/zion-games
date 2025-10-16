// src/pages/JogosPage.tsx
import { useEffect, useMemo, useRef, useState } from "react";

/* ============================================================
   Tipos e constantes
   ============================================================ */
export type Midia = "PRIMARIA" | "SECUNDARIA";
// >>> NOVO: plataforma/versão por conta
export type PlataformaConta = "PS4" | "PS5" | "PS4s" | "PS5s";

export type ContaJogo = {
  id: string;
  email: string;
  nick: string;
  senha: string;

  /** NOVO: lista de códigos de ativação, 1 por item */
  ativacoes: string[];

  /** LEGADO: ainda lido na migração; não mais usado na UI */
  ativacao?: string;

  midia: Midia; // PRIMARIA | SECUNDARIA

  // >>> NOVO: versão da conta (slot/plataforma)
  plataforma: PlataformaConta;
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

  // SKUs por slot (para localizar o jogo via SKU)
  sku_ps4?: string;
  sku_ps5?: string;
  sku_ps4s?: string;
  sku_ps5s?: string;

  /** LEGADO: pool único de códigos por jogo — apenas para migração se existir */
  codes?: string[];

  // LEGADO (criação rápida de primeira conta)
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

/** NOVO: checa duplicidade de SKU em outros jogos (impede salvar) */
function skuDuplicadoNoContexto(
  lista: Jogo[],
  editingId: string | null,
  k: "sku_ps4" | "sku_ps5" | "sku_ps4s" | "sku_ps5s",
  value: string
) {
  const sku = normalizeSku(value);
  if (!sku) return false;
  return lista.some(j => {
    if (j.id === editingId) return false; // ignora o próprio jogo em edição
    return normalizeSku((j as any)[k]) === sku;
  });
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

/** Converte texto em lista de códigos. Preferência: 1 por linha, mas aceita vírgula/;/. */
function splitCodes(text?: string | string[]): string[] {
  if (!text) return [];
  if (Array.isArray(text)) {
    return text.map(String).map((s) => s.trim()).filter(Boolean);
  }
  return String(text)
    .split(/\r?\n|,|;|\//g)
    .map((s) => s.trim())
    .filter(Boolean);
}
function joinCodes(arr?: string[]): string {
  return (arr || []).join("\n");
}

/** Lê e migra jogos do localStorage */
export function getJogosFromStorage(): Jogo[] {
  try {
    const raw = localStorage.getItem(JOGOS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as any[];

    const migrada = parsed.map((j: any) => {
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

      // MIGRAÇÃO: contas -> garantir ativacoes[] e plataforma
      const jaTemContas = Array.isArray(j.contas);
      if (jaTemContas) {
        (base as any).contas = (j.contas as any[]).map((c: any) => {
          const listaAtiv = Array.isArray(c.ativacoes)
            ? splitCodes(c.ativacoes)
            : splitCodes(c.ativacao);
          return {
            id: c.id || uid(),
            email: String(c.email || ""),
            nick: String(c.nick || ""),
            senha: String(c.senha || ""),
            ativacoes: listaAtiv,
            ativacao: undefined, // legado não mais usado
            midia: (c.midia === "PRIMARIA" || c.midia === "SECUNDARIA") ? c.midia : "PRIMARIA",
            // >>> se não existir plataforma, define um default seguro (PS5)
            plataforma: (c.plataforma === "PS4" || c.plataforma === "PS5" || c.plataforma === "PS4s" || c.plataforma === "PS5s")
              ? (c.plataforma as PlataformaConta)
              : "PS5",
          } as ContaJogo;
        });
      } else {
        // Se vierem campos legados soltos, cria a primeira conta
        const temLegado =
          (j.email && String(j.email).trim()) ||
          (j.nick && String(j.nick).trim()) ||
          (j.senha && String(j.senha).trim()) ||
          (j.ativacao && String(j.ativacao).trim());
        if (temLegado) {
          (base as any).contas = [{
            id: uid(),
            email: String(j.email || ""),
            nick: String(j.nick || ""),
            senha: String(j.senha || ""),
            ativacoes: splitCodes(j.ativacao),
            ativacao: undefined,
            midia:
              (Number(j.ps4 || 0) + Number(j.ps5 || 0)) >= (Number(j.ps4s || 0) + Number(j.ps5s || 0))
                ? "PRIMARIA"
                : "SECUNDARIA",
            plataforma: "PS5", // >>> default na criação a partir do legado
          } as ContaJogo];
        }
      }

      // LEGADO: se houver um `codes` por jogo, apenas mantemos para referência (não é mais usado)
      if (Array.isArray(j.codes)) {
        (base as any).codes = splitCodes(j.codes);
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
  try { window.dispatchEvent(new CustomEvent("zion:jogos-updated")); } catch {}
  try { window.dispatchEvent(new Event("zion.jogos:refresh")); } catch {}
}

/** Procura por um SKU em qualquer coluna */
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

/* ======== NOVOS HELPERS EXPORTADOS — códigos por CONTA ======== */

/** Encontra a CONTA de um jogo a partir do SKU + Mídia (útil para outra tela) */
export function findContaBySkuAndMidia(skuRaw: string, midia: Midia): { jogo: Jogo; conta: ContaJogo } | null {
  const hit = findJogoBySku(skuRaw);
  if (!hit) return null;
  const contas = hit.jogo.contas || [];
  const conta = contas.find(c => c.midia === midia) || contas[0]; // fallback se só houver uma
  return conta ? { jogo: hit.jogo, conta } : null;
}

/** Pré-visualiza o PRÓXIMO código disponível por CONTA (sem consumir) */
export function previewNextCodeForAccount(contaId: string): string | undefined {
  const lista = getJogosFromStorage();
  for (const j of lista) {
    const conta = (j.contas || []).find(c => c.id === contaId);
    if (conta) return (conta.ativacoes || [])[0];
  }
  return undefined;
}

/** Consome (remove) o PRÓXIMO código por CONTA e retorna o valor */
export function consumeNextCodeForAccount(contaId: string): string | undefined {
  const lista = getJogosFromStorage();
  for (let i = 0; i < lista.length; i++) {
    const j = lista[i];
    const idx = (j.contas || []).findIndex(c => c.id === contaId);
    if (idx >= 0) {
      const conta = (j.contas || [])[idx];
      const pool = conta.ativacoes || [];
      if (!pool.length) return undefined;
      const code = pool[0];
      const novaConta: ContaJogo = { ...conta, ativacoes: pool.slice(1) };
      const novoJogo: Jogo = {
        ...j,
        contas: (j.contas || []).map((c, k) => (k === idx ? novaConta : c)),
      };
      const novaLista = recomputarCod([
        ...lista.slice(0, i), novoJogo, ...lista.slice(i + 1),
      ]);
      setJogosToStorage(novaLista);
      return code;
    }
  }
  return undefined;
}

/** Helpers por SKU + Mídia */
export function previewNextCodeBySkuAndMidia(skuRaw: string, midia: Midia): string | undefined {
  const hit = findContaBySkuAndMidia(skuRaw, midia);
  if (!hit) return undefined;
  return (hit.conta.ativacoes || [])[0];
}
export function consumeNextCodeBySkuAndMidia(skuRaw: string, midia: Midia): string | undefined {
  const hit = findContaBySkuAndMidia(skuRaw, midia);
  if (!hit) return undefined;
  return consumeNextCodeForAccount(hit.conta.id);
}

/* ======== HELPER DE CONTAGEM SOLICITADO ======== */
/** Conta quantas CONTAS são válidas (email + senha + pelo menos 1 código) */
function contasValidas(j: Jogo): number {
  const contas = j.contas || [];
  return contas.filter(c =>
    String(c.email || "").trim() !== "" &&
    String(c.senha || "").trim() !== "" &&
    (c.ativacoes?.length || 0) > 0
  ).length;
}

/* ============================================================
   Componente
   ============================================================ */
export function JogosPage() {
  const [lista, setLista] = useState<Jogo[]>(() => getJogosFromStorage());
  const [busca, setBusca] = useState("");

  // Ref com a última lista salva para evitar loop de refresh
  const listaRef = useRef<Jogo[]>(lista);
  useEffect(() => { listaRef.current = lista; }, [lista]);

  // formulário de novo registro
  const [form, setForm] = useState<Omit<Jogo, "id" | "cod" | "codes"> & {
    /** LEGADO: cria 1ª conta com ativacoes derivadas de 'ativacao' se vier preenchido */
    codes_text?: string; // descontinuado — mantido só para não quebrar imports antigos
  }>({
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
    ativacao: "", // vai virar ativacoes[] da 1ª conta se informado
    sku_ps4: "",
    sku_ps5: "",
    sku_ps4s: "",
    sku_ps5s: "",
    codes_text: "", // ignorado
  });

  // edição inline
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRow, setEditRow] = useState<(Omit<Jogo, "cod">) | null>(null);

  // modal de contas
  const [modalJogoId, setModalJogoId] = useState<string | null>(null);
  const jogoModal = useMemo(() => lista.find(j => j.id === modalJogoId) || null, [lista, modalJogoId]);

  // form de nova conta (no modal)
  const [novaConta, setNovaConta] = useState<ContaJogo>({
    id: "",
    email: "",
    nick: "",
    senha: "",
    ativacoes: [],
    midia: "PRIMARIA",
    plataforma: "PS5", // >>> default ao adicionar
  });
  const [novaContaAtivacoesText, setNovaContaAtivacoesText] = useState<string>("");

  // edição de conta (no modal)
  const [editContaId, setEditContaId] = useState<string | null>(null);
  const [editConta, setEditConta] = useState<ContaJogo | null>(null);
  const [editContaAtivText, setEditContaAtivText] = useState<string>("");

  // salva quando muda
  useEffect(() => {
    setJogosToStorage(lista);
  }, [lista]);

  // ouve mudanças feitas por OUTRAS telas
  useEffect(() => {
    const onRefresh = () => {
      const incoming = getJogosFromStorage();
      const same = JSON.stringify(incoming) === JSON.stringify(listaRef.current);
      if (!same) setLista(incoming);
    };
    window.addEventListener("zion:jogos-updated", onRefresh);
    window.addEventListener("zion.jogos:refresh", onRefresh);
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

      // inclui busca nas contas e nos códigos
      const camposContas = (j.contas || []).flatMap(c => [
        c.email, c.nick, c.senha, ...(c.ativacoes || []), c.midia, c.plataforma // >>> inclui plataforma na busca
      ]).filter(Boolean).map(String);

      // LEGADO (se ainda existir codes no jogo)
      const camposCodesJogo = (j.codes || []);

      const todos = [...camposBase, ...camposContas, ...camposCodesJogo].join("|").toLowerCase();
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
      codes_text: "",
    });
  }

  function adicionar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!form.jogo.trim()) return;

    const contasIniciais: ContaJogo[] = [];
    if (form.email || form.nick || form.senha || form.ativacao) {
      contasIniciais.push({
        id: uid(),
        email: String(form.email || ""),
        nick: String(form.nick || ""),
        senha: String(form.senha || ""),
        ativacoes: splitCodes(form.ativacao), // MIGRA imediato
        midia: "PRIMARIA",
        plataforma: "PS5", // >>> default quando vindo do legado do formulário rápido
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

  /** NOVO: setter prático para SKUs em edição */
  function setEditSku(
    k: "sku_ps4" | "sku_ps5" | "sku_ps4s" | "sku_ps5s",
    v: string
  ) {
    setEditRow(r => (r ? { ...r, [k]: normalizeSku(v) } as any : r));
  }

  function salvarEdicao() {
    if (!editingId || !editRow) return;

    // impedir salvar se houver SKU duplicado
    const keys = ["sku_ps4","sku_ps5","sku_ps4s","sku_ps5s"] as const;
    for (const k of keys) {
      const val = normalizeSku((editRow as any)?.[k] || "");
      if (val && skuDuplicadoNoContexto(lista, editingId, k, val)) {
        alert(`O ${k.toUpperCase()} informado (${val}) já existe em outro jogo.`);
        return;
      }
    }

    const normalizada: Jogo = {
      ...(editRow as any),
      id: editingId,
      cod: 0,
      valor: Number((editRow as any).valor) || 0,
      ps4: Number((editRow as any).ps4) || 0,
      ps5: Number((editRow as any).ps5) || 0,
      ps4s: Number((editRow as any).ps4s) || 0,
      ps5s: Number((editRow as any).ps5s) || 0,
      sku_ps4: normalizeSku((editRow as any).sku_ps4),
      sku_ps5: normalizeSku((editRow as any).sku_ps5),
      sku_ps4s: normalizeSku((editRow as any).sku_ps4s),
      sku_ps5s: normalizeSku((editRow as any).sku_ps5s),
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
      ativacoes: [],
      midia: "PRIMARIA",
      plataforma: "PS5", // >>> default ao abrir modal
    });
    setNovaContaAtivacoesText("");
    setEditContaId(null);
    setEditConta(null);
    setEditContaAtivText("");
  }
  function fecharModal() {
    setModalJogoId(null);
    setEditContaId(null);
    setEditConta(null);
    setEditContaAtivText("");
  }

  function adicionarConta() {
    if (!jogoModal) return;
    const ativs = splitCodes(novaContaAtivacoesText);
    if (!novaConta.email.trim() && !novaConta.nick.trim() && !novaConta.senha.trim() && ativs.length === 0) {
      alert("Preencha ao menos um campo da conta ou inclua códigos.");
      return;
    }
    const nova: ContaJogo = { ...novaConta, id: uid(), ativacoes: ativs };
    const atualizada = lista.map(j => j.id === jogoModal.id
      ? { ...j, contas: [ ...(j.contas || []), nova ] }
      : j
    );
    setLista(recomputarCod(atualizada));
    // limpa form
    setNovaConta({ id: "", email: "", nick: "", senha: "", ativacoes: [], midia: "PRIMARIA", plataforma: "PS5" });
    setNovaContaAtivacoesText("");
  }

  function iniciarEdicaoConta(c: ContaJogo) {
    setEditContaId(c.id);
    setEditConta({ ...c });
    setEditContaAtivText(joinCodes(c.ativacoes || []));
  }
  function cancelarEdicaoConta() {
    setEditContaId(null);
    setEditConta(null);
    setEditContaAtivText("");
  }
  function salvarEdicaoConta() {
    if (!jogoModal || !editContaId || !editConta) return;
    const ativs = splitCodes(editContaAtivText);
    const atualizada = lista.map(j => {
      if (j.id !== jogoModal.id) return j;
      return {
        ...j,
        contas: (j.contas || []).map(c =>
          c.id === editContaId ? { ...editConta, id: editContaId, ativacoes: ativs } : c
        ),
      };
    });
    setLista(recomputarCod(atualizada));
    setEditContaId(null);
    setEditConta(null);
    setEditContaAtivText("");
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
          Os campos <b>PS4/PS5/PS4s/PS5s</b> representam <b>quantidade</b> (0 = não possui).<br />
          Agora, os <b>códigos de ativação</b> ficam <b>dentro de cada conta</b> (aba “Contas → Ativações”), um por linha.
          Outras telas podem consumir o próximo código por <b>conta</b> ou por <b>SKU + mídia</b>.
        </p>
      </div>

      {/* Busca */}
      <div className="flex flex-col md:flex-row gap-2 md:items-center">
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por jogo, SKU, credenciais ou códigos..."
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
              type="text"
            />
          </div>
          <div>
            <label className="text-sm block mb-1">Ativações iniciais (1 por linha) — opcional</label>
            <input
              value={form.ativacao || ""}
              onChange={(e) => setForm((f) => ({ ...f, ativacao: e.target.value }))}
              className="w-full border rounded-lg px-3 py-2"
              placeholder="ABC-123-XYZ\nDEF-456-UVW"
            />
          </div>
          <div className="self-end text-xs text-slate-500">
            Se preencher, será criada a 1ª conta (mídia PRIMÁRIA) com esses códigos.
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
              <th className="text-left px-3 py-2">Contas & Códigos</th>
              <th className="text-left px-3 py-2">Informações</th>
              <th className="text-right px-3 py-2">Ações</th>
            </tr>
          </thead>
          <tbody>
            {filtrada.map((j) => {
              const emEdicao = editingId === j.id;
              const contas = j.contas || [];

              // total de CONTAS VÁLIDAS (email + senha + >=1 código)
              const totalContasValid = contasValidas(j);

              // somatório de códigos disponíveis
              const totalCodes = contas.reduce((acc, c) => acc + (c.ativacoes?.length || 0), 0);

              // preview: primeiro código encontrado
              const preview =
                contas.find(c => (c.ativacoes || []).length > 0)?.ativacoes?.[0] ?? undefined;

              return (
                <tr key={j.id} className="border-t">
                  <td className="px-3 py-2">{j.cod}</td>

                  <td className="px-3 py-2">
                    {emEdicao ? (
                      <input
                        type="date"
                        value={(editRow as any)?.data || ""}
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
                        value={(editRow as any)?.jogo || ""}
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
                        value={(editRow as any)?.valor ?? 0}
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

                  {/* SKUs (editáveis quando em edição) */}
                  <td className="px-3 py-2 align-top">
                    {!emEdicao ? (
                      <div className="flex flex-col text-xs text-slate-700">
                        {j.sku_ps4 && <span>PS4: {j.sku_ps4}</span>}
                        {j.sku_ps5 && <span>PS5: {j.sku_ps5}</span>}
                        {j.sku_ps4s && <span>PS4s: {j.sku_ps4s}</span>}
                        {j.sku_ps5s && <span>PS5s: {j.sku_ps5s}</span>}
                        {(!j.sku_ps4 && !j.sku_ps5 && !j.sku_ps4s && !j.sku_ps5s) && <span>—</span>}
                      </div>
                    ) : (
                      <div className="flex flex-col gap-1 text-xs">
                        {(
                          [
                            ["PS4", "sku_ps4"],
                            ["PS5", "sku_ps5"],
                            ["PS4s", "sku_ps4s"],
                            ["PS5s", "sku_ps5s"],
                          ] as const
                        ).map(([label, key]) => {
                          const curr = (editRow as any)?.[key] ?? "";
                          const dup = skuDuplicadoNoContexto(lista, editingId, key, curr);
                          return (
                            <div key={key} className="flex items-center gap-2">
                              <span className="w-12 shrink-0 text-slate-600">{label}:</span>
                              <input
                                value={curr}
                                onChange={(e) => setEditSku(key, e.target.value)}
                                placeholder={`ex.: EAFC26-${label}-P`}
                                className="border rounded px-2 py-1 w-56"
                              />
                              {/* botão limpar/apagar */}
                              {curr ? (
                                <button
                                  type="button"
                                  onClick={() => setEditSku(key, "")}
                                  className="text-rose-600 hover:underline"
                                  title="Apagar este SKU"
                                >
                                  apagar
                                </button>
                              ) : (
                                <span className="text-slate-400">novo</span>
                              )}
                              {/* alerta de duplicidade (somente se houver valor) */}
                              {curr && dup && (
                                <span className="text-amber-600" title="Este SKU já existe em outro jogo">
                                  • já existe em outro jogo
                                </span>
                              )}
                            </div>
                          );
                        })}
                        <div className="text-[11px] text-slate-500 mt-1">
                          Dica: deixe em branco para remover um SKU. Eles serão salvos ao clicar em <b>Salvar</b>.
                        </div>
                      </div>
                    )}
                  </td>

                  {/* RESUMO (Contas & Códigos) */}
                  <td className="px-3 py-2 align-top">
                    <div className="text-xs text-slate-700 space-y-0.5">
                      <div>Contas válidas (e-mail + senha + código): <b>{totalContasValid}</b></div>
                      <div>Códigos disponíveis (todas as contas): <b>{totalCodes}</b></div>
                      <div className="text-slate-500 mt-1">Próximo código (preview): <i>{preview || "—"}</i></div>
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
                <td colSpan={12} className="px-3 py-6 text-center text-slate-500">
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
            if (e.target === e.currentTarget) fecharModal();
          }}
        >
          <div className="w-full max-w-6xl bg-white rounded-2xl shadow-xl border border-slate-200 p-4">
            <div className="flex items-start justify-between gap-4 mb-3">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">
                  Contas — {jogoModal.jogo}
                </h3>
                <p className="text-slate-600 text-sm">
                  Em cada conta, insira os códigos no campo <b>Ativações</b> (um por linha).
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
                    <th className="text-left px-3 py-2">Ativações</th>
                    <th className="text-left px-3 py-2">Mídia</th>
                    {/* >>> NOVA COLUNA: Versão/Plataforma */}
                    <th className="text-left px-3 py-2">Versão</th>
                    <th className="text-right px-3 py-2">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {(jogoModal.contas || []).map((c) => {
                    const emEdicao = editContaId === c.id;
                    const totalC = c.ativacoes?.length || 0;
                    const preview = c.ativacoes?.[0];

                    return (
                      <tr key={c.id} className="border-t align-top">
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

                        {/* Ativações por conta */}
                        <td className="px-3 py-2">
                          {!emEdicao ? (
                            <div className="text-xs text-slate-700 space-y-1">
                              <div>Total de códigos: <b>{totalC}</b></div>
                              <div className="text-slate-500">Próximo: <i>{preview || "—"}</i></div>
                            </div>
                          ) : (
                            <div className="w-[420px] max-w-full">
                              <div className="text-xs mb-1">Ativações (1 por linha)</div>
                              <textarea
                                value={editContaAtivText}
                                onChange={(e) => setEditContaAtivText(e.target.value)}
                                className="border rounded px-2 py-1 min-h-[140px] w-full"
                                placeholder={"ABC-123-XYZ\nDEF-456-UVW\nGHI-789-RST"}
                              />
                            </div>
                          )}
                        </td>

                        {/* Mídia PRIMÁRIA/SECUNDÁRIA */}
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

                        {/* >>> NOVO: Versão/Plataforma por conta */}
                        <td className="px-3 py-2">
                          {emEdicao ? (
                            <select
                              value={editConta?.plataforma ?? "PS5"}
                              onChange={(e) => setEditConta((x) => (x ? { ...x, plataforma: e.target.value as PlataformaConta } : x))}
                              className="border rounded px-2 py-1 bg-white"
                            >
                              <option value="PS4">PS4</option>
                              <option value="PS5">PS5</option>
                              <option value="PS4s">PS4s (secundária)</option>
                              <option value="PS5s">PS5s (secundária)</option>
                            </select>
                          ) : (
                            <span className="text-xs">{c.plataforma}</span>
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
                      <td colSpan={7} className="px-3 py-6 text-center text-slate-500">
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
              <div className="grid md:grid-cols-6 gap-3">
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
                <textarea
                  placeholder="Ativações (1 por linha)"
                  value={novaContaAtivacoesText}
                  onChange={(e) => setNovaContaAtivacoesText(e.target.value)}
                  className="border rounded-lg px-3 py-2 min-h-[40px]"
                />
                <select
                  value={novaConta.midia}
                  onChange={(e) => setNovaConta((c) => ({ ...c, midia: e.target.value as Midia }))}
                  className="border rounded-lg px-3 py-2 bg-white"
                >
                  <option value="PRIMARIA">Primária</option>
                  <option value="SECUNDARIA">Secundária</option>
                </select>
                {/* >>> NOVO: seletor de versão ao adicionar conta */}
                <select
                  value={novaConta.plataforma}
                  onChange={(e) => setNovaConta((c) => ({ ...c, plataforma: e.target.value as PlataformaConta }))}
                  className="border rounded-lg px-3 py-2 bg-white"
                >
                  <option value="PS4">PS4</option>
                  <option value="PS5">PS5</option>
                  <option value="PS4s">PS4s (secundária)</option>
                  <option value="PS5s">PS5s (secundária)</option>
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
