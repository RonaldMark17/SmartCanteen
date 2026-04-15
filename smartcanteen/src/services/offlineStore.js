const API_CACHE_STORAGE_KEY = 'sc_api_cache_v1';
const OFFLINE_TRANSACTIONS_STORAGE_KEY = 'sc_offline_transactions_v1';
const OFFLINE_LOGIN_STORAGE_KEY = 'sc_offline_login_v1';
export const OFFLINE_QUEUE_EVENT = 'sc-offline-queue-changed';

const MAX_API_CACHE_ENTRIES = 120;

function canUseStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function readJson(key, fallback) {
  if (!canUseStorage()) {
    return fallback;
  }

  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  if (!canUseStorage()) {
    return;
  }

  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore quota and serialization failures so the app can continue online.
  }
}

function getCurrentUserNamespace() {
  if (!canUseStorage()) {
    return 'guest';
  }

  try {
    const user = JSON.parse(window.localStorage.getItem('sc_user') || '{}');
    if (user?.id) {
      return `user:${user.id}`;
    }
    if (user?.username) {
      return `user:${user.username}`;
    }
  } catch {
    // Fall through to guest cache.
  }

  return 'guest';
}

function buildGroupPath(path) {
  return String(path || '').split('?')[0];
}

function emitOfflineQueueChanged() {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(
    new CustomEvent(OFFLINE_QUEUE_EVENT, {
      detail: { count: countOfflineTransactions() },
    })
  );
}

function normalizeUsername(username) {
  return String(username || '').trim().toLowerCase();
}

async function hashOfflineCredentials(username, password) {
  if (
    typeof globalThis === 'undefined' ||
    !globalThis.crypto ||
    !globalThis.crypto.subtle ||
    typeof TextEncoder === 'undefined'
  ) {
    return null;
  }

  const normalizedUsername = normalizeUsername(username);
  const encoder = new TextEncoder();
  const source = encoder.encode(`${normalizedUsername}::${String(password || '')}`);
  const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', source);

  return Array.from(new Uint8Array(hashBuffer))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

export function buildApiCacheKeys({ method = 'GET', path }) {
  const namespace = getCurrentUserNamespace();
  const normalizedMethod = String(method || 'GET').toUpperCase();
  const normalizedPath = String(path || '');
  const groupPath = buildGroupPath(normalizedPath);

  return {
    namespace,
    cacheKey: `${namespace}:${normalizedMethod}:${normalizedPath}`,
    groupKey: `${namespace}:${normalizedMethod}:${groupPath}`,
  };
}

export function saveApiCacheEntry({ method = 'GET', path, data }) {
  const { cacheKey, groupKey, namespace } = buildApiCacheKeys({ method, path });
  const cache = readJson(API_CACHE_STORAGE_KEY, {});

  cache[cacheKey] = {
    cacheKey,
    groupKey,
    namespace,
    path,
    data,
    updatedAt: new Date().toISOString(),
  };

  const entries = Object.values(cache).sort(
    (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
  );

  const trimmedEntries = entries.slice(0, MAX_API_CACHE_ENTRIES);
  const nextCache = trimmedEntries.reduce((result, entry) => {
    result[entry.cacheKey] = entry;
    return result;
  }, {});

  writeJson(API_CACHE_STORAGE_KEY, nextCache);
}

export function getApiCacheEntry({ method = 'GET', path }) {
  const { cacheKey } = buildApiCacheKeys({ method, path });
  const cache = readJson(API_CACHE_STORAGE_KEY, {});
  return cache[cacheKey] || null;
}

export function getLatestApiCacheEntry({ method = 'GET', path }) {
  const { groupKey } = buildApiCacheKeys({ method, path });
  const cache = readJson(API_CACHE_STORAGE_KEY, {});

  return Object.values(cache)
    .filter((entry) => entry.groupKey === groupKey)
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())[0] || null;
}

export function saveOfflineTransaction(payload) {
  const queue = readJson(OFFLINE_TRANSACTIONS_STORAGE_KEY, []);
  const now = new Date().toISOString();
  const id =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `offline-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  const entry = {
    id,
    createdAt: now,
    payload: {
      ...payload,
      created_at: payload?.created_at || now,
    },
  };

  writeJson(OFFLINE_TRANSACTIONS_STORAGE_KEY, [...queue, entry]);
  emitOfflineQueueChanged();
  return entry;
}

export function getOfflineTransactions() {
  return readJson(OFFLINE_TRANSACTIONS_STORAGE_KEY, []);
}

export function removeOfflineTransactions(ids) {
  const idSet = new Set(ids);
  const queue = readJson(OFFLINE_TRANSACTIONS_STORAGE_KEY, []);
  const nextQueue = queue.filter((entry) => !idSet.has(entry.id));
  writeJson(OFFLINE_TRANSACTIONS_STORAGE_KEY, nextQueue);
  emitOfflineQueueChanged();
}

export function countOfflineTransactions() {
  return readJson(OFFLINE_TRANSACTIONS_STORAGE_KEY, []).length;
}

export async function saveOfflineLoginProfile({ user, password }) {
  const username = normalizeUsername(user?.username);
  if (!username || !password) {
    return false;
  }

  const passwordHash = await hashOfflineCredentials(username, password);
  if (!passwordHash) {
    return false;
  }

  const profiles = readJson(OFFLINE_LOGIN_STORAGE_KEY, []);
  const nextProfiles = [
    {
      username,
      passwordHash,
      user: {
        id: user?.id ?? username,
        username: user?.username || username,
        full_name: user?.full_name || user?.username || 'Offline User',
        role: user?.role || 'cashier',
      },
      savedAt: new Date().toISOString(),
    },
    ...profiles.filter((entry) => entry.username !== username),
  ].slice(0, 10);

  writeJson(OFFLINE_LOGIN_STORAGE_KEY, nextProfiles);
  return true;
}

export async function getOfflineLoginProfile(username, password) {
  const normalizedUsername = normalizeUsername(username);
  if (!normalizedUsername || !password) {
    return null;
  }

  const passwordHash = await hashOfflineCredentials(normalizedUsername, password);
  if (!passwordHash) {
    return null;
  }

  const profiles = readJson(OFFLINE_LOGIN_STORAGE_KEY, []);
  const match = profiles.find(
    (entry) => entry.username === normalizedUsername && entry.passwordHash === passwordHash
  );

  return match?.user || null;
}
