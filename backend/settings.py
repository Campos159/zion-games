# backend/settings.py
from typing import Optional
from pydantic import EmailStr
from pydantic_settings import BaseSettings  # <- Pydantic v2: use este pacote

class Settings(BaseSettings):
    # App
    DEBUG: bool = True
    LOG_LEVEL: str = "INFO"

    # Email (Gmail + App Password)
    EMAIL_HOST: str = "smtp.gmail.com"
    EMAIL_PORT: int = 587
    EMAIL_USERNAME: EmailStr = "pedrodroid01@gmail.com"
    EMAIL_PASSWORD: str = "olarevgdtfeyfvwz"
    EMAIL_FROM: Optional[EmailStr] = None  # se None, usa EMAIL_USERNAME
    EMAIL_USE_TLS: bool = True   # STARTTLS (587)
    EMAIL_USE_SSL: bool = False  # SSL direto (465)

    # Integrações (mantidas aqui para centralizar config)
    N8N_WEBHOOK_URL: Optional[str] = None
    N8N_HMAC_SECRET: Optional[str] = None
    N8N_DRY_RUN: bool = True

    BACKEND_BASE_URL: str = "http://127.0.0.1:8000"

    YAMPI_API_BASE: str = "https://api.yampi.com.br/v1"
    YAMPI_API_TOKEN: str = ""
    YAMPI_WEBHOOK_SECRET: Optional[str] = None

    class Config:
        env_file = ".env"
        case_sensitive = True

settings = Settings()
