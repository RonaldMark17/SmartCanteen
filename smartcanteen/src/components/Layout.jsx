import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowPathIcon,
  ArrowRightOnRectangleIcon,
  ArrowTrendingUpIcon,
  Bars3Icon,
  BellAlertIcon,
  BuildingStorefrontIcon,
  ChartBarIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ClockIcon,
  CloudArrowUpIcon,
  CubeIcon,
  ExclamationTriangleIcon,
  HomeIcon,
  MoonIcon,
  ShieldCheckIcon,
  SparklesIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import DismissibleAlert from './DismissibleAlert';
import { API } from '../services/api';
import {
  formatPhilippineDate,
  formatPhilippineTime,
  parseBackendDateTime,
} from '../utils/dateTime';
import {
  getAlertPermissionStatus,
  requestAlertPermission,
  sendHighDemandDeviceAlert,
  sendLowStockDeviceAlert,
} from '../services/deviceAlerts';
import { OFFLINE_QUEUE_EVENT, countOfflineTransactions } from '../services/offlineStore';
import { ALERT_REFRESH_EVENT, connectRealtimeAlertStream } from '../services/realtimeAlerts';
import { getAllowedRolesForPath, getDefaultRoute } from '../config/access';

const LOW_STOCK_SIGNATURE_KEY = 'sc_low_stock_signature_v2';
const HIGH_DEMAND_SIGNATURE_KEY = 'sc_high_demand_signature';
const DISMISSED_LOW_STOCK_ALERTS_KEY = 'sc_dismissed_low_stock_alerts_v2';
const DISMISSED_HIGH_DEMAND_ALERTS_KEY = 'sc_dismissed_high_demand_alerts';
const READ_LOW_STOCK_ALERTS_KEY = 'sc_read_low_stock_alerts_v2';
const READ_HIGH_DEMAND_ALERTS_KEY = 'sc_read_high_demand_alerts';
const UNREAD_ALERTS_STORAGE_KEY = 'sc_has_unread_alerts';
const DARK_MODE_STORAGE_KEY = 'sc_dark_mode';
const LOW_STOCK_POLL_MS = 60000;
const SIDEBAR_COLLAPSED_STORAGE_KEY = 'sc_sidebar_collapsed';
const LOW_STOCK_ALERT_TYPE = 'low_stock';
const HIGH_DEMAND_ALERT_TYPE = 'high_demand';

function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem('sc_user') || '{}');
  } catch {
    return {};
  }
}

function getStoredSidebarCollapsed() {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function getStoredUnreadAlerts() {
  try {
    return localStorage.getItem(UNREAD_ALERTS_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function getStoredDarkMode() {
  try {
    return localStorage.getItem(DARK_MODE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function buildLowStockSignature(items) {
  return items
    .map((item) => buildLowStockAlertKey(item))
    .sort()
    .join('|');
}

function buildHighDemandSignature(items) {
  return items
    .map((item) => buildHighDemandAlertKey(item))
    .sort()
    .join('|');
}

function buildLowStockAlertKey(item) {
  return String(item?.id ?? item?.name ?? '');
}

function isBelowMinimumStock(item) {
  return Number(item?.stock || 0) < Number(item?.min_stock || 0);
}

function buildHighDemandAlertKey(item) {
  return String(item?.product_id ?? item?.product_name ?? '');
}

function persistAlertSignature(storageKey, signature) {
  if (signature) {
    localStorage.setItem(storageKey, signature);
    return;
  }

  localStorage.removeItem(storageKey);
}

function signatureToSet(signature) {
  return new Set(
    `${signature || ''}`
      .split('|')
      .map((value) => value.trim())
      .filter(Boolean)
  );
}

function hasNewSignatureEntries(previousSignature, nextSignature) {
  if (!nextSignature) {
    return false;
  }

  const previousEntries = signatureToSet(previousSignature);
  return [...signatureToSet(nextSignature)].some((entry) => !previousEntries.has(entry));
}

function readDismissedAlertSignatures(storageKey) {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) || '[]');
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function saveDismissedAlertSignatures(storageKey, signatures) {
  localStorage.setItem(storageKey, JSON.stringify([...signatures]));
}

function mergeStoredAlertSignatures(storageKey, signatures) {
  const storedSignatures = readDismissedAlertSignatures(storageKey);
  let changed = false;

  (signatures || []).forEach((signature) => {
    const normalizedSignature = `${signature || ''}`.trim();
    if (normalizedSignature && !storedSignatures.has(normalizedSignature)) {
      storedSignatures.add(normalizedSignature);
      changed = true;
    }
  });

  if (changed) {
    saveDismissedAlertSignatures(storageKey, storedSignatures);
  }

  return storedSignatures;
}

function getServerAlertStateSignatures(alertState, state, alertType) {
  const signatures = alertState?.[state]?.[alertType];
  return Array.isArray(signatures) ? signatures.map((signature) => `${signature || ''}`.trim()).filter(Boolean) : [];
}

function persistAlertStateToServer(alertType, state, signatures) {
  const normalizedSignatures = (signatures || [])
    .map((signature) => `${signature || ''}`.trim())
    .filter(Boolean);

  if (!navigator.onLine || normalizedSignatures.length === 0) {
    return;
  }

  API.updateAlertState({
    alert_type: alertType,
    state,
    signatures: normalizedSignatures,
  }).catch(() => {
    // Local storage remains the offline fallback; the next online refresh will retry.
  });
}

function pruneStoredAlertSignatures(storageKey, activeSignatures) {
  const storedSignatures = readDismissedAlertSignatures(storageKey);
  const currentSignatures = new Set(
    [...storedSignatures].filter((signature) => activeSignatures.has(signature))
  );

  if (currentSignatures.size !== storedSignatures.size) {
    saveDismissedAlertSignatures(storageKey, currentSignatures);
  }

  return currentSignatures;
}

function filterDismissedAlerts(items, storageKey, buildSignature) {
  const activeSignatures = new Set(items.map((item) => buildSignature(item)));
  const currentDismissed = pruneStoredAlertSignatures(storageKey, activeSignatures);

  return items.filter((item) => !currentDismissed.has(buildSignature(item)));
}

function filterUnreadAlerts(items, storageKey, buildSignature) {
  const activeSignatures = new Set(items.map((item) => buildSignature(item)));
  const readSignatures = pruneStoredAlertSignatures(storageKey, activeSignatures);

  return items.filter((item) => !readSignatures.has(buildSignature(item)));
}

function getUnreadAlertKeySet(items, storageKey, buildSignature, readVersion = 0) {
  if (readVersion < 0) {
    return new Set();
  }

  const readSignatures = readDismissedAlertSignatures(storageKey);

  return new Set(
    items
      .map((item) => buildSignature(item))
      .filter((signature) => !readSignatures.has(signature))
  );
}

function markAlertItemsRead(storageKey, items, buildSignature) {
  const readSignatures = readDismissedAlertSignatures(storageKey);

  items.forEach((item) => {
    readSignatures.add(buildSignature(item));
  });

  saveDismissedAlertSignatures(storageKey, readSignatures);
}

function getFreshAlertItems(items, previousSignature, buildSignature) {
  const previousEntries = signatureToSet(previousSignature);

  return items.filter((item) => !previousEntries.has(buildSignature(item)));
}

function normalizeHighDemandItems(response) {
  const predictions = Array.isArray(response?.predictions) ? response.predictions : [];

  return predictions
    .map((item, index) => {
      const predictedQuantity = Number(item?.predicted_quantity || 0);
      const historicalAverage = Number(item?.historical_average || 0);
      const stockGap = Number(item?.stock_gap || 0);
      const currentStock = Number(item?.current_stock || 0);
      const minStock = Number(item?.min_stock || 0);
      const demandLift = historicalAverage > 0 ? predictedQuantity / historicalAverage : 0;
      const highDemandFloor = Math.max(12, minStock, Math.ceil(historicalAverage * 1.2));
      const isHighDemand =
        predictedQuantity > 0 &&
        (predictedQuantity >= highDemandFloor || demandLift >= 1.35 || stockGap >= 3 || predictedQuantity >= currentStock);

      if (!isHighDemand) {
        return null;
      }

      return {
        product_id: item?.product_id ?? `forecast-${index}`,
        product_name: item?.product_name || `Product ${index + 1}`,
        category: item?.category || 'General',
        predicted_quantity: predictedQuantity,
        historical_average: historicalAverage,
        stock_gap: stockGap,
        current_stock: currentStock,
        confidence: item?.confidence || 'low',
        demand_lift: demandLift,
      };
    })
    .filter(Boolean)
    .sort(
      (left, right) =>
        right.predicted_quantity - left.predicted_quantity ||
        right.stock_gap - left.stock_gap ||
        right.demand_lift - left.demand_lift
    )
    .slice(0, 5);
}

function getHighDemandAlertMeaning() {
  return 'High demand means the item may sell faster than usual tomorrow or may run close to available stock.';
}

function getHighDemandReason(item) {
  if (item.stock_gap > 0) {
    return `Forecast is ${item.predicted_quantity} units and stock may be short by ${item.stock_gap}.`;
  }

  if (item.historical_average > 0 && item.demand_lift >= 1.35) {
    return `Forecast is higher than usual: ${item.predicted_quantity} vs ${item.historical_average.toFixed(1)} average units.`;
  }

  if (item.predicted_quantity >= item.current_stock) {
    return `Forecast is close to current stock, so this item may sell out fast.`;
  }

  return `Forecast is stronger than normal for tomorrow, so review this item early.`;
}

function formatCheckTime(value) {
  if (!value) {
    return 'Checking alerts...';
  }

  const date = parseBackendDateTime(value);
  if (!date) {
    return 'Checking alerts...';
  }

  return `Updated ${formatPhilippineTime(date, {
    hour: 'numeric',
    minute: '2-digit',
  })}`;
}

function getPermissionLabel(status) {
  if (status === 'granted') {
    return 'Phone alerts enabled';
  }
  if (status === 'denied') {
    return 'Phone alerts blocked';
  }
  if (status === 'unsupported') {
    return 'Phone alerts unavailable';
  }
  return 'Phone alerts not enabled';
}

function formatWorkspaceDate(date = new Date()) {
  return formatPhilippineDate(date, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatWorkspaceTime(date = new Date()) {
  return formatPhilippineTime(date, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function getUserInitials(name) {
  const normalized = `${name || ''}`.trim();
  if (!normalized) {
    return 'SC';
  }

  const initials = normalized
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');

  return initials || 'SC';
}

function getNavDescription(path) {
  if (path === '/dashboard') {
    return 'Overview, KPIs, and recent activity';
  }
  if (path === '/pos') {
    return 'Checkout flow and cashier tools';
  }
  if (path === '/inventory') {
    return 'Stock visibility and product review';
  }
  if (path === '/transactions') {
    return 'Sales history and receipt tracking';
  }
  if (path === '/analytics') {
    return 'Revenue trends and performance insights';
  }
  if (path === '/predictions') {
    return 'Demand planning and AI guidance';
  }
  if (path === '/audit') {
    return 'Sensitive admin actions and logs';
  }

  return 'Workspace module';
}

export default function Layout({ children, onLogout }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [isSynced, setIsSynced] = useState(navigator.onLine);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(getStoredSidebarCollapsed);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [remindersOpen, setRemindersOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(getStoredDarkMode);
  const [lowStockItems, setLowStockItems] = useState([]);
  const [highDemandItems, setHighDemandItems] = useState([]);
  const [alertsLoading, setAlertsLoading] = useState(true);
  const [hasUnreadAlerts, setHasUnreadAlerts] = useState(getStoredUnreadAlerts);
  const [alertReadVersion, setAlertReadVersion] = useState(0);
  const [alertPermission, setAlertPermission] = useState('prompt');
  const [lastAlertCheck, setLastAlertCheck] = useState(null);
  const [pendingSyncCount, setPendingSyncCount] = useState(countOfflineTransactions());
  const [workspaceRefreshing, setWorkspaceRefreshing] = useState(false);
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const alertsRequestInFlightRef = useRef(false);
  const queuedAlertRefreshRef = useRef(null);
  const lowStockItemsRef = useRef(lowStockItems);
  const highDemandItemsRef = useRef(highDemandItems);

  const user = getStoredUser();

  const navItems = [
    { name: 'Dashboard', path: '/dashboard', icon: ChartBarIcon },
    { name: 'POS / Cashier', path: '/pos', icon: BuildingStorefrontIcon },
    { name: 'Inventory', path: '/inventory', icon: CubeIcon },
    { name: 'Transactions', path: '/transactions', icon: ClockIcon },
    { name: 'Analytics', path: '/analytics', icon: ArrowTrendingUpIcon },
    { name: 'AI Predictions', path: '/predictions', icon: SparklesIcon },
    { name: 'Audit Log', path: '/audit', icon: ShieldCheckIcon },
  ];

  const visibleNavItems = navItems.filter((item) =>
    getAllowedRolesForPath(item.path).includes(user.role)
  );
  const isActive = (path) => location.pathname === path;
  const unreadLowStockAlertKeys = useMemo(
    () =>
      getUnreadAlertKeySet(
        lowStockItems,
        READ_LOW_STOCK_ALERTS_KEY,
        buildLowStockAlertKey,
        alertReadVersion
      ),
    [alertReadVersion, lowStockItems]
  );
  const unreadHighDemandReminderKeys = useMemo(
    () =>
      getUnreadAlertKeySet(
        highDemandItems,
        READ_HIGH_DEMAND_ALERTS_KEY,
        buildHighDemandAlertKey,
        alertReadVersion
      ),
    [alertReadVersion, highDemandItems]
  );
  const lowStockAlertCount = lowStockItems.length;
  const highDemandReminderCount = highDemandItems.length;
  const unreadLowStockAlertCount = unreadLowStockAlertKeys.size;
  const unreadHighDemandReminderCount = unreadHighDemandReminderKeys.size;
  const totalAlertCount = lowStockAlertCount + highDemandReminderCount;
  const defaultRoute = getDefaultRoute(user.role);
  const displayName = user.full_name || user.username || 'SmartCanteen user';
  const userInitials = getUserInitials(displayName);
  const formattedDate = formatWorkspaceDate(currentTime);
  const formattedTime = formatWorkspaceTime(currentTime);
  const workspaceStatus = isSynced ? 'Online and ready' : 'Offline cache active';
  const alertSummary =
    totalAlertCount > 0
      ? `${totalAlertCount} active alert${totalAlertCount > 1 ? 's' : ''}`
      : 'No active alerts';
  useEffect(() => {
    lowStockItemsRef.current = lowStockItems;
  }, [lowStockItems]);

  useEffect(() => {
    highDemandItemsRef.current = highDemandItems;
  }, [highDemandItems]);

  const loadLowStockAlerts = useCallback(async ({ notifyOnChange = true } = {}) => {
    try {
      const data = await API.getLowStock();
      const items = Array.isArray(data)
        ? [...data]
            .filter(isBelowMinimumStock)
            .sort((left, right) => (left.stock - right.stock) || left.name.localeCompare(right.name))
        : [];
      const visibleItems = filterDismissedAlerts(
        items,
        DISMISSED_LOW_STOCK_ALERTS_KEY,
        buildLowStockAlertKey
      );
      const unreadItems = filterUnreadAlerts(
        visibleItems,
        READ_LOW_STOCK_ALERTS_KEY,
        buildLowStockAlertKey
      );

      setLowStockItems(visibleItems);
      lowStockItemsRef.current = visibleItems;

      const nextSignature = buildLowStockSignature(unreadItems);
      const previousSignature = localStorage.getItem(LOW_STOCK_SIGNATURE_KEY) || '';
      const hasFreshEntries = hasNewSignatureEntries(previousSignature, nextSignature);

      persistAlertSignature(LOW_STOCK_SIGNATURE_KEY, nextSignature);

      if (notifyOnChange && hasFreshEntries) {
        const freshItems = getFreshAlertItems(
          unreadItems,
          previousSignature,
          buildLowStockAlertKey
        );
        if (freshItems.length > 0) {
          const countLabel = freshItems.length === 1 ? 'item is' : 'items are';
          window.showToast?.(`${freshItems.length} low stock ${countLabel} below minimum stock.`, 'warning');
          await sendLowStockDeviceAlert(freshItems);
        }
      }

      return { visibleItems, unreadItems, hasFreshEntries };
    } catch {
      // Keep the last successful alert state if refresh fails.
      const visibleItems = lowStockItemsRef.current;

      return {
        visibleItems,
        unreadItems: filterUnreadAlerts(
          visibleItems,
          READ_LOW_STOCK_ALERTS_KEY,
          buildLowStockAlertKey
        ),
        hasFreshEntries: false,
      };
    }
  }, []);

  const loadHighDemandAlerts = useCallback(async ({ notifyOnChange = true } = {}) => {
    try {
      const response = await API.getPredictions();
      const items = normalizeHighDemandItems(response);
      const visibleItems = filterDismissedAlerts(
        items,
        DISMISSED_HIGH_DEMAND_ALERTS_KEY,
        buildHighDemandAlertKey
      );
      const unreadItems = filterUnreadAlerts(
        visibleItems,
        READ_HIGH_DEMAND_ALERTS_KEY,
        buildHighDemandAlertKey
      );

      setHighDemandItems(visibleItems);
      highDemandItemsRef.current = visibleItems;

      const nextSignature = buildHighDemandSignature(unreadItems);
      const previousSignature = localStorage.getItem(HIGH_DEMAND_SIGNATURE_KEY) || '';
      const hasFreshEntries = hasNewSignatureEntries(previousSignature, nextSignature);

      persistAlertSignature(HIGH_DEMAND_SIGNATURE_KEY, nextSignature);

      if (notifyOnChange && hasFreshEntries) {
        const freshItems = getFreshAlertItems(
          unreadItems,
          previousSignature,
          buildHighDemandAlertKey
        );
        if (freshItems.length > 0) {
          const countLabel = freshItems.length === 1 ? 'item may' : 'items may';
          window.showToast?.(`${freshItems.length} high demand ${countLabel} sell fast tomorrow.`, 'warning');
          await sendHighDemandDeviceAlert(freshItems);
        }
      }

      return { visibleItems, unreadItems, hasFreshEntries };
    } catch {
      // Keep the last successful forecast alert state if refresh fails.
      const visibleItems = highDemandItemsRef.current;

      return {
        visibleItems,
        unreadItems: filterUnreadAlerts(
          visibleItems,
          READ_HIGH_DEMAND_ALERTS_KEY,
          buildHighDemandAlertKey
        ),
        hasFreshEntries: false,
      };
    }
  }, []);

  const syncAlertStateWithServer = useCallback(async () => {
    if (!navigator.onLine) {
      return;
    }

    try {
      const serverState = await API.getAlertState();
      const syncTargets = [
        {
          alertType: LOW_STOCK_ALERT_TYPE,
          state: 'read',
          storageKey: READ_LOW_STOCK_ALERTS_KEY,
        },
        {
          alertType: HIGH_DEMAND_ALERT_TYPE,
          state: 'read',
          storageKey: READ_HIGH_DEMAND_ALERTS_KEY,
        },
        {
          alertType: LOW_STOCK_ALERT_TYPE,
          state: 'dismissed',
          storageKey: DISMISSED_LOW_STOCK_ALERTS_KEY,
        },
        {
          alertType: HIGH_DEMAND_ALERT_TYPE,
          state: 'dismissed',
          storageKey: DISMISSED_HIGH_DEMAND_ALERTS_KEY,
        },
      ];

      await Promise.allSettled(
        syncTargets.map(async ({ alertType, state, storageKey }) => {
          const localSignatures = readDismissedAlertSignatures(storageKey);
          const serverSignatures = getServerAlertStateSignatures(serverState, state, alertType);
          const serverSignatureSet = new Set(serverSignatures);
          const missingServerSignatures = [...localSignatures].filter(
            (signature) => !serverSignatureSet.has(signature)
          );

          mergeStoredAlertSignatures(storageKey, serverSignatures);

          if (missingServerSignatures.length > 0) {
            await API.updateAlertState({
              alert_type: alertType,
              state,
              signatures: missingServerSignatures,
            });
          }
        })
      );
    } catch {
      // Alert state still works from the local cache while offline or during transient API failures.
    }
  }, []);

  const loadAlertData = useCallback(async function runAlertDataLoad({ notifyOnChange = true } = {}) {
    if (alertsRequestInFlightRef.current) {
      queuedAlertRefreshRef.current = {
        notifyOnChange: Boolean(queuedAlertRefreshRef.current?.notifyOnChange || notifyOnChange),
      };
      return;
    }

    alertsRequestInFlightRef.current = true;
    setAlertsLoading(true);

    try {
      await syncAlertStateWithServer();
      const [lowStockResult, highDemandResult] = await Promise.all([
        loadLowStockAlerts({ notifyOnChange }),
        loadHighDemandAlerts({ notifyOnChange }),
      ]);
      const totalVisibleAlerts =
        lowStockResult.visibleItems.length + highDemandResult.visibleItems.length;
      const totalUnreadAlerts =
        lowStockResult.unreadItems.length + highDemandResult.unreadItems.length;
      const hasFreshAlerts =
        lowStockResult.hasFreshEntries || highDemandResult.hasFreshEntries;

      setHasUnreadAlerts((currentValue) => {
        if (totalVisibleAlerts === 0 || totalUnreadAlerts === 0) {
          return false;
        }

        return notifyOnChange && hasFreshAlerts ? true : currentValue;
      });
      setLastAlertCheck(new Date().toISOString());
    } finally {
      alertsRequestInFlightRef.current = false;
      setAlertsLoading(false);

      const queuedRefresh = queuedAlertRefreshRef.current;
      queuedAlertRefreshRef.current = null;
      if (queuedRefresh && navigator.onLine) {
        window.setTimeout(() => runAlertDataLoad(queuedRefresh), 0);
      }
    }
  }, [loadHighDemandAlerts, loadLowStockAlerts, syncAlertStateWithServer]);

  const refreshOfflineData = useCallback(async ({ showSyncToast = false } = {}) => {
    setPendingSyncCount(countOfflineTransactions());

    if (!navigator.onLine) {
      return;
    }

    try {
      const syncResult = await API.syncPendingTransactions();
      setPendingSyncCount(syncResult.queued);

      if (showSyncToast && syncResult.synced > 0) {
        window.showToast?.(`Synced ${syncResult.synced} offline transaction(s).`, 'success');
      }

      await API.primeOfflineData({ role: user.role });
      if (syncResult.synced > 0) {
        await loadAlertData({ notifyOnChange: true });
      }
    } catch {
      setPendingSyncCount(countOfflineTransactions());
    }
  }, [loadAlertData, user.role]);

  async function handleEnableAlerts() {
    const permission = await requestAlertPermission();
    setAlertPermission(permission);

    if (permission === 'granted') {
      const unreadLowStockItems = filterUnreadAlerts(
        lowStockItems,
        READ_LOW_STOCK_ALERTS_KEY,
        buildLowStockAlertKey
      );
      const unreadHighDemandItems = filterUnreadAlerts(
        highDemandItems,
        READ_HIGH_DEMAND_ALERTS_KEY,
        buildHighDemandAlertKey
      );

      window.showToast?.('Phone alerts enabled for stock and demand warnings.', 'success');
      if (unreadLowStockItems.length > 0) {
        await sendLowStockDeviceAlert(unreadLowStockItems);
      }
      if (unreadHighDemandItems.length > 0) {
        await sendHighDemandDeviceAlert(unreadHighDemandItems);
      }
      return;
    }

    if (permission === 'unsupported') {
      window.showToast?.('Phone notifications are not available on this device.', 'warning');
      return;
    }

    window.showToast?.('Phone notification permission was not granted.', 'warning');
  }

  function openNotifications() {
    setRemindersOpen(false);
    setProfileOpen(false);
    setNotificationsOpen(true);
  }

  function openReminders() {
    setNotificationsOpen(false);
    setProfileOpen(false);
    setRemindersOpen(true);
  }

  function requestLogout() {
    setProfileOpen(false);
    setMobileMenuOpen(false);
    setNotificationsOpen(false);
    setRemindersOpen(false);
    setLogoutConfirmOpen(true);
  }

  function confirmLogout() {
    setLogoutConfirmOpen(false);
    onLogout();
  }

  async function handleWorkspaceRefresh() {
    if (workspaceRefreshing) {
      return;
    }

    setWorkspaceRefreshing(true);
    try {
      await Promise.allSettled([
        loadAlertData({ notifyOnChange: false }),
        refreshOfflineData({ showSyncToast: true }),
      ]);

      window.showToast?.(
        navigator.onLine
          ? 'Workspace refreshed with the latest cached and live data.'
          : 'Workspace refreshed using the latest data saved on this device.',
        'success'
      );
    } finally {
      setWorkspaceRefreshing(false);
    }
  }

  function updateUnreadAlertStatus(nextLowStockItems = lowStockItems, nextHighDemandItems = highDemandItems) {
    const unreadLowStockItems = filterUnreadAlerts(
      nextLowStockItems,
      READ_LOW_STOCK_ALERTS_KEY,
      buildLowStockAlertKey
    );
    const unreadHighDemandItems = filterUnreadAlerts(
      nextHighDemandItems,
      READ_HIGH_DEMAND_ALERTS_KEY,
      buildHighDemandAlertKey
    );

    setHasUnreadAlerts(unreadLowStockItems.length + unreadHighDemandItems.length > 0);
    setAlertReadVersion((currentVersion) => currentVersion + 1);
  }

  function markLowStockNotificationsRead() {
    const signatures = lowStockItems.map((item) => buildLowStockAlertKey(item));
    markAlertItemsRead(READ_LOW_STOCK_ALERTS_KEY, lowStockItems, buildLowStockAlertKey);
    persistAlertStateToServer(LOW_STOCK_ALERT_TYPE, 'read', signatures);
    persistAlertSignature(LOW_STOCK_SIGNATURE_KEY, '');
    updateUnreadAlertStatus(lowStockItems, highDemandItems);
  }

  function markHighDemandRemindersRead() {
    const signatures = highDemandItems.map((item) => buildHighDemandAlertKey(item));
    markAlertItemsRead(READ_HIGH_DEMAND_ALERTS_KEY, highDemandItems, buildHighDemandAlertKey);
    persistAlertStateToServer(HIGH_DEMAND_ALERT_TYPE, 'read', signatures);
    persistAlertSignature(HIGH_DEMAND_SIGNATURE_KEY, '');
    updateUnreadAlertStatus(lowStockItems, highDemandItems);
  }

  function dismissLowStockAlert(item) {
    const signature = buildLowStockAlertKey(item);
    const dismissed = readDismissedAlertSignatures(DISMISSED_LOW_STOCK_ALERTS_KEY);
    dismissed.add(signature);
    saveDismissedAlertSignatures(DISMISSED_LOW_STOCK_ALERTS_KEY, dismissed);
    markAlertItemsRead(READ_LOW_STOCK_ALERTS_KEY, [item], buildLowStockAlertKey);
    persistAlertStateToServer(LOW_STOCK_ALERT_TYPE, 'dismissed', [signature]);
    persistAlertStateToServer(LOW_STOCK_ALERT_TYPE, 'read', [signature]);

    const remainingLowStockItems = lowStockItems.filter(
      (entry) => buildLowStockAlertKey(entry) !== signature
    );
    setLowStockItems(remainingLowStockItems);
    lowStockItemsRef.current = remainingLowStockItems;
    const remainingUnreadLowStockItems = filterUnreadAlerts(
      remainingLowStockItems,
      READ_LOW_STOCK_ALERTS_KEY,
      buildLowStockAlertKey
    );
    persistAlertSignature(LOW_STOCK_SIGNATURE_KEY, buildLowStockSignature(remainingUnreadLowStockItems));
    updateUnreadAlertStatus(remainingLowStockItems, highDemandItems);
  }

  function dismissHighDemandAlert(item) {
    const signature = buildHighDemandAlertKey(item);
    const dismissed = readDismissedAlertSignatures(DISMISSED_HIGH_DEMAND_ALERTS_KEY);
    dismissed.add(signature);
    saveDismissedAlertSignatures(DISMISSED_HIGH_DEMAND_ALERTS_KEY, dismissed);
    markAlertItemsRead(READ_HIGH_DEMAND_ALERTS_KEY, [item], buildHighDemandAlertKey);
    persistAlertStateToServer(HIGH_DEMAND_ALERT_TYPE, 'dismissed', [signature]);
    persistAlertStateToServer(HIGH_DEMAND_ALERT_TYPE, 'read', [signature]);

    const remainingHighDemandItems = highDemandItems.filter(
      (entry) => buildHighDemandAlertKey(entry) !== signature
    );
    setHighDemandItems(remainingHighDemandItems);
    highDemandItemsRef.current = remainingHighDemandItems;
    const remainingUnreadHighDemandItems = filterUnreadAlerts(
      remainingHighDemandItems,
      READ_HIGH_DEMAND_ALERTS_KEY,
      buildHighDemandAlertKey
    );
    persistAlertSignature(HIGH_DEMAND_SIGNATURE_KEY, buildHighDemandSignature(remainingUnreadHighDemandItems));
    updateUnreadAlertStatus(lowStockItems, remainingHighDemandItems);
  }

  function openLowStockAlert(item) {
    dismissLowStockAlert(item);
    setNotificationsOpen(false);
    setRemindersOpen(false);
    navigate('/inventory', {
      state: {
        highlightProductId: item.id,
        highlightProductName: item.name,
        notificationType: 'low-stock',
        notificationNonce: Date.now(),
      },
    });
  }

  function openHighDemandAlert(item) {
    dismissHighDemandAlert(item);
    setNotificationsOpen(false);
    setRemindersOpen(false);
    navigate('/predictions', {
      state: {
        highlightProductId: item.product_id,
        highlightProductName: item.product_name,
        notificationType: 'high-demand',
        notificationNonce: Date.now(),
      },
    });
  }

  useEffect(() => {
    let active = true;

    async function loadPermission() {
      const permission = await getAlertPermissionStatus();
      if (active) {
        setAlertPermission(permission);
      }
    }

    loadPermission();
    loadAlertData({ notifyOnChange: false });
    refreshOfflineData();

    const handleStatus = () => {
      const online = navigator.onLine;
      setIsSynced(online);
      if (online) {
        loadAlertData({ notifyOnChange: false });
        refreshOfflineData({ showSyncToast: true });
      }
    };

    const handleOfflineQueueChange = (event) => {
      setPendingSyncCount(event.detail?.count ?? countOfflineTransactions());
    };

    const handleAlertRefreshRequest = () => {
      if (navigator.onLine) {
        loadAlertData({ notifyOnChange: true });
      }
    };

    const disconnectRealtimeAlerts = connectRealtimeAlertStream(handleAlertRefreshRequest);

    window.addEventListener('online', handleStatus);
    window.addEventListener('offline', handleStatus);
    window.addEventListener(OFFLINE_QUEUE_EVENT, handleOfflineQueueChange);
    window.addEventListener(ALERT_REFRESH_EVENT, handleAlertRefreshRequest);

    const intervalId = window.setInterval(() => {
      if (navigator.onLine) {
        loadAlertData();
      }
    }, LOW_STOCK_POLL_MS);

    return () => {
      active = false;
      window.clearInterval(intervalId);
      window.removeEventListener('online', handleStatus);
      window.removeEventListener('offline', handleStatus);
      window.removeEventListener(OFFLINE_QUEUE_EVENT, handleOfflineQueueChange);
      window.removeEventListener(ALERT_REFRESH_EVENT, handleAlertRefreshRequest);
      disconnectRealtimeAlerts();
    };
  }, [loadAlertData, refreshOfflineData]);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, sidebarCollapsed ? '1' : '0');
  }, [sidebarCollapsed]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    localStorage.setItem(DARK_MODE_STORAGE_KEY, darkMode ? '1' : '0');
  }, [darkMode]);

  useEffect(() => {
    try {
      localStorage.setItem(UNREAD_ALERTS_STORAGE_KEY, hasUnreadAlerts ? '1' : '0');
    } catch {
      // Ignore storage failures so alerts still work in restricted contexts.
    }
  }, [hasUnreadAlerts]);

  useEffect(() => {
    setMobileMenuOpen(false);
    setNotificationsOpen(false);
    setRemindersOpen(false);
    setProfileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setCurrentTime(new Date());
    }, 30000);

    return () => window.clearInterval(intervalId);
  }, []);

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      <nav
        className={`z-30 hidden shrink-0 flex-col border-r border-slate-900/80 bg-slate-950 text-slate-300 shadow-2xl shadow-slate-950/20 transition-[width] duration-300 lg:flex ${
          sidebarCollapsed ? 'w-24' : 'w-80'
        }`}
      >
        <div className={`${sidebarCollapsed ? 'px-4 py-5' : 'p-5'} shrink-0 transition-all duration-300`}>
          <Link
            to={defaultRoute}
            className={`flex items-center rounded-2xl transition ${sidebarCollapsed ? 'justify-center' : 'gap-3'}`}
            title={sidebarCollapsed ? 'SmartCanteen' : undefined}
          >
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary text-base font-black text-white shadow-lg shadow-primary/30">
              S
            </div>
            {!sidebarCollapsed && (
              <div className="min-w-0">
                <h2 className="truncate text-lg font-black tracking-tight text-white">
                  SmartCanteen
                </h2>
                <p className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.22em] text-violet-300">
                  Operations Workspace
                </p>
              </div>
            )}
          </Link>

        </div>

        <div className={`custom-scrollbar flex-1 overflow-y-auto ${sidebarCollapsed ? 'px-3' : 'px-4'} transition-all duration-300`}>
          {!sidebarCollapsed && (
            <div className="mb-2 px-3 text-[10px] font-bold uppercase tracking-widest text-slate-500">
              Operational Menu
            </div>
          )}

          <div className="space-y-1.5">
            {visibleNavItems.map((item) => {
              const active = isActive(item.path);

              return (
                <Link
                  key={item.name}
                  to={item.path}
                  title={sidebarCollapsed ? item.name : undefined}
                  className={`group relative flex items-center rounded-2xl border py-3 transition-all duration-200 ${
                    active
                      ? 'border-white/10 bg-gradient-to-r from-violet-600 to-primary text-white shadow-lg shadow-primary/25'
                      : 'border-transparent text-slate-400 hover:border-white/10 hover:bg-white/[0.06] hover:text-white'
                  } ${sidebarCollapsed ? 'justify-center px-3' : 'gap-3 px-3.5'}`}
                >
                  <item.icon
                    className={`h-5 w-5 shrink-0 stroke-[1.8] ${
                      active ? 'text-white' : 'text-slate-500 group-hover:text-violet-300'
                    }`}
                  />
                  {!sidebarCollapsed && (
                    <>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-black">{item.name}</span>
                        <span className={`mt-0.5 block truncate text-[11px] font-semibold ${
                          active ? 'text-violet-100/80' : 'text-slate-500'
                        }`}>
                          {getNavDescription(item.path)}
                        </span>
                      </span>
                      {active && <span className="h-2 w-2 rounded-full bg-white/80" />}
                    </>
                  )}
                </Link>
              );
            })}

          </div>
        </div>

        <div className="shrink-0 border-t border-slate-800/70 p-4">
          <button
            onClick={requestLogout}
            title={sidebarCollapsed ? 'Logout' : undefined}
            className={`flex w-full items-center rounded-xl border border-transparent py-3 text-sm font-bold text-slate-400 transition-all hover:border-red-400/20 hover:bg-red-500/10 hover:text-red-300 ${
              sidebarCollapsed ? 'justify-center px-3' : 'gap-3 px-4'
            }`}
          >
            <ArrowRightOnRectangleIcon className="h-5 w-5" />
            {!sidebarCollapsed && 'Logout'}
          </button>
        </div>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="relative z-20 flex min-h-16 shrink-0 items-center justify-between gap-3 border-b border-slate-200/70 bg-white/95 px-4 py-2 shadow-sm backdrop-blur sm:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="-ml-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-50 hover:text-slate-800 lg:hidden"
              aria-label="Open navigation menu"
            >
              <Bars3Icon className="h-6 w-6" />
            </button>

            <button
              type="button"
              onClick={() => setSidebarCollapsed((value) => !value)}
              aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 lg:inline-flex"
            >
              <ChevronRightIcon
                className={`h-5 w-5 transition-transform duration-300 ${
                  sidebarCollapsed ? '' : 'rotate-180'
                }`}
              />
            </button>

            <div className="min-w-0 flex-1" />
          </div>

          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <button
              type="button"
              onClick={handleWorkspaceRefresh}
              disabled={workspaceRefreshing}
              className="hidden items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-black text-slate-700 shadow-sm transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 md:flex"
              title={workspaceRefreshing ? 'Refreshing workspace data' : workspaceStatus}
            >
              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  isSynced ? 'bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.14)]' : 'bg-amber-500 shadow-[0_0_0_4px_rgba(245,158,11,0.14)]'
                }`}
              />
              {workspaceRefreshing ? 'Refreshing' : isSynced ? 'Online' : 'Offline'}
            </button>
            <div className="hidden rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-600 shadow-sm xl:block">
              {formattedDate}
              <span className="mx-2 text-slate-300">|</span>
              {formattedTime}
            </div>
            <div className="relative">
              <button
                type="button"
                onClick={() => (notificationsOpen ? setNotificationsOpen(false) : openNotifications())}
                title={unreadLowStockAlertCount > 0 ? 'Unread low stock notifications' : 'Notifications'}
                className={`relative inline-flex h-11 w-11 items-center justify-center rounded-xl border bg-white text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 ${
                  unreadLowStockAlertCount > 0 ? 'border-red-200 shadow-sm shadow-red-100' : 'border-slate-200'
                }`}
              >
                <BellAlertIcon className="h-5 w-5" />
                {unreadLowStockAlertCount > 0 && (
                  <span className="absolute -right-1 -top-1 flex min-h-[1.25rem] min-w-[1.25rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-black text-white">
                    {unreadLowStockAlertCount > 9 ? '9+' : unreadLowStockAlertCount}
                  </span>
                )}
              </button>

              {notificationsOpen && (
                <>
                  <button
                    type="button"
                    aria-label="Close notifications"
                    onClick={() => setNotificationsOpen(false)}
                    className="fixed inset-0 z-40 cursor-default bg-slate-900/10"
                  />
                  <div className="notification-popover fixed inset-x-4 top-20 z-50 max-h-[78vh] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl md:absolute md:inset-x-auto md:right-0 md:top-14 md:w-[27rem]">
                    <div className="notification-panel-head border-b border-slate-100 px-5 py-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-black text-slate-900">Notifications</div>
                          <div className="mt-1 text-xs text-slate-500">
                            {lowStockAlertCount > 0
                              ? `${unreadLowStockAlertCount} unread of ${lowStockAlertCount} low stock notification${lowStockAlertCount > 1 ? 's' : ''}`
                              : 'No low stock notifications right now'}
                          </div>
                        </div>
                        <div
                          className={`rounded-full px-2 py-1 text-[10px] font-bold ${
                            alertPermission === 'granted'
                              ? 'bg-emerald-50 text-emerald-700'
                              : alertPermission === 'unsupported'
                                ? 'bg-slate-100 text-slate-600'
                                : 'bg-amber-50 text-amber-700'
                          }`}
                        >
                          {getPermissionLabel(alertPermission)}
                        </div>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                        {unreadLowStockAlertCount > 0 && (
                          <button
                            type="button"
                            onClick={markLowStockNotificationsRead}
                            className="notification-action rounded-xl bg-slate-900 px-3 py-2 text-xs font-black text-white transition hover:bg-black"
                          >
                            Read all
                          </button>
                        )}
                        {alertPermission !== 'granted' && alertPermission !== 'unsupported' && (
                          <button
                            type="button"
                            onClick={handleEnableAlerts}
                            className="notification-action rounded-xl border border-slate-200 px-3 py-2 text-xs font-black text-slate-700 transition hover:bg-slate-50"
                          >
                            Enable phone alerts
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => loadAlertData({ notifyOnChange: false })}
                          className="notification-action inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-black text-slate-700 transition hover:bg-slate-50"
                        >
                          <ArrowPathIcon className={`h-4 w-4 ${alertsLoading ? 'animate-spin' : ''}`} />
                          Refresh
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setNotificationsOpen(false);
                            navigate('/inventory');
                          }}
                          className="notification-action inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-black text-slate-700 transition hover:bg-slate-50"
                        >
                          Open inventory
                          <ChevronRightIcon className="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                    <div className="max-h-[52vh] space-y-4 overflow-y-auto p-4 custom-scrollbar">
                      {alertsLoading && lowStockAlertCount === 0 ? (
                        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                          Loading low stock notifications...
                        </div>
                      ) : lowStockAlertCount === 0 ? (
                        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center">
                          <div className="text-sm font-bold text-slate-700">No low stock notifications right now</div>
                          <div className="mt-1 text-xs text-slate-500">{formatCheckTime(lastAlertCheck)}</div>
                        </div>
                      ) : (
                          <div className="space-y-3">
                            <div className="px-1 text-[11px] font-black uppercase tracking-widest text-slate-500">
                              Low Stock
                            </div>
                            {lowStockItems.length === 0 ? (
                              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
                                No low stock items right now.
                              </div>
                            ) : (
                              lowStockItems.map((item) => {
                                const isUnread = unreadLowStockAlertKeys.has(buildLowStockAlertKey(item));

                                return (
                                <div
                                  key={item.id}
                                  className={`notification-alert-card relative w-full rounded-2xl border p-4 transition ${
                                    isUnread
                                      ? 'notification-alert-card-danger border-red-200 bg-red-50/80 shadow-sm ring-2 ring-red-100 hover:border-red-300 hover:bg-red-100/80'
                                      : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                                  }`}
                                >
                                  <button
                                    type="button"
                                    onClick={() => dismissLowStockAlert(item)}
                                    aria-label={`Dismiss ${item.name} low stock alert`}
                                    className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-full text-red-500 transition hover:bg-red-500/10 hover:text-red-700"
                                  >
                                    <XMarkIcon className="h-4 w-4" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => openLowStockAlert(item)}
                                    className="w-full pr-10 text-left focus:outline-none focus:ring-2 focus:ring-red-200"
                                  >
                                    <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <div className="flex items-center gap-2">
                                        <ExclamationTriangleIcon className="h-4 w-4 shrink-0 text-red-500" />
                                        <div className="truncate text-sm font-black text-slate-900">{item.name}</div>
                                      </div>
                                      <div className="mt-1 text-xs text-slate-500">{item.category || 'General'}</div>
                                    </div>
                                    <div className="flex shrink-0 flex-col items-end gap-1">
                                      {isUnread && (
                                        <span className="rounded-full bg-red-600 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-white">
                                          Unread
                                        </span>
                                      )}
                                      <span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase tracking-widest ${
                                        isUnread ? 'bg-white text-red-600' : 'bg-slate-100 text-slate-500'
                                      }`}>
                                        Low
                                      </span>
                                    </div>
                                  </div>

                                  <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                                    <div className="notification-alert-metric rounded-xl bg-white px-3 py-2">
                                      <div className="font-bold uppercase tracking-widest text-slate-400">Current</div>
                                      <div className="mt-1 text-sm font-black text-slate-900">{item.stock}</div>
                                    </div>
                                    <div className="notification-alert-metric rounded-xl bg-white px-3 py-2">
                                      <div className="font-bold uppercase tracking-widest text-slate-400">Minimum</div>
                                      <div className="mt-1 text-sm font-black text-slate-900">{item.min_stock}</div>
                                    </div>
                                  </div>
                                  <div className="mt-3 flex items-center justify-end gap-1 text-xs font-black uppercase tracking-widest text-red-700">
                                    Open inventory
                                    <ChevronRightIcon className="h-4 w-4" />
                                  </div>
                                  </button>
                                </div>
                                );
                              })
                            )}
                          </div>
                      )}
                    </div>

                    <div className="notification-footer border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
                      {formatCheckTime(lastAlertCheck)}
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="relative">
              <button
                type="button"
                onClick={() => (remindersOpen ? setRemindersOpen(false) : openReminders())}
                title={unreadHighDemandReminderCount > 0 ? 'Unread high demand reminders' : 'Reminders'}
                className={`relative inline-flex h-11 w-11 items-center justify-center rounded-xl border bg-white text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 ${
                  unreadHighDemandReminderCount > 0 ? 'border-sky-200 shadow-sm shadow-sky-100' : 'border-slate-200'
                }`}
              >
                <ClockIcon className="h-5 w-5" />
                {unreadHighDemandReminderCount > 0 && (
                  <span className="absolute -right-1 -top-1 flex min-h-[1.25rem] min-w-[1.25rem] items-center justify-center rounded-full bg-sky-500 px-1 text-[10px] font-black text-white">
                    {unreadHighDemandReminderCount > 9 ? '9+' : unreadHighDemandReminderCount}
                  </span>
                )}
              </button>

              {remindersOpen && (
                <>
                  <button
                    type="button"
                    aria-label="Close reminders"
                    onClick={() => setRemindersOpen(false)}
                    className="fixed inset-0 z-40 cursor-default bg-slate-900/10"
                  />
                  <div className="notification-popover fixed inset-x-4 top-20 z-50 max-h-[78vh] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl md:absolute md:inset-x-auto md:right-0 md:top-14 md:w-[27rem]">
                    <div className="notification-panel-head border-b border-slate-100 px-5 py-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-black text-slate-900">Reminders</div>
                          <div className="mt-1 text-xs text-slate-500">
                            {highDemandReminderCount > 0
                              ? `${unreadHighDemandReminderCount} unread of ${highDemandReminderCount} high demand reminder${highDemandReminderCount > 1 ? 's' : ''} for tomorrow`
                              : 'No high demand reminders right now'}
                          </div>
                        </div>
                        <div
                          className={`rounded-full px-2 py-1 text-[10px] font-bold ${
                            alertPermission === 'granted'
                              ? 'bg-emerald-50 text-emerald-700'
                              : alertPermission === 'unsupported'
                                ? 'bg-slate-100 text-slate-600'
                                : 'bg-amber-50 text-amber-700'
                          }`}
                        >
                          {getPermissionLabel(alertPermission)}
                        </div>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                        {unreadHighDemandReminderCount > 0 && (
                          <button
                            type="button"
                            onClick={markHighDemandRemindersRead}
                            className="notification-action rounded-xl bg-slate-900 px-3 py-2 text-xs font-black text-white transition hover:bg-black"
                          >
                            Read all
                          </button>
                        )}
                        {alertPermission !== 'granted' && alertPermission !== 'unsupported' && (
                          <button
                            type="button"
                            onClick={handleEnableAlerts}
                            className="notification-action rounded-xl border border-slate-200 px-3 py-2 text-xs font-black text-slate-700 transition hover:bg-slate-50"
                          >
                            Enable phone alerts
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => loadAlertData({ notifyOnChange: false })}
                          className="notification-action inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-black text-slate-700 transition hover:bg-slate-50"
                        >
                          <ArrowPathIcon className={`h-4 w-4 ${alertsLoading ? 'animate-spin' : ''}`} />
                          Refresh
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setRemindersOpen(false);
                            navigate('/predictions');
                          }}
                          className="notification-action inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-black text-slate-700 transition hover:bg-slate-50"
                        >
                          Open predictions
                          <ChevronRightIcon className="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                    <div className="max-h-[52vh] space-y-4 overflow-y-auto p-4 custom-scrollbar">
                      {alertsLoading && highDemandReminderCount === 0 ? (
                        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                          Loading high demand reminders...
                        </div>
                      ) : highDemandReminderCount === 0 ? (
                        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center">
                          <div className="text-sm font-bold text-slate-700">No high demand reminders right now</div>
                          <div className="mt-1 text-xs text-slate-500">{formatCheckTime(lastAlertCheck)}</div>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <div className="px-1 text-[11px] font-black uppercase tracking-widest text-slate-500">
                            High Demand Tomorrow
                          </div>
                          <div className="notification-info-strip rounded-xl border border-sky-100 bg-sky-50 px-4 py-3 text-sm text-sky-800">
                            {getHighDemandAlertMeaning()}
                          </div>
                          {highDemandItems.map((item) => {
                            const isUnread = unreadHighDemandReminderKeys.has(buildHighDemandAlertKey(item));

                            return (
                            <div
                              key={item.product_id}
                              className={`notification-alert-card relative w-full rounded-2xl border p-4 transition ${
                                isUnread
                                  ? 'notification-alert-card-info border-sky-200 bg-sky-50/80 shadow-sm ring-2 ring-sky-100 hover:border-sky-300 hover:bg-sky-100/80'
                                  : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                              }`}
                            >
                              <button
                                type="button"
                                onClick={() => dismissHighDemandAlert(item)}
                                aria-label={`Dismiss ${item.product_name} high demand reminder`}
                                className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-full text-sky-500 transition hover:bg-sky-500/10 hover:text-sky-700"
                              >
                                <XMarkIcon className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => openHighDemandAlert(item)}
                                className="w-full pr-10 text-left focus:outline-none focus:ring-2 focus:ring-sky-200"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                      <ArrowTrendingUpIcon className="h-4 w-4 shrink-0 text-sky-600" />
                                      <div className="truncate text-sm font-black text-slate-900">
                                        {item.product_name}
                                      </div>
                                    </div>
                                    <div className="mt-1 text-xs text-slate-500">{item.category || 'General'}</div>
                                  </div>
                                  <div className="flex shrink-0 flex-col items-end gap-1">
                                    {isUnread && (
                                      <span className="rounded-full bg-sky-600 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-white">
                                        Unread
                                      </span>
                                    )}
                                    <span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase tracking-widest ${
                                      isUnread ? 'bg-white text-sky-700' : 'bg-slate-100 text-slate-500'
                                    }`}>
                                      High demand
                                    </span>
                                  </div>
                                </div>

                                <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
                                  <div className="notification-alert-metric rounded-xl bg-white px-3 py-2">
                                    <div className="font-bold uppercase tracking-widest text-slate-400">Tomorrow</div>
                                    <div className="mt-1 text-sm font-black text-slate-900">{item.predicted_quantity}</div>
                                  </div>
                                  <div className="notification-alert-metric rounded-xl bg-white px-3 py-2">
                                    <div className="font-bold uppercase tracking-widest text-slate-400">Average</div>
                                    <div className="mt-1 text-sm font-black text-slate-900">{item.historical_average.toFixed(1)}</div>
                                  </div>
                                  <div className="notification-alert-metric rounded-xl bg-white px-3 py-2">
                                    <div className="font-bold uppercase tracking-widest text-slate-400">Stock gap</div>
                                    <div className="mt-1 text-sm font-black text-slate-900">{item.stock_gap}</div>
                                  </div>
                                </div>
                                <div className="notification-alert-metric mt-3 rounded-xl bg-white px-3 py-2 text-xs text-slate-600">
                                  <span className="font-black uppercase tracking-widest text-slate-400">Why this reminder</span>
                                  <div className="mt-1 text-sm text-slate-700">{getHighDemandReason(item)}</div>
                                </div>
                                <div className="mt-3 flex items-center justify-end gap-1 text-xs font-black uppercase tracking-widest text-sky-700">
                                  Open predictions
                                  <ChevronRightIcon className="h-4 w-4" />
                                </div>
                              </button>
                            </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    <div className="notification-footer border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
                      {formatCheckTime(lastAlertCheck)}
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setNotificationsOpen(false);
                  setRemindersOpen(false);
                  setProfileOpen((value) => !value);
                }}
                className="flex h-11 max-w-[16rem] items-center gap-2 rounded-2xl border border-slate-200 bg-white px-2 shadow-sm transition hover:border-primary/30 hover:shadow-md sm:px-2.5"
                aria-label="Open profile menu"
              >
                <div className="hidden min-w-0 flex-col items-end md:flex">
                  <span className="max-w-[10rem] truncate leading-none text-sm font-black text-slate-900">
                    {displayName}
                  </span>
                  <span className="mt-1 text-[10px] font-bold uppercase tracking-widest text-primary">
                    {user.role || 'staff'}
                  </span>
                </div>
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-black text-white shadow-sm">
                  {userInitials}
                </div>
                <ChevronDownIcon
                  className={`hidden h-4 w-4 shrink-0 text-slate-400 transition-transform sm:block ${
                    profileOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>
            </div>
          </div>
        </header>

        {profileOpen && (
          <>
            <button
              type="button"
              aria-label="Close profile menu"
              onClick={() => setProfileOpen(false)}
              className="fixed inset-0 z-[80] cursor-default bg-slate-950/10 backdrop-blur-[1px]"
            />
            <div
              className={`profile-popover fixed right-4 top-16 z-[90] w-[min(18rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border shadow-2xl sm:right-6 ${
                darkMode
                  ? 'border-slate-800 bg-slate-950 text-slate-100 shadow-black/50'
                  : 'border-slate-200 bg-white text-slate-900'
              }`}
            >
              <div
                className={`profile-popover-head border-b px-3 py-3 ${
                  darkMode ? 'border-slate-800 bg-slate-900' : 'border-slate-100 bg-slate-50'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-black text-white">
                    {userInitials}
                  </div>
                  <div className="min-w-0">
                    <div className={`truncate text-sm font-black ${darkMode ? 'text-slate-100' : 'text-slate-900'}`}>
                      {displayName}
                    </div>
                    <div className="mt-1 text-[10px] font-black uppercase tracking-widest text-primary">
                      {user.role || 'staff'}
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setProfileOpen(false);
                    navigate(defaultRoute);
                  }}
                  className={`profile-action flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-bold transition ${
                    darkMode ? 'text-slate-100 hover:bg-slate-800/80' : 'text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <HomeIcon className={`h-5 w-5 ${darkMode ? 'text-slate-500' : 'text-slate-400'}`} />
                  Home workspace
                </button>
                <button
                  type="button"
                  onClick={() => setDarkMode((value) => !value)}
                  className={`profile-action flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-sm font-bold transition ${
                    darkMode ? 'text-slate-100 hover:bg-slate-800/80' : 'text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <span className="inline-flex items-center gap-3">
                    <MoonIcon className={`h-5 w-5 ${darkMode ? 'text-slate-500' : 'text-slate-400'}`} />
                    Dark Mode
                  </span>
                  <span
                    className={`h-5 w-9 rounded-full p-0.5 transition ${
                      darkMode ? 'bg-primary' : 'bg-slate-200'
                    }`}
                  >
                    <span
                      className={`block h-4 w-4 rounded-full bg-white shadow-sm transition ${
                        darkMode ? 'translate-x-4' : ''
                      }`}
                    />
                  </span>
                </button>
                <button
                  type="button"
                  onClick={requestLogout}
                  className={`profile-action mt-1 flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-bold transition ${
                    darkMode ? 'text-red-300 hover:bg-red-950/30' : 'text-red-600 hover:bg-red-50'
                  }`}
                >
                  <ArrowRightOnRectangleIcon className="h-5 w-5" />
                  Logout
                </button>
              </div>
            </div>
          </>
        )}

        {logoutConfirmOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
            <div
              className={`w-full max-w-sm overflow-hidden rounded-2xl border shadow-2xl ${
                darkMode
                  ? 'border-slate-800 bg-slate-950 text-slate-100 shadow-black/50'
                  : 'border-slate-200 bg-white text-slate-900'
              }`}
              role="dialog"
              aria-modal="true"
              aria-labelledby="logout-confirm-title"
            >
              <div className={`border-b px-5 py-4 ${darkMode ? 'border-slate-800' : 'border-slate-100'}`}>
                <div className="flex items-start gap-3">
                  <div
                    className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${
                      darkMode ? 'bg-red-950/40 text-red-300' : 'bg-red-50 text-red-600'
                    }`}
                  >
                    <ArrowRightOnRectangleIcon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <div id="logout-confirm-title" className="text-base font-black">
                      Log out?
                    </div>
                    <div className={`mt-1 text-sm leading-6 ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                      You will return to the sign-in screen and any open workspace menus will close.
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex flex-col-reverse gap-2 p-4 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => setLogoutConfirmOpen(false)}
                  className={`rounded-xl border px-4 py-2.5 text-sm font-black transition ${
                    darkMode
                      ? 'border-slate-700 text-slate-100 hover:bg-slate-800'
                      : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmLogout}
                  className={`rounded-xl px-4 py-2.5 text-sm font-black text-white transition ${
                    darkMode ? 'bg-red-600 hover:bg-red-500' : 'bg-red-600 hover:bg-red-700'
                  }`}
                >
                  Logout
                </button>
              </div>
            </div>
          </div>
        )}

        <main className="ui-uniform custom-scrollbar min-w-0 flex-1 overflow-y-auto bg-slate-50/40 p-4 sm:p-6 lg:p-8">
          <div className="mx-auto h-full w-full max-w-[1600px]">
            {!isSynced && (
              <DismissibleAlert
                resetKey={`${isSynced}-${pendingSyncCount}`}
                tone="amber"
                title="Offline mode is active"
                className="mb-4 rounded-xl"
              >
                <>
                  The app is showing the last synced data saved on this device.
                  {pendingSyncCount > 0 ? ` ${pendingSyncCount} transaction(s) are waiting to sync.` : ''}
                </>
              </DismissibleAlert>
            )}
            {children}
          </div>
        </main>
      </div>

      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm"
            onClick={() => setMobileMenuOpen(false)}
          />
          <nav className="fixed inset-y-0 left-0 flex w-[min(22rem,88vw)] flex-col bg-slate-950 text-slate-300 shadow-2xl animate-in slide-in-from-left duration-300">
            <div className="flex items-center justify-between p-5">
              <div className="flex items-center gap-2">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary font-black text-white shadow-lg shadow-primary/30">
                  S
                </div>
                <div>
                  <h2 className="text-lg font-black tracking-tight text-white">SmartCanteen</h2>
                  <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-violet-300">
                    {user.role || 'staff'} workspace
                  </p>
                </div>
              </div>
              <button
                onClick={() => setMobileMenuOpen(false)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-slate-500 transition hover:bg-white/10 hover:text-white"
                aria-label="Close navigation menu"
              >
                <XMarkIcon className="h-6 w-6" />
              </button>
            </div>

            <div className="px-5 pb-4">
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-black text-white">{workspaceStatus}</div>
                    <div className="mt-1 truncate text-xs font-semibold text-slate-400">{alertSummary}</div>
                  </div>
                  <CloudArrowUpIcon className={`h-5 w-5 shrink-0 ${isSynced ? 'text-emerald-300' : 'text-amber-300'}`} />
                </div>
              </div>
            </div>

            <div className="custom-scrollbar flex-1 space-y-1 overflow-y-auto px-4 pb-4">
              {visibleNavItems.map((item) => {
                const active = isActive(item.path);

                return (
                  <Link
                    key={item.name}
                    to={item.path}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`flex items-center gap-3 rounded-2xl border px-4 py-3.5 transition-all ${
                      active
                        ? 'border-white/10 bg-primary text-white shadow-lg shadow-primary/20'
                        : 'border-transparent text-slate-400 hover:border-white/10 hover:bg-white/[0.06] hover:text-white'
                    }`}
                  >
                    <item.icon className="h-5 w-5 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-black">{item.name}</span>
                      <span className={`mt-0.5 block truncate text-[11px] font-semibold ${
                        active ? 'text-violet-100/80' : 'text-slate-500'
                      }`}>
                        {getNavDescription(item.path)}
                      </span>
                    </span>
                  </Link>
                );
              })}

            </div>

            <div className="border-t border-slate-800/80 p-4">
              <button
                onClick={requestLogout}
                className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-bold text-slate-400 transition hover:bg-red-500/10 hover:text-red-300"
              >
                <ArrowRightOnRectangleIcon className="h-5 w-5" /> Logout
              </button>
            </div>
          </nav>
        </div>
      )}
    </div>
  );
}
