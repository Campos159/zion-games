// src/main.tsx
import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider, useAuth } from "./modules/auth/AuthContext";
import { bootAutoEnvioInBackground, getAutoEnvio } from "./services/autoenvio";
import "./index.css";

function AutoEnvioBoot() {
  const { isAuthenticated, token } = useAuth() as any;

  useEffect(() => {
    if (!isAuthenticated && !token) return;

    bootAutoEnvioInBackground({ delayMs: 5 * 60 * 1000 }); // 5 min

    const engine = getAutoEnvio();

    // opcional: repassar toasts para UI global
    engine.subscribe({
      onToast: ({ type, msg }) => {
        try { window.dispatchEvent(new CustomEvent("zion:toast", { detail: { type, msg } })); } catch {}
        console.log(`[autoenvio:toast] ${type}: ${msg}`);
      },
    });

    engine.wake();
    const ping = window.setInterval(() => engine.wake(), 20_000);

    const onStorage = (e: StorageEvent) => {
      if (!e.key) return;
      if (e.key.includes("zion") || e.key.includes("pedidos") || e.key.includes("auth")) {
        engine.wake();
      }
    };
    window.addEventListener("storage", onStorage);

    const onPop = () => engine.wake();
    window.addEventListener("popstate", onPop);

    const onFocus = () => engine.wake();
    const onVis = () => { if (!document.hidden) engine.wake(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);

    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
      window.clearInterval(ping);
    };
  }, [isAuthenticated, token]);

  return null;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthProvider>
      <BrowserRouter>
        <AutoEnvioBoot />
        <App />
      </BrowserRouter>
    </AuthProvider>
  </React.StrictMode>
);

// (opcional) para inspecionar no console
(window as any).autoenvio = getAutoEnvio();
