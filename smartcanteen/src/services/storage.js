const NONESSENTIAL_STORAGE_KEYS = [
  'sc_api_cache_v1',
  'sc_low_stock_signature_v2',
  'sc_high_demand_signature',
  'sc_dismissed_low_stock_alerts_v2',
  'sc_dismissed_high_demand_alerts',
  'sc_read_low_stock_alerts_v2',
  'sc_read_high_demand_alerts',
  'sc_has_unread_alerts',
  'sc_login_lockouts',
];

const LAST_RESORT_STORAGE_KEYS = [
  'sc_offline_login_v1',
  'sc_remembered_username',
];

function getStorage() {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return null;
  }

  return window.localStorage;
}

export function isQuotaExceededError(error) {
  if (!error) {
    return false;
  }

  if (
    error instanceof DOMException &&
    (
      error.code === 22 ||
      error.code === 1014 ||
      error.name === 'QuotaExceededError' ||
      error.name === 'NS_ERROR_DOM_QUOTA_REACHED'
    )
  ) {
    return true;
  }

  const message = String(error?.message || '').toLowerCase();
  return message.includes('quota') || message.includes('storage');
}

function removeKeys(storage, keys, protectedKeys = []) {
  const protectedKeySet = new Set(protectedKeys.filter(Boolean));

  keys.forEach((key) => {
    if (protectedKeySet.has(key)) {
      return;
    }

    try {
      storage.removeItem(key);
    } catch {
      // Ignore cleanup failures and keep trying other keys.
    }
  });
}

export function safeLocalStorageSetItem(
  key,
  value,
  {
    protectedKeys = [],
    cleanupPasses = [NONESSENTIAL_STORAGE_KEYS, LAST_RESORT_STORAGE_KEYS],
    quotaMessage = 'Browser storage is full. Clear site data for this app and try again.',
  } = {}
) {
  const storage = getStorage();
  if (!storage) {
    return false;
  }

  const writeValue = String(value ?? '');

  try {
    storage.setItem(key, writeValue);
    return true;
  } catch (error) {
    if (!isQuotaExceededError(error)) {
      throw error;
    }
  }

  for (const cleanupKeys of cleanupPasses) {
    removeKeys(storage, cleanupKeys, [key, ...protectedKeys]);

    try {
      storage.setItem(key, writeValue);
      return true;
    } catch (error) {
      if (!isQuotaExceededError(error)) {
        throw error;
      }
    }
  }

  throw new Error(quotaMessage);
}

export function safeLocalStorageSetJson(key, value, options = {}) {
  return safeLocalStorageSetItem(key, JSON.stringify(value), options);
}
