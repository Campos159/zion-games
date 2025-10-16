// src/pages/PromoListPage.tsx
import { useEffect, useState } from "react";
import axios from "axios";

type Promo = {
  nome: string;
  preco_original: number;
  preco_atual: number;
  desconto?: number;
  fim_promocao?: string | null;
  preco_zion?: number;
  url?: string | null;
};

export function PromoListPage() {
  const [data, setData] = useState<Promo[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      // IMPORTANTE: usar /api/... para pegar o proxy do Vite
      const r = await axios.get("/api/promocoes/listar", { params: { q } });
      const arr: Promo[] = (r.data?.promocoes || r.data || []) as Promo[];
      setData(arr);
    } catch (e: any) {
      setErr("Falha ao carregar promoções.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // opcional: auto refresh a cada 5 min
    const t = setInterval(load, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, []); // primeira carga

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Promoções – PlayStation Store</h1>
        <p className="text-slate-600 text-sm">
          Tabela de promoções. A busca filtra por nome do jogo, no próprio backend.
        </p>
      </div>

      <div className="bg-white rounded-2xl shadow-card border border-slate-100 p-3 flex gap-2 items-center">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filtrar por jogo (ex: GTA, EA FC)..."
          className="flex-1 border rounded-lg px-3 py-2 outline-none"
          onKeyDown={(e) => e.key === "Enter" && load()}
        />
        <button
          onClick={load}
          className="rounded-lg bg-brand-600 text-white px-4 py-2 hover:bg-brand-700 transition"
        >
          Buscar
        </button>
      </div>

      <div className="bg-white rounded-2xl shadow-card border border-slate-100 overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-slate-700">
            <tr>
              <th className="text-left px-3 py-2">Jogo</th>
              <th className="text-right px-3 py-2">Preço original</th>
              <th className="text-right px-3 py-2">Preço promo</th>
              <th className="text-right px-3 py-2">Desconto</th>
              <th className="text-left px-3 py-2">Válida até</th>
              <th className="text-right px-3 py-2">Zion (0,75)</th>
              <th className="text-left px-3 py-2">Link</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-slate-500">
                  Carregando...
                </td>
              </tr>
            )}
            {err && !loading && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-red-600">
                  {err}
                </td>
              </tr>
            )}
            {!loading && !err && data.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-slate-500">
                  Nenhuma promoção encontrada.
                </td>
              </tr>
            )}
            {!loading && !err && data.map((p, i) => (
              <tr key={i} className="border-t">
                <td className="px-3 py-2">{p.nome}</td>
                <td className="px-3 py-2 text-right">
                  {p.preco_original?.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                </td>
                <td className="px-3 py-2 text-right">
                  {p.preco_atual?.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                </td>
                <td className="px-3 py-2 text-right">
                  {p.desconto != null ? `${p.desconto.toFixed(0)}%` : "—"}
                </td>
                <td className="px-3 py-2">{p.fim_promocao || "—"}</td>
                <td className="px-3 py-2 text-right">
                  {p.preco_zion != null
                    ? p.preco_zion.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
                    : "—"}
                </td>
                <td className="px-3 py-2">
                  {p.url ? (
                    <a
                      href={p.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-brand-700 hover:underline"
                    >
                      Abrir na PS Store
                    </a>
                  ) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
