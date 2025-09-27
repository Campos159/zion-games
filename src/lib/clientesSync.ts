// src/lib/clientesSync.ts
export type Cliente = {
  id: string;
  cod: number;
  nome: string;
  telefone: string;
  data: string;
  email: string;
};

export type PedidoLike = {
  cliente_nome?: string | null;
  cliente_email?: string | null;
  telefone?: string | null;
  data_criacao?: string | null; // "YYYY-MM-DD" vindo do backend
};

const STORAGE_KEY = "zion.clientes";

// ---- helpers iguais aos do ClientesPage ----
function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
function soDigitos(v: string) {
  return (v || "").replace(/\D+/g, "");
}
function formatTelefone(v: string) {
  const d = soDigitos(v).slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}
function recomputarCod(lista: Cliente[]): Cliente[] {
  const ordenada = [...lista].sort((a, b) =>
    a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" })
  );
  return ordenada.map((c, idx) => ({ ...c, cod: idx + 1 }));
}
function carregar(): Cliente[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return recomputarCod(JSON.parse(raw) as Cliente[]);
  } catch {
    return [];
  }
}
function salvar(lista: Cliente[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(lista));
}

// ---- upsert a partir de um pedido ----
export function upsertClienteFromPedido(p: PedidoLike) {
  const nome = (p.cliente_nome || "").trim();
  const email = (p.cliente_email || "").trim().toLowerCase();
  const telefone = formatTelefone(p.telefone || "");
  const data =
    (p.data_criacao && p.data_criacao.slice(0, 10)) ||
    new Date().toISOString().slice(0, 10);

  if (!nome && !email && !telefone) return; // nada pra salvar

  const lista = carregar();

  // Critério de identificação: email > telefone > nome
  let idx = -1;
  if (email) idx = lista.findIndex(c => c.email?.toLowerCase() === email);
  if (idx === -1 && telefone) idx = lista.findIndex(c => soDigitos(c.telefone) === soDigitos(telefone));
  if (idx === -1 && nome) idx = lista.findIndex(c => c.nome.trim().toLowerCase() === nome.toLowerCase());

  if (idx >= 0) {
    // Atualiza campos “em branco” e formatações
    const atual = lista[idx];
    const novo: Cliente = {
      ...atual,
      nome: nome || atual.nome,
      email: email || atual.email,
      telefone: telefone || atual.telefone,
      data: atual.data || data,
    };
    const atualizada = recomputarCod(lista.map((c, i) => (i === idx ? novo : c)));
    salvar(atualizada);
  } else {
    // Insere novo
    const novo: Cliente = {
      id: uid(),
      cod: 0,
      nome: nome || "(sem nome)",
      email,
      telefone,
      data,
    };
    const atualizada = recomputarCod([...lista, novo]);
    salvar(atualizada);
  }
}

// Bulk: sincroniza vários pedidos de uma vez (ex.: após carregar a lista)
export function syncClientesFromPedidos(pedidos: PedidoLike[]) {
  pedidos.forEach(upsertClienteFromPedido);
}
