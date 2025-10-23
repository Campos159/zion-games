# backend/database.py
import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from urllib.parse import quote_plus

# 1) Carrega .env se existir
try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    # se não tiver python-dotenv instalado, tudo bem
    pass

DATABASE_URL = (os.getenv("DATABASE_URL") or "").strip()

def _normalize_db_url(url: str) -> str:
    """Normaliza a URL:
       - se vazia, usa SQLite local
       - se postgres:// -> postgresql://
       - força sslmode=require apenas para Postgres
    """
    if not url:
        # 2) Fallback: SQLite local (arquivo no diretório do projeto)
        # use um caminho fixo para evitar confusão com cwd
        sqlite_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "zion_local.db"))
        return f"sqlite:///{sqlite_path}"

    # Corrige prefixo antigo do Heroku/Render
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql://", 1)

    # Força sslmode=require em Postgres (não afeta SQLite)
    if url.startswith("postgresql://") and "sslmode=" not in url:
        sep = "&" if "?" in url else "?"
        url = f"{url}{sep}sslmode=require"

    return url

DATABASE_URL = _normalize_db_url(DATABASE_URL)

# 3) Engine
is_postgres = DATABASE_URL.startswith("postgresql://")
is_sqlite   = DATABASE_URL.startswith("sqlite:///")

connect_args = {}
if is_sqlite:
    # SQLite precisa desse connect_args para threads no Uvicorn/Reload
    connect_args = {"check_same_thread": False}
elif is_postgres:
    # redundante com a querystring, mas deixa explícito
    connect_args = {"sslmode": "require"}

engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    pool_recycle=1800,
    connect_args=connect_args,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
