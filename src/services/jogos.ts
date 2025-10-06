// src/services/jogos.ts
/**
 * Service para integração com o storage de Jogos/Contas/Códigos.
 * Compatível com a estrutura do JogosPage (contas possuem `ativacoes: string[]`).
 */

export type Midia = "PRIMARIA" | "SECUNDARIA";
export type PlataformaKey = "ps4" | "ps5" | "ps4s" | "ps5s";

export const JOGOS_STORAGE_KEY = "zion.jogos";

/* ========================= Tipos públicos (usados nas telas) ========================= */

export type ContaJogo = {
  id: string;
  email: string;
  nick: string;
  senha: string;
  ativacoes: string[];
  midia: Midia;
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

  // LEGADO (não usamos mais, mas pode existir no storage antigo)
  codes?: string[];
  email?: string;
  nick?: string;
  senha?: string;
  ativacao?: string;
};

/**
 * Retorno de buscarJogoPorSku — pensado para a tela de envios:
 * - identifica console e tipo de mídia deduzidos pelo SKU
 * - devolve preview de código (se houver)
 * - devolve credenciais (login/senha), quando a conta existir
 */
export type JogoPorSku = {
  id_jogo: string;
  nome_jogo: string;
  console: "PS4" | "PS5";
  tipo_midia: "Primaria" | "Secundaria"; // humano-legível
  sku: string;

  login?: string;
  senha?: string; // raw (a tela pega a 2ª com a função senha2)
  codigo_preview?: string;
};

/* ========================= Utils internas ========================= */

function normalizeSku(s?: string | null): string {
  return (s ?? "").toString().trim().replace(/\s+/g, "").toUpperCase();
}

function getJogos(): Jogo[] {
  try {
    const raw = localStorage.getItem(JOGOS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Jogo[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function setJogos(lista: Jogo[]) {
  localStorage.setItem(JOGOS_STORAGE_KEY, JSON.stringify(lista));
  try { window.dispatchEvent(new CustomEvent("zion:jogos-updated")); } catch {}
  try { window.dispatchEvent(new Event("zion.jogos:refresh")); } catch {}
}

/** Localiza o jogo e em qual "coluna" o SKU bateu */
function findBySku(skuRaw: string): { jogo: Jogo; plataforma: PlataformaKey } | null {
  const sku = normalizeSku(skuRaw);
  if (!sku) return null;
  const lista = getJogos();

  for (const j of lista) {
    if (normalizeSku(j.sku_ps4) === sku)  return { jogo: j, plataforma: "ps4"  };
    if (normalizeSku(j.sku_ps5) === sku)  return { jogo: j, plataforma: "ps5"  };
    if (normalizeSku(j.sku_ps4s) === sku) return { jogo: j, plataforma: "ps4s" };
    if (normalizeSku(j.sku_ps5s) === sku) return { jogo: j, plataforma: "ps5s" };
  }
  return null;
}

function plataformaToConsole(pl: PlataformaKey): "PS4" | "PS5" {
  return pl.startsWith("ps4") ? "PS4" : "PS5";
}
function plataformaToMidia(pl: PlataformaKey): Midia {
  return (pl === "ps4s" || pl === "ps5s") ? "SECUNDARIA" : "PRIMARIA";
}
function midiaLabel(m: Midia): "Primaria" | "Secundaria" {
  return m === "PRIMARIA" ? "Primaria" : "Secundaria";
}

/** Escolhe a CONTA preferencial do jogo com base na mídia (ou a primeira disponível) */
function pickConta(jogo: Jogo, midiaPreferida?: Midia): ContaJogo | undefined {
  const contas = jogo.contas || [];
  if (!contas.length) return undefined;
  if (midiaPreferida) {
    const m = contas.find(c => c.midia === midiaPreferida);
    if (m) return m;
  }
  return contas[0];
}

/** Remove e retorna o primeiro código da conta (imutável) */
function popPrimeiroCodigo(conta: ContaJogo): { novo: ContaJogo; codigo?: string } {
  const pool = conta.ativacoes || [];
  if (!pool.length) return { novo: conta, codigo: undefined };
  const [codigo, ...resto] = pool;
  return { novo: { ...conta, ativacoes: resto }, codigo };
}

/* ========================= API pública (usada pelas telas) ========================= */

/**
 * Busca um jogo por SKU e retorna informações para autocompletar a tela.
 * Faz o *preview* do próximo código da conta correspondente à mídia do SKU.
 */
export async function buscarJogoPorSku(skuRaw: string): Promise<JogoPorSku | null> {
  const hit = findBySku(skuRaw);
  if (!hit) return null;

  const { jogo, plataforma } = hit;
  const midia = plataformaToMidia(plataforma);
  const consoleName = plataformaToConsole(plataforma);

  const conta = pickConta(jogo, midia);
  const preview = conta?.ativacoes?.[0];

  return {
    id_jogo: jogo.id,
    nome_jogo: jogo.jogo,
    console: consoleName,
    tipo_midia: midiaLabel(midia),
    sku: normalizeSku(skuRaw),
    login: conta?.email || "",          // você usa email como login
    senha: conta?.senha || "",
    codigo_preview: preview || "",
  };
}

/**
 * Preview por SKU + MÍDIA (sem consumir).
 * Útil quando o usuário troca a variação manualmente na tela.
 */
export async function previewCodigoPorSkuEMidia(
  skuRaw: string,
  midia: Midia
): Promise<{ codigo?: string } | null> {
  const hit = findBySku(skuRaw);
  if (!hit) return null;
  const conta = pickConta(hit.jogo, midia);
  return { codigo: conta?.ativacoes?.[0] };
}

/**
 * Consome (remove) **1** código por SKU + MÍDIA e persiste no storage.
 * Retorna o código efetivamente consumido.
 */
export async function consumirCodigoPorSkuEMidia(
  skuRaw: string,
  midia: Midia
): Promise<{ codigo?: string } | null> {
  const lista = getJogos();
  const hit = findBySku(skuRaw);
  if (!hit) return null;

  const jogoIdx = lista.findIndex((j) => j.id === hit.jogo.id);
  if (jogoIdx < 0) return null;

  const jogo = lista[jogoIdx];
  const contas = jogo.contas || [];
  if (!contas.length) return { codigo: undefined };

  // seleciona a conta correta
  const idxConta = contas.findIndex((c) => c.midia === midia);
  const pos = idxConta >= 0 ? idxConta : 0;

  const { novo, codigo } = popPrimeiroCodigo(contas[pos]);
  const novasContas = contas.map((c, i) => (i === pos ? novo : c));

  lista[jogoIdx] = { ...jogo, contas: novasContas };
  setJogos(lista);

  return { codigo };
}

/**
 * Compatibilidade: consome **1** código deduzindo a mídia a partir do SKU.
 * (Usado como fallback por telas antigas.)
 */
export async function consumirCodigoPorSku(
  skuRaw: string
): Promise<{ codigo?: string } | null> {
  const hit = findBySku(skuRaw);
  if (!hit) return null;
  const midia = plataformaToMidia(hit.plataforma);
  return consumirCodigoPorSkuEMidia(skuRaw, midia);
}
