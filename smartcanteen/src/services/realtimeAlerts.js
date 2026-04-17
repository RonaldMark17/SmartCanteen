import { getRealtimeAlertsUrl } from './api';

export const ALERT_REFRESH_EVENT = 'sc-alert-refresh-requested';

const REALTIME_ALERT_TYPES = new Set(['alerts.changed', 'stock.changed']);
const RECONNECT_DELAY_MS = 5000;

export function requestAlertRefresh(detail = {}) {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(
    new CustomEvent(ALERT_REFRESH_EVENT, {
      detail: {
        requestedAt: new Date().toISOString(),
        ...detail,
      },
    })
  );
}

function isRealtimeAlertMessage(message) {
  return REALTIME_ALERT_TYPES.has(message?.type);
}

export function connectRealtimeAlertStream(onAlertChange) {
  if (typeof window === 'undefined' || typeof WebSocket === 'undefined') {
    return () => {};
  }

  let socket = null;
  let reconnectTimer = null;
  let closed = false;

  const clearReconnect = () => {
    if (reconnectTimer) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const scheduleReconnect = () => {
    if (closed || reconnectTimer) {
      return;
    }

    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, RECONNECT_DELAY_MS);
  };

  const connect = () => {
    if (closed) {
      return;
    }

    if (
      socket &&
      (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN)
    ) {
      return;
    }

    const url = getRealtimeAlertsUrl();
    if (!url || !navigator.onLine) {
      scheduleReconnect();
      return;
    }

    try {
      socket = new WebSocket(url);
    } catch {
      scheduleReconnect();
      return;
    }

    socket.onopen = clearReconnect;
    socket.onmessage = (event) => {
      let message = null;

      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }

      if (isRealtimeAlertMessage(message)) {
        onAlertChange?.(message);
      }
    };
    socket.onerror = () => {
      socket?.close();
    };
    socket.onclose = scheduleReconnect;
  };

  const handleOnline = () => {
    clearReconnect();
    if (!socket || socket.readyState === WebSocket.CLOSED) {
      connect();
    }
  };

  const handleOffline = () => {
    socket?.close();
  };

  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);
  connect();

  return () => {
    closed = true;
    clearReconnect();
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);

    if (socket && socket.readyState < WebSocket.CLOSING) {
      socket.close();
    }
    socket = null;
  };
}
