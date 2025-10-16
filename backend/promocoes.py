from __future__ import annotations
import os, time, json, threading
from typing import List, Dict, Optional

from fastapi import APIRouter, HTTPException, Query
from bs4 import BeautifulSoup

# Selenium / Edge
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.edge.service import Service as EdgeService
from selenium.webdriver.edge.options import Options as EdgeOptions
from webdriver_manager.microsoft import EdgeChromiumDriverManager

router = APIRouter(prefix="/promocoes", tags=["Promocoes"])

# =========================
# Config & Consts
# =========================
CACHE_DIR = os.path.join(os.path.dirname(__file__), "cache")
CACHE_FILE = os.path.join(CACHE_DIR, "promos.json")
LAST_HTML = os.path.join(CACHE_DIR, "last_promos.html")

PSPRICES_URL = "https://psprices.com/region-br/discounts?platform=ps4,ps5&lang=pt-BR"
REFRESH_INTERVAL_MIN = int(os.getenv("PSPRICES_REFRESH_MIN", "90"))

# =========================
# Cache utils
# =========================
def _ensure_cache_dir() -> None:
    os.makedirs(CACHE_DIR, exist_ok=True)

def _read_cache() -> List[Dict]:
    try:
        with open(CACHE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return []

def _write_cache(rows: List[Dict]) -> None:
    _ensure_cache_dir()
    tmp = CACHE_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False)
    os.replace(tmp, CACHE_FILE)

def _cache_age_minutes() -> Optional[int]:
    if not os.path.exists(CACHE_FILE):
        return None
    return int((time.time() - os.path.getmtime(CACHE_FILE)) / 60.0)

def _write_last_html(html: str) -> None:
    _ensure_cache_dir()
    try:
        with open(LAST_HTML, "w", encoding="utf-8") as f:
            f.write(html)
    except Exception:
        pass

# =========================
# Selenium driver (Edge)
# =========================
def _mk_edge() -> webdriver.Edge:
    """
    Prioriza anexar ao Edge já aberto com --remote-debugging-port=9222.
    ENVs:
      - PSPRICES_EDGE_DEBUGGER_ADDR=127.0.0.1:9222 (recomendado)
      - PSPRICES_HEADLESS=0/1 (só vale quando NÃO usa debugger)
      - PSPRICES_UA=... (User-Agent)
      - PSPRICES_EDGE_PROFILE_DIR / PSPRICES_EDGE_PROFILE_NAME (sem debugger)
    """
    headless_flag = (os.getenv("PSPRICES_HEADLESS") or "0").strip().lower() in ("1", "true", "yes")
    ua = (os.getenv("PSPRICES_UA") or "").strip()
    prof_dir = (os.getenv("PSPRICES_EDGE_PROFILE_DIR") or "").strip()
    prof_name = (os.getenv("PSPRICES_EDGE_PROFILE_NAME") or "Default").strip()
    debugger = (os.getenv("PSPRICES_EDGE_DEBUGGER_ADDR") or "").strip()  # ex: 127.0.0.1:9222

    opts = EdgeOptions()
    # idioma ajuda a renderizar conteúdo em PT-BR
    opts.add_argument("--lang=pt-BR")
    opts.add_argument("--disable-gpu")
    opts.add_argument("--no-sandbox")
    opts.add_argument("--disable-dev-shm-usage")
    opts.add_argument("--window-size=1366,768")

    if ua:
        opts.add_argument(f"--user-agent={ua}")

    # ⚠️ NÃO usar excludeSwitches / useAutomationExtension no Edge (quebra capabilities)
    if debugger:
        # Anexa ao Edge já aberto
        opts.add_experimental_option("debuggerAddress", debugger)
    else:
        # Sem debugger -> pode usar headless e perfil
        if headless_flag:
            # versões novas suportam --headless=new; se der erro troque por --headless
            opts.add_argument("--headless=new")
        if prof_dir:
            opts.add_argument(f'--user-data-dir={prof_dir}')
        if prof_name:
            opts.add_argument(f'--profile-directory={prof_name}')

    drivers_dir = os.path.join(os.path.dirname(__file__), "drivers")
    local_edge = os.path.join(drivers_dir, "msedgedriver.exe")

    try:
        if os.path.exists(local_edge):
            drv = webdriver.Edge(service=EdgeService(local_edge), options=opts)
        else:
            path = EdgeChromiumDriverManager().install()
            drv = webdriver.Edge(service=EdgeService(path), options=opts)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Falha inicializando WebDriver: {e}")

    # “Stealth” leve via CDP
    try:
        drv.execute_cdp_cmd(
            "Page.addScriptToEvaluateOnNewDocument",
            {"source": "Object.defineProperty(navigator, 'webdriver', {get: () => undefined});"}
        )
    except Exception:
        pass

    return drv

# =========================
# Parsing helpers
# =========================
def _num_from_text(txt: str) -> Optional[float]:
    if not txt:
        return None
    import re
    m = re.search(r"(\d+[.,]\d{2})", txt)
    if not m:
        return None
    s = m.group(1).replace(".", "").replace(",", ".")
    try:
        return float(s)
    except Exception:
        return None

def _parse_promos(html: str) -> List[Dict]:
    soup = BeautifulSoup(html, "lxml")
    rows: List[Dict] = []

    # Seletores amplos (o site muda com frequência)
    cards = soup.select("div.game-collection a.game-collection-item, a.card, a[href*='/game/']")
    seen = set()

    for a in cards:
        href = a.get("href") or ""
        if not href or "game" not in href:
            continue
        link = href if href.startswith("http") else f"https://psprices.com{href}"
        if link in seen:
            continue
        seen.add(link)

        title_el = a.select_one(".title, .game-collection-item__title, .card-title")
        title = (title_el.get_text(strip=True) if title_el else a.get_text(strip=True)) or ""

        plat = ""
        plat_el = a.select_one("[class*='platform_'], .platform, .platforms")
        if plat_el:
            t = plat_el.get_text(" ", strip=True).lower()
            if "ps5" in t:
                plat = "ps5"
            elif "ps4" in t:
                plat = "ps4"

        price_block = a.select_one(".price, .price-current, .discount-price, .game-collection-item__price")
        orig_block  = a.select_one(".price-old, .price-previous, .full-price, .game-collection-item__full-price")

        preco_promocional = _num_from_text(price_block.get_text() if price_block else "")
        preco_original    = _num_from_text(orig_block.get_text() if orig_block else "")

        fim = ""
        date_el = a.select_one(".discount-end, .discount-date, .sale-end")
        if date_el:
            fim = date_el.get_text(strip=True)

        if not title:
            continue

        rows.append({
            "titulo": title,
            "plataforma": plat or "ps4/ps5",
            "preco_original": preco_original,
            "preco_promocional": preco_promocional,
            "fim_promocao": fim,
            "link": link,
        })

    return rows

# =========================
# Scraper principal
# =========================
def _scrape_psprices() -> List[Dict]:
    drv = _mk_edge()
    try:
        drv.get(PSPRICES_URL)

        # Se cair no Cloudflare, deixe a aba carregada (você já resolveu no próprio Edge)
        start = time.time()
        while "Attention Required" in (drv.title or "") and (time.time() - start) < 60:
            time.sleep(2)
            try:
                drv.execute_script("window.scrollTo(0, 200);"); time.sleep(0.2)
                drv.execute_script("window.scrollTo(0, 0);");   time.sleep(0.2)
            except Exception:
                break

        # Espera container (até 25s), mas não falha se não achar
        try:
            WebDriverWait(drv, 25).until(
                EC.any_of(
                    EC.presence_of_element_located((By.CSS_SELECTOR, "div.game-collection")),
                    EC.presence_of_all_elements_located((By.CSS_SELECTOR, "a[href*='/game/']"))
                )
            )
        except Exception:
            pass

        html = drv.page_source or ""
        _write_last_html(html)
        data = _parse_promos(html)

        # Fallback: rolar para carregar lazy
        if len(data) < 10:
            try:
                drv.execute_script("window.scrollTo(0, document.body.scrollHeight);")
                time.sleep(2.5)
                html2 = drv.page_source or ""
                if html2:
                    _write_last_html(html2)
                    data2 = _parse_promos(html2)
                    if len(data2) > len(data):
                        data = data2
            except Exception:
                pass

        # Normalização
        def _nn(x):
            return None if x in ("", None) else float(x)

        clean = []
        for it in data:
            clean.append({
                "titulo": it.get("titulo") or "",
                "plataforma": it.get("plataforma") or "ps4/ps5",
                "preco_original": _nn(it.get("preco_original")),
                "preco_promocional": _nn(it.get("preco_promocional")),
                "fim_promocao": it.get("fim_promocao") or "",
                "link": it.get("link") or "",
            })
        return clean
    finally:
        try:
            drv.quit()
        except Exception:
            pass

# =========================
# Refresh & Scheduler
# =========================
_refresh_lock = threading.Lock()

def _refresh_cache_blocking() -> List[Dict]:
    with _refresh_lock:
        data = _scrape_psprices()
        _write_cache(data)
        return data

def _maybe_async_refresh() -> None:
    t = threading.Thread(target=_refresh_cache_blocking, daemon=True)
    t.start()

def _background_scheduler() -> None:
    while True:
        try:
            _refresh_cache_blocking()
        except Exception as e:
            print("[PROMOS] refresh falhou:", e)
        time.sleep(max(5, REFRESH_INTERVAL_MIN) * 60)

def _start_scheduler_once() -> None:
    _ensure_cache_dir()
    flag = os.path.join(CACHE_DIR, ".scheduler.lock")
    if os.path.exists(flag):
        return
    open(flag, "w").close()
    threading.Thread(target=_background_scheduler, daemon=True).start()

_start_scheduler_once()

# =========================
# Rotas
# =========================
@router.get("")
def ping():
    age = _cache_age_minutes()
    return {"ok": True, "cache_age_min": age, "count": len(_read_cache()), "url": PSPRICES_URL}

@router.get("/listar")
def listar(q: str = Query("", description="Filtro por texto (opcional)")):
    age = _cache_age_minutes()
    if age is None or age > 60:
        _maybe_async_refresh()

    data = _read_cache()
    qn = (q or "").strip().lower()
    if qn:
        data = [d for d in data if qn in (d.get("titulo", "").lower())]
    return data

@router.post("/refresh")
def refresh_now():
    try:
        data = _refresh_cache_blocking()
        return {"ok": True, "count": len(data)}
    except Exception as e:
        cached = _read_cache()
        return {"ok": False, "error": f"{e}", "cached_count": len(cached)}

@router.get("/inspect")
def inspect():
    drv = _mk_edge()
    try:
        drv.get(PSPRICES_URL)
        time.sleep(2)
        title = drv.title or ""
        try:
            ua = drv.execute_script("return navigator.userAgent") or ""
        except Exception:
            ua = ""
        html = drv.page_source or ""
        _write_last_html(html)
        soup = BeautifulSoup(html, "lxml")
        cards = soup.select("div.game-collection a.game-collection-item, a.card, a[href*='/game/']")
        preview = html[:4000] if html else ""
        return {
            "ok": True,
            "page_title": title,
            "user_agent": ua,
            "ready_state": drv.execute_script("return document.readyState") if html else "",
            "cards_found": len(cards),
            "html_preview_len": len(preview),
            "html_preview": preview,
            "samples": [ (a.get("href") or "") for a in cards[:5] ],
        }
    finally:
        try:
            drv.quit()
        except Exception:
            pass
