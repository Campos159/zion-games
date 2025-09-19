from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

# SQLite local (arquivo zion.db na raiz do projeto). Em produção, troque por Postgres.
DATABASE_URL = "sqlite:///./zion.db"

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},  # exigência do SQLite no modo single-thread
    future=True,
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine, future=True)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
