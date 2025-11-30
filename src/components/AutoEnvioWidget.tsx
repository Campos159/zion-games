// src/components/AutoEnvioWidget.tsx
import React, { useEffect, useState } from "react";
import {
  autoenvioSubscribe,
  autoenvioSnapshot,
  autoenvioPause,
  autoenvioResume,
  autoenvioCancel,
  autoenvioSendNow,
  type AutoEnvioStatus,
} from "../services/autoenvio";

type Row = { id: number; status: AutoEnvioStatus; remainingMs: number };

function fmt(ms?: number) {
  const v = Math.max(0, Math.floor((ms ?? 0) / 1000));
  const m = Math.floor(v / 60);
  const s = v % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function AutoEnvioWidget() {
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    // snapshot inicial
    const snap = autoenvioSnapshot();
    const now = Date.now();
    setRows(
      Object.entries(snap).map(([idStr, t]) => ({
        id: Number(idStr),
        status: t.status,
        remainingMs: t.status === "running" ? Math.max(0, t.targetAt - now) : t.remainingMs,
      }))
    );

    // updates em tempo real
    autoenvioSubscribe({
      onStatus: ({ pedidoId, status, remainingMs }) => {
        setRows((prev) => {
          const m = new Map(prev.map((r) => [r.id, r]));
          m.set(pedidoId, { id: pedidoId, status, remainingMs: remainingMs ?? 0 });
          return Array.from(m.values()).sort((a, b) => a.id - b.id);
        });
      },
    });
  }, []);

  return (
    <div className="fixed bottom-4 right-4 w-[320px] rounded-2xl bg-white/10 border border-white/20 backdrop-blur p-3 text-sm z-40">
      <div className="font-semibold mb-2">Auto-Envio (5 min)</div>
      <div className="space-y-2 max-h-[50vh] overflow-auto pr-1">
        {rows.length === 0 && <div className="opacity-70">Sem pedidos com timer.</div>}
        {rows.map((r) => (
          <div key={r.id} className="p-2 rounded-xl bg-white/5 border border-white/10">
            <div className="flex items-center justify-between gap-2">
              <div># {r.id}</div>
              <div className="text-xs uppercase">{r.status}</div>
            </div>
            {r.status === "running" && (
              <div className="mt-1 text-xs opacity-80">Dispara em: <b>{fmt(r.remainingMs)}</b></div>
            )}
            <div className="mt-2 flex gap-2">
              {r.status === "running" && (
                <button className="px-2 py-1 rounded bg-amber-600 text-white" onClick={() => autoenvioPause(r.id)}>Pausar</button>
              )}
              {r.status === "paused" && (
                <button className="px-2 py-1 rounded bg-emerald-600 text-white" onClick={() => autoenvioResume(r.id)}>Retomar</button>
              )}
              {r.status !== "processing" && (
                <button className="px-2 py-1 rounded bg-blue-600 text-white" onClick={() => autoenvioSendNow(r.id)}>Enviar agora</button>
              )}
              <button className="px-2 py-1 rounded bg-rose-600 text-white ml-auto" onClick={() => autoenvioCancel(r.id)}>Cancelar</button>
            </div>
          </div>
        ))}
      </div>
      <style>{`
        .bg-white\\/10 { background-color: rgba(255,255,255,0.10); }
        .bg-white\\/5  { background-color: rgba(255,255,255,0.05); }
        .border-white\\/20 { border-color: rgba(255,255,255,0.20); }
        .border-white\\/10 { border-color: rgba(255,255,255,0.10); }
      `}</style>
    </div>
  );
}
