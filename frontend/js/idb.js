/**
 * idb.js  –  IndexedDB wrapper for SmartCanteen AI
 * ──────────────────────────────────────────────────
 * Stores offline transactions and cached products so the POS keeps
 * working even without internet access.
 */

const DB_NAME    = "SmartCanteenDB";
const DB_VERSION = 1;

const STORES = {
  OFFLINE_TXN:  "offline_transactions",   // transactions pending sync
  PRODUCTS:     "cached_products",         // latest product list
  SETTINGS:     "settings",               // token, user, etc.
};

// ── Open DB ───────────────────────────────────────────────────────────────────
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;

      if (!db.objectStoreNames.contains(STORES.OFFLINE_TXN)) {
        const txnStore = db.createObjectStore(STORES.OFFLINE_TXN, {
          keyPath: "local_id", autoIncrement: true,
        });
        txnStore.createIndex("synced", "synced", { unique: false });
      }

      if (!db.objectStoreNames.contains(STORES.PRODUCTS)) {
        db.createObjectStore(STORES.PRODUCTS, { keyPath: "id" });
      }

      if (!db.objectStoreNames.contains(STORES.SETTINGS)) {
        db.createObjectStore(STORES.SETTINGS, { keyPath: "key" });
      }
    };

    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror   = (e) => reject(e.target.error);
  });
}

// ── Generic helpers ───────────────────────────────────────────────────────────
async function dbGet(storeName, key) {
  const db  = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function dbPut(storeName, value) {
  const db  = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(storeName, "readwrite");
    const req = tx.objectStore(storeName).put(value);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function dbGetAll(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function dbDelete(storeName, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(storeName, "readwrite");
    const req = tx.objectStore(storeName).delete(key);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

async function dbClear(storeName) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(storeName, "readwrite");
    const req = tx.objectStore(storeName).clear();
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Save a transaction locally when offline */
async function saveOfflineTransaction(txnData) {
  return dbPut(STORES.OFFLINE_TXN, {
    ...txnData,
    synced:     false,
    created_at: new Date().toISOString(),
  });
}

/** Get all un-synced offline transactions */
async function getPendingTransactions() {
  const all = await dbGetAll(STORES.OFFLINE_TXN);
  return all.filter((t) => !t.synced);
}

/** Mark a local transaction as synced (by local_id) */
async function markSynced(localId) {
  const db  = await openDB();
  const tx  = db.transaction(STORES.OFFLINE_TXN, "readwrite");
  const store = tx.objectStore(STORES.OFFLINE_TXN);
  return new Promise((resolve, reject) => {
    const req = store.get(localId);
    req.onsuccess = () => {
      if (req.result) {
        req.result.synced = true;
        store.put(req.result);
      }
      resolve();
    };
    req.onerror = () => reject(req.error);
  });
}

/** Remove all synced transactions (cleanup) */
async function clearSynced() {
  const all = await dbGetAll(STORES.OFFLINE_TXN);
  for (const t of all.filter((x) => x.synced)) {
    await dbDelete(STORES.OFFLINE_TXN, t.local_id);
  }
}

/** Cache the product list locally */
async function cacheProducts(products) {
  await dbClear(STORES.PRODUCTS);
  for (const p of products) await dbPut(STORES.PRODUCTS, p);
}

/** Get cached products (used when offline) */
async function getCachedProducts() {
  return dbGetAll(STORES.PRODUCTS);
}

/** Save a setting (token, user, etc.) */
async function saveSetting(key, value) {
  return dbPut(STORES.SETTINGS, { key, value });
}

/** Get a setting */
async function getSetting(key) {
  const row = await dbGet(STORES.SETTINGS, key);
  return row ? row.value : null;
}

/** Count pending offline transactions */
async function pendingCount() {
  const pending = await getPendingTransactions();
  return pending.length;
}

// Export to global scope (used by app.js and sync.js)
window.IDB = {
  saveOfflineTransaction,
  getPendingTransactions,
  markSynced,
  clearSynced,
  cacheProducts,
  getCachedProducts,
  saveSetting,
  getSetting,
  pendingCount,
};