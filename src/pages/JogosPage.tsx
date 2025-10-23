// src/pages/JogosPage.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";

/* ============================================================
   Tipos e constantes
   ============================================================ */
export type Midia = "PRIMARIA" | "SECUNDARIA";
export type PlataformaConta = "PS4" | "PS5" | "PS4s" | "PS5s";

export type ContaJogo = {
  id: string;
  email: string;
  nick: string;
  senha: string;
  ativacoes: string[];
  ativacao?: string; // legado
  midia: Midia;
  plataforma: PlataformaConta;
};

export type Jogo = {
  id: string;
  cod: number;
  data: string;
  jogo: string;
  valor: number;
  ps4: number;
  ps5: number;
  ps4s: number;
  ps5s: number;
  contas?: ContaJogo[];
  sku_ps4?: string;
  sku_ps5?: string;
  sku_ps4s?: string;
  sku_ps5s?: string;
  codes?: string[]; // legado
  email?: string;   // legado formulário rápido
  nick?: string;    // legado
  senha?: string;   // legado
  ativacao?: string;// legado
};

export type PlataformaKey = "ps4" | "ps5" | "ps4s" | "ps5s";

export const JOGOS_STORAGE_KEY = "zion.jogos";

/* ============================================================
   Helpers compartilhados
   ============================================================ */
export function normalizeSku(s: string | undefined | null): string {
  return (s ?? "").toString().trim().replace(/\s+/g, "");
}

function skuDuplicadoNoContexto(
  lista: Jogo[],
  editingId: string | null,
  k: "sku_ps4" | "sku_ps5" | "sku_ps4s" | "sku_ps5s",
  value: string
) {
  const sku = normalizeSku(value);
  if (!sku) return false;
  return lista.some(j => {
    if (j.id === editingId) return false;
    return normalizeSku((j as any)[k]) === sku;
  });
}

function recomputarCod(lista: Jogo[]): Jogo[] {
  const ordenada = [...lista].sort((a, b) =>
    a.jogo.localeCompare(b.jogo, "pt-BR", { sensitivity: "base" })
  );
  return ordenada.map((j, idx) => ({ ...j, cod: idx + 1 }));
}

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

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

function normalizeGameTitleForMerge(name: string): string {
  let n = (name || "").trim();
  n = n.replace(/\s+/g, " ");
  n = n.replace(/\s*\((?:jogo|conta|account|acc|slot)\s*\d+\)\s*$/i, "");
  n = n.replace(/\s*(?:-|#)\s*\d+\s*$/i, "");
  return n.trim();
}

function normalizeHeader(h: string): string {
  return (h || "")
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^\w_]/g, "");
}

function derivarNomeJogo(mapped: Record<string, any>): string {
  const candidatos = [
    mapped.jogo,
    mapped.jogos,
    mapped.produto,
    mapped.product,
    mapped.descricao,
    mapped.item,
    mapped.game,
    mapped.nome_do_jogo,
    mapped.titulo,
    mapped.nome,
  ];
  const hit = candidatos.find((x) => String(x || "").trim() !== "");
  return String(hit || "").trim();
}

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
            ativacao: undefined,
            midia: (c.midia === "PRIMARIA" || c.midia === "SECUNDARIA") ? c.midia : "PRIMARIA",
            plataforma: (c.plataforma === "PS4" || c.plataforma === "PS5" || c.plataforma === "PS4s" || c.plataforma === "PS5s")
              ? (c.plataforma as PlataformaConta)
              : "PS5",
          } as ContaJogo;
        });
      } else {
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
            plataforma: "PS5",
          } as ContaJogo];
        }
      }

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

export function setJogosToStorage(lista: Jogo[]) {
  localStorage.setItem(JOGOS_STORAGE_KEY, JSON.stringify(lista));
  try { window.dispatchEvent(new CustomEvent("zion:jogos-updated")); } catch {}
  try { window.dispatchEvent(new Event("zion.jogos:refresh")); } catch {}
}

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

export function skuExists(skuRaw: string): boolean {
  return !!findJogoBySku(skuRaw);
}

/* ======== códigos por CONTA ======== */
export function findContaBySkuAndMidia(skuRaw: string, midia: Midia): { jogo: Jogo; conta: ContaJogo } | null {
  const hit = findJogoBySku(skuRaw);
  if (!hit) return null;
  const contas = hit.jogo.contas || [];
  const conta = contas.find(c => c.midia === midia) || contas[0];
  return conta ? { jogo: hit.jogo, conta } : null;
}
export function previewNextCodeForAccount(contaId: string): string | undefined {
  const lista = getJogosFromStorage();
  for (const j of lista) {
    const conta = (j.contas || []).find(c => c.id === contaId);
    if (conta) return (conta.ativacoes || [])[0];
  }
  return undefined;
}
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

function contasValidas(j: Jogo): number {
  const contas = j.contas || [];
  return contas.filter(c =>
    String(c.email || "").trim() !== "" &&
    String(c.senha || "").trim() !== "" &&
    (c.ativacoes?.length || 0) > 0
  ).length;
}

/* ============================================================
   Importação Excel (flexível)
   ============================================================ */
type ExcelRow = Record<string, any>;

const HEADER_MAP: Record<string, string> = {
  jogo: "jogo",
  jogos: "jogo",
  nome: "jogo",
  titulo: "jogo",
  produto: "jogo",
  product: "jogo",
  descricao: "jogo",
  item: "jogo",
  game: "jogo",
  nome_do_jogo: "jogo",

  data: "data",
  date: "data",
  dt: "data",

  valor: "valor",
  preco: "valor",
  price: "valor",

  ps4: "ps4",
  ps5: "ps5",
  ps4s: "ps4s",
  ps5s: "ps5s",
  ps4_primaria: "ps4",
  ps5_primaria: "ps5",
  ps4_secundaria: "ps4s",
  ps5_secundaria: "ps5s",
  qtd_ps4: "ps4",
  qtd_ps5: "ps5",
  qtd_ps4s: "ps4s",
  qtd_ps5s: "ps5s",
  quantidade_ps4: "ps4",
  quantidade_ps5: "ps5",
  quantidade_ps4s: "ps4s",
  quantidade_ps5s: "ps5s",

  sku_ps4: "sku_ps4",
  sku_ps5: "sku_ps5",
  sku_ps4s: "sku_ps4s",
  sku_ps5s: "sku_ps5s",
  sku: "sku_ps5",

  email: "email",
  nick: "nick",
  senha: "senha",
  ativacoes: "ativacoes",
  ativacao: "ativacoes",
  codigos: "ativacoes",
  codes: "ativacoes",

  midia: "midia",
  plataforma: "plataforma",

  cod: "cod",
  codigo: "cod",
};

function normalizeDateCell(v: any): string {
  if (!v && v !== 0) return new Date().toISOString().slice(0, 10);
  if (typeof v === "number") {
    const d = XLSX.SSF.parse_date_code(v);
    if (d) {
      const dt = new Date(Date.UTC(d.y, (d.m ?? 1) - 1, d.d ?? 1));
      return dt.toISOString().slice(0, 10);
    }
  }
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    const dd = m[1].padStart(2, "0");
    const mm = m[2].padStart(2, "0");
    const yyyy = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${yyyy}-${mm}-${dd}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return new Date().toISOString().slice(0, 10);
}

function toNumber(n: any): number {
  if (n === null || n === undefined || n === "") return 0;
  const x = Number(String(n).replace(",", "."));
  return isNaN(x) ? 0 : x;
}

function excelRowToJogo(row: ExcelRow): Partial<Jogo> & { contas?: ContaJogo[] } {
  const mapped: Record<string, any> = {};
  Object.entries(row).forEach(([key, val]) => {
    const norm = normalizeHeader(key);
    const target = HEADER_MAP[norm] ?? norm;
    mapped[target] = val;
  });

  const jogoNomeOriginal = derivarNomeJogo(mapped) || "(Sem nome)";
  const jogoNome = normalizeGameTitleForMerge(jogoNomeOriginal);

  const data = normalizeDateCell(mapped.data);
  const valor = toNumber(mapped.valor);

  const ps4 = toNumber(mapped.ps4);
  const ps5 = toNumber(mapped.ps5);
  const ps4s = toNumber(mapped.ps4s);
  const ps5s = toNumber(mapped.ps5s);

  const sku_ps4 = normalizeSku(mapped.sku_ps4);
  const sku_ps5 = normalizeSku(mapped.sku_ps5);
  const sku_ps4s = normalizeSku(mapped.sku_ps4s);
  const sku_ps5s = normalizeSku(mapped.sku_ps5s);

  const email = String(mapped.email || "").trim();
  const nick = String(mapped.nick || "").trim();
  const senha = String(mapped.senha || "").trim();
  const ativacoes = splitCodes(mapped.ativacoes);

  let midia: Midia = "PRIMARIA";
  const m = String(mapped.midia || "").trim().toUpperCase();
  if (m === "SECUNDARIA") midia = "SECUNDARIA";

  let plataforma: PlataformaConta = "PS5";
  const p = String(mapped.plataforma || "").trim().toUpperCase();
  if (p === "PS4" || p === "PS5" || p === "PS4S" || p === "PS5S") {
    plataforma = p as PlataformaConta;
  }

  const contas: ContaJogo[] =
    email || nick || senha || (ativacoes?.length ?? 0) > 0
      ? [{ id: uid(), email, nick, senha, ativacoes, midia, plataforma }]
      : [];

  return {
    cod: 0,
    data,
    jogo: jogoNome,
    valor,
    ps4, ps5, ps4s, ps5s,
    sku_ps4, sku_ps5, sku_ps4s, sku_ps5s,
    contas,
  };
}

function upsertJogo(
  base: Jogo[],
  incoming: Partial<Jogo> & { contas?: ContaJogo[] }
): { lista: Jogo[]; created: boolean; updated: boolean } {
  const skus = ["sku_ps4", "sku_ps5", "sku_ps4s", "sku_ps5s"] as const;
  const incSkus = skus.map(k => normalizeSku((incoming as any)[k] || "")).filter(Boolean);

  let idx = -1;

  if (incSkus.length) {
    idx = base.findIndex(j =>
      incSkus.some(sku =>
        normalizeSku(j.sku_ps4) === sku ||
        normalizeSku(j.sku_ps5) === sku ||
        normalizeSku(j.sku_ps4s) === sku ||
        normalizeSku(j.sku_ps5s) === sku
      )
    );
  }

  const incNomeNorm = normalizeGameTitleForMerge(String(incoming.jogo || ""));
  if (idx < 0 && incNomeNorm && incNomeNorm !== "(Sem nome)") {
    idx = base.findIndex(j =>
      normalizeGameTitleForMerge(j.jogo).toLowerCase() === incNomeNorm.toLowerCase()
    );
  }

  const preferExistingSku = (curr?: string, inc?: string) =>
    (curr && normalizeSku(curr)) || normalizeSku(inc || "") || "";

  if (idx < 0) {
    const novo: Jogo = {
      id: uid(),
      cod: 0,
      data: incoming.data || new Date().toISOString().slice(0, 10),
      jogo: incNomeNorm || "(Sem nome)",
      valor: Number(incoming.valor || 0),
      ps4: Number(incoming.ps4 || 0),
      ps5: Number(incoming.ps5 || 0),
      ps4s: Number(incoming.ps4s || 0),
      ps5s: Number(incoming.ps5s || 0),
      sku_ps4: normalizeSku((incoming as any).sku_ps4),
      sku_ps5: normalizeSku((incoming as any).sku_ps5),
      sku_ps4s: normalizeSku((incoming as any).sku_ps4s),
      sku_ps5s: normalizeSku((incoming as any).sku_ps5s),
      contas: incoming.contas || [],
    };
    return { lista: [...base, novo], created: true, updated: false };
  }

  const atual = base[idx];
  const soma = (a?: number, b?: number) => (Number(a || 0) + Number(b || 0));
  const contasMerged =
    (incoming.contas && incoming.contas.length)
      ? [...(atual.contas || []), ...incoming.contas]
      : (atual.contas || []);

  const atualizado: Jogo = {
    ...atual,
    jogo: normalizeGameTitleForMerge(String(atual.jogo || incNomeNorm || "(Sem nome)")),
    data: atual.data || (incoming.data ? String(incoming.data) : atual.data),
    valor: atual.valor && atual.valor !== 0 ? atual.valor : (incoming.valor !== undefined ? Number(incoming.valor) : atual.valor),

    ps4: soma(atual.ps4, incoming.ps4),
    ps5: soma(atual.ps5, incoming.ps5),
    ps4s: soma(atual.ps4s, incoming.ps4s),
    ps5s: soma(atual.ps5s, incoming.ps5s),

    sku_ps4: preferExistingSku(atual.sku_ps4, (incoming as any).sku_ps4),
    sku_ps5: preferExistingSku(atual.sku_ps5, (incoming as any).sku_ps5),
    sku_ps4s: preferExistingSku(atual.sku_ps4s, (incoming as any).sku_ps4s),
    sku_ps5s: preferExistingSku(atual.sku_ps5s, (incoming as any).sku_ps5s),

    contas: contasMerged,
  };

  const nova = [...base];
  nova[idx] = atualizado;
  return { lista: nova, created: false, updated: true };
}

/* ============================================================
   Componente
   ============================================================ */
export function JogosPage() {
  const [lista, setLista] = useState<Jogo[]>(() => getJogosFromStorage());
  const [busca, setBusca] = useState("");

  const listaRef = useRef<Jogo[]>(lista);
  useEffect(() => { listaRef.current = lista; }, [lista]);

  const [form, setForm] = useState<Omit<Jogo, "id" | "cod" | "codes"> & { codes_text?: string }>({
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

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRow, setEditRow] = useState<(Omit<Jogo, "cod">) | null>(null);

  const [modalJogoId, setModalJogoId] = useState<string | null>(null);
  const jogoModal = useMemo(() => lista.find(j => j.id === modalJogoId) || null, [lista, modalJogoId]);

  const [novaConta, setNovaConta] = useState<ContaJogo>({
    id: "",
    email: "",
    nick: "",
    senha: "",
    ativacoes: [],
    midia: "PRIMARIA",
    plataforma: "PS5",
  });
  const [novaContaAtivacoesText, setNovaContaAtivacoesText] = useState<string>("");

  const [editContaId, setEditContaId] = useState<string | null>(null);
  const [editConta, setEditConta] = useState<ContaJogo | null>(null);
  const [editContaAtivText, setEditContaAtivText] = useState<string>("");

  useEffect(() => {
    setJogosToStorage(lista);
  }, [lista]);

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

      const camposContas = (j.contas || []).flatMap(c => [
        c.email, c.nick, c.senha, ...(c.ativacoes || []), c.midia, c.plataforma
      ]).filter(Boolean).map(String);

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
        ativacoes: splitCodes(form.ativacao),
        midia: "PRIMARIA",
        plataforma: "PS5",
      });
    }

    const incoming: Jogo = {
      id: uid(),
      cod: 0,
      jogo: normalizeGameTitleForMerge(form.jogo),
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

    const { lista: mesclada } = upsertJogo(lista, incoming);
    const atualizada = recomputarCod(mesclada);
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

  function excluirTudo() {
    if (!lista.length) return;
    if (!confirm(`Tem certeza que deseja excluir TODOS os ${lista.length} registros? Esta ação não pode ser desfeita.`)) return;
    setLista([]);
    setJogosToStorage([]);
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

  function setEditSku(
    k: "sku_ps4" | "sku_ps5" | "sku_ps4s" | "sku_ps5s",
    v: string
  ) {
    setEditRow(r => (r ? { ...r, [k]: normalizeSku(v) } as any : r));
  }

  function salvarEdicao() {
    if (!editingId || !editRow) return;

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
      jogo: normalizeGameTitleForMerge((editRow as any).jogo || ""),
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

    const semAtual = lista.filter((j) => j.id !== editingId);
    const { lista: mesclada } = upsertJogo(semAtual, normalizada);
    const atualizada = recomputarCod(mesclada);
    setLista(atualizada);
    setEditingId(null);
    setEditRow(null);
  }

  /* ----------------- IMPORTAÇÃO EXCEL ----------------- */
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  function abrirFilePicker() {
    fileInputRef.current?.click();
  }

  function lerCabecalhosDaPlanilha(sheet: XLSX.WorkSheet): string[] {
    const AOA = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, blankrows: false });
    const headerRow = Array.isArray(AOA) && AOA.length ? AOA[0] : [];
    return (headerRow as any[]).map((h) => String(h ?? "").trim()).filter(Boolean);
  }

  function validarCabecalhos(headersRaw: string[]): {
    ok: boolean;
    mapeados: string[];
    normalizados: string[];
    avisoSemNome: boolean;
  } {
    const normalizados = headersRaw.map(normalizeHeader);
    const mapeados = normalizados.map((h) => HEADER_MAP[h] || h);

    const camposUteis = ["jogo","jogos","ps4","ps5","ps4s","ps5s","valor","data","email","senha","nick","ativacoes","sku_ps4","sku_ps5","sku_ps4s","sku_ps5s"];
    const temAlgumUtil = camposUteis.some((c) => mapeados.includes(c) || normalizados.includes(c));

    const avisoSemNome = !mapeados.includes("jogo") &&
                         !["sku_ps4","sku_ps5","sku_ps4s","sku_ps5s"].some(c => mapeados.includes(c));

    return { ok: temAlgumUtil, mapeados, normalizados, avisoSemNome };
  }

  async function onImportFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    try {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;

      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: "array" });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) {
        alert("Não encontrei nenhuma planilha no arquivo.");
        return;
      }

      const headersRaw = lerCabecalhosDaPlanilha(sheet);
      if (!headersRaw.length) {
        alert("Planilha sem cabeçalho. Inclua uma linha de títulos (ex.: Jogos, Data, Valor, PS4, PS5...).");
        return;
      }

      const ver = validarCabecalhos(headersRaw);
      if (!ver.ok) {
        alert(
          "Importação cancelada: não encontrei colunas úteis (ex.: Jogos/Jogo, PS4/PS5/PS4s/PS5s, Valor, Data, Email/Senha, ou SKUs).\n" +
          "Ajuste a planilha e tente novamente."
        );
        console.warn("[Importação] Colunas detectadas:", headersRaw);
        return;
      }

      if (ver.avisoSemNome) {
        console.info(
          "%cImportação: prosseguindo sem coluna de Nome/Jogo nem SKUs — os registros podem ficar '(Sem nome)'.",
          "color:#a67c00"
        );
      }

      const rows: ExcelRow[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });

      let created = 0;
      let updated = 0;
      let errors = 0;
      let ignored = 0;
      let semNome = 0;

      let base = [...lista];

      for (const row of rows) {
        try {
          const partial = excelRowToJogo(row);

          const hasQuant = (partial.ps4 ?? 0) + (partial.ps5 ?? 0) + (partial.ps4s ?? 0) + (partial.ps5s ?? 0) > 0;
          const hasValor = typeof partial.valor === "number" && !Number.isNaN(partial.valor) && partial.valor !== 0;
          const hasConta = (partial.contas && partial.contas.length > 0);
          const hasSku = !!(
            normalizeSku((partial as any).sku_ps4) ||
            normalizeSku((partial as any).sku_ps5) ||
            normalizeSku((partial as any).sku_ps4s) ||
            normalizeSku((partial as any).sku_ps5s)
          );
          const hasNome = String(partial.jogo || "").trim() !== "";

          if (!hasQuant && !hasValor && !hasConta && !hasSku && !hasNome) {
            ignored += 1;
            continue;
          }

          if (!hasNome) semNome += 1;

          const { lista: merged, created: c, updated: u } = upsertJogo(base, partial);
          base = merged;
          if (c) created += 1;
          if (u) updated += 1;
        } catch (err) {
          errors += 1;
        }
      }

      const finalList = recomputarCod(base);
      setLista(finalList);
      setJogosToStorage(finalList);

      console.groupCollapsed(
        `%cImportação Excel: ${file.name}`,
        "color:#0a7b5f;font-weight:600;"
      );
      console.log("Colunas (originais):", headersRaw);
      console.log("Colunas (normalizadas):", ver.normalizados);
      console.log("Colunas (mapeadas):", ver.mapeados);
      console.log("Itens criados:", created);
      console.log("Itens atualizados:", updated);
      console.log("Linhas ignoradas (vazias):", ignored);
      console.log("Linhas sem nome (importadas como '(Sem nome)'):", semNome);
      console.log("Linhas com erro:", errors);
      console.groupEnd();

      if (created === 0 && updated === 0) {
        alert(
          `Nada a importar de "${file.name}".\n` +
          `Vazias/ignoradas: ${ignored}\n` +
          `Erros: ${errors}\n` +
          `Dica: preencha ao menos Quantidades, Valor, Dados de Conta ou SKUs.`
        );
      } else {
        const extra =
          semNome > 0
            ? `\n• ${semNome} registro(s) ficaram com nome "(Sem nome)" — você pode editar depois.`
            : "";
        alert(
          `Importação finalizada de "${file.name}":\n` +
          `• Criados: ${created}\n` +
          `• Atualizados: ${updated}\n` +
          `• Ignorados (vazios): ${ignored}\n` +
          `• Linhas com erro: ${errors}` +
          extra
        );
      }
    } catch (err) {
      console.error(err);
      alert("Falha ao importar o arquivo. Verifique o formato (.xls, .xlsx ou .csv) e tente novamente.");
    }
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
      plataforma: "PS5",
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
      {/* HEADER */}
      <div className="flex flex-col gap-2">
        <h1 className="text-lg sm:text-xl font-semibold text-slate-900">Jogos</h1>
        <p className="text-slate-600 text-sm">
          Cadastre os jogos. O <b>COD</b> é gerado automaticamente pela ordem alfabética de <b>Jogo</b>.
          Os campos <b>PS4/PS5/PS4s/PS5s</b> são <b>quantidades</b>. Códigos ficam nas <b>Contas → Ativações</b>.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={abrirFilePicker}
            className="rounded-lg bg-emerald-600 text-white px-4 py-2 hover:bg-emerald-700 transition"
            title="Importar a planilha exportada do Access (xlsx/xls/csv)"
          >
            Importar Excel (Access)
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={onImportFileChange}
          />
          <span className="text-xs text-slate-500">
            Aceita .xlsx, .xls ou .csv. SKUs podem ficar em branco; “Jogos” é aceito como nome.
          </span>

          <button
            type="button"
            onClick={excluirTudo}
            className="md:ml-auto rounded-lg bg-rose-600 text-white px-4 py-2 hover:bg-rose-700 transition"
            title="Excluir todos os registros"
          >
            Excluir tudo
          </button>
        </div>
      </div>

      {/* BUSCA */}
      <div className="flex flex-col md:flex-row gap-2 md:items-center">
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por jogo, SKU, credenciais ou códigos..."
          className="flex-1 border rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-brand-100"
        />
        <div className="text-sm text-slate-500">{filtrada.length} registro(s)</div>
      </div>

      {/* FORM */}
      <form
        onSubmit={adicionar}
        className="bg-white rounded-2xl shadow-card border border-slate-100 p-4 space-y-4"
      >
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
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

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
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

        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
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
            Se preencher, cria a 1ª conta (PRIMÁRIA) com esses códigos.
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
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

        <div className="flex flex-wrap gap-2">
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

      {/* ======= LISTA MOBILE (cards) ======= */}
      <div className="md:hidden space-y-2">
        {filtrada.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 p-4 text-slate-500 text-center">
            Nenhum registro.
          </div>
        ) : (
          filtrada.map((j) => {
            const emEdicao = editingId === j.id;
            const contas = j.contas || [];
            const totalContasValid = contasValidas(j);
            const totalCodes = contas.reduce((acc, c) => acc + (c.ativacoes?.length || 0), 0);
            const preview = contas.find(c => (c.ativacoes || []).length > 0)?.ativacoes?.[0];

            return (
              <div key={j.id} className="bg-white rounded-xl border border-slate-200 p-3">
                {/* header */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs text-slate-500">COD {j.cod} • {j.data}</div>
                    {!emEdicao ? (
                      <div className="font-medium text-slate-900 truncate">{j.jogo}</div>
                    ) : (
                      <input
                        value={(editRow as any)?.jogo || ""}
                        onChange={(e) => setEditRow((r) => (r ? { ...r, jogo: e.target.value } : r))}
                        className="border rounded px-2 py-1 w-full"
                        placeholder="Nome do jogo"
                      />
                    )}
                  </div>

                  <div className="flex gap-2">
                    {!emEdicao ? (
                      <>
                        <button onClick={() => abrirModal(j)} className="text-brand-700 text-xs underline">Contas</button>
                        <button onClick={() => iniciarEdicao(j)} className="text-brand-700 text-xs underline">Editar</button>
                        <button onClick={() => remover(j.id)} className="text-rose-600 text-xs underline">Excluir</button>
                      </>
                    ) : (
                      <>
                        <button onClick={salvarEdicao} className="text-brand-700 text-xs underline">Salvar</button>
                        <button onClick={cancelarEdicao} className="text-slate-600 text-xs underline">Cancelar</button>
                      </>
                    )}
                  </div>
                </div>

                {/* corpo */}
                <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <div className="text-slate-500">Valor</div>
                    {!emEdicao ? (
                      <div className="font-medium">
                        {j.valor?.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                      </div>
                    ) : (
                      <input
                        type="number" step="0.01" min="0"
                        value={(editRow as any)?.valor ?? 0}
                        onChange={(e) => setEditRow((r) => (r ? { ...r, valor: Number(e.target.value) } : r))}
                        className="border rounded px-2 py-1 w-full"
                      />
                    )}
                  </div>

                  <div>
                    <div className="text-slate-500">Quantidades</div>
                    {!emEdicao ? (
                      <div className="font-medium text-xs">
                        PS4 {j.ps4} • PS5 {j.ps5} • PS4s {j.ps4s} • PS5s {j.ps5s}
                      </div>
                    ) : (
                      <div className="grid grid-cols-4 gap-1">
                        {(["ps4","ps5","ps4s","ps5s"] as const).map(k => (
                          <input
                            key={k}
                            type="number" min={0}
                            value={(editRow as any)?.[k] ?? 0}
                            onChange={(e) =>
                              setEditRow((r) =>
                                r ? ({ ...r, [k]: Number(e.target.value) } as any) : r
                              )
                            }
                            className="border rounded px-2 py-1"
                            placeholder={k.toUpperCase()}
                          />
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="col-span-2">
                    <div className="text-slate-500">SKUs</div>
                    {!emEdicao ? (
                      <div className="text-xs font-medium space-y-0.5">
                        {j.sku_ps4 && <div>PS4: {j.sku_ps4}</div>}
                        {j.sku_ps5 && <div>PS5: {j.sku_ps5}</div>}
                        {j.sku_ps4s && <div>PS4s: {j.sku_ps4s}</div>}
                        {j.sku_ps5s && <div>PS5s: {j.sku_ps5s}</div>}
                        {!j.sku_ps4 && !j.sku_ps5 && !j.sku_ps4s && !j.sku_ps5s && <div>—</div>}
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-2">
                        {(
                          [
                            ["PS4","sku_ps4"],
                            ["PS5","sku_ps5"],
                            ["PS4s","sku_ps4s"],
                            ["PS5s","sku_ps5s"],
                          ] as const
                        ).map(([label,key]) => {
                          const curr = (editRow as any)?.[key] ?? "";
                          const dup = skuDuplicadoNoContexto(lista, editingId, key as any, curr);
                          return (
                            <div key={key} className="flex items-center gap-2">
                              <span className="text-xs w-12 shrink-0 text-slate-600">{label}:</span>
                              <input
                                value={curr}
                                onChange={(e) => setEditSku(key as any, e.target.value)}
                                className="border rounded px-2 py-1 w-full"
                                placeholder={`EAFC26-${label}-P`}
                              />
                              {curr && dup && (
                                <span className="text-[11px] text-amber-700">já existe</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="col-span-2">
                    <div className="text-slate-500">Contas & Códigos</div>
                    <div className="text-xs text-slate-700">
                      Contas válidas: <b>{totalContasValid}</b> • Códigos: <b>{totalCodes}</b> • Próximo: <i>{preview || "—"}</i>
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ======= TABELA DESKTOP ======= */}
      <div className="hidden md:block bg-white rounded-2xl shadow-card border border-slate-100 overflow-x-auto">
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
              const totalContasValid = contasValidas(j);
              const totalCodes = contas.reduce((acc, c) => acc + (c.ativacoes?.length || 0), 0);
              const preview = contas.find(c => (c.ativacoes || []).length > 0)?.ativacoes?.[0] ?? undefined;

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
                    ) : (j.data)}
                  </td>
                  <td className="px-3 py-2">
                    {emEdicao ? (
                      <input
                        value={(editRow as any)?.jogo || ""}
                        onChange={(e) => setEditRow((r) => (r ? { ...r, jogo: e.target.value } : r))}
                        className="border rounded px-2 py-1 w-56"
                      />
                    ) : (j.jogo)}
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
                      ) : ((j as any)[k] || 0)}
                    </td>
                  ))}

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
                          const dup = skuDuplicadoNoContexto(lista, editingId, key as any, curr);
                          return (
                            <div key={key} className="flex items-center gap-2">
                              <span className="w-12 shrink-0 text-slate-600">{label}:</span>
                              <input
                                value={curr}
                                onChange={(e) => setEditSku(key as any, e.target.value)}
                                placeholder={`ex.: EAFC26-${label}-P`}
                                className="border rounded px-2 py-1 w-56"
                              />
                              {curr ? (
                                <button
                                  type="button"
                                  onClick={() => setEditSku(key as any, "")}
                                  className="text-rose-600 hover:underline"
                                  title="Apagar este SKU"
                                >
                                  apagar
                                </button>
                              ) : (
                                <span className="text-slate-400">novo</span>
                              )}
                              {curr && dup && (
                                <span className="text-amber-600" title="Este SKU já existe em outro jogo">
                                  • já existe em outro jogo
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </td>

                  <td className="px-3 py-2 align-top">
                    <div className="text-xs text-slate-700 space-y-0.5">
                      <div>Contas válidas: <b>{totalContasValid}</b></div>
                      <div>Códigos disponíveis: <b>{totalCodes}</b></div>
                      <div className="text-slate-500 mt-1">Próximo: <i>{preview || "—"}</i></div>
                    </div>
                  </td>

                  <td className="px-3 py-2">
                    <button
                      onClick={() => abrirModal(j)}
                      className="text-brand-700 hover:underline"
                    >
                      Ver informações ({(j.contas || []).length})
                    </button>
                  </td>

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
          <div className="relative bg-white rounded-2xl shadow-xl border border-slate-200 p-4
                          w-[calc(100vw-1.5rem)] sm:w-[95vw] max-w-6xl max-h-[85vh] overflow-auto">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-3">
              <div className="min-w-0">
                <h3 className="text-lg font-semibold text-slate-900 truncate">
                  Contas — {jogoModal.jogo}
                </h3>
                <p className="text-slate-600 text-sm">
                  Em cada conta, insira os códigos no campo <b>Ativações</b> (um por linha).
                </p>
              </div>
              <button onClick={fecharModal} className="self-start sm:self-auto rounded-lg border px-3 py-1.5 hover:bg-slate-50">
                Fechar
              </button>
            </div>

            <div className="overflow-x-auto mb-4">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-slate-700">
                  <tr>
                    <th className="text-left px-3 py-2">E-mail</th>
                    <th className="text-left px-3 py-2">Nick</th>
                    <th className="text-left px-3 py-2">Senha</th>
                    <th className="text-left px-3 py-2">Ativações</th>
                    <th className="text-left px-3 py-2">Mídia</th>
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

            <div className="border-t pt-4">
              <h4 className="font-medium text-slate-900 mb-2">Adicionar conta</h4>
              <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
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
