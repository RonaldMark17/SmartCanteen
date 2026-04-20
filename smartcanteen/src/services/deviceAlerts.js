import { Capacitor, registerPlugin } from '@capacitor/core';
import { getCurrentApiBase } from './api';

const LOW_STOCK_CHANNEL_ID = 'low-stock-alerts';
const HIGH_DEMAND_CHANNEL_ID = 'high-demand-alerts';
const BackgroundAlerts = registerPlugin('SmartCanteenBackgroundAlerts');
let nativeNotificationSeed = Date.now() % 2147483000;

function nextNativeNotificationId() {
  nativeNotificationSeed = (nativeNotificationSeed + 1) % 2147483000;
  return nativeNotificationSeed || 1;
}

function buildLowStockTitle(items) {
  return items.length === 1 ? 'Low stock alert' : `${items.length} low stock alerts`;
}

function buildLowStockBody(items) {
  const names = items.slice(0, 3).map((item) => item.name).join(', ');
  const extraCount = Math.max(0, items.length - 3);

  if (extraCount > 0) {
    return `${names}, and ${extraCount} more items need attention.`;
  }

  return `${names} need restocking soon.`;
}

function buildHighDemandTitle(items) {
  return items.length === 1 ? 'High demand tomorrow' : `${items.length} high demand items tomorrow`;
}

function getHighDemandItemName(item, index) {
  return item?.product_name || item?.name || `Product ${index + 1}`;
}

function buildHighDemandBody(items) {
  const names = items
    .slice(0, 3)
    .map((item, index) => `${getHighDemandItemName(item, index)} (${item.predicted_quantity})`)
    .join(', ');
  const extraCount = Math.max(0, items.length - 3);

  if (extraCount > 0) {
    return `${names}, and ${extraCount} more items may sell faster than usual tomorrow.`;
  }

  return `${names} may sell faster than usual tomorrow.`;
}

async function showWebNotification(title, options = {}) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
    return false;
  }

  if ('serviceWorker' in navigator) {
    try {
      const registration = await navigator.serviceWorker.ready;
      await registration.showNotification(title, options);
      return true;
    } catch {
      // Fall through to the direct Notification API.
    }
  }

  new Notification(title, options);
  return true;
}

function normalizePermission(value) {
  if (value === 'prompt-with-rationale') {
    return 'prompt';
  }

  return value || 'prompt';
}

async function ensureNativeChannel(LocalNotifications, channel) {
  try {
    await LocalNotifications.createChannel({
      id: channel.id,
      name: channel.name,
      description: channel.description,
      importance: 5,
      visibility: 1,
    });
  } catch {
    // Ignore channel creation failures and fall back to the default channel.
  }
}

export async function getAlertPermissionStatus() {
  if (Capacitor.isNativePlatform()) {
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      const permission = await LocalNotifications.checkPermissions();
      return normalizePermission(permission.display);
    } catch {
      return 'unsupported';
    }
  }

  if (typeof Notification === 'undefined') {
    return 'unsupported';
  }

  return normalizePermission(Notification.permission);
}

export async function requestAlertPermission() {
  if (Capacitor.isNativePlatform()) {
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      const permission = await LocalNotifications.requestPermissions();
      await ensureNativeChannel(LocalNotifications, {
        id: LOW_STOCK_CHANNEL_ID,
        name: 'Low Stock Alerts',
        description: 'Inventory warnings when products drop below minimum stock',
      });
      await ensureNativeChannel(LocalNotifications, {
        id: HIGH_DEMAND_CHANNEL_ID,
        name: 'High Demand Alerts',
        description: 'Forecast warnings for items expected to sell fast tomorrow',
      });
      return normalizePermission(permission.display);
    } catch {
      return 'unsupported';
    }
  }

  if (typeof Notification === 'undefined') {
    return 'unsupported';
  }

  const permission = await Notification.requestPermission();
  return normalizePermission(permission);
}

export async function configureBackgroundAlertChecks() {
  if (!Capacitor.isNativePlatform()) {
    return false;
  }

  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    const permission = await LocalNotifications.checkPermissions();
    if (normalizePermission(permission.display) !== 'granted') {
      return false;
    }

    const token = localStorage.getItem('sc_background_alert_token') || '';
    if (!token) {
      return false;
    }

    await BackgroundAlerts.configure({
      token,
      apiBase: getCurrentApiBase(),
      enabled: true,
    });
    return true;
  } catch {
    return false;
  }
}

export async function stopBackgroundAlertChecks() {
  if (!Capacitor.isNativePlatform()) {
    return false;
  }

  try {
    await BackgroundAlerts.stop();
    return true;
  } catch {
    return false;
  }
}

export async function sendLowStockDeviceAlert(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return false;
  }

  const title = buildLowStockTitle(items);
  const body = buildLowStockBody(items);

  if (Capacitor.isNativePlatform()) {
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      const permission = await LocalNotifications.checkPermissions();
      if (normalizePermission(permission.display) !== 'granted') {
        return false;
      }

      await ensureNativeChannel(LocalNotifications, {
        id: LOW_STOCK_CHANNEL_ID,
        name: 'Low Stock Alerts',
        description: 'Inventory warnings when products drop below minimum stock',
      });
      await LocalNotifications.schedule({
        notifications: [
          {
            id: nextNativeNotificationId(),
            title,
            body,
            channelId: LOW_STOCK_CHANNEL_ID,
            schedule: { at: new Date(Date.now() + 1000) },
          },
        ],
      });
      return true;
    } catch {
      return false;
    }
  }

  return showWebNotification(title, {
    body,
    tag: LOW_STOCK_CHANNEL_ID,
    data: { url: '/inventory' },
  });
}

export async function sendHighDemandDeviceAlert(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return false;
  }

  const title = buildHighDemandTitle(items);
  const body = buildHighDemandBody(items);

  if (Capacitor.isNativePlatform()) {
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      const permission = await LocalNotifications.checkPermissions();
      if (normalizePermission(permission.display) !== 'granted') {
        return false;
      }

      await ensureNativeChannel(LocalNotifications, {
        id: HIGH_DEMAND_CHANNEL_ID,
        name: 'High Demand Alerts',
        description: 'Forecast warnings for items expected to sell fast tomorrow',
      });
      await LocalNotifications.schedule({
        notifications: [
          {
            id: nextNativeNotificationId(),
            title,
            body,
            channelId: HIGH_DEMAND_CHANNEL_ID,
            schedule: { at: new Date(Date.now() + 1000) },
          },
        ],
      });
      return true;
    } catch {
      return false;
    }
  }

  return showWebNotification(title, {
    body,
    tag: HIGH_DEMAND_CHANNEL_ID,
    data: { url: '/predictions' },
  });
}
