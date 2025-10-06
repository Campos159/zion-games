// src/services/fulfillment.ts
export type Variante =
  | "PS4 Primária" | "PS4 Secundária"
  | "PS5 Primária" | "PS5 Secundária";

export type FulfillmentPayload = {
  triggered_by: string;
  order: {
    order_id: string;
    sale_channel: string;
    items: Array<{
      sku: string;
      qty: number;
      name: string;
      variant_name: string;
      credentials: {
        login: string;
        senha: string;
        codigo: string;
        variant: Variante;
      };
    }>;
    customer: {
      name: string;
      email: string;
      phone_e164: string;
      login: string;
      senha: string;
      codigo: string;
      nome_jogo: string;
    };
  };
  options: {
    send_via: ("whatsapp" | "email")[];
    deadline_minutes: number;
  };
  metadata?: any;
};

export async function iniciarEnvio(payload: FulfillmentPayload): Promise<{ ok: boolean } | null> {
  const res = await fetch("/fulfillment/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  try {
    return await res.json();
  } catch {
    return { ok: false };
  }
}
