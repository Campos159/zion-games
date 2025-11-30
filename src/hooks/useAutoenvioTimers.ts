// src/hooks/useAutoenvioTimers.ts
import { useEffect, useState } from "react";
import { bootAutoEnvioInBackground, autoenvioSnapshot } from "../services/autoenvio";

export type AutoEnvioStatus = "running" | "paused" | "processing" | "sent" | "cancelled";

export type TimerView = {
  pedidoId: number;
  status: AutoEnvioStatus;
  remainingMs: number;
};

type TimersDict = Record<number, TimerView>;

export function useAutoenvioTimers() {
  const [timers, setTimers] = useState<TimersDict>({});

  useEffect(() => {
    // garante o motor ligado (caso a página seja aberta direto)
    bootAutoEnvioInBackground();

    // estado inicial (snapshot)
    try {
      const snap = autoenvioSnapshot() as any;
      const mapped: TimersDict = {};
      Object.values(snap || {}).forEach((t: any) => {
        mapped[t.pedidoId] = {
          pedidoId: t.pedidoId,
          status: t.status,
          remainingMs: Number(t.remainingMs || Math.max(0, (t.targetAt ?? 0) - Date.now())),
        };
      });
      setTimers(mapped);
    } catch {}

    // ouvintes em tempo real
    const onStatus = (ev: Event) => {
      const { pedidoId, status, remainingMs } = (ev as CustomEvent).detail || {};
      setTimers(prev => ({
        ...prev,
        [pedidoId]: {
          pedidoId,
          status,
          remainingMs: Number(remainingMs ?? prev[pedidoId]?.remainingMs ?? 0),
        },
      }));
    };

    const onTick = () => {
      // tick suave: não é obrigatório puxar o snapshot, mas podemos suavizar aqui se quiser
      // exemplo simples: reatribuir para forçar re-render e mostrar ms atualizado caso necessário
      // (como já recebemos status com remainingMs no emitStatus, isso é opcional)
    };

    window.addEventListener("zion:autoenvio:status", onStatus as any);
    window.addEventListener("zion:autoenvio:tick", onTick as any);

    return () => {
      window.removeEventListener("zion:autoenvio:status", onStatus as any);
      window.removeEventListener("zion:autoenvio:tick", onTick as any);
    };
  }, []);

  return timers;
}

/* Utilitário opcional para formatar mm:ss */
export function formatCountdown(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}
