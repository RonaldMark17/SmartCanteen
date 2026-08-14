/**
 * Receipt Storage Service using IndexedDB & Memory Cache & Backend Sync
 * Allows storing, retrieving, and previewing receipt images and PDFs locally
 * with high storage capacity (independent of localStorage 5MB limit).
 */

import { API } from './api';
import { readFileAsDataUrl } from './receiptSanitizer';

const DB_NAME = 'SmartCanteen_ReceiptDB';
const DB_VERSION = 1;
const STORE_NAME = 'receipts';

// In-memory fallback map if IndexedDB is unavailable
const memoryReceiptCache = new Map();

function normalizeAlphaNumeric(str) {
  if (!str) return '';
  return String(str).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function openDatabase() {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      resolve(null);
      return;
    }

    try {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
          store.createIndex('filename', 'filename', { unique: false });
          store.createIndex('reportId', 'reportId', { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        console.warn('IndexedDB open error, falling back to memory cache:', request.error);
        resolve(null);
      };
    } catch (err) {
      console.warn('IndexedDB initialization exception:', err);
      resolve(null);
    }
  });
}

/**
 * Generate a consistent lookup key for a receipt
 */
export function buildReceiptStorageKey(filename, expenseId = null) {
  const cleanFilename = String(filename || '').trim().toLowerCase();
  if (expenseId) {
    return `${expenseId}_${cleanFilename}`;
  }
  return cleanFilename;
}

/**
 * Cache in memory using all possible key representations
 */
function populateMemoryCache(entry) {
  if (!entry) return;
  const keys = [
    entry.key,
    entry.filename,
    entry.rawName,
    entry.sanitizedName,
    entry.id,
  ].filter(Boolean);

  for (const k of keys) {
    const str = String(k).trim();
    if (!str) continue;
    memoryReceiptCache.set(str, entry);
    memoryReceiptCache.set(str.toLowerCase(), entry);
    memoryReceiptCache.set(str.replace(/\s+/g, '_'), entry);
    memoryReceiptCache.set(str.replace(/_/g, ' '), entry);
    const norm = normalizeAlphaNumeric(str);
    if (norm) memoryReceiptCache.set(norm, entry);
  }

  if (entry.reportId && entry.filename) {
    const reportKey = `${entry.reportId}_${entry.filename}`;
    memoryReceiptCache.set(reportKey, entry);
    memoryReceiptCache.set(reportKey.toLowerCase(), entry);
  }
}

/**
 * Save a receipt record into IndexedDB and cache
 */
export async function saveReceipt(receipt) {
  if (!receipt || (!receipt.filename && !receipt.key)) return null;

  const filename = receipt.filename || receipt.key;
  const key = receipt.key || filename;
  const entry = {
    ...receipt,
    key,
    filename,
    createdAt: receipt.createdAt || new Date().toISOString(),
  };

  // Cache in memory
  populateMemoryCache(entry);

  // Fallback to localStorage for quick session access if payload allows
  try {
    if (entry.dataUrl && entry.dataUrl.length < 2000000) {
      const normKey = normalizeAlphaNumeric(key);
      localStorage.setItem(`sc_rcpt_${normKey}`, JSON.stringify({
        filename: entry.filename,
        dataUrl: entry.dataUrl,
        mimeType: entry.mimeType,
        isPdf: entry.isPdf,
        category: entry.category,
        amount: entry.amount,
        date: entry.date,
        supplier: entry.supplier,
        description: entry.description,
      }));
    }
  } catch {
    // localStorage full or restricted, ignore
  }

  const db = await openDatabase();
  if (!db) return entry;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put(entry);

      tx.oncomplete = () => resolve(entry);
      tx.onerror = () => {
        console.warn('Failed to save receipt in IndexedDB:', tx.error);
        resolve(entry);
      };
    } catch (err) {
      console.warn('Error saving receipt to IndexedDB:', err);
      resolve(entry);
    }
  });
}

/**
 * Get a receipt by filename, key, or expense identifier with fallback to backend
 */
export async function getReceipt(keyOrFilename, metadata = {}) {
  if (!keyOrFilename) return null;

  const searchKey = String(keyOrFilename).trim();
  if (!searchKey || searchKey === 'No receipt' || searchKey === '-') return null;
  const lowerKey = searchKey.toLowerCase();
  const normKey = normalizeAlphaNumeric(searchKey);

  // 1. Check memory cache first
  if (memoryReceiptCache.has(searchKey)) return memoryReceiptCache.get(searchKey);
  if (memoryReceiptCache.has(lowerKey)) return memoryReceiptCache.get(lowerKey);
  if (normKey && memoryReceiptCache.has(normKey)) return memoryReceiptCache.get(normKey);
  if (memoryReceiptCache.has(searchKey.replace(/\s+/g, '_'))) {
    return memoryReceiptCache.get(searchKey.replace(/\s+/g, '_'));
  }
  if (memoryReceiptCache.has(searchKey.replace(/_/g, ' '))) {
    return memoryReceiptCache.get(searchKey.replace(/_/g, ' '));
  }

  // 2. Check localStorage fallback
  try {
    const rawLocal = localStorage.getItem(`sc_rcpt_${normKey}`);
    if (rawLocal) {
      const parsed = JSON.parse(rawLocal);
      if (parsed && parsed.dataUrl) {
        populateMemoryCache(parsed);
        return parsed;
      }
    }
  } catch {
    // ignore
  }

  // 3. Check IndexedDB
  const db = await openDatabase();
  let dbResult = null;

  if (db) {
    dbResult = await new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);

        // Try exact key
        const getReq = store.get(searchKey);
        getReq.onsuccess = () => {
          if (getReq.result) {
            resolve(getReq.result);
            return;
          }

          // Try lowercase key
          const lowerReq = store.get(lowerKey);
          lowerReq.onsuccess = () => {
            if (lowerReq.result) {
              resolve(lowerReq.result);
              return;
            }

            // Scan all entries for fuzzy / normalized filename match
            const cursorReq = store.openCursor();
            let matched = null;
            cursorReq.onsuccess = (e) => {
              const cursor = e.target.result;
              if (cursor) {
                const val = cursor.value;
                const valNormKey = normalizeAlphaNumeric(val.key);
                const valNormFilename = normalizeAlphaNumeric(val.filename);
                const valNormRaw = normalizeAlphaNumeric(val.rawName);

                if (
                  val.filename === searchKey ||
                  val.filename?.toLowerCase() === lowerKey ||
                  valNormKey === normKey ||
                  valNormFilename === normKey ||
                  valNormRaw === normKey ||
                  (normKey.length >= 6 && valNormFilename?.includes(normKey)) ||
                  (normKey.length >= 6 && normKey.includes(valNormFilename))
                ) {
                  matched = val;
                  resolve(matched);
                  return;
                }

                // Match by report ID + metadata if supplied
                if (
                  metadata.reportId &&
                  Number(val.reportId) === Number(metadata.reportId) &&
                  val.category === metadata.category &&
                  val.date === metadata.date
                ) {
                  matched = val;
                  resolve(matched);
                  return;
                }

                cursor.continue();
              } else {
                resolve(matched);
              }
            };
            cursorReq.onerror = () => resolve(null);
          };
          lowerReq.onerror = () => resolve(null);
        };
        getReq.onerror = () => resolve(null);
      } catch (err) {
        console.warn('Error reading receipt from IndexedDB:', err);
        resolve(null);
      }
    });
  }

  if (dbResult && dbResult.dataUrl) {
    populateMemoryCache(dbResult);
    return dbResult;
  }

  // 4. Fallback: Fetch from backend API if filename has extension (e.g. .png, .jpg, .pdf)
  const isFilenameFormat = /\.(png|jpe?g|webp|gif|pdf)$/i.test(searchKey);
  if (isFilenameFormat) {
    try {
      const backendFile = await API.getFinancialReceiptBlob(searchKey);
      if (backendFile && backendFile.blob) {
        const dataUrl = await readFileAsDataUrl(backendFile.blob);
        const mimeType = backendFile.blob.type || 'image/png';
        const isPdf = mimeType === 'application/pdf' || searchKey.toLowerCase().endsWith('.pdf');
        const restoredEntry = {
          key: searchKey,
          filename: searchKey,
          dataUrl,
          mimeType,
          isPdf,
          category: metadata.category || 'Operating Expense',
          amount: metadata.amount || 0,
          date: metadata.date || 'N/A',
          supplier: metadata.supplier || '',
          description: metadata.description || '',
          reportId: metadata.reportId || null,
        };
        await saveReceipt(restoredEntry);
        return restoredEntry;
      }
    } catch (err) {
      console.warn('Backend receipt fetch fallback error:', err);
    }
  }

  return null;
}

/**
 * Delete a receipt from store
 */
export async function deleteReceipt(keyOrFilename) {
  if (!keyOrFilename) return;
  const searchKey = String(keyOrFilename).trim();
  memoryReceiptCache.delete(searchKey);
  memoryReceiptCache.delete(searchKey.toLowerCase());
  const norm = normalizeAlphaNumeric(searchKey);
  if (norm) {
    memoryReceiptCache.delete(norm);
    try {
      localStorage.removeItem(`sc_rcpt_${norm}`);
    } catch {
      // ignore
    }
  }

  const db = await openDatabase();
  if (!db) return;

  try {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(searchKey);
  } catch (err) {
    console.warn('Error deleting receipt:', err);
  }
}
