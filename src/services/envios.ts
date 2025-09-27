// src/services/envios.ts
import { api } from "./api";

export type SendItemEmailPayload = {
  item_id: number;
  to: string;          // email do cliente
  subject: string;
  body: string;        // texto simples (backend pode transformar em HTML se quiser)
};

export async function sendItemEmail(payload: SendItemEmailPayload): Promise<{ ok: boolean }> {
  // espera existir no backend: POST /emails/send-item
  const { data } = await api.post<{ ok: boolean }>("/emails/send-item", payload);
  return data;
}
