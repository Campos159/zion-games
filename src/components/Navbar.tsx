// src/components/Navbar.tsx
import { useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";

type LinkItem = { to: string; label: string };

const links: LinkItem[] = [
  { to: "/", label: "Home" },
  { to: "/jogos", label: "Jogos" },
  { to: "/clientes", label: "Clientes" },
  { to: "/precificacao", label: "Precificação" },
  { to: "/vendas", label: "Vendas" },
  { to: "/pedidos", label: "Pedidos" },
  { to: "/pedidos/agrupados", label: "Pedidos (Agrupados)" },
  { to: "/envios-manuais", label: "Envios Manuais" },
  { to: "/promocoes", label: "Promoções" },
];

export default function Navbar() {
  const [open, setOpen] = useState(false);
  const location = useLocation();

  // Fecha o menu ao mudar de rota (melhor UX no mobile)
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  // Fecha com ESC (acessibilidade)
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    if (open) window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <header className="sticky top-0 z-50 bg-white/90 backdrop-blur border-b border-slate-200">
      <div className="mx-auto max-w-7xl px-3 sm:px-6">
        <div className="h-14 flex items-center justify-between">
          {/* Brand */}
          <div className="min-w-0 flex items-center gap-2">
            <Link to="/" className="flex items-center gap-2">
              {/* Se tiver logo, troque por <img ... /> */}
              <div className="h-8 w-8 rounded-xl bg-emerald-600" aria-hidden />
              <span className="font-semibold text-slate-900 truncate">
                Zion Admin
              </span>
            </Link>
          </div>

          {/* Links desktop */}
          <nav className="hidden sm:flex items-center gap-2">
            {links.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  [
                    "px-3 py-2 rounded-lg text-sm font-medium transition",
                    isActive
                      ? "text-emerald-700 bg-emerald-50"
                      : "text-slate-700 hover:bg-slate-50",
                  ].join(" ")
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          {/* Botão hambúrguer (mobile) */}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label="Abrir menu"
            aria-expanded={open}
            className="sm:hidden inline-flex items-center justify-center p-2 rounded-md text-slate-700 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <svg
              className="h-6 w-6"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              aria-hidden="true"
            >
              {open ? (
                <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M3 6h18M3 12h18M3 18h18" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* Drawer mobile */}
      {open && (
        <>
          {/* Backdrop */}
          <button
            aria-label="Fechar menu"
            onClick={() => setOpen(false)}
            className="fixed inset-0 bg-black/30 sm:hidden"
          />
          <div
            role="dialog"
            aria-modal="true"
            className="sm:hidden fixed top-14 left-0 right-0 origin-top animate-[scaleY_.12s_ease-out] [transform-origin:top]"
            style={{ transform: "scaleY(1)" }}
          >
            <nav className="mx-3 rounded-2xl border border-slate-200 bg-white shadow-lg overflow-hidden">
              <ul className="py-1">
                {links.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      className={({ isActive }) =>
                        [
                          "block px-4 py-3 text-base",
                          isActive
                            ? "text-emerald-700 bg-emerald-50"
                            : "text-slate-700 hover:bg-slate-50",
                        ].join(" ")
                      }
                    >
                      {item.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
        </>
      )}
    </header>
  );
}
