import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { API } from '../services/api';

function isOfflineSessionToken(token) {
  return String(token || '').startsWith('offline-session:');
}

export function getStoredToken() {
  try {
    return (
      localStorage.getItem('sc_token') ||
      sessionStorage.getItem('sc_token') ||
      null
    );
  } catch {
    return null;
  }
}

export function getStoredUser() {
  try {
    const raw = localStorage.getItem('sc_user') || sessionStorage.getItem('sc_user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function isTokenExpired(token) {
  if (!token || typeof token !== 'string') return true;
  if (isOfflineSessionToken(token)) {
    return localStorage.getItem('sc_offline_session') !== '1';
  }
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return true;
    let base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4 !== 0) {
      base64 += '=';
    }
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    const payload = JSON.parse(jsonPayload);
    if (!payload || typeof payload !== 'object') return true;
    if (!payload.exp || typeof payload.exp !== 'number') return true;
    const nowSeconds = Math.floor(Date.now() / 1000);
    return payload.exp <= nowSeconds;
  } catch {
    return true;
  }
}

export function shouldRetainSessionOnStartup() {
  try {
    const token = getStoredToken();
    if (!token) return false;
    if (isTokenExpired(token)) {
      // Clear ALL auth state so a cold boot after token expiry
      // never restores a stale "verified" flag.
      try {
        localStorage.removeItem('sc_token');
        localStorage.removeItem('sc_user');
        localStorage.removeItem('sc_remember_me');
        localStorage.removeItem('sc_two_factor_verified');
        localStorage.removeItem('sc_session_active');
        sessionStorage.removeItem('sc_token');
        sessionStorage.removeItem('sc_user');
        sessionStorage.removeItem('sc_session_active');
        sessionStorage.removeItem('sc_two_factor_verified');
      } catch {}
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

const AuthContext = createContext({
  user: null,
  role: null,
  isAuthenticated: false,
  isTwoFactorVerified: false,
  loading: true,
  login: () => {},
  refreshUser: async () => {},
  updateCurrentUser: () => {},
  logout: () => {},
});

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      if (!shouldRetainSessionOnStartup()) {
        return null;
      }
      return getStoredUser();
    } catch {
      return null;
    }
  });

  const [loading, setLoading] = useState(() => {
    try {
      return shouldRetainSessionOnStartup();
    } catch {
      return false;
    }
  });

  const logout = useCallback(() => {
    try {
      localStorage.removeItem('sc_token');
      localStorage.removeItem('sc_user');
      localStorage.removeItem('sc_remember_me');
      localStorage.removeItem('sc_two_factor_verified');
      localStorage.removeItem('sc_background_alert_token');
      localStorage.removeItem('sc_offline_session');
      localStorage.removeItem('sc_session_active');
      sessionStorage.removeItem('sc_token');
      sessionStorage.removeItem('sc_user');
      sessionStorage.removeItem('sc_session_active');
      sessionStorage.removeItem('sc_two_factor_verified');
      sessionStorage.removeItem('sc_pending_authenticator_challenge');
    } catch {}
    setUser(null);
    setLoading(false);
    try {
      API.logout().catch(() => {});
    } catch {}
  }, []);

  const login = useCallback((nextUser, token) => {
    if (token) {
      try {
        localStorage.setItem('sc_token', token);
        sessionStorage.setItem('sc_token', token);
      } catch {}
    }
    if (nextUser) {
      setUser(nextUser);
      try {
        localStorage.setItem('sc_user', JSON.stringify(nextUser));
        sessionStorage.setItem('sc_user', JSON.stringify(nextUser));
      } catch {}
    }
    try {
      sessionStorage.setItem('sc_session_active', 'true');
      localStorage.setItem('sc_session_active', 'true');

      // Only mark 2FA as verified for non-admin users, or admin users who already
      // completed 2FA setup.  Setting this flag unconditionally would let an admin
      // whose authenticator isn't yet configured slip past the mandatory setup gate.
      const isAdminUser = Boolean(
        nextUser?.role &&
          ['admin', 'administrator'].includes(String(nextUser.role).toLowerCase())
      );
      const userHas2FA = Boolean(
        nextUser?.['2fa_enabled'] ||
          nextUser?.two_factor_enabled ||
          nextUser?.authenticator_mfa_enabled
      );
      if (!isAdminUser || userHas2FA) {
        sessionStorage.setItem('sc_two_factor_verified', 'true');
        localStorage.setItem('sc_two_factor_verified', 'true');
      } else {
        // Admin without 2FA configured — clear any stale verified flag.
        sessionStorage.removeItem('sc_two_factor_verified');
        localStorage.removeItem('sc_two_factor_verified');
      }

      sessionStorage.removeItem('sc_pending_authenticator_challenge');
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
        sessionStorage.setItem('sc_user', JSON.stringify(updated));
      } catch {
        // Ignore quota error
      }
      return updated;
    });
  }, []);

  const refreshUser = useCallback(async (opts = {}) => {
    const token = getStoredToken();
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
          localStorage.setItem('sc_token', token);
          sessionStorage.setItem('sc_token', token);
          localStorage.setItem('sc_user', JSON.stringify(dbUser));
          sessionStorage.setItem('sc_user', JSON.stringify(dbUser));
          sessionStorage.setItem('sc_session_active', 'true');
          localStorage.setItem('sc_session_active', 'true');
          const isAdminUser = Boolean(
            dbUser?.role && ['admin', 'administrator'].includes(String(dbUser.role).toLowerCase())
          );
          const has2FA = Boolean(
            dbUser['2fa_enabled'] || dbUser.two_factor_enabled || dbUser.authenticator_mfa_enabled
          );

          if (
            dbUser.two_factor_verified ||
            dbUser.authenticator_mfa_verified ||
            (!isAdminUser && !dbUser.authenticator_mfa_enabled)
          ) {
            sessionStorage.setItem('sc_two_factor_verified', 'true');
            localStorage.setItem('sc_two_factor_verified', 'true');
            sessionStorage.removeItem('sc_pending_authenticator_challenge');
          } else if (isAdminUser && !has2FA) {
            sessionStorage.removeItem('sc_two_factor_verified');
            localStorage.removeItem('sc_two_factor_verified');
          }
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
      const cached = getStoredUser();
      if (cached && cached.role) {
        setUser(cached);
        return cached;
      }
      logout();
      return null;
    } finally {
      setLoading(false);
    }
  }, [logout]);

  // Initial session verification on startup and page refresh
  useEffect(() => {
    if (!shouldRetainSessionOnStartup()) {
      setUser(null);
      setLoading(false);
      return;
    }

    // Token exists and session is valid; verify with server to restore fresh role & permissions
    refreshUser();
  }, [refreshUser]);

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
      const token = getStoredToken();
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
      const token = getStoredToken();
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

  const isAdmin = Boolean(
    user?.role && ['admin', 'administrator'].includes(String(user.role).toLowerCase())
  );
  const is2FAConfigured = Boolean(
    user && (user['2fa_enabled'] || user.two_factor_enabled || user.authenticator_mfa_enabled)
  );

  const isTwoFactorVerified = Boolean(
    user &&
      (isAdmin
        ? is2FAConfigured &&
          (user.two_factor_verified ||
            user.authenticator_mfa_verified ||
            sessionStorage.getItem('sc_two_factor_verified') === 'true' ||
            localStorage.getItem('sc_two_factor_verified') === 'true')
        : !user.authenticator_mfa_enabled ||
          user.two_factor_verified ||
          user.authenticator_mfa_verified ||
          sessionStorage.getItem('sc_two_factor_verified') === 'true' ||
          localStorage.getItem('sc_two_factor_verified') === 'true')
  );

  const value = {
    user,
    role: user?.role || null,
    isAuthenticated: Boolean(user && user.role),
    isTwoFactorVerified,
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
