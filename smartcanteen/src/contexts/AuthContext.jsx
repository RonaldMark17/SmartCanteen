import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { API } from '../services/api';

const AuthContext = createContext({
  user: null,
  role: null,
  isAuthenticated: false,
  loading: true,
  refreshUser: async () => {},
  updateCurrentUser: () => {},
  logout: () => {},
});

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const logout = useCallback(() => {
    localStorage.removeItem('sc_token');
    localStorage.removeItem('sc_user');
    localStorage.removeItem('sc_background_alert_token');
    localStorage.removeItem('sc_offline_session');
    setUser(null);
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

  const refreshUser = useCallback(async () => {
    const token = localStorage.getItem('sc_token');
    if (!token) {
      setUser(null);
      setLoading(false);
      return null;
    }

    try {
      const dbUser = await API.getCurrentUser();
      if (dbUser && dbUser.role) {
        setUser(dbUser);
        // Store as UI display cache only - server remains source of truth
        try {
          localStorage.setItem('sc_user', JSON.stringify(dbUser));
        } catch {
          // Ignore quota error
        }
        return dbUser;
      } else {
        logout();
        return null;
      }
    } catch (err) {
      if (err?.status === 401 || err?.status === 403) {
        logout();
      }
      return null;
    } finally {
      setLoading(false);
    }
  }, [logout]);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  // Real-time synchronization: custom event, window focus, storage events, and 30s background sync
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
      if (localStorage.getItem('sc_token')) {
        refreshUser();
      }
    };

    window.addEventListener('meals-user-updated', handleUserUpdatedEvent);
    window.addEventListener('storage', handleStorageEvent);
    window.addEventListener('focus', handleWindowFocus);

    // Periodic sync every 30 seconds for active sessions
    const intervalId = window.setInterval(() => {
      if (localStorage.getItem('sc_token') && document.visibilityState !== 'hidden') {
        refreshUser();
      }
    }, 30000);

    return () => {
      window.removeEventListener('meals-user-updated', handleUserUpdatedEvent);
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
    refreshUser,
    updateCurrentUser,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
