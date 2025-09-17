// src/App.tsx
import { Routes, Route, Navigate } from "react-router-dom";
import { LoginPage } from "./modules/auth/LoginPage";
import { ProtectedRoute } from "./modules/auth/ProtectedRoute";
import { Layout } from "./components/Layout";
import { JogosPage } from "./pages/JogosPage";
import { ClientesPage } from "./pages/ClientesPage";
import { PrecificacaoJogosPage } from "./pages/PrecificacaoJogosPage";
import { VendasPage } from "./pages/VendasPage";

function Home() {
  return (
    <div className="space-y-2">
      <h1 className="text-xl font-semibold">Bem-vindo(a) ao Zion Admin</h1>
      <p className="text-slate-600 text-sm">Esta área será o painel (pendentes, usuários, etc.).</p>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Home />} />
        <Route path="jogos" element={<JogosPage />} />
        <Route path="clientes" element={<ClientesPage />} />
        <Route path="precificacao" element={<PrecificacaoJogosPage />} />
        <Route path="vendas" element={<VendasPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
