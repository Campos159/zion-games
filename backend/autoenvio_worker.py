# backend/autoenvio_worker.py
# Autoenvio definitivo:
# - Varre pedidos pagos e não enviados
# - Espera 5 minutos após o pedido cair (timer em memória)
# - Ao zerar o timer, para cada item não enviado:
#   (1) Recarrega o item do BD
#   (2) Se faltar credenciais, tenta resolver via hook local resolver_credenciais_item(sku, plataforma)
#       e grava no BD (sem depender de schemas Update)
#   (3) Envia e-mail (função local enviarItemEmail; fallback HTTP /emails/send-item)
#   (4) Marca item como enviado (toggle_enviado) e recalcula o pedido
# - Sem usar get_db() em 'with'; sem next_run_at/auto_status; sem Update-schemas com enviado/enviado_em.

from __future__ import annotations

import os
import json
import asyncio
import datetime as dt
import typing as t
from contextlib import contextmanager
from importlib import import_module

# Fallback HTTP (caso função local de envio não exista)
from urllib import request as _req
from urllib.error import URLError, HTTPError

from .database import SessionLocal
from . import crud, schemas

# =========================
# Configuração
# =========================

AUTO_DELAY_SECONDS = 5 * 60          # 5 minutos
SCAN_INTERVAL_SECONDS = 5            # varredura periódica
PROCESS_CONCURRENCY = 1              # processa 1 pedido por vez

# Base URL para chamar sua própria API FastAPI (endpoint /emails/send-item) no fallback
BACKEND_SELF_URL = os.getenv("BACKEND_SELF_URL", "http://127.0.0.1:8000").rstrip("/")
EMAIL_ENDPOINT = f"{BACKEND_SELF_URL}/emails/send-item"
EMAIL_TIMEOUT = 15  # segundos

# =========================
# Helpers
# =========================

def _now_utc_iso() -> str:
    return dt.datetime.utcnow().isoformat(timespec="seconds") + "Z"

def is_paid(status: t.Optional[str]) -> bool:
    if not status:
        return False
    s = status.lower()
    return ("pago" in s) or ("paid" in s) or ("aprov" in s)

def _http_post_json(url: str, data: dict, timeout: int = 15) -> dict:
    """POST JSON simples (sem libs externas). Lança erro se HTTP != 2xx."""
    body = json.dumps(data).encode("utf-8")
    req = _req.Request(
        url,
        data=body,
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    with _req.urlopen(req, timeout=timeout) as resp:  # noqa: S310 (ambiente controlado/local)
        raw = resp.read().decode("utf-8", errors="ignore") or "{}"
        try:
            return json.loads(raw)
        except Exception:
            return {"ok": True, "raw": raw}

# =========================
# DB helpers (contexto)
# =========================

def _db_session():
    """Generator seguro para obter/fechar a Session."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

@contextmanager
def __db_ctx():
    """Context manager minimalista sobre _db_session() (sem usar get_db())."""
    gen = _db_session()
    db = next(gen)
    try:
        yield db
    finally:
        try:
            next(gen)
        except StopIteration:
            pass

# =========================
# Hooks de backend (resolver credenciais / enviar email)
# =========================

# Envio local: tentar localizar enviarItemEmail(destinatario, cliente_nome, jogo, login, senha, codigo)
_LocalSendType = t.Optional[t.Callable[[str, str, str, str, str, str], t.Any]]
_LOCAL_SEND: _LocalSendType = None
_LOCAL_SEND_SOURCE: str = ""

def _try_bind_local_sender() -> None:
    """Tenta localizar uma função local 'enviarItemEmail' em módulos comuns do seu backend."""
    global _LOCAL_SEND, _LOCAL_SEND_SOURCE
    BASE_PKG = __name__.rsplit('.', 1)[0]  # 'backend'
    candidates = [
        (f"{BASE_PKG}.email_utils", "enviarItemEmail"),
        (f"{BASE_PKG}.email", "enviarItemEmail"),
        (f"{BASE_PKG}.emails", "enviarItemEmail"),
        (f"{BASE_PKG}.mailer", "enviarItemEmail"),
        (f"{BASE_PKG}.main", "enviarItemEmail"),
    ]
    for mod_name, func_name in candidates:
        if _LOCAL_SEND:
            break
        try:
            mod = import_module(mod_name)
            fn = getattr(mod, func_name, None)
            if callable(fn):
                _LOCAL_SEND = t.cast(_LocalSendType, fn)
                _LOCAL_SEND_SOURCE = f"{mod_name}:{func_name}"
        except Exception:
            continue

_try_bind_local_sender()

# Resolver local de credenciais: resolver_credenciais_item(sku, plataforma) -> {email, senha, codigo}
_ResolveType = t.Optional[t.Callable[[str, str], t.Optional[dict]]]
_LOCAL_RESOLVE: _ResolveType = None
_LOCAL_RESOLVE_SOURCE: str = ""

def _try_bind_local_resolver() -> None:
    global _LOCAL_RESOLVE, _LOCAL_RESOLVE_SOURCE
    BASE_PKG = __name__.rsplit('.', 1)[0]
    candidates = [
        (f"{BASE_PKG}.jogos_backend", "resolver_credenciais_item"),
        (f"{BASE_PKG}.jogos", "resolver_credenciais_item"),
        (f"{BASE_PKG}.jogos_resolver", "resolver_credenciais_item"),
        (f"{BASE_PKG}.resolver", "resolver_credenciais_item"),
        (f"{BASE_PKG}.main", "resolver_credenciais_item"),
    ]
    for mod_name, func_name in candidates:
        if _LOCAL_RESOLVE:
            break
        try:
            mod = import_module(mod_name)
            fn = getattr(mod, func_name, None)
            if callable(fn):
                _LOCAL_RESOLVE = t.cast(_ResolveType, fn)
                _LOCAL_RESOLVE_SOURCE = f"{mod_name}:{func_name}"
        except Exception:
            continue

_try_bind_local_resolver()

# =========================
# Operações de BD usadas
# =========================

def _db_listar_pedidos() -> list[schemas.PedidoRead]:
    with __db_ctx() as db:
        rows = crud.listar_pedidos(db)
        return [schemas.PedidoRead.model_validate(r) for r in rows]

def _db_obter_pedido(pedido_id: int) -> t.Optional[schemas.PedidoRead]:
    with __db_ctx() as db:
        p = crud.obter_pedido(db, pedido_id)
        return schemas.PedidoRead.model_validate(p) if p else None

def _db_listar_itens(pedido_id: int) -> list[dict]:
    """Lista itens do pedido (para o loop)."""
    with __db_ctx() as db:
        rows = crud.listar_itens(db, pedido_id)
        out: list[dict] = []
        for i in rows:
            out.append(
                {
                    "id": i.id,
                    "pedido_id": i.pedido_id,
                    "sku": i.sku,
                    "nome_produto": i.nome_produto or "",
                    "plataforma": i.plataforma,
                    "email_conta": i.email_conta,
                    "senha_conta": i.senha_conta,
                    "codigo_ativacao": i.codigo_ativacao,
                    "enviado": bool(i.enviado),
                    "enviado_em": (i.enviado_em or ""),
                }
            )
        return out

def _db_obter_item_dict(item_id: int) -> t.Optional[dict]:
    """Recarrega o item do BD e retorna como dict (dados mais recentes)."""
    with __db_ctx() as db:
        it = crud.obter_item(db, item_id)
        if not it:
            return None
        return {
            "id": it.id,
            "pedido_id": it.pedido_id,
            "sku": it.sku,
            "nome_produto": it.nome_produto or "",
            "plataforma": it.plataforma,
            "email_conta": it.email_conta,
            "senha_conta": it.senha_conta,
            "codigo_ativacao": it.codigo_ativacao,
            "enviado": bool(it.enviado),
            "enviado_em": (it.enviado_em or ""),
        }

def _db_upsert_item_credenciais(item_id: int, email: str, senha: str, codigo: str) -> None:
    """
    Grava credenciais diretamente no Item usando a MESMA sessão do CRUD:
    - Carrega via crud.obter_item
    - Atualiza campos e commit
    (Atribuições feitas com setattr + cast(Any, ...) para satisfazer Pylance.)
    """
    with __db_ctx() as db:
        it = crud.obter_item(db, item_id)
        if not it:
            return
        any_it = t.cast(t.Any, it)
        setattr(any_it, "email_conta", email)
        setattr(any_it, "senha_conta", senha)
        setattr(any_it, "codigo_ativacao", codigo)
        db.add(any_it)
        db.commit()

def _db_ensure_item_enviado(item_id: int) -> None:
    """
    Garante que o item fique ENVIADO usando apenas o CRUD existente:
    - lê o item; se não estiver enviado, usa toggle_enviado(db, item_id)
    - se já estiver enviado, não faz nada (evita 'destogglear')
    """
    with __db_ctx() as db:
        it = crud.obter_item(db, item_id)
        if it and not bool(it.enviado):
            crud.toggle_enviado(db, item_id)  # seu CRUD já ajusta enviado/enviado_em e recomputa

def _db_recompute_pedido(pedido_id: int) -> None:
    """Recalcula o status do pedido com base nos itens."""
    with __db_ctx() as db:
        crud.recompute_pedido_enviado(db, pedido_id)

# =========================
# Envio de e-mail (local -> fallback HTTP)
# =========================

class EmailSendError(Exception):
    pass

def _send_email_for_item(pedido: schemas.PedidoRead, it: dict) -> None:
    """
    Envia e-mail priorizando função local 'enviarItemEmail' (se existir).
    Caso não exista, usa o endpoint HTTP /emails/send-item.
    Exige login/senha/codigo e destinatário; caso contrário, aborta.
    """
    destinatario = (pedido.cliente_email or "").strip()
    cliente_nome = (pedido.cliente_nome or "").strip()
    pedido_codigo = str(pedido.codigo or pedido.id)
    jogo = it.get("nome_produto") or ""

    login = (it.get("email_conta") or "").strip()
    senha = (it.get("senha_conta") or "").strip()
    codigo = (it.get("codigo_ativacao") or "").strip()

    if not (destinatario and login and senha and codigo):
        raise EmailSendError("Credenciais incompletas ou destinatário vazio para o item.")

    # 1) Tenta função local (se disponível)
    if callable(_LOCAL_SEND):
        try:
            # assinatura: (destinatario, cliente_nome, jogo, login, senha, codigo)
            _LOCAL_SEND(destinatario, cliente_nome, jogo, login, senha, codigo)
            return
        except Exception as e:
            print(f"[AutoEnvio] envio local via {_LOCAL_SEND_SOURCE} falhou: {e} — fallback HTTP...")

    # 2) Fallback para HTTP local
    payload = {
        "item_id": it["id"],
        "destinatario": destinatario,
        "cliente_nome": cliente_nome,
        "pedido_codigo": pedido_codigo,
        "jogo": jogo,
        "login": login,
        "senha": senha,
        "codigo": codigo,
    }
    try:
        _http_post_json(EMAIL_ENDPOINT, payload, timeout=EMAIL_TIMEOUT)
    except (URLError, HTTPError) as e:
        raise EmailSendError(f"Falha HTTP ao enviar e-mail: {e}") from e
    except Exception as e:
        raise EmailSendError(f"Falha inesperada ao enviar e-mail: {e}") from e

# =========================
# Resolver de credenciais (timer zerou -> carregar dados do jogo)
# =========================

def _maybe_resolve_and_fill_credentials(it: dict) -> dict:
    """
    Se faltar email/senha/codigo, tenta resolver via função local
    resolver_credenciais_item(sku, plataforma) e persiste no BD.
    Retorna sempre um dict 'it' atualizado (recarregado do BD ao final).
    """
    has_email = bool((it.get("email_conta") or "").strip())
    has_senha = bool((it.get("senha_conta") or "").strip())
    has_codigo = bool((it.get("codigo_ativacao") or "").strip())

    if has_email and has_senha and has_codigo:
        return it  # já tem tudo

    sku = (it.get("sku") or "").strip()
    plataforma = (it.get("plataforma") or "").strip()

    if callable(_LOCAL_RESOLVE) and sku:
        try:
            # resolver_credenciais_item(sku, plataforma) -> {"email":..., "senha":..., "codigo":...}
            cred = _LOCAL_RESOLVE(sku, plataforma)
            if isinstance(cred, dict):
                email = (cred.get("email") or "").strip()
                senha = (cred.get("senha") or "").strip()
                codigo = (cred.get("codigo") or "").strip()
                if email and senha and codigo:
                    _db_upsert_item_credenciais(int(it["id"]), email, senha, codigo)
        except Exception as e:
            print(f"[AutoEnvio] resolver_credenciais_item falhou: {e}")

    # Recarrega do BD para garantir estado mais recente
    fresh = _db_obter_item_dict(int(it["id"]))
    return fresh or it

# =========================
# Worker
# =========================

class AutoEnvioWorker:
    def __init__(self) -> None:
        self._task: asyncio.Task | None = None
        self._stop = asyncio.Event()
        # memória de delay por pedido (id -> primeira_vez_visto)
        self._first_seen: dict[int, dt.datetime] = {}
        self._lock = asyncio.Lock()

    async def start(self) -> None:
        if self._task and not self._task.done():
            return
        self._stop.clear()
        self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        self._stop.set()
        if self._task:
            try:
                await asyncio.wait_for(self._task, timeout=2.0)
            except asyncio.TimeoutError:
                self._task.cancel()
                try:
                    await self._task
                except Exception:
                    pass
            finally:
                self._task = None

    async def _run(self) -> None:
        try:
            while not self._stop.is_set():
                try:
                    await self._tick()
                except Exception as e:
                    print(f"[AutoEnvio] erro no tick: {e}")
                await asyncio.sleep(SCAN_INTERVAL_SECONDS)
        finally:
            self._first_seen.clear()

    async def _tick(self) -> None:
        async with self._lock:
            pedidos = await asyncio.to_thread(_db_listar_pedidos)
            now = dt.datetime.utcnow()

            for p in pedidos:
                # Processa apenas pagos e não enviados
                if not is_paid(p.status) or bool(p.enviado):
                    # zera memória se não precisar mais
                    self._first_seen.pop(int(p.id), None)
                    continue

                pid = int(p.id)
                first = self._first_seen.get(pid)
                if not first:
                    self._first_seen[pid] = now
                    continue

                # Aguarda os 5 minutos
                delta = (now - first).total_seconds()
                if delta < AUTO_DELAY_SECONDS:
                    continue

                # Passou do delay, processa
                await self._process_pedido(pid)

    async def _process_pedido(self, pedido_id: int) -> None:
        pedido = await asyncio.to_thread(_db_obter_pedido, pedido_id)
        if not pedido:
            return

        itens = await asyncio.to_thread(_db_listar_itens, pedido_id)

        # Para cada item não enviado: (resolver -> enviar -> marcar)
        for it in itens:
            if bool(it.get("enviado")):
                continue

            # 1) Recarregar dados do jogo/credenciais na virada do timer
            it = await asyncio.to_thread(_maybe_resolve_and_fill_credentials, it)

            # 2) Se ainda faltar alguma credencial, deixa para a próxima varredura
            if not all([(it.get("email_conta") or "").strip(),
                        (it.get("senha_conta") or "").strip(),
                        (it.get("codigo_ativacao") or "").strip()]):
                print(f"[AutoEnvio] item {it['id']} sem credenciais; aguardando próxima tentativa.")
                continue

            # 3) Enviar e-mail
            try:
                await asyncio.to_thread(_send_email_for_item, pedido, it)
                print(f"[AutoEnvio] e-mail OK para {pedido.cliente_email} ({it.get('nome_produto') or ''})")
            except EmailSendError as e:
                print(f"[AutoEnvio] item {it['id']} pendente (envio falhou): {e}")
                continue

            # 4) Marcar como enviado e recalcular pedido
            await asyncio.to_thread(_db_ensure_item_enviado, int(it["id"]))

        # Recalcula o status do pedido com base nos itens
        await asyncio.to_thread(_db_recompute_pedido, pedido_id)

        # Limpa o timer do pedido processado
        self._first_seen.pop(pedido_id, None)


# Execução standalone:
#    python -m backend.autoenvio_worker
if __name__ == "__main__":
    worker = AutoEnvioWorker()

    async def _main():
        await worker.start()
        print("AutoEnvioWorker rodando e com envio automático ativo (resolver -> enviar -> marcar)...")
        try:
            while True:
                await asyncio.sleep(3600)
        except KeyboardInterrupt:
            pass
        finally:
            await worker.stop()

    asyncio.run(_main())
