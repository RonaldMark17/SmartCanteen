import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { API } from '../services/api';

function isOfflineSessionToken(token) {
  return String(token || '').startsWith('offline-session:');
}

export function isTokenExpired(token) {
  if (!token || typeof token !== 'string') return true;
  if (isOfflineSessionToken(token)) {
    return localStorage.getItem('sc_offline_session') !== '1';
  }
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    const payload = JSON.parse(jsonPayload);
    if (!payload.exp) return false;
    const nowSeconds = Math.floor(Date.now() / 1000);
    return payload.exp <= nowSeconds;
  } catch {
    return false;
  }
}

const AuthContext = createContext({
  user: null,
  role: null,
  isAuthenticated: false,
  loading: true,
  login: () => {},
  refreshUser: async () => {},
  updateCurrentUser: () => {},
  logout: () => {},
});

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      const token = localStorage.getItem('sc_token');
      if (!token || isTokenExpired(token)) {
        return null;
      }
      const cached = localStorage.getItem('sc_user');
      return cached ? JSON.parse(cached) : null;
    } catch {
      return null;
    }
  });

  const [loading, setLoading] = useState(() => {
    try {
      const token = localStorage.getItem('sc_token');
      return Boolean(token && !isTokenExpired(token));
    } catch {
      return false;
    }
  });

  const logout = useCallback(() => {
    localStorage.removeItem('sc_token');
    localStorage.removeItem('sc_user');
    localStorage.removeItem('sc_background_alert_token');
    localStorage.removeItem('sc_offline_session');
    try {
      sessionStorage.removeItem('sc_session_active');
    } catch {}
    setUser(null);
    setLoading(false);
  }, []);

  const login = useCallback((nextUser, token) => {
    if (token) {
      try {
        localStorage.setItem('sc_token', token);
      } catch {}
    }
    if (nextUser) {
      setUser(nextUser);
      try {
        localStorage.setItem('sc_user', JSON.stringify(nextUser));
      } catch {}
    }
    try {
      sessionStorage.setItem('sc_session_active', 'true');
    } catch {}
    setLoading(false);
  }, []);

  const updateCurrentUser = useCallback((nextDetails) => {
    if (!nextDetails || typeof nextDetails !== 'object') return;
    setUser((prev) => {
      if (!prev) return nextDetails;
      const updated = { ...prev, ...nextDetails };
      try {
        localStorage.setItem('sc_user', JSON.stringify(updated));
      } catch {
        // Ignore quota error
      }
      return updated;
    });
  }, []);

  const refreshUser = useCallback(async (opts = {}) => {
    const token = localStorage.getItem('sc_token');
    if (!token) {
      setUser(null);
      setLoading(false);
      return null;
    }

    if (isTokenExpired(token)) {
      logout();
      return null;
    }

    try {
      const dbUser = await API.getCurrentUser();
      if (dbUser && dbUser.role) {
        setUser(dbUser);
        try {
          localStorage.setItem('sc_user', JSON.stringify(dbUser));
        } catch {}
        return dbUser;
      } else if (dbUser === null) {
        // Explicit 401 response from server
        logout();
        return null;
      }
    } catch (err) {
      if (err?.status === 401 || err?.status === 403) {
        logout();
        return null;
      }
      // If network / connectivity error, retain cached user session if present and token valid
      console.warn('Backend check failed during session verification, keeping cached session if active:', err);
      const cached = localStorage.getItem('sc_user');
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          if (parsed?.role) {
            setUser(parsed);
            return parsed;
          }
        } catch {}
      }
      logout();
      return null;
    } finally {
      setLoading(false);
    }
  }, [logout]);

  // Initial session verification on startup and page refresh
  useEffect(() => {
    const token = localStorage.getItem('sc_token');
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }

    if (isTokenExpired(token)) {
      logout();
      return;
    }

    // Token exists and is not expired; verify with server to restore fresh role & permissions
    refreshUser();
  }, [refreshUser, logout]);

  // Real-time synchronization: custom events, storage events, window focus, and token expiry monitoring
  useEffect(() => {
    const handleUserUpdatedEvent = (event) => {
      const updated = event?.detail;
      if (!updated) return;
      setUser((current) => {
        if (!current) return current;
        if (updated.id && current.id && updated.id !== current.id) {
          return current;
        }
        const merged = { ...current, ...updated };
        try {
          localStorage.setItem('sc_user', JSON.stringify(merged));
        } catch {}
        return merged;
      });
    };

    const handleSessionExpiredEvent = () => {
      logout();
    };

    const handleStorageEvent = (event) => {
      if (event.key === 'sc_user' && event.newValue) {
        try {
          const parsed = JSON.parse(event.newValue);
          if (parsed && parsed.role) {
            setUser(parsed);
          }
        } catch {}
      } else if (event.key === 'sc_token' && !event.newValue) {
        logout();
      }
    };

    const handleWindowFocus = () => {
      const token = localStorage.getItem('sc_token');
      if (token) {
        if (isTokenExpired(token)) {
          logout();
          return;
        }
        refreshUser();
      }
    };

    window.addEventListener('meals-user-updated', handleUserUpdatedEvent);
    window.addEventListener('meals-session-expired', handleSessionExpiredEvent);
    window.addEventListener('storage', handleStorageEvent);
    window.addEventListener('focus', handleWindowFocus);

    // Periodic sync & token expiry check every 30 seconds for active sessions
    const intervalId = window.setInterval(() => {
      const token = localStorage.getItem('sc_token');
      if (token) {
        if (isTokenExpired(token)) {
          logout();
          window.showToast?.('Your session has expired. Please sign in again.', 'warning');
          return;
        }
        if (document.visibilityState !== 'hidden') {
          refreshUser();
        }
      }
    }, 30000);

    return () => {
      window.removeEventListener('meals-user-updated', handleUserUpdatedEvent);
      window.removeEventListener('meals-session-expired', handleSessionExpiredEvent);
      window.removeEventListener('storage', handleStorageEvent);
      window.removeEventListener('focus', handleWindowFocus);
      window.clearInterval(intervalId);
    };
  }, [logout, refreshUser]);

  const value = {
    user,
    role: user?.role || null,
    isAuthenticated: Boolean(user && user.role),
    loading,
    login,
    refreshUser,
    updateCurrentUser,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
