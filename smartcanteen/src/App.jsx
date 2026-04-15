import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { useState } from 'react';
import Layout from './components/Layout';
import Toaster from './components/Toaster';
import Login from './views/Login';
import Dashboard from './views/Dashboard';
import POS from './views/POS';
import Inventory from './views/Inventory';
import Analytics from './views/Analytics';
import Predictions from './views/Predictions';
import AuditLog from './views/AuditLog';
import TransactionHistory from './views/TransactionHistory';
import {
  APP_ROUTE_ACCESS,
  getDefaultRoute,
  isValidRole,
} from './config/access';

function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem('sc_user') || '{}');
  } catch {
    return {};
  }
}

function clearSession() {
  localStorage.removeItem('sc_token');
  localStorage.removeItem('sc_user');
  localStorage.removeItem('sc_offline_session');
}

function RoleRoute({ allowedRoles, role, fallbackPath, element }) {
  if (!allowedRoles.includes(role)) {
    return <Navigate to={fallbackPath} replace />;
  }

  return element;
}

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(!!localStorage.getItem('sc_token'));

  if (!isAuthenticated) {
    return (
      <>
        <Toaster />
        <Login onLogin={() => setIsAuthenticated(true)} />
      </>
    );
  }

  const user = getStoredUser();
  const role = user.role;

  if (!isValidRole(role)) {
    clearSession();
    return (
      <>
        <Toaster />
        <Login onLogin={() => setIsAuthenticated(true)} />
      </>
    );
  }

  const defaultRoute = getDefaultRoute(role);
  const routeElements = {
    dashboard: <Dashboard />,
    pos: <POS />,
    inventory: <Inventory />,
    analytics: <Analytics />,
    transactions: <TransactionHistory />,
    predictions: <Predictions />,
    audit: <AuditLog />,
  };

  return (
    <BrowserRouter>
      <Toaster />

      <Layout
        onLogout={() => {
          clearSession();
          setIsAuthenticated(false);
        }}
      >
        <Routes>
          <Route path="/" element={<Navigate to={defaultRoute} replace />} />

          {APP_ROUTE_ACCESS.map((route) => (
            <Route
              key={route.key}
              path={route.path}
              element={
                <RoleRoute
                  allowedRoles={route.allowedRoles}
                  role={role}
                  fallbackPath={defaultRoute}
                  element={routeElements[route.key]}
                />
              }
            />
          ))}

          <Route path="*" element={<Navigate to={defaultRoute} replace />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
