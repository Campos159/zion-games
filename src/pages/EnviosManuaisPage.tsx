// src/pages/EnviosManuaisPage.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { iniciarEnvio, type FulfillmentPayload } from "../services/fulfillment";

// IMPORT ROBUSTO DO SERVICE DE JOGOS (com fallback em runtime)
import * as JogosSvc from "../services/jogos";

// Pedidos
import {
  listarPedidos,
  listarItens,
  type PedidoRead,
  type ItemRead,
  type Plataforma,
} from "../services/pedidos";

/* ================== Tipos e helpers ================== */
type Variante = "PS4 Primária" | "PS4 Secundária" | "PS5 Primária" | "PS5 Secundária";
const variantes: Variante[] = ["PS4 Primária", "PS4 Secundária", "PS5 Primária", "PS5 Secundária"];

type Midia = "PRIMARIA" | "SECUNDARIA";
function midiaFromVariant(v: Variante): Midia {
  return v.toLowerCase().includes("secundária") ? "SECUNDARIA" : "PRIMARIA";
}

type SkuStatus = "idle" | "loading" | "success" | "notfound" | "error";

type ItemForm = {
  sku: string;
  qty: number;
  name: string;
  variant: Variante;          // variação por item (botões)
  variant_name: string;       // ex.: PlayStation 4 / 5
  login: string;
  senhaRaw: string;           // "s1/s2" -> enviamos sempre a 2ª
  codigo: string;             // preview antes; definitivo após consumo
};

// Tipos do service de jogos (do namespace)
type JogoPorSku = JogosSvc.JogoPorSku;

type Draft = {
  orderId: string;
  items: ItemForm[];
  nomeCliente: string;
  email: string;
  phone: string; // armazenado já “mascarado”
  viaWhatsapp: boolean;
  viaEmail: boolean;
  autocompletarPorSku: boolean;
};

const DRAFT_KEY = "zion.enviosManuais.draft";

function defaultVariantName(v: Variante): string {
  return v.includes("PS5") ? "PlayStation 5" : "PlayStation 4";
}

/** Sempre retorna a 2ª senha: se "a/b" -> "b". Se só tem uma, retorna a própria. */
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

/* ========== Telefone ========== */
function onlyDigits(v: string) { return (v || "").replace(/\D+/g, ""); }

/**
 * Máscara BR local: (DD) XXXX-XXXX ou (DD) 9XXXX-XXXX
 * - Entrada: qualquer coisa; mantém só dígitos (até 11)
 * - Saída: SEM +55 (apenas (ddd) número), como você pediu
 */
function maskPhoneStrict(v: string) {
  const d = onlyDigits(v).slice(0, 11); // Brasil: até 11 dígitos (com 9)
  if (!d) return "";

  const dd = d.slice(0, 2);
  const rest = d.slice(2);

  // Montagem progressiva para ficar agradável durante a digitação
  if (d.length <= 2) return `(${dd}`;
  // 10 dígitos (fixo): (DD) XXXX-XXXX
  if (d.length <= 10) {
    if (rest.length <= 4) return `(${dd}) ${rest}`;
    return `(${dd}) ${rest.slice(0, 4)}-${rest.slice(4)}`;
  }
  // 11 dígitos (móvel): (DD) 9XXXX-XXXX
  // primeira parte 5 dígitos (inclui o 9), segunda parte 4 dígitos
  const parteA = rest.slice(0, 5);
  const parteB = rest.slice(5, 9); // se ainda digitando, pode ter < 4
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

/* ================== Toasts (avisos canto superior direito) ================== */
type ToastType = "success" | "error" | "info";
type Toast = { id: string; type: ToastType; msg: string };
const TOAST_TTL = 3500;

function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

/* ================== Mapeamentos plataforma <-> variante ================== */
const platToVariante: Record<Plataforma, Variante> = {
  PS4: "PS4 Primária",
  PS4s: "PS4 Secundária",
  PS5: "PS5 Primária",
  PS5s: "PS5 Secundária",
};

/* ================== Página ================== */
export default function EnviosManuaisPage() {
  const [loading, setLoading] = useState(false);
  const [ok, setOk] = useState<null | boolean>(null);
  const [erro, setErro] = useState<string | null>(null);

  // TOASTS
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
    { sku: "", qty: 1, name: "", variant: "PS5 Primária", variant_name: "PlayStation 5", login: "", senhaRaw: "", codigo: "" },
  ]);
  const [nomeCliente, setNomeCliente] = useState("");
  const [email, setEmail] = useState("");
  const [phoneMask, setPhoneMask] = useState("");

  const [viaWhatsapp, setViaWhatsapp] = useState(true);
  const [viaEmail, setViaEmail] = useState(true);
  const [autocompletarPorSku, setAutocompletarPorSku] = useState(true);

  // status/controle por item
  const [skuStatus, setSkuStatus] = useState<Record<number, SkuStatus>>({});
  const [skuErrorMsg, setSkuErrorMsg] = useState<Record<number, string>>({});
  const [skuDetected, setSkuDetected] = useState<Record<number, JogoPorSku | null>>({});
  const debounceTimers = useRef<Record<number, number>>({});
  const lastSearchedSku = useRef<Record<number, string>>({}); // evita buscas duplicadas

  /* ---------- RASCUNHO: carregar ---------- */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const d = JSON.parse(raw) as Draft;
      setOrderId(d.orderId || "");
      setItems(
        (d.items && d.items.length
          ? d.items
          : [{ sku: "", qty: 1, name: "", variant: "PS5 Primária", variant_name: "PlayStation 5", login: "", senhaRaw: "", codigo: "" }]
        ).map((it) => ({
          sku: (it.sku || "").toUpperCase(),
          qty: Number(it.qty || 1),
          name: it.name || "",
          variant: (it.variant as Variante) || "PS5 Primária",
          variant_name: it.variant_name || defaultVariantName((it.variant as Variante) || "PS5 Primária"),
          login: it.login || "",
          senhaRaw: it.senhaRaw || "",
          codigo: it.codigo || "",
        }))
      );
      setNomeCliente(d.nomeCliente || "");
      setEmail(d.email || "");
      setPhoneMask(d.phone || "");
      setViaWhatsapp(Boolean(d.viaWhatsapp));
      setViaEmail(Boolean(d.viaEmail));
      setAutocompletarPorSku(d.autocompletarPorSku ?? true);
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
    setItems([{ sku: "", qty: 1, name: "", variant: "PS5 Primária", variant_name: "PlayStation 5", login: "", senhaRaw: "", codigo: "" }]);
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
      { sku: "", qty: 1, name: "", variant: "PS5 Primária", variant_name: "PlayStation 5", login: "", senhaRaw: "", codigo: "" },
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

  // Quando troca a variação manualmente, já atualiza o preview correto para a nova mídia
  async function onChooseVariant(ix: number, v: Variante) {
    updateItem(ix, {
      variant: v,
      variant_name: items[ix].variant_name?.trim() ? items[ix].variant_name : defaultVariantName(v),
    });

    // Rebusa o preview por SKU + nova mídia (se SKU estiver preenchido)
    const sku = items[ix].sku.trim().toUpperCase();
    if (autocompletarPorSku && sku) {
      try {
        const midia = midiaFromVariant(v);
        // Fallback seguro: se a função não existir, tenta buscar jogo e usar codigo_preview
        let codigoPreview = "";
        if (typeof JogosSvc.previewCodigoPorSkuEMidia === "function") {
          const prev = await JogosSvc.previewCodigoPorSkuEMidia(sku, midia);
          codigoPreview = prev?.codigo || "";
        } else {
          const j = await JogosSvc.buscarJogoPorSku(sku);
          codigoPreview = j?.codigo_preview || "";
        }
        if (codigoPreview) updateItem(ix, { codigo: codigoPreview });
      } catch {
        // silencioso; preview é só conveniência
      }
    }
  }

  /* ---------- Busca SKU (sem botão) ---------- */
  async function fetchSku(ix: number, force = false) {
    const raw = items[ix]?.sku ?? "";
    const sku = raw.trim().toUpperCase().replace(/\s+/g, "");
    if (!autocompletarPorSku || !sku) {
      setSkuStatus((s) => ({ ...s, [ix]: "idle" }));
      setSkuDetected((s) => ({ ...s, [ix]: null }));
      return;
    }
    if (!force && lastSearchedSku.current[ix] === sku) return; // evita repetição
    lastSearchedSku.current[ix] = sku;

    setSkuStatus((s) => ({ ...s, [ix]: "loading" }));
    setSkuErrorMsg((s) => ({ ...s, [ix]: "" }));
    try {
      const jogo = await JogosSvc.buscarJogoPorSku(sku);
      if (!jogo) {
        setSkuStatus((s) => ({ ...s, [ix]: "notfound" }));
        setSkuDetected((s) => ({ ...s, [ix]: null }));
        showToast("info", `SKU não encontrado: ${sku}`);
        return;
      }

      const sug: Variante =
        jogo.console === "PS4"
          ? (jogo.tipo_midia.toLowerCase().startsWith("sec") ? "PS4 Secundária" : "PS4 Primária")
          : (jogo.tipo_midia.toLowerCase().startsWith("sec") ? "PS5 Secundária" : "PS5 Primária");

      // aplica variação sugerida e credenciais
      updateItem(ix, {
        variant: sug,
        variant_name: defaultVariantName(sug),
        name: jogo.nome_jogo || items[ix].name,
        login: jogo.login || items[ix].login,
        senhaRaw: jogo.senha ? senha2(jogo.senha) : items[ix].senhaRaw,
      });

      // PREVIEW por SKU + MÍDIA com fallback
      try {
        const midia = midiaFromVariant(sug);
        let codigoPreview = "";
        if (typeof JogosSvc.previewCodigoPorSkuEMidia === "function") {
          const prev = await JogosSvc.previewCodigoPorSkuEMidia(sku, midia);
          codigoPreview = prev?.codigo || "";
        } else {
          codigoPreview = jogo.codigo_preview || "";
        }
        updateItem(ix, {
          // só sobrescreve se vazio (se usuário digitou, não troca)
          codigo: items[ix].codigo?.trim() ? items[ix].codigo : codigoPreview,
        });
      } catch {
        if (!items[ix].codigo?.trim() && jogo.codigo_preview) {
          updateItem(ix, { codigo: jogo.codigo_preview });
        }
      }

      setSkuDetected((s) => ({ ...s, [ix]: jogo }));
      setSkuStatus((s) => ({ ...s, [ix]: "success" }));
      showToast("success", `SKU carregado: ${sku}`);
    } catch (e: any) {
      console.error("Erro SKU", e);
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
    e.preventDefault(); // evita duplicar
    const cleaned = pasted.toUpperCase();
    updateItem(ix, { sku: cleaned });
    const existing = debounceTimers.current[ix];
    if (existing) window.clearTimeout(existing);
    debounceTimers.current[ix] = window.setTimeout(() => fetchSku(ix, true), 100);
  }

  /* Busca também no onBlur para garantir */
  function onBlurSku(ix: number) {
    const t = debounceTimers.current[ix];
    if (t) window.clearTimeout(t);
    fetchSku(ix, true);
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
    return null;
  }

  /* ---------- Enviar ---------- */
  async function onEnviar() {
    setLoading(true);
    setOk(null);
    setErro(null);
    try {
      const err = validar();
      if (err) throw new Error(err);

      const payload: FulfillmentPayload = {
        triggered_by: "admin_zion",
        order: {
          order_id: orderId.trim(),
          sale_channel: "site",
          items: items.map((it) => ({
            sku: it.sku.trim(),
            qty: it.qty,
            name: it.name.trim(),
            variant_name: it.variant_name.trim(),
            credentials: {
              login: it.login.trim(),
              senha: senha2(it.senhaRaw),
              // enviamos o que está no campo (preview/manual);
              // o consumo real virá APÓS o envio OK.
              codigo: it.codigo.trim(),
              variant: it.variant, // mantemos para auditoria
            },
          })),
          customer: {
            name: nomeCliente.trim(),
            email: email.trim(),
            // >>> Mantemos E.164 correto para o backend: prefixo +55 automático
            phone_e164: `+55${onlyDigits(phoneMask)}`,
            // compat legado (n8n)
            login: items[0]?.login?.trim() || "",
            senha: senha2(items[0]?.senhaRaw || ""),
            codigo: items[0]?.codigo?.trim() || "",
            nome_jogo: items[0]?.name?.trim() || "",
          },
        },
        options: {
          send_via: [
            ...(viaWhatsapp ? (["whatsapp"] as const) : []),
            ...(viaEmail ? (["email"] as const) : []),
          ],
          deadline_minutes: 15,
        },
        metadata: {
          ui_note: "Envio manual pelo painel",
          source: "zion-admin",
          credentials_by_item: items.map((it) => ({
            sku: it.sku,
            login: it.login.trim(),
            senha: senha2(it.senhaRaw),
            codigo: it.codigo.trim(),
            variant: it.variant,
            name: it.name.trim(),
          })),
        },
      };

      const res = await iniciarEnvio(payload);
      setOk(res?.ok ?? false);

      if (!res?.ok) {
        showToast("error", "Falha ao disparar o envio. Nenhum código foi consumido.");
        setErro("Falha ao disparar o envio.");
        return;
      }

      showToast("success", "Envio disparado com sucesso. Consumindo códigos…");

      // Após envio OK: consumir 1 código por item (SKU + MÍDIA) com fallback
      for (let i = 0; i < items.length; i++) {
        try {
          const skuBase = items[i].sku.trim().toUpperCase();
          const midia = midiaFromVariant(items[i].variant);

          // normalizamos null -> undefined para satisfazer o TS
          let consumo: { codigo?: string } | undefined;

          if (typeof JogosSvc.consumirCodigoPorSkuEMidia === "function") {
            const r = await JogosSvc.consumirCodigoPorSkuEMidia(skuBase, midia);
            consumo = r ?? undefined;
          } else if (typeof JogosSvc.consumirCodigoPorSku === "function") {
            const r = await JogosSvc.consumirCodigoPorSku(skuBase);
            consumo = r ?? undefined;
          } else {
            throw new Error("Serviço de consumo de código não disponível.");
          }

          if (!consumo?.codigo) throw new Error("Sem código disponível para este SKU.");
          updateItem(i, { codigo: consumo.codigo }); // atualiza com o código efetivamente consumido (e removido)
          showToast("success", `Código consumido (${skuBase}/${midia}): ${consumo.codigo}`);
        } catch (e: any) {
          showToast("error", `Falha ao consumir código do item #${i + 1}: ${e?.message || "erro"}`);
        }
      }
    } catch (e: any) {
      console.error("Disparar Envio:", e);
      const msg = e?.message || "Erro inesperado";
      setErro(msg);
      setOk(false);
      showToast("error", msg);
    } finally {
      setLoading(false);
    }
  }

  function preencherExemplo() {
    setOrderId("MANUAL-" + Math.floor(Math.random() * 99999));
    setItems([
      { sku: "EAFC25-PS5-PRI", qty: 1, name: "", variant: "PS5 Primária", variant_name: "PlayStation 5", login: "", senhaRaw: "", codigo: "" },
      { sku: "GOW-PS4-SEC", qty: 1, name: "", variant: "PS4 Secundária", variant_name: "PlayStation 4", login: "", senhaRaw: "", codigo: "" },
    ]);
    setNomeCliente("Fulano de Tal");
    setEmail("fulano@exemplo.com");
    // >>> Agora o exemplo já vem no novo formato local (sem +55)
    setPhoneMask("(11) 98888-7777");
    setViaWhatsapp(true);
    setViaEmail(true);
    setOk(null);
    setErro(null);
    setSkuStatus({});
    setSkuDetected({});
    setSkuErrorMsg({});
    showToast("info", "Exemplo preenchido. Cole um SKU válido para autocompletar.");
  }

  /* --- Ao montar / quando items mudam, tenta buscar SKUs pré-preenchidos --- */
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
  }, [/* apenas quando quantidade de itens muda */ items.length]);

  /* ================== LISTA DE PEDIDOS (para preencher a tela) ================== */
  const [carregaPedidos, setCarregaPedidos] = useState(true);
  const [pedidos, setPedidos] = useState<PedidoRead[]>([]);
  const [busca, setBusca] = useState("");

  useEffect(() => {
    (async () => {
      try {
        setCarregaPedidos(true);
        const data = await listarPedidos();
        setPedidos(data);
      } finally {
        setCarregaPedidos(false);
      }
    })();
  }, []);

  const pedidosOrdenados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    let base = pedidos.filter((p) => !p.enviado); // foco: em separação
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
        const diff = ts(a.data_criacao) - ts(b.data_criacao); // MAIS ANTIGOS PRIMEIRO
        if (diff !== 0) return diff;
        return (a.id ?? 0) - (b.id ?? 0);
      });
  }, [pedidos, busca]);

  async function carregarPedidoNaTela(p: PedidoRead) {
    try {
      setLoading(true);
      setOk(null);
      setErro(null);

      // Carrega itens do pedido
      const rows: ItemRead[] = await listarItens(p.id);

      // Converte itens do backend para os campos da tela
      const mapped: ItemForm[] = rows.map((r) => {
        const variante = platToVariante[r.plataforma as Plataforma] || "PS5 Primária";
        return {
          sku: (r.sku || "").toUpperCase(),
          qty: Number(r.quantidade || 1),
          name: r.nome_produto || "",
          variant: variante,
          variant_name: defaultVariantName(variante),
          login: r.email_conta || "",           // se você usa email_conta como login
          senhaRaw: r.senha_conta || "",        // mantemos raw; enviaremos a 2ª
          codigo: r.codigo_ativacao || "",      // se já existir
        };
      });

      setOrderId(String(p.codigo || p.id));
      setItems(mapped.length ? mapped : [
        { sku: "", qty: 1, name: "", variant: "PS5 Primária", variant_name: "PlayStation 5", login: "", senhaRaw: "", codigo: "" },
      ]);
      setNomeCliente(p.cliente_nome || "");
      setEmail(p.cliente_email || "");
      setPhoneMask(maskPhoneStrict(p.telefone || ""));
      showToast("info", `Pedido #${p.id} carregado no formulário.`);
    } catch (e: any) {
      showToast("error", `Falha ao carregar itens do pedido: ${e?.message || "erro"}`);
    } finally {
      setLoading(false);
    }
  }

  /* ================== UI ================== */
  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* TOASTS */}
      <div className="fixed top-4 right-4 z-50 space-y-2">
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

      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Envios Manuais</h1>
        <div className="flex items-center gap-3">
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={autocompletarPorSku}
              onChange={(e) => setAutocompletarPorSku(e.target.checked)}
            />
            Autocompletar por SKU
          </label>
          <button
            className="px-3 py-2 rounded-2xl bg-slate-600 hover:bg-slate-700 text-white"
            onClick={preencherExemplo}
            type="button"
          >
            Preencher Exemplo
          </button>
          <button
            className="px-3 py-2 rounded-2xl bg-rose-600 hover:bg-rose-700 text-white"
            onClick={limparRascunho}
            type="button"
            title="Limpar rascunho local"
          >
            Limpar
          </button>
        </div>
      </div>

      {/* LAYOUT: coluna de pedidos (esquerda) + formulário (direita) */}
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

            <div className="space-y-2 max-h-[540px] overflow-auto pr-1">
              {pedidosOrdenados.map((p) => (
                <button
                  key={p.id}
                  onClick={() => carregarPedidoNaTela(p)}
                  className="w-full text-left p-3 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition"
                  title="Carregar este pedido no formulário de envio"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-semibold text-sm">{p.cliente_nome}</div>
                    <span className="text-[10px] uppercase tracking-wide bg-amber-100 text-amber-800 border border-amber-200 rounded-full px-2 py-0.5">
                      {p.status}
                    </span>
                  </div>
                  <div className="text-xs opacity-90">
                    <b>Data:</b> {p.data_criacao} • <b>Cód:</b> {p.codigo || p.id}
                  </div>
                  <div className="text-xs opacity-80 truncate">{p.cliente_email}</div>
                  <div className="text-xs opacity-60">{p.telefone || "—"}</div>
                </button>
              ))}
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
            <div className="p-4 rounded-2xl shadow bg-white/5 border border-white/10">
              <h2 className="font-semibold mb-3">Pedido</h2>

              <label className="text-sm">Order ID</label>
              <input className="w-full input" value={orderId} onChange={(e) => setOrderId(e.target.value)} />

              <div className="mt-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold">Itens</h3>
                  <button
                    type="button"
                    className="px-3 py-1 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white"
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
                        <div className="inline-flex rounded-2xl overflow-hidden border border-white/15 bg-white/5">
                          {variantes.map((v) => (
                            <button
                              type="button"
                              key={v}
                              className={clsx(
                                "px-2.5 py-1.5 text-xs",
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
                          <input
                            className="w-full input"
                            value={it.login}
                            onChange={(e) => updateItem(ix, { login: e.target.value })}
                          />
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
                            * O código só é <b>consumido</b> (removido da tabela) após o envio ser confirmado como <b>OK</b>.
                          </div>
                        </div>
                      )}

                      {items.length > 1 && (
                        <div className="mt-3 text-right">
                          <button
                            type="button"
                            className="px-3 py-1 rounded-xl bg-rose-600 hover:bg-rose-700 text-white"
                            onClick={() => removeItem(ix)}
                          >
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
            <label className="inline-flex items-center gap-2 mr-6">
              <input type="checkbox" checked={viaWhatsapp} onChange={(e) => setViaWhatsapp(e.target.checked)} />
              <span>WhatsApp</span>
            </label>
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={viaEmail} onChange={(e) => setViaEmail(e.target.checked)} />
              <span>E-mail</span>
            </label>
          </div>

          <button
            className="px-5 py-3 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white font-semibold disabled:opacity-60"
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

      {/* estilo mínimo para inputs (com “corzinha”) */}
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
      `}</style>
    </div>
  );
}
