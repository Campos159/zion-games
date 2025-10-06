// src/services/http.ts
export type ApiFetchOptions = {
  timeoutMs?: number;
};

export async function apiFetch<T = any>(
  input: string,
  init?: RequestInit,
  opts?: ApiFetchOptions
): Promise<T> {
  const { timeoutMs = 6000 } = opts || {};

  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(input, { ...init, signal: controller.signal });
  } catch (err: any) {
    clearTimeout(id);
    if (err?.name === "AbortError") {
      throw new Error(`Timeout de ${timeoutMs}ms ao contatar ${input}`);
    }
    throw err;
  } finally {
    clearTimeout(id);
  }

  const contentType = res.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (!isJson && text.toLowerCase().startsWith("<!doctype")) {
      throw new Error(
        `A URL ${input} respondeu HTML (provável 404 do Vite/proxy). Verifique proxy/rota do backend.`
      );
    }
    try {
      const j = JSON.parse(text);
      throw new Error(j?.detail || j?.message || `Erro HTTP ${res.status}`);
    } catch {
      throw new Error(text || `Erro HTTP ${res.status}`);
    }
  }

  if (isJson) return (await res.json()) as T;

  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    // último recurso
    return text as unknown as T;
  }
}
