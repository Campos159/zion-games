// src/services/jogos.ts
// Service de Jogos baseado no localStorage usado pelas telas.
// Ele não importa componentes React. Tudo é feito por leitura/gravação do storage.

/* ============================================================
   Tipos compatíveis
   ============================================================ */
export type Midia = "PRIMARIA" | "SECUNDARIA";
export type PlataformaKey = "ps4" | "ps5" | "ps4s" | "ps5s";

// >>> OBS: Para compatibilidade com o JogosPage.tsx, a conta pode ter `plataforma`.
export type ContaJogo = {
  id: string;
  email: string;
  nick: string;
  senha: string;
  ativacoes: string[];       // códigos por conta (um por linha)
  midia: Midia;              // PRIMARIA | SECUNDARIA
  plataforma?: "PS4" | "PS5" | "PS4s" | "PS5s"; // opcional (pode não existir em dados antigos)
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
  sku_ps4?: string;
  sku_ps5?: string;
  sku_ps4s?: string;
  sku_ps5s?: string;
  contas?: ContaJogo[];
  // legados ignorados aqui
};

// Resposta simplificada usada pelo EnviosManuaisPage no autocompletar
export type JogoPorSku = {
  console: "PS4" | "PS5";
  tipo_midia: "PRIMARIA" | "SECUNDARIA";
  nome_jogo: string;
  login?: string;
  senha?: string;
  codigo_preview?: string;
};

const STORAGE_KEY = "zion.jogos";

/* ============================================================
   Helpers
   ============================================================ */
function normalizeSku(s: string | undefined | null): string {
  return (s ?? "").toString().trim().replace(/\s+/g, "");
}

function loadAll(): Jogo[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as Jogo[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveAll(lista: Jogo[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(lista));
  try { window.dispatchEvent(new CustomEvent("zion:jogos-updated")); } catch {}
  try { window.dispatchEvent(new Event("zion.jogos:refresh")); } catch {}
}

/** Localiza jogo + de qual coluna veio o match (ps4/ps5/ps4s/ps5s) */
function findBySku(skuRaw: string): { jogo: Jogo; plataforma: PlataformaKey } | null {
  const sku = normalizeSku(skuRaw);
  if (!sku) return null;
  const lista = loadAll();
  for (const j of lista) {
    if (normalizeSku(j.sku_ps4) === sku)  return { jogo: j, plataforma: "ps4"  };
    if (normalizeSku(j.sku_ps5) === sku)  return { jogo: j, plataforma: "ps5"  };
    if (normalizeSku(j.sku_ps4s) === sku) return { jogo: j, plataforma: "ps4s" };
    if (normalizeSku(j.sku_ps5s) === sku) return { jogo: j, plataforma: "ps5s" };
  }
  return null;
}

function plataformaToConsole(pl: PlataformaKey): "PS4" | "PS5" {
  return (pl === "ps4" || pl === "ps4s") ? "PS4" : "PS5";
}

function plataformaToMidia(pl: PlataformaKey): Midia {
  return (pl === "ps4s" || pl === "ps5s") ? "SECUNDARIA" : "PRIMARIA";
}

function plataformaKeyToContaPlataforma(pl: PlataformaKey): "PS4" | "PS5" | "PS4s" | "PS5s" {
  if (pl === "ps4") return "PS4";
  if (pl === "ps5") return "PS5";
  if (pl === "ps4s") return "PS4s";
  return "PS5s";
}

/** Retorna a primeira conta que respeite mídia + plataforma (preferindo com códigos), com fallbacks. */
function pickContaByMidiaAndPlataforma(j: Jogo, midia: Midia, plataforma: PlataformaKey): ContaJogo | undefined {
  const contas = j.contas || [];
  const alvoPlataforma = plataformaKeyToContaPlataforma(plataforma);

  // 1) Mídia + plataforma, COM códigos
  let c = contas.find(c =>
    c.midia === midia &&
    c.plataforma === alvoPlataforma &&
    (c.ativacoes?.length || 0) > 0
  );
  if (c) return c;

  // 2) Mídia + plataforma, SEM exigir códigos
  c = contas.find(c => c.midia === midia && c.plataforma === alvoPlataforma);
  if (c) return c;

  // 3) Só mídia, COM códigos
  c = contas.find(c => c.midia === midia && (c.ativacoes?.length || 0) > 0);
  if (c) return c;

  // 4) Só mídia, qualquer
  c = contas.find(c => c.midia === midia);
  if (c) return c;

  // 5) Qualquer com códigos
  c = contas.find(c => (c.ativacoes?.length || 0) > 0);
  if (c) return c;

  // 6) Fallback: primeira conta
  return contas[0];
}

/** (LEGADO) Retorna a primeira conta da mídia pedida que tenha pelo menos 1 código (ou qualquer conta dessa mídia se não tiver). */
function pickContaByMidia(j: Jogo, midia: Midia): ContaJogo | undefined {
  const contas = j.contas || [];
  let c = contas.find(c => c.midia === midia && (c.ativacoes?.length || 0) > 0);
  if (c) return c;
  c = contas.find(c => c.midia === midia);
  if (c) return c;
  return contas[0];
}

/* ============================================================
   API exposta
   ============================================================ */

/** Busca o jogo por SKU e retorna dados para autocompletar a UI. 
 *  AGORA: escolhe credenciais da conta pela mídia + plataforma do SKU.
 */
export async function buscarJogoPorSku(skuRaw: string): Promise<JogoPorSku | null> {
  const hit = findBySku(skuRaw);
  if (!hit) return null;

  const { jogo, plataforma } = hit;
  const consoleName = plataformaToConsole(plataforma);
  const midiaSugerida = plataformaToMidia(plataforma);

  // escolher conta pela MÍDIA + PLATAFORMA do SKU
  const conta = pickContaByMidiaAndPlataforma(jogo, midiaSugerida, plataforma);
  const preview = conta?.ativacoes?.[0] || undefined;

  return {
    console: consoleName,
    tipo_midia: midiaSugerida,
    nome_jogo: jogo.jogo,
    login: conta?.email || "",
    senha: conta?.senha || "",
    codigo_preview: preview,
  };
}

/** Preview do próximo código (sem consumir) por SKU + Mídia.
 *  AGORA: considera a PLATAFORMA do SKU para escolher a conta certa.
 */
export async function previewCodigoPorSkuEMidia(
  skuRaw: string,
  midia: Midia
): Promise<{ codigo?: string } | null> {
  const hit = findBySku(skuRaw);
  if (!hit) return null;

  const conta = pickContaByMidiaAndPlataforma(hit.jogo, midia, hit.plataforma);
  const preview = conta?.ativacoes?.[0] || undefined;
  return { codigo: preview };
}

/** Busca um código disponível (sem consumir) por SKU + Mídia.
 *  AGORA: considera a PLATAFORMA do SKU para selecionar a conta.
 */
export async function buscarCodigoDisponivelPorSkuEMidia(
  skuRaw: string,
  midia: Midia
): Promise<{ codigo?: string } | null> {
  const hit = findBySku(skuRaw);
  if (!hit) return null;

  const conta = pickContaByMidiaAndPlataforma(hit.jogo, midia, hit.plataforma);
  if (!conta) return null;

  const codigo = conta.ativacoes?.length ? conta.ativacoes[0] : undefined;
  return { codigo };
}

/** Consome (remove) o próximo código disponível por SKU + Mídia e salva no storage.
 *  AGORA: consome da CONTA que casa MÍDIA + PLATAFORMA (do SKU).
 */
export async function consumirCodigoPorSkuEMidia(
  skuRaw: string,
  midia: Midia
): Promise<{ codigo?: string } | null> {
  const sku = normalizeSku(skuRaw);
  if (!sku) return { codigo: undefined };

  const lista = loadAll();

  // localizar jogo e índice
  const idxJogo = lista.findIndex(j =>
    normalizeSku(j.sku_ps4) === sku ||
    normalizeSku(j.sku_ps5) === sku ||
    normalizeSku(j.sku_ps4s) === sku ||
    normalizeSku(j.sku_ps5s) === sku
  );
  if (idxJogo < 0) return { codigo: undefined };

  const jogo = lista[idxJogo];

  // descobrir plataforma do SKU (qual coluna bateu)
  let plataforma: PlataformaKey | null = null;
  if (normalizeSku(jogo.sku_ps4) === sku) plataforma = "ps4";
  else if (normalizeSku(jogo.sku_ps5) === sku) plataforma = "ps5";
  else if (normalizeSku(jogo.sku_ps4s) === sku) plataforma = "ps4s";
  else if (normalizeSku(jogo.sku_ps5s) === sku) plataforma = "ps5s";

  const contas = jogo.contas || [];
  if (!contas.length) return { codigo: undefined };

  // selecionar a conta certa (mídia + plataforma)
  const contaEscolhida = plataforma
    ? pickContaByMidiaAndPlataforma(jogo, midia, plataforma)
    : pickContaByMidia(jogo, midia);

  if (!contaEscolhida) return { codigo: undefined };

  const idxConta = contas.findIndex(c => c.id === contaEscolhida.id);
  if (idxConta < 0) return { codigo: undefined };

  const conta = contas[idxConta];
  const pool = Array.isArray(conta.ativacoes) ? conta.ativacoes.slice() : [];

  if (pool.length === 0) {
    // não há códigos nessa conta
    return { codigo: undefined };
    }

  // Consome o primeiro código
  const codigo = pool.shift()!;

  // Persistir de volta
  const contaAtualizada: ContaJogo = { ...conta, ativacoes: pool };
  const contasAtualizadas = contas.map((c, k) => (k === idxConta ? contaAtualizada : c));
  const jogoAtualizado: Jogo = { ...jogo, contas: contasAtualizadas };
  const listaAtualizada = [
    ...lista.slice(0, idxJogo),
    jogoAtualizado,
    ...lista.slice(idxJogo + 1),
  ];

  saveAll(listaAtualizada);

  return { codigo };
}

/** Fallback antigo: consome por SKU (independente de mídia). Mantido para compatibilidade. */
export async function consumirCodigoPorSku(
  skuRaw: string
): Promise<{ codigo?: string } | null> {
  const hit = findBySku(skuRaw);
  if (!hit) return null;

  // preferência: PRIMARIA; se não tiver, SECUNDARIA; senão qualquer
  const ordem: Midia[] = ["PRIMARIA", "SECUNDARIA"];
  for (const m of ordem) {
    const r = await consumirCodigoPorSkuEMidia(skuRaw, m);
    if (r?.codigo) return r;
  }
  // nada encontrado
  return { codigo: undefined };
}
