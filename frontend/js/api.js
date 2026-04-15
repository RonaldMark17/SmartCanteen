/**
 * api.js  –  SmartCanteen AI API Client
 * ──────────────────────────────────────
 * Wraps every backend call with:
 * • Bearer token injection
 * • Offline detection → throws OfflineError
 * • Consistent error messages
 */

const API_BASE = "";   // Same origin; change to "http://localhost:8000" for dev

function isAbsoluteUrl(value) {
  return /^https?:\/\//i.test(String(value || ""));
}

function isNgrokUrl(value) {
  return /\.ngrok(-free)?\.app\b|\.ngrok(-free)?\.dev\b/i.test(String(value || ""));
}

function shouldSendNgrokHeader() {
  if (isAbsoluteUrl(API_BASE) && isNgrokUrl(API_BASE)) return true;
  return typeof window !== "undefined" && isNgrokUrl(window.location.origin);
}

class OfflineError extends Error {
  constructor() { super("You are currently offline."); this.name = "OfflineError"; }
}

async function request(method, path, body = null) {
  if (!navigator.onLine) throw new OfflineError();

  const token   = localStorage.getItem("sc_token");
  const headers = {
    "Content-Type": "application/json",
    "X-SmartCanteen-Client": "web",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (shouldSendNgrokHeader()) {
    headers["ngrok-skip-browser-warning"] = "true";
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    // Token expired → force re-login
    localStorage.removeItem("sc_token");
    localStorage.removeItem("sc_user");
    window.location.reload();
    return;
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }

  return res.json();
}

const API = {
  // ── Auth ─────────────────────────────────────────────────────────────────
  login:    (username, password) => request("POST", "/api/auth/login",    { username, password }),
  me:       ()                   => request("GET",  "/api/auth/me"),
  register: (data)               => request("POST", "/api/auth/register", data),

  // ── Products ──────────────────────────────────────────────────────────────
  getProducts:   ()     => request("GET",    "/api/products"),
  getLowStock:   ()     => request("GET",    "/api/products/low-stock"),
  createProduct: (data) => request("POST",   "/api/products",      data),
  updateProduct: (id, data) => request("PUT", `/api/products/${id}`, data),
  deleteProduct: (id)   => request("DELETE", `/api/products/${id}`),

  // ── Transactions ──────────────────────────────────────────────────────────
  createTransaction:  (data) => request("POST", "/api/transactions",       data),
  getTransactions:    ()     => request("GET",  "/api/transactions"),
  syncOffline:        (data) => request("POST", "/api/transactions/sync",  data),

  // ── Analytics ─────────────────────────────────────────────────────────────
  getSummary:       ()            => request("GET", "/api/analytics/summary"),
  getDailySales:    (days = 7)    => request("GET", `/api/analytics/daily-sales?days=${days}`),
  getTopProducts:   (days = 7)    => request("GET", `/api/analytics/top-products?days=${days}`),
  getHourlyHeatmap: ()            => request("GET", "/api/analytics/hourly-heatmap"),

  // ── Predictions ───────────────────────────────────────────────────────────
  getPredictions:   () => request("GET", "/api/predictions/tomorrow"),
  getRestockAlerts: () => request("GET", "/api/predictions/restock-alerts"),

  // ── Admin ─────────────────────────────────────────────────────────────────
  getAuditLogs: () => request("GET", "/api/audit-logs"),
  seed:         () => request("POST", "/api/seed"),

  // ── Health ────────────────────────────────────────────────────────────────
  health: () => request("GET", "/api/health"),

  OfflineError,
};

window.API = API;
