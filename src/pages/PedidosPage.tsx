// src/pages/PedidosPage.tsx
import { useEffect, useMemo, useState } from "react";
import {
  listarPedidos, criarPedido, atualizarPedido, excluirPedido,
  listarItens, criarItem, atualizarItem, excluirItem, toggleEnviado, totalDoPedido,
  type PedidoRead, type PedidoCreate, type PedidoUpdate,
  type ItemRead, type ItemCreate, type ItemUpdate, type Plataforma, type Status
} from "../services/pedidos";

/** === helpers UI === */
const fmtBRL = (n: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n || 0);

function soDigitos(v: string) { return (v || "").replace(/\D+/g, ""); }
function formatTelefone(v: string) {
  const d = soDigitos(v).slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

export function PedidosPage() {
  /** ======= Estados ======= */
  const [carregando, setCarregando] = useState(true);
  const [pedidos, setPedidos] = useState<PedidoRead[]>([]);
  const [busca, setBusca] = useState("");
  const [totais, setTotais] = useState<Record<number, number>>({}); // pedido_id -> total

  const [selId, setSelId] = useState<number | null>(null);
  const [itens, setItens] = useState<ItemRead[]>([]);
  const totalSelecionado = useMemo(
    () => itens.reduce((acc, i) => acc + (i.total_item || 0), 0),
    [itens]
  );

  // form novo pedido
  const [formPed, setFormPed] = useState<PedidoCreate>({
    codigo: "",
    status: "PAID",
    data_criacao: new Date().toISOString().slice(0, 10),
    cliente_nome: "",
    cliente_email: "",
    telefone: "",
  });

  // edição pedido
  const [editingPedId, setEditingPedId] = useState<number | null>(null);
  const [editPed, setEditPed] = useState<PedidoUpdate | null>(null);

  // form novo item
  const [formItem, setFormItem] = useState<ItemCreate>({
    sku: "",
    nome_produto: "",
    plataforma: "PS4",
    quantidade: 1,
    preco_unitario: 0,
    enviado: false,
  });

  // edição item
  const [editingItemId, setEditingItemId] = useState<number | null>(null);
  const [editItem, setEditItem] = useState<ItemUpdate | null>(null);

  /** ======= Efeitos: carregar pedidos e totais ======= */
  useEffect(() => {
    (async () => {
      try {
        setCarregando(true);
        const data = await listarPedidos();
        setPedidos(data);

        // carrega totais de todos os pedidos em paralelo
        const entr = await Promise.all(
          data.map(async (p) => {
            try {
              const t = await totalDoPedido(p.id);
              return [p.id, t] as const;
            } catch {
              return [p.id, 0] as const;
            }
          })
        );
        const map: Record<number, number> = {};
        for (const [id, t] of entr) map[id] = t;
        setTotais(map);
      } finally {
        setCarregando(false);
      }
    })();
  }, []);

  /** ======= Efeito: ao selecionar pedido, carregar itens ======= */
  useEffect(() => {
    (async () => {
      if (selId == null) { setItens([]); return; }
      const rows = await listarItens(selId);
      setItens(rows);
    })();
  }, [selId]);

  /** ======= Filtro: SOMENTE não enviados (em separação) ======= */
  const pedidosView = useMemo(() => {
    const base = pedidos.filter(p => !p.enviado); // <<< aqui filtramos
    const q = busca.trim().toLowerCase();
    if (!q) return base;
    return base.filter((p) =>
      [p.codigo, p.status, p.cliente_nome, p.cliente_email, p.telefone]
        .map((x) => (x || "").toString().toLowerCase())
        .join("|")
        .includes(q)
    );
  }, [pedidos, busca]);

  /** ======= CRUD Pedido ======= */
  async function onCriarPedido(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!formPed.cliente_nome.trim() || !formPed.cliente_email.trim()) return;

    const payload: PedidoCreate = {
      ...formPed,
      telefone: formatTelefone(formPed.telefone || ""),
    };

    const novo = await criarPedido(payload);
    setPedidos((lst) => [novo, ...lst]);

    // carrega total do novo pedido (zero a princípio)
    setTotais((m) => ({ ...m, [novo.id]: 0 }));

    // limpa form
    setFormPed({
      codigo: "",
      status: "PAID",
      data_criacao: new Date().toISOString().slice(0, 10),
      cliente_nome: "",
      cliente_email: "",
      telefone: "",
    });
  }

  async function onRemoverPedido(id: number) {
    if (!confirm("Confirma excluir este pedido e todos os seus itens?")) return;
    await excluirPedido(id);
    setPedidos((lst) => lst.filter((p) => p.id !== id));
    setTotais((m) => {
      const { [id]: _, ...rest } = m;
      return rest;
    });
    if (selId === id) { setSelId(null); setItens([]); }
  }

  function iniciarEdicaoPedido(p: PedidoRead) {
    setEditingPedId(p.id);
    setEditPed({
      codigo: p.codigo ?? "",
      status: p.status,
      data_criacao: p.data_criacao,
      cliente_nome: p.cliente_nome,
      cliente_email: p.cliente_email,
      telefone: p.telefone ?? "",
    });
  }
  function cancelarEdicaoPedido() {
    setEditingPedId(null);
    setEditPed(null);
  }
  async function salvarEdicaoPedido() {
    if (!editingPedId || !editPed) return;
    const upd = await atualizarPedido(editingPedId, {
      ...editPed,
      telefone: editPed.telefone ? formatTelefone(editPed.telefone) : undefined,
    });
    setPedidos((lst) => lst.map((p) => (p.id === editingPedId ? upd : p)));
    // recarrega total desse pedido
    try {
      const t = await totalDoPedido(editingPedId);
      setTotais((m) => ({ ...m, [editingPedId]: t }));
    } catch { /* ignore */ }
    setEditingPedId(null);
    setEditPed(null);
  }

  /** ======= CRUD Item ======= */
  async function onCriarItem(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (selId == null) {
      alert("Selecione um pedido antes de adicionar itens.");
      return;
    }
    if (!formItem.nome_produto.trim() || formItem.quantidade < 1) return;

    const it = await criarItem(selId, formItem);
    setItens((lst) => [...lst, it]);

    // recarrega lista de pedidos para refletir 'enviado' derivado
    const lst = await listarPedidos();
    setPedidos(lst);

    // recarrega total do pedido selecionado
    const t = await totalDoPedido(selId);
    setTotais((m) => ({ ...m, [selId]: t }));

    // limpa form de item
    setFormItem({
      sku: "",
      nome_produto: "",
      plataforma: "PS4",
      quantidade: 1,
      preco_unitario: 0,
      enviado: false,
    });
  }

  function iniciarEdicaoItem(i: ItemRead) {
    setEditingItemId(i.id);
    setEditItem({
      sku: i.sku ?? "",
      nome_produto: i.nome_produto,
      plataforma: i.plataforma,
      quantidade: i.quantidade,
      preco_unitario: Number(i.preco_unitario),
      enviado: i.enviado,
    });
  }
  function cancelarEdicaoItem() {
    setEditingItemId(null);
    setEditItem(null);
  }
  async function salvarEdicaoItem() {
    if (!editingItemId || !editItem) return;
    const it = await atualizarItem(editingItemId, editItem);
    setItens((lst) => lst.map((x) => (x.id === editingItemId ? it : x)));

    // recarrega pedidos e total do selecionado (regra derivada)
    if (selId != null) {
      const lst = await listarPedidos();
      setPedidos(lst);
      const t = await totalDoPedido(selId);
      setTotais((m) => ({ ...m, [selId]: t }));
    }
    setEditingItemId(null);
    setEditItem(null);
  }

  async function onExcluirItem(id: number, pedidoId: number) {
    if (!confirm("Confirma excluir este item?")) return;
    await excluirItem(id);
    setItens((lst) => lst.filter((x) => x.id !== id));

    // refletir status do pedido e total
    const lstPed = await listarPedidos();
    setPedidos(lstPed);
    const t = await totalDoPedido(pedidoId);
    setTotais((m) => ({ ...m, [pedidoId]: t }));
  }

  async function onToggleEnviado(i: ItemRead) {
    const novo = await toggleEnviado(i.id);
    setItens((lst) => lst.map((x) => (x.id === i.id ? novo : x)));

    // recarrega pedidos e total
    const lst = await listarPedidos();
    setPedidos(lst);
    if (selId != null) {
      const t = await totalDoPedido(selId);
      setTotais((m) => ({ ...m, [selId]: t }));
    }
  }

  /** handlers numéricos para item */
  const setNumItemForm = (k: keyof ItemCreate) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setFormItem((f) => ({ ...f, [k]: Number(e.target.value) || 0 }));
  const setNumItemEdit = (k: keyof ItemUpdate) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setEditItem((f) => (f ? { ...f, [k]: Number(e.target.value) || 0 } : f));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Pedidos</h1>
        <p className="text-slate-600 text-sm">
          Cadastre o pedido (cabeçalho) e depois adicione os itens (linhas). O pedido é marcado como <b>enviado</b> quando <b>todos</b> os itens estiverem enviados.
        </p>
      </div>

      {/* === Form Pedido (novo) === */}
      <form onSubmit={onCriarPedido} className="bg-white rounded-2xl shadow-card border border-slate-100 p-4 space-y-4">
        <div className="grid md:grid-cols-6 gap-3">
          <div>
            <label className="text-sm block mb-1">Data</label>
            <input
              type="date"
              value={formPed.data_criacao}
              onChange={(e) => setFormPed((f) => ({ ...f, data_criacao: e.target.value }))}
              className="w-full border rounded-lg px-3 py-2"
              required
            />
          </div>
          <div>
            <label className="text-sm block mb-1">Código</label>
            <input
              value={formPed.codigo || ""}
              onChange={(e) => setFormPed((f) => ({ ...f, codigo: e.target.value }))}
              className="w-full border rounded-lg px-3 py-2"
              placeholder="Código externo (opcional)"
            />
          </div>
          <div>
            <label className="text-sm block mb-1">Status</label>
            <select
              value={formPed.status}
              onChange={(e) => setFormPed((f) => ({ ...f, status: e.target.value as Status }))}
              className="w-full border rounded-lg px-3 py-2 bg-white"
            >
              <option value="PAID">PAID</option>
              <option value="PENDING">PENDING</option>
              <option value="CANCELLED">CANCELLED</option>
              <option value="REFUNDED">REFUNDED</option>
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="text-sm block mb-1">Cliente</label>
            <input
              value={formPed.cliente_nome}
              onChange={(e) => setFormPed((f) => ({ ...f, cliente_nome: e.target.value }))}
              className="w-full border rounded-lg px-3 py-2"
              placeholder="Nome do cliente"
              required
            />
          </div>
          <div className="md:col-span-2">
            <label className="text-sm block mb-1">E-mail do cliente</label>
            <input
              type="email"
              value={formPed.cliente_email}
              onChange={(e) => setFormPed((f) => ({ ...f, cliente_email: e.target.value }))}
              className="w-full border rounded-lg px-3 py-2"
              placeholder="cliente@exemplo.com"
              required
            />
          </div>
          <div>
            <label className="text-sm block mb-1">Telefone</label>
            <input
              value={formPed.telefone || ""}
              onChange={(e) => setFormPed((f) => ({ ...f, telefone: formatTelefone(e.target.value) }))}
              className="w-full border rounded-lg px-3 py-2"
              placeholder="(11) 98888-7777"
              inputMode="numeric"
            />
          </div>
        </div>

        <div className="flex gap-2">
          <button className="rounded-lg bg-brand-600 text-white px-4 py-2 hover:bg-brand-700 transition">
            Adicionar pedido
          </button>
          <button
            type="button"
            onClick={() =>
              setFormPed({
                codigo: "",
                status: "PAID",
                data_criacao: new Date().toISOString().slice(0, 10),
                cliente_nome: "",
                cliente_email: "",
                telefone: "",
              })
            }
            className="rounded-lg border px-4 py-2 hover:bg-slate-50"
          >
            Limpar
          </button>
        </div>
      </form>

      {/* === Lista de Pedidos (somente não enviados) === */}
      <div className="bg-white rounded-2xl shadow-card border border-slate-100">
        <div className="p-3 border-b flex flex-col md:flex-row gap-2 md:items-center">
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por cliente, e-mail, telefone, status..."
            className="flex-1 border rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-brand-100"
          />
          <div className="text-sm text-slate-500">
            {carregando ? "Carregando..." : `${pedidosView.length} pedido(s)`}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-700">
              <tr>
                <th className="text-left px-3 py-2">Data</th>
                <th className="text-left px-3 py-2">Código</th>
                <th className="text-left px-3 py-2">Cliente</th>
                <th className="text-left px-3 py-2">E-mail</th>
                <th className="text-left px-3 py-2">Telefone</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-left px-3 py-2">Enviado</th>
                <th className="text-right px-3 py-2">Total</th>
                <th className="text-right px-3 py-2">Ações</th>
              </tr>
            </thead>
            <tbody>
              {pedidosView.map((p) => {
                const emEdicao = editingPedId === p.id;
                const total = totais[p.id] ?? 0;

                return (
                  <tr key={p.id} className={`border-t ${selId === p.id ? "bg-slate-50/60" : ""}`}>
                    <td className="px-3 py-2">
                      {emEdicao ? (
                        <input
                          type="date"
                          value={editPed?.data_criacao || ""}
                          onChange={(e) => setEditPed((x) => ({ ...(x || {}), data_criacao: e.target.value }))}
                          className="border rounded px-2 py-1"
                        />
                      ) : (
                        p.data_criacao
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {emEdicao ? (
                        <input
                          value={editPed?.codigo || ""}
                          onChange={(e) => setEditPed((x) => ({ ...(x || {}), codigo: e.target.value }))}
                          className="border rounded px-2 py-1 w-32"
                        />
                      ) : (
                        p.codigo || "—"
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {emEdicao ? (
                        <input
                          value={editPed?.cliente_nome || ""}
                          onChange={(e) => setEditPed((x) => ({ ...(x || {}), cliente_nome: e.target.value }))}
                          className="border rounded px-2 py-1 w-48"
                        />
                      ) : (
                        p.cliente_nome
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {emEdicao ? (
                        <input
                          type="email"
                          value={editPed?.cliente_email || ""}
                          onChange={(e) => setEditPed((x) => ({ ...(x || {}), cliente_email: e.target.value }))}
                          className="border rounded px-2 py-1 w-56"
                        />
                      ) : (
                        p.cliente_email
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {emEdicao ? (
                        <input
                          value={editPed?.telefone || ""}
                          onChange={(e) => setEditPed((x) => ({ ...(x || {}), telefone: formatTelefone(e.target.value) }))}
                          className="border rounded px-2 py-1 w-40"
                        />
                      ) : (
                        p.telefone || "—"
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {emEdicao ? (
                        <select
                          value={editPed?.status || "PAID"}
                          onChange={(e) => setEditPed((x) => ({ ...(x || {}), status: e.target.value as Status }))}
                          className="border rounded px-2 py-1 bg-white"
                        >
                          <option value="PAID">PAID</option>
                          <option value="PENDING">PENDING</option>
                          <option value="CANCELLED">CANCELLED</option>
                          <option value="REFUNDED">REFUNDED</option>
                        </select>
                      ) : (
                        p.status
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {p.enviado ? (
                        <span className="text-[10px] uppercase tracking-wide bg-green-100 text-green-800 border border-green-200 rounded-full px-2 py-0.5">
                          Enviado
                        </span>
                      ) : (
                        <span className="text-[10px] uppercase tracking-wide bg-slate-100 text-slate-700 border border-slate-200 rounded-full px-2 py-0.5">
                          Pendente
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">{fmtBRL(total)}</td>
                    <td className="px-3 py-2 text-right">
                      {!emEdicao ? (
                        <div className="flex gap-3 justify-end">
                          <button
                            onClick={() => setSelId(p.id)}
                            className="text-brand-700 hover:underline"
                          >
                            Itens
                          </button>
                          <button
                            onClick={() => iniciarEdicaoPedido(p)}
                            className="text-brand-700 hover:underline"
                          >
                            Editar
                          </button>
                          <button
                            onClick={() => onRemoverPedido(p.id)}
                            className="text-red-600 hover:underline"
                          >
                            Excluir
                          </button>
                        </div>
                      ) : (
                        <div className="flex gap-3 justify-end">
                          <button onClick={salvarEdicaoPedido} className="text-brand-700 hover:underline">
                            Salvar
                          </button>
                          <button onClick={cancelarEdicaoPedido} className="text-slate-600 hover:underline">
                            Cancelar
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!carregando && pedidosView.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-6 text-center text-slate-500">
                    Nenhum pedido.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* === Itens do Pedido Selecionado === */}
      <div className="bg-white rounded-2xl shadow-card border border-slate-100 p-4">
        <div className="flex items-center justify-between gap-2 mb-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Itens do Pedido</h2>
            {selId ? (
              <p className="text-slate-600 text-sm">Pedido selecionado: <b>{selId}</b></p>
            ) : (
              <p className="text-slate-600 text-sm">Selecione um pedido para gerenciar os itens.</p>
            )}
          </div>
          {selId && (
            <div className="text-sm text-slate-700">
              <b>Total do pedido:</b> {fmtBRL(totalSelecionado)}
            </div>
          )}
        </div>

        {/* Form novo item */}
        <form onSubmit={onCriarItem} className="grid md:grid-cols-8 gap-3 mb-4">
          <input
            placeholder="SKU"
            value={formItem.sku || ""}
            onChange={(e) => setFormItem((f) => ({ ...f, sku: e.target.value }))}
            className="border rounded-lg px-3 py-2"
          />
          <input
            placeholder="Nome do produto"
            value={formItem.nome_produto}
            onChange={(e) => setFormItem((f) => ({ ...f, nome_produto: e.target.value }))}
            className="border rounded-lg px-3 py-2 md:col-span-2"
            required
          />
          <select
            value={formItem.plataforma}
            onChange={(e) => setFormItem((f) => ({ ...f, plataforma: e.target.value as Plataforma }))}
            className="border rounded-lg px-3 py-2 bg-white"
          >
            <option value="PS4">PS4</option>
            <option value="PS4s">PS4s</option>
            <option value="PS5">PS5</option>
            <option value="PS5s">PS5s</option>
          </select>
          <input
            type="number"
            min={1}
            placeholder="Qtd"
            value={formItem.quantidade}
            onChange={setNumItemForm("quantidade")}
            className="border rounded-lg px-3 py-2"
          />
          <input
            type="number"
            step="0.01"
            placeholder="Preço unit."
            value={formItem.preco_unitario}
            onChange={setNumItemForm("preco_unitario")}
            className="border rounded-lg px-3 py-2"
          />
          <label className="inline-flex items-center gap-2 px-2">
            <input
              type="checkbox"
              checked={!!formItem.enviado}
              onChange={(e) => setFormItem((f) => ({ ...f, enviado: e.target.checked }))}
            />
            <span className="text-sm">Enviado</span>
          </label>
          <button
            className="rounded-lg bg-brand-600 text-white px-4 py-2 hover:bg-brand-700 transition"
            disabled={!selId}
          >
            Adicionar item
          </button>
        </form>

        {/* Grid itens */}
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-700">
              <tr>
                <th className="text-left px-3 py-2">SKU</th>
                <th className="text-left px-3 py-2">Produto</th>
                <th className="text-left px-3 py-2">Plataforma</th>
                <th className="text-right px-3 py-2">Qtd</th>
                <th className="text-right px-3 py-2">Preço unit.</th>
                <th className="text-right px-3 py-2">Total item</th>
                <th className="text-left px-3 py-2">Enviado</th>
                <th className="text-right px-3 py-2">Ações</th>
              </tr>
            </thead>
            <tbody>
              {selId && itens.map((i) => {
                const emEdicao = editingItemId === i.id;
                return (
                  <tr key={i.id} className="border-t">
                    <td className="px-3 py-2">
                      {emEdicao ? (
                        <input
                          value={editItem?.sku ?? i.sku ?? ""}
                          onChange={(e) => setEditItem((x) => ({ ...(x || {}), sku: e.target.value }))}
                          className="border rounded px-2 py-1 w-32"
                        />
                      ) : (i.sku || "—")}
                    </td>
                    <td className="px-3 py-2">
                      {emEdicao ? (
                        <input
                          value={editItem?.nome_produto ?? i.nome_produto}
                          onChange={(e) => setEditItem((x) => ({ ...(x || {}), nome_produto: e.target.value }))}
                          className="border rounded px-2 py-1 w-64"
                        />
                      ) : (i.nome_produto)}
                    </td>
                    <td className="px-3 py-2">
                      {emEdicao ? (
                        <select
                          value={(editItem?.plataforma ?? i.plataforma) as Plataforma}
                          onChange={(e) => setEditItem((x) => ({ ...(x || {}), plataforma: e.target.value as Plataforma }))}
                          className="border rounded px-2 py-1 bg-white"
                        >
                          <option value="PS4">PS4</option>
                          <option value="PS4s">PS4s</option>
                          <option value="PS5">PS5</option>
                          <option value="PS5s">PS5s</option>
                        </select>
                      ) : (i.plataforma)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {emEdicao ? (
                        <input
                          type="number"
                          min={1}
                          value={editItem?.quantidade ?? i.quantidade}
                          onChange={setNumItemEdit("quantidade")}
                          className="border rounded px-2 py-1 w-20 text-right"
                        />
                      ) : (i.quantidade)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {emEdicao ? (
                        <input
                          type="number"
                          step="0.01"
                          value={editItem?.preco_unitario ?? Number(i.preco_unitario)}
                          onChange={setNumItemEdit("preco_unitario")}
                          className="border rounded px-2 py-1 w-24 text-right"
                        />
                      ) : (fmtBRL(Number(i.preco_unitario)))}
                    </td>
                    <td className="px-3 py-2 text-right">{fmtBRL(i.total_item || 0)}</td>
                    <td className="px-3 py-2">
                      {!emEdicao ? (
                        <button
                          onClick={() => onToggleEnviado(i)}
                          className={`text-[10px] uppercase tracking-wide border rounded-full px-2 py-0.5 ${
                            i.enviado
                              ? "bg-green-100 text-green-800 border-green-200"
                              : "bg-slate-100 text-slate-700 border-slate-200"
                          }`}
                        >
                          {i.enviado ? "Enviado" : "Pendente"}
                        </button>
                      ) : (
                        <label className="inline-flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={!!(editItem?.enviado ?? i.enviado)}
                            onChange={(e) => setEditItem((x) => ({ ...(x || {}), enviado: e.target.checked }))}
                          />
                          <span className="text-sm">Enviado</span>
                        </label>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {!emEdicao ? (
                        <div className="flex gap-3 justify-end">
                          <button onClick={() => iniciarEdicaoItem(i)} className="text-brand-700 hover:underline">
                            Editar
                          </button>
                          <button onClick={() => onExcluirItem(i.id, i.pedido_id)} className="text-red-600 hover:underline">
                            Excluir
                          </button>
                        </div>
                      ) : (
                        <div className="flex gap-3 justify-end">
                          <button onClick={salvarEdicaoItem} className="text-brand-700 hover:underline">
                            Salvar
                          </button>
                          <button onClick={cancelarEdicaoItem} className="text-slate-600 hover:underline">
                            Cancelar
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {selId && itens.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-slate-500">
                    Nenhum item neste pedido.
                  </td>
                </tr>
              )}
              {!selId && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-slate-500">
                    Selecione um pedido acima.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
