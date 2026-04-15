import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import {
  ArrowPathIcon,
  ArrowRightOnRectangleIcon,
  ArrowTrendingUpIcon,
  Bars3Icon,
  BellAlertIcon,
  BuildingStorefrontIcon,
  ChartBarIcon,
  ChevronRightIcon,
  ClockIcon,
  CloudArrowUpIcon,
  CubeIcon,
  ExclamationTriangleIcon,
  HomeIcon,
  LockClosedIcon,
  MagnifyingGlassIcon,
  ShieldCheckIcon,
  SparklesIcon,
  UserCircleIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import DismissibleAlert from './DismissibleAlert';
import { API } from '../services/api';
import {
  getAlertPermissionStatus,
  requestAlertPermission,
  sendHighDemandDeviceAlert,
  sendLowStockDeviceAlert,
} from '../services/deviceAlerts';
import { OFFLINE_QUEUE_EVENT, countOfflineTransactions } from '../services/offlineStore';
import { getAllowedRolesForPath, getDefaultRoute } from '../config/access';

const LOW_STOCK_SIGNATURE_KEY = 'sc_low_stock_signature';
const HIGH_DEMAND_SIGNATURE_KEY = 'sc_high_demand_signature';
const DISMISSED_LOW_STOCK_ALERTS_KEY = 'sc_dismissed_low_stock_alerts';
const DISMISSED_HIGH_DEMAND_ALERTS_KEY = 'sc_dismissed_high_demand_alerts';
const LOW_STOCK_POLL_MS = 60000;
const SIDEBAR_COLLAPSED_STORAGE_KEY = 'sc_sidebar_collapsed';

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

function buildLowStockSignature(items) {
  return items
    .map((item) => buildLowStockItemSignature(item))
    .sort()
    .join('|');
}

function buildHighDemandSignature(items) {
  return items
    .map((item) => buildHighDemandItemSignature(item))
    .sort()
    .join('|');
}

function buildLowStockItemSignature(item) {
  return `${item.id}:${item.stock}:${item.min_stock}`;
}

function buildHighDemandItemSignature(item) {
  return `${item.product_id}:${item.predicted_quantity}:${item.stock_gap}`;
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

function filterDismissedAlerts(items, storageKey, buildSignature) {
  const dismissedSignatures = readDismissedAlertSignatures(storageKey);
  const activeSignatures = new Set(items.map((item) => buildSignature(item)));
  const currentDismissed = new Set(
    [...dismissedSignatures].filter((signature) => activeSignatures.has(signature))
  );

  if (currentDismissed.size !== dismissedSignatures.size) {
    saveDismissedAlertSignatures(storageKey, currentDismissed);
  }

  return items.filter((item) => !currentDismissed.has(buildSignature(item)));
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

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Checking alerts...';
  }

  return `Updated ${date.toLocaleTimeString('en-PH', {
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

function getPageMeta(pathname) {
  if (pathname.startsWith('/dashboard')) {
    return {
      eyebrow: 'Operations Overview',
      title: 'Command center for daily service',
      description: 'Keep sales, stock movement, and forecasts aligned from one workspace.',
    };
  }

  if (pathname.startsWith('/pos')) {
    return {
      eyebrow: 'Cashier Workspace',
      title: 'Move queues faster with a cleaner checkout flow',
      description: 'Process orders, review carts, and keep counter operations moving smoothly.',
    };
  }

  if (pathname.startsWith('/inventory')) {
    return {
      eyebrow: 'Inventory Control',
      title: 'Watch stock health before shortages slow the team down',
      description: 'Track available items, low-stock risks, and product activity in one place.',
    };
  }

  if (pathname.startsWith('/transactions')) {
    return {
      eyebrow: 'Transactions',
      title: 'Review completed sales with clearer operating context',
      description: 'Check transaction history, cashier activity, and recent service trends quickly.',
    };
  }

  if (pathname.startsWith('/analytics')) {
    return {
      eyebrow: 'Analytics',
      title: 'Read the numbers behind each service day',
      description: 'Spot patterns in sales, top products, and team performance without leaving the app shell.',
    };
  }

  if (pathname.startsWith('/predictions')) {
    return {
      eyebrow: 'AI Predictions',
      title: 'Plan tomorrow with stronger demand signals',
      description: 'Compare forecast guidance, weather context, and restock priorities before the next rush.',
    };
  }

  if (pathname.startsWith('/audit')) {
    return {
      eyebrow: 'Audit Trail',
      title: 'Review admin activity with clearer visibility',
      description: 'Track sensitive actions, role-based activity, and system accountability over time.',
    };
  }

  return {
    eyebrow: 'Workspace',
    title: 'Manage day-to-day canteen operations',
    description: 'Navigate the tools your team needs for sales, stock, and planning.',
  };
}

function getGreeting(date = new Date()) {
  const hour = date.getHours();

  if (hour < 12) {
    return 'Good morning';
  }

  if (hour < 18) {
    return 'Good afternoon';
  }

  return 'Good evening';
}

function formatWorkspaceDate(date = new Date()) {
  return date.toLocaleDateString('en-PH', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatWorkspaceTime(date = new Date()) {
  return date.toLocaleTimeString('en-PH', {
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

function getRoleFocus(role) {
  if (role === 'admin') {
    return {
      label: 'Admin focus',
      title: 'Watch the whole system and keep the team aligned.',
      description:
        'Best for reviewing dashboards, analytics, audit activity, and cross-team operations.',
    };
  }

  if (role === 'staff') {
    return {
      label: 'Staff focus',
      title: 'Stay ahead of stock needs and tomorrow’s demand.',
      description:
        'Best for inventory control, analytics checks, and prediction-driven prep work.',
    };
  }

  return {
    label: 'Cashier focus',
    title: 'Process orders quickly and keep service moving.',
    description:
      'Best for POS transactions, recent sales review, and low-stock awareness during service.',
  };
}

export default function Layout({ children, onLogout }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [isSynced, setIsSynced] = useState(navigator.onLine);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(getStoredSidebarCollapsed);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [lowStockItems, setLowStockItems] = useState([]);
  const [highDemandItems, setHighDemandItems] = useState([]);
  const [alertsLoading, setAlertsLoading] = useState(true);
  const [hasUnreadAlerts, setHasUnreadAlerts] = useState(false);
  const [alertPermission, setAlertPermission] = useState('prompt');
  const [lastAlertCheck, setLastAlertCheck] = useState(null);
  const [pendingSyncCount, setPendingSyncCount] = useState(countOfflineTransactions());
  const [workspaceRefreshing, setWorkspaceRefreshing] = useState(false);
  const [currentTime, setCurrentTime] = useState(() => new Date());
  const [navSearch, setNavSearch] = useState('');

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
  const totalAlertCount = lowStockItems.length + highDemandItems.length;
  const pageMeta = getPageMeta(location.pathname);
  const defaultRoute = getDefaultRoute(user.role);
  const roleFocus = getRoleFocus(user.role);
  const displayName = user.full_name || user.username || 'SmartCanteen user';
  const userInitials = getUserInitials(displayName);
  const greeting = getGreeting(currentTime);
  const formattedDate = formatWorkspaceDate(currentTime);
  const formattedTime = formatWorkspaceTime(currentTime);
  const workspaceStatus = isSynced ? 'Online and ready' : 'Offline cache active';
  const alertSummary =
    totalAlertCount > 0
      ? `${totalAlertCount} active alert${totalAlertCount > 1 ? 's' : ''}`
      : 'No active alerts';
  const navQuery = navSearch.trim().toLowerCase();
  const filteredNavItems = visibleNavItems.filter((item) => {
    if (!navQuery) {
      return true;
    }

    return (
      item.name.toLowerCase().includes(navQuery) ||
      getNavDescription(item.path).toLowerCase().includes(navQuery)
    );
  });

  async function loadLowStockAlerts({ notifyOnChange = true } = {}) {
    try {
      const data = await API.getLowStock();
      const items = Array.isArray(data)
        ? [...data].sort((left, right) => (left.stock - right.stock) || left.name.localeCompare(right.name))
        : [];
      const visibleItems = filterDismissedAlerts(
        items,
        DISMISSED_LOW_STOCK_ALERTS_KEY,
        buildLowStockItemSignature
      );

      setLowStockItems(visibleItems);

      const nextSignature = buildLowStockSignature(visibleItems);
      const previousSignature = localStorage.getItem(LOW_STOCK_SIGNATURE_KEY) || '';

      if (!nextSignature) {
        localStorage.removeItem(LOW_STOCK_SIGNATURE_KEY);
        return;
      }

      if (nextSignature !== previousSignature) {
        localStorage.setItem(LOW_STOCK_SIGNATURE_KEY, nextSignature);
        setHasUnreadAlerts(true);

        if (notifyOnChange) {
          const countLabel = visibleItems.length === 1 ? 'item is' : 'items are';
          window.showToast?.(`${visibleItems.length} low stock ${countLabel} below alert level.`, 'warning');
          await sendLowStockDeviceAlert(visibleItems);
        }
      }
    } catch {
      // Keep the last successful alert state if refresh fails.
    }
  }

  async function loadHighDemandAlerts({ notifyOnChange = true } = {}) {
    try {
      const response = await API.getPredictions();
      const items = normalizeHighDemandItems(response);
      const visibleItems = filterDismissedAlerts(
        items,
        DISMISSED_HIGH_DEMAND_ALERTS_KEY,
        buildHighDemandItemSignature
      );

      setHighDemandItems(visibleItems);

      const nextSignature = buildHighDemandSignature(visibleItems);
      const previousSignature = localStorage.getItem(HIGH_DEMAND_SIGNATURE_KEY) || '';

      if (!nextSignature) {
        localStorage.removeItem(HIGH_DEMAND_SIGNATURE_KEY);
        return;
      }

      if (nextSignature !== previousSignature) {
        localStorage.setItem(HIGH_DEMAND_SIGNATURE_KEY, nextSignature);
        setHasUnreadAlerts(true);

        if (notifyOnChange) {
          const countLabel = visibleItems.length === 1 ? 'item may' : 'items may';
          window.showToast?.(`${visibleItems.length} high demand ${countLabel} sell fast tomorrow.`, 'warning');
          await sendHighDemandDeviceAlert(visibleItems);
        }
      }
    } catch {
      // Keep the last successful forecast alert state if refresh fails.
    }
  }

  async function loadAlertData({ notifyOnChange = true } = {}) {
    setAlertsLoading(true);
    await Promise.allSettled([
      loadLowStockAlerts({ notifyOnChange }),
      loadHighDemandAlerts({ notifyOnChange }),
    ]);
    setLastAlertCheck(new Date().toISOString());
    setAlertsLoading(false);
  }

  async function refreshOfflineData({ showSyncToast = false } = {}) {
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
    } catch {
      setPendingSyncCount(countOfflineTransactions());
    }
  }

  async function handleEnableAlerts() {
    const permission = await requestAlertPermission();
    setAlertPermission(permission);

    if (permission === 'granted') {
      window.showToast?.('Phone alerts enabled for stock and demand warnings.', 'success');
      if (lowStockItems.length > 0) {
        await sendLowStockDeviceAlert(lowStockItems);
      }
      if (highDemandItems.length > 0) {
        await sendHighDemandDeviceAlert(highDemandItems);
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
    setNotificationsOpen(true);
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

  function markAllNotificationsRead() {
    setHasUnreadAlerts(false);
  }

  function dismissLowStockAlert(item) {
    const signature = buildLowStockItemSignature(item);
    const dismissed = readDismissedAlertSignatures(DISMISSED_LOW_STOCK_ALERTS_KEY);
    dismissed.add(signature);
    saveDismissedAlertSignatures(DISMISSED_LOW_STOCK_ALERTS_KEY, dismissed);

    const remainingLowStockItems = lowStockItems.filter(
      (entry) => buildLowStockItemSignature(entry) !== signature
    );
    setLowStockItems(remainingLowStockItems);
    localStorage.setItem(LOW_STOCK_SIGNATURE_KEY, buildLowStockSignature(remainingLowStockItems));
    setHasUnreadAlerts(remainingLowStockItems.length + highDemandItems.length > 0);
  }

  function dismissHighDemandAlert(item) {
    const signature = buildHighDemandItemSignature(item);
    const dismissed = readDismissedAlertSignatures(DISMISSED_HIGH_DEMAND_ALERTS_KEY);
    dismissed.add(signature);
    saveDismissedAlertSignatures(DISMISSED_HIGH_DEMAND_ALERTS_KEY, dismissed);

    const remainingHighDemandItems = highDemandItems.filter(
      (entry) => buildHighDemandItemSignature(entry) !== signature
    );
    setHighDemandItems(remainingHighDemandItems);
    localStorage.setItem(HIGH_DEMAND_SIGNATURE_KEY, buildHighDemandSignature(remainingHighDemandItems));
    setHasUnreadAlerts(lowStockItems.length + remainingHighDemandItems.length > 0);
  }

  function openLowStockAlert(item) {
    dismissLowStockAlert(item);
    setNotificationsOpen(false);
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
    loadAlertData();
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

    window.addEventListener('online', handleStatus);
    window.addEventListener('offline', handleStatus);
    window.addEventListener(OFFLINE_QUEUE_EVENT, handleOfflineQueueChange);

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
    };
  }, []);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, sidebarCollapsed ? '1' : '0');
  }, [sidebarCollapsed]);

  useEffect(() => {
    setMobileMenuOpen(false);
    setNotificationsOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setCurrentTime(new Date());
    }, 30000);

    return () => window.clearInterval(intervalId);
  }, []);

  const pulseCards = [
    {
      title: 'Workspace status',
      value: workspaceStatus,
      detail: `${formattedDate} at ${formattedTime}`,
      Icon: CloudArrowUpIcon,
      tone:
        isSynced
          ? 'border-cyan-200 bg-cyan-50/80 text-cyan-900'
          : 'border-amber-200 bg-amber-50/90 text-amber-900',
      actionLabel: workspaceRefreshing ? 'Refreshing...' : 'Refresh data',
      onAction: handleWorkspaceRefresh,
      actionDisabled: workspaceRefreshing,
    },
    {
      title: 'Pending sync queue',
      value: pendingSyncCount,
      detail:
        pendingSyncCount > 0
          ? `${pendingSyncCount} transaction(s) will sync when service is available.`
          : 'No pending offline transactions right now.',
      Icon: ArrowPathIcon,
      tone: 'border-emerald-200 bg-emerald-50/80 text-emerald-900',
      actionLabel: navigator.onLine ? 'Sync now' : 'Offline',
      onAction: handleWorkspaceRefresh,
      actionDisabled: workspaceRefreshing || !navigator.onLine,
    },
    {
      title: 'Alerts & demand watch',
      value: totalAlertCount,
      detail:
        totalAlertCount > 0
          ? `${lowStockItems.length} low stock, ${highDemandItems.length} high demand`
          : 'No urgent alerts are currently active.',
      Icon: BellAlertIcon,
      tone:
        totalAlertCount > 0
          ? 'border-rose-200 bg-rose-50/90 text-rose-900'
          : 'border-slate-200 bg-slate-50/90 text-slate-900',
      actionLabel: 'Open alerts',
      onAction: openNotifications,
      actionDisabled: false,
    },
    {
      title: 'Secure session',
      value: user.role ? `${user.role}` : 'staff',
      detail:
        alertPermission === 'granted'
          ? 'Phone alerts are enabled for this device.'
          : 'Enable phone alerts or jump to AI planning tools.',
      Icon: LockClosedIcon,
      tone: 'border-violet-200 bg-violet-50/90 text-violet-900',
      actionLabel:
        alertPermission === 'granted' ? 'Open predictions' : 'Enable alerts',
      onAction:
        alertPermission === 'granted'
          ? () => navigate('/predictions')
          : handleEnableAlerts,
      actionDisabled: false,
    },
  ];

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      <nav
        className={`z-30 hidden shrink-0 flex-col bg-slate-900 text-slate-300 shadow-xl transition-[width] duration-300 lg:flex ${
          sidebarCollapsed ? 'w-24' : 'w-72'
        }`}
      >
        <div className={`${sidebarCollapsed ? 'p-4' : 'p-8'} transition-all duration-300`}>
          <div className={`flex items-center ${sidebarCollapsed ? 'justify-center' : 'gap-2'} transition-all duration-300`}>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary font-black text-white shadow-lg shadow-primary/30">
              S
            </div>
            {!sidebarCollapsed && (
              <h2 className="text-xl font-bold tracking-tight text-white">SmartCanteen</h2>
            )}
          </div>
          {!sidebarCollapsed && (
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
              Predictive System
            </p>
          )}
        </div>

        <div className={`custom-scrollbar flex-1 space-y-1.5 overflow-y-auto ${sidebarCollapsed ? 'px-3' : 'px-4'} transition-all duration-300`}>
          {!sidebarCollapsed && (
            <div className="mb-4 mt-2 px-3 text-[10px] font-bold uppercase tracking-widest text-slate-500">
              Operational Menu
            </div>
          )}
          {visibleNavItems.map((item) => (
            <Link
              key={item.name}
              to={item.path}
              title={sidebarCollapsed ? item.name : undefined}
              className={`group flex items-center rounded-xl py-3 transition-all duration-200 ${
                isActive(item.path)
                  ? 'bg-primary text-white shadow-lg shadow-primary/20'
                  : 'hover:bg-slate-800 hover:text-white'
              } ${sidebarCollapsed ? 'justify-center px-3' : 'gap-3 px-4'}`}
            >
              <item.icon
                className={`h-5 w-5 ${
                  isActive(item.path) ? 'text-white' : 'text-slate-500 group-hover:text-primary'
                }`}
              />
              {!sidebarCollapsed && <span className="text-sm font-semibold">{item.name}</span>}
            </Link>
          ))}
        </div>

        <div className="shrink-0 border-t border-slate-800 p-4">
          <button
            onClick={onLogout}
            title={sidebarCollapsed ? 'Logout' : undefined}
            className={`flex w-full items-center rounded-xl py-3 text-sm font-bold text-slate-400 transition-all hover:bg-red-500/10 hover:text-red-400 ${
              sidebarCollapsed ? 'justify-center px-3' : 'gap-3 px-4'
            }`}
          >
            <ArrowRightOnRectangleIcon className="h-5 w-5" />
            {!sidebarCollapsed && 'Logout'}
          </button>
        </div>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="relative z-20 flex h-16 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 sm:px-6">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="-ml-2 rounded-lg p-2 text-slate-500 hover:bg-slate-50 lg:hidden"
            >
              <Bars3Icon className="h-6 w-6" />
            </button>

            <button
              type="button"
              onClick={() => setSidebarCollapsed((value) => !value)}
              aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className="hidden rounded-lg border border-slate-200 bg-white p-2 text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 lg:inline-flex"
            >
              <ChevronRightIcon
                className={`h-5 w-5 transition-transform duration-300 ${
                  sidebarCollapsed ? '' : 'rotate-180'
                }`}
              />
            </button>
          </div>

          <div className="flex-1" />

          <div className="flex items-center gap-3 sm:gap-4">
            <div className="relative">
              <button
                type="button"
                onClick={() => (notificationsOpen ? setNotificationsOpen(false) : openNotifications())}
                title={hasUnreadAlerts ? 'New notifications available' : 'Notifications'}
                className="relative rounded-xl border border-slate-200 bg-white p-2.5 text-slate-600 transition hover:border-slate-300 hover:bg-slate-50"
              >
                <BellAlertIcon className="h-6 w-6" />
                {hasUnreadAlerts && totalAlertCount > 0 && (
                  <span className="absolute -right-1 -top-1 flex min-h-[1.25rem] min-w-[1.25rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-black text-white">
                    {totalAlertCount > 9 ? '9+' : totalAlertCount}
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
                  <div className="fixed inset-x-4 top-20 z-50 max-h-[75vh] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl md:absolute md:inset-x-auto md:right-0 md:top-14 md:w-96">
                    <div className="border-b border-slate-100 px-5 py-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-black text-slate-900">Alerts & Forecast Notices</div>
                          <div className="mt-1 text-xs text-slate-500">
                            {totalAlertCount > 0
                              ? `${lowStockItems.length} low stock and ${highDemandItems.length} high demand alert${totalAlertCount > 1 ? 's' : ''}`
                              : 'No low stock or high demand alerts right now'}
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
                      <div className="mt-3 flex flex-wrap gap-2">
                        {totalAlertCount > 0 && (
                          <button
                            type="button"
                            onClick={markAllNotificationsRead}
                            className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-black text-white transition hover:bg-black"
                          >
                            Read all
                          </button>
                        )}
                        {alertPermission !== 'granted' && alertPermission !== 'unsupported' && (
                          <button
                            type="button"
                            onClick={handleEnableAlerts}
                            className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-black text-slate-700 transition hover:bg-slate-50"
                          >
                            Enable phone alerts
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => loadAlertData({ notifyOnChange: false })}
                          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-black text-slate-700 transition hover:bg-slate-50"
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
                          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-black text-slate-700 transition hover:bg-slate-50"
                        >
                          Open inventory
                          <ChevronRightIcon className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setNotificationsOpen(false);
                            navigate('/predictions');
                          }}
                          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-black text-slate-700 transition hover:bg-slate-50"
                        >
                          Open predictions
                          <ChevronRightIcon className="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                    <div className="max-h-[45vh] space-y-4 overflow-y-auto p-4 custom-scrollbar">
                      {alertsLoading && totalAlertCount === 0 ? (
                        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                          Loading alerts...
                        </div>
                      ) : totalAlertCount === 0 ? (
                        <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center">
                          <div className="text-sm font-bold text-slate-700">No urgent alerts right now</div>
                          <div className="mt-1 text-xs text-slate-500">{formatCheckTime(lastAlertCheck)}</div>
                        </div>
                      ) : (
                        <>
                          <div className="space-y-3">
                            <div className="px-1 text-[11px] font-black uppercase tracking-widest text-slate-500">
                              Low Stock
                            </div>
                            {lowStockItems.length === 0 ? (
                              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
                                No low stock items right now.
                              </div>
                            ) : (
                              lowStockItems.map((item) => (
                                <div
                                  key={item.id}
                                  className="relative w-full rounded-2xl border border-red-100 bg-red-50/60 p-4 transition hover:border-red-200 hover:bg-red-100/70"
                                >
                                  <button
                                    type="button"
                                    onClick={() => dismissLowStockAlert(item)}
                                    aria-label={`Dismiss ${item.name} low stock alert`}
                                    className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-full text-red-500 transition hover:bg-white/80 hover:text-red-700"
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
                                    <span className="rounded-full bg-white px-2 py-1 text-[10px] font-black uppercase tracking-widest text-red-600">
                                      Low
                                    </span>
                                  </div>

                                  <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                                    <div className="rounded-xl bg-white px-3 py-2">
                                      <div className="font-bold uppercase tracking-widest text-slate-400">Current</div>
                                      <div className="mt-1 text-sm font-black text-slate-900">{item.stock}</div>
                                    </div>
                                    <div className="rounded-xl bg-white px-3 py-2">
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
                              ))
                            )}
                          </div>

                          <div className="space-y-3">
                            <div className="px-1 text-[11px] font-black uppercase tracking-widest text-slate-500">
                              High Demand Tomorrow
                            </div>
                            <div className="rounded-xl border border-sky-100 bg-sky-50 px-4 py-3 text-sm text-sky-800">
                              {getHighDemandAlertMeaning()}
                            </div>
                            {highDemandItems.length === 0 ? (
                              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
                                No high demand forecast alerts right now.
                              </div>
                            ) : (
                              highDemandItems.map((item) => (
                                <div
                                  key={item.product_id}
                                  className="relative w-full rounded-2xl border border-sky-100 bg-sky-50/70 p-4 transition hover:border-sky-200 hover:bg-sky-100/70"
                                >
                                  <button
                                    type="button"
                                    onClick={() => dismissHighDemandAlert(item)}
                                    aria-label={`Dismiss ${item.product_name} high demand alert`}
                                    className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-full text-sky-500 transition hover:bg-white/80 hover:text-sky-700"
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
                                        <div className="truncate text-sm font-black text-slate-900">{item.product_name}</div>
                                      </div>
                                      <div className="mt-1 text-xs text-slate-500">{item.category || 'General'}</div>
                                    </div>
                                    <span className="rounded-full bg-white px-2 py-1 text-[10px] font-black uppercase tracking-widest text-sky-700">
                                      High demand
                                    </span>
                                  </div>

                                  <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
                                    <div className="rounded-xl bg-white px-3 py-2">
                                      <div className="font-bold uppercase tracking-widest text-slate-400">Tomorrow</div>
                                      <div className="mt-1 text-sm font-black text-slate-900">{item.predicted_quantity}</div>
                                    </div>
                                    <div className="rounded-xl bg-white px-3 py-2">
                                      <div className="font-bold uppercase tracking-widest text-slate-400">Average</div>
                                      <div className="mt-1 text-sm font-black text-slate-900">{item.historical_average.toFixed(1)}</div>
                                    </div>
                                    <div className="rounded-xl bg-white px-3 py-2">
                                      <div className="font-bold uppercase tracking-widest text-slate-400">Stock gap</div>
                                      <div className="mt-1 text-sm font-black text-slate-900">{item.stock_gap}</div>
                                    </div>
                                  </div>
                                  <div className="mt-3 rounded-xl bg-white px-3 py-2 text-xs text-slate-600">
                                    <span className="font-black uppercase tracking-widest text-slate-400">Why this alert</span>
                                    <div className="mt-1 text-sm text-slate-700">{getHighDemandReason(item)}</div>
                                  </div>
                                  <div className="mt-3 flex items-center justify-end gap-1 text-xs font-black uppercase tracking-widest text-sky-700">
                                    Open predictions
                                    <ChevronRightIcon className="h-4 w-4" />
                                  </div>
                                  </button>
                                </div>
                              ))
                            )}
                          </div>
                        </>
                      )}
                    </div>

                    <div className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
                      {formatCheckTime(lastAlertCheck)}
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="hidden sm:flex flex-col items-end">
              <span className="leading-none text-sm font-black text-slate-900">{user.full_name}</span>
              <span className="mt-1 text-[10px] font-bold uppercase tracking-widest text-primary">
                {user.role}
              </span>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-slate-100">
              <UserCircleIcon className="h-7 w-7 text-slate-400" />
            </div>
          </div>
        </header>

        <main className="custom-scrollbar flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <div className="mx-auto h-full max-w-7xl">
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
          <nav className="fixed inset-y-0 left-0 flex w-72 flex-col bg-slate-900 shadow-2xl animate-in slide-in-from-left duration-300">
            <div className="flex items-center justify-between p-8">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary font-black text-white">
                  S
                </div>
                <h2 className="text-xl font-bold tracking-tight text-white">SmartCanteen</h2>
              </div>
              <button
                onClick={() => setMobileMenuOpen(false)}
                className="p-1 text-slate-500 hover:text-white"
              >
                <XMarkIcon className="h-6 w-6" />
              </button>
            </div>

            <div className="flex-1 space-y-1 px-4">
              {visibleNavItems.map((item) => (
                <Link
                  key={item.name}
                  to={item.path}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`flex items-center gap-3 rounded-xl px-4 py-3 transition-all ${
                    isActive(item.path)
                      ? 'bg-primary text-white shadow-lg shadow-primary/20'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <item.icon className="h-5 w-5" />
                  <span className="text-sm font-semibold">{item.name}</span>
                </Link>
              ))}
            </div>

            <div className="border-t border-slate-800 p-4">
              <button
                onClick={onLogout}
                className="flex w-full items-center gap-3 rounded-xl px-4 py-3 text-sm font-bold text-slate-400 hover:text-red-400"
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
