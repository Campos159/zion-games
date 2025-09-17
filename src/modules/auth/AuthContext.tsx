import { createContext, useContext, useMemo, useState, useEffect } from "react";
import { api } from "../../services/api";

export type AuthUser = {
  id: number;
  email: string;
  name: string;
  role: "admin" | "operator";
};

type Ctx = {
  user: AuthUser | null;
  token: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
};

const AuthCtx = createContext<Ctx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem("token"));
  const [user, setUser] = useState<AuthUser | null>(() => {
    const raw = localStorage.getItem("user");
    return raw ? JSON.parse(raw) : null;
  });

  useEffect(() => { api.setToken(token); }, [token]);

  // MVP: valida localmente (sem backend)
  const login = async (email: string, password: string) => {
    // ajuste estas credenciais iniciais
    const ok = email.toLowerCase() === "admin@zion.local" && password === "admin123";
    if (!ok) throw new Error("Credenciais inválidas");

    const tk = "dev-token";
    const usr: AuthUser = { id: 1, email, name: "Admin", role: "admin" };
    setToken(tk);
    setUser(usr);
    localStorage.setItem("token", tk);
    localStorage.setItem("user", JSON.stringify(usr));

    // === FUTURO (trocar por backend):
    // const res = await api.post<{token:string; user:AuthUser}>("/auth/login", { email, password });
    // setToken(res.data.token); setUser(res.data.user);
    // localStorage.setItem("token", res.data.token);
    // localStorage.setItem("user", JSON.stringify(res.data.user));
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    localStorage.removeItem("token");
    localStorage.removeItem("user");
  };

  const value = useMemo(() => ({ user, token, login, logout }), [user, token]);
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth deve estar dentro de <AuthProvider>");
  return ctx;
}
