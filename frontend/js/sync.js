/**
 * sync.js  –  SmartCanteen AI Offline → Online Sync
 * ───────────────────────────────────────────────────
 * Triggered:
 * 1. When the browser comes back online (window "online" event)
 * 2. When the Service Worker fires a "TRIGGER_SYNC" message
 * 3. Manually via Sync.run()
 */

const Sync = (() => {
  let isSyncing = false;

  /** Upload all pending offline transactions to the server */
  async function run() {
    if (isSyncing || !navigator.onLine) return;

    const pending = await IDB.getPendingTransactions();
    if (pending.length === 0) return;

    isSyncing = true;
    console.log(`[Sync] Found ${pending.length} pending transaction(s).`);

    try {
      const payload = pending.map((t) => ({
        items:        t.items,
        discount:     t.discount     || 0,
        payment_type: t.payment_type || "cash",
        created_at:   t.created_at,
      }));

      const result = await API.syncOffline({ transactions: payload });

      // Mark as synced in IndexedDB
      for (const t of pending) await IDB.markSynced(t.local_id);
      await IDB.clearSynced();

      showSyncNotification(result.synced);
      console.log(`[Sync] SUCCESS: Synced ${result.synced} transaction(s).`);

      // Refresh products (stock may have changed)
      await refreshProductCache();

      // Update UI badge
      updatePendingBadge();

    } catch (err) {
      console.error("[Sync] ERROR: Sync failed:", err.message);
    } finally {
      isSyncing = false;
    }
  }

  /** Re-cache the latest product list from the server */
  async function refreshProductCache() {
    try {
      const products = await API.getProducts();
      await IDB.cacheProducts(products);
    } catch (_) { /* offline — skip */ }
  }

  /** Show a green toast notification */
  function showSyncNotification(count) {
    if (window.showToast) {
      window.showToast(`<span class="material-symbols-outlined">cloud_sync</span> Synced ${count} offline transaction(s)!`, "success");
    }
    // Also trigger a push-style browser notification if permission granted
    if (Notification.permission === "granted") {
      new Notification("SmartCanteen AI", {
        body:  `${count} offline transaction(s) synced successfully.`,
        icon:  "/icon-192.png",
      });
    }
  }

  /** Update the floating sync badge in the sidebar */
  function updatePendingBadge() {
    IDB.pendingCount().then((n) => {
      const badge = document.getElementById("sync-badge");
      if (!badge) return;
      badge.textContent = n;
      badge.style.display = n > 0 ? "inline-flex" : "none";
    });
  }

  // ── Event listeners ───────────────────────────────────────────────────────

  window.addEventListener("online", () => {
    console.log("[Sync] Back online — starting sync…");
    document.getElementById("offline-banner")?.classList.add("hidden");
    run();
  });

  window.addEventListener("offline", () => {
    console.log("[Sync] Gone offline.");
    document.getElementById("offline-banner")?.classList.remove("hidden");
  });

  // Listen for SW "TRIGGER_SYNC" message
  navigator.serviceWorker?.addEventListener("message", (e) => {
    if (e.data?.type === "TRIGGER_SYNC") run();
  });

  return { run, refreshProductCache, updatePendingBadge };
})();

window.Sync = Sync;