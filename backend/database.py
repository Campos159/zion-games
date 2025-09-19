# backend/database.py
import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

# Usa Postgres se DATABASE_URL estiver no ambiente, senão cai pro SQLite local
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://zion_admin_db_user:ljppS6COnfRWGcOnRExp1x5QQpjYYOLj@dpg-d36ltrbipnbc739aon2g-a.oregon-postgres.render.com/zion_admin_db")

if DATABASE_URL.startswith("sqlite"):
    engine = create_engine(
        DATABASE_URL,
        connect_args={"check_same_thread": False},  # só no SQLite
        pool_pre_ping=True,
    )
else:
    engine = create_engine(
        DATABASE_URL,
        pool_pre_ping=True,
    )

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()