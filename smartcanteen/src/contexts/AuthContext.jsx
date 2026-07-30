import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { API } from '../services/api';

const AuthContext = createContext({
  user: null,
  role: null,
  isAuthenticated: false,
  loading: true,
  refreshUser: async () => {},
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
        // Store as UI display cache only - server remain source of truth
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

  const value = {
    user,
    role: user?.role || null,
    isAuthenticated: Boolean(user && user.role),
    loading,
    refreshUser,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
