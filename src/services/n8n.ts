// src/services/n8n.ts
export type N8nPayload = {
  order_id: string;
  customer: {
    name: string;
    email: string;
    phone_e164: string;
  };
  items: Array<{
    sku: string;
    name: string;
    qty: number;
    variant_name: string;
    credentials: {
      login: string;
      senha: string;
      codigo: string;
      variant: string; // PS4/PS5 Primária/Secundária (texto)
    };
  }>;
  meta?: Record<string, any>;
};

/**
 * Envia os dados para o webhook do n8n.
 * - URL vem de VITE_N8N_WEBHOOK_URL (recomendado) ou parâmetro explícito
 */
export async function postToN8n(
  payload: N8nPayload,
  url = import.meta.env?.VITE_N8N_WEBHOOK_URL as string | undefined
): Promise<{ ok: boolean; status: number; body?: any; error?: string }> {
  if (!url) {
    return { ok: false, status: 0, error: "VITE_N8N_WEBHOOK_URL não configurada" };
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const ct = res.headers.get("content-type") || "";
    const body = ct.includes("application/json") ? await res.json().catch(() => ({})) : await res.text().catch(() => "");
    return { ok: res.ok, status: res.status, body };
  } catch (e: any) {
    return { ok: false, status: 0, error: e?.message || "Falha ao chamar webhook n8n" };
  }
}
