// src/services/email.ts
import { api } from "./api";

export async function previewEmailItem(itemId: number) {
  const { data } = await api.get(`/itens/${itemId}/email-preview`);
  return data;
}

export async function enviarEmailItem(itemId: number, overrideTo?: string) {
  const { data } = await api.post(`/itens/${itemId}/enviar-email`, overrideTo ? { override_to: overrideTo } : {});
  return data;
}
