// src/pages/PrecificacaoJogosPage.tsx
import { useEffect, useMemo, useState, useRef } from "react";
import * as XLSX from "xlsx";

/** Modelo de registro de precificação */
export type Precificacao = {
  id: string;
  cod: number;              // gerado por ordem alfabética do Jogo
  jogo: string;             // "Jogo PS4/PS5"
  plataforma: "PS4" | "PS5" | "Ambos";
  valor: number;            // preço de venda (final) = 0.75 * baseDigitado
  revenda: number;          // preço para revenda (final) = 0.75 * valor
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

/* ============================================================
   Utils base
   ============================================================ */
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

// >>> helpers de cálculo (com arredondamento em 2 casas)
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const calcValorFinal = (base: number) => round2((base || 0) * 0.75);
const calcRevendaFinal = (valorFinal: number) => round2((valorFinal || 0) * 0.75);

/* ============================================================
   Normalização de nome (para mesclar)
   - Remove sufixos do tipo: " (jogo 002)", "(JOGO 5)", " (conta 3)" etc.
   - Remove espaços duplicados e trim
   - Case-insensitive
   ============================================================ */
function normalizeGameName(raw: string): string {
  const s = String(raw || "")
    .replace(/\(jogo\s*\d+\)/gi, "")     // remove "(jogo 002)"
    .replace(/\(conta\s*\d+\)/gi, "")    // remove "(conta 3)"
    .replace(/\s+/g, " ")                // colapsa espaços
    .trim();
  return s;
}

/* ============================================================
   Excel helpers
   ============================================================ */
type ExcelRow = Record<string, any>;

function normalizeHeader(h: string): string {
  return (h || "")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^\w_]/g, "");
}

/**
 * Aliases de colunas do Excel -> campos "internos" de parsing.
 * OBS: Aqui mapeamos:
 *  - "Jogo PS4/PS5" (com barra) -> "jogo"
 *  - "PS4" e "PS5" -> preço base por plataforma (valor_ps4 / valor_ps5)
 */
const HEADER_MAP: Record<string, string> = {
  // nome do jogo (suporta "Jogo PS4/PS5" e variantes)
  jogo: "jogo",
  jogos: "jogo",
  jogo_ps4_ps5: "jogo",
  jogops4ps5: "jogo",
  "jogo_ps4/ps5": "jogo", // raridade, após normalize vira "jogo_ps4_ps5"
  nome: "jogo",
  titulo: "jogo",
  produto: "jogo",
  product: "jogo",
  descricao: "jogo",
  descri_o: "jogo",
  item: "jogo",
  game: "jogo",

  // plataforma (caso a planilha traga uma geral)
  plataforma: "plataforma",
  console: "plataforma",
  system: "plataforma",

  // PREÇOS POR PLATAFORMA (na sua planilha PS4/PS5 são preços)
  ps4: "valor_ps4",
  ps5: "valor_ps5",
  preco_ps4: "valor_ps4",
  preco_ps5: "valor_ps5",
  valor_ps4: "valor_ps4",
  valor_ps5: "valor_ps5",

  // fallback: um valor único (se existir em alguma outra planilha)
  valor: "valor_unico",
  preco: "valor_unico",
  pre_o: "valor_unico",
  base: "valor_unico",
  valor_base: "valor_unico",

  // estoques
  ps4est: "ps4Est",
  ps5est: "ps5Est",
  ps4_est: "ps4Est",
  ps5_est: "ps5Est",
  estoque_ps4: "ps4Est",
  estoque_ps5: "ps5Est",

  // promoção
  promo_inicio: "promoInicio",
  promo_fim: "promoFim",
  inicio: "promoInicio",
  fim: "promoFim",

  // país
  pais: "pais",
  pa_s: "pais",
  country: "pais",

  // status
  status: "status",
  disponibilidade: "status",
  disponivel: "status",
  esgotado: "status",

  // idade
  idade_minima: "idadeMinima",
  idade: "idadeMinima",
};

function parsePlataforma(v: any): "PS4" | "PS5" | "Ambos" {
  const s = String(v || "").toUpperCase().trim();
  if (s.includes("AMB")) return "Ambos";
  if (s.includes("PS5")) return "PS5";
  if (s.includes("PS4")) return "PS4";
  return "PS4";
}
function toNum(v: any): number {
  if (v === null || v === undefined || v === "") return 0;
  const x = Number(String(v).replace(",", "."));
  return isNaN(x) ? 0 : x;
}
function toDateIso(v: any): string {
  if (!v && v !== 0) return "";
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
  return "";
}

/**
 * Converte uma linha XLS para 0..N registros (PS4 e/ou PS5).
 * - Usa "Jogo PS4/PS5" -> jogo
 * - Usa colunas "PS4" e "PS5" como PREÇO BASE por plataforma
 * - Se só houver "valor_unico" e uma "plataforma", cria 1 registro
 * - NÃO retorna id/cod/derivados aqui
 */
function excelRowToPrecificacoes(row: ExcelRow): Array<Omit<Precificacao, "id" | "cod" | "estoqueTotal" | "totalValor">> {
  // mapeia cabeçalhos
  const mapped: Record<string, any> = {};
  Object.entries(row).forEach(([key, val]) => {
    const norm = normalizeHeader(key);
    const target = HEADER_MAP[norm] ?? norm;
    mapped[target] = val;
  });

  const jogoRaw = String(mapped.jogo || "").trim() || "(Sem nome)";
  const jogoLimpo = normalizeGameName(jogoRaw);

  // preços base por plataforma
  const basePS4 = toNum(mapped.valor_ps4);
  const basePS5 = toNum(mapped.valor_ps5);
  const baseUnico = toNum(mapped.valor_unico);

  // estoques
  const ps4Est = toNum(mapped.ps4Est);
  const ps5Est = toNum(mapped.ps5Est);

  // datas / país / status / idade
  const promoInicio = toDateIso(mapped.promoInicio);
  const promoFim = toDateIso(mapped.promoFim);
  const pais = String(mapped.pais || "Brasil").trim();
  const statusStr = String(mapped.status || "").toLowerCase();
  const status: "disponivel" | "esgotado" =
    statusStr.includes("esgot") ? "esgotado" : "disponivel";
  const idadeMinima = toNum(mapped.idadeMinima);

  const out: Array<Omit<Precificacao, "id" | "cod" | "estoqueTotal" | "totalValor">> = [];

  // Se vieram colunas PS4/PS5 com preço -> cria por plataforma
  if (basePS4 > 0) {
    const valorFinal = calcValorFinal(basePS4);
    const revendaFinal = calcRevendaFinal(valorFinal);
    out.push({
      jogo: jogoLimpo,
      plataforma: "PS4",
      valor: valorFinal,
      revenda: revendaFinal,
      ps4Est,           // estoque específico de PS4
      ps5Est: 0,
      promoInicio,
      promoFim,
      pais,
      status,
      idadeMinima,
    });
  }
  if (basePS5 > 0) {
    const valorFinal = calcValorFinal(basePS5);
    const revendaFinal = calcRevendaFinal(valorFinal);
    out.push({
      jogo: jogoLimpo,
      plataforma: "PS5",
      valor: valorFinal,
      revenda: revendaFinal,
      ps4Est: 0,
      ps5Est,          // estoque específico de PS5
      promoInicio,
      promoFim,
      pais,
      status,
      idadeMinima,
    });
  }

  // Fallback: não teve PS4/PS5? tenta "valor_unico" + "plataforma"
  if (out.length === 0 && baseUnico > 0) {
    const plat = parsePlataforma(mapped.plataforma);
    const valorFinal = calcValorFinal(baseUnico);
    const revendaFinal = calcRevendaFinal(valorFinal);
    out.push({
      jogo: jogoLimpo,
      plataforma: plat,
      valor: valorFinal,
      revenda: revendaFinal,
      ps4Est, // se veio estoque separado, mantém
      ps5Est,
      promoInicio,
      promoFim,
      pais,
      status,
      idadeMinima,
    });
  }

  return out;
}

/* ============================================================
   Deriva campos e UPERT com mesclagem por nome normalizado + plataforma
   ============================================================ */
function derivar(r: Omit<Precificacao, "estoqueTotal" | "totalValor">): Precificacao {
  const estoqueTotal = (r.ps4Est || 0) + (r.ps5Est || 0);
  const totalValor = (r.valor || 0) * estoqueTotal;
  return { ...r, estoqueTotal, totalValor };
}

/**
 * Mescla por nome normalizado + plataforma.
 * - Se encontrar registro igual: soma estoques, mantém valor/revenda do incoming se forem > 0,
 *   não sobrescreve strings vazias, atualiza datas se vierem preenchidas.
 * - Se não encontrar: cria novo.
 */
function upsertPrecificacao(
  base: Precificacao[],
  incoming: Omit<Precificacao, "estoqueTotal" | "totalValor">
): { lista: Precificacao[]; created: boolean; updated: boolean } {
  const nameKey = normalizeGameName(incoming.jogo).toLowerCase();
  const plataforma = incoming.plataforma;

  const idx = base.findIndex(
    (r) =>
      normalizeGameName(r.jogo).toLowerCase() === nameKey &&
      r.plataforma === plataforma
  );

  if (idx < 0) {
    const novo = derivar(incoming);
    return { lista: recomputarCod([...base, novo]), created: true, updated: false };
  }

  const atual = base[idx];

  // merge conservador
  const merged: Omit<Precificacao, "estoqueTotal" | "totalValor"> = {
    ...atual,
    jogo:
      incoming.jogo && incoming.jogo !== "(Sem nome)"
        ? normalizeGameName(incoming.jogo)
        : atual.jogo,
    plataforma, // mesma plataforma

    // valor/revenda: usa incoming se > 0, senão mantém
    valor: incoming.valor > 0 ? incoming.valor : atual.valor,
    revenda: incoming.revenda > 0 ? incoming.revenda : atual.revenda,

    // soma estoques
    ps4Est: (atual.ps4Est || 0) + (incoming.ps4Est || 0),
    ps5Est: (atual.ps5Est || 0) + (incoming.ps5Est || 0),

    // datas/pais/status/idade: atualiza se vier preenchido
    promoInicio: incoming.promoInicio || atual.promoInicio,
    promoFim: incoming.promoFim || atual.promoFim,
    pais: incoming.pais || atual.pais,
    status: incoming.status || atual.status,
    idadeMinima:
      typeof incoming.idadeMinima === "number" && incoming.idadeMinima > 0
        ? incoming.idadeMinima
        : atual.idadeMinima,

    // mantém id/cod do atual
    id: atual.id,
    cod: 0,
  };

  const nova = [...base];
  nova[idx] = derivar(merged);
  return { lista: recomputarCod(nova), created: false, updated: true };
}

/* ============================================================
   Componente
   ============================================================ */
export function PrecificacaoJogosPage() {
  const [lista, setLista] = useState<Precificacao[]>(() => carregar());
  const [busca, setBusca] = useState("");

  // estado do formulário (aqui o valor é BASE; para import, usamos colunas PS4/PS5)
  const [form, setForm] = useState<Omit<
    Precificacao,
    "id" | "cod" | "estoqueTotal" | "totalValor"
  >>({
    jogo: "",
    plataforma: "PS4",
    valor: 0,   // BASE digitada
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

  // file input ref (import Excel)
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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

  /* ----------------- Derivar e ações CRUD ----------------- */
  function adicionar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!form.jogo.trim()) return;

    const valorFinal = calcValorFinal(form.valor);
    const revendaFinal = calcRevendaFinal(valorFinal);

    const pronto: Omit<Precificacao, "estoqueTotal" | "totalValor"> = {
      id: uid(),
      cod: 0,
      jogo: normalizeGameName(form.jogo),
      plataforma: form.plataforma,
      valor: valorFinal,
      revenda: revendaFinal,
      ps4Est: form.plataforma === "PS4" ? (form.ps4Est || 0) : 0,
      ps5Est: form.plataforma === "PS5" ? (form.ps5Est || 0) : 0,
      promoInicio: form.promoInicio || "",
      promoFim: form.promoFim || "",
      pais: form.pais || "Brasil",
      status: form.status,
      idadeMinima: form.idadeMinima || 0,
    };

    const up = upsertPrecificacao(lista, pronto);
    setLista(up.lista);

    // limpa form (valor volta a ser BASE)
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

  function remover(id: string) {
    if (!confirm("Confirma excluir este registro?")) return;
    const atualizada = recomputarCod(lista.filter((r) => r.id !== id));
    setLista(atualizada);
    if (editingId === id) {
      setEditingId(null);
      setEditRow(null);
    }
  }

  function limparTudo() {
    if (!confirm("⚠️ Esta ação vai excluir TODOS os registros de precificação. Continuar?")) return;
    setLista([]);
  }

  function iniciarEdicao(r: Precificacao) {
    setEditingId(r.id);
    const { cod, estoqueTotal, totalValor, ...resto } = r;

    // Base sugerida para o campo de edição (valor final / 0.75)
    const baseSugerida = r.valor ? round2(r.valor / 0.75) : 0;

    setEditRow({
      ...resto,
      valor: baseSugerida, // o input de edição de "valor" é a BASE
    });
  }
  function cancelarEdicao() {
    setEditingId(null);
    setEditRow(null);
  }
  function salvarEdicao() {
    if (!editingId || !editRow) return;

    const valorFinal = calcValorFinal(editRow.valor);   // 0,75 × base digitada em edição
    const revendaFinal = calcRevendaFinal(valorFinal);  // 0,75 × valor final

    const pronto: Omit<Precificacao, "estoqueTotal" | "totalValor"> = {
      ...editRow,
      id: editingId,
      cod: 0,
      jogo: normalizeGameName(editRow.jogo),
      valor: valorFinal,
      revenda: revendaFinal,
    };

    // aplica mesclagem (caso o nome/plataforma coincidam com outro registro)
    const semAtual = lista.filter((x) => x.id !== editingId);
    const up = upsertPrecificacao(semAtual, pronto);
    setLista(up.lista);
    setEditingId(null);
    setEditRow(null);
  }

  // ---- handlers numéricos
  const setNumForm = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: Number(e.target.value) || 0 }));

  const setNumEdit = (k: keyof NonNullable<typeof editRow>) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setEditRow((r) => (r ? { ...r, [k]: Number(e.target.value) || 0 } : r));

  /* ----------------- Importação Excel ----------------- */
  function abrirFilePicker() {
    fileInputRef.current?.click();
  }

  function lerCabecalhos(sheet: XLSX.WorkSheet): string[] {
    const AOA = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, blankrows: false });
    const headerRow = Array.isArray(AOA) && AOA.length ? AOA[0] : [];
    return (headerRow as any[]).map((h) => String(h ?? "").trim()).filter(Boolean);
  }

  async function onImportFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    try {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;

      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheetName = wb.SheetNames[0];
      const sheet = wb.Sheets[sheetName];
      if (!sheet) {
        alert("Não encontrei nenhuma planilha no arquivo.");
        return;
      }

      const headers = lerCabecalhos(sheet);
      if (!headers.length) {
        alert('Planilha sem cabeçalho. Inclua uma linha de títulos (ex.: "Jogo PS4/PS5", "PS4", "PS5", "PS4est", "PS5est", ...).');
        return;
      }

      const rows: ExcelRow[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });

      let created = 0;
      let updated = 0;
      let errors = 0;
      let ignored = 0;

      let baseLista = [...lista];

      for (const row of rows) {
        try {
          const parcials = excelRowToPrecificacoes(row); // pode retornar 0, 1 ou 2 registros (PS4/PS5)

          if (!parcials.length) {
            ignored += 1;
            continue;
          }

          for (const p of parcials) {
            const pronto: Omit<Precificacao, "estoqueTotal" | "totalValor"> = {
              ...p,
              id: uid(),
              cod: 0,
              jogo: normalizeGameName(p.jogo),
            };

            const r = upsertPrecificacao(baseLista, pronto);
            baseLista = r.lista;
            if (r.created) created += 1;
            if (r.updated) updated += 1;
          }
        } catch {
          errors += 1;
        }
      }

      setLista(baseLista);

      console.groupCollapsed(
        `%cImportação Precificação: ${file.name}`,
        "color:#0a7b5f;font-weight:600;"
      );
      console.log("Colunas (originais):", headers);
      console.log("Prévia (primeiros 5):", baseLista.slice(0, 5));
      console.groupEnd();

      if (created === 0 && updated === 0) {
        alert(
          `Nada a importar de "${file.name}".\n` +
          `Ignoradas (vazias ou sem preço): ${ignored}\n` +
          `Erros: ${errors}`
        );
      } else {
        alert(
          `Importação finalizada de "${file.name}":\n` +
          `• Criados: ${created}\n` +
          `• Atualizados/mesclados: ${updated}\n` +
          `• Ignorados (vazios/sem preço): ${ignored}\n` +
          `• Linhas com erro: ${errors}`
        );
      }
    } catch (err) {
      console.error(err);
      alert("Falha ao importar o arquivo. Verifique o formato (.xls, .xlsx ou .csv) e tente novamente.");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Precificação de Jogos</h1>
          <p className="text-slate-600 text-sm">
            Importa preços por plataforma a partir de planilhas onde <b>“Jogo PS4/PS5”</b> é o nome do jogo e as colunas <b>PS4</b> e <b>PS5</b> são os <b>preços</b>.
            Ao importar/adicionar, registros com o <b>mesmo jogo</b> (normalizado, sem sufixos como “(jogo 002)”) e a <b>mesma plataforma</b> são <b>mesclados</b>.
          </p>

          <div className="flex items-center gap-3 mt-3">
            <button
              type="button"
              onClick={abrirFilePicker}
              className="rounded-lg bg-emerald-600 text-white px-4 py-2 hover:bg-emerald-700 transition"
              title="Importar planilha (.xlsx/.xls/.csv)"
            >
              Importar Excel
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={onImportFileChange}
            />
            <span className="text-xs text-slate-500">
              Cabeçalhos esperados (ou equivalentes): <i>Jogo PS4/PS5</i>, <i>PS4</i>, <i>PS5</i>, <i>PS4est</i>, <i>PS5est</i>, <i>Promo_Inicio</i>, <i>Promo_Fim</i>, <i>País</i>, <i>Status</i>, <i>Idade_Mínima</i>.
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={limparTudo}
            className="rounded-lg border border-rose-200 text-rose-700 px-3 py-2 hover:bg-rose-50"
            title="Excluir todos os registros de precificação"
          >
            Limpar tudo
          </button>
        </div>
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
            {/* Campo é a BASE (será convertido ao salvar) */}
            <label className="text-sm block mb-1">Valor (R$)</label>
            <input
              type="number"
              step="0.01"
              value={form.valor}
              onChange={setNumForm("valor")}
              className="w-full border rounded-lg px-3 py-2"
              placeholder="0,00"
            />
            <div className="text-[11px] text-slate-500 mt-1">
              Será salvo: {fmtBRL(calcValorFinal(form.valor))} | Revenda: {fmtBRL(calcRevendaFinal(calcValorFinal(form.valor)))}
            </div>
          </div>
          <div>
            <label className="text-sm block mb-1">Revenda (R$)</label>
            <input
              type="number"
              step="0.01"
              value={calcRevendaFinal(calcValorFinal(form.valor))}
              readOnly
              className="w-full border rounded-lg px-3 py-2 bg-slate-50"
              placeholder="0,00"
              title="Revenda é calculada automaticamente (0,75 × Valor salvo)"
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
            Adicionar / Mesclar
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
                  <td className="px-3 py-2 text-right">{emEdicao ? (
                    <input
                      type="number" step="0.01" value={editRow?.valor ?? 0}
                      onChange={setNumEdit("valor")}
                      className="border rounded px-2 py-1 w-28 text-right"
                      title="Digite o valor base; o valor salvo será 0,75 × base"
                    />
                  ) : fmtBRL(r.valor)}</td>
                  <td className="px-3 py-2 text-right">
                    {emEdicao ? (
                      <input
                        type="number" step="0.01" value={calcRevendaFinal(calcValorFinal(editRow?.valor ?? 0))}
                        readOnly
                        className="border rounded px-2 py-1 w-28 text-right bg-slate-50"
                        title="Revenda é 0,75 × Valor (final)"
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
