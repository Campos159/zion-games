import smtplib
from email.message import EmailMessage
from typing import Iterable, Optional, List
from ..settings import settings

class EmailClient:
    """
    Serviço simples de envio de e-mails via SMTP.
    Troque smtplib por aiosmtplib no futuro se quiser tudo async.
    """
    def __init__(
        self,
        host: str | None = None,
        port: int | None = None,
        username: str | None = None,
        password: str | None = None,
        use_tls: bool | None = None,
        use_ssl: bool | None = None,
        default_from: Optional[str] = None,
    ):
        self.host = host or settings.EMAIL_HOST
        self.port = port or settings.EMAIL_PORT
        self.username = username or str(settings.EMAIL_USERNAME)
        self.password = password or settings.EMAIL_PASSWORD
        self.use_tls = settings.EMAIL_USE_TLS if use_tls is None else use_tls
        self.use_ssl = settings.EMAIL_USE_SSL if use_ssl is None else use_ssl
        self.default_from = default_from or settings.EMAIL_FROM or self.username

    def _connect(self) -> smtplib.SMTP:
        if self.use_ssl:
            smtp = smtplib.SMTP_SSL(self.host, self.port)
        else:
            smtp = smtplib.SMTP(self.host, self.port)
        smtp.ehlo()
        if self.use_tls and not self.use_ssl:
            smtp.starttls()
            smtp.ehlo()
        if self.username and self.password:
            smtp.login(self.username, self.password)
        return smtp

    def send_email(
        self,
        to: str | Iterable[str],
        subject: str,
        html: str,
        text: Optional[str] = None,
        cc: Optional[List[str]] = None,
        bcc: Optional[List[str]] = None,
        reply_to: Optional[str] = None,
        from_addr: Optional[str] = None,
    ) -> dict:
        to_list = [to] if isinstance(to, str) else list(to)
        msg = EmailMessage()
        msg["Subject"] = subject
        msg["From"] = from_addr or self.default_from
        msg["To"] = ", ".join(to_list)
        if cc:
            msg["Cc"] = ", ".join(cc)
        if reply_to:
            msg["Reply-To"] = reply_to

        # Corpo
        if text:
            msg.set_content(text)
            msg.add_alternative(html, subtype="html")
        else:
            # gera automaticamente plaintext básico a partir do HTML
            import re
            plain = re.sub("<[^<]+?>", "", html)
            msg.set_content(plain)
            msg.add_alternative(html, subtype="html")

        all_recipients = to_list + (cc or []) + (bcc or [])
        with self._connect() as smtp:
            result = smtp.send_message(msg, to_addrs=all_recipients)
        # smtplib retorna dict com falhas; vazio == sucesso
        return {"errors": result}
