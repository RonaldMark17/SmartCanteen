/**
 * secureStorage.js - SmartCanteen / MEALS Storage Encryption & Key Obfuscation Layer
 *
 * Transparently encrypts sensitive values and obfuscates sensitive key names
 * in window.localStorage and window.sessionStorage so that inspecting
 * DevTools (Application -> Local Storage) never reveals sensitive keys
 * (e.g. sc_token, sc_trusted_authenticator_devices, sc_user, sc_offline_login_v1)
 * or plaintext credentials/tokens.
 */

const SENSITIVE_KEY_SET = new Set([
  'sc_token',
  'sc_refresh_token',
  'sc_background_alert_token',
  'sc_trusted_authenticator_devices',
  'sc_trusted_authenticator_device',
  'sc_offline_login_v1',
  'sc_offline_session',
  'sc_user',
  'sc_remembered_username',
  'sc_remember_me',
  'sc_two_factor_verified',
  'sc_session_active',
  'sc_device_id',
  'sc_login_lockouts',
  'sc_offline_transactions_v1',
  'sc_offline_financial_mutations_v1',
  'sc_api_cache_v1',
  'sc_mfa_challenge',
  'sc_pending_authenticator_challenge',
]);

const MASTER_SALT = 'MEALS_SECURE_VAULT_SPCC_4WMAD1_2026';
const CIPHER_PREFIX = '_sec_v1:';
const HASHED_KEY_PREFIX = '_sc_sec_';

/**
 * Check if a given key is deemed sensitive and should be protected.
 */
export function isSensitiveKey(key) {
  if (typeof key !== 'string') return false;
  if (key.startsWith(HASHED_KEY_PREFIX)) return false;
  if (SENSITIVE_KEY_SET.has(key)) return true;
  if (key.startsWith('sc_rcpt_')) return true;

  const lower = key.toLowerCase();
  return (
    lower.includes('token') ||
    lower.includes('secret') ||
    lower.includes('credential') ||
    lower.includes('password') ||
    lower.includes('auth') ||
    lower.includes('offline_login') ||
    lower.includes('trusted_device')
  );
}

/**
 * Deterministically hashes a key name to an opaque identifier.
 */
export function hashKey(key) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  const str = `${MASTER_SALT}:${key}`;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const p1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const p2 = (h2 >>> 0).toString(16).padStart(8, '0');
  return `${HASHED_KEY_PREFIX}${p1}${p2}`;
}

function rc4Drop(keyBytes, dataBytes) {
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i++) s[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + s[i] + keyBytes[i % keyBytes.length]) & 255;
    const t = s[i];
    s[i] = s[j];
    s[j] = t;
  }
  let i = 0;
  j = 0;
  for (let k = 0; k < 1536; k++) {
    i = (i + 1) & 255;
    j = (j + s[i]) & 255;
    const t = s[i];
    s[i] = s[j];
    s[j] = t;
  }
  const out = new Uint8Array(dataBytes.length);
  for (let k = 0; k < dataBytes.length; k++) {
    i = (i + 1) & 255;
    j = (j + s[i]) & 255;
    const t = s[i];
    s[i] = s[j];
    s[j] = t;
    out[k] = dataBytes[k] ^ s[(s[i] + s[j]) & 255];
  }
  return out;
}

function getRandomIv() {
  let iv = '';
  for (let i = 0; i < 8; i++) {
    iv += Math.floor(Math.random() * 256).toString(16).padStart(2, '0');
  }
  return iv;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function encryptValue(key, val) {
  if (val === null || val === undefined) return val;
  const iv = getRandomIv();
  const kBytes = encoder.encode(`${MASTER_SALT}:${key}:${iv}`);
  const dBytes = encoder.encode(String(val));
  const cBytes = rc4Drop(kBytes, dBytes);
  let bin = '';
  for (let i = 0; i < cBytes.length; i++) {
    bin += String.fromCharCode(cBytes[i]);
  }
  return `${CIPHER_PREFIX}${iv}:${btoa(bin)}`;
}

export function decryptValue(key, cipher) {
  if (!cipher || typeof cipher !== 'string' || !cipher.startsWith(CIPHER_PREFIX)) {
    return cipher;
  }
  const parts = cipher.split(':');
  if (parts.length !== 3) {
    return cipher;
  }
  const iv = parts[1];
  const b64 = parts[2];
  try {
    const kBytes = encoder.encode(`${MASTER_SALT}:${key}:${iv}`);
    const bin = atob(b64);
    const cBytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      cBytes[i] = bin.charCodeAt(i);
    }
    const dBytes = rc4Drop(kBytes, cBytes);
    return decoder.decode(dBytes);
  } catch {
    return cipher;
  }
}

const reverseKeyMap = new Map();

/**
 * Register a sensitive key so reverse mapping and events recognize it.
 */
function registerKeyMapping(rawKey) {
  const hashed = hashKey(rawKey);
  reverseKeyMap.set(hashed, rawKey);
  return hashed;
}

// Prepopulate reverse mapping for all known keys
SENSITIVE_KEY_SET.forEach((k) => registerKeyMapping(k));

/**
 * Migrates any plaintext sensitive entries in a Storage instance to encrypted hashed entries.
 */
function migrateExistingKeys(storage, nativeGetItem, nativeSetItem, nativeRemoveItem) {
  if (!storage || typeof storage.length !== 'number') return;
  try {
    const keysToCheck = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && isSensitiveKey(k)) {
        keysToCheck.push(k);
      }
    }

    keysToCheck.forEach((rawKey) => {
      try {
        const rawVal = nativeGetItem.call(storage, rawKey);
        if (rawVal !== null && !rawVal.startsWith(CIPHER_PREFIX)) {
          const hashed = registerKeyMapping(rawKey);
          const encVal = encryptValue(rawKey, rawVal);
          // Set hashed encrypted item, and remove only the raw plaintext item
          nativeSetItem.call(storage, hashed, encVal);
          nativeRemoveItem.call(storage, rawKey);
        }
      } catch (err) {
        console.warn('[SecureStorage] Key migration warning for', rawKey, err);
      }
    });
  } catch {
    // Ignore storage enumeration issues
  }
}

let isInitialized = false;

/**
 * Applies monkey-patching to Storage.prototype.
 */
export function initSecureStorage() {
  if (isInitialized) return;
  if (typeof window === 'undefined' || typeof window.Storage === 'undefined') return;

  const storageProto = window.Storage.prototype;
  if (storageProto._isSecureStoragePatched) return;

  const nativeGetItem = storageProto.getItem;
  const nativeSetItem = storageProto.setItem;
  const nativeRemoveItem = storageProto.removeItem;
  const nativeKey = storageProto.key;

  storageProto.getItem = function (key) {
    if (isSensitiveKey(key)) {
      const hashed = registerKeyMapping(key);
      const encVal = nativeGetItem.call(this, hashed);
      if (encVal !== null) {
        return decryptValue(key, encVal);
      }
      // Fallback: check if legacy unencrypted key exists
      const legacyVal = nativeGetItem.call(this, key);
      if (legacyVal !== null) {
        // Transparent migration
        const enc = encryptValue(key, legacyVal);
        nativeSetItem.call(this, hashed, enc);
        nativeRemoveItem.call(this, key);
        return legacyVal;
      }
      return null;
    }
    return nativeGetItem.call(this, key);
  };

  storageProto.setItem = function (key, value) {
    const writeValue = String(value ?? '');
    if (isSensitiveKey(key)) {
      const hashed = registerKeyMapping(key);
      const encVal = encryptValue(key, writeValue);
      nativeSetItem.call(this, hashed, encVal);
      // Ensure plaintext key is purged
      nativeRemoveItem.call(this, key);
      return;
    }
    nativeSetItem.call(this, key, writeValue);
  };

  storageProto.removeItem = function (key) {
    if (isSensitiveKey(key)) {
      const hashed = registerKeyMapping(key);
      nativeRemoveItem.call(this, hashed);
      nativeRemoveItem.call(this, key);
      return;
    }
    nativeRemoveItem.call(this, key);
  };

  storageProto.key = function (index) {
    const rawKey = nativeKey.call(this, index);
    if (rawKey && reverseKeyMap.has(rawKey)) {
      return reverseKeyMap.get(rawKey);
    }
    return rawKey;
  };

  // Intercept window storage events to decode obfuscated keys across tabs
  if (typeof window.addEventListener === 'function') {
    const nativeAddEventListener = window.addEventListener;
    window.addEventListener = function (type, listener, options) {
      if (type === 'storage' && typeof listener === 'function') {
        const wrappedListener = function (event) {
          try {
            const rawKey = event.key;
            if (rawKey && reverseKeyMap.has(rawKey)) {
              const origKey = reverseKeyMap.get(rawKey);
              const decNew = event.newValue ? decryptValue(origKey, event.newValue) : event.newValue;
              const decOld = event.oldValue ? decryptValue(origKey, event.oldValue) : event.oldValue;
              const proxiedEvent = new Proxy(event, {
                get(target, prop) {
                  if (prop === 'key') return origKey;
                  if (prop === 'newValue') return decNew;
                  if (prop === 'oldValue') return decOld;
                  const val = target[prop];
                  return typeof val === 'function' ? val.bind(target) : val;
                },
              });
              return listener.call(this, proxiedEvent);
            }
          } catch {
            // Fall through to original event
          }
          return listener.call(this, event);
        };
        return nativeAddEventListener.call(this, type, wrappedListener, options);
      }
      return nativeAddEventListener.call(this, type, listener, options);
    };
  }

  // Mark as patched
  Object.defineProperty(storageProto, '_isSecureStoragePatched', {
    value: true,
    writable: false,
    configurable: false,
  });

  // Migrate existing data in localStorage and sessionStorage immediately
  try {
    if (window.localStorage) migrateExistingKeys(window.localStorage, nativeGetItem, nativeSetItem, nativeRemoveItem);
    if (window.sessionStorage) migrateExistingKeys(window.sessionStorage, nativeGetItem, nativeSetItem, nativeRemoveItem);
  } catch {
    // Ignore migration failures during cold boot
  }

  isInitialized = true;
}

// Automatically initialize immediately upon import
if (typeof window !== 'undefined') {
  initSecureStorage();
}
