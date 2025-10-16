// src/pages/VendasPage.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import {
  listarPedidos,
  listarItens,
  type PedidoRead,
  type ItemRead,
} from "../services/pedidos";

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, BarChart, Bar,
} from "recharts";

/* ===========================================================
   CONFIGS / CORES
   =========================================================== */
const BLUE = "#1E40AF";
const COLORS = ["#2563EB", "#3B82F6", "#60A5FA", "#93C5FD"];

const fmtBRL = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n || 0);

type VendaFlat = {
  id: string;
  data: string;       // yyyy-mm-dd (normalizada local)
  jogo: string;
  plataforma: string;
  quantidade: number;
  total: number;
  cliente: string;
  status: string;
};

/* ===========================================================
   HELPERS DE DATA (robustos p/ timezone e strings variadas)
   =========================================================== */
function ymdLocal(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function parseDateSafe(s: string | undefined | null): Date | null {
  if (!s) return null;
  // se vier só yyyy-mm-dd, força como data local meia-noite
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
function isWithinLastDays(d: Date, days: number, today = startOfToday()) {
  const from = addDays(today, -days + 1); // inclui hoje
  return d >= from && d <= addDays(today, 0);
}

/* ===========================================================
   COMPONENTE
   =========================================================== */
export function VendasPage() {
  const [carregando, setCarregando] = useState(true);
  const [pedidos, setPedidos] = useState<PedidoRead[]>([]);
  const [itens, setItens] = useState<ItemRead[]>([]);
  const [filtroPeriodo, setFiltroPeriodo] = useState<"tudo" | "dia" | "semana" | "mes">("tudo");
  const [somentePagos, setSomentePagos] = useState(false);

  // para evitar race entre refreshes
  const isMountedRef = useRef(true);

  // ===== fetch centralizado (usado no mount e no intervalo) =====
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

      const todosItens = entries.flatMap(([id, arr]) => arr.map((i) => ({ ...i, pedido_id: id } as ItemRead)));

      if (!isMountedRef.current) return;
      setPedidos(pedidosApi);
      setItens(todosItens);
      // console.debug("Pedidos:", pedidosApi);
      // console.debug("Itens:", todosItens);
    } catch (err) {
      console.error("Erro ao carregar vendas:", err);
    } finally {
      if (isMountedRef.current) setCarregando(false);
    }
  };

  // ===== mount/unmount + auto refresh 60s =====
  useEffect(() => {
    isMountedRef.current = true;
    fetchData();
    const id = window.setInterval(fetchData, 60_000); // 60s
    return () => {
      isMountedRef.current = false;
      window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ===== flaten vendas =====
  const vendas: VendaFlat[] = useMemo(() => {
    const map = new Map<number, PedidoRead>();
    pedidos.forEach((p) => map.set(p.id, p));

    return itens.map((i) => {
      const pedido = map.get(i.pedido_id);
      const total =
        i.total_item != null
          ? Number(i.total_item)
          : Number(i.preco_unitario || 0) * Number(i.quantidade || 0);

      // normaliza data local (yyyy-mm-dd)
      const d = parseDateSafe(pedido?.data_criacao || "");
      const dataLocal = d ? ymdLocal(d) : "";

      return {
        id: `${i.pedido_id}-${i.id}`,
        data: dataLocal,
        jogo: i.nome_produto,
        plataforma: i.plataforma,
        quantidade: i.quantidade,
        total,
        cliente: pedido?.cliente_nome || "",
        status: pedido?.status || "PENDING",
      };
    });
  }, [pedidos, itens]);

  // ===== filtro por período (agora com definição clara) =====
  const hoje = startOfToday();
  const filtradas = useMemo(() => {
    return vendas.filter((v) => {
      if (!v.data) return false;
      const d = parseDateSafe(v.data);
      if (!d) return false;

      if (somentePagos && v.status !== "PAID") return false;

      switch (filtroPeriodo) {
        case "dia":
          return sameLocalDay(d, hoje);
        case "semana":
          // últimos 7 dias (rolling, incluindo hoje)
          return isWithinLastDays(d, 7, hoje);
        case "mes":
          // mês calendário atual
          return d.getFullYear() === hoje.getFullYear() && d.getMonth() === hoje.getMonth();
        default:
          return true;
      }
    });
  }, [vendas, filtroPeriodo, somentePagos, hoje]);

  // ===== KPIs =====
  const totalVendas = filtradas.length;
  const totalReceita = filtradas.reduce((s, v) => s + v.total, 0);

  // ===== por plataforma =====
  const porPlataforma = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const v of filtradas) counts[v.plataforma] = (counts[v.plataforma] || 0) + v.quantidade;
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [filtradas]);

  // ===== top jogos =====
  const topJogos = useMemo(() => {
    const map = new Map<string, number>();
    for (const v of filtradas) map.set(v.jogo, (map.get(v.jogo) || 0) + v.quantidade);
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);
  }, [filtradas]);

  // ===== top clientes (lista) =====
  const topClientes = useMemo(() => {
    const map = new Map<string, { nome: string; qtd: number; total: number }>();
    for (const v of filtradas) {
      if (!v.cliente) continue;
      if (!map.has(v.cliente)) map.set(v.cliente, { nome: v.cliente, qtd: 0, total: 0 });
      const c = map.get(v.cliente)!;
      c.qtd += v.quantidade;
      c.total += v.total;
    }
    return Array.from(map.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);
  }, [filtradas]);

  // ===== evolução (diária nos períodos; mensal no "tudo") =====
  const evolucao = useMemo(() => {
    if (filtroPeriodo === "tudo") {
      // mensal
      const map: Record<string, number> = {};
      for (const v of filtradas) {
        const d = parseDateSafe(v.data);
        if (!d) continue;
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        map[key] = (map[key] || 0) + v.quantidade;
      }
      return Object.entries(map)
        .map(([periodo, vendas]) => ({ periodo, vendas }))
        .sort((a, b) => a.periodo.localeCompare(b.periodo));
    } else {
      // evolução diária no recorte
      const map: Record<string, number> = {};
      for (const v of filtradas) {
        map[v.data] = (map[v.data] || 0) + v.quantidade;
      }

      // garantir pontos vazios no eixo (especialmente em 'semana' e 'mes')
      let daysRange: string[] = [];
      if (filtroPeriodo === "dia") {
        daysRange = [ymdLocal(hoje)];
      } else if (filtroPeriodo === "semana") {
        for (let i = 6; i >= 0; i--) daysRange.push(ymdLocal(addDays(hoje, -i)));
      } else if (filtroPeriodo === "mes") {
        const start = startOfMonth(hoje);
        const temp: string[] = [];
        for (let d = new Date(start); d <= hoje; d = addDays(d, 1)) {
          temp.push(ymdLocal(d));
        }
        daysRange = temp;
      }

      const rows = (daysRange.length ? daysRange : Object.keys(map)).map((k) => ({
        periodo: k,
        vendas: map[k] || 0,
      }));
      return rows.sort((a, b) => a.periodo.localeCompare(b.periodo));
    }
  }, [filtradas, filtroPeriodo, hoje]);

  /* ===========================================================
     RENDER
     =========================================================== */
  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-center flex-wrap gap-2">
        <h1 className="text-2xl font-semibold text-slate-900">
          Painel de Vendas
        </h1>
        <div className="flex gap-2">
          {(["tudo", "dia", "semana", "mes"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setFiltroPeriodo(p)}
              className={`px-3 py-1.5 rounded-lg text-sm ${
                filtroPeriodo === p
                  ? "bg-blue-600 text-white"
                  : "bg-slate-200 hover:bg-slate-300"
              }`}
            >
              {p === "tudo" ? "Tudo" : p === "dia" ? "Hoje" : p === "semana" ? "Semana" : "Mês"}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-3 items-center">
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={somentePagos}
            onChange={(e) => setSomentePagos(e.target.checked)}
          />
          Somente pedidos pagos
        </label>
        {carregando && <span className="text-sm text-slate-500">Atualizando…</span>}
      </div>

      {/* KPIs */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="bg-blue-600 text-white rounded-2xl p-4">
          <div className="text-sm opacity-80">Total de Vendas</div>
          <div className="text-3xl font-bold">{carregando ? "…" : totalVendas}</div>
        </div>
        <div className="bg-blue-500 text-white rounded-2xl p-4">
          <div className="text-sm opacity-80">Receita Total</div>
          <div className="text-3xl font-bold">{fmtBRL(totalReceita)}</div>
        </div>
        <div className="bg-blue-700 text-white rounded-2xl p-4">
          <div className="text-sm opacity-80">Ticket Médio</div>
          <div className="text-3xl font-bold">
            {totalVendas ? fmtBRL(totalReceita / totalVendas) : "R$ 0,00"}
          </div>
        </div>
      </div>

      {/* Gráficos */}
      <div className="grid lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl shadow border border-slate-100 p-4">
          <h2 className="font-semibold mb-2">
            {filtroPeriodo === "tudo" ? "Evolução mensal" : "Evolução diária"}
          </h2>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={evolucao}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="periodo" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Legend />
              <Line
                type="monotone"
                dataKey="vendas"
                stroke={BLUE}
                strokeWidth={3}
                dot={{ r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-2xl shadow border border-slate-100 p-4">
          <h2 className="font-semibold mb-2">Top Jogos</h2>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={topJogos} layout="vertical" margin={{ left: 40 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" allowDecimals={false} />
              <YAxis dataKey="name" type="category" width={140} />
              <Tooltip />
              <Bar dataKey="value" fill={BLUE} barSize={20} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl shadow border border-slate-100 p-4">
          <h2 className="font-semibold mb-2">Vendas por Plataforma</h2>
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie
                data={porPlataforma}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={85}
                label
              >
                {porPlataforma.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-2xl shadow border border-slate-100 p-4">
          <h2 className="font-semibold mb-2">Top Clientes</h2>
          {topClientes.length === 0 ? (
            <p className="text-slate-500 text-sm text-center py-6">Nenhum cliente encontrado</p>
          ) : (
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="text-left px-2 py-1">Cliente</th>
                  <th className="text-center px-2 py-1">Qtd</th>
                  <th className="text-right px-2 py-1">Total Gasto</th>
                </tr>
              </thead>
              <tbody>
                {topClientes.map((c) => (
                  <tr key={c.nome} className="border-t">
                    <td className="px-2 py-2 font-medium">{c.nome}</td>
                    <td className="px-2 py-2 text-center">{c.qtd}</td>
                    <td className="px-2 py-2 text-right text-blue-700 font-semibold">
                      {fmtBRL(c.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
