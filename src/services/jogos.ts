// src/services/jogos.ts
// Service de Jogos baseado no localStorage usado pelas telas.
// Ele não importa componentes React. Tudo é feito por leitura/gravação do storage.

//
// ============================== ATENÇÃO ==============================
// A partir desta versão:
// - O "custo" (preço que você pagou) da CONTA é buscado no BACKEND (aqui, stub).
// - O campo `preco` em ContaJogo permanece apenas por compatibilidade/legado,
//   mas NÃO é mais usado como fonte de verdade do custo.
//
// Helpers de precificação:
//   - roundHalfUniversalTo50(x): arredonda para múltiplos de 0,50 (regra .5 pra cima)
//   - adjustZeroToNinety(x): se terminar em ",00", vira "real anterior ,90"
//   - calcPrimaria(custo): aplica 0,75, arredonda para 0,50; se ficar ",00", vira ",90" do real anterior
//   - calcSecundaria(primariaFinal): tabela fixa por FAIXA da PRIMÁRIA (sem arredondar, exceção!)
//   - calcRevenda(primariaFinal): 0,75 da primária final + mesma regra da primária
//
// BACKEND de custo (stub):
//   - fetchCustoPorConta(contaId): Promise<number | null>
//   - patchCustoDaConta(contaId, custo): Promise<void>
//   - listarCustosDasContas(): Promise<{ contaId, custo, dataCadastro }[]>
//
// ====================================================================
//

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

  // contadores/estado (algumas telas usam)
  /** LEGADO: não usar como custo real. O custo agora fica no backend. */
  preco?: number;
  sold_p_ps4?: number;        // primária PS4 (0..2)
  sold_p_ps5?: number;        // primária PS5 (0..2)
  sold_s?: boolean;           // secundária vendida?
  sold_s_plat?: "PS4" | "PS5" | null; // se secundária vendida, em qual plataforma
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
   NOVO: vínculo (pedido + SKU) → contaId
   ============================================================ */
// chave no localStorage
const MAP_VINC_KEY = "zion.jogos.mapPedidoSkuConta";
// key do mapa: `${pedidoId}:${skuNormalizado}`
type VincMap = Record<string, string>;

function _normalizeSku(s: string | undefined | null): string {
  return (s ?? "").toString().trim().replace(/\s+/g, "");
}
function _normLinkKey(pedidoId: number | string, skuRaw: string) {
  return `${String(pedidoId)}:${_normalizeSku(skuRaw)}`;
}
function _loadVincMap(): VincMap {
  try {
    const raw = localStorage.getItem(MAP_VINC_KEY);
    if (!raw) return {};
    const m = JSON.parse(raw) as VincMap;
    return m && typeof m === "object" ? m : {};
  } catch {
    return {};
  }
}
function _saveVincMap(m: VincMap) {
  try { localStorage.setItem(MAP_VINC_KEY, JSON.stringify(m)); } catch {}
}

/** Registra que o pedido X do SKU Y foi enviado usando a contaId Z */
export function vincularPedidoSkuAConta(pedidoId: number, skuRaw: string, contaId: string) {
  if (!pedidoId || !skuRaw || !contaId) return;
  const map = _loadVincMap();
  map[_normLinkKey(pedidoId, skuRaw)] = contaId;
  _saveVincMap(map);
}

/** Retorna a contaId previamente vinculada a (pedidoId, sku) — para filtrar histórico por conta */
export function obterContaVinculadaAoPedidoSku(pedidoId: number, skuRaw: string): string | undefined {
  if (!pedidoId || !skuRaw) return undefined;
  const map = _loadVincMap();
  return map[_normLinkKey(pedidoId, skuRaw)];
}

/* ============================================================
   Helpers gerais de storage
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

/* ============================================================
   PRECIFICAÇÃO — regras pedidas
   ============================================================ */

/** Arredonda um número para o múltiplo de 0,50 mais próximo, usando "regra universal" (.5 para cima). */
export function roundHalfUniversalTo50(x: number): number {
  const v = Number(x) || 0;
  // escala por 2 (cada 0,5 vira 1), arredonda half-up e volta
  const scaled = Math.round(v * 2 + Number.EPSILON) / 2;
  // Garantir 2 casas decimais consistentes
  return Math.round(scaled * 100) / 100;
}

/** Se o valor terminar em ",00" (centavos == 0), ajusta para "real anterior ,90". Ex.: 20,00 -> 19,90 */
export function adjustZeroToNinety(x: number): number {
  const v = Number(x) || 0;
  const cents = Math.round((v - Math.floor(v)) * 100);
  if (cents === 0) {
    // volta 0,10
    const adjusted = v - 0.1;
    // força duas casas
    return Math.round(adjusted * 100) / 100;
  }
  return Math.round(v * 100) / 100;
}

/** Calcula o valor da Primária a partir do CUSTO.
 *  Regra: P_bruta = 0,75 * custo -> arredonda para 0,50; se ",00" => "real anterior ,90".
 *  Retorna com 2 casas.
 */
export function calcPrimaria(custo: number): number {
  const base = 0.75 * (Number(custo) || 0);
  const half = roundHalfUniversalTo50(base);
  return adjustZeroToNinety(half);
}

/** Calcula a Secundária com base no valor da Primária FINAL (exceção: NÃO arredondar aqui).
 *  Tabela (por faixa da PRIMÁRIA):
 *   ≤ 20  → 10
 *   21–30 → 15
 *   31–40 → 20
 *   41–50 → 25
 *   51–60 → 30
 *   61–70 → 35
 *   71–80 → 40
 *   81–90 → 45
 *   91–100 → 50
 *   101–120 → 60
 *   121–150 → 80
 *   151–200 → 100
 *   201–250 → 150
 *   251–300 → 170
 *   ≥ 301 → 200
 *  Retorna número COM DUAS CASAS (xx.00) apenas por padronização de formatação.
 */
export function calcSecundaria(primaria: number): number {
  const p = Number(primaria) || 0;
  const reais = Math.floor(p + 1e-9); // usa parte inteira para comparar faixas de modo robusto
  let s: number;
  if (reais <= 20) s = 10;
  else if (reais <= 30) s = 15;
  else if (reais <= 40) s = 20;
  else if (reais <= 50) s = 25;
  else if (reais <= 60) s = 30;
  else if (reais <= 70) s = 35;
  else if (reais <= 80) s = 40;
  else if (reais <= 90) s = 45;
  else if (reais <= 100) s = 50;
  else if (reais <= 120) s = 60;
  else if (reais <= 150) s = 80;
  else if (reais <= 200) s = 100;
  else if (reais <= 250) s = 150;
  else if (reais <= 300) s = 170;
  else s = 200;
  return Math.round(s * 100) / 100;
}

/** Calcula o valor de Revenda a partir da PRIMÁRIA FINAL.
 *  Regra: R_bruta = 0,75 * primariaFinal -> arredonda para 0,50; se ",00" => "real anterior ,90".
 *  Retorna com 2 casas.
 */
export function calcRevenda(primariaFinal: number): number {
  const base = 0.75 * (Number(primariaFinal) || 0);
  const half = roundHalfUniversalTo50(base);
  return adjustZeroToNinety(half);
}

/* ============================================================
   BACKEND de CUSTO — stub com data de cadastro
   ============================================================ */
// Agora salvamos: { custo, dataCadastro } por contaId.
// dataCadastro = dia em que o custo foi definido/atualizado.
const BACKEND_CUSTOS_KEY = "zion.backend.custos";

type CustoContaStored = {
  custo: number;
  dataCadastro: string; // yyyy-mm-dd
};

export type CustoContaInfo = {
  contaId: string;
  custo: number;
  dataCadastro: string; // yyyy-mm-dd
};

function todayYmdLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Obtém custo no "backend" (stub via localStorage). Retorna null se não houver custo. */
export async function fetchCustoPorConta(contaId: string): Promise<number | null> {
  try {
    const raw = localStorage.getItem(BACKEND_CUSTOS_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw) as Record<string, CustoContaStored | number>;
    const v = map?.[contaId];
    if (typeof v === "number") {
      return Number.isNaN(v) ? null : v;
    }
    if (v && typeof v === "object") {
      const n = Number(v.custo);
      return Number.isNaN(n) ? null : n;
    }
    return null;
  } catch {
    return null;
  }
}

/** Atualiza custo no "backend" (stub via localStorage), gravando também a dataCadastro (dia atual).
 *  Se já existir um registro com dataCadastro, mantém a data antiga (não "move" custo para outro dia).
 */
export async function patchCustoDaConta(contaId: string, custo: number): Promise<void> {
  const v = Math.max(0, Math.round(Number(custo || 0) * 100) / 100);
  const raw = localStorage.getItem(BACKEND_CUSTOS_KEY);
  let map: Record<string, CustoContaStored | number> = {};
  try { map = raw ? (JSON.parse(raw) || {}) : {}; } catch { map = {}; }

  const existing = map[contaId];
  let dataCadastro: string;

  if (existing && typeof existing === "object" && "dataCadastro" in existing) {
    // já tinha dataCadastro, preserva
    dataCadastro = (existing as CustoContaStored).dataCadastro || todayYmdLocal();
  } else {
    // novo custo ou legado numérico -> usa hoje
    dataCadastro = todayYmdLocal();
  }

  map[contaId] = { custo: v, dataCadastro };
  localStorage.setItem(BACKEND_CUSTOS_KEY, JSON.stringify(map));
  try { window.dispatchEvent(new Event("zion.custos:changed")); } catch {}
}

/** Lista todos os custos de contas (para painel de Custos).
 *  Converte dados legados (apenas número) assumindo dataCadastro = hoje.
 */
export async function listarCustosDasContas(): Promise<CustoContaInfo[]> {
  try {
    const raw = localStorage.getItem(BACKEND_CUSTOS_KEY);
    if (!raw) return [];
    const map = JSON.parse(raw) as Record<string, CustoContaStored | number>;
    if (!map || typeof map !== "object") return [];

    const hojeStr = todayYmdLocal();
    const out: CustoContaInfo[] = [];

    for (const [contaId, v] of Object.entries(map)) {
      if (typeof v === "number") {
        const n = Number(v);
        if (Number.isNaN(n)) continue;
        out.push({
          contaId,
          custo: Math.max(0, Math.round(n * 100) / 100),
          dataCadastro: hojeStr,
        });
      } else if (v && typeof v === "object") {
        const n = Number(v.custo);
        if (Number.isNaN(n)) continue;
        let data = (v as CustoContaStored).dataCadastro || hojeStr;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) data = hojeStr;
        out.push({
          contaId,
          custo: Math.max(0, Math.round(n * 100) / 100),
          dataCadastro: data,
        });
      }
    }

    return out;
  } catch {
    return [];
  }
}

/* ============================================================
   Localização por SKU e seleção de conta
   ============================================================ */

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

/**
 * Regra de venda POR CONTA, POR CONSOLE e POR MÍDIA.
 * - Máx. 2 primárias por console (PS4 / PS5)
 * - Secundária só libera naquele console depois de 2 primárias
 * - Depois que vender 1 secundária (sold_s = true), a conta não vende mais nada.
 */
function canVenderContaNaComb(
  conta: ContaJogo,
  midia: Midia,
  plataforma: PlataformaKey
): boolean {
  const sold_p_ps4 = conta.sold_p_ps4 ?? 0;
  const sold_p_ps5 = conta.sold_p_ps5 ?? 0;
  const sold_s = !!conta.sold_s;

  const isPS4 = plataforma === "ps4" || plataforma === "ps4s";
  const isPS5 = plataforma === "ps5" || plataforma === "ps5s";

  // Já vendeu secundária -> trava tudo na conta
  if (sold_s) return false;

  if (midia === "PRIMARIA") {
    // Máximo 2 primárias POR CONSOLE
    if (isPS4 && sold_p_ps4 >= 2) return false;
    if (isPS5 && sold_p_ps5 >= 2) return false;
    return true;
  } else {
    // SECUNDÁRIA: só libera se já tiver 2 primárias naquele console
    const prims = isPS4 ? sold_p_ps4 : sold_p_ps5;
    if (prims < 2) return false;
    return true;
  }
}

/** Retorna a primeira conta que respeite mídia + plataforma (preferindo com códigos),
 *  AGORA respeitando também:
 *  - Máx. 2 primárias por console
 *  - Secundária só depois de 2 primárias daquele console
 *  - Após vender 1 secundária (sold_s), a conta não vende mais nada.
 */
function pickContaByMidiaAndPlataforma(
  j: Jogo,
  midia: Midia,
  plataforma: PlataformaKey
): ContaJogo | undefined {
  const todas = j.contas || [];
  const alvoPlataforma = plataformaKeyToContaPlataforma(plataforma);

  // Aplica regra de venda por conta/console/mídia
  const candidatasRegra = todas.filter((c) =>
    canVenderContaNaComb(c, midia, plataforma)
  );

  // Se nenhuma conta passa na regra (legado/erro), cai no comportamento antigo
  const contas = candidatasRegra.length ? candidatasRegra : todas;

  // 1) Mídia + plataforma, COM códigos
  let c = contas.find(
    (c) =>
      c.midia === midia &&
      c.plataforma === alvoPlataforma &&
      (c.ativacoes?.length || 0) > 0
  );
  if (c) return c;

  // 2) Mídia + plataforma, SEM exigir códigos
  c = contas.find(
    (c) => c.midia === midia && c.plataforma === alvoPlataforma
  );
  if (c) return c;

  // 3) Só mídia, COM códigos
  c = contas.find((c) => c.midia === midia && (c.ativacoes?.length || 0) > 0);
  if (c) return c;

  // 4) Só mídia, qualquer
  c = contas.find((c) => c.midia === midia);
  if (c) return c;

  // 5) Qualquer com códigos
  c = contas.find((c) => (c.ativacoes?.length || 0) > 0);
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
   API exposta (compat + ajustes menores)
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

/* ============================================================
   Integrações para AutoEnvio (compatibilidade com autoenvio.ts)
   ============================================================ */

/** Retorna credenciais + prévia de código SEM consumir, escolhendo a mesma conta
 *  pela combinação de MÍDIA + PLATAFORMA do SKU. Usa o primeiro código disponível
 *  da conta selecionada (se houver).
 */
export async function obterCredenciaisParaEnvioPorSkuEMidia(
  skuRaw: string,
  midia: Midia
): Promise<{ login?: string; senha?: string; codigo?: string; contaId?: string } | null> {
  const sku = normalizeSku(skuRaw);
  if (!sku) return { login: "", senha: "", codigo: undefined, contaId: "" };

  const hit = findBySku(sku);
  if (!hit) return null;

  const { jogo, plataforma } = hit;
  const conta = pickContaByMidiaAndPlataforma(jogo, midia, plataforma) || pickContaByMidia(jogo, midia);
  const codigo = (conta?.ativacoes && conta.ativacoes.length > 0) ? String(conta.ativacoes[0]) : undefined;

  return {
    login: conta?.email || "",
    senha: conta?.senha || "",
    codigo,
    contaId: conta?.id || ""
  };
}

/** Consome o próximo código especificamente da MESMA CONTA (id) já usada no envio,
 *  garantindo que e-mail/senha/código pertençam à mesma origem.
 */
export async function consumirCodigoDaMesmaConta(
  skuRaw: string,
  midia: Midia,
  contaId: string
): Promise<{ codigo?: string } | null> {
  const sku = normalizeSku(skuRaw);
  if (!sku) return { codigo: undefined };

  const lista = loadAll();
  const hit = findBySku(sku);
  if (!hit) return null;

  const { jogo } = hit;
  const contas = jogo.contas || [];
  const idx = contas.findIndex(c => c.id === contaId && c.midia === midia);
  if (idx < 0) return { codigo: undefined };

  const conta = contas[idx];
  const code = (conta.ativacoes && conta.ativacoes.length > 0) ? String(conta.ativacoes.shift()) : undefined;

  // Persistir a remoção
  const jogoIdx = lista.findIndex(x =>
    (normalizeSku(x.sku_ps4 || "") === sku) ||
    (normalizeSku(x.sku_ps5 || "") === sku) ||
    (normalizeSku(x.sku_ps4s || "") === sku) ||
    (normalizeSku(x.sku_ps5s || "") === sku)
  );
  if (jogoIdx >= 0) {
    lista[jogoIdx].contas = contas;
    saveAll(lista);
  }

  return { codigo: code };
}

/** Registra contagem de vendas por SKU + mídia e atualiza a CONTA correta (P4/P5/S),
 *  respeitando as regras (2 primárias PS4, 2 primárias PS5, 1 secundária travada na plataforma).
 *  Mantém também o mapa legado zion.jogos.vendas (para contagem agregada por SKU+Mídia).
 */
export async function registrarVendaPorSku(skuRaw: string, midia: Midia): Promise<void> {
  const sku = normalizeSku(skuRaw);

  // ===== 1) mapa legado de contagem (mantido p/ compatibilidade) =====
  const KEY = "zion.jogos.vendas";
  let mapa: Record<string, number> = {};
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) mapa = JSON.parse(raw) || {};
  } catch {}
  const key = `${sku}:${midia}`;
  mapa[key] = (mapa[key] || 0) + 1;
  try { localStorage.setItem(KEY, JSON.stringify(mapa)); } catch {}

  // ===== 2) atualizar a CONTA correta (contadores por plataforma/mídia) =====
  if (!sku) return;

  const hit = findBySku(sku);
  if (!hit) return;

  const { jogo, plataforma } = hit; // "ps4" | "ps5" | "ps4s" | "ps5s"
  const contas = jogo.contas || [];
  if (!contas.length) return;

  const conta = pickContaByMidiaAndPlataforma(jogo, midia, plataforma) || pickContaByMidia(jogo, midia);
  if (!conta) return;

  const lista = loadAll();
  const jogoIdx = lista.findIndex(j =>
    normalizeSku(j.sku_ps4) === sku ||
    normalizeSku(j.sku_ps5) === sku ||
    normalizeSku(j.sku_ps4s) === sku ||
    normalizeSku(j.sku_ps5s) === sku
  );
  if (jogoIdx < 0) return;

  const contasIdx = contas.findIndex(c => c.id === conta.id);
  if (contasIdx < 0) return;

  const current = { ...conta };
  const isPS4 = plataforma === "ps4" || plataforma === "ps4s";
  const isPS5 = plataforma === "ps5" || plataforma === "ps5s";

  if (midia === "PRIMARIA") {
    if (isPS4) current.sold_p_ps4 = Math.min(2, (current.sold_p_ps4 ?? 0) + 1);
    if (isPS5) current.sold_p_ps5 = Math.min(2, (current.sold_p_ps5 ?? 0) + 1);
  } else {
    // SECUNDÁRIA: vende 1x e trava na plataforma correspondente
    if (!current.sold_s) {
      current.sold_s = true;
      current.sold_s_plat = isPS4 ? "PS4" : "PS5";
    }
  }

  const nextContas = contas.map((c, i) => (i === contasIdx ? current : c));
  const nextJogo = { ...jogo, contas: nextContas };
  const nextLista = [
    ...lista.slice(0, jogoIdx),
    nextJogo,
    ...lista.slice(jogoIdx + 1),
  ];
  saveAll(nextLista);
}
