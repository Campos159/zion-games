// src/services/fulfillment.ts
export type Variante = "PS4 Primária" | "PS4 Secundária" | "PS5 Primária" | "PS5 Secundária";

export type FulfillmentPayload = {
  triggered_by: "admin_zion" | "yampi_webhook" | string;
  order: {
    order_id: string;
    sale_channel: "site" | "yampi" | string;
    items: Array<{
      sku: string;
      qty: number;
      name: string;
      variant_name: string; // "PlayStation 4" | "PlayStation 5"
      credentials?: {
        login?: string;
        senha?: string;
        codigo?: string;
        variant?: Variante;
      };
    }>;
    customer: {
      name: string;
      email: string;
      phone_e164: string; // +55...
      // compat legado
      login?: string;
      senha?: string;
      codigo?: string;
      nome_jogo?: string;
    };
  };
  options?: {
    send_via?: Array<"email" | "whatsapp">;
    deadline_minutes?: number;
  };
  metadata?: Record<string, unknown>;
};

type ApiResponse<T = any> = { ok?: boolean } & T;

// Descobre a base do backend (dev/prod)
const API_BASE =
  // Vite
  (import.meta as any)?.env?.VITE_API_BASE?.replace(/\/+$/, "") ||
  // CRA/Webpack
  (typeof process !== "undefined" && (process as any)?.env?.REACT_APP_API_BASE?.replace(/\/+$/, "")) ||
  // runtime (ex.: window.__API_BASE__ = 'https://zion-games.onrender.com')
  (typeof window !== "undefined" && (window as any).__API_BASE__?.replace(/\/+$/, "")) ||
  // fallback local
  "http://127.0.0.1:8000";

export async function iniciarEnvio(payload: FulfillmentPayload): Promise<ApiResponse> {
  const url = `${API_BASE}/fulfillment/create`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  let data: any = null;
  try {
    data = await resp.json();
  } catch {
    // mantém data=null
  }
  if (!resp.ok) {
    const errTxt = (data && (data.detail || data.error)) || `HTTP ${resp.status}`;
    return { ok: false, error: errTxt, status: resp.status, data };
  }
  // Backend devolve { ok, status, data }
  return typeof data === "object" && data ? data : { ok: true };
}
