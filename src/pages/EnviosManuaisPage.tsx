/// <reference types="node" />

// src/pages/EnviosManuaisPage.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { enviarItemEmail } from "../services/email";
import * as JogosSvc from "../services/jogos";

import {
  listarPedidos,
  listarItens,
  type PedidoRead,
  type ItemRead,
  type Plataforma,
} from "../services/pedidos";

import {
  autoenvioSubscribe,
  autoenvioSnapshot,
  autoenvioPause,
  autoenvioResume,
  autoenvioCancel,
  autoenvioSendNow,
  getAutoEnvio,
  seedTimersFromPedidos, // <— novo export para semear
  type AutoEnvioStatus,
} from "../services/autoenvio";

/* ================== Tipos e helpers ================== */
type Variante = "PS4 Primária" | "PS4 Secundária" | "PS5 Primária" | "PS5 Secundária";
const variantes: Variante[] = ["PS4 Primária", "PS4 Secundária", "PS5 Primária", "PS5 Secundária"];

type Midia = "PRIMARIA" | "SECUNDARIA";
function midiaFromVariant(v: Variante): Midia {
  return v.toLowerCase().includes("secundária") ? "SECUNDARIA" : "PRIMARIA";
}

type SkuStatus = "idle" | "loading" | "success" | "notfound" | "error";

type ItemForm = {
  itemId?: number;
  sku: string;
  qty: number;
  name: string;
  variant: Variante;
  variant_name: string;
  login: string;
  senhaRaw: string;
  codigo: string;
};

type JogoPorSku = JogosSvc.JogoPorSku;

type Draft = {
  orderId: string;
  items: ItemForm[];
  nomeCliente: string;
  email: string;
  phone: string;
  viaWhatsapp: boolean;
  viaEmail: boolean;
  autocompletarPorSku: boolean;
};

const DRAFT_KEY = "zion.enviosManuais.draft";

function defaultVariantName(v: Variante): string {
  return v.includes("PS5") ? "PlayStation 5" : "PlayStation 4";
}

function senha2(raw: string): string {
  if (!raw) return "";
  const s = String(raw).trim();
  const parts = s.split(/[/|;]+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) return parts[1];
  const tokens = s.split(/\s+/).filter(Boolean);
  if (tokens.length >= 2) return tokens[tokens.length - 1];
  return s;
}

function clsx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function onlyDigits(v: string) { return (v || "").replace(/\D+/g, ""); }
function maskPhoneStrict(v: string) {
  const d = onlyDigits(v).slice(0, 11);
  if (!d) return "";
  const dd = d.slice(0, 2);
  const rest = d.slice(2);
  if (d.length <= 2) return `(${dd}`;
  if (d.length <= 10) {
    if (rest.length <= 4) return `(${dd}) ${rest}`;
    return `(${dd}) ${rest.slice(0, 4)}-${rest.slice(4)}`;
  }
  const parteA = rest.slice(0, 5);
  const parteB = rest.slice(5, 9);
  if (rest.length <= 5) return `(${dd}) ${parteA}`;
  return `(${dd}) ${parteA}-${parteB}`;
}

function emailValido(v: string) {
  if (!v || v.length > 254) return false;
  if (/\s/.test(v)) return false;
  const re = /^[^\s@]+@[^\s@]+\.[A-Za-z0-9-]{2,63}$/;
  if (!re.test(v)) return false;
  if (v.includes("..")) return false;
  return true;
}

/* ================== Toasts ================== */
type ToastType = "success" | "error" | "info";
type Toast = { id: string; type: ToastType; msg: string };
const TOAST_TTL = 3500;
function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

/* ================== Mapeamentos ================== */
const platToVariante: Record<Plataforma, Variante> = {
  PS4: "PS4 Primária",
  PS4s: "PS4 Secundária",
  PS5: "PS5 Primária",
  PS5s: "PS5 Secundária",
};

/* ======= Backend base + marcar entregue ======= */
function backendBaseUrl(): string {
  const env = (typeof import.meta !== "undefined" ? (import.meta as any).env : {}) || {};
  const base =
    env?.VITE_BACKEND_BASE_URL ||
    (typeof window !== "undefined" && (window as any).__BACKEND_BASE_URL__) ||
    "";
  return String(base || "").replace(/\/+$/, "");
}

async function marcarPedidoEntregue(orderId: string) {
  const url = `${backendBaseUrl()}/yampi/mark-delivered`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ order_id: orderId }),
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`Falha ao marcar entregue (${resp.status}): ${t || "erro"}`);
  }
  return resp.json().catch(() => ({}));
}

/* ======= Autoenvio: helpers UI ======= */
const fmtTime = (ms?: number) => {
  const v = Math.max(0, Math.floor((ms ?? 0) / 1000));
  const m = Math.floor(v / 60);
  const s = v % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
};

/* ================== Página ================== */
export default function EnviosManuaisPage() {
  const [loading, setLoading] = useState(false);
  const [ok, setOk] = useState<null | boolean>(null);
  const [erro, setErro] = useState<string | null>(null);

  const [toasts, setToasts] = useState<Toast[]>([]);
  const timeoutsRef = useRef<Record<string, number>>({});
  function showToast(type: ToastType, msg: string) {
    const id = uid();
    setToasts((t) => [...t, { id, type, msg }]);
    timeoutsRef.current[id] = window.setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
      delete timeoutsRef.current[id];
    }, TOAST_TTL);
  }
  useEffect(() => () => {
    Object.values(timeoutsRef.current).forEach((t) => window.clearTimeout(t));
  }, []);

  // -------- Estado principal (com rascunho)
  const [orderId, setOrderId] = useState("");
  const [items, setItems] = useState<ItemForm[]>([
    { itemId: undefined, sku: "", qty: 1, name: "", variant: "PS5 Primária", variant_name: "PlayStation 5", login: "", senhaRaw: "", codigo: "" },
  ]);
  const [nomeCliente, setNomeCliente] = useState("");
  const [email, setEmail] = useState("");
  const [phoneMask, setPhoneMask] = useState("");

  const [viaWhatsapp, setViaWhatsapp] = useState(true);
  const [viaEmail, setViaEmail] = useState(true);
  const [autocompletarPorSku, setAutocompletarPorSku] = useState(true);

  const [skuStatus, setSkuStatus] = useState<Record<number, SkuStatus>>({});
  const [skuErrorMsg, setSkuErrorMsg] = useState<Record<number, string>>({});
  const [skuDetected, setSkuDetected] = useState<Record<number, JogoPorSku | null>>({});
  const debounceTimers = useRef<Record<number, number>>({});
  const lastSearchedSku = useRef<Record<number, string>>({});

  /* ---------- RASCUNHO: carregar (tipado) ---------- */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;

      const d = JSON.parse(raw) as Partial<Draft> | null;

      const isVariante = (v: any): v is Variante =>
        typeof v === "string" && (["PS4 Primária","PS4 Secundária","PS5 Primária","PS5 Secundária"] as const).includes(v as Variante);

      const src: any[] =
        Array.isArray(d?.items) && d!.items!.length
          ? (d!.items as any[])
          : [
              {
                itemId: undefined,
                sku: "",
                qty: 1,
                name: "",
                variant: "PS5 Primária",
                variant_name: "PlayStation 5",
                login: "",
                senhaRaw: "",
                codigo: "",
              },
            ];

      const restoredItems: ItemForm[] = src.map((row: any): ItemForm => {
        const variant: Variante = isVariante(row?.variant) ? row.variant : "PS5 Primária";
        return {
          itemId: typeof row?.itemId === "number" ? row.itemId : undefined,
          sku: String(row?.sku ?? "").toUpperCase(),
          qty: Number(row?.qty ?? 1),
          name: String(row?.name ?? ""),
          variant,
          variant_name: String(row?.variant_name ?? defaultVariantName(variant)),
          login: String(row?.login ?? ""),
          senhaRaw: String(row?.senhaRaw ?? ""),
          codigo: String(row?.codigo ?? ""),
        };
      });

      setOrderId(String(d?.orderId ?? ""));
      setItems(restoredItems);
      setNomeCliente(String(d?.nomeCliente ?? ""));
      setEmail(String(d?.email ?? ""));
      setPhoneMask(String(d?.phone ?? ""));
      setViaWhatsapp(Boolean(d?.viaWhatsapp));
      setViaEmail(Boolean(d?.viaEmail));
      setAutocompletarPorSku(d?.autocompletarPorSku ?? true);
    } catch {
      showToast("error", "Falha ao carregar rascunho do navegador.");
    }
  }, []);

  /* ---------- RASCUNHO: salvar (debounced) ---------- */
  const saveTimer = useRef<number | null>(null);
  useEffect(() => {
    const draft: Draft = {
      orderId,
      items,
      nomeCliente,
      email,
      phone: phoneMask,
      viaWhatsapp,
      viaEmail,
      autocompletarPorSku,
    };
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
      } catch {
        showToast("error", "Não foi possível salvar o rascunho (localStorage).");
      }
    }, 250);
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [orderId, items, nomeCliente, email, phoneMask, viaWhatsapp, viaEmail, autocompletarPorSku]);

  function limparRascunho() {
    try { localStorage.removeItem(DRAFT_KEY); } catch {}
    setOrderId("");
    setItems([{ itemId: undefined, sku: "", qty: 1, name: "", variant: "PS5 Primária", variant_name: "PlayStation 5", login: "", senhaRaw: "", codigo: "" }]);
    setNomeCliente("");
    setEmail("");
    setPhoneMask("");
    setViaWhatsapp(true);
    setViaEmail(true);
    setSkuStatus({});
    setSkuDetected({});
    setSkuErrorMsg({});
    setOk(null);
    setErro(null);
    showToast("info", "Rascunho limpo.");
  }

  /* ---------- Itens ---------- */
  function addItem() {
    setItems((prev) => [
      ...prev,
      { itemId: undefined, sku: "", qty: 1, name: "", variant: "PS5 Primária", variant_name: "PlayStation 5", login: "", senhaRaw: "", codigo: "" },
    ]);
  }
  function removeItem(ix: number) {
    setItems((prev) => prev.filter((_, i) => i !== ix));
    setSkuStatus((s) => { const { [ix]: _, ...rest } = s; return rest; });
    setSkuErrorMsg((s) => { const { [ix]: _, ...rest } = s; return rest; });
    setSkuDetected((s) => { const { [ix]: _, ...rest } = s; return rest; });
    const t = debounceTimers.current[ix]; if (t) window.clearTimeout(t);
    delete debounceTimers.current[ix];
    delete lastSearchedSku.current[ix];
  }
  function updateItem(ix: number, patch: Partial<ItemForm>) {
    setItems((prev) => prev.map((it, i) => (i === ix ? { ...it, ...patch } : it)));
  }

  async function onChooseVariant(ix: number, v: Variante) {
    updateItem(ix, {
      variant: v,
      variant_name: items[ix].variant_name?.trim() ? items[ix].variant_name : defaultVariantName(v),
    });

    const sku = items[ix].sku.trim().toUpperCase();
    if (autocompletarPorSku && sku) {
      try {
        const midia = midiaFromVariant(v);
        let codigoPreview = "";
        if (typeof (JogosSvc as any).buscarCodigoDisponivelPorSkuEMidia === "function") {
          const r = await (JogosSvc as any).buscarCodigoDisponivelPorSkuEMidia(sku, midia);
          codigoPreview = r?.codigo || "";
        } else if (typeof (JogosSvc as any).previewCodigoPorSkuEMidia === "function") {
          const prev = await (JogosSvc as any).previewCodigoPorSkuEMidia(sku, midia);
          codigoPreview = prev?.codigo || "";
        } else {
          const j = await (JogosSvc as any).buscarJogoPorSku(sku);
          codigoPreview = j?.codigo_preview || "";
        }
        if (codigoPreview) updateItem(ix, { codigo: codigoPreview });
      } catch {}
    }
  }

  /* ---------- Busca SKU ---------- */
  async function fetchSku(ix: number, force = false) {
    const raw = items[ix]?.sku ?? "";
    const sku = raw.trim().toUpperCase().replace(/\s+/g, "");
    if (!autocompletarPorSku || !sku) {
      setSkuStatus((s) => ({ ...s, [ix]: "idle" }));
      setSkuDetected((s) => ({ ...s, [ix]: null }));
      return;
    }
    if (!force && lastSearchedSku.current[ix] === sku) return;
    lastSearchedSku.current[ix] = sku;

    setSkuStatus((s) => ({ ...s, [ix]: "loading" }));
    setSkuErrorMsg((s) => ({ ...s, [ix]: "" }));
    try {
      const jogo = await (JogosSvc as any).buscarJogoPorSku(sku);
      if (!jogo) {
        setSkuStatus((s) => ({ ...s, [ix]: "notfound" }));
        setSkuDetected((s) => ({ ...s, [ix]: null }));
        showToast("info", `SKU não encontrado: ${sku}`);
        return;
      }

      const sug: Variante =
        jogo.console === "PS4"
          ? (jogo.tipo_midia.toLowerCase().includes("sec") ? "PS4 Secundária" : "PS4 Primária")
          : (jogo.tipo_midia.toLowerCase().includes("sec") ? "PS5 Secundária" : "PS5 Primária");

      updateItem(ix, {
        variant: sug,
        variant_name: defaultVariantName(sug),
        name: jogo.nome_jogo || items[ix].name,
        login: jogo.login || items[ix].login,
        senhaRaw: jogo.senha ? senha2(jogo.senha) : items[ix].senhaRaw,
      });

      const midia = midiaFromVariant(sug);
      let codigoReal = "";
      if (typeof (JogosSvc as any).buscarCodigoDisponivelPorSkuEMidia === "function") {
        const r = await (JogosSvc as any).buscarCodigoDisponivelPorSkuEMidia(sku, midia);
        codigoReal = r?.codigo || "";
      } else if (typeof (JogosSvc as any).previewCodigoPorSkuEMidia === "function") {
        const prev = await (JogosSvc as any).previewCodigoPorSkuEMidia(sku, midia);
        codigoReal = prev?.codigo || "";
      } else {
        codigoReal = jogo.codigo_preview || "";
      }
      updateItem(ix, { codigo: codigoReal });

      setSkuDetected((s) => ({ ...s, [ix]: jogo }));
      setSkuStatus((s) => ({ ...s, [ix]: "success" }));
      showToast("success", `SKU carregado: ${sku}`);
    } catch (e: any) {
      setSkuStatus((s) => ({ ...s, [ix]: "error" }));
      setSkuErrorMsg((s) => ({ ...s, [ix]: e?.message || "Falha ao buscar SKU" }));
      setSkuDetected((s) => ({ ...s, [ix]: null }));
      showToast("error", `Erro ao buscar SKU: ${e?.message || "falha"}`);
    }
  }

  function onChangeSku(ix: number, value: string) {
    const cleaned = value.toUpperCase();
    updateItem(ix, { sku: cleaned });
    setSkuErrorMsg((s) => ({ ...s, [ix]: "" }));
    const existing = debounceTimers.current[ix];
    if (existing) window.clearTimeout(existing);
    debounceTimers.current[ix] = window.setTimeout(() => fetchSku(ix), 350);
  }
  function onPasteSku(ix: number, e: React.ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData("text");
    if (!pasted) return;
    e.preventDefault();
    const cleaned = pasted.toUpperCase();
    updateItem(ix, { sku: cleaned });
    const existing = debounceTimers.current[ix];
    if (existing) window.clearTimeout(existing);
    debounceTimers.current[ix] = window.setTimeout(() => fetchSku(ix, true), 100);
  }
  function onBlurSku(ix: number) {
    const t = debounceTimers.current[ix];
    if (t) window.clearTimeout(t);
    fetchSku(ix, true);
  }

  /* ================== LISTA DE PEDIDOS ================== */
  const [carregaPedidos, setCarregaPedidos] = useState(true);
  const [pedidos, setPedidos] = useState<PedidoRead[]>([]);
  const [busca, setBusca] = useState("");
  const [somentePagos, setSomentePagos] = useState(true);

  const [autoRows, setAutoRows] = useState<Record<number, { status: AutoEnvioStatus; remainingMs: number }>>({});

  // Snapshot inicial + subscribe estável
  useEffect(() => {
    // garante engine on
    try { (getAutoEnvio() as any).start?.(); } catch {}

    const snap = autoenvioSnapshot();
    const nowTs = Date.now();
    const m: Record<number, { status: AutoEnvioStatus; remainingMs: number }> = {};
    for (const [idStr, t] of Object.entries(snap)) {
      const id = Number(idStr);
      m[id] = {
        status: (t as any).status,
        remainingMs: (t as any).status === "running" ? Math.max(0, (t as any).targetAt - nowTs) : (t as any).remainingMs,
      };
    }
    setAutoRows(m);

    const callbacks = {
      onStatus: ({ pedidoId, status, remainingMs }: any) => {
        setAutoRows((prev) => ({ ...prev, [pedidoId]: { status, remainingMs: remainingMs ?? 0 } }));
      },
      onToast: ({ type, msg }: any) => {
        showToast(type, msg);
      },
      onLog: (line: string) => {
        // útil para depuração
        console.debug(line);
      }
    };
    autoenvioSubscribe(callbacks);

    return () => {
      autoenvioSubscribe({}); // limpa callbacks ao desmontar
    };
  }, []);

  // Carrega pedidos e semeia timers (front UI + engine)
  useEffect(() => {
    (async () => {
      try {
        setCarregaPedidos(true);
        const data = await listarPedidos();
        setPedidos(data);
        // semear timers para 5 minutos após criação (se passou, envia já)
        seedTimersFromPedidos(data);
      } finally {
        setCarregaPedidos(false);
      }
    })();
  }, []);

  const isPago = (status?: string | null) => /pago|paid/i.test(String(status || ""));

  const pedidosOrdenados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    let base = pedidos.filter((p) => !p.enviado);
    if (somentePagos) base = base.filter((p) => isPago(p.status));
    if (q) {
      base = base.filter((p) =>
        [p.codigo, p.cliente_nome, p.cliente_email, p.telefone, p.status]
          .map((x) => (x || "").toString().toLowerCase())
          .join("|")
          .includes(q)
      );
    }
    const ts = (d?: string | null) => (d ? new Date(d).getTime() : 0);
    return base
      .slice()
      .sort((a, b) => {
        const diff = ts(a.data_criacao) - ts(b.data_criacao);
        if (diff !== 0) return diff;
        return (a.id ?? 0) - (b.id ?? 0);
      });
  }, [pedidos, busca, somentePagos]);

  const pedidoAtual = useMemo(() => {
    if (!orderId) return null;
    return pedidos.find((p) => String(p.codigo || p.id) === String(orderId).trim()) || null;
  }, [orderId, pedidos]);

  function resetSkuControls() {
    Object.values(debounceTimers.current).forEach((t) => { if (t) window.clearTimeout(t as any); });
    debounceTimers.current = {};
    lastSearchedSku.current = {};
    setSkuStatus({});
    setSkuDetected({});
    setSkuErrorMsg({});
  }

  async function carregarPedidoNaTela(p: PedidoRead) {
    try {
      setLoading(true);
      setOk(null);
      setErro(null);

      const rows: ItemRead[] = await listarItens(p.id);

      const mapped: ItemForm[] = rows.map((r) => {
        const variante = platToVariante[r.plataforma as Plataforma] || "PS5 Primária";
        return {
          itemId: r.id,
          sku: (r.sku || "").toUpperCase(),
          qty: Number(r.quantidade || 1),
          name: r.nome_produto || "",
          variant: variante,
          variant_name: defaultVariantName(variante),
          login: r.email_conta || "",
          senhaRaw: r.senha_conta || "",
          codigo: r.codigo_ativacao || "",
        };
      });

      resetSkuControls();

      setOrderId(String(p.codigo || p.id));
      setItems(mapped.length ? mapped : [
        { itemId: undefined, sku: "", qty: 1, name: "", variant: "PS5 Primária", variant_name: "PlayStation 5", login: "", senhaRaw: "", codigo: "" },
      ]);
      setNomeCliente(p.cliente_nome || "");
      setEmail(p.cliente_email || "");
      setPhoneMask(maskPhoneStrict(p.telefone || ""));

      setTimeout(() => {
        mapped.forEach((_, ix) => fetchSku(ix, true));
      }, 0);

      showToast("info", `Pedido #${p.id} carregado no formulário.`);
      if (!isPago(p.status)) {
        showToast("error", "ATENÇÃO: esse pedido não está pago. O envio será bloqueado até o pagamento.");
      }
    } catch (e: any) {
      showToast("error", `Falha ao carregar itens do pedido: ${e?.message || "erro"}`);
    } finally {
      setLoading(false);
    }
  }

  /* ---------- Validação ---------- */
  function validar(): string | null {
    if (!orderId.trim()) return "Informe um Order ID.";
    if (!items.length) return "Adicione pelo menos 1 item.";
    for (const [i, it] of items.entries()) {
      if (!it.sku.trim()) return `SKU do item #${i + 1} é obrigatório.`;
      if (!it.name.trim()) return `Nome do jogo do item #${i + 1} é obrigatório.`;
      if (!it.variant_name.trim()) return `Variant Name do item #${i + 1} é obrigatório.`;
      if (!Number.isFinite(it.qty) || it.qty < 1) return `Quantidade do item #${i + 1} deve ser ≥ 1.`;
    }
    if (!nomeCliente.trim()) return "Informe o nome do cliente.";
    if (!emailValido(email)) return "E-mail inválido.";
    const d = onlyDigits(phoneMask);
    if (d.length < 8) return "Telefone muito curto. Informe ao menos 8 dígitos.";
    if (!viaWhatsapp && !viaEmail) return "Selecione pelo menos um canal (WhatsApp ou E-mail).";
    if (pedidoAtual && !/pago|paid/i.test(String(pedidoAtual.status || ""))) {
      return "O pedido selecionado ainda não está pago.";
    }
    return null;
  }

  const skusSignature = useMemo(() => items.map(it => it.sku?.trim().toUpperCase() || "").join("|"), [items]);
  useEffect(() => {
    items.forEach((it, ix) => {
      const sku = (it.sku || "").trim();
      if (sku) {
        const t = debounceTimers.current[ix];
        if (t) window.clearTimeout(t);
        fetchSku(ix, true);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skusSignature]);

  /* ---------- Enviar Manual (botão) ---------- */
  async function onEnviar() {
    setLoading(true);
    setOk(null);
    setErro(null);
    try {
      const err = validar();
      if (err) throw new Error(err);

      const semId = items.findIndex(it => !it.itemId);
      if (semId !== -1) {
        throw new Error(`O item #${semId + 1} não possui itemId. Carregue o pedido pela coluna à esquerda para enviar.`);
      }

      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const payload = {
          item_id: it.itemId!,
          destinatario: email.trim(),
          cliente_nome: nomeCliente.trim(),
          pedido_codigo: orderId.trim(),
          jogo: (it.name || "").trim(),
          login: (it.login || "").trim(),
          senha: senha2(it.senhaRaw || ""),
          codigo: (it.codigo || "").trim(),
        };

        try {
          await enviarItemEmail(payload);
          showToast("success", `E-mail do item #${i + 1} enviado para ${email}`);

          try {
            const midia = midiaFromVariant(it.variant);
            const consumo = await (JogosSvc as any).consumirCodigoPorSkuEMidia(it.sku, midia);
            const codigoConsumido = (consumo && typeof consumo === "object" ? (consumo as any).codigo : "") as string;
            setItems((prev) =>
              prev.map((x, ix) =>
                ix === i ? { ...x, codigo: codigoConsumido || x.codigo } : x
              )
            );
          } catch (consErr) {
            showToast("error", "Falha ao consumir o código após o envio.");
          }
        } catch (e: any) {
          showToast("error", `Falha no item #${i + 1}: ${e?.message || "erro"}`);
          throw e;
        }
      }

      setOk(true);
      setErro(null);
      showToast("success", "Todos os e-mails foram enfileirados e códigos consumidos ✅");

      // Marcar entregue + cancelar timer do autoenvio
      try {
        const code = String(orderId || (pedidoAtual?.codigo ?? pedidoAtual?.id) || "").trim();
        if (code) {
          await marcarPedidoEntregue(code);
          showToast("success", `Pedido ${code} marcado como ENTREGUE na Yampi ✅`);
          setPedidos((prev) =>
            prev.map((p) => {
              const same = String(p.codigo || p.id) === String(code);
              if (!same) return p;
              return { ...p, enviado: true, enviado_em: new Date().toISOString() } as PedidoRead;
            })
          );
          const alvo = pedidos.find((p) => String(p.codigo || p.id) === code);
          if (alvo?.id) autoenvioCancel(alvo.id);
        }
      } catch (e: any) {
        showToast("error", e?.message || "Falha ao marcar pedido como entregue na Yampi");
      }
    } catch (e: any) {
      const msg = e?.message || "Erro inesperado ao enviar os e-mails";
      setOk(false);
      setErro(msg);
      showToast("error", msg);
    } finally {
      setLoading(false);
    }
  }

  /* ================== UI ================== */
  const fmtPill = (st?: AutoEnvioStatus) =>
    st === "running" ? "bg-indigo-100 text-indigo-800 border-indigo-200" :
    st === "paused" ? "bg-amber-100 text-amber-800 border-amber-200" :
    st === "processing" ? "bg-blue-100 text-blue-800 border-blue-200" :
    st === "sent" ? "bg-emerald-100 text-emerald-800 border-emerald-200" :
    st === "cancelled" ? "bg-slate-100 text-slate-800 border-slate-200" :
    "bg-slate-100 text-slate-800 border-slate-200";

  return (
    <div className="px-4 py-5 sm:p-6 max-w-7xl mx-auto">
      {/* TOASTS */}
      <div className="fixed top-4 left-4 right-4 sm:left-auto sm:right-4 z-50 space-y-2 sm:w-auto sm:max-w-sm">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={clsx(
              "rounded-xl shadow-lg px-4 py-3 text-sm border",
              t.type === "success" && "bg-emerald-600/90 text-white border-emerald-500/50",
              t.type === "error" && "bg-rose-600/90 text-white border-rose-500/50",
              t.type === "info" && "bg-slate-800/90 text-white border-slate-600/50",
            )}
          >
            {t.msg}
          </div>
        ))}
      </div>

      {/* HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <h1 className="text-xl sm:text-2xl font-bold">Envios Manuais</h1>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={autocompletarPorSku} onChange={(e) => setAutocompletarPorSku(e.target.checked)} />
            Autocompletar por SKU
          </label>
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={somentePagos} onChange={(e) => setSomentePagos(e.target.checked)} />
            Mostrar só pagos
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              className="px-3 py-2 rounded-xl bg-slate-600 hover:bg-slate-700 text-white text-sm"
              onClick={() => {
                setOrderId("MANUAL-" + Math.floor(Math.random() * 99999));
                setItems([
                  { itemId: undefined, sku: "EAFC25-PS5-PRI", qty: 1, name: "", variant: "PS5 Primária", variant_name: "PlayStation 5", login: "", senhaRaw: "", codigo: "" },
                  { itemId: undefined, sku: "GOW-PS4-SEC", qty: 1, name: "", variant: "PS4 Secundária", variant_name: "PlayStation 4", login: "", senhaRaw: "", codigo: "" },
                ]);
                setNomeCliente("Fulano de Tal");
                setEmail("fulano@exemplo.com");
                setPhoneMask("(11) 98888-7777)");
                setViaWhatsapp(true);
                setViaEmail(true);
                setOk(null);
                setErro(null);
                setSkuStatus({});
                setSkuDetected({});
                setSkuErrorMsg({});
                showToast("info", "Exemplo preenchido. Cole um SKU válido para autocompletar.");
              }}
              type="button"
            >
              Preencher Exemplo
            </button>
            <button
              className="px-3 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-sm"
              onClick={limparRascunho}
              type="button"
            >
              Limpar
            </button>
          </div>
        </div>
      </div>

      {/* LAYOUT: pedidos + formulário */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ===== COLUNA DE PEDIDOS ===== */}
        <div className="lg:col-span-1">
          <div className="p-4 rounded-2xl shadow bg-white/5 border border-white/10">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold">Pedidos (FIFO)</h2>
              <span className="text-xs opacity-70">
                {carregaPedidos ? "Carregando..." : `${pedidosOrdenados.length} pendente(s)`}
              </span>
            </div>

            <input
              className="w-full input mb-3"
              placeholder="Buscar por cliente, email, telefone…"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />

            <div className="space-y-2 max-h-[45vh] sm:max-h-[540px] overflow-auto pr-1">
              {pedidosOrdenados.map((p) => {
                const auto = autoRows[p.id];
                return (
                  <div key={p.id} className="p-3 rounded-xl border border-white/10 bg-white/5">
                    <div className="flex items-start justify-between gap-2">
                      <button
                        onClick={() => carregarPedidoNaTela(p)}
                        className="text-left flex-1 hover:opacity-90"
                        title="Carregar este pedido no formulário de envio"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-semibold text-sm truncate">{p.cliente_nome}</div>
                          <span
                            className={clsx(
                              "text-[10px] uppercase tracking-wide rounded-full px-2 py-0.5 border shrink-0",
                              /pago|paid/i.test(String(p.status || ""))
                                ? "bg-emerald-100 text-emerald-800 border-emerald-200"
                                : "bg-amber-100 text-amber-800 border-amber-200"
                            )}
                          >
                            {p.status}
                          </span>
                        </div>
                        <div className="text-xs opacity-90">
                          <b>Data:</b> {p.data_criacao} • <b>Cód:</b> {p.codigo || p.id}
                        </div>
                        <div className="text-xs opacity-80 truncate">{p.cliente_email}</div>
                        <div className="text-xs opacity-60">{p.telefone || "—"}</div>
                      </button>

                      {/* Autoenvio status + ações */}
                      <div className="w-[150px] text-right">
                        <div className={clsx("text-[10px] inline-block rounded-full px-2 py-0.5 border", fmtPill(auto?.status))}>
                          {auto?.status || "—"}
                        </div>
                        {auto?.status === "running" && (
                          <div className="text-[11px] mt-0.5 opacity-80">em {fmtTime(auto.remainingMs)}</div>
                        )}
                        <div className="flex gap-1 mt-2 justify-end">
                          {auto?.status === "running" && (
                            <button
                              className="px-2 py-1 rounded bg-amber-600 text-white text-[11px]"
                              onClick={() => autoenvioPause(p.id)}
                              title="Pausar"
                            >
                              Pause
                            </button>
                          )}
                          {auto?.status === "paused" && (
                            <button
                              className="px-2 py-1 rounded bg-emerald-600 text-white text-[11px]"
                              onClick={() => autoenvioResume(p.id)}
                              title="Retomar"
                            >
                              Retomar
                            </button>
                          )}
                          <button
                            className="px-2 py-1 rounded bg-blue-600 text-white text-[11px]"
                            onClick={() => autoenvioSendNow(p.id)}
                            title="Enviar agora"
                            disabled={auto?.status === "processing"}
                          >
                            Enviar
                          </button>
                          <button
                            className="px-2 py-1 rounded bg-rose-600 text-white text-[11px]"
                            onClick={() => autoenvioCancel(p.id)}
                            title="Cancelar autoenvio"
                          >
                            X
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              {!carregaPedidos && pedidosOrdenados.length === 0 && (
                <div className="text-sm opacity-70">Nenhum pedido pendente.</div>
              )}
            </div>
          </div>
        </div>

        {/* ===== FORMULÁRIO DE ENVIO ===== */}
        <div className="lg:col-span-2">
          {/* Pedido / Itens */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            {/* Pedido */}
            <div className="p-4 rounded-2xl shadow bg-white/5 border border-white/10">
              <h2 className="font-semibold mb-3">Pedido</h2>
              <label className="text-sm">Order ID</label>
              <input className="w-full input" value={orderId} onChange={(e) => setOrderId(e.target.value)} />

              <div className="mt-4">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-2">
                  <h3 className="font-semibold">Itens</h3>
                  <button
                    type="button"
                    className="px-3 py-1 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm"
                    onClick={addItem}
                  >
                    + Adicionar Item
                  </button>
                </div>

                {items.map((it, ix) => {
                  const st = skuStatus[ix] || "idle";
                  const det = skuDetected[ix] || null;
                  const err = skuErrorMsg[ix] || "";
                  return (
                    <div key={ix} className="p-3 rounded-xl bg-white/5 border border-white/10 mb-3">
                      {/* VARIAÇÃO por item */}
                      <div className="mb-2">
                        <div className="text-xs mb-1 opacity-90">Variação do item</div>
                        <div className="relative -mx-1">
                          <div className="flex gap-1 overflow-x-auto no-scrollbar px-1 py-0.5 snap-x snap-mandatory rounded-2xl border border-white/15 bg-white/5">
                            {variantes.map((v) => (
                              <button
                                type="button"
                                key={v}
                                className={clsx(
                                  "px-2.5 py-1.5 text-xs rounded-lg snap-start shrink-0",
                                  v === it.variant ? "bg-indigo-600 text-white" : "hover:bg-white/10"
                                )}
                                onClick={() => onChooseVariant(ix, v)}
                                title="Escolher variação deste item"
                              >
                                {v}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="text-sm">SKU</label>
                          <input
                            className="w-full input"
                            placeholder="Ex.: EAFC25-PS5-PRI"
                            value={it.sku}
                            onChange={(e) => onChangeSku(ix, e.target.value)}
                            onPaste={(e) => onPasteSku(ix, e)}
                            onBlur={() => onBlurSku(ix)}
                          />
                          <div className="mt-1 text-xs min-h-[1.25rem]">
                            {st === "loading" && <span className="text-slate-300">Buscando…</span>}
                            {st === "success" && <span className="text-emerald-400">Encontrado ✅</span>}
                            {st === "notfound" && <span className="text-amber-300">SKU não encontrado</span>}
                            {st === "error" && <span className="text-rose-300">Erro: {err}</span>}
                          </div>
                        </div>
                        <div>
                          <label className="text-sm">Qtd</label>
                          <input
                            type="number"
                            min={1}
                            className="w-full input"
                            value={it.qty}
                            onChange={(e) => updateItem(ix, { qty: Math.max(1, Number(e.target.value || 1)) })}
                          />
                        </div>
                        <div>
                          <label className="text-sm">Nome do Jogo</label>
                          <input
                            className="w-full input"
                            value={it.name}
                            onChange={(e) => updateItem(ix, { name: e.target.value })}
                          />
                        </div>
                        <div>
                          <label className="text-sm">Variant Name</label>
                          <input
                            className="w-full input"
                            placeholder={defaultVariantName(it.variant)}
                            value={it.variant_name}
                            onChange={(e) => updateItem(ix, { variant_name: e.target.value })}
                            onBlur={(e) => {
                              if (!e.target.value.trim()) {
                                updateItem(ix, { variant_name: defaultVariantName(it.variant) });
                              }
                            }}
                          />
                        </div>
                      </div>

                      {/* Credenciais por item */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
                        <div>
                          <label className="text-sm">Login</label>
                          <input className="w-full input" value={it.login} onChange={(e) => updateItem(ix, { login: e.target.value })} />
                        </div>
                        <div>
                          <label className="text-sm">Senha (usaremos a 2ª)</label>
                          <input
                            className="w-full input"
                            value={it.senhaRaw}
                            onChange={(e) => updateItem(ix, { senhaRaw: e.target.value })}
                            placeholder="ex.: senha1/senha2"
                          />
                        </div>
                        <div>
                          <label className="text-sm">Código</label>
                          <input
                            className="w-full input"
                            value={it.codigo}
                            onChange={(e) => updateItem(ix, { codigo: e.target.value })}
                            placeholder="(pré-preenchido pelo SKU; será consumido após envio OK)"
                          />
                        </div>
                      </div>

                      {/* Dados detectados */}
                      {det && (
                        <div className="mt-3 text-xs rounded-lg border border-white/10 bg-white/5 p-2">
                          <div className="opacity-80 mb-1">Dados detectados pelo SKU:</div>
                          <div className="grid sm:grid-cols-2 gap-2">
                            <div>Console: <b>{det.console}</b></div>
                            <div>Mídia: <b>{det.tipo_midia}</b></div>
                            <div>Jogo: <b>{det.nome_jogo}</b></div>
                            <div>Login: <b>{items[ix].login || "—"}</b></div>
                            <div>Senha (2ª): <b>{items[ix].senhaRaw ? senha2(items[ix].senhaRaw) : "—"}</b></div>
                            <div>Código (preview): <b>{items[ix].codigo || det.codigo_preview || "—"}</b></div>
                          </div>
                          <div className="mt-1 opacity-70">
                            * O código só é <b>consumido</b> após o envio ser confirmado como <b>OK</b>.
                          </div>
                        </div>
                      )}

                      {items.length > 1 && (
                        <div className="mt-3 text-right">
                          <button type="button" className="px-3 py-1 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-sm" onClick={() => removeItem(ix)}>
                            Remover item
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Cliente */}
            <div className="p-4 rounded-2xl shadow bg-white/5 border border-white/10">
              <h2 className="font-semibold mb-3">Cliente</h2>
              <label className="text-sm">Nome</label>
              <input className="w-full input" value={nomeCliente} onChange={(e) => setNomeCliente(e.target.value)} />

              <label className="text-sm mt-3 block">Email</label>
              <input className="w-full input" value={email} onChange={(e) => setEmail(e.target.value)} />
              {!emailValido(email) && email.trim() !== "" && (
                <div className="text-xs text-amber-300 mt-1">Formato de e-mail inválido.</div>
              )}

              <label className="text-sm mt-3 block">Telefone</label>
              <input
                className="w-full input"
                value={phoneMask}
                onChange={(e) => setPhoneMask(maskPhoneStrict(e.target.value))}
                placeholder="(11) 98888-7777"
              />
            </div>
          </div>

          {/* Canais */}
          <div className="p-4 rounded-2xl shadow bg-white/5 border border-white/10 mb-4">
            <h2 className="font-semibold mb-3">Canais</h2>
            <div className="flex flex-wrap items-center gap-4">
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" checked={viaWhatsapp} onChange={(e) => setViaWhatsapp(e.target.checked)} />
                <span>WhatsApp</span>
              </label>
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" checked={viaEmail} onChange={(e) => setViaEmail(e.target.checked)} />
                <span>E-mail</span>
              </label>
            </div>
          </div>

          <button
            className="w-full sm:w-auto px-5 py-3 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white font-semibold disabled:opacity-60"
            onClick={onEnviar}
            disabled={loading}
          >
            {loading ? "Enviando..." : "Disparar Envio"}
          </button>

          {ok === true && <p className="mt-3 text-green-500">Envio disparado com sucesso ✅</p>}
          {ok === false && <p className="mt-3 text-red-500">Falha no envio: {erro}</p>}
          {erro && ok === null && <p className="mt-3 text-amber-400">{erro}</p>}
        </div>
      </div>

      <style>{`
        .input {
          background: rgba(99, 102, 241, 0.10);
          border: 1px solid rgba(99, 102, 241, 0.25);
          border-radius: 12px;
          padding: 10px 12px;
          outline: none;
          color: inherit;
        }
        .input:focus {
          border-color: rgba(99, 102, 241, 0.55);
          box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.25);
        }
        label { display:block; margin-bottom: 6px; opacity: .95 }
        .no-scrollbar::-webkit-scrollbar { display: none; }
        .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>
    </div>
  );
}
