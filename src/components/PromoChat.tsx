import { useState } from "react";
import { MessageCircle, X } from "lucide-react";
import axios from "axios";

export function PromoChat() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<{ from: "user" | "bot"; text: string }[]>([]);
  const [loading, setLoading] = useState(false);

  const sendMessage = async () => {
    if (!input.trim()) return;

    const question = input.trim();
    setMessages((m) => [...m, { from: "user", text: question }]);
    setInput("");
    setLoading(true);

    try {
      // 🔹 Envia para o backend correto com o formato esperado
      const { data } = await axios.post(
        "/api/promocoes/consultar",
        { query: question }, // a rota aceita query | termo | q
        { headers: { "Content-Type": "application/json" } }
      );

      // 🔹 Monta a resposta do bot conforme o retorno do backend
      if (!data.ok) throw new Error("Falha na busca");

      if (!data.encontrado) {
        setMessages((m) => [
          ...m,
          {
            from: "bot",
            text: `⚠️ Jogo não encontrado.\nTermo pesquisado: ${question}`,
          },
        ]);
      } else {
        const precoBase = data.preco_original?.toFixed(2) ?? "0.00";
        const precoPromo = data.preco_promocional?.toFixed(2);
        const precoZion = data.preco_sugerido_site?.toFixed(2);

        const resposta = data.em_promocao
          ? `🎮 ${data.titulo} (${data.plataforma})\n💰 PSN: R$${precoBase} → **R$${precoPromo}** (em promoção)\n🏷️ Zion Games: R$${precoZion}`
          : `🎮 ${data.titulo} (${data.plataforma})\n💰 PSN: R$${precoBase}\n🏷️ Zion Games: R$${precoZion}`;

        setMessages((m) => [...m, { from: "bot", text: resposta }]);
      }
    } catch (err) {
      console.error("Erro ao consultar promoção:", err);
      setMessages((m) => [
        ...m,
        {
          from: "bot",
          text: "⚠️ Não consegui encontrar o jogo ou houve um erro na busca.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* Botão flutuante */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="fixed bottom-6 right-6 bg-blue-600 hover:bg-blue-700 text-white p-4 rounded-full shadow-lg transition"
      >
        {open ? <X /> : <MessageCircle />}
      </button>

      {/* Janela do chat */}
      {open && (
        <div className="fixed bottom-20 right-6 w-80 bg-white border border-slate-300 rounded-2xl shadow-2xl flex flex-col">
          <div className="bg-blue-600 text-white p-3 rounded-t-2xl font-semibold text-center">
            ZionBot – Promoções PSN
          </div>

          <div className="flex-1 p-3 overflow-y-auto space-y-2 text-sm">
            {messages.map((m, i) => (
              <div
                key={i}
                className={`whitespace-pre-line ${
                  m.from === "user" ? "text-right text-slate-800" : "text-left text-blue-700"
                }`}
              >
                {m.text}
              </div>
            ))}
            {loading && <div className="text-slate-400 text-center">Buscando informações...</div>}
          </div>

          <div className="p-2 border-t flex gap-2">
            <input
              className="flex-1 border rounded-lg px-2 py-1 text-sm outline-none"
              placeholder="Pergunte algo ex: GTA V PS4"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendMessage()}
            />
            <button
              onClick={sendMessage}
              disabled={loading}
              className="bg-blue-600 text-white rounded-lg px-3 py-1 text-sm hover:bg-blue-700 disabled:opacity-50"
            >
              Enviar
            </button>
          </div>
        </div>
      )}
    </>
  );
}
