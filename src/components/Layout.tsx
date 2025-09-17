// src/components/Layout.tsx
import { Outlet, Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../modules/auth/AuthContext";

export function Layout() {
  const loc = useLocation();
  const nav = useNavigate();
  const { user, logout } = useAuth();

  const isActive = (path: string) =>
    loc.pathname === path ? "bg-brand-50 text-brand-700 font-medium" : "hover:bg-slate-100";

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r hidden md:flex flex-col">
        <div className="p-4 border-b">
          <div className="text-xl font-semibold text-slate-900">Zion Admin</div>
          <div className="text-xs text-slate-500">v0.1 (MVP)</div>
        </div>

        <nav className="flex-1 p-2">
          <ul className="space-y-1">
            <li>
              <Link to="/" className={`block rounded px-3 py-2 text-sm ${isActive("/")}`}>
                Início
              </Link>
            </li>
            <li>
              <Link to="/jogos" className={`block rounded px-3 py-2 text-sm ${isActive("/jogos")}`}>
                Jogos
              </Link>
            </li>
            <li>
              <Link to="/clientes" className={`block rounded px-3 py-2 text-sm ${isActive("/clientes")}`}>
                Clientes
              </Link>
            </li>
            <li>
              <Link to="/precificacao" className={`block rounded px-3 py-2 text-sm ${isActive("/precificacao")}`}>
                Precificação
              </Link>
            </li>
            <li>
              <Link to="/vendas" className={`block rounded px-3 py-2 text-sm ${isActive("/vendas")}`}>
                Vendas
              </Link>
            </li>
          </ul>
        </nav>

        <div className="p-3 border-t text-sm">
          <div className="mb-2">Logado como: <b>{user?.email}</b></div>
          <button
            onClick={() => { logout(); nav("/login"); }}
            className="w-full rounded-lg bg-brand-600 text-white py-2 hover:bg-brand-700 transition"
          >
            Sair
          </button>
        </div>
      </aside>

      {/* Conteúdo */}
      <main className="flex-1">
        {/* Header mobile */}
        <header className="md:hidden sticky top-0 bg-white border-b p-3 flex justify-between">
          <div className="font-semibold text-slate-900">Zion Admin</div>
          <button onClick={() => { logout(); nav("/login"); }} className="text-sm text-brand-600 hover:underline">
            Sair
          </button>
        </header>

        <div className="p-4 container">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
