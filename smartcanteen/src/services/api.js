import { Capacitor } from '@capacitor/core';
import {
  countOfflineFinancialMutations,
  countOfflineTransactions,
  countPendingOfflineChanges,
  getApiCacheEntry,
  getLatestApiCacheEntry,
  getOfflineFinancialMutations,
  getOfflineTransactions,
  removeOfflineFinancialMutations,
  removeOfflineTransactions,
  saveApiCacheEntry,
  saveOfflineFinancialMutation,
  saveOfflineLoginProfile,
} from './offlineStore';
import { safeLocalStorageSetItem, safeLocalStorageSetJson } from './storage';

const API_ROOT_PATH = '/api';
const trimTrailingSlash = (value) => value.replace(/\/+$/, '');
const OFFLINE_SESSION_STORAGE_KEY = 'sc_offline_session';
const TRUSTED_DEVICE_STORAGE_KEY = 'sc_trusted_authenticator_devices';
const BACKGROUND_ALERT_STORAGE_KEY = 'sc_background_alert_token';
const DEFAULT_REMOTE_API_ORIGIN = 'https://smartcanteen.duckdns.org';
const DEFAULT_REMOTE_API_BASE = `${DEFAULT_REMOTE_API_ORIGIN}${API_ROOT_PATH}`;
const DEFAULT_LOCAL_API_HOST = '127.0.0.1';
const NATIVE_API_BASE = DEFAULT_REMOTE_API_BASE;
const DEFAULT_LOCAL_API_PORT = String(import.meta.env.VITE_API_PORT || '8000').trim();
const envApiTimeoutMs = Number(import.meta.env.VITE_API_TIMEOUT_MS || '');
const API_REQUEST_TIMEOUT_MS =
  Number.isFinite(envApiTimeoutMs) && envApiTimeoutMs > 0 ? envApiTimeoutMs : 20000;

const envApiBase = import.meta.env.VITE_API_BASE_URL?.trim();
const envApiFallbackBase = import.meta.env.VITE_API_FALLBACK_BASE_URL?.trim();
const envNativeApiBase = import.meta.env.VITE_NATIVE_API_BASE_URL?.trim();
const envApiHost = import.meta.env.VITE_API_HOST?.trim();

function isAbsoluteUrl(value) {
  return /^https?:\/\//i.test(String(value || ''));
}

function getRuntimePlatform() {
  try {
    const platform = Capacitor.getPlatform?.();
    if (platform) {
      return String(platform).toLowerCase();
    }
  } catch {
    // Fall through to the browser bridge check.
  }

  try {
    const platform = typeof window !== 'undefined' ? window.Capacitor?.getPlatform?.() : '';
    if (platform) {
      return String(platform).toLowerCase();
    }
  } catch {
    // Fall through to web.
  }

  return 'web';
}

function isNativeRuntime() {
  const platform = getRuntimePlatform();
  if (platform === 'android' || platform === 'ios') {
    return true;
  }

  try {
    if (Capacitor.isNativePlatform?.()) {
      return true;
    }
  } catch {
    // Fall through to browser checks.
  }

  if (typeof window === 'undefined') {
    return false;
  }

  try {
    if (window.Capacitor?.isNativePlatform?.()) {
      return true;
    }
  } catch {
    // Fall through to protocol checks.
  }

  const protocol = window.location?.protocol;
  return protocol === 'capacitor:' || protocol === 'ionic:';
}

function isMobileDevice() {
  const platform = getRuntimePlatform();
  if (platform === 'android' || platform === 'ios') {
    return true;
  }

  if (typeof navigator === 'undefined') {
    return false;
  }

  const userAgent = navigator.userAgent || '';
  return /android|iphone|ipad|ipod|mobile/i.test(userAgent);
}

function getDeviceClass() {
  return isMobileDevice() ? 'mobile' : 'desktop';
}

function normalizeTrustedDeviceUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function readTrustedDeviceMap() {
  try {
    const parsed = JSON.parse(localStorage.getItem(TRUSTED_DEVICE_STORAGE_KEY) || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }

    return parsed;
  } catch {
    return {};
  }
}

function writeTrustedDeviceMap(devices) {
  try {
    safeLocalStorageSetJson(TRUSTED_DEVICE_STORAGE_KEY, devices);
  } catch {
    // Remembered device storage is optional; keep login usable if storage is tight.
  }
}

function clearTrustedDeviceToken(username) {
  const normalizedUsername = normalizeTrustedDeviceUsername(username);
  if (!normalizedUsername) {
    return;
  }

  const devices = readTrustedDeviceMap();
  if (devices[normalizedUsername]) {
    delete devices[normalizedUsername];
    writeTrustedDeviceMap(devices);
  }
}

function getTrustedDeviceToken(username) {
  const normalizedUsername = normalizeTrustedDeviceUsername(username);
  if (!normalizedUsername) {
    return '';
  }

  const devices = readTrustedDeviceMap();
  const record = devices[normalizedUsername];
  if (!record?.token) {
    return '';
  }

  const expiresAt = Date.parse(record.expiresAt || '');
  if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
    delete devices[normalizedUsername];
    writeTrustedDeviceMap(devices);
    return '';
  }

  return record.token;
}

function saveTrustedDeviceToken(username, response) {
  const normalizedUsername = normalizeTrustedDeviceUsername(username || response?.user?.username);
  const token = String(response?.remember_device_token || '').trim();
  if (!normalizedUsername || !token) {
    return;
  }

  const devices = readTrustedDeviceMap();
  devices[normalizedUsername] = {
    token,
    expiresAt: response?.remember_device_expires_at || '',
    savedAt: new Date().toISOString(),
  };
  writeTrustedDeviceMap(devices);
}

function isLoopbackHostname(hostname) {
  const value = String(hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  return value === 'localhost' || value === '127.0.0.1' || value === '::1' || value === '0.0.0.0';
}

function isLoopbackApiBase(value) {
  if (!isAbsoluteUrl(value)) {
    return false;
  }

  try {
    return isLoopbackHostname(new URL(value).hostname);
  } catch {
    return false;
  }
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

function isDefaultProductionWebHost() {
  if (typeof window === 'undefined') {
    return false;
  }

  return window.location?.origin === DEFAULT_REMOTE_API_ORIGIN;
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
  if (isNativeRuntime()) {
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

  if (isDefaultProductionWebHost()) {
    return API_ROOT_PATH;
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
  if (isNativeRuntime()) {
    const nativeFallbackCandidates = [
      envApiFallbackBase,
      envApiBase && isAbsoluteUrl(envApiBase) ? envApiBase : null,
      DEFAULT_REMOTE_API_BASE,
    ]
      .filter(Boolean)
      .map(normalizeApiBase)
      .filter((base, index, bases) => bases.indexOf(base) === index)
      .filter((base) => base !== primaryBase && !isLoopbackApiBase(base));

    return nativeFallbackCandidates[0] || null;
  }

  if (typeof window === 'undefined') {
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
const pendingGetRequests = new Map();

export function getCurrentApiBase() {
  return API_BASE;
}

export function getRealtimeAlertsUrl() {
  if (typeof window === 'undefined') {
    return null;
  }

  const realtimeBase = API_BASE || API_FALLBACK_BASE || API_ROOT_PATH;
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
    !String(path || '').startsWith('/alert-state') &&
    String(path || '') !== '/health'
  );
}

function isOfflineQueueableFinancialMutation(method, path) {
  const normalizedMethod = String(method || '').toUpperCase();
  const normalizedPath = String(path || '');

  return (
    normalizedMethod === 'PUT' &&
    /^\/financial-reports\/reports\/\d+(?:\/expenses|\/fund-monitoring)?$/.test(normalizedPath)
  );
}

function queueOfflineFinancialMutation(method, path, body) {
  saveOfflineFinancialMutation({ method, path, body });
  return {
    offline_queued: true,
    message: 'Saved on this device and queued for synchronization.',
  };
}

function canUseLatestCacheFallback(path) {
  const normalizedPath = String(path || '');
  const isDateFilteredAnalytics =
    normalizedPath.startsWith('/analytics/') &&
    (normalizedPath.includes('start_date=') || normalizedPath.includes('end_date='));

  return !isDateFilteredAnalytics;
}

function isLoginFlowPath(path) {
  const normalizedPath = String(path || '');
  return (
    normalizedPath.startsWith('/auth/login') ||
    normalizedPath.startsWith('/auth/authenticator/verify')
  );
}

function clearSession() {
  localStorage.removeItem('sc_token');
  localStorage.removeItem('sc_user');
  localStorage.removeItem(BACKGROUND_ALERT_STORAGE_KEY);
  localStorage.removeItem(OFFLINE_SESSION_STORAGE_KEY);
}

function assertMfaWasCompleted(response) {
  if (!response?.access_token) {
    throw new Error('MFA verification did not complete. Try signing in again.');
  }

  const authenticatorVerified = Boolean(response?.authenticator_mfa_verified);

  if (
    response?.mobile_password_fallback ||
    !authenticatorVerified
  ) {
    throw new Error('Authenticator app verification is required before opening the dashboard.');
  }
}

function isOfflineSessionToken(token) {
  return String(token || '').startsWith('offline-session:');
}

function isOfflineSessionActive() {
  return localStorage.getItem(OFFLINE_SESSION_STORAGE_KEY) === '1';
}

function isConnectivityError(error) {
  const message = String(error?.message || '');
  return (
    error instanceof OfflineError ||
    message.includes('Cannot connect to server at') ||
    message.includes('Server did not respond at')
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

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function extractApiErrorMessage(value) {
  if (!value) {
    return '';
  }

  if (typeof value === 'string') {
    return value === '[object Object]' ? '' : value;
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => extractApiErrorMessage(item))
      .filter(Boolean)
      .join('; ');
  }

  if (typeof value === 'object') {
    return (
      extractApiErrorMessage(value.message) ||
      extractApiErrorMessage(value.detail) ||
      extractApiErrorMessage(value.msg)
    );
  }

  return '';
}

function buildApiError(payload, fallbackMessage, status, headers) {
  const detail = payload?.detail;
  const structuredDetail =
    detail && typeof detail === 'object' && !Array.isArray(detail) ? detail : null;
  const validationMessages = Array.isArray(detail)
    ? detail.map((item) => item?.msg).filter(Boolean).join('; ')
    : '';
  const message =
    extractApiErrorMessage(structuredDetail) ||
    extractApiErrorMessage(detail) ||
    validationMessages ||
    extractApiErrorMessage(payload?.message) ||
    fallbackMessage;
  const error = new Error(message || fallbackMessage);
  error.status = status;

  if (structuredDetail) {
    const retryAfterSeconds =
      toFiniteNumber(structuredDetail.retry_after_seconds) ??
      toFiniteNumber(headers?.get?.('retry-after'));
    const remainingAttempts = toFiniteNumber(structuredDetail.remaining_attempts);

    error.apiDetail = structuredDetail;
    error.apiCode = structuredDetail.code || '';
    error.alertTitle = structuredDetail.title || '';
    error.locked = Boolean(structuredDetail.locked);
    error.lockSeconds = toFiniteNumber(structuredDetail.lock_seconds);
    error.lockedUntil = structuredDetail.locked_until || '';
    error.remainingAttempts = remainingAttempts;
    error.retryAfterSeconds = retryAfterSeconds;
  }

  return error;
}

function getClientRequestHeaders() {
  const platform = getRuntimePlatform();
  const nativeRuntime = isNativeRuntime();

  return {
    'X-SmartCanteen-Client': nativeRuntime ? 'native' : 'web',
    'X-SmartCanteen-Platform': platform,
    'X-SmartCanteen-Device-Class': getDeviceClass(),
  };
}

function getAuthorizedRequestHeaders() {
  const headers = {
    ...getClientRequestHeaders(),
  };
  const token = localStorage.getItem('sc_token');

  if (token && !isOfflineSessionToken(token)) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

async function fetchWithTimeout(requestUrl, options = {}) {
  if (typeof AbortController === 'undefined' || API_REQUEST_TIMEOUT_MS <= 0) {
    return fetch(requestUrl, options);
  }

  const controller = new AbortController();
  const setTimer = typeof window !== 'undefined' ? window.setTimeout.bind(window) : setTimeout;
  const clearTimer = typeof window !== 'undefined' ? window.clearTimeout.bind(window) : clearTimeout;
  const timeoutId = setTimer(() => controller.abort(), API_REQUEST_TIMEOUT_MS);

  try {
    return await fetch(requestUrl, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimer(timeoutId);
  }
}

function extractFilenameFromDisposition(value, fallback = 'download') {
  const header = String(value || '');
  const utf8Match = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }

  const quotedMatch = header.match(/filename="([^"]+)"/i);
  if (quotedMatch?.[1]) {
    return quotedMatch[1];
  }

  const plainMatch = header.match(/filename=([^;]+)/i);
  if (plainMatch?.[1]) {
    return plainMatch[1].trim();
  }

  return fallback;
}

function buildConnectionError(apiBase, error) {
  if (error?.name === 'AbortError') {
    return new Error(
      `Server did not respond at ${apiBase} within ${Math.round(API_REQUEST_TIMEOUT_MS / 1000)}s. Check your backend and API config.`
    );
  }

  return new Error(`Cannot connect to server at ${apiBase}. Check your backend and API config.`);
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

  if (!canUseLatestCacheFallback(path)) {
    return null;
  }

  const latestMatch = getLatestApiCacheEntry({ method, path });
  return latestMatch?.data ?? null;
}

async function performRequest(method, path, body = null, options = {}) {
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

    if (isOfflineQueueableFinancialMutation(method, path)) {
      return queueOfflineFinancialMutation(method, path, body);
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

    if (isOfflineQueueableFinancialMutation(method, path)) {
      return queueOfflineFinancialMutation(method, path, body);
    }

    throw new OfflineError(
      cacheable
        ? 'You are offline. Connect once so this data can be cached for offline use.'
        : 'You are offline.'
    );
  }

  const baseHeaders = {
    'Content-Type': 'application/json',
    ...getClientRequestHeaders(),
  };

  if (token && !isOfflineSessionToken(token)) {
    baseHeaders.Authorization = `Bearer ${token}`;
  }

  if (options.headers && typeof options.headers === 'object') {
    Object.assign(baseHeaders, options.headers);
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
      res = await fetchWithTimeout(requestUrl, {
        method,
        credentials: 'include',
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (error) {
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

      if (isOfflineQueueableFinancialMutation(method, path)) {
        return queueOfflineFinancialMutation(method, path, body);
      }

      throw buildConnectionError(apiBase, error);
    }

    if (hasFallback && (res.status === 502 || res.status === 503 || res.status === 504)) {
      lastConnectionBase = apiBase;
      continue;
    }

    if (res.status === 401 && !isLoginFlowPath(path)) {
      clearSession();
      window.location.href = '/';
      return null;
    }

    if (!res.ok) {
      let errMsg = `HTTP ${res.status}`;
      let apiError = null;
      const errorResponse = res.clone();
      try {
        const err = await readJsonResponse(res, path, requestUrl);
        apiError = buildApiError(err, errMsg, res.status, res.headers);
        errMsg = apiError.message;
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
        apiError = null;
      }

      if (apiError) {
        throw apiError;
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

function buildPendingGetKey(method, path) {
  const token = localStorage.getItem('sc_token') || '';
  return `${String(method || '').toUpperCase()} ${path} ${token}`;
}

function request(method, path, body = null, options = {}) {
  const canShareInFlightRequest =
    isCacheableRequest(method, path) &&
    !options.headers &&
    !isOfflineSessionActive() &&
    isOnline();

  if (!canShareInFlightRequest) {
    return performRequest(method, path, body, options);
  }

  const pendingKey = buildPendingGetKey(method, path);
  const pendingRequest = pendingGetRequests.get(pendingKey);
  if (pendingRequest) {
    return pendingRequest;
  }

  const requestPromise = performRequest(method, path, body).finally(() => {
    pendingGetRequests.delete(pendingKey);
  });
  pendingGetRequests.set(pendingKey, requestPromise);
  return requestPromise;
}

async function requestFile(path) {
  const token = localStorage.getItem('sc_token');
  const offlineSession = isOfflineSessionActive() || isOfflineSessionToken(token);

  if (offlineSession) {
    throw new OfflineError('Offline mode is active. Reconnect to download this file.');
  }

  if (!isOnline()) {
    throw new OfflineError('You are offline.');
  }

  const apiBases = [API_BASE, API_FALLBACK_BASE].filter(Boolean);
  let lastConnectionBase = API_BASE;

  for (let index = 0; index < apiBases.length; index += 1) {
    const apiBase = apiBases[index];
    const hasFallback = index < apiBases.length - 1;
    const requestUrl = `${apiBase}${path}`;
    const headers = getAuthorizedRequestHeaders();

    if (isNgrokUrl(apiBase) || (typeof window !== 'undefined' && isNgrokUrl(window.location.origin))) {
      headers['ngrok-skip-browser-warning'] = 'true';
    }

    let res;
    try {
      res = await fetchWithTimeout(requestUrl, {
        method: 'GET',
        credentials: 'include',
        headers,
      });
    } catch (error) {
      lastConnectionBase = apiBase;
      if (hasFallback) {
        continue;
      }

      throw buildConnectionError(apiBase, error);
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
      const raw = await res.text().catch(() => '');
      if (looksLikeHtml(raw) && hasFallback) {
        lastConnectionBase = apiBase;
        continue;
      }

      try {
        const parsed = raw ? JSON.parse(raw) : null;
        errMsg = parsed?.detail || parsed?.message || errMsg;
      } catch {
        if (raw) {
          errMsg = raw;
        }
      }

      if (res.status === 502 || res.status === 503 || res.status === 504) {
        errMsg = `Cannot connect to server at ${apiBase}. Check your backend and API config.`;
      }

      throw new Error(errMsg);
    }

    const blob = await res.blob();
    return {
      blob,
      filename: extractFilenameFromDisposition(
        res.headers.get('content-disposition'),
        path.split('/').filter(Boolean).pop() || 'download'
      ),
    };
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
          weather: 'clear',
          event: 'none',
        })}`
      ),
  ];

  if (role === 'admin' || role === 'staff') {
    jobs.push(async () => {
      const schoolYears = await request('GET', '/financial-reports/school-years');
      const availableSchoolYears = Array.isArray(schoolYears) ? schoolYears : [];
      await Promise.all(
        availableSchoolYears.map((schoolYear) =>
          request('GET', `/financial-reports/school-years/${schoolYear.id}`)
        )
      );
      return availableSchoolYears.length;
    });
  }

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

async function syncPendingOfflineFinancialMutations() {
  if (!isOnline()) {
    return {
      synced: 0,
      queued: countOfflineFinancialMutations(),
      errors: [],
    };
  }

  const queue = getOfflineFinancialMutations();
  if (queue.length === 0) {
    return { synced: 0, queued: 0, errors: [] };
  }

  let synced = 0;
  const errors = [];

  for (const entry of queue) {
    try {
      const result = await performRequest(entry.method, entry.path, entry.body);
      if (result === null || result?.offline_queued) {
        break;
      }
      removeOfflineFinancialMutations([entry.id]);
      synced += 1;
    } catch (error) {
      errors.push(error.message || 'Offline financial report sync failed.');
      break;
    }
  }

  return {
    synced,
    queued: countOfflineFinancialMutations(),
    errors,
  };
}

async function syncPendingOfflineChanges() {
  const transactionResult = await syncPendingOfflineTransactions();
  const financialResult = await syncPendingOfflineFinancialMutations();

  return {
    synced: transactionResult.synced + financialResult.synced,
    queued: countPendingOfflineChanges(),
    transactionSynced: transactionResult.synced,
    financialSynced: financialResult.synced,
    errors: [...transactionResult.errors, ...financialResult.errors],
  };
}

async function completeAuthenticatedLoginResponse(response, password, { rememberDevice = false, username = '' } = {}) {
  assertMfaWasCompleted(response);

  if (response?.background_alert_token) {
    try {
      safeLocalStorageSetItem(BACKGROUND_ALERT_STORAGE_KEY, response.background_alert_token);
    } catch {
      // Background alert storage is optional and should not block login.
    }
  }

  if (rememberDevice) {
    saveTrustedDeviceToken(username, response);
  } else {
    clearTrustedDeviceToken(username || response?.user?.username);
  }

  if (password && response?.user) {
    await saveOfflineLoginProfile({ user: response.user, password });
  }

  localStorage.removeItem(OFFLINE_SESSION_STORAGE_KEY);
  return response;
}

async function login(username, password, { rememberDevice = false } = {}) {
  try {
    const body = { username, password };
    if (rememberDevice) {
      const rememberDeviceToken = getTrustedDeviceToken(username);
      if (rememberDeviceToken) {
        body.remember_device_token = rememberDeviceToken;
      }
    } else {
      clearTrustedDeviceToken(username);
    }

    const response = await request('POST', '/auth/login', body);

    if (
      response?.mfa_required &&
      (response?.mfa_type === 'authenticator' || response?.mfa_type === 'authenticator_setup')
    ) {
      return response;
    }

    if (response?.access_token) {
      return completeAuthenticatedLoginResponse(response, password, { rememberDevice, username });
    }

    throw new Error('Authenticator app verification is required before opening the dashboard.');
  } catch (error) {
    if (!isConnectivityError(error)) {
      throw error;
    }

    throw new Error('Authenticator app verification requires an online connection.');
  }
}

async function verifyAuthenticatorLogin(
  mfaToken,
  code,
  password,
  { rememberDevice = false, username = '' } = {}
) {
  const normalizedMfaToken = String(mfaToken || '').trim();
  if (!normalizedMfaToken) {
    throw new Error('Verification session expired. Please sign in again.');
  }

  const response = await request('POST', '/auth/authenticator/verify', {
    username,
    mfa_token: normalizedMfaToken,
    code,
    remember_device: rememberDevice,
  }, {
    headers: {
      Authorization: `Bearer ${normalizedMfaToken}`,
    },
  });
  return completeAuthenticatedLoginResponse(response, password, { rememberDevice, username });
}

export const API = {
  login,
  verifyAuthenticatorLogin,
  me: () => request('GET', '/auth/me'),
  register: (data) => request('POST', '/auth/register', data),
  requestPasswordReset: (usernameOrEmail) => request('POST', '/auth/password-reset/request', { usernameOrEmail }),
  checkPasswordResetStatus: (usernameOrEmail) =>
    request('POST', '/auth/password-reset/status', { usernameOrEmail }),
  appealPasswordReset: ({ usernameOrEmail, identifier, reason, appeal_reason }) =>
    request('POST', '/auth/password-reset/appeal', {
      usernameOrEmail: usernameOrEmail || identifier,
      reason: reason || appeal_reason,
    }),
  completePasswordReset: (data) => request('POST', '/auth/password-reset/complete', data),
  requestAuthenticatorRecovery: ({ usernameOrEmail, identifier, reason }) =>
    request('POST', '/auth/authenticator-recovery/request', {
      usernameOrEmail: usernameOrEmail || identifier,
      reason,
    }),
  checkAuthenticatorRecoveryStatus: (usernameOrEmail) =>
    request('POST', '/auth/authenticator-recovery/status', { usernameOrEmail }),
  appealAuthenticatorRecovery: ({ usernameOrEmail, identifier, reason, appeal_reason }) =>
    request('POST', '/auth/authenticator-recovery/appeal', {
      usernameOrEmail: usernameOrEmail || identifier,
      reason: reason || appeal_reason,
    }),
  startAuthenticatorRecoverySetup: (usernameOrEmail) =>
    request('POST', '/auth/authenticator-recovery/setup', { usernameOrEmail }),
  getAccountNotices: () => request('GET', '/account/notices'),
  regenerateRecoveryCodes: () => request('POST', '/auth/recovery-codes/regenerate'),
  getAdminUsers: () => request('GET', '/admin/users'),
  getPasswordResetRequests: (status = 'all') =>
    request('GET', `/admin/password-reset-requests${toQuery({ status })}`),
  approvePasswordResetRequest: (requestId, data = {}) =>
    request('POST', `/admin/password-reset-requests/${requestId}/approve`, data),
  denyPasswordResetRequest: (requestId, data = {}) =>
    request('POST', `/admin/password-reset-requests/${requestId}/deny`, data),
  approvePasswordResetAppeal: (requestId, data = {}) =>
    request('POST', `/admin/password-reset-requests/${requestId}/appeal/approve`, data),
  denyPasswordResetAppeal: (requestId, data = {}) =>
    request('POST', `/admin/password-reset-requests/${requestId}/appeal/deny`, data),
  getAuthenticatorRecoveryRequests: (status = 'all') =>
    request('GET', `/admin/authenticator-recovery-requests${toQuery({ status })}`),
  approveAuthenticatorRecoveryRequest: (requestId, data = {}) =>
    request('POST', `/admin/authenticator-recovery-requests/${requestId}/approve`, data),
  denyAuthenticatorRecoveryRequest: (requestId, data = {}) =>
    request('POST', `/admin/authenticator-recovery-requests/${requestId}/deny`, data),
  approveAuthenticatorRecoveryAppeal: (requestId, data = {}) =>
    request('POST', `/admin/authenticator-recovery-requests/${requestId}/appeal/approve`, data),
  denyAuthenticatorRecoveryAppeal: (requestId, data = {}) =>
    request('POST', `/admin/authenticator-recovery-requests/${requestId}/appeal/deny`, data),
  createAdminUser: (data) => request('POST', '/admin/users', data),
  updateAdminUser: (userId, data) => request('PUT', `/admin/users/${userId}`, data),
  deleteAdminUser: (userId) => request('DELETE', `/admin/users/${userId}`),
  resetUserAuthenticator: (userId, data = {}) =>
    request('POST', `/admin/users/${userId}/authenticator/reset`, {
      revoke_remembered_devices: data.revoke_remembered_devices !== false,
    }),

  getProducts: (active_only = true) => request('GET', `/products${toQuery({ active_only })}`),
  getQuickSaleProducts: () => request('GET', '/products/quick-sale'),
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
  getCategorySales: (options = 7) => request('GET', `/analytics/category-sales${toAnalyticsQuery(options)}`),
  getPaymentSummary: (options = 7) => request('GET', `/analytics/payment-summary${toAnalyticsQuery(options)}`),
  getHourlyHeatmap: (options = {}) => request('GET', `/analytics/hourly-heatmap${toAnalyticsQuery(options)}`),

  getPredictions: ({ weather = 'clear', event = 'none' } = {}) =>
    request(
      'GET',
      `/predictions/tomorrow${toQuery({
        weather,
        event,
      })}`
    ),
  getRestockAlerts: () => request('GET', '/predictions/restock-alerts'),
  getAlertState: () => request('GET', '/alert-state'),
  updateAlertState: ({ alert_type, state, signatures }) =>
    request('POST', '/alert-state', { alert_type, state, signatures }),

  getAuditLogs: () => request('GET', '/audit-logs'),
  getFinancialSchoolYears: () => request('GET', '/financial-reports/school-years'),
  createFinancialSchoolYear: (data) => request('POST', '/financial-reports/school-years', data),
  deleteFinancialSchoolYear: (schoolYearId) => request('DELETE', `/financial-reports/school-years/${schoolYearId}`),
  getFinancialSchoolYearDetail: (schoolYearId) => request('GET', `/financial-reports/school-years/${schoolYearId}`),
  cacheFinancialSchoolYearDetail: (schoolYearId, data) =>
    saveApiCacheEntry({
      method: 'GET',
      path: `/financial-reports/school-years/${schoolYearId}`,
      data,
    }),
  updateFinancialReport: (reportId, data) => request('PUT', `/financial-reports/reports/${reportId}`, data),
  updateFinancialReportExpenses: (reportId, expenses) =>
    request('PUT', `/financial-reports/reports/${reportId}/expenses`, { expenses }),
  updateFinancialFundMonitoring: (reportId, entries) =>
    request('PUT', `/financial-reports/reports/${reportId}/fund-monitoring`, { entries }),
  updateFinancialAllocations: (schoolYearId, allocations) =>
    request('PUT', `/financial-reports/school-years/${schoolYearId}/allocations`, { allocations }),
  downloadFinancialReportTemplate: () => requestFile('/financial-reports/template'),
  downloadFinancialSchoolYearWorkbook: (schoolYearId, reportId = null) =>
    requestFile(
      `/financial-reports/school-years/${schoolYearId}/export${toQuery({ report_id: reportId })}`
    ),
  backupFinancialDatabase: () => request('POST', '/financial-reports/backup'),
  seed: () => request('POST', '/seed'),
  health: () => request('GET', '/health'),
  primeOfflineData,
  syncPendingTransactions: syncPendingOfflineTransactions,
  syncPendingChanges: syncPendingOfflineChanges,
};
