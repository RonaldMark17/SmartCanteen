import { Capacitor } from '@capacitor/core';
import {
  countOfflineTransactions,
  getApiCacheEntry,
  getOfflineLoginProfile,
  getLatestApiCacheEntry,
  getOfflineTransactions,
  removeOfflineTransactions,
  saveApiCacheEntry,
  saveOfflineLoginProfile,
} from './offlineStore';

const API_ROOT_PATH = '/api';
const trimTrailingSlash = (value) => value.replace(/\/+$/, '');
const OFFLINE_SESSION_STORAGE_KEY = 'sc_offline_session';
const DEFAULT_REMOTE_API_ORIGIN = 'https://smartcanteen.duckdns.org';
const DEFAULT_REMOTE_API_BASE = `${DEFAULT_REMOTE_API_ORIGIN}${API_ROOT_PATH}`;
const DEFAULT_LOCAL_API_HOST = '127.0.0.1';
const NATIVE_API_BASE = DEFAULT_REMOTE_API_BASE;
const DEFAULT_LOCAL_API_PORT = String(import.meta.env.VITE_API_PORT || '8000').trim();

const envApiBase = import.meta.env.VITE_API_BASE_URL?.trim();
const envApiFallbackBase = import.meta.env.VITE_API_FALLBACK_BASE_URL?.trim();
const envNativeApiBase = import.meta.env.VITE_NATIVE_API_BASE_URL?.trim();
const envApiHost = import.meta.env.VITE_API_HOST?.trim();

function isAbsoluteUrl(value) {
  return /^https?:\/\//i.test(String(value || ''));
}

function isNgrokUrl(value) {
  return /\.ngrok(-free)?\.app\b|\.ngrok(-free)?\.dev\b/i.test(String(value || ''));
}

function normalizeApiBase(value) {
  const rawValue = String(value || '').trim();
  if (!rawValue) {
    return API_ROOT_PATH;
  }

  if (isAbsoluteUrl(rawValue)) {
    const url = new URL(rawValue);
    const pathname = trimTrailingSlash(url.pathname || '');

    if (!pathname || pathname === API_ROOT_PATH || pathname.startsWith(`${API_ROOT_PATH}/`)) {
      url.pathname = pathname || API_ROOT_PATH;
      return trimTrailingSlash(url.toString());
    }

    // The backend always exposes API routes from the root /api namespace.
    return `${url.origin}${API_ROOT_PATH}`;
  }

  const normalizedPath = rawValue.startsWith('/') ? rawValue : `/${rawValue}`;
  if (normalizedPath === API_ROOT_PATH || normalizedPath.startsWith(`${API_ROOT_PATH}/`)) {
    return trimTrailingSlash(normalizedPath);
  }

  return API_ROOT_PATH;
}

function isProxyRelativeApiBase(value) {
  const normalized = String(value || '').trim();
  return !normalized || normalized === API_ROOT_PATH || normalized === `${API_ROOT_PATH}/`;
}

function isLocalWebHost() {
  if (typeof window === 'undefined') {
    return false;
  }

  const hostname = window.location?.hostname;
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

function resolveLocalWebApiBase() {
  const host = envApiHost || DEFAULT_LOCAL_API_HOST;

  return normalizeApiBase(`http://${host}:${DEFAULT_LOCAL_API_PORT}${API_ROOT_PATH}`);
}

function resolveSecureWebApiBase() {
  if (typeof window === 'undefined' || window.location?.protocol !== 'https:') {
    return null;
  }

  if (envApiBase && isAbsoluteUrl(envApiBase)) {
    const configuredUrl = new URL(envApiBase);
    if (configuredUrl.protocol === 'https:') {
      return normalizeApiBase(envApiBase);
    }
  }

  return normalizeApiBase(DEFAULT_REMOTE_API_BASE);
}

export function formatLocalDateInputValue(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function resolveApiBase() {
  if (Capacitor.isNativePlatform()) {
    if (envNativeApiBase) {
      return normalizeApiBase(envNativeApiBase);
    }

    if (envApiBase && isAbsoluteUrl(envApiBase)) {
      return normalizeApiBase(envApiBase);
    }

    return normalizeApiBase(NATIVE_API_BASE);
  }

  if (isLocalWebHost()) {
    return normalizeApiBase(`${window.location.origin}${API_ROOT_PATH}`);
  }

  const secureWebApiBase = resolveSecureWebApiBase();
  if (secureWebApiBase) {
    return secureWebApiBase;
  }

  if (import.meta.env.DEV && isProxyRelativeApiBase(envApiBase)) {
    return API_ROOT_PATH;
  }

  return normalizeApiBase(envApiBase || DEFAULT_REMOTE_API_BASE);
}

function resolveFallbackApiBase(primaryBase) {
  if (Capacitor.isNativePlatform() || typeof window === 'undefined') {
    return null;
  }

  if (window.location?.protocol === 'https:') {
    return null;
  }

  const fallbackBase = envApiFallbackBase || resolveLocalWebApiBase();
  const normalizedFallbackBase = normalizeApiBase(fallbackBase);

  return normalizedFallbackBase === primaryBase ? null : normalizedFallbackBase;
}

const API_BASE = resolveApiBase();
const API_FALLBACK_BASE = resolveFallbackApiBase(API_BASE);

export function getRealtimeAlertsUrl() {
  if (typeof window === 'undefined') {
    return null;
  }

  const realtimeBase = API_FALLBACK_BASE || API_BASE || API_ROOT_PATH;
  const apiBaseUrl = new URL(realtimeBase, window.location.origin);
  apiBaseUrl.protocol = apiBaseUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  apiBaseUrl.pathname = `${trimTrailingSlash(apiBaseUrl.pathname)}/realtime/alerts`;
  apiBaseUrl.search = '';
  apiBaseUrl.hash = '';

  return apiBaseUrl.toString();
}

export class OfflineError extends Error {
  constructor(message = 'You are offline.') {
    super(message);
    this.name = 'OfflineError';
  }
}

function isOnline() {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}

function toQuery(params) {
  const query = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      query.set(key, String(value));
    }
  });

  const serialized = query.toString();
  return serialized ? `?${serialized}` : '';
}

function toAnalyticsQuery(options = 7) {
  if (typeof options === 'number') {
    return toQuery({ days: options });
  }

  return toQuery({
    days: options.days,
    start_date: options.startDate || options.start_date,
    end_date: options.endDate || options.end_date,
    limit: options.limit,
  });
}

function isCacheableRequest(method, path) {
  return (
    String(method || '').toUpperCase() === 'GET' &&
    !String(path || '').startsWith('/auth/') &&
    String(path || '') !== '/health'
  );
}

function clearSession() {
  localStorage.removeItem('sc_token');
  localStorage.removeItem('sc_user');
  localStorage.removeItem(OFFLINE_SESSION_STORAGE_KEY);
}

function isOfflineSessionToken(token) {
  return String(token || '').startsWith('offline-session:');
}

function isOfflineSessionActive() {
  return localStorage.getItem(OFFLINE_SESSION_STORAGE_KEY) === '1';
}

function isConnectivityError(error) {
  return (
    error instanceof OfflineError ||
    String(error?.message || '').includes('Cannot connect to server at')
  );
}

function looksLikeHtml(payload) {
  const text = String(payload || '').trim().toLowerCase();
  return text.startsWith('<!doctype') || text.startsWith('<html') || text.startsWith('<');
}

function buildUnexpectedResponseError(path, requestUrl, payload) {
  if (looksLikeHtml(payload)) {
    return new Error(
      `The API request "${requestUrl}" returned HTML instead of JSON. Make sure this URL is routed to the FastAPI backend, not the frontend page.`
    );
  }

  return new Error(`The API request "${requestUrl}" returned an unexpected response.`);
}

async function readJsonResponse(res, path, requestUrl = path) {
  const raw = await res.text();

  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw buildUnexpectedResponseError(path, requestUrl, raw);
  }
}

async function getCachedResponse(method, path) {
  const exactMatch = getApiCacheEntry({ method, path });
  if (exactMatch) {
    return exactMatch.data;
  }

  const latestMatch = getLatestApiCacheEntry({ method, path });
  return latestMatch?.data ?? null;
}

async function request(method, path, body = null) {
  const cacheable = isCacheableRequest(method, path);
  const token = localStorage.getItem('sc_token');
  const offlineSession = isOfflineSessionActive() || isOfflineSessionToken(token);

  if (offlineSession && !String(path || '').startsWith('/auth/')) {
    if (cacheable) {
      const cached = await getCachedResponse(method, path);
      if (cached !== null) {
        return cached;
      }
    }

    throw new OfflineError(
      cacheable
        ? 'Offline mode is active. Connect once to refresh this data.'
        : 'Offline mode is active. Reconnect to use this action.'
    );
  }

  if (!isOnline()) {
    if (cacheable) {
      const cached = await getCachedResponse(method, path);
      if (cached !== null) {
        return cached;
      }
    }

    throw new OfflineError(
      cacheable
        ? 'You are offline. Connect once so this data can be cached for offline use.'
        : 'You are offline.'
    );
  }

  const baseHeaders = {
    'Content-Type': 'application/json',
  };

  if (token && !isOfflineSessionToken(token)) {
    baseHeaders.Authorization = `Bearer ${token}`;
  }

  const apiBases = [API_BASE, API_FALLBACK_BASE].filter(Boolean);
  let lastConnectionBase = API_BASE;

  for (let index = 0; index < apiBases.length; index += 1) {
    const apiBase = apiBases[index];
    const hasFallback = index < apiBases.length - 1;
    const requestUrl = `${apiBase}${path}`;
    const headers = { ...baseHeaders };

    if (isNgrokUrl(apiBase) || (typeof window !== 'undefined' && isNgrokUrl(window.location.origin))) {
      headers['ngrok-skip-browser-warning'] = 'true';
    }

    let res;
    try {
      res = await fetch(requestUrl, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      lastConnectionBase = apiBase;
      if (hasFallback) {
        continue;
      }

      if (cacheable) {
        const cached = await getCachedResponse(method, path);
        if (cached !== null) {
          return cached;
        }
      }

      throw new Error(`Cannot connect to server at ${apiBase}. Check your backend and API config.`);
    }

    if (hasFallback && (res.status === 502 || res.status === 503 || res.status === 504)) {
      lastConnectionBase = apiBase;
      continue;
    }

    if (res.status === 401) {
      clearSession();
      window.location.href = '/';
      return null;
    }

    if (!res.ok) {
      let errMsg = `HTTP ${res.status}`;
      const errorResponse = res.clone();
      try {
        const err = await readJsonResponse(res, path, requestUrl);
        errMsg = err?.detail || err?.message || errMsg;
      } catch {
        const raw = await errorResponse.text().catch(() => '');
        if (looksLikeHtml(raw)) {
          if (hasFallback) {
            lastConnectionBase = apiBase;
            continue;
          }

          errMsg = `The API request "${requestUrl}" returned HTML instead of JSON. Make sure this URL is routed to the FastAPI backend, not the frontend page.`;
        }
      }

      if (cacheable && res.status >= 500) {
        const cached = await getCachedResponse(method, path);
        if (cached !== null) {
          return cached;
        }
      }

      if (res.status === 502 || res.status === 503 || res.status === 504) {
        errMsg = `Cannot connect to server at ${apiBase}. Check your backend and API config.`;
      }

      throw new Error(errMsg);
    }

    if (res.status === 204) {
      return null;
    }

    try {
      const payload = await readJsonResponse(res, path, requestUrl);

      if (cacheable) {
        saveApiCacheEntry({ method, path, data: payload });
      }

      return payload;
    } catch (error) {
      if (hasFallback && String(error?.message || '').includes('returned HTML instead of JSON')) {
        lastConnectionBase = apiBase;
        continue;
      }

      throw error;
    }
  }

  throw new Error(`Cannot connect to server at ${lastConnectionBase}. Check your backend and API config.`);
}

async function primeOfflineData({ role } = {}) {
  if (!isOnline()) {
    return { primed: 0, failed: 0 };
  }

  const now = new Date();
  const today = formatLocalDateInputValue(now);
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - 7);
  const yearStart = formatLocalDateInputValue(new Date(now.getFullYear(), 0, 1));

  const jobs = [
    () => request('GET', `/products${toQuery({ active_only: true })}`),
    () => request('GET', '/products/low-stock'),
    () =>
      request(
        'GET',
        `/transactions${toQuery({
          start_date: formatLocalDateInputValue(weekStart),
          end_date: today,
          skip: 0,
          limit: 200,
        })}`
      ),
    () =>
      request(
        'GET',
        `/transactions${toQuery({
          start_date: yearStart,
          end_date: today,
          skip: 0,
          limit: 2000,
        })}`
      ),
    () => request('GET', '/analytics/summary'),
    () => request('GET', `/analytics/daily-sales${toQuery({ days: 14 })}`),
    () => request('GET', `/analytics/top-products${toQuery({ days: 14 })}`),
    () => request('GET', '/analytics/hourly-heatmap'),
    () =>
      request(
        'GET',
        `/predictions/tomorrow${toQuery({
          algorithm: 'XGBoost',
          weather: 'clear',
          event: 'none',
        })}`
      ),
    () => request('GET', '/predictions/restock-alerts'),
  ];

  if (role === 'admin') {
    jobs.push(() => request('GET', '/audit-logs'));
  }

  const results = await Promise.allSettled(jobs.map((job) => job()));
  return {
    primed: results.filter((result) => result.status === 'fulfilled').length,
    failed: results.filter((result) => result.status === 'rejected').length,
  };
}

async function syncPendingOfflineTransactions() {
  if (!isOnline()) {
    return { synced: 0, queued: countOfflineTransactions(), errors: [] };
  }

  const queue = getOfflineTransactions();
  if (queue.length === 0) {
    return { synced: 0, queued: 0, errors: [] };
  }

  let synced = 0;
  const errors = [];

  for (const entry of queue) {
    try {
      const result = await request('POST', '/transactions/sync', {
        transactions: [entry.payload],
      });

      if (Number(result?.synced || 0) > 0 && (!Array.isArray(result?.errors) || result.errors.length === 0)) {
        removeOfflineTransactions([entry.id]);
        synced += Number(result.synced || 0);
      } else if (Array.isArray(result?.errors) && result.errors.length > 0) {
        errors.push(...result.errors);
      }
    } catch (error) {
      errors.push(error.message || 'Offline transaction sync failed.');
      break;
    }
  }

  return { synced, queued: countOfflineTransactions(), errors };
}

async function login(username, password) {
  try {
    const response = await request('POST', '/auth/login', { username, password });
    await saveOfflineLoginProfile({ user: response?.user, password });
    localStorage.removeItem(OFFLINE_SESSION_STORAGE_KEY);
    return response;
  } catch (error) {
    if (!isConnectivityError(error)) {
      throw error;
    }

    const offlineUser = await getOfflineLoginProfile(username, password);
    if (!offlineUser) {
      throw new Error(
        'Offline login works only after one successful online login on this device.'
      );
    }

    localStorage.setItem(OFFLINE_SESSION_STORAGE_KEY, '1');
    return {
      access_token: `offline-session:${offlineUser.username}`,
      token_type: 'offline',
      user: offlineUser,
      offline: true,
    };
  }
}

export const API = {
  login,
  me: () => request('GET', '/auth/me'),
  register: (data) => request('POST', '/auth/register', data),

  getProducts: (active_only = true) => request('GET', `/products${toQuery({ active_only })}`),
  getLowStock: () => request('GET', '/products/low-stock'),
  createProduct: (data) => request('POST', '/products', data),
  updateProduct: (id, data) => request('PUT', `/products/${id}`, data),
  deleteProduct: (id) => request('DELETE', `/products/${id}`),

  createTransaction: (data) => request('POST', '/transactions', data),
  getTransactions: (startDate = '', endDate = '', { skip = 0, limit = 100 } = {}) =>
    request(
      'GET',
      `/transactions${toQuery({
        start_date: startDate,
        end_date: endDate,
        skip,
        limit,
      })}`
    ),
  syncOffline: (data) => request('POST', '/transactions/sync', data),

  getSummary: () => request('GET', '/analytics/summary'),
  getDailySales: (options = 7) => request('GET', `/analytics/daily-sales${toAnalyticsQuery(options)}`),
  getTopProducts: (options = 7) => request('GET', `/analytics/top-products${toAnalyticsQuery(options)}`),
  getHourlyHeatmap: (options = {}) => request('GET', `/analytics/hourly-heatmap${toAnalyticsQuery(options)}`),

  getPredictions: ({ algorithm = 'XGBoost', weather = 'clear', event = 'none' } = {}) =>
    request(
      'GET',
      `/predictions/tomorrow${toQuery({
        algorithm,
        weather,
        event,
      })}`
    ),
  getRestockAlerts: () => request('GET', '/predictions/restock-alerts'),

  getAuditLogs: () => request('GET', '/audit-logs'),
  seed: () => request('POST', '/seed'),
  health: () => request('GET', '/health'),
  primeOfflineData,
  syncPendingTransactions: syncPendingOfflineTransactions,
};
