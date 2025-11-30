// src/pages/CustosPage.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import {
  listarPedidos,
  listarItens,
  type PedidoRead,
  type ItemRead,
} from "../services/pedidos";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

/* ===========================================================
   CONFIGS / CORES
   =========================================================== */
const BLUE = "#1E40AF";

const fmtBRL = (n: number) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(n || 0);

/* ===========================================================
   TIPOS
   =========================================================== */
type VendaFlat = {
  id: string;
  data: string; // yyyy-mm-dd (normalizada local)
  total: number; // faturamento da venda
  status: string;
};

type CustoEvento = {
  data: string; // yyyy-mm-dd
  valor: number; // custo da conta nesse dia
};

/** Estrutura simplificada dos jogos no localStorage */
type ContaJogoLS = {
  preco?: number;
  /** Data de cadastro da conta (string, ex: "2025-11-18" ou ISO) */
  data_cadastro?: string;
};

type JogoLS = {
  jogo: string;
  contas?: ContaJogoLS[];
};

/* ===========================================================
   HELPERS DE DATA
   =========================================================== */
function ymdLocal(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseDateSafe(s: string | undefined | null): Date | null {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [Y, M, D] = s.split("-").map(Number);
    return new Date(Y, (M || 1) - 1, D || 1);
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function startOfToday() {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

function addDays(d: Date, delta: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + delta);
  return x;
}

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function sameLocalDay(a: Date, b: Date) {
  return ymdLocal(a) === ymdLocal(b);
}

/* ===========================================================
   HELPERS DE CUSTOS (localStorage)
   =========================================================== */

const JOGOS_STORAGE_KEY = "zion.jogos";

/** Normaliza string de data para yyyy-mm-dd; se não conseguir, cai no dia de hoje */
function normalizeDateOrToday(s?: string | null): string {
  const d = parseDateSafe(s || "");
  if (d) return ymdLocal(d);
  return ymdLocal(new Date());
}

/**
 * Lê do localStorage os jogos/contas e converte em eventos de custo por dia:
 * - Cada conta com `preco > 0` gera um "CustoEvento" no dia `data_cadastro`.
 * - Se `data_cadastro` estiver ausente/ruim, o custo cai no dia atual.
 */
function buildCustoEventosFromJogos(): CustoEvento[] {
  const eventos: CustoEvento[] = [];

  try {
    const raw = localStorage.getItem(JOGOS_STORAGE_KEY);
    if (!raw) return eventos;

    const jogos = JSON.parse(raw) as JogoLS[];
    if (!Array.isArray(jogos)) return eventos;

    for (const j of jogos) {
      const contas = Array.isArray(j.contas) ? j.contas : [];
      for (const c of contas) {
        const preco = Number(c.preco || 0);
        if (!preco || Number.isNaN(preco) || preco <= 0) continue;

        const data = normalizeDateOrToday(c.data_cadastro);
        eventos.push({ data, valor: preco });
      }
    }
  } catch (err) {
    console.error("Erro ao ler custos de contas do localStorage:", err);
  }

  return eventos;
}

/* ===========================================================
   COMPONENTE
   =========================================================== */
export function CustosPage() {
  const [carregando, setCarregando] = useState(true);
  const [pedidos, setPedidos] = useState<PedidoRead[]>([]);
  const [itens, setItens] = useState<ItemRead[]>([]);
  const [filtroPeriodo, setFiltroPeriodo] =
    useState<"tudo" | "dia" | "semana" | "mes">("tudo");
  const [somentePagos, setSomentePagos] = useState(false);
  const [dataEspecifica, setDataEspecifica] = useState<string>("");

  // versão local dos jogos (pra forçar recalcular custos quando o JogosPage mexer no storage)
  const [jogosVersion, setJogosVersion] = useState(0);

  const isMountedRef = useRef(true);
  const hoje = startOfToday();

  // ===== busca pedidos/itens (igual VendasPage) =====
  const fetchData = async () => {
    try {
      setCarregando(true);
      const pedidosApi = await listarPedidos();

      const entries: Array<[number, ItemRead[]]> = await Promise.all(
        pedidosApi.map(async (p) => {
          try {
            const its = await listarItens(p.id);
            return [p.id, its] as [number, ItemRead[]];
          } catch {
            return [p.id, [] as ItemRead[]];
          }
        })
      );

      const todosItens = entries.flatMap(([id, arr]) =>
        arr.map((i) => ({ ...i, pedido_id: id } as ItemRead))
      );

      if (!isMountedRef.current) return;
      setPedidos(pedidosApi);
      setItens(todosItens);
    } catch (err) {
      console.error("Erro ao carregar dados para custos:", err);
    } finally {
      if (isMountedRef.current) setCarregando(false);
    }
  };

  useEffect(() => {
    isMountedRef.current = true;
    fetchData();
    const id = window.setInterval(fetchData, 60_000);
    return () => {
      isMountedRef.current = false;
      window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ===== ouvir alterações no localStorage de jogos (vindas da JogosPage/jogos.ts) =====
  useEffect(() => {
    const bumpVersion = () => {
      setJogosVersion((v) => v + 1);
    };

    // eventos customizados que o jogos.ts dispara no saveAll(...)
    window.addEventListener("zion:jogos-updated", bumpVersion as EventListener);
    window.addEventListener("zion.jogos:refresh", bumpVersion as EventListener);

    // caso edição em outra aba altere o localStorage
    const onStorage = (e: StorageEvent) => {
      if (e.key === JOGOS_STORAGE_KEY) bumpVersion();
    };
    window.addEventListener("storage", onStorage);

    return () => {
      window.removeEventListener(
        "zion:jogos-updated",
        bumpVersion as EventListener
      );
      window.removeEventListener(
        "zion.jogos:refresh",
        bumpVersion as EventListener
      );
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  // ===== flatten vendas (apenas o necessário p/ custos: data, total, status) =====
  const vendas: VendaFlat[] = useMemo(() => {
    const map = new Map<number, PedidoRead>();
    pedidos.forEach((p) => map.set(p.id, p));

    return itens.map((i) => {
      const pedido = map.get(i.pedido_id);
      const total =
        i.total_item != null
          ? Number(i.total_item)
          : Number(i.preco_unitario || 0) * Number(i.quantidade || 0);

      const d = parseDateSafe(pedido?.data_criacao || "");
      const dataLocal = d ? ymdLocal(d) : "";

      return {
        id: `${i.pedido_id}-${i.id}`,
        data: dataLocal,
        total,
        status: pedido?.status || "PENDING",
      };
    });
  }, [pedidos, itens]);

  // ===== eventos de custo lidos do localStorage (atualizados via jogosVersion) =====
  const custoEventos: CustoEvento[] = useMemo(
    () => buildCustoEventosFromJogos(),
    [jogosVersion]
  );

  // ===== função de filtro de período/dataEspecifica =====
  const matchesPeriodo = (dataStr: string): boolean => {
    if (!dataStr) return false;
    const d = parseDateSafe(dataStr);
    if (!d) return false;

    // se o usuário escolheu uma data específica, manda nessa data
    if (dataEspecifica) {
      return dataStr === dataEspecifica;
    }

    switch (filtroPeriodo) {
      case "dia":
        return sameLocalDay(d, hoje);
      case "semana": {
        const from = addDays(hoje, -6); // últimos 7 dias, incluindo hoje
        return d >= from && d <= hoje;
      }
      case "mes": {
        return (
          d.getFullYear() === hoje.getFullYear() &&
          d.getMonth() === hoje.getMonth()
        );
      }
      default:
        return true; // "tudo"
    }
  };

  // ===== resumo diário: custo do dia + faturamento do dia + resultado =====
  const resumoPorDia = useMemo(() => {
    const map = new Map<
      string,
      {
        data: string;
        custo: number;
        faturamento: number;
        resultado: number;
        qtdVendas: number;
      }
    >();

    const ensureDay = (data: string) => {
      if (!map.has(data)) {
        map.set(data, {
          data,
          custo: 0,
          faturamento: 0,
          resultado: 0,
          qtdVendas: 0,
        });
      }
      return map.get(data)!;
    };

    // custos: cada conta entra no dia do cadastro, independente de venda
    for (const ev of custoEventos) {
      if (!matchesPeriodo(ev.data)) continue;
      const row = ensureDay(ev.data);
      row.custo += ev.valor;
    }

    // vendas: somar faturamento por dia (considerando filtro de pagos/não pagos)
    for (const v of vendas) {
      if (!v.data) continue;
      if (!matchesPeriodo(v.data)) continue;
      if (somentePagos && v.status !== "PAID") continue;

      const row = ensureDay(v.data);
      row.faturamento += v.total;
      row.qtdVendas += 1;
    }

    // resultado = faturamento - custo
    for (const row of map.values()) {
      row.resultado = row.faturamento - row.custo;
    }

    const arr = Array.from(map.values());
    arr.sort((a, b) => a.data.localeCompare(b.data));
    return arr;
  }, [custoEventos, vendas, filtroPeriodo, dataEspecifica, somentePagos, hoje]);

  // ===== KPIs agregados do período =====
  const totalCusto = resumoPorDia.reduce((s, r) => s + r.custo, 0);
  const totalFaturamento = resumoPorDia.reduce(
    (s, r) => s + r.faturamento,
    0
  );
  const totalResultado = resumoPorDia.reduce((s, r) => s + r.resultado, 0);
  const totalVendas = resumoPorDia.reduce((s, r) => s + r.qtdVendas, 0);

  // ===== série para gráfico (Custo x Faturamento) =====
  const serieGrafico = resumoPorDia.map((r) => ({
    data: r.data,
    custo: r.custo,
    faturamento: r.faturamento,
  }));

  /* ===========================================================
     RENDER
     =========================================================== */
  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* HEADER / FILTROS */}
      <div className="flex justify-between items-center flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">
            Painel de Custos & Resultado Diário
          </h1>
          <p className="text-slate-600 text-sm">
            Custo reconhecido no dia do cadastro da conta, faturamento pelas
            vendas do dia e resultado = faturamento - custo.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
          <div className="flex gap-2">
            {(["tudo", "dia", "semana", "mes"] as const).map((p) => (
              <button
                key={p}
                onClick={() => {
                  setFiltroPeriodo(p);
                  setDataEspecifica(""); // limpamos data específica ao trocar o período rápido
                }}
                className={`px-3 py-1.5 rounded-lg text-sm ${
                  filtroPeriodo === p && !dataEspecifica
                    ? "bg-blue-600 text-white"
                    : "bg-slate-200 hover:bg-slate-300"
                }`}
              >
                {p === "tudo"
                  ? "Tudo"
                  : p === "dia"
                  ? "Hoje"
                  : p === "semana"
                  ? "Semana"
                  : "Mês"}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">ou filtrar por dia:</span>
            <input
              type="date"
              value={dataEspecifica}
              onChange={(e) => setDataEspecifica(e.target.value)}
              className="border rounded-lg px-2 py-1 text-sm"
            />
            {dataEspecifica && (
              <button
                type="button"
                onClick={() => setDataEspecifica("")}
                className="text-xs text-rose-600 hover:underline"
              >
                limpar
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="flex gap-3 items-center">
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={somentePagos}
            onChange={(e) => setSomentePagos(e.target.checked)}
          />
          Somente pedidos pagos (no faturamento)
        </label>
        {carregando && (
          <span className="text-sm text-slate-500">Atualizando…</span>
        )}
      </div>

      {/* KPIs */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-blue-600 text-white rounded-2xl p-4">
          <div className="text-sm opacity-80">Vendas no período</div>
          <div className="text-3xl font-bold">
            {carregando ? "…" : totalVendas}
          </div>
        </div>
        <div className="bg-blue-500 text-white rounded-2xl p-4">
          <div className="text-sm opacity-80">Faturamento Total</div>
          <div className="text-3xl font-bold">
            {fmtBRL(totalFaturamento)}
          </div>
        </div>
        <div className="bg-blue-700 text-white rounded-2xl p-4">
          <div className="text-sm opacity-80">Custo Total</div>
          <div className="text-3xl font-bold">{fmtBRL(totalCusto)}</div>
        </div>
        <div className="bg-blue-800 text-white rounded-2xl p-4">
          <div className="text-sm opacity-80">Resultado (Faturamento - Custo)</div>
          <div className="text-3xl font-bold">{fmtBRL(totalResultado)}</div>
        </div>
      </div>

      {/* Gráfico de Custo x Faturamento */}
      <div className="bg-white rounded-2xl shadow border border-slate-100 p-4">
        <h2 className="font-semibold mb-2">
          Evolução diária de Custo x Faturamento
        </h2>
        {serieGrafico.length === 0 ? (
          <p className="text-sm text-slate-500 py-6 text-center">
            Nenhum dado para o período selecionado.
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={serieGrafico}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="data" />
              <YAxis tickFormatter={(v) => fmtBRL(v as number)} />
              <Tooltip
                formatter={(value) =>
                  typeof value === "number" ? fmtBRL(value) : value
                }
              />
              <Line
                type="monotone"
                dataKey="custo"
                name="Custo"
                stroke={BLUE}
                strokeWidth={3}
                dot={{ r: 3 }}
              />
              <Line
                type="monotone"
                dataKey="faturamento"
                name="Faturamento"
                stroke="#16A34A"
                strokeWidth={3}
                dot={{ r: 3 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Tabela de custos apenas */}
      <div className="bg-white rounded-2xl shadow border border-slate-100 p-4">
        <h2 className="font-semibold mb-2">
          Tabela de Custos (apenas custo por dia)
        </h2>
        {resumoPorDia.length === 0 ? (
          <p className="text-sm text-slate-500 py-6 text-center">
            Nenhum dado para o período selecionado.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="text-left px-2 py-1">Data</th>
                  <th className="text-right px-2 py-1">Custo do dia</th>
                </tr>
              </thead>
              <tbody>
                {resumoPorDia.map((r) => (
                  <tr key={r.data} className="border-t">
                    <td className="px-2 py-1">{r.data}</td>
                    <td className="px-2 py-1 text-right">
                      {fmtBRL(r.custo)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Resumo diário completo: Custo x Faturamento x Resultado */}
      <div className="bg-white rounded-2xl shadow border border-slate-100 p-4">
        <h2 className="font-semibold mb-2">
          Resumo diário (Custo x Faturamento x Resultado)
        </h2>
        {resumoPorDia.length === 0 ? (
          <p className="text-sm text-slate-500 py-6 text-center">
            Nenhum dado para o período selecionado.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="text-left px-2 py-1">Data</th>
                  <th className="text-right px-2 py-1">Faturamento</th>
                  <th className="text-right px-2 py-1">Custo</th>
                  <th className="text-right px-2 py-1">
                    Resultado (Fat. - Custo)
                  </th>
                  <th className="text-center px-2 py-1">Qtd. Vendas</th>
                </tr>
              </thead>
              <tbody>
                {resumoPorDia.map((r) => (
                  <tr key={r.data} className="border-t">
                    <td className="px-2 py-1">{r.data}</td>
                    <td className="px-2 py-1 text-right">
                      {fmtBRL(r.faturamento)}
                    </td>
                    <td className="px-2 py-1 text-right">
                      {fmtBRL(r.custo)}
                    </td>
                    <td className="px-2 py-1 text-right text-emerald-700 font-semibold">
                      {fmtBRL(r.resultado)}
                    </td>
                    <td className="px-2 py-1 text-center">
                      {r.qtdVendas || 0}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
