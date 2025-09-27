# backend/emailer.py
from __future__ import annotations
import os
import smtplib
from email.message import EmailMessage
from typing import Optional

# Carrega .env localmente (não atrapalha em produção se não existir)
try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass

# ===============================
# Config via variáveis de ambiente
# ===============================
# IMPORTANTE: para produção real, defina EMAIL_DRY_RUN=0
EMAIL_DRY_RUN = os.getenv("EMAIL_DRY_RUN", "1")  # "1" => simula; "0" => envia de verdade

# Outlook/Hotmail pessoais: smtp-mail.outlook.com
# Microsoft 365 (tenant corporativo): smtp.office365.com
SMTP_HOST = os.getenv("SMTP_HOST", "smtp-mail.outlook.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USE_TLS = os.getenv("SMTP_USE_TLS", "1") == "1"

SMTP_USER = os.getenv("SMTP_USER", "").strip()
SMTP_PASS = os.getenv("SMTP_PASS", "").strip()

# Por segurança anti-rejeição, padronize FROM igual ao USER se não vier explícito
SMTP_FROM_EMAIL = os.getenv("SMTP_FROM_EMAIL", "").strip() or SMTP_USER
SMTP_FROM_NAME = os.getenv("SMTP_FROM_NAME", "Zion Games").strip()

# Ativa log detalhado da conversa SMTP (útil para depurar)
SMTP_DEBUG = os.getenv("SMTP_DEBUG", "0") == "1"


# ===============================
# Helpers de assunto/corpo
# ===============================
def build_entrega_subject(pedido_codigo: Optional[str] | int, jogo: str) -> str:
    codigo = pedido_codigo or "pedido"
    return f"[Zion] Entrega do {jogo} — #{codigo}"

def build_entrega_body(
    cliente_nome: str,
    pedido_codigo: str | int,
    jogo: str,
    email_conta: Optional[str],
    senha_conta: Optional[str],
    nick_conta: Optional[str],
    codigo_ativacao: Optional[str],
) -> str:
    return f"""Olá {cliente_nome},

Segue a entrega do seu pedido #{pedido_codigo}.

Jogo: {jogo}

Dados da conta/ativação:
- E-mail/Usuário: {email_conta or "-"}
- Senha: {senha_conta or "-"}
- Nick: {nick_conta or "-"}
- Código de ativação: {codigo_ativacao or "-"}

Observações importantes:
• Mantenha seus dados em sigilo.
• Siga as instruções de ativação enviadas.
• Qualquer dúvida, chame a gente por aqui.

Obrigado por comprar na Zion Games!
"""


def build_message(
    to_email: str,
    subject: str,
    body: str,
    reply_to: Optional[str] = None,
) -> EmailMessage:
    """
    Monta um EmailMessage em texto puro (UTF-8).
    Se quiser HTML no futuro, use msg.add_alternative(html, subtype="html").
    """
    if not to_email:
        raise ValueError("Destinatário vazio.")

    msg = EmailMessage()
    # From: "Nome <email@dominio>"
    from_header = f"{SMTP_FROM_NAME} <{SMTP_FROM_EMAIL}>" if SMTP_FROM_EMAIL else SMTP_FROM_NAME

    msg["From"] = from_header
    msg["To"] = to_email
    msg["Subject"] = subject
    if reply_to:
        msg["Reply-To"] = reply_to

    # texto simples em UTF-8
    msg.set_content(body)

    return msg


def send_email(msg: EmailMessage) -> dict:
    """
    Envia via SMTP (Outlook/Office 365).
    Se EMAIL_DRY_RUN=1, apenas simula e retorna metadados.
    Retorna um dict com:
      - ok: bool
      - dry_run: bool
      - error: str (se houver)
    E, em debug, o diálogo SMTP aparecerá no console do backend.
    """
    if EMAIL_DRY_RUN == "1":
        return {
            "ok": True,
            "dry_run": True,
            "smtp_host": SMTP_HOST,
            "smtp_port": SMTP_PORT,
            "from": str(msg["From"]),
            "to": str(msg["To"]),
            "subject": str(msg["Subject"]),
            "preview": (msg.get_content() or "")[:4000],  # evita resposta gigante
        }

    # Checagens mínimas
    if not SMTP_USER or not SMTP_PASS or not SMTP_FROM_EMAIL:
        raise RuntimeError("Faltam SMTP_USER/SMTP_PASS/SMTP_FROM_EMAIL nas variáveis de ambiente.")

    # Servidores da Microsoft frequentemente rejeitam 'From' diferente do usuário autenticado.
    if SMTP_FROM_EMAIL.lower() != SMTP_USER.lower():
        print("[WARN] SMTP_FROM_EMAIL é diferente de SMTP_USER. Alguns servidores rejeitam silenciosamente.")

    try:
        if SMTP_USE_TLS:
            with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=60) as s:
                if SMTP_DEBUG:
                    s.set_debuglevel(1)  # loga conversa SMTP no console
                s.ehlo()
                s.starttls()
                s.ehlo()
                s.login(SMTP_USER, SMTP_PASS)
                resp = s.send_message(msg)
        else:
            with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=60) as s:
                if SMTP_DEBUG:
                    s.set_debuglevel(1)
                s.ehlo()
                s.login(SMTP_USER, SMTP_PASS)
                resp = s.send_message(msg)

        # smtplib.send_message retorna dict de falhas por destinatário (vazio se tudo OK)
        failed = {k: v for k, v in (resp or {}).items()}
        if failed:
            return {"ok": False, "dry_run": False, "failed_recipients": failed}

        return {"ok": True, "dry_run": False}
    except smtplib.SMTPException as e:
        return {"ok": False, "dry_run": False, "error": f"SMTPException: {e.__class__.__name__}: {e}"}
    except Exception as e:
        return {"ok": False, "dry_run": False, "error": f"Exception: {e.__class__.__name__}: {e}"}


# ===============================
# Templates de entrega
# ===============================
TEMPLATES = {
    "PS4_Primaria": """
🎮 Jogo: {jogo}

PEDIMOS PARA QUE FIQUE ATENTO PARA TODAS AS INSTRUÇÕES E AVISOS QUE SERÃO PASSADOS A SEGUIR:

INSTRUÇÕES PARA INSTALAÇÃO:

1. Ligue o Playstation 4, e na tela inicial, clique em "Novo Usuário";
2. Em seguida, selecione a opção "Criar um Usuário"; (cuidado para não selecionar a opção errada)
3. Marque a opção "Aceitar" e depois clique em "Seguinte";
4. Na tela seguinte, selecione a opção "Iniciar Sessão Manualmente";
5. Preencha os campos de login com os dados abaixo e clique em "Iniciar Sessão"

Login: {login}
Senha: {senha}

6. Preencha o campo do código de verificação com o código informado a seguir e clique em "Verificar";

Código: {codigo}

7. Na tela seguinte, selecione a opção "Alterar para esse PS4" (se essa opção não aparecer, já alterou automaticamente)
8. Depois, selecione a opção "Ok";
9. Assim que logar na conta, vá até "Biblioteca" > "Comprado" e faça o download do jogo adquirido;
10. Após iniciar o download, volte para o seu usuário;
11. Aguarde o download terminar e jogue pela sua própria conta!

------------------------------------------------------------
AVISOS IMPORTANTES:
1. A ALTERAÇÃO DE QUALQUER DADO DA CONTA ACARRETARÁ NA PERDA DO ACESSO DO JOGO;
2. A CONTA ENVIADA É PARA USO ÚNICO E EXCLUSIVO PARA APENAS 1 (UM) VIDEOGAME;
3. SE PRECISAR FORMATAR O CONSOLE, ENTRE EM CONTATO CONOSCO PARA FAZER O PROCEDIMENTO CORRETO DE DESINSTALAÇÃO;
4. NÃO NOS RESPONSABILIZAMOS POR ALTERAÇÃO NOS TERMOS DA SONY EM RELAÇÃO À ATIVAÇÃO DE CONTAS.

------------------------------------------------------------
Qualquer dúvida ou suporte, estaremos disponíveis para atendimento em nosso WhatsApp 📱
Obrigado pela confiança!
Equipe ZION GAMES
""",
}

def render_template(tipo: str, jogo: str, login: str, senha: str, codigo: str, cliente: str) -> str:
    if tipo not in TEMPLATES:
        raise ValueError(f"Template '{tipo}' não encontrado")
    return TEMPLATES[tipo].format(
        jogo=jogo or "-",
        login=login or "-",
        senha=senha or "-",
        codigo=codigo or "-",
        cliente=cliente or "",
    )

def montar_email_entrega_item(
    destinatario: str,
    cliente_nome: str,
    pedido_codigo: str | int,
    jogo: str,
    template_tipo: str,
    login: str,
    senha: str,
    codigo: str,
) -> EmailMessage:
    """
    Gera o EmailMessage com assunto/corpo do template escolhido.
    """
    subject = build_entrega_subject(pedido_codigo, jogo or "-")
    body = render_template(
        template_tipo,
        jogo=jogo or "-",
        login=login or "-",
        senha=senha or "-",
        codigo=codigo or "-",
        cliente=cliente_nome or "",
    )
    msg = build_message(
        to_email=destinatario,
        subject=subject,
        body=body,
        reply_to=SMTP_FROM_EMAIL or None,
    )
    return msg
