// src/pages/EnviosManuaisPage.tsx
import React, { useEffect, useMemo, useState } from "react";
import {
  listarPedidos, listarItens, toggleEnviado,
  type PedidoRead, type ItemRead, type Plataforma
} from "../services/pedidos";
import { sendItemEmail } from "../services/envios";

const fmtBRL = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n || 0);

const plataformaLabel = (p?: Plataforma) => {
  if (!p) return "-";
  if (p === "PS4") return "PS4 (Primária)";
  if (p === "PS5") return "PS5 (Primária)";
  if (p === "PS4s") return "PS4 (Secundária)";
  if (p === "PS5s") return "PS5 (Secundária)";
  return p;
};

function templatePS4Primaria(params: { jogo: string; login?: string; senha?: string; codigo?: string }) {
  const { jogo, login, senha, codigo } = params;
  return `🎮 Jogo: ${jogo}

PEDIMOS PARA QUE FIQUE ATENTO PARA TODAS AS INSTRUÇÕES E AVISOS QUE SERÃO PASSADOS A SEGUIR:

INSTRUÇÕES PARA INSTALAÇÃO:

1. Ligue o Playstation 4, e na tela inicial, clique em "Novo Usuário";
2. Em seguida, selecione a opção "Criar um Usuário"; (cuidado para não selecionar a opção errada)
3. Marque a opção "Aceitar" e depois clique em "Seguinte";
4. Na tela seguinte, selecione a opção "Iniciar Sessão Manualmente";
5. Preencha os campos de login com os dados abaixo e clique em "Iniciar Sessão"

Login: ${login ?? "-"}
Senha: ${senha ?? "-"}

6. Preencha o campo do código de verificação com o código informado a seguir e clique em "Verificar";
Código: ${codigo ?? "-"}

7. Na tela seguinte, selecione a opção "Alterar para esse PS4" (se essa opção não aparecer, já alterou automaticamente)
8. Depois, selecione a opção "Ok";
9. Assim que logar na conta, vá até "Biblioteca" > "Comprado" e faça o download do jogo adquirido;
10. Após iniciar o download, volte para o seu usuário;
11. Aguarde o download terminar e jogue pela sua própria conta!

------------------------------------------------------------
AVISOS IMPORTANTES:
1. Alterar qualquer dado da conta acarretará na perda do acesso do jogo;
2. A conta é exclusiva para apenas 1 videogame;
3. Para formatar o console, contate nosso suporte para orientações;
4. Mudanças nos termos da Sony podem afetar a ativação.

Qualquer dúvida ou suporte, estamos disponíveis no WhatsApp.
Obrigado pela confiança!
Equipe ZION GAMES`;
}

const templatePS4Secundaria = templatePS4Primaria;
const templatePS5Primaria   = templatePS4Primaria;
const templatePS5Secundaria = templatePS4Primaria;

function buildBody(p: PedidoRead, i: ItemRead, jogo: string) {
  const params = {
    jogo,
    login: i.email_conta || i.nick_conta || "",
    senha: i.senha_conta || "",
    codigo: i.codigo_ativacao || "",
  };
  switch (i.plataforma) {
    case "PS4":  return templatePS4Primaria(params);
    case "PS4s": return templatePS4Secundaria(params);
    case "PS5":  return templatePS5Primaria(params);
    case "PS5s": return templatePS5Secundaria(params);
    default:     return templatePS4Primaria(params);
  }
}

export default function EnviosManuaisPage() {
  const [carregando, setCarregando] = useState(true);
  const [pedidos, setPedidos] = useState<PedidoRead[]>([]);
  const [selPedido, setSelPedido] = useState<number | null>(null);
  const [itens, setItens] = useState<ItemRead[]>([]);
  const [selItem, setSelItem] = useState<number | null>(null);

  const pedidoAtual = useMemo(() => pedidos.find(p => p.id === selPedido) || null, [pedidos, selPedido]);
  const itemAtual = useMemo(() => itens.find(i => i.id === selItem) || null, [itens, selItem]);

  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  useEffect(() => {
    (async () => {
      setCarregando(true);
      try {
        const data = await listarPedidos();
        setPedidos(data);
      } finally {
        setCarregando(false);
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      if (!selPedido) { setItens([]); setSelItem(null); return; }
      const rows = await listarItens(selPedido);
      setItens(rows);
      setSelItem(null);
    })();
  }, [selPedido]);

  useEffect(() => {
    if (!pedidoAtual || !itemAtual) return;
    const jogo = itemAtual.nome_produto || "Seu jogo";
    const defaultSubject = `Acesso do seu jogo: ${jogo} (${plataformaLabel(itemAtual.plataforma)})`;
    setTo(pedidoAtual.cliente_email);
    setSubject(defaultSubject);
    setBody(buildBody(pedidoAtual, itemAtual, jogo));
  }, [pedidoAtual, itemAtual]);

  async function onEnviar() {
    if (!pedidoAtual || !itemAtual) return;
    if (!to.trim() || !subject.trim() || !body.trim()) {
      alert("Preencha destinatário, assunto e corpo.");
      return;
    }
    try {
      await sendItemEmail({ item_id: itemAtual.id, to, subject, body });
      alert("E-mail enviado com sucesso!");
      await toggleEnviado(itemAtual.id);
      const updated = await listarItens(pedidoAtual.id);
      setItens(updated);
    } catch (err) {
      console.warn("Falha ao enviar pelo backend, usando fallback mailto.", err);
      const mailto = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      window.location.href = mailto;
      const ok = confirm("Se você enviou o e-mail, deseja marcar o item como ENVIADO?");
      if (ok) {
        await toggleEnviado(itemAtual.id);
        const updated = await listarItens(pedidoAtual.id);
        setItens(updated);
      }
    }
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto p-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Envio manual por e-mail (por item)</h1>
        <p className="text-slate-600 text-sm">
          Selecione um pedido e um item para gerar o e-mail. Você pode editar o texto antes de enviar.
        </p>
      </div>

      <div className="bg-white rounded-2xl shadow-card border border-slate-100 p-4">
        <label className="text-sm block mb-2">Pedido</label>
        <select
          className="border rounded-lg px-3 py-2 bg-white w-full"
          value={selPedido ?? ""}
          onChange={(e) => setSelPedido(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">Selecione um pedido</option>
          {pedidos.map(p => (
            <option key={p.id} value={p.id}>
              #{p.id} • {p.cliente_nome} • {p.cliente_email} • {p.enviado ? "ENVIADO" : "PENDENTE"}
            </option>
          ))}
        </select>
      </div>

      {selPedido && (
        <div className="bg-white rounded-2xl shadow-card border border-slate-100 p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">Itens do pedido #{selPedido}</h2>
            <div className="text-sm text-slate-600">
              {pedidoAtual?.cliente_nome} &lt;{pedidoAtual?.cliente_email}&gt;
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-slate-700">
                <tr>
                  <th className="text-left px-3 py-2">Selecionar</th>
                  <th className="text-left px-3 py-2">Produto</th>
                  <th className="text-left px-3 py-2">Plataforma</th>
                  <th className="text-right px-3 py-2">Qtd</th>
                  <th className="text-right px-3 py-2">Preço</th>
                  <th className="text-left px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {itens.map(i => (
                  <tr key={i.id} className="border-t">
                    <td className="px-3 py-2">
                      <input type="radio" name="selItem" checked={selItem === i.id} onChange={() => setSelItem(i.id)} />
                    </td>
                    <td className="px-3 py-2">{i.nome_produto}</td>
                    <td className="px-3 py-2">{plataformaLabel(i.plataforma)}</td>
                    <td className="px-3 py-2 text-right">{i.quantidade}</td>
                    <td className="px-3 py-2 text-right">{fmtBRL(Number(i.preco_unitario || 0))}</td>
                    <td className="px-3 py-2">
                      {i.enviado ? (
                        <span className="text-[10px] uppercase tracking-wide bg-green-100 text-green-800 border border-green-200 rounded-full px-2 py-0.5">
                          Enviado
                        </span>
                      ) : (
                        <span className="text-[10px] uppercase tracking-wide bg-slate-100 text-slate-700 border border-slate-200 rounded-full px-2 py-0.5">
                          Pendente
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                {itens.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                      Nenhum item neste pedido.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {pedidoAtual && itemAtual && (
        <div className="bg-white rounded-2xl shadow-card border border-slate-100 p-4 space-y-3">
          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <label className="text-sm block mb-1">Para</label>
              <input
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="w-full border rounded-lg px-3 py-2"
                placeholder="cliente@exemplo.com"
              />
            </div>
            <div>
              <label className="text-sm block mb-1">Assunto</label>
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="w-full border rounded-lg px-3 py-2"
              />
            </div>
          </div>

          <div>
            <label className="text-sm block mb-1">Corpo do e-mail</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={16}
              className="w-full border rounded-lg px-3 py-2 font-mono"
            />
          </div>

          <div className="flex gap-2">
            <button onClick={onEnviar} className="rounded-lg bg-brand-600 text-white px-4 py-2 hover:bg-brand-700 transition">
              Enviar e marcar como enviado
            </button>
            <button
              onClick={() => {
                const jogo = itemAtual.nome_produto || "Seu jogo";
                setBody(buildBody(pedidoAtual, itemAtual, jogo));
              }}
              className="rounded-lg border px-4 py-2 hover:bg-slate-50"
            >
              Recarregar template
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
