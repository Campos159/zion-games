// src/pages/ClientesPage.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import {
  listarPedidos,
  listarItens,
  type PedidoRead,
  type ItemRead,
} from "../services/pedidos";

/* ============================================================
   Tipos locais
   ============================================================ */
export type Cliente = {
  id: string;
  cod: number;
  nome: string;
  telefone: string;
  data: string;
  email: string;
};

const STORAGE_KEY = "zion.clientes";
const COMPRAS_STORAGE_KEY = "zion.clientes.compras";

/* ============================================================
   Helpers utilitários
   ============================================================ */
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
  const d = soDigitos(v).slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/** Escolhe o telefone "melhor": prioriza o com mais dígitos (sem máscara) */
function pickMelhorTelefone(a: string, b: string) {
  const da = soDigitos(a).length;
  const db = soDigitos(b).length;
  return db > da ? b : a;
}

/** Data ISO yyyy-mm-dd a partir de cell, número (excel) ou string comum */
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

function toNumber(n: any): number {
  if (n === null || n === undefined || n === "") return 0;
  const x = Number(String(n).replace(",", "."));
  return isNaN(x) ? 0 : x;
}

/* ============================================================
   Tipos de pedido/compra (para o histórico)
   ============================================================ */
type Compra = {
  pedidoId: number;
  pedidoCodigo?: string | null;
  dataPedido: string; // yyyy-mm-dd
  item: ItemRead;
};

/* ============================================================
   Compras locais (vindas da planilha)
   ============================================================ */
type CompraLocal = {
  id: string;
  data: string; // yyyy-mm-dd
  clienteEmail: string;
  clienteNome: string;
  clienteTelefone: string;

  nome_produto: string;
  plataforma?: string | null;
  valor_pago?: number;

  email_conta?: string;
  senha_conta?: string;
  nick_conta?: string;
  codigo_ativacao?: string;
};

function loadComprasLocais(): CompraLocal[] {
  try {
    const raw = localStorage.getItem(COMPRAS_STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
function saveComprasLocais(items: CompraLocal[]) {
  localStorage.setItem(COMPRAS_STORAGE_KEY, JSON.stringify(items));
}

/* ============================================================
   Fallback local (zion.jogos) caso backend não preencha conta
   ============================================================ */
type Midia = "PRIMARIA" | "SECUNDARIA";
type PlataformaKey = "ps4" | "ps5" | "ps4s" | "ps5s";
type PlataformaConta = "PS4" | "PS5" | "PS4s" | "PS5s";

type ContaJogoLS = {
  id: string;
  email: string;
  nick: string;
  senha: string;
  ativacoes: string[];
  midia: Midia;
  plataforma?: PlataformaConta;
};
type JogoLS = {
  id: string;
  jogo: string;
  sku_ps4?: string;
  sku_ps5?: string;
  sku_ps4s?: string;
  sku_ps5s?: string;
  contas?: ContaJogoLS[];
};

const JOGOS_STORAGE_KEY = "zion.jogos";

function normalizeSku(s: string | undefined | null): string {
  return (s ?? "").toString().trim().replace(/\s+/g, "");
}

function loadJogosLS(): JogoLS[] {
  try {
    const raw = localStorage.getItem(JOGOS_STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function plataformaFromItem(plataformaItem?: string | null): PlataformaKey | null {
  const p = String(plataformaItem || "").trim();
  if (!p) return null;
  if (p === "PS4") return "ps4";
  if (p === "PS5") return "ps5";
  if (p === "PS4s") return "ps4s";
  if (p === "PS5s") return "ps5s";
  const low = p.toLowerCase();
  if (low.includes("ps4") && low.includes("sec")) return "ps4s";
  if (low.includes("ps4")) return "ps4";
  if (low.includes("ps5") && low.includes("sec")) return "ps5s";
  if (low.includes("ps5")) return "ps5";
  return null;
}
function midiaFromPlataformaKey(pk: PlataformaKey | null): Midia | null {
  if (!pk) return null;
  return pk === "ps4s" || pk === "ps5s" ? "SECUNDARIA" : "PRIMARIA";
}
function contaPlataformaFromKey(pk: PlataformaKey): PlataformaConta {
  if (pk === "ps4") return "PS4";
  if (pk === "ps5") return "PS5";
  if (pk === "ps4s") return "PS4s";
  return "PS5s";
}
function findBySkuLS(
  skuRaw: string
): { jogo: JogoLS; plataforma: PlataformaKey } | null {
  const sku = normalizeSku(skuRaw);
  if (!sku) return null;
  const lista = loadJogosLS();
  for (const j of lista) {
    if (normalizeSku(j.sku_ps4) === sku) return { jogo: j, plataforma: "ps4" };
    if (normalizeSku(j.sku_ps5) === sku) return { jogo: j, plataforma: "ps5" };
    if (normalizeSku(j.sku_ps4s) === sku) return { jogo: j, plataforma: "ps4s" };
    if (normalizeSku(j.sku_ps5s) === sku) return { jogo: j, plataforma: "ps5s" };
  }
  return null;
}
function pickContaByMidiaAndPlataformaLS(
  jogo: JogoLS,
  midia: Midia | null,
  plataformaKey: PlataformaKey | null
): ContaJogoLS | undefined {
  const contas = jogo.contas || [];
  if (!contas.length) return undefined;
  if (!midia || !plataformaKey) {
    return (
      contas.find((c) => (c.ativacoes?.length || 0) > 0) ||
      contas[0]
    );
  }
  const alvoPlataforma = contaPlataformaFromKey(plataformaKey);
  let c =
    contas.find(
      (x) =>
        x.midia === midia &&
        x.plataforma === alvoPlataforma &&
        (x.ativacoes?.length || 0) > 0
    ) ||
    contas.find((x) => x.midia === midia && x.plataforma === alvoPlataforma) ||
    contas.find((x) => x.midia === midia && (x.ativacoes?.length || 0) > 0) ||
    contas.find((x) => x.midia === midia) ||
    contas.find((x) => (x.ativacoes?.length || 0) > 0) ||
    contas[0];
  return c;
}
function enrichItemFromLocalIfEmpty(item: ItemRead): ItemRead {
  const precisa =
    !item?.email_conta ||
    !item?.senha_conta ||
    !item?.nick_conta ||
    !item?.codigo_ativacao;
  if (!precisa) return item;
  const sku = normalizeSku(item.sku || "");
  if (!sku) return item;
  const hit = findBySkuLS(sku);
  if (!hit) return item;
  const plataformaKey = plataformaFromItem(item.plataforma || null);
  const midia = midiaFromPlataformaKey(plataformaKey);
  const conta = pickContaByMidiaAndPlataformaLS(hit.jogo, midia, plataformaKey);
  if (!conta) return item;
  return {
    ...item,
    email_conta: item.email_conta || conta.email || "",
    senha_conta: item.senha_conta || conta.senha || "",
    nick_conta: item.nick_conta || conta.nick || "",
    codigo_ativacao: item.codigo_ativacao || (conta.ativacoes?.[0] || ""),
  };
}

/* ============================================================
   Excel Import para Clientes + Compras
   ============================================================ */
type ExcelRow = Record<string, any>;

/* Normalização de cabeçalhos (remove acentos e pontuação) */
function normalizeHeader(h: string): string {
  return (h || "")
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

/* Aliases (inclui variações de “código de ativação”) */
const HEADER_MAP: Record<string, string> = {
  // conta
  email: "email_conta",
  senha: "senha_conta",
  nick: "nick_conta",
  jogo: "jogo",
  valor: "valor_pago",
  midia: "plataforma",
  plataforma: "plataforma",

  // ativação
  ativacao: "ativacao",
  codigo_ativacao: "ativacao",
  cod_ativacao: "ativacao",
  codigo_de_ativacao: "ativacao",

  // cliente
  cliente: "cliente_nome",
  nome: "cliente_nome",
  telefone: "cliente_telefone",
  tel: "cliente_telefone",
  celular: "cliente_telefone",
  endereco: "cliente_email",
  e_mail: "cliente_email",
  email_cliente: "cliente_email",
  "e-mail": "cliente_email",
  data: "data",
  dt: "data",
};

function mapRow(row: ExcelRow): Record<string, any> {
  const mapped: Record<string, any> = {};
  Object.entries(row).forEach(([k, v]) => {
    const norm = normalizeHeader(k);
    const target = HEADER_MAP[norm] ?? norm;
    mapped[target] = v;
  });
  return mapped;
}

function rowToCliente(mapped: Record<string, any>): Omit<Cliente, "id" | "cod"> | null {
  const nome = String(mapped.cliente_nome || "").trim();
  const email = String(mapped.cliente_email || "").trim().toLowerCase();
  const telefoneRaw = String(mapped.cliente_telefone || "").trim();
  const data = toDateIso(mapped.data) || new Date().toISOString().slice(0, 10);

  if (!nome && !email && !telefoneRaw) return null;

  return {
    nome: nome || "(Sem nome)",
    telefone: formatTelefone(telefoneRaw),
    data,
    email,
  };
}

function rowToCompraLocal(mapped: Record<string, any>): CompraLocal | null {
  const jogo = String(mapped.jogo || "").trim();
  const plataforma = String(mapped.plataforma || "").trim() || null;
  const valor_pago = toNumber(mapped.valor_pago);
  const email_conta = String(mapped.email_conta || "").trim();
  const senha_conta = String(mapped.senha_conta || "").trim();
  const nick_conta = String(mapped.nick_conta || "").trim();
  const codigo_ativacao = String(mapped.ativacao || "").trim();

  const clienteEmail = String(mapped.cliente_email || "").trim().toLowerCase();
  const clienteNome = String(mapped.cliente_nome || "").trim();
  const clienteTelefone = formatTelefone(String(mapped.cliente_telefone || "").trim());
  const data = toDateIso(mapped.data) || new Date().toISOString().slice(0, 10);

  const hasCompraInfo =
    jogo || plataforma || valor_pago || email_conta || senha_conta || nick_conta || codigo_ativacao;
  if (!hasCompraInfo) return null;

  return {
    id: uid(),
    data,
    clienteEmail,
    clienteNome,
    clienteTelefone,
    nome_produto: jogo || "(Sem jogo)",
    plataforma,
    valor_pago: valor_pago || undefined,
    email_conta: email_conta || undefined,
    senha_conta: senha_conta || undefined,
    nick_conta: nick_conta || undefined,
    codigo_ativacao: codigo_ativacao || undefined,
  };
}

/** Mescla clientes (email > nome+telefone) */
function upsertCliente(base: Cliente[], incoming: Omit<Cliente, "cod">): {
  lista: Cliente[];
  created: boolean;
  updated: boolean;
} {
  const emailKey = (incoming.email || "").trim().toLowerCase();
  const nomeKey = (incoming.nome || "").trim().toLowerCase();
  const telKey = soDigitos(incoming.telefone || "");

  let idx = -1;

  if (emailKey) {
    idx = base.findIndex((c) => (c.email || "").trim().toLowerCase() === emailKey);
  }
  if (idx < 0 && nomeKey && telKey) {
    idx = base.findIndex(
      (c) =>
        (c.nome || "").trim().toLowerCase() === nomeKey &&
        soDigitos(c.telefone || "") === telKey
    );
  }

  if (idx < 0) {
    const novo: Cliente = { ...incoming, id: incoming.id || uid(), cod: 0 };
    return { lista: recomputarCod([...base, novo]), created: true, updated: false };
  }

  const atual = base[idx];

  const melhorNome =
    incoming.nome && incoming.nome !== "(Sem nome)" ? incoming.nome : atual.nome;

  const melhorTelefone = formatTelefone(
    pickMelhorTelefone(atual.telefone || "", incoming.telefone || "")
  );

  const dataMaisRecente =
    (incoming.data || "") > (atual.data || "") ? incoming.data : atual.data;

  const merged: Cliente = {
    ...atual,
    nome: melhorNome,
    telefone: melhorTelefone,
    data: dataMaisRecente || atual.data || new Date().toISOString().slice(0, 10),
    email: (emailKey && !atual.email) ? emailKey : (atual.email || emailKey || ""),
  };

  const nova = [...base];
  nova[idx] = merged;
  return { lista: recomputarCod(nova), created: false, updated: true };
}

/* ============================================================
   Componente
   ============================================================ */
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

  // file input para Excel
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
    const base = recomputarCod(lista);
    if (!q) return base;
    return base.filter((c) =>
      [c.nome, c.telefone, c.email].some((x) => x?.toLowerCase().includes(q))
    );
  }, [lista, busca]);

  // ---- criar
  function adicionar(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!form.nome.trim() && !form.email.trim() && !form.telefone.trim()) return;

    const incoming: Omit<Cliente, "cod"> = {
      id: uid(),
      ...form,
      telefone: formatTelefone(form.telefone),
      email: (form.email || "").trim().toLowerCase(),
    };

    const { lista: merged } = upsertCliente(lista, incoming);
    setLista(merged);

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
    if (editingId === id) setEditingId(null), setEditRow(null);
  }

  function limparTudo() {
    if (!confirm("⚠️ Esta ação vai excluir TODOS os clientes. Continuar?")) return;
    setLista([]);
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

    const incoming: Omit<Cliente, "cod"> = {
      ...editRow,
      id: editingId,
      telefone: formatTelefone(editRow.telefone),
      email: (editRow.email || "").trim().toLowerCase(),
    };

    const semAtual = lista.filter((x) => x.id !== editingId);
    const { lista: merged } = upsertCliente(semAtual, incoming);
    setLista(merged);
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

  /* ======================== Import Excel ======================== */
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
        alert('Planilha sem cabeçalho. Inclua uma linha de títulos (ex.: "cliente", "telefone", "endereço", "data"...).');
        return;
      }

      const rows: ExcelRow[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });

      let created = 0;
      let updated = 0;
      let errors = 0;
      let ignored = 0;

      let baseClientes = [...lista];
      let baseCompras = loadComprasLocais();

      for (const row of rows) {
        try {
          const mapped = mapRow(row);

          // cliente
          const parcialCliente = rowToCliente(mapped);
          if (!parcialCliente) {
            ignored += 1;
            continue;
          }

          const incomingCliente: Omit<Cliente, "cod"> = {
            id: uid(),
            ...parcialCliente,
          };
          const r = upsertCliente(baseClientes, incomingCliente);
          baseClientes = r.lista;
          if (r.created) created += 1;
          if (r.updated) updated += 1;

          // compra local (uma por linha)
          const compra = rowToCompraLocal(mapped);
          if (compra) baseCompras.push(compra);
        } catch {
          errors += 1;
        }
      }

      setLista(baseClientes);
      saveComprasLocais(baseCompras);

      console.groupCollapsed(
        `%cImportação Clientes/Compras: ${file.name}`,
        "color:#0a7b5f;font-weight:600;"
      );
      console.log("Colunas (originais):", headers);
      console.log("Prévia clientes (primeiros 5):", baseClientes.slice(0, 5));
      console.log("Total de compras locais:", baseCompras.length);
      console.groupEnd();

      if (created === 0 && updated === 0) {
        alert(
          `Nada a importar de "${file.name}".\n` +
          `Ignoradas: ${ignored}\n` +
          `Erros: ${errors}`
        );
      } else {
        alert(
          `Importação finalizada de "${file.name}":\n` +
          `• Clientes criados: ${created}\n` +
          `• Clientes atualizados/mesclados: ${updated}\n` +
          `• Linhas ignoradas: ${ignored}\n` +
          `• Linhas com erro: ${errors}\n` +
          `• Compras locais (acumuladas): ${loadComprasLocais().length}`
        );
      }
    } catch (err) {
      console.error(err);
      alert("Falha ao importar o arquivo. Verifique o formato (.xls, .xlsx ou .csv) e tente novamente.");
    }
  }

  /* ======================== HISTÓRICO (MODAL) ======================== */
  const [historicoOpen, setHistoricoOpen] = useState(false);
  const [clienteSel, setClienteSel] = useState<Cliente | null>(null);
  const [compras, setCompras] = useState<Compra[]>([]);
  const [loadingCompras, setLoadingCompras] = useState(false);
  const [erroCompras, setErroCompras] = useState<string | null>(null);
  const [itemAbertoId, setItemAbertoId] = useState<number | null>(null);

  function normalizaEmail(s: string) {
    return (s || "").trim().toLowerCase();
  }

  // garantir boolean com '!!' nas strings quando necessário
  function matchCompraLocalComCliente(c: Cliente, x: CompraLocal): boolean {
    const ce = normalizaEmail(c.email);
    const xe = normalizaEmail(x.clienteEmail);
    if (ce && xe && ce === xe) return true;
    const cn = (c.nome || "").trim().toLowerCase();
    const xn = (x.clienteNome || "").trim().toLowerCase();
    const ct = soDigitos(c.telefone || "");
    const xt = soDigitos(x.clienteTelefone || "");
    return !xe && !!cn && !!xn && !!ct && !!xt && cn === xn && ct === xt;
  }

  async function abrirHistorico(c: Cliente) {
    setClienteSel(c);
    setHistoricoOpen(true);
    setCompras([]);
    setErroCompras(null);
    setItemAbertoId(null);

    try {
      setLoadingCompras(true);

      // Backend
      const allPedidos: PedidoRead[] = await listarPedidos();

      const alvoEmail = normalizaEmail(c.email);
      const alvoNome = (c.nome || "").trim().toLowerCase();

      const pedidosDoCliente = allPedidos.filter((p) => {
        const pe = normalizaEmail(p.cliente_email || "");
        const pn = (p.cliente_nome || "").trim().toLowerCase();
        return (alvoEmail && pe === alvoEmail) || (!alvoEmail && pn === alvoNome);
      });

      const entradasBackend: Compra[] = [];
      for (const p of pedidosDoCliente) {
        const items = await listarItens(p.id);
        for (const it of items) {
          const enriched = enrichItemFromLocalIfEmpty(it);
          const dataItem = (it as any).data_envio || p.data_criacao;
          entradasBackend.push({
            pedidoId: p.id,
            pedidoCodigo: p.codigo ?? null,
            dataPedido: dataItem,
            item: enriched,
          });
        }
      }

      // Locais
      const todasLocais = loadComprasLocais();
      const locaisDoCliente = todasLocais.filter((x) => matchCompraLocalComCliente(c, x));

      const entradasLocais: Compra[] = locaisDoCliente.map((x, idx) => {
        const fakeItem: ItemRead = {
          id: Number(`${Date.parse(x.data || "1970-01-01") % 1e6}${idx}`) || idx + 1,
          nome_produto: x.nome_produto || "(Sem jogo)",
          plataforma: x.plataforma || "",
          email_conta: x.email_conta || "",
          senha_conta: x.senha_conta || "",
          nick_conta: x.nick_conta || "",
          codigo_ativacao: x.codigo_ativacao || "",
          quantidade: 1,
          enviado: true,
          // @ts-ignore demais campos
        } as ItemRead;

        return {
          pedidoId: -1,
          pedidoCodigo: "PLANILHA",
          dataPedido: x.data || "",
          item: fakeItem,
        };
      });

      const merged = [...entradasBackend, ...entradasLocais].sort((a, b) => {
        if ((a.dataPedido || "") === (b.dataPedido || "")) {
          const aid = (a.item as any).id as number;
          const bid = (b.item as any).id as number;
          return aid - bid;
        }
        return (a.dataPedido || "") < (b.dataPedido || "") ? 1 : -1;
      });

      setCompras(merged);
    } catch (e: any) {
      console.error(e);
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

  /* ============================================================
     Render
     ============================================================ */
  return (
    <div className="space-y-6">
      {/* HEADER */}
      <div className="flex flex-col sm:flex-row items-start justify-between gap-4">
        <div className="w-full">
          <h1 className="text-lg sm:text-xl font-semibold text-slate-900">Clientes</h1>
          <p className="text-slate-600 text-sm">
            Importe clientes e suas compras. <b>cliente</b> = nome, <b>telefone</b> = contato,
            <b> endereço</b> = e-mail do cliente. Campos da conta (email/senha/nick/jogo/valor/mídia/ativação)
            viram compras no histórico.
          </p>

          <div className="flex flex-wrap items-center gap-3 mt-3">
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
              Cabeçalhos: <i>cliente</i>, <i>telefone</i>, <i>endereço</i>, <i>data</i>, e também
              <i> email</i>/<i>senha</i>/<i>nick</i>/<i>jogo</i>/<i>valor</i>/<i>mídia</i>/<i>ativação</i>.
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          <button
            type="button"
            onClick={limparTudo}
            className="rounded-lg border border-rose-200 text-rose-700 px-3 py-2 hover:bg-rose-50"
            title="Excluir todos os clientes"
          >
            Limpar tudo
          </button>
        </div>
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
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="md:col-span-2">
            <label className="text-sm block mb-1">Nome</label>
            <input
              value={form.nome}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setForm((f) => ({ ...f, nome: e.target.value }))
              }
              className="w-full border rounded-lg px-3 py-2"
              placeholder="Nome completo"
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
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
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

        <div className="flex flex-wrap gap-2">
          <button className="rounded-lg bg-brand-600 text-white px-4 py-2 hover:bg-brand-700 transition">
            Adicionar / Mesclar
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

      {/* ======= LISTA MOBILE (cards) ======= */}
      <div className="md:hidden space-y-2">
        {filtrada.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 p-4 text-slate-500 text-center">
            Nenhum registro.
          </div>
        ) : (
          filtrada.map((c) => {
            const emEdicao = editingId === c.id;
            return (
              <div key={c.id} className="bg-white rounded-xl border border-slate-200 p-3">
                {/* Header do cartão */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs text-slate-500">COD {c.cod}</div>
                    {!emEdicao ? (
                      <div className="font-medium text-slate-900 truncate">{c.nome}</div>
                    ) : (
                      <input
                        value={editRow?.nome || ""}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                          setEditRow((r) => (r ? { ...r, nome: e.target.value } : r))
                        }
                        className="border rounded px-2 py-1 w-full"
                        placeholder="Nome"
                      />
                    )}
                  </div>

                  <div className="flex gap-2">
                    {!emEdicao ? (
                      <>
                        <button
                          onClick={() => abrirHistorico(c)}
                          className="text-brand-700 text-xs underline"
                        >
                          Histórico
                        </button>
                        <button
                          onClick={() => iniciarEdicao(c)}
                          className="text-brand-700 text-xs underline"
                        >
                          Editar
                        </button>
                        <button
                          onClick={() => remover(c.id)}
                          className="text-red-600 text-xs underline"
                        >
                          Excluir
                        </button>
                      </>
                    ) : (
                      <>
                        <button onClick={salvarEdicao} className="text-brand-700 text-xs underline">
                          Salvar
                        </button>
                        <button onClick={cancelarEdicao} className="text-slate-600 text-xs underline">
                          Cancelar
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Campos do cartão */}
                <div className="mt-2 grid grid-cols-1 gap-2 text-sm">
                  <div>
                    <div className="text-slate-500">Telefone</div>
                    {!emEdicao ? (
                      <div className="font-medium">{c.telefone || "—"}</div>
                    ) : (
                      <input
                        value={editRow?.telefone || ""}
                        onChange={onChangeTelefoneEdit}
                        inputMode="numeric"
                        className="border rounded px-2 py-1 w-full"
                        placeholder="Telefone"
                      />
                    )}
                  </div>
                  <div>
                    <div className="text-slate-500">Data</div>
                    {!emEdicao ? (
                      <div className="font-medium">{c.data}</div>
                    ) : (
                      <input
                        type="date"
                        value={editRow?.data || ""}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                          setEditRow((r) => (r ? { ...r, data: e.target.value } : r))
                        }
                        className="border rounded px-2 py-1 w-full"
                      />
                    )}
                  </div>
                  <div>
                    <div className="text-slate-500">E-mail</div>
                    {!emEdicao ? (
                      <div className="font-medium break-all">{c.email || "—"}</div>
                    ) : (
                      <input
                        type="email"
                        value={editRow?.email || ""}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                          setEditRow((r) => (r ? { ...r, email: e.target.value } : r))
                        }
                        className="border rounded px-2 py-1 w-full"
                        placeholder="E-mail"
                      />
                    )}
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
      {historicoOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          {/* backdrop */}
          <div
            className="absolute inset-0 bg-black/40"
            onClick={fecharHistorico}
          />
          {/* card */}
          <div className="relative bg-white rounded-2xl shadow-xl border border-slate-200 mx-3
                          w-[calc(100vw-1.5rem)] sm:w-[95vw] max-w-4xl
                          max-h-[85vh] overflow-hidden">
            <div className="p-4 border-b flex items-center justify-between">
              <div className="min-w-0">
                <h3 className="font-semibold text-slate-900 truncate">
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
                  {compras.map((c, idx) => {
                    const itId = (c.item as any).id as number;
                    const aberto = itemAbertoId === itId;

                    // normaliza "enviado" para boolean sem erro de tipo
                    const rawEnviado: unknown = (c.item as any).enviado;
                    const enviadoBool =
                      rawEnviado === true ||
                      rawEnviado === 1 ||
                      String(rawEnviado).toLowerCase() === "true";

                    return (
                      <div key={`${c.pedidoId}-${itId}-${idx}`} className="border rounded-lg">
                        <button
                          onClick={() =>
                            setItemAbertoId((id) => (id === itId ? null : itId))
                          }
                          className="w-full text-left px-3 py-2 flex items-center justify-between hover:bg-slate-50"
                        >
                          <div className="flex flex-col">
                            <span className="font-medium text-slate-900">
                              {c.item.nome_produto}{" "}
                              <span className="text-slate-500">({c.item.plataforma})</span>
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
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
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
                                <div className="font-medium">{(c.item as any).quantidade ?? 1}</div>
                              </div>
                              <div>
                                <div className="text-slate-500">Enviado</div>
                                <div className="font-medium">{enviadoBool ? "Sim" : "Não"}</div>
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
      ) : null}
    </div>
  );
}
