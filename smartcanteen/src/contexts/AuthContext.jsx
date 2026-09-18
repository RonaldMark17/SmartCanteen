import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { API } from '../services/api';

function isOfflineSessionToken(token) {
  return String(token || '').startsWith('offline-session:');
}

const REFRESH_TOKEN_STORAGE_KEY = 'sc_refresh_token';
const REMEMBER_ME_STORAGE_KEY = 'sc_remember_me';

function isRememberedSession() {
  try {
    return (
      localStorage.getItem(REMEMBER_ME_STORAGE_KEY) === 'true' ||
      Boolean(localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY))
    );
  } catch {
    return false;
  }
}

function getStoredRefreshToken() {
  try {
    return (
      localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY) ||
      sessionStorage.getItem(REFRESH_TOKEN_STORAGE_KEY) ||
      null
    );
  } catch {
    return null;
  }
}

export function getStoredToken() {
  try {
    // 1. Session storage (active tab session)
    const sessionToken = sessionStorage.getItem('sc_token');
    if (sessionToken && !isTokenExpired(sessionToken)) {
      return sessionToken;
    }
    // 2. Local storage (remembered / persistent session)
    const localToken = localStorage.getItem('sc_token');
    if (localToken && !isTokenExpired(localToken)) {
      return localToken;
    }
    // 3. Fallback to either token if present (e.g. for silent refresh if near expiry)
    return sessionToken || localToken || null;
  } catch {
    return null;
  }
}

export function getStoredUser() {
  try {
    const raw =
      sessionStorage.getItem('sc_user') ||
      localStorage.getItem('sc_user') ||
      null;
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
    const cleaned = token.trim().replace(/^["']|["']$/g, '');
    const parts = cleaned.split('.');
    if (parts.length !== 3) return true;
    let base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4 !== 0) {
      base64 += '=';
    }
    let jsonPayload;
    try {
      jsonPayload = decodeURIComponent(
        atob(base64)
          .split('')
          .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
          .join('')
      );
    } catch {
      jsonPayload = atob(base64);
    }
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
    const sessionToken = sessionStorage.getItem('sc_token');
    const localToken = localStorage.getItem('sc_token');
    const refreshToken = getStoredRefreshToken();
    const token = getStoredToken();

    console.log('[MEALS AUTH] shouldRetainSessionOnStartup check:', {
      hasSessionToken: Boolean(sessionToken),
      hasLocalToken: Boolean(localToken),
      resolvedToken: Boolean(token),
      tokenExpired: token ? isTokenExpired(token) : null,
      hasRefreshToken: Boolean(refreshToken),
      isRemembered: isRememberedSession(),
    });

    if (token && !isTokenExpired(token)) {
      return true;
    }

    // A remembered session can silently rotate an expired access token.
    if (refreshToken && isRememberedSession()) {
      return true;
    }

    return false;
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

  const logout = useCallback((reason = 'manual') => {
    console.log('[MEALS AUTH] logout() called. Reason:', reason);
    const isSilentSessionExpiry =
      reason === 'http_unauthorized' ||
      reason === 'session_expired' ||
      reason === 'token_invalid_after_refresh' ||
      reason === 'token_expired_no_refresh';

    if (!isSilentSessionExpiry) {
      try {
        // Start server-side revocation while the refresh token is still available.
        API.logout().catch(() => {});
      } catch {}
    }
    try {
      localStorage.removeItem('sc_token');
      localStorage.removeItem('sc_user');
      localStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY);
      localStorage.removeItem(REMEMBER_ME_STORAGE_KEY);
      localStorage.removeItem('sc_two_factor_verified');
      localStorage.removeItem('sc_background_alert_token');
      localStorage.removeItem('sc_offline_session');
      localStorage.removeItem('sc_session_active');
      sessionStorage.removeItem('sc_token');
      sessionStorage.removeItem('sc_user');
      sessionStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY);
      sessionStorage.removeItem(REMEMBER_ME_STORAGE_KEY);
      sessionStorage.removeItem('sc_session_active');
      sessionStorage.removeItem('sc_two_factor_verified');
      sessionStorage.removeItem('sc_pending_authenticator_challenge');
    } catch {}
    setUser(null);
    setLoading(false);
  }, []);

  const login = useCallback((nextUser, token, rememberMe = null) => {
    const persistent =
      rememberMe === null || rememberMe === undefined
        ? isRememberedSession()
        : Boolean(rememberMe);
    try {
      if (persistent) {
        localStorage.setItem(REMEMBER_ME_STORAGE_KEY, 'true');
        if (token) localStorage.setItem('sc_token', token);
        if (nextUser) localStorage.setItem('sc_user', JSON.stringify(nextUser));
        localStorage.setItem('sc_session_active', 'true');
        sessionStorage.removeItem('sc_token');
        sessionStorage.removeItem('sc_user');
        sessionStorage.removeItem('sc_session_active');
      } else {
        localStorage.removeItem('sc_token');
        localStorage.removeItem('sc_user');
        localStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY);
        localStorage.removeItem(REMEMBER_ME_STORAGE_KEY);
        localStorage.removeItem('sc_session_active');
        if (token) sessionStorage.setItem('sc_token', token);
        if (nextUser) sessionStorage.setItem('sc_user', JSON.stringify(nextUser));
        sessionStorage.setItem('sc_session_active', 'true');
      }

      // Only mark 2FA as verified for non-admin users, or admin users who already
      // completed 2FA setup. Setting this flag unconditionally would let an admin
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
      const targetStorage = persistent ? localStorage : sessionStorage;
      const otherStorage = persistent ? sessionStorage : localStorage;
      if (!isAdminUser || userHas2FA) {
        targetStorage.setItem('sc_two_factor_verified', 'true');
        otherStorage.removeItem('sc_two_factor_verified');
      } else {
        targetStorage.removeItem('sc_two_factor_verified');
        otherStorage.removeItem('sc_two_factor_verified');
      }
      sessionStorage.removeItem('sc_pending_authenticator_challenge');
    } catch {}
    if (nextUser) setUser(nextUser);
    setLoading(false);
  }, []);

  const updateCurrentUser = useCallback((nextDetails) => {
    if (!nextDetails || typeof nextDetails !== 'object') return;
    setUser((prev) => {
      if (!prev) return nextDetails;
      const updated = { ...prev, ...nextDetails };
      try {
        const storage = isRememberedSession() ? localStorage : sessionStorage;
        storage.setItem('sc_user', JSON.stringify(updated));
      } catch {
        // Ignore quota error
      }
      return updated;
    });
  }, []);

  const refreshUser = useCallback(async () => {
    let token = getStoredToken();
    let dbUser = null;
    console.log('[MEALS AUTH] refreshUser() executing, token present:', Boolean(token));

    try {
      if (!token || isTokenExpired(token)) {
        console.log('[MEALS AUTH] Access token missing or expired, checking for refresh token...');
        const refreshToken = getStoredRefreshToken();
        if (!refreshToken) {
          console.warn('[MEALS AUTH] No refresh token available to rotate -> calling logout()');
          logout('token_expired_no_refresh');
          return null;
        }

        console.log('[MEALS AUTH] Rotating expired session with refresh token...');
        try {
          const refreshed = await API.refreshSession();
          token = refreshed?.access_token || getStoredToken();
          dbUser = refreshed?.user || null;
        } catch (refreshErr) {
          console.warn('[MEALS AUTH] Session refresh failed -> clearing session:', refreshErr?.message || refreshErr);
          logout('session_expired');
          return null;
        }
      }

      if (!token || isTokenExpired(token)) {
        console.warn('[MEALS AUTH] Token still missing/expired after refresh attempt -> calling logout()');
        logout('token_invalid_after_refresh');
        return null;
      }

      if (!dbUser) {
        console.log('[MEALS AUTH] Validating session with GET /api/auth/me...');
        dbUser = await API.getCurrentUser();
        console.log('[MEALS AUTH] /api/auth/me returned:', dbUser ? `${dbUser.username} (${dbUser.role})` : null);
      }

      if (dbUser && dbUser.role) {
        setUser(dbUser);
        try {
          const persistent = isRememberedSession();
          const targetStorage = persistent ? localStorage : sessionStorage;
          const otherStorage = persistent ? sessionStorage : localStorage;
          targetStorage.setItem('sc_token', token);
          targetStorage.setItem('sc_user', JSON.stringify(dbUser));
          targetStorage.setItem('sc_session_active', 'true');
          otherStorage.removeItem('sc_token');
          otherStorage.removeItem('sc_user');
          otherStorage.removeItem('sc_session_active');
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
            targetStorage.setItem('sc_two_factor_verified', 'true');
            otherStorage.removeItem('sc_two_factor_verified');
            sessionStorage.removeItem('sc_pending_authenticator_challenge');
          } else if (isAdminUser && !has2FA) {
            targetStorage.removeItem('sc_two_factor_verified');
            otherStorage.removeItem('sc_two_factor_verified');
          }
        } catch {}
        return dbUser;
      }

      console.warn('[MEALS AUTH] /api/auth/me did not return a valid user with role -> calling logout()');
      logout('invalid_user_response');
      return null;
    } catch (err) {
      console.warn('[MEALS AUTH] refreshUser caught error:', err);
      if (err?.status === 401 || err?.status === 403) {
        // If an authenticated request to /auth/me failed with 401/403, try silent refresh
        if (token && getStoredRefreshToken()) {
          try {
            console.log('[MEALS AUTH] 401/403 on getCurrentUser, trying API.refreshSession()...');
            const refreshed = await API.refreshSession();
            if (refreshed?.access_token && refreshed?.user) {
              setUser(refreshed.user);
              return refreshed.user;
            }
          } catch {}
        }
        console.warn('[MEALS AUTH] 401/403 unrecoverable -> calling logout()');
        logout('http_unauthorized');
        return null;
      }
      // A temporary network problem should not erase an otherwise valid local session.
      const cached = getStoredUser();
      if (cached && cached.role) {
        console.log('[MEALS AUTH] Network issue, maintaining cached user session:', cached.username);
        setUser(cached);
        return cached;
      }
      console.warn('[MEALS AUTH] Network error with no cached user session -> calling logout()');
      logout('network_no_cached_session');
      return null;
    } finally {
      setLoading(false);
    }
  }, [logout]);

  // Initial session verification on startup and page refresh
  useEffect(() => {
    const shouldRetain = shouldRetainSessionOnStartup();
    console.log('[MEALS AUTH] Startup verification useEffect, shouldRetain:', shouldRetain);
    if (!shouldRetain) {
      console.log('[MEALS AUTH] No session to restore -> unauthenticated state set');
      setUser(null);
      setLoading(false);
      return;
    }

    // Token exists and session is valid; verify with server to restore fresh role & permissions
    console.log('[MEALS AUTH] Stored session detected -> restoring user & validating with server...');
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
      if (getStoredToken() || getStoredRefreshToken()) {
        refreshUser();
      }
    };

    window.addEventListener('meals-user-updated', handleUserUpdatedEvent);
    window.addEventListener('meals-session-expired', handleSessionExpiredEvent);
    window.addEventListener('storage', handleStorageEvent);
    window.addEventListener('focus', handleWindowFocus);

    // Periodically verify the active session. Expired remembered access tokens are
    // refreshed silently; session-only logins still end when their browser session ends.
    const intervalId = window.setInterval(() => {
      if (
        document.visibilityState !== 'hidden' &&
        (getStoredToken() || getStoredRefreshToken())
      ) {
        refreshUser();
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
