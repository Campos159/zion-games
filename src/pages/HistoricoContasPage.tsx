// src/pages/HistoricoContasPage.tsx
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import {
  montarHistorico,
  type HistoricoContaVenda,
} from "../utils/historicoConta";

/**
 * Página de histórico de contas:
 * - Lista TODAS as vendas (backend + legado + importadas via Excel)
 * - Permite BUSCAR pelo e-mail da conta (email_conta), código, cliente, etc.
 * - Mostra: cliente, telefone, conta enviada (email/senha), código, jogo, plataforma e mídia.
 */

function stripAccents(s: string) {
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Linha da planilha de histórico (Venda.xlsx)
 * Ajustado de acordo com as colunas:
 * COD | DATA | EMAIL | SENHA | NICK | JOGO | VALOR | PS4 | PS5 | SecPS4 | SecPSS5 | CLIENTE | TELEFONE | ATIVAÇÃO | ENDEREÇO
 */
type HistoricoExcelRow = {
  COD?: number;
  DATA?: Date | string | number;
  EMAIL?: string;
  SENHA?: string;
  NICK?: string;
  JOGO?: string;
  VALOR?: number;
  PS4?: number;
  PS5?: number;
  SecPS4?: number;
  SecPSS5?: number;
  CLIENTE?: string;
  TELEFONE?: string;
  "ATIVAÇÃO"?: string;
  "ENDEREÇO"?: string;
};

/* ========= Estrutura da tabela de jogos no localStorage ========= */

type Midia = "PRIMARIA" | "SECUNDARIA";
type PlataformaConta = "PS4" | "PS5" | "PS4s" | "PS5s";

type ContaJogoLS = {
  id: string;
  email: string;
  nick: string;
  senha: string;
  ativacoes: string[] | string; // pode ter legado como string
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
const HIST_CODES_STORAGE = "zion.histCodesByAccount";

/* ========= Helpers genéricos ========= */

function normalizeEmail(s?: string | null): string {
  return (s ?? "").trim().toLowerCase();
}

function normalizePlataforma(
  s?: string | null
): "PS4" | "PS5" | "PS4s" | "PS5s" | "" {
  if (!s) return "";
  const up = s.toUpperCase();
  if (up === "PS4") return "PS4";
  if (up === "PS5") return "PS5";
  if (up === "PS4S") return "PS4s";
  if (up === "PS5S") return "PS5s";
  return up as any;
}

/** Plataforma “base”: PS4s → PS4, PS5s → PS5 */
function basePlataforma(s?: string | null): "PS4" | "PS5" | "" {
  const norm = normalizePlataforma(s);
  if (norm === "PS4" || norm === "PS4s") return "PS4";
  if (norm === "PS5" || norm === "PS5s") return "PS5";
  return "";
}

/* ========= Helpers para Excel ========= */

function mapPlataformaMidiaFromExcel(row: HistoricoExcelRow) {
  let plataformaItem: string = "PS4";
  let midiaItem: Midia = "PRIMARIA";

  if (row.PS4 === 1) {
    plataformaItem = "PS4";
    midiaItem = "PRIMARIA";
  } else if (row.SecPS4 === 1) {
    plataformaItem = "PS4";
    midiaItem = "SECUNDARIA";
  } else if (row.PS5 === 1) {
    plataformaItem = "PS5";
    midiaItem = "PRIMARIA";
  } else if (row.SecPSS5 === 1) {
    plataformaItem = "PS5";
    midiaItem = "SECUNDARIA";
  }

  return { plataformaItem, midiaItem };
}

function formatExcelDate(value: HistoricoExcelRow["DATA"]): string {
  if (!value) return "";

  if (value instanceof Date) {
    const yyyy = value.getFullYear();
    const mm = String(value.getMonth() + 1).padStart(2, "0");
    const dd = String(value.getDate()).padStart(2, "0");
    return `${dd}/${mm}/${yyyy}`;
  }

  if (typeof value === "number") {
    // se no futuro quiser, dá pra converter número serial do Excel pra data
    return String(value);
  }

  return String(value);
}

/* ========= Helpers para consumir novo código da conta ========= */

function registrarCodigoConsumido(conta: ContaJogoLS, codigo: string) {
  try {
    const rawHist = localStorage.getItem(HIST_CODES_STORAGE);
    let hist: Record<string, string[]> = rawHist ? JSON.parse(rawHist) : {};

    const emailKey = normalizeEmail(conta.email);
    const platBase = basePlataforma(conta.plataforma);
    const midia = conta.midia ?? "PRIMARIA";

    const key = `${emailKey}::${platBase}::${midia}`;
    if (!hist[key]) hist[key] = [];
    hist[key].push(codigo);

    localStorage.setItem(HIST_CODES_STORAGE, JSON.stringify(hist));
  } catch {
    // se der erro no histórico, não bloqueia o fluxo principal
  }
}

/**
 * Lê a tabela de jogos no localStorage, encontra a conta
 * correspondente ao registro do histórico e remove (shift)
 * um código das ativações dessa conta.
 *
 * Critérios de match:
 *  - e-mail normalizado (trim + lowercase) igual
 *  - plataforma base igual (PS4 vs PS4s / PS5 vs PS5s)
 *  - não exigimos que a mídia bata (PRIMARIA/SECUNDARIA),
 *    porque na prática cada conta tem e-mail único.
 *
 * Retorna o código removido ou null se não houver.
 */
function consumirNovoCodigoDaContaFromStorage(
  h: HistoricoContaVenda
): string | null {
  if (typeof window === "undefined") return null;

  const raw = localStorage.getItem(JOGOS_STORAGE_KEY);
  if (!raw) return null;

  let jogos: JogoLS[];
  try {
    jogos = JSON.parse(raw) as JogoLS[];
  } catch {
    return null;
  }

  const emailHist = normalizeEmail(h.contaEmail);
  const platHistBase = basePlataforma(h.plataformaItem);

  let codigo: string | null = null;
  let contaEncontrada: ContaJogoLS | null = null;

  outer: for (const jogo of jogos) {
    if (!jogo.contas) continue;
    for (const conta of jogo.contas) {
      const emailContaNorm = normalizeEmail(conta.email);
      const platContaBase = basePlataforma(conta.plataforma);

      if (!emailHist || !emailContaNorm) continue;

      // precisa bater e-mail
      if (emailContaNorm !== emailHist) continue;

      // se as duas plataformas base estiverem preenchidas, comparamos
      if (platHistBase && platContaBase && platHistBase !== platContaBase) {
        continue;
      }

      // garante que ativacoes seja array
      let ativacoes = conta.ativacoes;
      if (typeof ativacoes === "string") {
        ativacoes = ativacoes
          .split(/\r?\n/)
          .map((x) => x.trim())
          .filter(Boolean);
        conta.ativacoes = ativacoes;
      }

      if (Array.isArray(ativacoes) && ativacoes.length > 0) {
        codigo = ativacoes.shift() || null;
        contaEncontrada = conta;
        // só para o loop se achou um código mesmo
        break outer;
      }

      // se não tinha códigos nessa conta, continua procurando nos outros jogos
    }
  }

  if (!codigo || !contaEncontrada) {
    return null;
  }

  try {
    localStorage.setItem(JOGOS_STORAGE_KEY, JSON.stringify(jogos));
    registrarCodigoConsumido(contaEncontrada, codigo);
  } catch {
    // se der erro ao salvar, já consumimos do array em memória mesmo assim
  }

  return codigo;
}

export default function HistoricoContasPage() {
  const [linhas, setLinhas] = useState<HistoricoContaVenda[]>([]);
  const [busca, setBusca] = useState("");
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [importando, setImportando] = useState(false);

  // carregar histórico (backend + legado)
  useEffect(() => {
    let ativo = true;
    async function run() {
      try {
        setLoading(true);
        setErro(null);
        const dados = await montarHistorico();
        if (!ativo) return;
        setLinhas(dados);
      } catch (e: any) {
        console.error("[HistoricoContasPage] erro ao montarHistorico:", e);
        if (!ativo) return;
        setErro(String(e?.message || e));
      } finally {
        if (ativo) setLoading(false);
      }
    }
    void run();
    return () => {
      ativo = false;
    };
  }, []);

  // importa histórico antigo via planilha Excel e adiciona às linhas atuais
  const handleImportarExcel = async (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setImportando(true);

      const arrayBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: "array" });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];

      const rows = XLSX.utils.sheet_to_json<HistoricoExcelRow>(worksheet, {
        defval: "",
      });

      const novosRegistros: HistoricoContaVenda[] = rows.map((row, idx) => {
        const { plataformaItem, midiaItem } = mapPlataformaMidiaFromExcel(row);

        const quando = formatExcelDate(row.DATA);
        const clienteNome = row.CLIENTE ?? "";
        const clienteTelefone = row.TELEFONE
          ? String(row.TELEFONE)
          : "";
        const clienteEmail = row["ENDEREÇO"] ?? "";

        const contaEmail = row.EMAIL ?? "";
        const contaSenha = row.SENHA ?? "";
        const contaNick = row.NICK ?? "";

        const nomeProduto = row.JOGO ?? "";
        const codigoAtivacao = row["ATIVAÇÃO"] ?? "";

        const pedidoId = row.COD ?? 0;
        const itemId = idx + 1; // só para ter uma chave identificadora

        const registro: HistoricoContaVenda = {
          clienteNome,
          clienteTelefone,
          clienteEmail,

          contaEmail,
          contaSenha,
          contaNick,

          codigoAtivacao,

          nomeProduto,
          sku: "",

          plataformaItem,
          midiaItem,

          pedidoId,
          itemId,
          pedido: undefined,

          quando,
        } as unknown as HistoricoContaVenda;

        return registro;
      });

      setLinhas((prev) => [...prev, ...novosRegistros]);

      alert(
        `Histórico antigo importado com sucesso! ${novosRegistros.length} registro(s) adicionados nesta sessão.`
      );
    } catch (e) {
      console.error("[HistoricoContasPage] erro ao importar Excel:", e);
      alert(
        "Erro ao importar a planilha de histórico. Verifique o arquivo e tente novamente."
      );
    } finally {
      setImportando(false);
      // permite selecionar o mesmo arquivo de novo se quiser
      event.target.value = "";
    }
  };

  // handler para gerar/enviar novo código da conta
  async function handleNovoCodigo(h: HistoricoContaVenda) {
    if (!h.contaEmail) {
      alert("Essa linha não tem e-mail de conta vinculado.");
      return;
    }

    const ok = window.confirm(
      `Gerar um NOVO código para esta conta?\n\nConta: ${h.contaEmail}\nPlataforma: ${h.plataformaItem}\nMídia: ${h.midiaItem}\n\nO código será removido da tabela de jogos (zion.jogos).`
    );
    if (!ok) return;

    const codigo = consumirNovoCodigoDaContaFromStorage(h);

    if (!codigo) {
      alert(
        "Não foi encontrado nenhum código disponível para essa conta na tabela de jogos. Verifique o cadastro em Jogos."
      );
      return;
    }

    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(codigo);
        alert(
          `Novo código gerado e removido da tabela de jogos:\n\n${codigo}\n\nO código já foi copiado para sua área de transferência.`
        );
      } else {
        alert(
          `Novo código gerado e removido da tabela de jogos:\n\n${codigo}\n\n(Clipboard API indisponível; copie manualmente).`
        );
      }
    } catch {
      alert(
        `Novo código gerado e removido da tabela de jogos:\n\n${codigo}\n\n(Não foi possível copiar automaticamente; copie manualmente).`
      );
    }
  }

  // NOVO: exportar o que está na tabela (linhas filtradas) para Excel
  function handleExportarExcel() {
    // usa as linhas que estão sendo exibidas (já filtradas)
    const dados = filtradas.map((h) => ({
      Quando: h.quando || "",
      Cliente: h.clienteNome || "",
      "E-mail Cliente": h.clienteEmail || "",
      Telefone: h.clienteTelefone || "",
      "E-mail Conta": h.contaEmail || "",
      Nick: h.contaNick || "",
      Senha: h.contaSenha || "",
      "Código Ativação": h.codigoAtivacao || "",
      Jogo: h.nomeProduto || "",
      SKU: h.sku || "",
      Plataforma: h.plataformaItem || "",
      Midia: h.midiaItem || "",
      "Pedido ID": h.pedidoId ?? "",
      "Item ID": h.itemId ?? "",
      Status: h.pedido?.status ?? "",
    }));

    if (dados.length === 0) {
      alert("Não há registros para exportar.");
      return;
    }

    const worksheet = XLSX.utils.json_to_sheet(dados);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "HistoricoContas");

    // gera o arquivo para download
    XLSX.writeFile(workbook, "historico_contas.xlsx");
  }

  // busca / filtro
  const filtradas = useMemo(() => {
    const q = stripAccents(busca.trim().toLowerCase());
    if (!q) return linhas;

    return linhas.filter((h) => {
      const campos: string[] = [];

      // dados do cliente
      campos.push(h.clienteNome || "");
      campos.push(h.clienteEmail || "");
      campos.push(h.clienteTelefone || "");

      // dados da conta ENVIADA (PSN)
      campos.push(h.contaEmail || "");
      campos.push(h.contaNick || "");
      campos.push(h.contaSenha || "");
      campos.push(h.codigoAtivacao || "");

      // produto / pedido
      campos.push(h.nomeProduto || "");
      campos.push(h.sku || "");
      campos.push(h.plataformaItem || "");
      campos.push(h.midiaItem || "");
      campos.push(String(h.pedidoId || ""));
      campos.push(String(h.itemId || ""));
      campos.push(h.quando || "");

      const joined = stripAccents(campos.join(" | ").toLowerCase());
      return joined.includes(q);
    });
  }, [linhas, busca]);

  function copiarParaClipboard(txt: string) {
    if (!txt) return;
    try {
      if (navigator?.clipboard?.writeText) {
        navigator.clipboard.writeText(txt);
        alert("Copiado!");
      } else {
        throw new Error("Clipboard API indisponível");
      }
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = txt;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        alert("Copiado!");
      } catch {
        alert("Não foi possível copiar automaticamente.");
      }
    }
  }

  return (
    <div className="space-y-6">
      {/* HEADER */}
      <div>
        <h1 className="text-lg sm:text-xl font-semibold text-slate-900">
          Histórico de Contas
        </h1>
        <p className="text-slate-600 text-sm mt-1">
          Veja para quais clientes cada <b>conta PSN</b> foi enviada.
          Pesquise pelo <b>e-mail da conta</b>, código de ativação, nome do
          cliente ou telefone.
        </p>
        <p className="text-slate-500 text-xs mt-1">
          Você também pode importar um arquivo Excel com históricos antigos
          (planilha Venda.xlsx). Os registros importados valem apenas nesta
          sessão do navegador.
        </p>
      </div>

      {/* BUSCA + IMPORTAÇÃO + EXPORTAÇÃO */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-col md:flex-row gap-2 md:items-center">
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por e-mail da conta, código, cliente, telefone, jogo…"
            className="flex-1 border rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-brand-100"
          />
          <div className="text-sm text-slate-500">
            {filtradas.length} registro(s)
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-2 sm:items-center text-xs text-slate-600">
          {/* IMPORTAR EXCEL */}
          <label className="inline-flex items-center gap-2">
            <span className="px-3 py-1 border rounded-lg cursor-pointer bg-slate-50 hover:bg-slate-100">
              Selecionar planilha Excel…
            </span>
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={handleImportarExcel}
              disabled={importando}
              className="hidden"
            />
          </label>

          {/* EXPORTAR EXCEL */}
          <button
            type="button"
            onClick={handleExportarExcel}
            className="px-3 py-1 border rounded-lg bg-emerald-50 hover:bg-emerald-100 text-emerald-700"
          >
            Exportar Excel (tela atual)
          </button>

          {importando && (
            <span className="text-[11px] text-slate-500">
              Importando registros do Excel…
            </span>
          )}
        </div>
      </div>

      {/* STATUS */}
      {loading && (
        <div className="text-sm text-slate-600">
          Carregando histórico de vendas…
        </div>
      )}
      {erro && (
        <div className="text-sm text-rose-700">
          Erro ao carregar histórico: {erro}
        </div>
      )}

      {/* TABELA */}
      {!loading && !erro && (
        <div className="bg-white rounded-2xl shadow-card border border-slate-100 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-700">
              <tr>
                <th className="text-left px-3 py-2">Quando</th>
                <th className="text-left px-3 py-2">Cliente</th>
                <th className="text-left px-3 py-2">Telefone</th>
                <th className="text-left px-3 py-2">Conta enviada (PSN)</th>
                <th className="text-left px-3 py-2">Código</th>
                <th className="text-left px-3 py-2">Jogo / Versão</th>
                <th className="text-left px-3 py-2">Pedido</th>
              </tr>
            </thead>
            <tbody>
              {filtradas.map((h) => {
                const isPrim = h.midiaItem === "PRIMARIA";
                const chipClasses =
                  "inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] " +
                  (isPrim
                    ? "bg-blue-100 border-blue-200 text-blue-800"
                    : "bg-amber-100 border-amber-200 text-amber-800");

                const versaoLabel = `${h.plataformaItem} ${
                  isPrim ? "(Primária)" : "(Secundária)"
                }`;

                return (
                  <tr
                    key={`${h.pedidoId}-${h.itemId}-${h.codigoAtivacao || ""}-${h.quando}`}
                    className="border-t align-top"
                  >
                    {/* Quando */}
                    <td className="px-3 py-2 whitespace-nowrap">
                      {h.quando || "—"}
                    </td>

                    {/* Cliente */}
                    <td className="px-3 py-2">
                      <div className="flex flex-col">
                        <span className="font-medium text-slate-900">
                          {h.clienteNome}
                        </span>
                        <span className="text-xs text-slate-600">
                          {h.clienteEmail || "—"}
                        </span>
                      </div>
                    </td>

                    {/* Telefone */}
                    <td className="px-3 py-2">
                      {h.clienteTelefone ? (
                        <button
                          type="button"
                          onClick={() =>
                            copiarParaClipboard(h.clienteTelefone!)
                          }
                          className="text-xs text-brand-700 hover:underline"
                          title="Copiar telefone"
                        >
                          {h.clienteTelefone}
                        </button>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>

                    {/* Conta enviada (email/nick/senha) */}
                    <td className="px-3 py-2">
                      <div className="text-xs text-slate-800 space-y-0.5">
                        <div>
                          <span className="font-semibold">E-mail:</span>{" "}
                          {h.contaEmail || "—"}
                        </div>
                        <div>
                          <span className="font-semibold">Nick:</span>{" "}
                          {h.contaNick || "—"}
                        </div>
                        <div>
                          <span className="font-semibold">Senha:</span>{" "}
                          {h.contaSenha || "—"}
                        </div>
                      </div>
                    </td>

                    {/* Código de ativação + botão novo código */}
                    <td className="px-3 py-2">
                      <div className="flex flex-col gap-1">
                        {h.codigoAtivacao ? (
                          <button
                            type="button"
                            onClick={() =>
                              copiarParaClipboard(h.codigoAtivacao!)
                            }
                            className="text-xs text-brand-700 hover:underline text-left"
                            title="Copiar código atual"
                          >
                            {h.codigoAtivacao}
                          </button>
                        ) : (
                          <span className="text-xs text-slate-400">
                            (sem código atual)
                          </span>
                        )}

                        <button
                          type="button"
                          onClick={() => handleNovoCodigo(h)}
                          className="text-[11px] inline-flex items-center justify-center px-2 py-1 rounded border border-slate-300 text-slate-700 hover:bg-slate-50"
                          title="Gerar um novo código para esta conta e removê-lo da tabela de jogos"
                        >
                          Novo código
                        </button>
                      </div>
                    </td>

                    {/* Jogo / Versão */}
                    <td className="px-3 py-2">
                      <div className="flex flex-col gap-1">
                        <div className="text-slate-900 font-medium">
                          {h.nomeProduto}
                        </div>
                        <div className="text-xs text-slate-600">
                          SKU: {h.sku || "—"}
                        </div>
                        <div>
                          <span className={chipClasses}>
                            <span className="font-semibold">
                              {h.plataformaItem}
                            </span>
                            <span>•</span>
                            <span>{isPrim ? "Primária" : "Secundária"}</span>
                          </span>
                        </div>
                      </div>
                    </td>

                    {/* Pedido */}
                    <td className="px-3 py-2">
                      <div className="text-xs text-slate-700 space-y-0.5">
                        <div>
                          <span className="font-semibold">Pedido:</span>{" "}
                          {h.pedidoId}
                        </div>
                        <div>
                          <span className="font-semibold">Item:</span>{" "}
                          {h.itemId}
                        </div>
                        <div>
                          <span className="font-semibold">Status:</span>{" "}
                          {h.pedido?.status ?? "—"}
                        </div>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtradas.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-3 py-6 text-center text-slate-500"
                  >
                    Nenhum registro encontrado para o filtro informado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
