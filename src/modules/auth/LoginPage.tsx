import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "./AuthContext";

export function LoginPage() {
  const { login } = useAuth();
  const nav = useNavigate();
  const loc = useLocation() as any;

  const [email, setEmail] = useState("admin@zion.local");
  const [password, setPassword] = useState("admin123");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handle = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      await login(email, password);
      const to = loc?.state?.from?.pathname || "/";
      nav(to, { replace: true });
    } catch (e: any) {
      setErr(e?.message || "Falha no login");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen grid place-items-center p-4">
      {/* card centralizado, cantos arredondados e sombra suave */}
      <form
        onSubmit={handle}
        className="w-full max-w-md bg-white rounded-2xl shadow-card p-8 space-y-6 border border-slate-100"
      >
        {/* logotipo/texto */}
        <div className="text-center space-y-1">
          <div className="text-2xl font-semibold text-slate-900">Zion Admin</div>
          <div className="text-sm text-slate-500">Acesso administrativo</div>
        </div>

        {/* mensagem de erro */}
        {err && (
          <div className="text-sm text-red-700 bg-red-50 border border-red-200 p-2 rounded">
            {err}
          </div>
        )}

        {/* campos */}
        <div className="grid gap-4">
          <div>
            <label className="text-sm block mb-1 text-slate-700">E-mail</label>
            <input
              className="w-full border rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-brand-100 focus:border-brand-600/40"
              value={email}
              onChange={(e)=>setEmail(e.target.value)}
              type="email"
              placeholder="voce@empresa.com"
              required
            />
          </div>
          <div>
            <label className="text-sm block mb-1 text-slate-700">Senha</label>
            <input
              className="w-full border rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-brand-100 focus:border-brand-600/40"
              value={password}
              onChange={(e)=>setPassword(e.target.value)}
              type="password"
              placeholder="••••••••"
              required
            />
          </div>
        </div>

        {/* botão */}
        <button
          disabled={loading}
          className="w-full rounded-lg bg-brand-600 text-white py-2.5 font-medium hover:bg-brand-700 transition disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {loading ? "Entrando..." : "Entrar"}
        </button>

        <div className="text-xs text-center text-slate-500">
          Use o admin padrão (vamos trocar depois).
        </div>
      </form>
    </div>
  );
}
