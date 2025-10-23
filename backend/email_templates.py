# backend/email_templates.py
from __future__ import annotations
from datetime import datetime
import re

BRAND_COLOR = "#0a56c2"
WHATSAPP_URL = "http://wa.me/5511988903758"


def header_html() -> str:
    return f"""
    <div style="width:100%;padding:16px 0;margin-bottom:16px;background:{BRAND_COLOR};text-align:center;">
      <div style="font-family:Arial,sans-serif;font-weight:700;font-size:28px;color:#fff;letter-spacing:1px;">
        ZION GAMES
      </div>
    </div>
    """


def footer_html() -> str:
    now = datetime.now()
    return f"""
    <div style="margin-top:24px;font-size:12px;color:#666;font-family:Arial,sans-serif;text-align:center;">
      Enviado em {now.strftime('%d/%m/%Y %H:%M')}
      <br/>© {now.year} Zion Games — Todos os direitos reservados.
    </div>
    """


def _login_bloco(login: str, senha: str, codigo: str | None) -> str:
    codigo_html = (
        f"<div><strong>Código (verificação/2FA):</strong> "
        f"<span style='font-family:Consolas, monospace;'>{codigo}</span></div>"
        if (codigo or "").strip()
        else ""
    )
    return f"""
    <div style="background:#f5f7ff;border:1px solid #d9e2ff;border-radius:8px;padding:12px 16px;margin:12px 0;">
      <div style="font-family:Arial,sans-serif;color:#0a1b2b;font-size:14px;">
        <div><strong>Login:</strong> <span style="font-family:Consolas, monospace;">{login}</span></div>
        <div><strong>Senha:</strong> <span style="font-family:Consolas, monospace;">{senha}</span></div>
        {codigo_html}
      </div>
    </div>
    """


def _normalize_variacao(v: str) -> str:
    """
    Normaliza o texto da variação para uma das chaves:
    'PS5 Primária', 'PS5 Secundária', 'PS4 Primária', 'PS4 Secundária'
    """
    s = (v or "").strip().lower()
    s = s.replace("primaria", "primária").replace("secundaria", "secundária")
    # tira acentos pra detectar melhor
    def sem_acentos(x: str) -> str:
        return re.sub(r"[áàâãä]", "a", x).replace("ç", "c").replace("é", "e").replace("í", "i").replace("ó", "o").replace("ú", "u")
    sa = sem_acentos(s)
    is_ps5 = "ps5" in sa
    is_ps4 = "ps4" in sa
    is_prim = "primaria" in sa or "primária" in s
    is_sec  = "secundaria" in sa or "secundária" in s
    if is_ps5 and is_prim:
        return "PS5 Primária"
    if is_ps5 and is_sec:
        return "PS5 Secundária"
    if is_ps4 and is_prim:
        return "PS4 Primária"
    if is_ps4 and is_sec:
        return "PS4 Secundária"
    # fallback: se PS5/PS4 sem especificar, assumimos Primária
    if is_ps5:
        return "PS5 Primária"
    if is_ps4:
        return "PS4 Primária"
    # último fallback
    return "PS5 Primária"


# =========================
# Templates por variação
# =========================

def _tpl_ps5_primaria(nome_cliente: str, nome_jogo: str, plataforma_variacao: str,
                      login: str, senha: str, codigo: str | None) -> str:
    bloco_login = _login_bloco(login, senha, codigo)
    return f"""
    {header_html()}
    <div style="font-family:Arial,sans-serif;color:#222;line-height:1.5;">
      <p>Olá, <strong>{nome_cliente}</strong>!</p>

      <p><strong>Jogo:</strong> {nome_jogo}</p>

      <p>PEDIMOS PARA QUE FIQUE ATENTO PARA TODAS AS INSTRUÇÕES E AVISOS QUE SERÃO PASSADOS A SEGUIR:</p>

      <h3 style="margin:16px 0 8px;">INSTRUÇÕES PARA INSTALAÇÃO — {plataforma_variacao}</h3>
      <ol style="padding-left:18px;margin:0;">
        <li>Ligue o Playstation 5 e, na tela inicial, clique em <em>“Adicionar Usuário”</em>.</li>
        <li>Selecione <em>“Vamos Começar”</em> (cuidado para não selecionar a opção errada).</li>
        <li>Marque a opção <em>“Concordo”</em> e clique em <em>“Confirmar”</em>.</li>
        <li>Na tela seguinte, selecione <em>“Iniciar Sessão Manualmente”</em>.</li>
        <li>Preencha os campos de login com os dados abaixo e clique em <em>“Iniciar Sessão”</em>.</li>
      </ol>

      {bloco_login}

      <ol start="6" style="padding-left:18px;margin:0;">
        <li>Preencha o campo do código de verificação (2FA) com o código informado acima e clique em <em>“Ok”</em>.</li>
        <li>Selecione <em>“Ok”</em> novamente e prossiga.</li>
        <li>Na tela de compartilhamento do console e jogo offline, clique em <strong>“Habilitar”</strong>.
          <br/><small>(Se a opção não aparecer, é porque já habilitou automaticamente.)</small>
        </li>
        <li>Ao logar na conta, vá até o último menu à direita, <em>“Biblioteca de Jogos”</em> → aba <em>“Sua Coleção”</em> e faça o download do jogo adquirido.</li>
        <li>Após o início do download, volte para o seu usuário.</li>
        <li>Aguarde o download finalizar e jogue pela sua própria conta.</li>
      </ol>

      <h3 style="margin:16px 0 8px;">AVISOS</h3>
      <ul style="padding-left:18px;margin:0;">
        <li><strong>Não altere</strong> nenhum dado da conta (e-mail, senha, 2FA), se tentar alterar algum dado, será removido o acesso imediatamente.</li>
        <li>A conta enviada é para uso único e exclusivo em <strong>um único videogame</strong>.</li>
        <li>Se precisar <strong>formatar o console</strong>, entre em contato conosco para fazermos o procedimento correto.
            Se formatar sem o nosso procedimento, irá <strong>perder o acesso</strong> do jogo.</li>
        <li>Não nos responsabilizamos por alterações nos termos da Sony em relação à ativação de contas.</li>
      </ul>

      <p style="margin-top:12px;">
        <strong>IMPORTANTE:</strong> Seguir todo o passo a passo corretamente garante a melhor experiência,
        assegura o <strong>acesso vitalício</strong> ao jogo e ajuda a fortalecer nossa comunidade gamer!
      </p>

      <p style="margin-top:12px;">
        Obrigado pela confiança.<br/>
        Suporte pelo WhatsApp: <a href="{WHATSAPP_URL}">{WHATSAPP_URL}</a>
      </p>
    </div>
    {footer_html()}
    """


def _tpl_ps5_secundaria(nome_cliente: str, nome_jogo: str, plataforma_variacao: str,
                        login: str, senha: str, codigo: str | None) -> str:
    bloco_login = _login_bloco(login, senha, codigo)
    return f"""
    {header_html()}
    <div style="font-family:Arial,sans-serif;color:#222;line-height:1.5;">
      <p>Olá, <strong>{nome_cliente}</strong>!</p>

      <p><strong>Jogo:</strong> {nome_jogo}</p>

      <p>PEDIMOS PARA QUE FIQUE ATENTO PARA TODAS AS INSTRUÇÕES E AVISOS QUE SERÃO PASSADOS A SEGUIR:</p>

      <h3 style="margin:16px 0 8px;">INSTRUÇÕES PARA INSTALAÇÃO — {plataforma_variacao}</h3>
      <ol style="padding-left:18px;margin:0;">
        <li>Ligue o Playstation 5 e, na tela inicial, clique em <em>“Adicionar Usuário”</em>.</li>
        <li>Selecione <em>“Vamos Começar”</em> (cuidado para não selecionar a opção errada).</li>
        <li>Marque a opção <em>“Concordo”</em> e clique em <em>“Confirmar”</em>.</li>
        <li>Na tela seguinte, selecione <em>“Iniciar Sessão Manualmente”</em>.</li>
        <li>Preencha os campos de login com os dados abaixo e clique em <em>“Iniciar Sessão”</em>.</li>
      </ol>

      {bloco_login}

      <ol start="6" style="padding-left:18px;margin:0;">
        <li>Preencha o campo do código de verificação (2FA) com o código informado acima e clique em <em>“Ok”</em>.</li>
        <li>Selecione <em>“Ok”</em> novamente e prossiga.</li>
        <li>Na tela de compartilhamento do console e jogo offline, clique em <strong>“NÃO Habilitar”</strong>.
          <br/><small>(Se habilitar, poderá perder o acesso do jogo.)</small>
        </li>
        <li>Ao logar na conta, vá até o último menu à direita, <em>“Biblioteca de Jogos”</em> → aba <em>“Sua Coleção”</em> e faça o download do jogo adquirido.</li>
        <li>Aguarde o download terminar e jogue <strong>por esta mesma conta enviada</strong>.</li>
        <li>Toda vez que for jogar este título, jogue por esta conta.</li>
      </ol>

      <h3 style="margin:16px 0 8px;">AVISOS</h3>
      <ul style="padding-left:18px;margin:0;">
        <li><strong>Não altere</strong> nenhum dado da conta (e-mail, senha, 2FA), se tentar alterar algum dado, será removido o acesso imediatamente.</li>
        <li>A conta enviada é para uso único e exclusivo em <strong>um único videogame</strong>.</li>
        <li>Se precisar <strong>formatar o console</strong>, entre em contato conosco para fazermos o procedimento correto.
            Se formatar sem o nosso procedimento, irá <strong>perder o acesso</strong> do jogo.</li>
        <li>Não nos responsabilizamos por alterações nos termos da Sony em relação à ativação de contas.</li>
      </ul>

      <p style="margin-top:12px;">
        <strong>IMPORTANTE:</strong> Seguir todo o passo a passo corretamente garante a melhor experiência,
        assegura o <strong>acesso vitalício</strong> ao jogo e ajuda a fortalecer nossa comunidade gamer!
      </p>

      <p style="margin-top:12px;">
        Obrigado pela confiança.<br/>
        Suporte pelo WhatsApp: <a href="{WHATSAPP_URL}">{WHATSAPP_URL}</a>
      </p>
    </div>
    {footer_html()}
    """


def _tpl_ps4_secundaria(nome_cliente: str, nome_jogo: str, plataforma_variacao: str,
                        login: str, senha: str, codigo: str | None) -> str:
    bloco_login = _login_bloco(login, senha, codigo)
    return f"""
    {header_html()}
    <div style="font-family:Arial,sans-serif;color:#222;line-height:1.5;">
      <p>Olá, <strong>{nome_cliente}</strong>!</p>

      <p><strong>Jogo:</strong> {nome_jogo}</p>

      <p>PEDIMOS PARA QUE FIQUE ATENTO PARA TODAS AS INSTRUÇÕES E AVISOS QUE SERÃO PASSADOS A SEGUIR:</p>

      <h3 style="margin:16px 0 8px;">INSTRUÇÕES PARA INSTALAÇÃO — {plataforma_variacao}</h3>
      <ol style="padding-left:18px;margin:0;">
        <li>Ligue o Playstation 4 e, na tela inicial, clique em <em>“Novo Usuário”</em>.</li>
        <li>Selecione <em>“Criar um Usuário”</em> (cuidado para não selecionar a opção errada).</li>
        <li>Marque a opção <em>“Aceitar”</em> e depois clique em <em>“Seguinte”</em>.</li>
        <li>Na tela seguinte, selecione <em>“Iniciar Sessão Manualmente”</em>.</li>
        <li>Preencha os campos de login com os dados abaixo e clique em <em>“Iniciar Sessão”</em>.</li>
      </ol>

      {bloco_login}

      <ol start="6" style="padding-left:18px;margin:0;">
        <li>Preencha o código de verificação (2FA) com o código informado acima e clique em <em>“Verificar”</em>.</li>
        <li>Na tela seguinte, selecione <strong>“Não Alterar”</strong> (se colocar para alterar, poderá perder o acesso do jogo).</li>
        <li>Depois, selecione <em>“Ok”</em>.</li>
        <li>Ao logar na conta, vá ao último menu à direita, <em>“Biblioteca”</em> → aba <em>“Comprado”</em> e faça o download do jogo adquirido.</li>
        <li>Aguarde o download finalizar.</li>
        <li>Sempre que for jogar este jogo, jogue <strong>por esta mesma conta enviada</strong>.</li>
      </ol>

      <h3 style="margin:16px 0 8px;">AVISOS</h3>
      <ul style="padding-left:18px;margin:0;">
        <li><strong>Não altere</strong> nenhum dado da conta (e-mail, senha, 2FA), se tentar alterar algum dado, será removido o acesso imediatamente.</li>
        <li>A conta enviada é para uso único e exclusivo em <strong>um único videogame</strong>.</li>
        <li>Se precisar <strong>formatar o console</strong>, entre em contato conosco para fazermos o procedimento correto.
            Se formatar sem o nosso procedimento, irá <strong>perder o acesso</strong> do jogo.</li>
        <li>Não nos responsabilizamos por alterações nos termos da Sony em relação à ativação de contas.</li>
      </ul>

      <p style="margin-top:12px;">
        <strong>IMPORTANTE:</strong> Seguir todo o passo a passo corretamente garante a melhor experiência,
        assegura o <strong>acesso vitalício</strong> ao jogo e ajuda a fortalecer nossa comunidade gamer!
      </p>

      <p style="margin-top:12px;">
        Obrigado pela confiança.<br/>
        Suporte pelo WhatsApp: <a href="{WHATSAPP_URL}">{WHATSAPP_URL}</a>
      </p>
    </div>
    {footer_html()}
    """


def _tpl_ps4_primaria(nome_cliente: str, nome_jogo: str, plataforma_variacao: str,
                      login: str, senha: str, codigo: str | None) -> str:
    bloco_login = _login_bloco(login, senha, codigo)
    return f"""
    {header_html()}
    <div style="font-family:Arial,sans-serif;color:#222;line-height:1.5;">
      <p>Olá, <strong>{nome_cliente}</strong>!</p>

      <p><strong>Jogo:</strong> {nome_jogo}</p>

      <p>PEDIMOS PARA QUE FIQUE ATENTO PARA TODAS AS INSTRUÇÕES E AVISOS QUE SERÃO PASSADOS A SEGUIR:</p>

      <h3 style="margin:16px 0 8px;">INSTRUÇÕES PARA INSTALAÇÃO — {plataforma_variacao}</h3>
      <ol style="padding-left:18px;margin:0;">
        <li>Ligue o Playstation 4 e, na tela inicial, clique em <em>“Novo Usuário”</em>.</li>
        <li>Selecione <em>“Criar um Usuário”</em> (cuidado para não selecionar a opção errada).</li>
        <li>Marque a opção <em>“Aceitar”</em> e depois clique em <em>“Seguinte”</em>.</li>
        <li>Na tela seguinte, selecione <em>“Iniciar Sessão Manualmente”</em>.</li>
        <li>Preencha os campos de login com os dados abaixo e clique em <em>“Iniciar Sessão”</em>.</li>
      </ol>

      {bloco_login}

      <ol start="6" style="padding-left:18px;margin:0;">
        <li>Preencha o código de verificação (2FA) com o código informado acima e clique em <em>“Verificar”</em>.</li>
        <li>Na tela seguinte, selecione <strong>“Alterar para esse PS4”</strong>.
          <br/><small>(Se essa opção não aparecer, já alterou automaticamente.)</small>
        </li>
        <li>Depois, selecione <em>“Ok”</em>.</li>
        <li>Ao logar na conta, vá ao último menu à direita, <em>“Biblioteca”</em> → aba <em>“Comprado”</em> e faça o download do jogo adquirido.</li>
        <li>Após o início do download, volte para o seu usuário.</li>
        <li>Aguarde o download finalizar e jogue pela sua própria conta.</li>
      </ol>

      <h3 style="margin:16px 0 8px;">AVISOS</h3>
      <ul style="padding-left:18px;margin:0;">
        <li><strong>Não altere</strong> nenhum dado da conta (e-mail, senha, 2FA), se tentar alterar algum dado, será removido o acesso imediatamente.</li>
        <li>A conta enviada é para uso único e exclusivo em <strong>um único videogame</strong>.</li>
        <li>Se precisar <strong>formatar o console</strong>, entre em contato conosco para fazermos o procedimento correto.
            Se formatar sem o nosso procedimento, irá <strong>perder o acesso</strong> do jogo.</li>
        <li>Não nos responsabilizamos por alterações nos termos da Sony em relação à ativação de contas.</li>
      </ul>

      <p style="margin-top:12px;">
        <strong>IMPORTANTE:</strong> Seguir todo o passo a passo corretamente garante a melhor experiência,
        assegura o <strong>acesso vitalício</strong> ao jogo e ajuda a fortalecer nossa comunidade gamer!
      </p>

      <p style="margin-top:12px;">
        Obrigado pela confiança.<br/>
        Suporte pelo WhatsApp: <a href="{WHATSAPP_URL}">{WHATSAPP_URL}</a>
      </p>
    </div>
    {footer_html()}
    """


# =========================
# API pública do módulo
# =========================

def subject_for(plataforma_variacao: str, nome_jogo: str) -> str:
    var = _normalize_variacao(plataforma_variacao)
    # Você pode customizar por variação, se quiser
    return f"[Zion Games] {nome_jogo} — dados de acesso ({var})"


def template_envio_item(
    nome_cliente: str,
    nome_jogo: str,
    plataforma_variacao: str,
    login: str,
    senha: str,
    codigo: str | None = None,
    observacoes_html: str | None = None,  # mantido para compat; hoje não usado
) -> str:
    """
    Seleciona automaticamente o template correto (PS4/PS5, Primária/Secundária)
    e renderiza com os dados fornecidos.
    """
    var = _normalize_variacao(plataforma_variacao)

    if var == "PS5 Primária":
        html = _tpl_ps5_primaria(nome_cliente, nome_jogo, var, login, senha, codigo)
    elif var == "PS5 Secundária":
        html = _tpl_ps5_secundaria(nome_cliente, nome_jogo, var, login, senha, codigo)
    elif var == "PS4 Secundária":
        html = _tpl_ps4_secundaria(nome_cliente, nome_jogo, var, login, senha, codigo)
    else:  # "PS4 Primária" (fallback padrão)
        html = _tpl_ps4_primaria(nome_cliente, nome_jogo, var, login, senha, codigo)

    return html


