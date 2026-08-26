import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowPathIcon,
  ArrowRightOnRectangleIcon,
  ArrowTrendingUpIcon,
  BanknotesIcon,
  Bars3Icon,
  BellAlertIcon,
  BuildingStorefrontIcon,
  CalendarDaysIcon,
  ChartBarIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ClockIcon,
  Cog6ToothIcon,
  ClipboardDocumentListIcon,
  CubeIcon,
  DocumentChartBarIcon,
  ExclamationTriangleIcon,
  HomeIcon,
  MoonIcon,
  ReceiptPercentIcon,
  ShieldCheckIcon,
  SparklesIcon,
  UserGroupIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import DismissibleAlert from './DismissibleAlert';
import BrandLogo from './BrandLogo';
import { useAuth } from '../contexts/AuthContext';
import { API } from '../services/api';
import {
  formatPhilippineDate,
  formatPhilippineTime,
  parseBackendDateTime,
} from '../utils/dateTime';
import {
  configureBackgroundAlertChecks,
  getAlertPermissionStatus,
  requestAlertPermission,
  sendHighDemandDeviceAlert,
  sendLowStockDeviceAlert,
  stopBackgroundAlertChecks,
} from '../services/deviceAlerts';
import { OFFLINE_QUEUE_EVENT, countPendingOfflineChanges } from '../services/offlineStore';
import { ALERT_REFRESH_EVENT, connectRealtimeAlertStream } from '../services/realtimeAlerts';
import { APP_ROUTE_ACCESS, getDefaultRoute, isRouteEnabled } from '../config/access';
import { useModuleSettings } from '../contexts/useModuleSettings';
import { MODULE_KEYS, isModuleEnabled } from '../config/modules';

const LOW_STOCK_SIGNATURE_KEY = 'sc_low_stock_signature_v2';
const HIGH_DEMAND_SIGNATURE_KEY = 'sc_high_demand_signature';
const DISMISSED_LOW_STOCK_ALERTS_KEY = 'sc_dismissed_low_stock_alerts_v2';
const DISMISSED_HIGH_DEMAND_ALERTS_KEY = 'sc_dismissed_high_demand_alerts';
const READ_LOW_STOCK_ALERTS_KEY = 'sc_read_low_stock_alerts_v2';
const READ_HIGH_DEMAND_ALERTS_KEY = 'sc_read_high_demand_alerts';
const READ_ACCOUNT_NOTICES_KEY = 'sc_read_account_notices';
const UNREAD_ALERTS_STORAGE_KEY = 'sc_has_unread_alerts';
const DARK_MODE_STORAGE_KEY = 'sc_dark_mode';
const LOW_STOCK_POLL_MS = 60000;
const ALERT_STATE_POLL_MS = 5000;
const SIDEBAR_COLLAPSED_STORAGE_KEY = 'sc_sidebar_collapsed';
const LOW_STOCK_ALERT_TYPE = 'low_stock';
const HIGH_DEMAND_ALERT_TYPE = 'high_demand';
const ROUTE_ACCESS_BY_PATH = new Map(APP_ROUTE_ACCESS.map((route) => [route.path, route]));

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

function buildAccountNoticeKey(notice) {
  return String(notice?.id ?? `${notice?.type || 'notice'}-${notice?.status || 'open'}-${notice?.created_at || ''}`);
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

  return changed;
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
  const currentDismissed = readDismissedAlertSignatures(storageKey);

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

function normalizeAccountNoticeStatus(status) {
  const value = String(status || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (value === 'denied') {
    return 'declined';
  }
  if (value === 'completed') {
    return 'used';
  }
  if (value === 'appealapproved') {
    return 'appeal_approved';
  }
  if (value === 'appealdeclined' || value === 'appealdenied' || value === 'appeal_denied') {
    return 'appeal_declined';
  }
  return value || 'pending';
}

function formatAccountNoticeStatus(status) {
  const value = normalizeAccountNoticeStatus(status);
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function getUserInitials(name) {
  const normalized = `${name || ''}`.trim();
  if (!normalized) {
    return 'SC';
  }

  const parts = normalized.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return parts
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}

function getAccountNoticeClass(status, isUnread) {
  const value = normalizeAccountNoticeStatus(status);
  if (value === 'approved' || value === 'appeal_approved') {
    return isUnread
      ? 'border-emerald-200 bg-emerald-50/70 hover:border-emerald-300'
      : 'border-emerald-100 bg-white hover:border-emerald-200';
  }
  if (value === 'declined' || value === 'appeal_declined' || value === 'expired') {
    return isUnread
      ? 'border-red-200 bg-red-50/70 hover:border-red-300'
      : 'border-red-100 bg-white hover:border-red-200';
  }
  if (value === 'used') {
    return isUnread
      ? 'border-sky-200 bg-sky-50/70 hover:border-sky-300'
      : 'border-sky-100 bg-white hover:border-sky-200';
  }
  return isUnread
    ? 'border-amber-200 bg-amber-50/70 hover:border-amber-300'
    : 'border-amber-100 bg-white hover:border-amber-200';
}

function getAccountNoticeBadgeClass(status) {
  const value = normalizeAccountNoticeStatus(status);
  if (value === 'approved' || value === 'appeal_approved') {
    return 'bg-emerald-100 text-emerald-700';
  }
  if (value === 'declined' || value === 'appeal_declined' || value === 'expired') {
    return 'bg-red-100 text-red-700';
  }
  if (value === 'used') {
    return 'bg-sky-100 text-sky-700';
  }
  return 'bg-amber-100 text-amber-700';
}

function formatAccountNoticeTime(notice) {
  return formatCheckTime(
    notice?.created_at ||
      notice?.reviewed_at ||
      notice?.completed_at ||
      notice?.requested_at
  );
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

function getNavDescription(path) {
  if (path === '/dashboard') {
    return 'Overview, KPIs & recent activity';
  }
  if (path === '/pos') {
    return 'Checkout flow & cashier tools';
  }
  if (path === '/inventory') {
    return 'Stock visibility & product review';
  }
  if (path === '/transactions') {
    return 'Sales history & receipt tracking';
  }
  if (path === '/analytics') {
    return 'Revenue trends & insights';
  }
  if (path === '/financial-reports') {
    return 'Monthly canteen finance & exports';
  }
  if (path === '/daily-sales') {
    return 'Daily sales totals & cash tracking';
  }
  if (path === '/expenses') {
    return 'Operating expenses & fund costs';
  }
  if (path === '/school-years') {
    return 'School year periods & reports';
  }
  if (path === '/reports') {
    return 'Report review & printing';
  }
  if (path === '/predictions') {
    return 'Demand planning & sales forecast';
  }
  if (path === '/audit') {
    return 'Sensitive admin actions & logs';
  }
  if (path === '/accounts') {
    return 'Create & manage user access';
  }
  if (path === '/settings') {
    return 'System & workspace setup';
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
  const [recoveryCodesOpen, setRecoveryCodesOpen] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState([]);
  const [recoveryCodesLoading, setRecoveryCodesLoading] = useState(false);
  const [recoveryCodesError, setRecoveryCodesError] = useState('');
  const [recoveryCodesCopied, setRecoveryCodesCopied] = useState(false);
  const [darkMode, setDarkMode] = useState(getStoredDarkMode);
  const [lowStockItems, setLowStockItems] = useState([]);
  const [highDemandItems, setHighDemandItems] = useState([]);
  const [accountNotices, setAccountNotices] = useState([]);
  const [accountNoticesLoading, setAccountNoticesLoading] = useState(false);
  const [alertsLoading, setAlertsLoading] = useState(true);
  const [hasUnreadAlerts, setHasUnreadAlerts] = useState(getStoredUnreadAlerts);
  const [alertReadVersion, setAlertReadVersion] = useState(0);
  const [alertPermission, setAlertPermission] = useState('prompt');
  const [lastAlertCheck, setLastAlertCheck] = useState(null);
  const [pendingSyncCount, setPendingSyncCount] = useState(countPendingOfflineChanges());
  const [workspaceRefreshing, setWorkspaceRefreshing] = useState(false);
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const alertsRequestInFlightRef = useRef(false);
  const queuedAlertRefreshRef = useRef(null);
  const lowStockItemsRef = useRef(lowStockItems);
  const highDemandItemsRef = useRef(highDemandItems);

  const { user: authUser } = useAuth();
  const user = authUser || {};
  const { modules } = useModuleSettings();
  const notificationsModuleEnabled = isModuleEnabled(modules, MODULE_KEYS.NOTIFICATIONS);
  const inventoryModuleEnabled = isModuleEnabled(modules, MODULE_KEYS.INVENTORY);
  const demandForecastModuleEnabled = isModuleEnabled(modules, MODULE_KEYS.DEMAND_FORECAST);

  const baseNavItems = [
    { name: 'Dashboard', path: '/dashboard', icon: ChartBarIcon },
    { name: 'POS / Cashier', path: '/pos', icon: BuildingStorefrontIcon },
    { name: 'Inventory', path: '/inventory', icon: CubeIcon },
    { name: 'Transactions', path: '/transactions', icon: ClockIcon },
    { name: 'Financial Reports', path: '/financial-reports', icon: BanknotesIcon },
    { name: 'Daily Sales', path: '/daily-sales', icon: DocumentChartBarIcon },
    { name: 'Expenses', path: '/expenses', icon: ReceiptPercentIcon },
    { name: 'School Years', path: '/school-years', icon: CalendarDaysIcon },
    { name: 'Reports', path: '/reports', icon: ClipboardDocumentListIcon },
    { name: 'Analytics', path: '/analytics', icon: ArrowTrendingUpIcon },
    { name: 'Demand Forecast', path: '/predictions', icon: SparklesIcon },
    { name: 'Audit Logs', path: '/audit', icon: ShieldCheckIcon },
    { name: 'User Management', path: '/accounts', icon: UserGroupIcon },
    { name: 'Settings', path: '/settings', icon: Cog6ToothIcon },
  ];

  const visibleNavItems = baseNavItems.filter((item) => {
    const route = ROUTE_ACCESS_BY_PATH.get(item.path);
    return Boolean(
      route &&
        route.allowedRoles.includes(user.role) &&
        isRouteEnabled(route, modules)
    );
  });
  const isActive = (path) => location.pathname === path;
  const effectiveLowStockItems = useMemo(
    () =>
      notificationsModuleEnabled && inventoryModuleEnabled
        ? lowStockItems
        : [],
    [inventoryModuleEnabled, lowStockItems, notificationsModuleEnabled]
  );
  const effectiveHighDemandItems = useMemo(
    () =>
      notificationsModuleEnabled && demandForecastModuleEnabled
        ? highDemandItems
        : [],
    [demandForecastModuleEnabled, highDemandItems, notificationsModuleEnabled]
  );
  const effectiveAccountNotices = useMemo(
    () => (notificationsModuleEnabled ? accountNotices : []),
    [accountNotices, notificationsModuleEnabled]
  );
  const unreadLowStockAlertKeys = useMemo(
    () =>
      getUnreadAlertKeySet(
        effectiveLowStockItems,
        READ_LOW_STOCK_ALERTS_KEY,
        buildLowStockAlertKey,
        alertReadVersion
      ),
    [alertReadVersion, effectiveLowStockItems]
  );
  const unreadHighDemandReminderKeys = useMemo(
    () =>
      getUnreadAlertKeySet(
        effectiveHighDemandItems,
        READ_HIGH_DEMAND_ALERTS_KEY,
        buildHighDemandAlertKey,
        alertReadVersion
    ),
    [alertReadVersion, effectiveHighDemandItems]
  );
  const unreadAccountNoticeKeys = useMemo(
    () =>
      getUnreadAlertKeySet(
        effectiveAccountNotices,
        READ_ACCOUNT_NOTICES_KEY,
        buildAccountNoticeKey,
        alertReadVersion
      ),
    [effectiveAccountNotices, alertReadVersion]
  );
  const lowStockAlertCount = effectiveLowStockItems.length;
  const highDemandReminderCount = effectiveHighDemandItems.length;
  const accountNoticeCount = effectiveAccountNotices.length;
  const unreadLowStockAlertCount = unreadLowStockAlertKeys.size;
  const unreadHighDemandReminderCount = unreadHighDemandReminderKeys.size;
  const unreadAccountNoticeCount = unreadAccountNoticeKeys.size;
  const notificationItemCount = lowStockAlertCount + accountNoticeCount;
  const unreadNotificationCount = unreadLowStockAlertCount + unreadAccountNoticeCount;
  const defaultRoute = getDefaultRoute(user.role, modules);
  const displayName = user.full_name || user.username || 'MEALS user';
  const userInitials = getUserInitials(displayName);
  const formattedDate = formatWorkspaceDate(currentTime);
  const formattedTime = formatWorkspaceTime(currentTime);
  const workspaceStatus = isSynced ? 'Online and ready' : 'Offline cache active';
  useEffect(() => {
    lowStockItemsRef.current = lowStockItems;
  }, [lowStockItems]);

  useEffect(() => {
    highDemandItemsRef.current = highDemandItems;
  }, [highDemandItems]);

  const loadLowStockAlerts = useCallback(async ({ notifyOnChange = true } = {}) => {
    if (!notificationsModuleEnabled || !inventoryModuleEnabled) {
      setLowStockItems([]);
      lowStockItemsRef.current = [];
      persistAlertSignature(LOW_STOCK_SIGNATURE_KEY, '');
      return { visibleItems: [], unreadItems: [], hasFreshEntries: false };
    }

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
  }, [inventoryModuleEnabled, notificationsModuleEnabled]);

  const loadHighDemandAlerts = useCallback(async ({ notifyOnChange = true } = {}) => {
    if (!notificationsModuleEnabled || !demandForecastModuleEnabled) {
      setHighDemandItems([]);
      highDemandItemsRef.current = [];
      persistAlertSignature(HIGH_DEMAND_SIGNATURE_KEY, '');
      return { visibleItems: [], unreadItems: [], hasFreshEntries: false };
    }

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
  }, [demandForecastModuleEnabled, notificationsModuleEnabled]);

  const syncAlertStateWithServer = useCallback(async () => {
    if (!notificationsModuleEnabled) {
      return false;
    }

    if (!navigator.onLine) {
      return false;
    }

    try {
      const serverState = await API.getAlertState();
      let localStateChanged = false;
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

          localStateChanged =
            mergeStoredAlertSignatures(storageKey, serverSignatures) || localStateChanged;

          if (missingServerSignatures.length > 0) {
            await API.updateAlertState({
              alert_type: alertType,
              state,
              signatures: missingServerSignatures,
            });
          }
        })
      );

      if (localStateChanged) {
        const nextLowStockItems = filterDismissedAlerts(
          lowStockItemsRef.current,
          DISMISSED_LOW_STOCK_ALERTS_KEY,
          buildLowStockAlertKey
        );
        const nextHighDemandItems = filterDismissedAlerts(
          highDemandItemsRef.current,
          DISMISSED_HIGH_DEMAND_ALERTS_KEY,
          buildHighDemandAlertKey
        );
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

        setLowStockItems(nextLowStockItems);
        lowStockItemsRef.current = nextLowStockItems;
        setHighDemandItems(nextHighDemandItems);
        highDemandItemsRef.current = nextHighDemandItems;
        setHasUnreadAlerts(unreadLowStockItems.length + unreadHighDemandItems.length > 0);
        setAlertReadVersion((currentVersion) => currentVersion + 1);
      }

      return localStateChanged;
    } catch {
      // Alert state still works from the local cache while offline or during transient API failures.
      return false;
    }
  }, [notificationsModuleEnabled]);

  const loadAlertData = useCallback(async function runAlertDataLoad({ notifyOnChange = true } = {}) {
    if (!notificationsModuleEnabled) {
      setLowStockItems([]);
      setHighDemandItems([]);
      lowStockItemsRef.current = [];
      highDemandItemsRef.current = [];
      setHasUnreadAlerts(false);
      setAlertsLoading(false);
      return;
    }

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
  }, [loadHighDemandAlerts, loadLowStockAlerts, notificationsModuleEnabled, syncAlertStateWithServer]);

  const loadAccountNotices = useCallback(async () => {
    if (!notificationsModuleEnabled) {
      setAccountNotices([]);
      setAccountNoticesLoading(false);
      return;
    }

    setAccountNoticesLoading(true);
    try {
      const notices = await API.getAccountNotices();
      setAccountNotices(Array.isArray(notices) ? notices : []);
    } catch {
      // Account notices are helpful, but the workspace should still load if this refresh fails.
    } finally {
      setAccountNoticesLoading(false);
    }
  }, [notificationsModuleEnabled]);

  const refreshOfflineData = useCallback(async ({ showSyncToast = false } = {}) => {
    setPendingSyncCount(countPendingOfflineChanges());

    if (!navigator.onLine) {
      return;
    }

    try {
      const syncResult = await API.syncPendingChanges();
      setPendingSyncCount(syncResult.queued);

      if (showSyncToast && syncResult.synced > 0) {
        window.showToast?.(`Synced ${syncResult.synced} offline change(s).`, 'success');
      }

      await API.primeOfflineData({ role: user.role });
      if (syncResult.synced > 0) {
        await loadAlertData({ notifyOnChange: true });
      }
    } catch {
      setPendingSyncCount(countPendingOfflineChanges());
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

      await configureBackgroundAlertChecks();
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

  function openMobileMenu() {
    setProfileOpen(false);
    setNotificationsOpen(false);
    setRemindersOpen(false);
    setMobileMenuOpen(true);
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
    stopBackgroundAlertChecks();
    onLogout();
  }

  function openRecoveryCodes() {
    setProfileOpen(false);
    setRecoveryCodesOpen(true);
    setRecoveryCodes([]);
    setRecoveryCodesError('');
    setRecoveryCodesCopied(false);
    setRecoveryCodesLoading(false);
  }

  async function regenerateRecoveryCodes() {
    setRecoveryCodes([]);
    setRecoveryCodesError('');
    setRecoveryCodesCopied(false);
    setRecoveryCodesLoading(true);

    try {
      const response = await API.regenerateRecoveryCodes();
      setRecoveryCodes(Array.isArray(response?.recovery_codes) ? response.recovery_codes : []);
      window.showToast?.('New recovery codes generated. Save them now.', 'success');
    } catch (error) {
      setRecoveryCodesError(error.message || 'Recovery codes could not be regenerated.');
    } finally {
      setRecoveryCodesLoading(false);
    }
  }

  async function copyRecoveryCodes() {
    if (recoveryCodes.length === 0 || !navigator.clipboard) {
      return;
    }

    try {
      await navigator.clipboard.writeText(recoveryCodes.join('\n'));
      setRecoveryCodesCopied(true);
      window.setTimeout(() => setRecoveryCodesCopied(false), 1800);
    } catch {
      setRecoveryCodesCopied(false);
    }
  }

  async function handleWorkspaceRefresh() {
    if (workspaceRefreshing) {
      return;
    }

    setWorkspaceRefreshing(true);
    try {
      await Promise.allSettled([
        ...(notificationsModuleEnabled
          ? [
              loadAlertData({ notifyOnChange: false }),
              loadAccountNotices(),
            ]
          : []),
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

  function markAccountNoticesRead() {
    markAlertItemsRead(READ_ACCOUNT_NOTICES_KEY, accountNotices, buildAccountNoticeKey);
    setAlertReadVersion((currentVersion) => currentVersion + 1);
  }

  function markNotificationsRead() {
    if (lowStockItems.length > 0) {
      markLowStockNotificationsRead();
    }
    if (accountNotices.length > 0) {
      markAccountNoticesRead();
    }
  }

  async function refreshNotifications() {
    if (!notificationsModuleEnabled) {
      return;
    }

    await Promise.allSettled([
      loadAlertData({ notifyOnChange: false }),
      loadAccountNotices(),
    ]);
  }

  function markHighDemandRemindersRead() {
    const signatures = highDemandItems.map((item) => buildHighDemandAlertKey(item));
    markAlertItemsRead(READ_HIGH_DEMAND_ALERTS_KEY, highDemandItems, buildHighDemandAlertKey);
    persistAlertStateToServer(HIGH_DEMAND_ALERT_TYPE, 'read', signatures);
    persistAlertSignature(HIGH_DEMAND_SIGNATURE_KEY, '');
    updateUnreadAlertStatus(lowStockItems, highDemandItems);
  }

  function markLowStockAlertRead(item) {
    const signature = buildLowStockAlertKey(item);
    markAlertItemsRead(READ_LOW_STOCK_ALERTS_KEY, [item], buildLowStockAlertKey);
    persistAlertStateToServer(LOW_STOCK_ALERT_TYPE, 'read', [signature]);

    const remainingUnreadLowStockItems = filterUnreadAlerts(
      lowStockItems,
      READ_LOW_STOCK_ALERTS_KEY,
      buildLowStockAlertKey
    );
    persistAlertSignature(LOW_STOCK_SIGNATURE_KEY, buildLowStockSignature(remainingUnreadLowStockItems));
    updateUnreadAlertStatus(lowStockItems, highDemandItems);
  }

  function markHighDemandAlertRead(item) {
    const signature = buildHighDemandAlertKey(item);
    markAlertItemsRead(READ_HIGH_DEMAND_ALERTS_KEY, [item], buildHighDemandAlertKey);
    persistAlertStateToServer(HIGH_DEMAND_ALERT_TYPE, 'read', [signature]);

    const remainingUnreadHighDemandItems = filterUnreadAlerts(
      highDemandItems,
      READ_HIGH_DEMAND_ALERTS_KEY,
      buildHighDemandAlertKey
    );
    persistAlertSignature(HIGH_DEMAND_SIGNATURE_KEY, buildHighDemandSignature(remainingUnreadHighDemandItems));
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
    markLowStockAlertRead(item);
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
    markHighDemandAlertRead(item);
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
      if (permission === 'granted') {
        await configureBackgroundAlertChecks();
      }
    }

    if (notificationsModuleEnabled) {
      loadPermission();
      loadAlertData({ notifyOnChange: false });
      loadAccountNotices();
    } else {
      stopBackgroundAlertChecks();
      setLowStockItems([]);
      setHighDemandItems([]);
      setAccountNotices([]);
      setHasUnreadAlerts(false);
      setAlertsLoading(false);
    }
    refreshOfflineData();

    const handleStatus = () => {
      const online = navigator.onLine;
      setIsSynced(online);
      if (online) {
        if (notificationsModuleEnabled) {
          loadAlertData({ notifyOnChange: false });
          loadAccountNotices();
        }
        refreshOfflineData({ showSyncToast: true });
      }
    };

    const handleOfflineQueueChange = (event) => {
      setPendingSyncCount(event.detail?.count ?? countPendingOfflineChanges());
    };

    const handleAlertRefreshRequest = () => {
      if (notificationsModuleEnabled && navigator.onLine) {
        loadAlertData({ notifyOnChange: true });
      }
    };

    const disconnectRealtimeAlerts = connectRealtimeAlertStream(handleAlertRefreshRequest);

    window.addEventListener('online', handleStatus);
    window.addEventListener('offline', handleStatus);
    window.addEventListener(OFFLINE_QUEUE_EVENT, handleOfflineQueueChange);
    window.addEventListener(ALERT_REFRESH_EVENT, handleAlertRefreshRequest);

    const intervalId = window.setInterval(() => {
      if (notificationsModuleEnabled && navigator.onLine) {
        loadAlertData();
        loadAccountNotices();
      }
    }, LOW_STOCK_POLL_MS);
    const alertStateIntervalId = window.setInterval(() => {
      if (notificationsModuleEnabled && navigator.onLine) {
        syncAlertStateWithServer();
      }
    }, ALERT_STATE_POLL_MS);

    return () => {
      active = false;
      window.clearInterval(intervalId);
      window.clearInterval(alertStateIntervalId);
      window.removeEventListener('online', handleStatus);
      window.removeEventListener('offline', handleStatus);
      window.removeEventListener(OFFLINE_QUEUE_EVENT, handleOfflineQueueChange);
      window.removeEventListener(ALERT_REFRESH_EVENT, handleAlertRefreshRequest);
      disconnectRealtimeAlerts();
    };
  }, [
    loadAccountNotices,
    loadAlertData,
    notificationsModuleEnabled,
    refreshOfflineData,
    syncAlertStateWithServer,
  ]);

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
    if (mobileMenuOpen) {
      setProfileOpen(false);
      setNotificationsOpen(false);
      setRemindersOpen(false);
    }
  }, [mobileMenuOpen]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setCurrentTime(new Date());
    }, 30000);

    return () => window.clearInterval(intervalId);
  }, []);

  const sidebarShellClass = darkMode
    ? 'border-r border-slate-800 bg-slate-900 text-slate-200'
    : 'border-r border-slate-200 bg-white text-slate-700';
  const sidebarBrandTitleClass = darkMode ? 'text-white' : 'text-slate-900';
  const sidebarBrandMetaClass = darkMode ? 'text-emerald-400' : 'text-emerald-600';
  const sidebarFooterClass = darkMode ? 'border-slate-800' : 'border-slate-100';
  const sidebarLogoutClass = darkMode
    ? 'text-slate-400 hover:border-red-400/20 hover:bg-red-500/10 hover:text-red-300'
    : 'text-slate-500 hover:border-red-200/60 hover:bg-red-50/60 hover:text-red-600';
  const mobileSidebarShellClass = darkMode
    ? 'border-r border-slate-800 bg-slate-950 text-slate-200'
    : 'border-r border-slate-200 bg-white text-slate-700';

  const getSidebarNavLinkClass = (active) => {
    if (active) {
      return darkMode
        ? 'border-emerald-800/60 bg-emerald-950/40 text-emerald-400 font-semibold'
        : 'border-emerald-200 bg-emerald-50 text-emerald-700 font-semibold shadow-xs';
    }

    return darkMode
      ? 'border-transparent text-slate-300 hover:bg-slate-800 hover:text-slate-100'
      : 'border-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-900';
  };

  const getSidebarIconClass = (active) => {
    if (active) {
      return darkMode ? 'text-emerald-400' : 'text-emerald-600';
    }

    return darkMode ? 'text-slate-400 group-hover:text-emerald-400' : 'text-slate-400 group-hover:text-emerald-600';
  };

  const getSidebarDescriptionClass = (active) => {
    if (active) {
      return darkMode ? 'text-emerald-400/80' : 'text-emerald-600/80';
    }

    return darkMode ? 'text-slate-400' : 'text-slate-400';
  };

  const getMobileNavLinkClass = (active) => {
    if (active) {
      return darkMode
        ? 'border-emerald-800/60 bg-emerald-950/40 text-emerald-400 font-semibold'
        : 'border-emerald-200 bg-emerald-50 text-emerald-700 font-semibold';
    }

    return darkMode
      ? 'border-transparent text-slate-300 hover:bg-slate-800 hover:text-white'
      : 'border-transparent text-slate-600 hover:bg-slate-100 hover:text-slate-900';
  };

  const getMobileNavDescriptionClass = (active) => {
    if (active) {
      return darkMode ? 'text-emerald-400/80' : 'text-emerald-600/80';
    }

    return darkMode ? 'text-slate-400' : 'text-slate-500';
  };

  return (
    <div className="app-shell flex h-screen overflow-hidden bg-slate-50 dark:bg-slate-950">
      <nav
        className={`z-30 hidden shrink-0 flex-col border-r shadow-2xl transition-[width] duration-300 lg:flex ${sidebarShellClass} ${
          sidebarCollapsed ? 'w-20' : 'w-64'
        }`}
      >
        <div className={`${sidebarCollapsed ? 'px-3 py-4' : 'p-4'} shrink-0 transition-all duration-300`}>
          <Link
            to={defaultRoute}
            className={`flex items-center rounded-2xl transition ${sidebarCollapsed ? 'justify-center' : 'gap-3'}`}
            title={sidebarCollapsed ? 'MEALS' : undefined}
          >
            <BrandLogo className="h-10 w-10 rounded-2xl" />
            {!sidebarCollapsed && (
              <div className="min-w-0">
                <h2 className={`truncate text-lg font-black tracking-tight ${sidebarBrandTitleClass}`}>
                  MEALS
                </h2>
                <p className={`mt-0.5 text-xs font-bold uppercase tracking-wider ${sidebarBrandMetaClass}`}>
                  OPERATIONS WORKSPACE
                </p>
              </div>
            )}
          </Link>

        </div>

        <div className={`custom-scrollbar flex-1 overflow-y-auto ${sidebarCollapsed ? 'px-2' : 'px-3'} transition-all duration-300`}>
          <div className="space-y-2">
            {visibleNavItems.map((item) => {
              const active = isActive(item.path);

              return (
                <Link
                  key={item.name}
                  to={item.path}
                  title={sidebarCollapsed ? item.name : undefined}
                  aria-current={active ? 'page' : undefined}
                  className={`sidebar-item ${active ? 'sidebar-item-active' : ''} group relative flex items-center rounded-xl border transition-all duration-200 ${getSidebarNavLinkClass(active)} ${
                    sidebarCollapsed ? 'justify-center px-2 py-3' : 'gap-3 px-3.5 py-3 pr-8'
                  }`}
                >
                  <item.icon
                    className={`sidebar-icon h-5 w-5 shrink-0 stroke-[1.8] ${
                      getSidebarIconClass(active)
                    }`}
                  />
                  {!sidebarCollapsed && (
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-black">{item.name}</span>
                      <span className={`mt-0.5 block text-xs font-semibold leading-tight whitespace-normal break-words ${getSidebarDescriptionClass(active)}`}>
                        {getNavDescription(item.path)}
                      </span>
                    </span>
                  )}
                  {active && (
                    <span
                      className={`sidebar-active-dot absolute rounded-full ${
                        sidebarCollapsed ? 'right-1.5 top-1.5 h-2 w-2' : 'right-3 top-1/2 h-7 w-1.5 -translate-y-1/2'
                      } ${darkMode ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.4)]' : 'bg-emerald-600 shadow-[0_0_8px_rgba(16,185,129,0.3)]'}`}
                    />
                  )}
                </Link>
              );
            })}
          </div>
        </div>

        <div className={`shrink-0 border-t p-4 ${sidebarFooterClass}`}>
          <button
            onClick={requestLogout}
            title={sidebarCollapsed ? 'Logout' : undefined}
            className={`flex w-full items-center rounded-xl border border-transparent py-2.5 text-sm font-semibold transition-all ${sidebarLogoutClass} ${
              sidebarCollapsed ? 'justify-center px-2' : 'gap-3 px-3'
            }`}
          >
            <ArrowRightOnRectangleIcon className="h-5 w-5" />
            {!sidebarCollapsed && 'Logout'}
          </button>
        </div>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="relative z-20 flex min-h-16 shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-2 shadow-xs dark:border-slate-800 dark:bg-slate-900 sm:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <button
              onClick={openMobileMenu}
              className="-ml-2 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white lg:hidden"
              aria-label="Open navigation menu"
            >
              <Bars3Icon className="h-5 w-5" />
            </button>

            <button
              type="button"
              onClick={() => setSidebarCollapsed((value) => !value)}
              aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 shadow-xs transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white lg:inline-flex"
            >
              <ChevronRightIcon
                className={`h-4 w-4 transition-transform duration-300 ${
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
              className="hidden items-center gap-2 rounded-xl border border-emerald-200/80 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 shadow-2xs transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-800/60 dark:bg-emerald-950/60 dark:text-emerald-300 md:flex"
              title={workspaceRefreshing ? 'Refreshing workspace data' : workspaceStatus}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  isSynced ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'
                }`}
              />
              {workspaceRefreshing ? 'Refreshing' : isSynced ? 'Online' : 'Offline'}
            </button>
            <div className="hidden rounded-xl border border-slate-200/80 bg-slate-50/80 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:border-slate-800 dark:bg-slate-800/80 dark:text-slate-300 xl:block">
              {formattedDate}
              <span className="mx-2 text-slate-300 dark:text-slate-600">|</span>
              {formattedTime}
            </div>
            <div className={`relative ${notificationsModuleEnabled ? '' : 'hidden'}`}>
              <button
                type="button"
                onClick={() => (notificationsOpen ? setNotificationsOpen(false) : openNotifications())}
                title={unreadNotificationCount > 0 ? 'Unread notifications' : 'Notifications'}
                className={`relative inline-flex h-11 w-11 items-center justify-center rounded-xl border bg-white text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 ${
                  unreadNotificationCount > 0 ? 'border-red-200 shadow-sm shadow-red-100 dark:border-rose-800' : 'border-slate-200'
                }`}
              >
                <BellAlertIcon className="h-5 w-5" />
                {unreadNotificationCount > 0 && (
                  <span className="absolute -right-1 -top-1 flex min-h-[1.25rem] min-w-[1.25rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-black text-white">
                    {unreadNotificationCount > 9 ? '9+' : unreadNotificationCount}
                  </span>
                )}
              </button>

              {notificationsOpen && (
                <>
                  <button
                    type="button"
                    aria-label="Close notifications"
                    onClick={() => setNotificationsOpen(false)}
                    className="notification-dismiss-layer fixed inset-x-0 bottom-0 top-16 z-40 cursor-default bg-transparent"
                  />
                  <div className="notification-popover fixed inset-x-3 top-16 z-50 max-h-[calc(100dvh-5rem)] overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100 md:absolute md:inset-x-auto md:right-0 md:top-12 md:w-[22.5rem]">
                    <div className="notification-panel-head border-b border-slate-100 px-4 py-3 dark:border-slate-800">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-slate-900 dark:text-white">Notifications</div>
                          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                            {notificationItemCount > 0
                              ? `${unreadNotificationCount} unread of ${notificationItemCount} notification${notificationItemCount > 1 ? 's' : ''}`
                              : 'No notifications right now'}
                          </div>
                        </div>
                        <div
                          className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-medium ${
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
                      <div className="mt-3 flex flex-wrap gap-2">
                        {unreadNotificationCount > 0 && (
                          <button
                            type="button"
                            onClick={markNotificationsRead}
                            className="notification-action theme-emphasis-surface rounded-lg px-3 py-2 text-xs font-semibold transition"
                          >
                            Read all
                          </button>
                        )}
                        {alertPermission !== 'granted' && alertPermission !== 'unsupported' && (
                          <button
                            type="button"
                            onClick={handleEnableAlerts}
                            className="notification-action rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                          >
                            Enable phone alerts
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={refreshNotifications}
                          className="notification-action inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                        >
                          <ArrowPathIcon className={`h-4 w-4 ${alertsLoading || accountNoticesLoading ? 'animate-spin' : ''}`} />
                          Refresh
                        </button>
                        {inventoryModuleEnabled && (
                          <button
                            type="button"
                            onClick={() => {
                              setNotificationsOpen(false);
                              navigate('/inventory');
                            }}
                            className="notification-action inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                          >
                            Inventory
                            <ChevronRightIcon className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="max-h-[44vh] space-y-2.5 overflow-y-auto p-3 custom-scrollbar">
                      {accountNoticeCount > 0 && (
                        <div className="space-y-2.5">
                          <div className="px-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                            Account Notices
                          </div>
                          {accountNotices.map((notice) => {
                            const noticeKey = buildAccountNoticeKey(notice);
                            const isUnread = unreadAccountNoticeKeys.has(noticeKey);

                            return (
                              <div
                                key={noticeKey}
                                className={`notification-alert-card rounded-xl border p-3 transition ${getAccountNoticeClass(notice.status, isUnread)}`}
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                      <ShieldCheckIcon className="h-4 w-4 shrink-0 text-slate-500" />
                                      <div className="truncate text-sm font-semibold text-slate-900">
                                        {notice.title || 'Password reset request'}
                                      </div>
                                    </div>
                                    <div className="mt-1 text-xs leading-5 text-slate-600">
                                      {notice.message}
                                    </div>
                                  </div>
                                  <div className="flex shrink-0 flex-col items-end gap-1">
                                    {isUnread && (
                                      <span className="rounded-full bg-red-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-red-600">
                                        Unread
                                      </span>
                                    )}
                                    <span
                                      className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wider ${getAccountNoticeBadgeClass(notice.status)}`}
                                    >
                                      {formatAccountNoticeStatus(notice.status)}
                                    </span>
                                  </div>
                                </div>
                                {notice.review_note && (
                                  <div className="mt-3 rounded-lg bg-white/70 px-3 py-2 text-xs font-semibold text-slate-700">
                                    Decline reason: {notice.review_note}
                                  </div>
                                )}
                                {notice.appeal_review_note && (
                                  <div className="mt-3 rounded-lg bg-white/70 px-3 py-2 text-xs font-semibold text-slate-700">
                                    Appeal note: {notice.appeal_review_note}
                                  </div>
                                )}
                                <div className="mt-3 flex items-center justify-between gap-2 text-xs text-slate-500">
                                  <span>{formatAccountNoticeTime(notice)}</span>
                                  {notice.can_change_password && (
                                    <span className="font-semibold text-emerald-700">
                                      Change password enabled
                                    </span>
                                  )}
                                  {notice.can_recover_authenticator && (
                                    <span className="font-semibold text-emerald-700">
                                      Authenticator setup enabled
                                    </span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {(alertsLoading || accountNoticesLoading) && notificationItemCount === 0 ? (
                        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                          Loading notifications...
                        </div>
                      ) : notificationItemCount === 0 ? (
                        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center">
                          <div className="text-sm font-bold text-slate-700">No notifications right now</div>
                          <div className="mt-1 text-xs text-slate-500">{formatCheckTime(lastAlertCheck)}</div>
                        </div>
                      ) : lowStockAlertCount > 0 && (
                          <div className="space-y-2.5">
                            <div className="px-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
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
                                  className={`notification-alert-card relative w-full rounded-xl border p-3 transition ${
                                    isUnread
                                      ? 'notification-alert-card-danger border-red-200 bg-white hover:border-red-300'
                                      : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                                  }`}
                                >
                                  <button
                                    type="button"
                                    onClick={() => dismissLowStockAlert(item)}
                                    aria-label={`Dismiss ${item.name} low stock alert`}
                                    className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-400 transition hover:bg-red-50 hover:text-red-600"
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
                                        <div className="truncate text-sm font-semibold text-slate-900">{item.name}</div>
                                      </div>
                                      <div className="mt-1 text-xs text-slate-500">{item.category || 'General'}</div>
                                    </div>
                                    <div className="flex shrink-0 flex-col items-end gap-1">
                                      {isUnread && (
                                        <span className="rounded-full bg-red-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-red-600">
                                          Unread
                                        </span>
                                      )}
                                      <span className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wider ${
                                        isUnread ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-slate-500'
                                      }`}>
                                        Low
                                      </span>
                                    </div>
                                  </div>

                                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                                    <div className="notification-alert-metric rounded-lg bg-slate-50 px-3 py-2">
                                      <div className="font-medium uppercase tracking-wider text-slate-400">Current</div>
                                      <div className="mt-1 text-sm font-semibold text-slate-900">{item.stock}</div>
                                    </div>
                                    <div className="notification-alert-metric rounded-lg bg-slate-50 px-3 py-2">
                                      <div className="font-medium uppercase tracking-wider text-slate-400">Minimum</div>
                                      <div className="mt-1 text-sm font-semibold text-slate-900">{item.min_stock}</div>
                                    </div>
                                  </div>
                                  <div className="mt-3 flex items-center justify-end gap-1 text-xs font-semibold uppercase tracking-wider text-red-600">
                                    Open
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

                    <div className="notification-footer border-t border-slate-100 px-4 py-2.5 text-xs text-slate-500">
                      {formatCheckTime(lastAlertCheck)}
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className={`relative ${notificationsModuleEnabled && demandForecastModuleEnabled ? '' : 'hidden'}`}>
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
                    className="notification-dismiss-layer fixed inset-x-0 bottom-0 top-16 z-40 cursor-default bg-transparent"
                  />
                  <div className="notification-popover fixed inset-x-3 top-16 z-50 max-h-[calc(100dvh-5rem)] overflow-hidden rounded-xl border border-slate-200 bg-white md:absolute md:inset-x-auto md:right-0 md:top-12 md:w-[22.5rem]">
                    <div className="notification-panel-head border-b border-slate-100 px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-slate-900">Reminders</div>
                          <div className="mt-1 text-xs text-slate-500">
                            {highDemandReminderCount > 0
                              ? `${unreadHighDemandReminderCount} unread of ${highDemandReminderCount} high demand reminder${highDemandReminderCount > 1 ? 's' : ''} for tomorrow`
                              : 'No high demand reminders right now'}
                          </div>
                        </div>
                        <div
                          className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-medium ${
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
                      <div className="mt-3 flex flex-wrap gap-2">
                        {unreadHighDemandReminderCount > 0 && (
                          <button
                            type="button"
                            onClick={markHighDemandRemindersRead}
                            className="notification-action theme-emphasis-surface rounded-lg px-3 py-2 text-xs font-semibold transition"
                          >
                            Read all
                          </button>
                        )}
                        {alertPermission !== 'granted' && alertPermission !== 'unsupported' && (
                          <button
                            type="button"
                            onClick={handleEnableAlerts}
                            className="notification-action rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                          >
                            Enable phone alerts
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={refreshNotifications}
                          className="notification-action inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                        >
                          <ArrowPathIcon className={`h-4 w-4 ${alertsLoading || accountNoticesLoading ? 'animate-spin' : ''}`} />
                          Refresh
                        </button>
                        {demandForecastModuleEnabled && (
                          <button
                            type="button"
                            onClick={() => {
                              setRemindersOpen(false);
                              navigate('/predictions');
                            }}
                            className="notification-action inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                          >
                            Predictions
                            <ChevronRightIcon className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="max-h-[44vh] space-y-2.5 overflow-y-auto p-3 custom-scrollbar">
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
                        <div className="space-y-2.5">
                          <div className="px-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                            High Demand Tomorrow
                          </div>
                          <div className="notification-info-strip rounded-lg border border-sky-100 bg-sky-50 px-3 py-2 text-xs leading-5 text-sky-800">
                            {getHighDemandAlertMeaning()}
                          </div>
                          {highDemandItems.map((item) => {
                            const isUnread = unreadHighDemandReminderKeys.has(buildHighDemandAlertKey(item));

                            return (
                            <div
                              key={item.product_id}
                              className={`notification-alert-card relative w-full rounded-xl border p-3 transition ${
                                isUnread
                                  ? 'notification-alert-card-info border-sky-200 bg-white hover:border-sky-300'
                                  : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                              }`}
                            >
                              <button
                                type="button"
                                onClick={() => dismissHighDemandAlert(item)}
                                aria-label={`Dismiss ${item.product_name} high demand reminder`}
                                className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-400 transition hover:bg-sky-50 hover:text-sky-600"
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
                                      <div className="truncate text-sm font-semibold text-slate-900">
                                        {item.product_name}
                                      </div>
                                    </div>
                                    <div className="mt-1 text-xs text-slate-500">{item.category || 'General'}</div>
                                  </div>
                                  <div className="flex shrink-0 flex-col items-end gap-1">
                                    {isUnread && (
                                      <span className="rounded-full bg-sky-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-sky-700">
                                        Unread
                                      </span>
                                    )}
                                    <span className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wider ${
                                      isUnread ? 'bg-sky-50 text-sky-700' : 'bg-slate-100 text-slate-500'
                                    }`}>
                                      High demand
                                    </span>
                                  </div>
                                </div>

                                <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                                  <div className="notification-alert-metric rounded-lg bg-slate-50 px-2.5 py-2">
                                    <div className="font-medium uppercase tracking-wider text-slate-400">Tomorrow</div>
                                    <div className="mt-1 text-sm font-semibold text-slate-900">{item.predicted_quantity}</div>
                                  </div>
                                  <div className="notification-alert-metric rounded-lg bg-slate-50 px-2.5 py-2">
                                    <div className="font-medium uppercase tracking-wider text-slate-400">Average</div>
                                    <div className="mt-1 text-sm font-semibold text-slate-900">{item.historical_average.toFixed(1)}</div>
                                  </div>
                                  <div className="notification-alert-metric rounded-lg bg-slate-50 px-2.5 py-2">
                                    <div className="font-medium uppercase tracking-wider text-slate-400">Stock gap</div>
                                    <div className="mt-1 text-sm font-semibold text-slate-900">{item.stock_gap}</div>
                                  </div>
                                </div>
                                <div className="notification-alert-metric mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                                  <span className="font-medium uppercase tracking-wider text-slate-400">Why this reminder</span>
                                  <div className="mt-1 text-sm text-slate-700">{getHighDemandReason(item)}</div>
                                </div>
                                <div className="mt-3 flex items-center justify-end gap-1 text-xs font-semibold uppercase tracking-wider text-sky-700">
                                  Open
                                  <ChevronRightIcon className="h-4 w-4" />
                                </div>
                              </button>
                            </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    <div className="notification-footer border-t border-slate-100 px-4 py-2.5 text-xs text-slate-500">
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
                  if (mobileMenuOpen) {
                    setMobileMenuOpen(false);
                  }
                  setNotificationsOpen(false);
                  setRemindersOpen(false);
                  setProfileOpen((value) => !value);
                }}
                className={`flex h-11 max-w-[16rem] items-center gap-2 rounded-2xl border px-2 shadow-sm transition hover:shadow-md sm:px-2.5 ${darkMode ? 'border-slate-700 bg-slate-800 hover:border-emerald-700/40' : 'border-slate-200 bg-white hover:border-primary/30'}`}
                aria-label="Open profile menu"
                aria-expanded={profileOpen}
                aria-haspopup="menu"
              >
                <div className="hidden min-w-0 flex-col items-end md:flex">
                  <span className={`max-w-[10rem] truncate leading-none text-sm font-black ${darkMode ? 'text-white' : 'text-slate-900'}`}>
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
              className="notification-dismiss-layer profile-dismiss-layer fixed inset-0 z-[40] cursor-default bg-transparent"
            />
            <div
              className="profile-dropdown profile-popover fixed right-3 top-[calc(env(safe-area-inset-top)+4.5rem)] z-[45] max-h-[calc(100dvh-5.25rem)] w-[calc(100vw-1.5rem)] max-w-sm overflow-y-auto rounded-xl border border-slate-200 bg-white text-slate-900 sm:right-6 sm:top-16 sm:w-80"
              role="menu"
            >
              <div className="profile-popover-head notification-panel-head border-b border-slate-100 px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className="profile-menu-avatar flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-white">
                    {userInitials}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-slate-900">
                      {displayName}
                    </div>
                    <div className="mt-1 text-xs font-medium capitalize text-slate-500">
                      {user.role || 'staff'}
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-2 p-3">
                <button
                  type="button"
                  onClick={() => {
                    setProfileOpen(false);
                    navigate(defaultRoute);
                  }}
                  className="profile-action profile-menu-item flex w-full items-center gap-3 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  <HomeIcon className="h-4 w-4 text-slate-400" />
                  Home workspace
                </button>
                <button
                  type="button"
                  onClick={openRecoveryCodes}
                  className="profile-action profile-menu-item flex w-full items-center gap-3 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  <ShieldCheckIcon className="h-4 w-4 text-slate-400" />
                  Recovery codes
                </button>
                <button
                  type="button"
                  onClick={() => setDarkMode((value) => !value)}
                  className="profile-action profile-menu-item flex w-full items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  <span className="inline-flex items-center gap-3">
                    <MoonIcon className="h-4 w-4 text-slate-400" />
                    Dark Mode
                  </span>
                  <span
                    className={`profile-toggle-track h-5 w-9 shrink-0 rounded-full p-0.5 transition ${
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
              </div>

              <div className="profile-menu-divider border-t border-slate-100 p-3 pt-2">
                <button
                  type="button"
                  onClick={requestLogout}
                  className="profile-action profile-menu-item profile-menu-item-danger flex w-full items-center gap-3 rounded-lg border border-red-100 px-3 py-2 text-xs font-semibold text-red-600 transition hover:bg-red-50"
                >
                  <ArrowRightOnRectangleIcon className="h-4 w-4" />
                  Logout
                </button>
              </div>
            </div>
          </>
        )}

        {recoveryCodesOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
            <div
              className={`w-full max-w-lg overflow-hidden rounded-2xl border shadow-2xl ${
                darkMode
                  ? 'border-slate-800 bg-slate-950 text-slate-100 shadow-black/50'
                  : 'border-slate-200 bg-white text-slate-900'
              }`}
              role="dialog"
              aria-modal="true"
              aria-labelledby="recovery-codes-title"
            >
              <div className={`border-b px-5 py-4 ${darkMode ? 'border-slate-800' : 'border-slate-100'}`}>
                <div className="flex items-start gap-3">
                  <div
                    className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${
                      darkMode ? 'bg-emerald-950/40 text-emerald-300' : 'bg-emerald-50 text-emerald-600'
                    }`}
                  >
                    <ShieldCheckIcon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <div id="recovery-codes-title" className="text-base font-black">
                      Recovery codes
                    </div>
                    <div className={`mt-1 text-sm leading-6 ${darkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                      Generate a fresh set of one-time backup codes for this account. Old unused codes stop working.
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-4 p-5">
                {recoveryCodesError && (
                  <div
                    className={`rounded-xl border px-4 py-3 text-sm font-semibold ${
                      darkMode
                        ? 'border-red-500/30 bg-red-950/30 text-red-200'
                        : 'border-red-100 bg-red-50 text-red-700'
                    }`}
                  >
                    {recoveryCodesError}
                  </div>
                )}

                {recoveryCodes.length > 0 ? (
                  <>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {recoveryCodes.map((code) => (
                        <div
                          key={code}
                          className={`rounded-xl border px-3 py-2 text-center font-mono text-sm font-black tracking-widest ${
                            darkMode
                              ? 'border-slate-800 bg-slate-900 text-white'
                              : 'border-slate-200 bg-slate-50 text-slate-900'
                          }`}
                        >
                          {code}
                        </div>
                      ))}
                    </div>
                    <div
                      className={`rounded-xl border px-4 py-3 text-sm leading-6 ${
                        darkMode
                          ? 'border-amber-500/30 bg-amber-950/30 text-amber-100'
                          : 'border-amber-100 bg-amber-50 text-amber-800'
                      }`}
                    >
                      Save these now. They are shown only once and each code can be used one time.
                    </div>
                  </>
                ) : (
                  <div
                    className={`rounded-xl border px-4 py-4 text-sm leading-6 ${
                      darkMode
                        ? 'border-slate-800 bg-slate-900 text-slate-300'
                        : 'border-slate-200 bg-slate-50 text-slate-600'
                    }`}
                  >
                    Use this when you need a new backup set. This does not remove your authenticator app; it only replaces old recovery codes.
                  </div>
                )}
              </div>

              <div className={`flex flex-col-reverse gap-2 border-t p-4 sm:flex-row sm:justify-end ${
                darkMode ? 'border-slate-800' : 'border-slate-100'
              }`}>
                <button
                  type="button"
                  onClick={() => setRecoveryCodesOpen(false)}
                  className={`rounded-xl border px-4 py-2.5 text-sm font-black transition ${
                    darkMode
                      ? 'border-slate-700 text-slate-100 hover:bg-slate-800'
                      : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  Close
                </button>
                {recoveryCodes.length > 0 && (
                  <button
                    type="button"
                    onClick={copyRecoveryCodes}
                    className={`rounded-xl border px-4 py-2.5 text-sm font-black transition ${
                      darkMode
                        ? 'border-emerald-500/30 text-emerald-100 hover:bg-emerald-950/30'
                        : 'border-emerald-100 text-emerald-700 hover:bg-emerald-50'
                    }`}
                  >
                    {recoveryCodesCopied ? 'Copied' : 'Copy codes'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={regenerateRecoveryCodes}
                  disabled={recoveryCodesLoading}
                  className={`rounded-xl px-4 py-2.5 text-sm font-black text-white transition disabled:cursor-not-allowed disabled:opacity-60 ${
                    darkMode ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-emerald-600 hover:bg-emerald-700'
                  }`}
                >
                  {recoveryCodesLoading ? 'Generating...' : 'Generate new codes'}
                </button>
              </div>
            </div>
          </div>
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

        <main className="ui-uniform custom-scrollbar min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-3.5 sm:p-5 lg:p-6" style={{ background: 'var(--sc-page)' }}>
          <div className="mx-auto h-full w-full min-w-0 max-w-[1600px]">
            {!isSynced && (
              <DismissibleAlert
                resetKey={`${isSynced}-${pendingSyncCount}`}
                tone="amber"
                title="Offline mode is active"
                className="mb-4 rounded-xl"
              >
                <>
                  The app is showing the last synced data saved on this device.
                  {pendingSyncCount > 0 ? ` ${pendingSyncCount} change(s) are waiting to sync.` : ''}
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
          <nav className={`mobile-sidebar fixed inset-y-0 left-0 flex w-full flex-col shadow-xl animate-in slide-in-from-left duration-300 sm:w-64 ${mobileSidebarShellClass}`}>
            <div className="flex items-center justify-between px-4 py-4">
              <div className="flex min-w-0 items-center gap-3">
                <BrandLogo className="h-10 w-10" />
                <div className="min-w-0">
                  <h2 className={`mobile-sidebar-brand truncate text-lg font-semibold ${darkMode ? 'text-white' : 'text-slate-900'}`}>MEALS</h2>
                  <p className="mobile-sidebar-role mt-0.5 truncate text-[10px] font-semibold uppercase tracking-wider text-primary">
                    {user.role || 'staff'} workspace
                  </p>
                </div>
              </div>
              <button
                onClick={() => setMobileMenuOpen(false)}
                className={`mobile-sidebar-close inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition ${darkMode ? 'text-slate-400 hover:bg-slate-800 hover:text-white' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'}`}
                aria-label="Close navigation menu"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <div className="mobile-sidebar-nav custom-scrollbar flex-1 space-y-2 overflow-y-auto px-3 pb-4">
              {visibleNavItems.map((item) => {
                const active = isActive(item.path);

                return (
                  <Link
                    key={item.name}
                    to={item.path}
                    onClick={() => setMobileMenuOpen(false)}
                    className={`mobile-sidebar-link ${active ? 'mobile-sidebar-link-active' : ''} flex items-center gap-3 rounded-xl border px-3.5 py-3 transition-all ${getMobileNavLinkClass(active)}`}
                  >
                    <item.icon className={`mobile-sidebar-icon h-5 w-5 shrink-0 ${active ? (darkMode ? 'text-emerald-400' : 'text-emerald-600') : 'text-slate-400'}`} />
                    <span className="min-w-0 flex-1">
                      <span className="mobile-sidebar-title block truncate text-sm font-semibold">{item.name}</span>
                      <span className={`mobile-sidebar-desc mt-0.5 block text-xs leading-tight whitespace-normal break-words ${getMobileNavDescriptionClass(active)}`}>
                        {getNavDescription(item.path)}
                      </span>
                    </span>
                    {active && (
                      <span
                        className={`h-6 w-1.5 shrink-0 rounded-full ${
                          darkMode ? 'bg-emerald-400' : 'bg-emerald-600'
                        }`}
                      />
                    )}
                  </Link>
                );
              })}
            </div>

            <div className={`mobile-sidebar-footer border-t p-3 ${darkMode ? 'border-slate-800' : 'border-slate-200'}`}>
              <button
                onClick={requestLogout}
                className={`mobile-sidebar-logout flex w-full items-center gap-3 rounded-lg px-3.5 py-3 text-sm font-semibold transition ${darkMode ? 'text-slate-400 hover:bg-red-950/40 hover:text-red-300' : 'text-slate-500 hover:bg-red-50 hover:text-red-600'}`}
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
