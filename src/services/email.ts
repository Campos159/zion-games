// src/services/emails.ts
export type SendItemEmailPayload = {
  item_id: number | string;
  destinatario: string;
  cliente_nome: string;
  pedido_codigo?: string | number | null;
  jogo: string;
  template_tipo?: string;
  login?: string;
  senha?: string;
  codigo?: string;
};

function apiBase(): string {
  // tente ler das envs do build e caia para window/runtime
  const env =
    (typeof process !== "undefined" && (process as any)?.env?.REACT_APP_API_BASE) ||
    (typeof process !== "undefined" && (process as any)?.env?.VITE_API_BASE) ||
    (typeof window !== "undefined" && (window as any).__API_BASE__) ||
    "http://127.0.0.1:8000";
  return String(env).replace(/\/+$/, "");
}

export async function enviarItemEmail(data: SendItemEmailPayload) {
  const url = `${apiBase()}/emails/send-item`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`emails/send-item ${resp.status}: ${text || "falha ao enviar e-mail"}`);
  }
  return resp.json();
}
