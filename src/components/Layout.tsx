// src/components/Layout.tsx
import { Outlet, Link, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { useAuth } from "../modules/auth/AuthContext";

export function Layout() {
  const loc = useLocation();
  const nav = useNavigate();
  const { user, logout } = useAuth();

  const [mobileOpen, setMobileOpen] = useState(false);

  // ativo quando a URL começa com o caminho informado (cobre subrotas)
  const isActiveStartsWith = (path: string) =>
    loc.pathname === path || loc.pathname.startsWith(path + "/")
      ? "bg-brand-50 text-brand-700 font-medium"
      : "hover:bg-slate-100";

  // ativo apenas quando bate exatamente
  const isActiveExact = (path: string) =>
    loc.pathname === path
      ? "bg-brand-50 text-brand-700 font-medium"
      : "hover:bg-slate-100";

  // Fecha o menu mobile ao mudar rota (melhor UX)
  useEffect(() => {
    setMobileOpen(false);
  }, [loc.pathname]);

  // Fecha com ESC (acessibilidade)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    if (mobileOpen) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  function handleLogout() {
    logout();
    nav("/login");
  }

  return (
    <div className="min-h-screen flex">
      {/* Sidebar (desktop/tablet) */}
      <aside className="w-64 bg-white border-r hidden md:flex flex-col">
        <div className="p-4 border-b">
          <div className="text-xl font-semibold text-slate-900">Zion Admin</div>
          <div className="text-xs text-slate-500">v0.1 (MVP)</div>
        </div>

        <nav className="flex-1 p-2">
          <ul className="space-y-1">
            <li>
              <Link
                to="/"
                className={`block rounded px-3 py-2 text-sm ${isActiveExact("/")}`}
              >
                Início
              </Link>
            </li>

            <li>
              <Link
                to="/jogos"
                className={`block rounded px-3 py-2 text-sm ${isActiveStartsWith("/jogos")}`}
              >
                Jogos
              </Link>
            </li>

            <li>
              <Link
                to="/clientes"
                className={`block rounded px-3 py-2 text-sm ${isActiveStartsWith("/clientes")}`}
              >
                Clientes
              </Link>
            </li>

            {/* 🆕 Histórico de Contas (desktop) */}
            <li>
              <Link
                to="/historico-contas"
                className={`block rounded px-3 py-2 text-sm ${isActiveStartsWith("/historico-contas")}`}
              >
                Histórico de Contas
              </Link>
            </li>

            <li>
              <Link
                to="/precificacao"
                className={`block rounded px-3 py-2 text-sm ${isActiveStartsWith("/precificacao")}`}
              >
                Precificação
              </Link>
            </li>

            <li>
              <Link
                to="/vendas"
                className={`block rounded px-3 py-2 text-sm ${isActiveStartsWith("/vendas")}`}
              >
                Vendas
              </Link>
            </li>

            {/* NOVO: Custos & Lucro */}
            <li>
              <Link
                to="/custos"
                className={`block rounded px-3 py-2 text-sm ${isActiveStartsWith("/custos")}`}
              >
                Custos & Lucro
              </Link>
            </li>

            <li>
              <Link
                to="/pedidos"
                className={`block rounded px-3 py-2 text-sm ${isActiveStartsWith("/pedidos")}`}
              >
                Pedidos
              </Link>
            </li>

            <li>
              <Link
                to="/pedidos/agrupados"
                className={`block rounded px-3 py-2 text-sm ${isActiveExact("/pedidos/agrupados")}`}
              >
                Pedidos Entregues
              </Link>
            </li>

            <li>
              <Link
                to="/envios-manuais"
                className={`block rounded px-3 py-2 text-sm ${isActiveExact("/envios-manuais")}`}
              >
                Envios Manuais
              </Link>
            </li>

            <li>
              <Link
                to="/promocoes"
                className={`block rounded px-3 py-2 text-sm ${isActiveExact("/promocoes")}`}
              >
                Promoções (PS Store)
              </Link>
            </li>
          </ul>
        </nav>

        <div className="p-3 border-t text-sm">
          <div className="mb-2">
            Logado como: <b>{user?.email}</b>
          </div>
          <button
            onClick={handleLogout}
            className="w-full rounded-lg bg-brand-600 text-white py-2 hover:bg-brand-700 transition"
          >
            Sair
          </button>
        </div>
      </aside>

      {/* Conteúdo */}
      <main className="flex-1">
        {/* Header mobile (com hambúrguer) */}
        <header className="md:hidden sticky top-0 bg-white/90 backdrop-blur border-b px-3 py-2 flex items-center justify-between z-40">
          <button
            type="button"
            aria-label="Abrir menu"
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((v) => !v)}
            className="inline-flex items-center justify-center p-2 rounded-md text-slate-700 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <svg
              className="h-6 w-6"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              aria-hidden="true"
            >
              {mobileOpen ? (
                <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M3 6h18M3 12h18M3 18h18" />
              )}
            </svg>
          </button>

          <div className="font-semibold text-slate-900">Zion Admin</div>

          <button
            onClick={handleLogout}
            className="text-sm text-brand-600 hover:underline"
          >
            Sair
          </button>
        </header>

        {/* Drawer Mobile */}
        {mobileOpen && (
          <>
            {/* Backdrop */}
            <button
              aria-label="Fechar menu"
              onClick={() => setMobileOpen(false)}
              className="fixed inset-0 bg-black/30 md:hidden z-40"
            />
            {/* Painel */}
            <div
              role="dialog"
              aria-modal="true"
              className="fixed top-[44px] left-0 right-0 md:hidden z-50 origin-top animate-[scaleY_.12s_ease-out] [transform-origin:top]"
              style={{ transform: "scaleY(1)" }}
            >
              <nav className="mx-3 my-2 rounded-2xl border border-slate-200 bg-white shadow-lg overflow-hidden">
                <ul className="py-1">
                  <li>
                    <Link
                      to="/"
                      className={`block px-4 py-3 text-base ${isActiveExact("/")}`}
                    >
                      Início
                    </Link>
                  </li>
                  <li>
                    <Link
                      to="/jogos"
                      className={`block px-4 py-3 text-base ${isActiveStartsWith("/jogos")}`}
                    >
                      Jogos
                    </Link>
                  </li>
                  <li>
                    <Link
                      to="/clientes"
                      className={`block px-4 py-3 text-base ${isActiveStartsWith("/clientes")}`}
                    >
                      Clientes
                    </Link>
                  </li>

                  {/* 🆕 Histórico de Contas (mobile) */}
                  <li>
                    <Link
                      to="/historico-contas"
                      className={`block px-4 py-3 text-base ${isActiveStartsWith("/historico-contas")}`}
                    >
                      Histórico de Contas
                    </Link>
                  </li>

                  <li>
                    <Link
                      to="/precificacao"
                      className={`block px-4 py-3 text-base ${isActiveStartsWith("/precificacao")}`}
                    >
                      Precificação
                    </Link>
                  </li>
                  <li>
                    <Link
                      to="/vendas"
                      className={`block px-4 py-3 text-base ${isActiveStartsWith("/vendas")}`}
                    >
                      Vendas
                    </Link>
                  </li>
                  {/* NOVO: Custos & Lucro (mobile) */}
                  <li>
                    <Link
                      to="/custos"
                      className={`block px-4 py-3 text-base ${isActiveStartsWith("/custos")}`}
                    >
                      Custos & Lucro
                    </Link>
                  </li>
                  <li>
                    <Link
                      to="/pedidos"
                      className={`block px-4 py-3 text-base ${isActiveStartsWith("/pedidos")}`}
                    >
                      Pedidos
                    </Link>
                  </li>
                  <li>
                    <Link
                      to="/pedidos/agrupados"
                      className={`block px-4 py-3 text-base ${isActiveExact("/pedidos/agrupados")}`}
                    >
                      Pedidos Entregues
                    </Link>
                  </li>
                  <li>
                    <Link
                      to="/envios-manuais"
                      className={`block px-4 py-3 text-base ${isActiveExact("/envios-manuais")}`}
                    >
                      Envios Manuais
                    </Link>
                  </li>
                  <li>
                    <Link
                      to="/promocoes"
                      className={`block px-4 py-3 text-base ${isActiveExact("/promocoes")}`}
                    >
                      Promoções (PS Store)
                    </Link>
                  </li>
                </ul>

                <div className="border-t p-3 text-sm">
                  <div className="mb-2">
                    Logado como: <b>{user?.email}</b>
                  </div>
                  <button
                    onClick={handleLogout}
                    className="w-full rounded-lg bg-brand-600 text-white py-2 hover:bg-brand-700 transition"
                  >
                    Sair
                  </button>
                </div>
              </nav>
            </div>
          </>
        )}

        <div className="p-4 container">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
