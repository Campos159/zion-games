// src/services/autoenvio.ts
import {
  listarPedidos,
  listarItens,
  atualizarItem,
  type PedidoRead,
  type ItemRead,
  type Plataforma,
} from "./pedidos";
import { enviarItemEmail } from "./email";
import * as JogosSvc from "./jogos";

/* ===================== Config ===================== */
export type Variante = "PS4 Primária" | "PS4 Secundária" | "PS5 Primária" | "PS5 Secundária";
export type Midia = "PRIMARIA" | "SECUNDARIA";

const AUTO_DELAY_MS_DEFAULT = 5 * 60 * 1000; // 5 minutos
const EMAIL_TIMEOUT_MS = 15_000;
const LISTAR_ITENS_TIMEOUT_MS = 12_000;
const CONSUMO_TIMEOUT_MS = 10_000;
const JOB_WATCHDOG_MS = 30_000; // watchdog do job em processamento
const SCAN_INTERVAL_MS = 500; // frequência do tick do engine
const RESCAN_PEDIDOS_MS = 15_000;

const STORAGE_KEY = "zion.autoenvio.timers.v2";

const platToVariante: Record<Plataforma, Variante> = {
  PS4: "PS4 Primária",
  PS4s: "PS4 Secundária",
  PS5: "PS5 Primária",
  PS5s: "PS5 Secundária",
};
const midiaFromVariant = (v: Variante): Midia =>
  v.toLowerCase().includes("secundária") ? "SECUNDARIA" : "PRIMARIA";

const normalizeSku = (s: string) => (s || "").toUpperCase().replace(/\s+/g, "");

const senha2 = (raw: string) => {
  if (!raw) return "";
  const s = String(raw).trim();
  const parts = s
    .split(/[/|;]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length >= 2) return parts[1];
  const tokens = s.split(/\s+/).filter(Boolean);
  if (tokens.length >= 2) return tokens[tokens.length - 1];
  return s;
};

const withTimeout = <T,>(p: Promise<T>, ms: number, label = "Operação"): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} excedeu ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });

/* ===================== Tipos ===================== */
export type AutoEnvioStatus = "running" | "paused" | "processing" | "sent" | "cancelled";

export type AutoEnvioCallbacks = {
  onStatus?: (ev: { pedidoId: number; status: AutoEnvioStatus; remainingMs?: number }) => void;
  onToast?: (ev: { type: "success" | "error" | "info"; msg: string }) => void;
  onLog?: (line: string) => void;
};

type TimerState = {
  pedidoId: number;
  startedAt: number;
  targetAt: number;
  remainingMs: number;
  status: AutoEnvioStatus;
};

type CodigoResp = { codigo?: string | null };

type BootOptions = { delayMs?: number; uiTriggerOnly?: boolean };

declare global {
  interface Window {
    __ZION_AUTOENVIO_ENGINE__?: AutoEnvioEngine;
  }
}

/* ===================== Engine ===================== */
class AutoEnvioEngine {
  private static _instance: AutoEnvioEngine | null = null;
  static get instance(): AutoEnvioEngine {
    if (typeof window !== "undefined" && window.__ZION_AUTOENVIO_ENGINE__) {
      return window.__ZION_AUTOENVIO_ENGINE__!;
    }
    AutoEnvioEngine._instance ??= new AutoEnvioEngine();
    if (typeof window !== "undefined") window.__ZION_AUTOENVIO_ENGINE__ = AutoEnvioEngine._instance!;
    return AutoEnvioEngine._instance!;
  }

  private bc: BroadcastChannel | null = null;
  private isLeader = true;

  private delayMs = AUTO_DELAY_MS_DEFAULT;
  private uiTriggerOnly = false;
  private cb: AutoEnvioCallbacks = {};

  private timers: Record<number, TimerState> = {};
  private locks = new Set<number>();
  private jobQueue: number[] = [];
  private jobRunning = false;
  private watchdogs: Record<number, number> = {};

  private hb: number | null = null;
  private reScan: number | null = null;

  private pedidosCache: PedidoRead[] = [];

  /* ---------- Public API ---------- */
  configure(opts: { delayMs?: number; callbacks?: AutoEnvioCallbacks; uiTriggerOnly?: boolean }) {
    if (opts.delayMs != null && Number.isFinite(opts.delayMs)) {
      this.delayMs = Math.max(0, Number(opts.delayMs));
    }
    if (opts.callbacks) this.cb = opts.callbacks;
    if (typeof opts.uiTriggerOnly === "boolean") this.uiTriggerOnly = opts.uiTriggerOnly;
  }

  start() {
    this.loadFromStorage();

    if (!this.bc) {
      try {
        this.bc = new BroadcastChannel("zion-autoenvio");
        this.bc.onmessage = (ev) => this.onBC(ev.data);
        this.bc.postMessage({ t: "hello", at: Date.now() });
      } catch {
        this.bc = null;
      }
    }
    if (this.hb == null) {
      this.hb = window.setInterval(() => this.tick(), SCAN_INTERVAL_MS);
      this.log(":: autoenvio:heartbeat:start");
      this.tick();
    }
    if (this.reScan == null) {
      this.reScan = window.setInterval(() => this.refreshPedidos(), RESCAN_PEDIDOS_MS);
      void this.refreshPedidos();
    }
  }

  stop() {
    if (this.hb != null) {
      window.clearInterval(this.hb);
      this.hb = null;
    }
    if (this.reScan != null) {
      window.clearInterval(this.reScan);
      this.reScan = null;
    }
    this.log(":: autoenvio:heartbeat:stop");
  }

  subscribe(cb: AutoEnvioCallbacks) {
    this.cb = cb || {};
  }

  snapshot(): Record<number, TimerState> {
    const snap: Record<number, TimerState> = {};
    for (const [k, v] of Object.entries(this.timers)) snap[Number(k)] = { ...v };
    return snap;
  }

  /**
   * Agenda timers para pedidos ainda não enviados e pagos,
   * sempre a partir do MOMENTO EM QUE O FRONT VIU OS PEDIDOS.
   */
  seedTimersFromPedidos(pedidos: PedidoRead[]) {
    this.pedidosCache = pedidos.slice();
    const now = Date.now();
    let changed = false;

    for (const p of pedidos) {
      if (p.enviado) continue;
      if (!this.isPaid(p.status)) continue;

      // Agenda 5 minutos a partir de AGORA na primeira vez que o front vê o pedido
      if (!this.timers[p.id]) {
        const targetAt = now + this.delayMs;
        this.timers[p.id] = {
          pedidoId: p.id,
          startedAt: now,
          targetAt,
          remainingMs: this.delayMs,
          status: "running",
        };
        changed = true;
      }

      const t = this.timers[p.id];
      const remaining = t.status === "running" ? Math.max(0, t.targetAt - Date.now()) : t.remainingMs;
      this.emitStatus(p.id, t.status, remaining);
    }

    if (changed) this.saveToStorage();
  }

  enqueue(pedidoId: number) {
    if (!this.isLeader) {
      this.isLeader = true;
      this.log(":: autoenvio:role:auto-promote (enqueue)");
    }
    const t = this.timers[pedidoId];
    const now = Date.now();
    if (!this.jobQueue.includes(pedidoId)) this.jobQueue.push(pedidoId);
    this.timers[pedidoId] = {
      ...(t ?? {
        pedidoId,
        startedAt: now,
        targetAt: now,
        remainingMs: 0,
        status: "processing" as AutoEnvioStatus,
      }),
      status: "processing",
      remainingMs: 0,
      targetAt: now,
    };
    this.emitStatus(pedidoId, "processing", 0);
    this.saveToStorage();
    this.processQueue();
  }

  pause(pedidoId: number) {
    const t = this.timers[pedidoId];
    if (!t) return;
    const now = Date.now();
    const remaining = t.status === "running" ? Math.max(0, t.targetAt - now) : t.remainingMs;
    this.timers[pedidoId] = { ...t, status: "paused", remainingMs: remaining };
    this.jobQueue = this.jobQueue.filter((id) => id !== pedidoId);
    const w = this.watchdogs[pedidoId];
    if (w) {
      clearTimeout(w);
      delete this.watchdogs[pedidoId];
    }
    this.emitStatus(pedidoId, "paused", remaining);
    this.saveToStorage();
    this.broadcast({ t: "paused", id: pedidoId, remaining });
  }

  resume(pedidoId: number) {
    const t = this.timers[pedidoId];
    if (!t) return;
    const now = Date.now();
    const targetAt = now + Math.max(0, t.remainingMs);
    this.timers[pedidoId] = { ...t, status: "running", targetAt };
    this.emitStatus(pedidoId, "running", t.remainingMs);
    this.saveToStorage();
    this.broadcast({ t: "running", id: pedidoId, targetAt });
  }

  cancel(pedidoId: number) {
    const t = this.timers[pedidoId];
    if (t) {
      this.timers[pedidoId] = { ...t, status: "cancelled", remainingMs: 0 };
    } else {
      const now = Date.now();
      this.timers[pedidoId] = {
        pedidoId,
        startedAt: now,
        targetAt: now,
        remainingMs: 0,
        status: "cancelled",
      };
    }
    this.jobQueue = this.jobQueue.filter((id) => id !== pedidoId);
    const w = this.watchdogs[pedidoId];
    if (w) {
      clearTimeout(w);
      delete this.watchdogs[pedidoId];
    }
    this.emitStatus(pedidoId, "cancelled", 0);
    this.saveToStorage();
    this.broadcast({ t: "cancelled", id: pedidoId });
  }

  sendNow(pedidoId: number) {
    this.enqueue(pedidoId);
  }
  wake() {
    try {
      this.tick();
    } catch {}
    try {
      void this.refreshPedidos();
    } catch {}
  }

  /* ---------- Internals ---------- */
  private isPaid(status?: string | null) {
    return /pago|paid|aprov/i.test(String(status || ""));
  }

  private loadFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const obj = JSON.parse(raw) as Record<number, TimerState>;
      if (obj && typeof obj === "object") this.timers = obj;
    } catch {}
  }
  private saveToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.timers));
    } catch {}
  }

  private broadcast(payload: any) {
    try {
      this.bc?.postMessage(payload);
    } catch {}
  }

  private onBC(msg: unknown) {
    if (!msg || typeof msg !== "object") return;
    const data = msg as any;
    if (data.t === "hello") {
      this.bc?.postMessage({ t: "i-am-leader", at: Date.now() });
    } else if (data.t === "i-am-leader") {
      if (this.isLeader) {
        this.isLeader = false;
        this.log(":: autoenvio:role:follower");
      }
    } else if (data.t === "promote-leader") {
      this.isLeader = true;
      this.log(":: autoenvio:role:leader");
    } else if (data.t === "paused") {
      const id = data.id as number;
      const t = this.timers[id];
      if (!t) return;
      this.timers[id] = {
        ...t,
        status: "paused",
        remainingMs: data.remaining ?? t.remainingMs,
      };
      this.emitStatus(id, "paused", this.timers[id].remainingMs);
      this.saveToStorage();
    } else if (data.t === "running") {
      const id = data.id as number;
      const t = this.timers[id];
      if (!t) return;
      this.timers[id] = {
        ...t,
        status: "running",
        targetAt: data.targetAt ?? t.targetAt,
      };
      this.emitStatus(
        id,
        "running",
        Math.max(0, this.timers[id].targetAt - Date.now())
      );
      this.saveToStorage();
    } else if (data.t === "cancelled") {
      const id = data.id as number;
      const t = this.timers[id];
      if (t) {
        this.timers[id] = { ...t, status: "cancelled", remainingMs: 0 };
        this.emitStatus(id, "cancelled", 0);
        this.saveToStorage();
      }
    }
  }

  private log(...args: any[]) {
    const line = [new Date().toISOString(), ...args].join(" ");
    try {
      console.log(line);
    } catch {}
    try {
      this.cb?.onLog?.(line);
    } catch {}
  }

  private toast(type: "success" | "error" | "info", msg: string) {
    try {
      this.cb?.onToast?.({ type, msg });
    } catch {}
  }

  private emitStatus(pedidoId: number, status: AutoEnvioStatus, remainingMs?: number) {
    try {
      this.cb?.onStatus?.({ pedidoId, status, remainingMs });
    } catch {}
  }

  /**
   * Recarrega pedidos do backend e cria timers
   * SEMPRE a partir do momento em que este front tomou conhecimento deles.
   */
  private async refreshPedidos() {
    try {
      const data = await listarPedidos({} as any);
      this.pedidosCache = data.slice();
      const now = Date.now();
      let changed = false;

      for (const p of data) {
        if (p.enviado) continue;
        if (!this.isPaid(p.status)) continue;

        // Se o front ainda não tinha timer, cria com 5min a partir de AGORA
        if (!this.timers[p.id]) {
          const targetAt = now + this.delayMs;
          this.timers[p.id] = {
            pedidoId: p.id,
            startedAt: now,
            targetAt,
            remainingMs: this.delayMs,
            status: "running",
          };
          changed = true;
        }
      }

      if (changed) this.saveToStorage();
      this.log(
        ":: autoenvio:pedidos:refresh",
        JSON.stringify(
          data.map((d) => ({ id: d.id, st: d.status, env: d.enviado }))
        )
      );
    } catch (e: any) {
      this.log(
        ":: autoenvio:pedidos:refresh:error",
        String(e?.message || e)
      );
    }
  }

  private tick() {
    if (!this.isLeader) return;
    const now = Date.now();
    const toEnqueue: number[] = [];

    for (const [idStr, t] of Object.entries(this.timers)) {
      const id = Number(idStr);
      if (t.status === "running") {
        const remaining = Math.max(0, t.targetAt - now);
        this.emitStatus(id, "running", remaining);

        if (remaining <= 0) {
          this.timers[id] = {
            ...t,
            status: "processing",
            remainingMs: 0,
            targetAt: now,
          };
          this.emitStatus(id, "processing", 0);
          toEnqueue.push(id);

          // UI trigger redundante (para manter sincronia visual)
          try {
            window.dispatchEvent(
              new CustomEvent("zion:autoenvio:disparar", {
                detail: { pedidoId: id },
              })
            );
            this.log(":: autoenvio:ui-trigger (redundante)", id);
          } catch {}
        } else {
          this.timers[id] = { ...t, remainingMs: remaining };
        }
      }
    }

    if (toEnqueue.length) {
      for (const id of toEnqueue) {
        if (!this.jobQueue.includes(id)) this.jobQueue.push(id);
        this.log(":: autoenvio:enqueue (timer zero)", id);
      }
      this.saveToStorage();
      this.processQueue();
    }
  }

  private async processQueue() {
    if (!this.isLeader && this.jobQueue.length > 0) {
      this.isLeader = true;
      this.log(":: autoenvio:role:auto-promote (work pending)");
    }
    if (!this.isLeader) return;
    if (this.jobRunning) return;

    this.jobRunning = true;
    try {
      while (this.jobQueue.length > 0) {
        const id = this.jobQueue.shift()!;
        const tNow = this.timers[id];
        if (!tNow || tNow.status !== "processing") {
          this.log(":: autoenvio:skip-status", id, tNow?.status);
          continue;
        }
        if (this.locks.has(id)) {
          this.log(":: autoenvio:skip-locked", id);
          continue;
        }
        this.locks.add(id);

        if (this.watchdogs[id]) {
          clearTimeout(this.watchdogs[id]);
        }
        this.watchdogs[id] = window.setTimeout(() => {
          const t = this.timers[id];
          if (t && t.status === "processing") {
            this.timers[id] = {
              ...t,
              status: "paused",
              remainingMs: 0,
            };
            this.emitStatus(id, "paused", 0);
            this.toast(
              "error",
              `Auto-envio não concluiu (#${id}). Pausado para revisão.`
            );
            this.locks.delete(id);
            this.saveToStorage();
            this.log(":: autoenvio:watchdog:pause", id);
          }
        }, JOB_WATCHDOG_MS);

        try {
          await this.dispatchById(id);
          delete this.timers[id];
          this.emitStatus(id, "sent", 0);
          this.toast("success", `Pedido #${id} enviado automaticamente ✅`);
          this.saveToStorage();
        } catch (e: any) {
          this.toast(
            "error",
            `Falha no auto-envio (#${id}): ${e?.message || "erro"}`
          );
          this.log(
            ":: autoenvio:dispatch:error",
            id,
            String(e?.message || e)
          );
          const t = this.timers[id];
          if (t) {
            this.timers[id] = {
              ...t,
              status: "paused",
              remainingMs: 0,
            };
            this.emitStatus(id, "paused", 0);
            this.saveToStorage();
          }
        } finally {
          const w = this.watchdogs[id];
          if (w) {
            clearTimeout(w);
            delete this.watchdogs[id];
          }
          this.locks.delete(id);
        }
      }
    } finally {
      this.jobRunning = false;
    }
  }

  private findPedido(id: number): PedidoRead | null {
    return this.pedidosCache.find((p) => p.id === id) || null;
  }

  private async dispatchById(pedidoId: number) {
    this.log(":: autoenvio:dispatch:start", pedidoId);
    let p = this.findPedido(pedidoId);
    if (!p) {
      const fresh = await listarPedidos({} as any);
      this.pedidosCache = fresh.slice();
      p = this.findPedido(pedidoId);
    }
    if (!p) throw new Error("Pedido não encontrado.");
    if (p.enviado) {
      return;
    }
    if (!this.isPaid(p.status)) throw new Error("Pedido não está pago/aprovado.");

    const itens: ItemRead[] = await withTimeout(
      listarItens(p.id),
      LISTAR_ITENS_TIMEOUT_MS,
      "Carregar itens"
    );
    if (!itens.length) throw new Error("Pedido sem itens.");
    if (itens.some((i) => !i.id)) throw new Error("Item sem id.");

    for (let i = 0; i < itens.length; i++) {
      const it = itens[i];

      const variante = platToVariante[it.plataforma as Plataforma] || "PS5 Primária";
      const midiaTimer = midiaFromVariant(variante);

      const skuRaw = String(it.sku || "");
      const sku = normalizeSku(skuRaw);

      // Evitar TS incompatibilidades: tipar como any
      let jogoInfo: any = null;
      try {
        if ((JogosSvc as any).buscarJogoPorSku)
          jogoInfo = await (JogosSvc as any).buscarJogoPorSku(sku);
      } catch {}

      const midia: Midia =
        jogoInfo && jogoInfo.tipo_midia
          ? (jogoInfo.tipo_midia as Midia)
          : midiaTimer;

      // 1) do backend do item
      let login = String(it.email_conta || "").trim();
      let senha = String(it.senha_conta || "").trim();
      let codigo = String(it.codigo_ativacao || "").trim();
      let contaId: string | undefined;

      // 2) da mesma CONTA por SKU+Mídia
      try {
        if ((JogosSvc as any).obterCredenciaisParaEnvioPorSkuEMidia) {
          const creds =
            await (JogosSvc as any).obterCredenciaisParaEnvioPorSkuEMidia(
              sku,
              midia
            );
          if (creds) {
            if (!login) login = String(creds.login || "").trim();
            if (!senha) senha = String(creds.senha || "").trim();
            if (!codigo) codigo = String(creds.codigo || "").trim();
            if (!contaId && creds.contaId) contaId = String(creds.contaId);
          }
        }
      } catch {}

      // 3) fallback com jogoInfo (login/senha/código_preview)
      if ((!login || !senha || !codigo) && jogoInfo) {
        if (!login) login = String(jogoInfo.login || "").trim();
        if (!senha) senha = String(jogoInfo.senha || "").trim();
        if (!codigo) codigo = String(jogoInfo.codigo_preview || "").trim();
      }

      // 4) ainda faltando código? preview por SKU+Mídia
      if (!codigo && (JogosSvc as any).previewCodigoPorSkuEMidia) {
        try {
          const prev = await (JogosSvc as any).previewCodigoPorSkuEMidia(
            sku,
            midia
          );
          if (prev && prev.codigo) codigo = String(prev.codigo).trim();
        } catch {}
      }

      const faltando: string[] = [];
      if (!login) faltando.push("login");
      if (!senha) faltando.push("senha");
      if (!codigo) faltando.push("código");
      if (faltando.length) {
        throw new Error(
          `Credenciais incompletas para o item ${i + 1} (SKU ${sku}). Faltando: ${faltando.join(
            ", "
          )}.`
        );
      }

      const payload = {
        item_id: it.id!,
        destinatario: (p.cliente_email || "").trim(),
        cliente_nome: (p.cliente_nome || "").trim(),
        pedido_codigo: String(p.codigo || p.id),
        jogo: String(it.nome_produto || ""),
        login,
        senha: senha2(senha),
        codigo,
      };

      await withTimeout(
        enviarItemEmail(payload),
        EMAIL_TIMEOUT_MS,
        "Envio de e-mail"
      );
      this.toast(
        "success",
        `E-mail do item #${i + 1} enviado para ${payload.destinatario}`
      );

      // Consumo do código (preferindo MESMA CONTA)
      try {
        if (contaId && (JogosSvc as any).consumirCodigoDaMesmaConta) {
          const consumo = await withTimeout(
            (JogosSvc as any).consumirCodigoDaMesmaConta(sku, midia, contaId),
            CONSUMO_TIMEOUT_MS,
            "Consumo de código"
          );
          const code = (consumo as CodigoResp)?.codigo || "";
          if (code)
            this.toast("info", `Código consumido para ${sku}: ${code}`);
          else
            this.toast(
              "error",
              `Nenhum código disponível para consumo em ${sku}`
            );
        } else if ((JogosSvc as any).consumirCodigoPorSkuEMidia) {
          await withTimeout(
            (JogosSvc as any).consumirCodigoPorSkuEMidia(sku, midia),
            CONSUMO_TIMEOUT_MS,
            "Consumo de código"
          );
        }
      } catch (e: any) {
        this.toast(
          "error",
          "Falha ao consumir o código após o envio."
        );
        this.log(
          ":: autoenvio:consumo:error",
          pedidoId,
          String(e?.message || e)
        );
      }

      try {
        if ((JogosSvc as any).registrarVendaPorSku)
          await (JogosSvc as any).registrarVendaPorSku(sku, midia);
      } catch (e: any) {
        this.log(
          ":: autoenvio:registrarVenda:error",
          sku,
          String(e?.message || e)
        );
      }

      // ===== NOVO: vincular pedido+SKU à conta usada e salvar credenciais no backend =====
      try {
        if (contaId && (JogosSvc as any).vincularPedidoSkuAConta) {
          (JogosSvc as any).vincularPedidoSkuAConta(p.id, sku, contaId);
        }

        await atualizarItem(it.id, {
          email_conta: login || null,
          senha_conta: senha || null,
          nick_conta: it.nick_conta ?? null,
          codigo_ativacao: codigo || null,
          enviado: true,
        });
      } catch (e: any) {
        this.log(
          ":: autoenvio:atualizarItem:error",
          it.id,
          String(e?.message || e)
        );
      }
      // ===== FIM ALTERAÇÕES =====
    }
  }
}

/* ===================== Singleton + Facade ===================== */

export function getAutoEnvio() {
  return AutoEnvioEngine.instance;
}

export function bootAutoEnvioInBackground(options?: BootOptions) {
  const engine = getAutoEnvio();
  engine.configure({
    delayMs: options?.delayMs ?? AUTO_DELAY_MS_DEFAULT,
    uiTriggerOnly: options?.uiTriggerOnly ?? false,
    callbacks: {},
  });
  engine.start();
  try {
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) engine.wake();
    });
    window.addEventListener("focus", () => engine.wake());
  } catch {}
}

export function autoenvioSubscribe(cb: AutoEnvioCallbacks) {
  getAutoEnvio().subscribe(cb);
}
export function autoenvioSnapshot() {
  return getAutoEnvio().snapshot();
}
export function autoenvioPause(pedidoId: number) {
  return getAutoEnvio().pause(pedidoId);
}
export function autoenvioResume(pedidoId: number) {
  return getAutoEnvio().resume(pedidoId);
}
export function autoenvioCancel(pedidoId: number) {
  return getAutoEnvio().cancel(pedidoId);
}
export function autoenvioSendNow(pedidoId: number) {
  return getAutoEnvio().sendNow(pedidoId);
}
// Compat: permite importar seedTimersFromPedidos diretamente do módulo
export function seedTimersFromPedidos(pedidos: PedidoRead[]) {
  return getAutoEnvio().seedTimersFromPedidos(pedidos);
}
