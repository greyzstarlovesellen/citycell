const API_URL = (window.CITYCELL_API_URL || "").replace(/\/$/, "");
const sessionKey = "citycell-session";
const money = (value) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value) || 0);
const monthNames = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const today = new Date();
let selectedMonth = today.getMonth();
let selectedYear = today.getFullYear();
let dataVersion = null;
let token = sessionStorage.getItem(sessionKey) || "";
let products = [];
let sales = [];
let expenses = [];
let customers = [];

const getCollections = () => ({ products, sales, expenses, customers });
const setCollections = (data = {}) => {
  products = Array.isArray(data.products) ? data.products : [];
  sales = Array.isArray(data.sales) ? data.sales : [];
  expenses = Array.isArray(data.expenses) ? data.expenses : [];
  customers = Array.isArray(data.customers) ? data.customers : [];
};

async function request(path, options = {}) {
  if (!API_URL) throw new Error("A URL da API ainda não foi configurada.");
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const result = await response.json().catch(() => ({}));
  if (response.status === 401 && path !== "/api/login") signOut("Sua sessão expirou. Entre novamente.");
  if (!response.ok) throw new Error(result.error || "Não foi possível concluir a operação.");
  return result;
}

async function loadData() {
  const result = await request("/api/data");
  dataVersion = result.version || null;
  setCollections(result.data);
  render();
}

async function saveData() {
  const result = await request("/api/data", {
    method: "PUT",
    body: JSON.stringify({ version: dataVersion, data: getCollections() }),
  });
  dataVersion = result.version;
}

function showToast(message, error = false) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.toggle("error", error);
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 3500);
}

function showLogin(message = "") {
  document.querySelector("#auth-gate").classList.add("visible");
  document.querySelector("#auth-error").textContent = message;
  document.querySelector("#auth-password").focus();
}

function hideLogin() {
  document.querySelector("#auth-gate").classList.remove("visible");
}

function signOut(message = "") {
  token = "";
  sessionStorage.removeItem(sessionKey);
  showLogin(message);
}

document.querySelector("#auth-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = document.querySelector("#auth-submit");
  const password = document.querySelector("#auth-password").value;
  button.disabled = true;
  button.textContent = "Conectando…";
  try {
    const result = await request("/api/login", { method: "POST", body: JSON.stringify({ password }) });
    token = result.token;
    sessionStorage.setItem(sessionKey, token);
    await loadData();
    document.querySelector("#auth-password").value = "";
    hideLogin();
    showToast("Conectado aos dados da loja.");
  } catch (error) {
    showLogin(error.message);
  } finally {
    button.disabled = false;
    button.textContent = "Entrar na loja";
  }
});

function inMonth(date) {
  const value = new Date(date);
  return value.getMonth() === selectedMonth && value.getFullYear() === selectedYear;
}

function render() {
  const monthSales = sales.filter((item) => inMonth(item.date));
  const monthExpenses = expenses.filter((item) => inMonth(item.date));
  const revenue = monthSales.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const expense = monthExpenses.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const costs = monthSales.reduce((sum, item) => sum + Number(item.cost || 0), 0);
  const profit = revenue - expense - costs;
  document.querySelector("#metrics").innerHTML = [
    ["Vendas do mês", money(revenue), `${monthSales.length} vendas registradas`, "↗"],
    ["Lucro líquido", money(profit), `Margem de ${revenue ? Math.round((profit / revenue) * 100) : 0}% no período`, "✦"],
    ["Despesas", money(expense), "Despesas lançadas no mês", "↘"],
    ["Clientes", customers.length, "Clientes na sua base", "♙"],
  ].map((item, index) => `<article class="card metric"><div class="metric-head">${item[0]}<span class="metric-icon">${item[3]}</span></div><strong>${item[1]}</strong><div class="trend ${index === 2 ? "down" : ""}">${item[2]}</div></article>`).join("");
  drawChart();
  document.querySelector("#products").innerHTML = products.length
    ? `<table class="table"><thead><tr><th>Produto</th><th>Preço</th><th>Estoque</th><th>Status</th></tr></thead><tbody>${products.slice(0, 4).map((product) => `<tr><td><div class="product"><span class="prod-icon">${product.icon || "📦"}</span>${escapeHtml(product.name)}</div></td><td>${money(product.price)}</td><td>${Number(product.stock) || 0}</td><td><span class="status" style="${product.stock < 5 ? "background:#fff2df;color:#d9983c" : ""}">${product.stock < 5 ? "Estoque baixo" : "Disponível"}</span></td></tr>`).join("")}</tbody></table>`
    : `<div class="empty">Adicione seu primeiro produto para começar.</div>`;
  const recent = [...sales, ...expenses.map((item) => ({ ...item, type: "expense", item: item.category }))]
    .sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 4);
  document.querySelector("#sales").innerHTML = recent.length
    ? recent.map((item, index) => `<div class="sale"><div class="avatar" style="background:${["linear-gradient(135deg,#71e4e8,#5297ff)", "linear-gradient(135deg,#ffcb88,#ff8f9c)", "linear-gradient(135deg,#a2e6c4,#52b9a5)", "linear-gradient(135deg,#b8abff,#6889ef)"][index % 4]}">${escapeHtml((item.name || "CC").split(" ").map((part) => part[0]).slice(0, 2).join(""))}</div><div class="sale-info"><b>${escapeHtml(item.name || item.description || "Despesa")}</b><small>${escapeHtml(item.item || item.category || "Venda")} · ${new Date(item.date).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}</small></div><div class="amount ${item.type === "expense" ? "" : "positive"}">${item.type === "expense" ? "−" : "+"}${money(item.amount)}</div></div>`).join("")
    : `<div class="empty">Suas vendas e despesas aparecerão aqui.</div>`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function drawChart() {
  const count = Number(document.querySelector("#period").value) || 6;
  const values = [];
  for (let offset = count - 1; offset >= 0; offset--) {
    const date = new Date(selectedYear, selectedMonth - offset, 1);
    const matching = (item) => {
      const value = new Date(item.date);
      return value.getMonth() === date.getMonth() && value.getFullYear() === date.getFullYear();
    };
    const total = sales.filter(matching).reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const spent = expenses.filter(matching).reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const cost = sales.filter(matching).reduce((sum, item) => sum + Number(item.cost || 0), 0);
    values.push({ label: monthNames[date.getMonth()].slice(0, 3), sales: total, profit: total - spent - cost });
  }
  const max = Math.max(...values.map((item) => item.sales), 200);
  const width = 650, height = 190, left = 35, right = 15, top = 10, bottom = 25;
  const innerHeight = height - top - bottom, innerWidth = width - left - right;
  const points = values.map((item, index) => [left + index * (innerWidth / Math.max(1, values.length - 1)), top + innerHeight - (item.sales / max) * innerHeight]);
  const profitPoints = values.map((item, index) => [left + index * (innerWidth / Math.max(1, values.length - 1)), top + innerHeight - (Math.max(0, item.profit) / max) * innerHeight]);
  const path = (list) => list.map((point, index) => `${index ? "L" : "M"}${point[0]},${point[1]}`).join(" ");
  const area = `${path(points)} L${points.at(-1)[0]},${top + innerHeight} L${points[0][0]},${top + innerHeight} Z`;
  document.querySelector("#chart").innerHTML = `<svg class="chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none"><defs><linearGradient id="grad" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#69b6ff" stop-opacity=".25"/><stop offset="1" stop-color="#69b6ff" stop-opacity="0"/></linearGradient></defs>${[0, .33, .66, 1].map((step) => `<line class="gridline" x1="${left}" x2="${width - right}" y1="${top + innerHeight * step}" y2="${top + innerHeight * step}"/>`).join("")}<path class="area" d="${area}"/><path class="line" d="${path(points)}"/><path d="${path(profitPoints)}" fill="none" stroke="#53d1c1" stroke-width="2.5" stroke-linecap="round"/>${points.map((point, index) => `<circle cx="${point[0]}" cy="${point[1]}" r="3.3" fill="#fff" stroke="#4a91ee" stroke-width="2"><title>${values[index].label}: ${money(values[index].sales)}</title></circle><text x="${point[0]}" y="${height - 5}" text-anchor="middle">${values[index].label}</text>`).join("")}</svg>`;
}

function openModal(type) {
  const definitions = {
    sale: ["Nova venda", [["name", "Cliente", "text", "Nome do cliente"], ["item", "Produto ou serviço", "text", "Ex.: Capa iPhone 15"], ["amount", "Valor da venda", "number", "0,00"], ["cost", "Custo do produto (opcional)", "number", "0,00"]]],
    product: ["Adicionar produto", [["name", "Nome do produto", "text", "Ex.: Carregador USB-C"], ["category", "Categoria", "select", "Acessórios|Celulares|Assistência|Outros"], ["price", "Preço de venda", "number", "0,00"], ["cost", "Custo unitário", "number", "0,00"], ["stock", "Quantidade em estoque", "number", "0"]]],
    expense: ["Lançar despesa", [["name", "Descrição", "text", "Ex.: Conta de internet"], ["category", "Categoria", "select", "Aluguel|Fornecedores|Marketing|Contas|Outros"], ["amount", "Valor da despesa", "number", "0,00"]]],
    customer: ["Adicionar cliente", [["name", "Nome do cliente", "text", "Nome completo"], ["phone", "Telefone", "tel", "(00) 00000-0000"], ["email", "E-mail (opcional)", "email", "cliente@email.com"]]],
  };
  const [title, fields] = definitions[type];
  const form = document.querySelector("#form");
  document.querySelector("#modal-title").textContent = title;
  form.innerHTML = fields.map(([id, label, kind, placeholder]) => `<div class="field"><label>${label}</label>${kind === "select" ? `<select name="${id}">${placeholder.split("|").map((option) => `<option>${option}</option>`).join("")}</select>` : `<input ${id !== "cost" && id !== "email" ? "required" : ""} name="${id}" type="${kind}" placeholder="${placeholder}" ${kind === "number" ? 'min="0" step="0.01"' : ""}>`}</div>`).join("") + `<button class="btn" type="submit">Salvar ${type === "sale" ? "venda" : type === "product" ? "produto" : type === "expense" ? "despesa" : "cliente"}</button>`;
  form.onsubmit = async (event) => {
    event.preventDefault();
    const item = Object.fromEntries(new FormData(form));
    item.id = crypto.randomUUID();
    if (type === "sale") {
      const product = products.find((entry) => entry.name.toLowerCase() === item.item.toLowerCase());
      item.amount = Number(item.amount);
      item.cost = Number(item.cost) || Number(product?.cost) || 0;
      item.date = new Date().toISOString();
      item.type = "sale";
      if (product) { product.stock = Math.max(0, Number(product.stock) - 1); item.productId = product.id; }
      sales.unshift(item);
      if (!customers.some((entry) => entry.name.toLowerCase() === item.name.toLowerCase())) customers.unshift({ id: crypto.randomUUID(), name: item.name, phone: "" });
    } else if (type === "product") {
      Object.assign(item, { price: Number(item.price), cost: Number(item.cost), stock: Number(item.stock), icon: "📦" });
      products.unshift(item);
    } else if (type === "expense") {
      Object.assign(item, { amount: Number(item.amount), date: new Date().toISOString(), type: "expense" });
      expenses.unshift(item);
    } else if (type === "customer") customers.unshift(item);
    const submit = form.querySelector("button[type=submit]");
    submit.disabled = true;
    submit.textContent = "Gravando no repositório…";
    try {
      await saveData();
      render();
      closeModal();
      showToast("Registro salvo no repositório da City Cell.");
    } catch (error) {
      if (error.message.includes("dados mudaram em outra sessão")) {
        await loadData().catch(() => {});
        closeModal();
        showToast("Outra sessão salvou dados primeiro. As informações foram atualizadas; repita o lançamento.", true);
        return;
      }
      render();
      showToast(`${error.message} O novo registro ainda não foi gravado.`, true);
      submit.disabled = false;
      submit.type = "button";
      submit.textContent = "Tentar salvar novamente";
      submit.onclick = async (click) => {
        click.preventDefault();
        try { await saveData(); closeModal(); render(); showToast("Registro salvo no repositório da City Cell."); }
        catch (retryError) { showToast(retryError.message, true); }
      };
    }
  };
  document.querySelector("#modal-back").classList.add("open");
};

function closeModal() { document.querySelector("#modal-back").classList.remove("open"); }

document.querySelector("#month").innerHTML = monthNames.map((name, index) => `<option value="${index}">${name} ${selectedYear}</option>`).join("");
document.querySelector("#month").value = selectedMonth;
document.querySelector("#month").onchange = (event) => { selectedMonth = Number(event.target.value); render(); };
document.querySelector("#period").onchange = drawChart;
document.querySelector("#quick-sale").onclick = () => openModal("sale");
document.querySelector("#close").onclick = closeModal;
document.querySelector("#modal-back").onclick = (event) => { if (event.target.id === "modal-back") closeModal(); };
document.querySelector("#nav").onclick = (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  document.querySelectorAll(".nav button").forEach((navButton) => navButton.classList.toggle("active", navButton === button));
  document.querySelector("#page-title").textContent = `${button.dataset.page}${button.dataset.page === "Visão geral" ? " ✨" : ""}`;
  document.querySelector("#sidebar").classList.remove("open");
  const modalByPage = { Vendas: "sale", Produtos: "product", Despesas: "expense", Clientes: "customer" };
  if (modalByPage[button.dataset.page]) openModal(modalByPage[button.dataset.page]);
  if (button.dataset.page === "Relatórios") showToast("O relatório é calculado a partir dos lançamentos salvos.");
};
document.body.addEventListener("click", (event) => {
  const button = event.target.closest("[data-open]");
  if (button?.dataset.open) openModal(button.dataset.open);
});
document.querySelector("#mobile").onclick = () => document.querySelector("#sidebar").classList.toggle("open");
document.querySelector("#greeting").textContent = `${today.getHours() < 12 ? "Bom dia" : today.getHours() < 18 ? "Boa tarde" : "Boa noite"}, City Cell! ☀️`;
document.querySelector("#auth-config-hint").hidden = Boolean(API_URL);
document.querySelector("#auth-submit").disabled = !API_URL;

if (token && API_URL) {
  loadData().then(hideLogin).catch(() => signOut("Sessão expirada. Entre novamente."));
} else {
  showLogin(API_URL ? "Entre para acessar os dados da loja." : "Configure e publique a API antes de conectar o painel.");
}

