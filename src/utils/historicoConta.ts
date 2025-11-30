// src/utils/historicoConta.ts
import {
  listarPedidos,
  listarItens,
  type PedidoRead,
  type ItemRead,
  type Plataforma,
} from "../services/pedidos";
import { obterContaVinculadaAoPedidoSku } from "../services/jogos";

/* ============================================================
   Tipos básicos
   ============================================================ */

export type Midia = "PRIMARIA" | "SECUNDARIA";

export type HistoricoContaVenda = {
  // identificação básica
  pedidoId: number;
  itemId: number;
  quando: string; // data de referência (envio ou criação)

  // cliente
  clienteNome: string;
  clienteEmail: string;
  clienteTelefone?: string | null;

  // produto / item
  nomeProduto: string;
  sku?: string | null;
  plataformaItem: Plataforma; // PS4 | PS4s | PS5 | PS5s
  midiaItem: Midia;           // PRIMARIA | SECUNDARIA

  // conta PSN
  contaEmail?: string | null;
  contaNick?: string | null;
  contaSenha?: string | null;
  codigoAtivacao?: string | null;

  // extras
  pedido?: PedidoRead;
  item?: ItemRead;

  // p/ casar com histórico legado salvo por conta
  contaId?: string;
};

export type ContaHistoricoInput = {
  id: string;
  email: string;
  nick: string;
  senha: string;
  midia: Midia;
  plataforma: "PS4" | "PS5" | "PS4s" | "PS5s";
};

/* ============================================================
   Helpers gerais
   ============================================================ */

function hasWindow() {
  return typeof window !== "undefined";
}
function hasLocalStorage() {
  return hasWindow() && typeof window.localStorage !== "undefined";
}

/** PS4/PS5 = primária ; PS4s/PS5s = secundária */
function inferMidiaFromPlataforma(p: Plataforma): Midia {
  if (p === "PS4s" || p === "PS5s") return "SECUNDARIA";
  return "PRIMARIA";
}

function normalizeEmail(v: string | null | undefined): string {
  return (v || "").trim().toLowerCase();
}

/* ============================================================
   Fallback local (zion.jogos) — MESMA IDEIA DO ClientesPage
   ============================================================ */

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
  if (!hasLocalStorage()) return [];
  try {
    const raw = window.localStorage.getItem(JOGOS_STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/** Busca uma conta específica pelo ID dentro do zion.jogos */
function findContaByIdLS(contaId: string): ContaJogoLS | null {
  if (!contaId || !hasLocalStorage()) return null;
  const jogos = loadJogosLS();
  for (const j of jogos) {
    const c = j.contas?.find((x) => x.id === contaId);
    if (c) return c;
  }
  return null;
}

function plataformaFromItem(plataformaItem?: Plataforma | string | null): PlataformaKey | null {
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
  const conta =
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

  return conta;
}

/**
 * COMPLETA email/senha/nick/código a partir de zion.jogos, MAS:
 * - Se vier contaId (vínculo pedido+sku→contaId), tenta usar ESSA conta primeiro;
 * - Nunca sobrescreve o que veio do backend.
 */
function enrichItemFromLocalIfEmpty(
  item: ItemRead,
  contaId?: string | null,
  contaEmailFallback?: string | null,
  contaNickFallback?: string | null
): ItemRead {
  const precisaEmail = !item.email_conta;
  const precisaSenha = !item.senha_conta;
  const precisaNick = !item.nick_conta;
  const precisaCodigo = !item.codigo_ativacao;

  // se nada está faltando, não mexe
  if (!precisaEmail && !precisaSenha && !precisaNick && !precisaCodigo) {
    return item;
  }

  let contaLS: ContaJogoLS | null = null;

  // 1) Se temos contaId vinculada, essa é a prioridade
  if (contaId) {
    contaLS = findContaByIdLS(contaId);
  }

  // 2) Se não achou por contaId, cai no comportamento antigo por SKU/mídia
  if (!contaLS) {
    const sku = normalizeSku(item.sku || "");
    if (sku) {
      const hit = findBySkuLS(sku);
      if (hit) {
        const plataformaKey = plataformaFromItem(item.plataforma || null);
        const midia = midiaFromPlataformaKey(plataformaKey);
        contaLS = pickContaByMidiaAndPlataformaLS(hit.jogo, midia, plataformaKey) || null;
      }
    }
  }

  // Agora preenche só os buracos, usando:
  // - contaLS (quando existir)
  // - valores já existentes no item
  // - fallback de e-mail/nick (se vieram)
  return {
    ...item,
    email_conta: precisaEmail
      ? (contaLS?.email || item.email_conta || contaEmailFallback || "")
      : item.email_conta,
    senha_conta: precisaSenha
      ? (contaLS?.senha || item.senha_conta || "")
      : item.senha_conta,
    nick_conta: precisaNick
      ? (contaLS?.nick || item.nick_conta || contaNickFallback || "")
      : item.nick_conta,
    codigo_ativacao: precisaCodigo
      ? (contaLS?.ativacoes?.[0] || item.codigo_ativacao || "")
      : item.codigo_ativacao,
  };
}

/* ============================================================
   Histórico legado salvo em localStorage (zion.histCodesByAccount)
   ============================================================ */

const HIST_CODES_STORAGE = "zion.histCodesByAccount";

type HistLSRegistro = {
  pedidoId?: number;
  quando?: string;
  clienteNome?: string;
  clienteEmail?: string;
  clienteTelefone?: string | null;
  sku?: string | null;
  nomeProduto?: string;
  plataformaItem?: Plataforma;
  midiaItem?: Midia;
  codigoAtivacao?: string | null;
};

type HistLSConta = {
  contaId?: string;
  contaEmail?: string;
  contaNick?: string;
  contaSenha?: string;
  registros?: HistLSRegistro[];
};

type HistLSRoot = {
  contas?: HistLSConta[];
};

function loadHistLS(): HistLSRoot {
  if (!hasLocalStorage()) return { contas: [] };
  try {
    const raw = window.localStorage.getItem(HIST_CODES_STORAGE);
    if (!raw) return { contas: [] };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { contas: [] };
    return parsed as HistLSRoot;
  } catch {
    return { contas: [] };
  }
}

/* ============================================================
   Histórico vindo do BACKEND (pedidos + itens)
   ============================================================ */

async function montarHistoricoBackend(): Promise<HistoricoContaVenda[]> {
  const pedidos = await listarPedidos({} as any);
  const out: HistoricoContaVenda[] = [];

  for (const p of pedidos) {
    let itens: ItemRead[] = [];
    try {
      itens = await listarItens(p.id);
    } catch (e) {
      console.error("[historicoConta] erro ao listarItens", p.id, e);
      continue;
    }

    for (const it of itens) {
      // ✅ NÃO filtramos por it.enviado: queremos tudo que aparece na aba de clientes

      // tenta descobrir conta vinculada via mapa (pedidoId + sku)
      const skuRaw = it.sku || "";
      const contaVinculadaId = skuRaw
        ? obterContaVinculadaAoPedidoSku(p.id, skuRaw)
        : undefined;

      // COMPLETA email/senha/nick/código a partir do localStorage, se necessário,
      // priorizando sempre a conta vinculada (quando existir)
      const enriched = enrichItemFromLocalIfEmpty(
        it,
        contaVinculadaId,
        it.email_conta ?? null,
        it.nick_conta ?? null
      );

      const plataformaItem = enriched.plataforma;
      const midiaItem = inferMidiaFromPlataforma(plataformaItem);

      // tenta usar data_envio se existir (igual ClientesPage),
      // senão cai para enviado_em / data_criacao
      const dataEnvioRaw =
        (enriched as any).data_envio ||
        (it as any).data_envio ||
        null;

      const quando =
        dataEnvioRaw ||
        enriched.enviado_em ||
        p.enviado_em ||
        p.data_criacao;

      out.push({
        pedidoId: p.id,
        itemId: enriched.id,
        quando,

        clienteNome: p.cliente_nome,
        clienteEmail: p.cliente_email,
        clienteTelefone: p.telefone ?? null,

        nomeProduto: enriched.nome_produto,
        sku: enriched.sku ?? null,
        plataformaItem,
        midiaItem,

        contaEmail: enriched.email_conta ?? null,
        contaNick: enriched.nick_conta ?? null,
        contaSenha: enriched.senha_conta ?? null,
        codigoAtivacao: enriched.codigo_ativacao ?? null,

        pedido: p,
        item: enriched,
        contaId: contaVinculadaId, // 🔴 AGORA guardamos o id da conta usada no envio
      });
    }
  }

  // mais recentes primeiro
  out.sort(
    (a, b) =>
      (a.quando > b.quando ? -1 : a.quando < b.quando ? 1 : 0) ||
      (a.pedidoId > b.pedidoId ? -1 : 1)
  );

  return out;
}

/* ============================================================
   Histórico legado local (antigo)
   ============================================================ */

function montarHistoricoLocal(): HistoricoContaVenda[] {
  const root = loadHistLS();
  const result: HistoricoContaVenda[] = [];

  for (const c of root.contas || []) {
    for (const r of c.registros || []) {
      const plataforma = (r.plataformaItem as Plataforma) || "PS5";
      const midiaItem = r.midiaItem || inferMidiaFromPlataforma(plataforma);

      result.push({
        pedidoId: r.pedidoId ?? 0,
        itemId: 0,
        quando: r.quando || "",

        clienteNome: r.clienteNome || "",
        clienteEmail: r.clienteEmail || "",
        clienteTelefone: r.clienteTelefone ?? null,

        nomeProduto: r.nomeProduto || "",
        sku: r.sku || null,
        plataformaItem: plataforma,
        midiaItem,

        contaEmail: c.contaEmail ?? null,
        contaNick: c.contaNick ?? null,
        contaSenha: c.contaSenha ?? null,
        codigoAtivacao: r.codigoAtivacao ?? null,

        pedido: undefined,
        item: undefined,
        contaId: c.contaId,
      });
    }
  }

  result.sort(
    (a, b) =>
      (a.quando > b.quando ? -1 : a.quando < b.quando ? 1 : 0) ||
      (a.pedidoId > b.pedidoId ? -1 : 1)
  );

  return result;
}

/* ============================================================
   API pública usada pelas telas
   ============================================================ */

/** Histórico global: backend + legado (usado em HistoricoContasPage) */
export async function montarHistorico(): Promise<HistoricoContaVenda[]> {
  const [backend, localHist] = await Promise.all([
    montarHistoricoBackend().catch(() => [] as HistoricoContaVenda[]),
    Promise.resolve().then(() => montarHistoricoLocal()),
  ]);

  const all = [...backend, ...localHist];

  all.sort(
    (a, b) =>
      (a.quando > b.quando ? -1 : a.quando < b.quando ? 1 : 0) ||
      (a.pedidoId > b.pedidoId ? -1 : 1)
  );

  return all;
}

/**
 * Histórico de UMA conta específica
 * (usado no botão "Histórico" dentro do JogosPage).
 *
 * AGORA:
 * - dá prioridade para `contaId` vindo do vínculo (pedido+sku→conta);
 * - se não tiver, cai no match por e-mail da conta PSN (legado).
 */
export async function montarHistoricoDessaConta(
  conta: ContaHistoricoInput
): Promise<HistoricoContaVenda[]> {
  const all = await montarHistorico();

  const emailConta = normalizeEmail(conta.email);

  return all.filter((h) => {
    const emailHist = normalizeEmail(h.contaEmail || "");

    // 1) bateu contaId (venda com vínculo real)
    if (conta.id && h.contaId && h.contaId === conta.id) return true;

    // 2) (legado) bateu e-mail da conta PSN
    if (emailConta && emailHist && emailConta === emailHist) return true;

    return false;
  });
}
