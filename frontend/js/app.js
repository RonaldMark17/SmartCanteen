/**
 * app.js  –  SmartCanteen AI  |  Main Frontend Application
 * ──────────────────────────────────────────────────────────
 * Pure vanilla JS SPA. No frameworks required.
 * Depends on: api.js, idb.js, sync.js, Chart.js (CDN)
 */

// ── State ─────────────────────────────────────────────────────────────────────
const STATE = {
  user:     null,
  products: [],
  cart:     [],
  charts:   {},
  view:     "dashboard",
};

// ── Auth helpers ──────────────────────────────────────────────────────────────
function getToken()  { return localStorage.getItem("sc_token"); }
function getUser()   { return JSON.parse(localStorage.getItem("sc_user") || "null"); }
function isAdmin()   { return getUser()?.role === "admin"; }

function saveAuth(token, user) {
  localStorage.setItem("sc_token", token);
  localStorage.setItem("sc_user", JSON.stringify(user));
  STATE.user = user;
}

function clearAuth() {
  localStorage.removeItem("sc_token");
  localStorage.removeItem("sc_user");
  STATE.user = null;
}

// ── Toast ─────────────────────────────────────────────────────────────────────
window.showToast = function (msg, type = "info") {
  const container = document.getElementById("toast-container");
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span style="display:flex; align-items:center; gap:8px;">${msg}</span>`;
  container.appendChild(toast);
  setTimeout(() => { toast.classList.add("show"); }, 10);
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, 3500);
};

// ── View switching ─────────────────────────────────────────────────────────────
function showView(name) {
  document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
  document.getElementById(`view-${name}`)?.classList.remove("hidden");
  document.querySelectorAll(".nav-item").forEach((n) => n.classList.remove("active"));
  document.querySelector(`[data-view="${name}"]`)?.classList.add("active");
  STATE.view = name;

  // Load data for the view
  const loaders = {
    dashboard:  loadDashboard,
    pos:        loadPOS,
    inventory:  loadInventory,
    analytics:  loadAnalytics,
    predictions: loadPredictions,
    audit:      loadAudit,
  };
  loaders[name]?.();
}

// ── Login ─────────────────────────────────────────────────────────────────────
async function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById("login-username").value.trim();
  const password = document.getElementById("login-password").value;
  const btn      = document.getElementById("login-btn");

  btn.innerHTML = `<span class="material-symbols-outlined" style="animation: spin 1s linear infinite;">sync</span> Logging in…`;
  btn.disabled = true;

  try {
    const res = await API.login(username, password);
    saveAuth(res.access_token, res.user);
    initApp();
  } catch (err) {
    showToast(`<span class="material-symbols-outlined">error</span> ${err.message}`, "error");
  } finally {
    btn.innerHTML = "Sign In";
    btn.disabled = false;
  }
}

function handleLogout() {
  clearAuth();
  document.getElementById("app-shell").classList.add("hidden");
  document.getElementById("login-screen").classList.remove("hidden");
  STATE.cart = [];
}

// ── App init ──────────────────────────────────────────────────────────────────
async function initApp() {
  const user = getUser();
  if (!user || !getToken()) {
    document.getElementById("login-screen").classList.remove("hidden");
    document.getElementById("app-shell").classList.add("hidden");
    return;
  }

  document.getElementById("login-screen").classList.add("hidden");
  document.getElementById("app-shell").classList.remove("hidden");

  document.getElementById("user-name").textContent = user.full_name || user.username;
  document.getElementById("user-role").textContent = user.role.toUpperCase();

  // Show/hide admin items
  document.querySelectorAll(".admin-only").forEach((el) => {
    el.style.display = isAdmin() ? "" : "none";
  });

  // Cache products for offline
  try {
    const products = await API.getProducts();
    STATE.products = products;
    await IDB.cacheProducts(products);
  } catch (_) {
    // Offline → load from IndexedDB
    STATE.products = await IDB.getCachedProducts();
  }

  // Attempt sync of any offline transactions
  Sync.run();
  Sync.updatePendingBadge();

  showView("dashboard");

  // Request notification permission
  if (Notification.permission === "default") {
    Notification.requestPermission();
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// DASHBOARD
// ═════════════════════════════════════════════════════════════════════════════
async function loadDashboard() {
  try {
    const [summary, daily, predictions] = await Promise.all([
      API.getSummary(),
      API.getDailySales(7),
      API.getPredictions(),
    ]);

    // Stats cards
    document.getElementById("stat-today-revenue").textContent  = `₱${summary.today_revenue.toLocaleString("en-PH", {minimumFractionDigits:2})}`;
    document.getElementById("stat-today-txn").textContent      = summary.today_transactions;
    document.getElementById("stat-products").textContent       = summary.total_products;
    document.getElementById("stat-low-stock").textContent      = summary.low_stock_count;
    document.getElementById("stat-total-revenue").textContent  = `₱${summary.total_revenue.toLocaleString("en-PH", {minimumFractionDigits:2})}`;

    if (summary.low_stock_count > 0) {
      showToast(`<span class="material-symbols-outlined">warning</span> ${summary.low_stock_count} item(s) are low on stock!`, "warning");
    }

    // Daily sales chart
    renderDailyChart(daily);

    // AI Predictions mini-list
    const container = document.getElementById("pred-list");
    const top5      = predictions.predictions.slice(0, 5);
    container.innerHTML = top5.map((p) => {
      // Replace backend emojis with icons
      const recIconHtml = p.recommendation
        .replace("⚠️", `<span class="material-symbols-outlined" style="font-size:14px; vertical-align:middle; color:var(--warning);">warning</span>`)
        .replace("📦", `<span class="material-symbols-outlined" style="font-size:14px; vertical-align:middle; color:var(--info);">inventory_2</span>`)
        .replace("✅", `<span class="material-symbols-outlined" style="font-size:14px; vertical-align:middle; color:var(--success);">check_circle</span>`);

      return `
      <div class="pred-item">
        <div>
          <div class="pred-name">${p.product_name}</div>
          <div class="pred-rec" style="display:flex; align-items:center; gap:4px;">${recIconHtml}</div>
        </div>
        <div class="pred-badge badge-${p.confidence}">${p.predicted_quantity} units</div>
      </div>
    `}).join("");

  } catch (err) {
    if (!(err instanceof API.OfflineError)) showToast(`<span class="material-symbols-outlined">error</span> ${err.message}`, "error");
  }
}

function renderDailyChart(data) {
  const ctx = document.getElementById("chart-daily")?.getContext("2d");
  if (!ctx) return;
  STATE.charts.daily?.destroy();
  STATE.charts.daily = new Chart(ctx, {
    type: "bar",
    data: {
      labels:   data.map((d) => new Date(d.date).toLocaleDateString("en-PH", { weekday: "short", month: "short", day: "numeric" })),
      datasets: [{
        label:           "Revenue (₱)",
        data:            data.map((d) => d.revenue),
        backgroundColor: "rgba(217, 70, 239, 0.7)",
        borderColor:     "#d946ef",
        borderWidth:     2,
        borderRadius:    6,
      }],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, ticks: { callback: (v) => `₱${v}` } },
      },
    },
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// POS
// ═════════════════════════════════════════════════════════════════════════════
async function loadPOS() {
  renderProductGrid();
  renderCart();
}

function renderProductGrid(filter = "") {
  const grid    = document.getElementById("product-grid");
  const products = STATE.products.filter((p) =>
    p.is_active !== false &&
    (filter === "" || p.name.toLowerCase().includes(filter.toLowerCase()) ||
     p.category.toLowerCase().includes(filter.toLowerCase()))
  );

  // Group by category
  const categories = [...new Set(products.map((p) => p.category))].sort();

  grid.innerHTML = categories.map((cat) => {
    const items = products.filter((p) => p.category === cat);
    return `
      <div class="product-category">
        <div class="category-label">${cat}</div>
        <div class="product-items">
          ${items.map((p) => `
            <button class="product-card ${p.stock === 0 ? "out-of-stock" : ""}"
                    onclick="addToCart(${p.id})"
                    ${p.stock === 0 ? "disabled" : ""}>
              <div class="product-emoji"><span class="material-symbols-outlined" style="font-size: inherit;">${categoryIcon(p.category)}</span></div>
              <div class="product-name">${p.name}</div>
              <div class="product-price">₱${p.price.toFixed(2)}</div>
              <div class="product-stock ${p.stock <= p.min_stock ? "low" : ""}">
                ${p.stock === 0 ? "OUT" : `${p.stock} left`}
              </div>
            </button>
          `).join("")}
        </div>
      </div>
    `;
  }).join("");
}

function categoryIcon(cat) {
  const map = {
    Staple: "rice_bowl", Viand: "set_meal", Soup: "ramen_dining", Snacks: "tapas",
    Bread: "bakery_dining", Drinks: "local_drink", Dessert: "cake", General: "shopping_cart",
  };
  return map[cat] || "restaurant";
}

function addToCart(productId) {
  const product = STATE.products.find((p) => p.id === productId);
  if (!product || product.stock === 0) return;

  const existing = STATE.cart.find((c) => c.product_id === productId);
  if (existing) {
    if (existing.quantity >= product.stock) {
      showToast(`<span class="material-symbols-outlined">production_quantity_limits</span> Max stock reached for ${product.name}`, "warning");
      return;
    }
    existing.quantity += 1;
  } else {
    STATE.cart.push({ product_id: productId, quantity: 1, unit_price: product.price, name: product.name });
  }
  renderCart();
}

function removeFromCart(productId) {
  STATE.cart = STATE.cart.filter((c) => c.product_id !== productId);
  renderCart();
}

function updateQty(productId, qty) {
  const item    = STATE.cart.find((c) => c.product_id === productId);
  const product = STATE.products.find((p) => p.id === productId);
  if (!item) return;
  if (qty <= 0) { removeFromCart(productId); return; }
  if (qty > product.stock) qty = product.stock;
  item.quantity = qty;
  renderCart();
}

function renderCart() {
  const cartList   = document.getElementById("cart-items");
  const totalEl    = document.getElementById("cart-total");
  const countEl    = document.getElementById("cart-count");
  const discount   = parseFloat(document.getElementById("cart-discount")?.value || 0) || 0;
  const subtotal   = STATE.cart.reduce((s, i) => s + i.quantity * i.unit_price, 0);
  const total      = Math.max(0, subtotal - discount);

  countEl.textContent = STATE.cart.length;

  if (STATE.cart.length === 0) {
    cartList.innerHTML = `<div class="cart-empty">Cart is empty</div>`;
  } else {
    cartList.innerHTML = STATE.cart.map((item) => `
      <div class="cart-item">
        <div class="cart-item-info">
          <div class="cart-item-name">${item.name}</div>
          <div class="cart-item-price">₱${(item.quantity * item.unit_price).toFixed(2)}</div>
        </div>
        <div class="cart-item-controls">
          <button onclick="updateQty(${item.product_id}, ${item.quantity - 1})">−</button>
          <span>${item.quantity}</span>
          <button onclick="updateQty(${item.product_id}, ${item.quantity + 1})">+</button>
          <button class="btn-remove" onclick="removeFromCart(${item.product_id})"><span class="material-symbols-outlined" style="font-size: 16px;">close</span></button>
        </div>
      </div>
    `).join("");
  }

  totalEl.textContent = `₱${total.toFixed(2)}`;
}

async function checkout() {
  if (STATE.cart.length === 0) { showToast(`<span class="material-symbols-outlined">shopping_cart</span> Cart is empty!`, "warning"); return; }

  const discount     = parseFloat(document.getElementById("cart-discount")?.value || 0) || 0;
  const payment_type = document.getElementById("payment-type")?.value || "cash";

  const data = {
    items:        STATE.cart.map(({ product_id, quantity, unit_price }) => ({ product_id, quantity, unit_price })),
    discount,
    payment_type,
  };

  const total = STATE.cart.reduce((s, i) => s + i.quantity * i.unit_price, 0) - discount;

  if (!navigator.onLine) {
    // Offline → save locally
    await IDB.saveOfflineTransaction({ ...data, total });
    STATE.cart = [];
    renderCart();
    Sync.updatePendingBadge();
    showToast(`<span class="material-symbols-outlined">save</span> Transaction saved offline. Will sync when back online.`, "warning");
    showReceipt(data, total, true);
    return;
  }

  try {
    const txn = await API.createTransaction(data);

    // Deduct from local cache so POS stays accurate offline
    for (const item of STATE.cart) {
      const p = STATE.products.find((x) => x.id === item.product_id);
      if (p) p.stock = Math.max(0, p.stock - item.quantity);
    }
    await IDB.cacheProducts(STATE.products);
    renderProductGrid();

    STATE.cart = [];
    renderCart();
    showToast(`<span class="material-symbols-outlined">check_circle</span> Transaction complete!`, "success");
    showReceipt(data, total, false);

  } catch (err) {
    showToast(`<span class="material-symbols-outlined">error</span> ${err.message}`, "error");
  }
}

function showReceipt(data, total, isOffline) {
  const discount  = data.discount || 0;
  const subtotal  = total + discount;
  const items     = data.items.map((i) => {
    const p = STATE.products.find((x) => x.id === i.product_id);
    return `<tr><td>${p?.name || i.product_id}</td><td>${i.quantity}</td><td>₱${(i.quantity * i.unit_price).toFixed(2)}</td></tr>`;
  }).join("");

  document.getElementById("receipt-body").innerHTML = `
    <table class="receipt-table">
      <thead><tr><th>Item</th><th>Qty</th><th>Amount</th></tr></thead>
      <tbody>${items}</tbody>
    </table>
    <div class="receipt-totals">
      <div>Subtotal: <strong>₱${subtotal.toFixed(2)}</strong></div>
      ${discount > 0 ? `<div>Discount: <strong>-₱${discount.toFixed(2)}</strong></div>` : ""}
      <div class="receipt-grand">TOTAL: <strong>₱${total.toFixed(2)}</strong></div>
      <div>Payment: <strong>${data.payment_type.toUpperCase()}</strong></div>
      ${isOffline ? `<div class="offline-note" style="display:flex; align-items:center; justify-content:center; gap:6px;"><span class="material-symbols-outlined" style="font-size:16px;">wifi_off</span> Saved offline — pending sync</div>` : ""}
    </div>
  `;
  document.getElementById("receipt-modal").classList.remove("hidden");
}

// ═════════════════════════════════════════════════════════════════════════════
// INVENTORY
// ═════════════════════════════════════════════════════════════════════════════
async function loadInventory() {
  try {
    const products = await API.getProducts(false);
    STATE.products = products.filter((p) => p.is_active !== false);
    renderInventoryTable(products);
  } catch (_) {
    renderInventoryTable(STATE.products);
  }
}

function renderInventoryTable(products) {
  const tbody = document.getElementById("inventory-tbody");
  tbody.innerHTML = products.map((p) => `
    <tr class="${!p.is_active ? "inactive-row" : ""}">
      <td>${p.id}</td>
      <td><strong>${p.name}</strong></td>
      <td><span class="badge-category">${p.category}</span></td>
      <td>₱${p.price.toFixed(2)}</td>
      <td>
        <span class="stock-badge ${p.stock <= p.min_stock ? "stock-low" : "stock-ok"}">
          ${p.stock}
        </span>
      </td>
      <td>${p.min_stock}</td>
      <td><span class="status-dot ${p.is_active ? "active" : "inactive"}"></span> ${p.is_active ? "Active" : "Inactive"}</td>
      <td class="admin-only" style="display:${isAdmin() ? "flex" : "none"}; gap:8px;">
        <button class="btn-sm btn-edit" style="display:inline-flex; align-items:center; gap:4px;" onclick="openEditProduct(${p.id})"><span class="material-symbols-outlined" style="font-size:14px;">edit</span> Edit</button>
        <button class="btn-sm btn-danger" style="display:inline-flex; align-items:center; gap:4px;" onclick="deleteProduct(${p.id})"><span class="material-symbols-outlined" style="font-size:14px;">delete</span> Delete</button>
      </td>
    </tr>
  `).join("");
}

function openAddProduct() {
  document.getElementById("product-form-title").textContent = "Add Product";
  document.getElementById("product-form").reset();
  document.getElementById("product-form-id").value = "";
  document.getElementById("product-modal").classList.remove("hidden");
}

function openEditProduct(id) {
  const p = STATE.products.find((x) => x.id === id);
  if (!p) return;
  document.getElementById("product-form-title").textContent = "Edit Product";
  document.getElementById("product-form-id").value    = p.id;
  document.getElementById("pf-name").value            = p.name;
  document.getElementById("pf-category").value        = p.category;
  document.getElementById("pf-price").value           = p.price;
  document.getElementById("pf-stock").value           = p.stock;
  document.getElementById("pf-min-stock").value       = p.min_stock;
  document.getElementById("pf-barcode").value         = p.barcode || "";
  document.getElementById("product-modal").classList.remove("hidden");
}

async function saveProduct(e) {
  e.preventDefault();
  const id   = document.getElementById("product-form-id").value;
  const data = {
    name:      document.getElementById("pf-name").value,
    category:  document.getElementById("pf-category").value,
    price:     parseFloat(document.getElementById("pf-price").value),
    stock:     parseInt(document.getElementById("pf-stock").value),
    min_stock: parseInt(document.getElementById("pf-min-stock").value),
    barcode:   document.getElementById("pf-barcode").value || null,
  };
  try {
    if (id) {
      await API.updateProduct(id, data);
      showToast(`<span class="material-symbols-outlined">check_circle</span> Product updated!`, "success");
    } else {
      await API.createProduct(data);
      showToast(`<span class="material-symbols-outlined">check_circle</span> Product added!`, "success");
    }
    closeModal("product-modal");
    loadInventory();
  } catch (err) {
    showToast(`<span class="material-symbols-outlined">error</span> ${err.message}`, "error");
  }
}

async function deleteProduct(id) {
  if (!confirm("Deactivate this product?")) return;
  try {
    await API.deleteProduct(id);
    showToast(`<span class="material-symbols-outlined">info</span> Product deactivated.`, "info");
    loadInventory();
  } catch (err) {
    showToast(`<span class="material-symbols-outlined">error</span> ${err.message}`, "error");
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// ANALYTICS
// ═════════════════════════════════════════════════════════════════════════════
async function loadAnalytics() {
  try {
    const [daily, top, heatmap] = await Promise.all([
      API.getDailySales(14),
      API.getTopProducts(14),
      API.getHourlyHeatmap(),
    ]);
    renderLineChart(daily);
    renderTopChart(top);
    renderHeatmap(heatmap);
  } catch (err) {
    if (!(err instanceof API.OfflineError)) showToast(`<span class="material-symbols-outlined">error</span> ${err.message}`, "error");
  }
}

function renderLineChart(data) {
  const ctx = document.getElementById("chart-line")?.getContext("2d");
  if (!ctx) return;
  STATE.charts.line?.destroy();
  STATE.charts.line = new Chart(ctx, {
    type: "line",
    data: {
      labels:   data.map((d) => new Date(d.date).toLocaleDateString("en-PH", { month: "short", day: "numeric" })),
      datasets: [{
        label: "Revenue (₱)", data: data.map((d) => d.revenue),
        borderColor: "#d946ef", backgroundColor: "rgba(217,70,239,0.1)",
        fill: true, tension: 0.4, pointRadius: 4,
      }],
    },
    options: { responsive: true, scales: { y: { beginAtZero: true, ticks: { callback: (v) => `₱${v}` } } } },
  });
}

function renderTopChart(data) {
  const ctx = document.getElementById("chart-top")?.getContext("2d");
  if (!ctx || !data.length) return;
  STATE.charts.top?.destroy();
  STATE.charts.top = new Chart(ctx, {
    type: "horizontalBar" in Chart.controllers ? "horizontalBar" : "bar",
    data: {
      labels:   data.map((d) => d.product_name),
      datasets: [{
        label: "Units Sold", data: data.map((d) => d.total_qty),
        backgroundColor: [
          "#d946ef","#6366f1","#22c55e","#f59e0b","#ef4444",
          "#06b6d4","#84cc16","#f97316","#a855f7","#14b8a6",
        ],
        borderRadius: 4,
      }],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      plugins: { legend: { display: false } },
    },
  });
}

function renderHeatmap(data) {
  const container = document.getElementById("heatmap-grid");
  if (!container) return;
  const max = Math.max(...data.map((d) => d.sales), 1);
  container.innerHTML = data.map((d) => {
    const intensity = Math.round((d.sales / max) * 9);
    const label = d.hour === 0 ? "12am" : d.hour < 12 ? `${d.hour}am` : d.hour === 12 ? "12pm" : `${d.hour - 12}pm`;
    return `
      <div class="heatmap-cell heat-${intensity}" title="${label}: ₱${d.sales}">
        <div class="heatmap-label">${label}</div>
        <div class="heatmap-val">₱${d.sales}</div>
      </div>
    `;
  }).join("");
}

// ═════════════════════════════════════════════════════════════════════════════
// AI PREDICTIONS
// ═════════════════════════════════════════════════════════════════════════════
async function loadPredictions() {
  const container = document.getElementById("predictions-list");
  container.innerHTML = `<div class="loading"><span class="material-symbols-outlined" style="animation: spin 2s linear infinite; margin-right:8px;">smart_toy</span> Running ML model…</div>`;
  try {
    const res = await API.getPredictions();
    container.innerHTML = res.predictions.map((p) => {
      // Replace backend emojis with icons
      const recIconHtml = p.recommendation
        .replace("⚠️", `<span class="material-symbols-outlined" style="font-size:16px; vertical-align:middle; color:var(--warning);">warning</span>`)
        .replace("📦", `<span class="material-symbols-outlined" style="font-size:16px; vertical-align:middle; color:var(--info);">inventory_2</span>`)
        .replace("✅", `<span class="material-symbols-outlined" style="font-size:16px; vertical-align:middle; color:var(--success);">check_circle</span>`);

      return `
      <div class="prediction-card">
        <div class="pred-header">
          <div class="pred-product">${p.product_name}</div>
          <div class="conf-badge conf-${p.confidence}">${p.confidence.toUpperCase()}</div>
        </div>
        <div class="pred-numbers">
          <div class="pred-num">
            <div class="num-label">Current Stock</div>
            <div class="num-value">${p.current_stock}</div>
          </div>
          <div class="pred-arrow"><span class="material-symbols-outlined">arrow_forward</span></div>
          <div class="pred-num">
            <div class="num-label">Predicted Demand</div>
            <div class="num-value highlight">${p.predicted_quantity}</div>
          </div>
        </div>
        <div class="pred-recommendation" style="display:flex; align-items:flex-start; gap:6px;">${recIconHtml}</div>
      </div>
    `}).join("");
  } catch (err) {
    container.innerHTML = `<div class="error-msg" style="display:flex; align-items:center; justify-content:center; gap:8px;"><span class="material-symbols-outlined">warning</span> ${err.message}</div>`;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// AUDIT LOG
// ═════════════════════════════════════════════════════════════════════════════
async function loadAudit() {
  try {
    const logs = await API.getAuditLogs();
    const tbody = document.getElementById("audit-tbody");
    tbody.innerHTML = logs.map((l) => `
      <tr>
        <td>${new Date(l.timestamp).toLocaleString("en-PH")}</td>
        <td><span class="audit-action">${l.action}</span></td>
        <td>${l.details || "—"}</td>
        <td>${l.ip_address || "—"}</td>
      </tr>
    `).join("");
  } catch (err) {
    showToast(`<span class="material-symbols-outlined">error</span> ${err.message}`, "error");
  }
}

// ── Modal helpers ─────────────────────────────────────────────────────────────
function closeModal(id) {
  document.getElementById(id)?.classList.add("hidden");
}

// ── DOM ready ─────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  // Register Service Worker
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(console.error);
  }

  // Offline banner on load
  if (!navigator.onLine) {
    document.getElementById("offline-banner")?.classList.remove("hidden");
  }

  // Event: login form
  document.getElementById("login-form")?.addEventListener("submit", handleLogin);

  // Event: product search
  document.getElementById("pos-search")?.addEventListener("input", (e) => {
    renderProductGrid(e.target.value);
  });

  // Event: discount input updates cart total
  document.getElementById("cart-discount")?.addEventListener("input", renderCart);

  // Event: product form submit
  document.getElementById("product-form")?.addEventListener("submit", saveProduct);

  // Close modals on backdrop click
  document.querySelectorAll(".modal-backdrop").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (e.target === el) el.classList.add("hidden");
    });
  });

  // Seed button (first run)
  document.getElementById("seed-btn")?.addEventListener("click", async () => {
    const res = await API.seed().catch((e) => ({ message: e.message }));
    showToast(`<span class="material-symbols-outlined">check_circle</span> ${res.message}`, "success");
  });

  // Auto-login if token exists
  if (getToken()) {
    STATE.user = getUser();
    initApp();
  } else {
    document.getElementById("login-screen").classList.remove("hidden");
  }

  // Expose global handlers for inline onclick
  window.addToCart         = addToCart;
  window.removeFromCart    = removeFromCart;
  window.updateQty         = updateQty;
  window.checkout          = checkout;
  window.openAddProduct    = openAddProduct;
  window.openEditProduct   = openEditProduct;
  window.deleteProduct     = deleteProduct;
  window.showView          = showView;
  window.closeModal        = closeModal;
  window.handleLogout      = handleLogout;
});