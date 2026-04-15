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

const ROLE_DEFAULT_ROUTES = {
  admin: '/dashboard',
  staff: '/inventory',
  cashier: '/pos',
};

function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem('sc_user') || '{}');
  } catch {
    return {};
  }
}

function getDefaultRoute(role) {
  return ROLE_DEFAULT_ROUTES[role] || '/pos';
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
  const validRoles = Object.keys(ROLE_DEFAULT_ROUTES);

  if (!validRoles.includes(role)) {
    clearSession();
    return (
      <>
        <Toaster />
        <Login onLogin={() => setIsAuthenticated(true)} />
      </>
    );
  }

  const defaultRoute = getDefaultRoute(role);

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

          <Route
            path="/dashboard"
            element={
              <RoleRoute
                allowedRoles={['admin', 'staff', 'cashier']}
                role={role}
                fallbackPath={defaultRoute}
                element={<Dashboard />}
              />
            }
          />
          <Route
            path="/pos"
            element={
              <RoleRoute
                allowedRoles={['admin', 'staff', 'cashier']}
                role={role}
                fallbackPath={defaultRoute}
                element={<POS />}
              />
            }
          />
          <Route
            path="/inventory"
            element={
              <RoleRoute
                allowedRoles={['admin', 'staff', 'cashier']}
                role={role}
                fallbackPath={defaultRoute}
                element={<Inventory />}
              />
            }
          />
          <Route
            path="/analytics"
            element={
              <RoleRoute
                allowedRoles={['admin', 'staff', 'cashier']}
                role={role}
                fallbackPath={defaultRoute}
                element={<Analytics />}
              />
            }
          />
          <Route
            path="/transactions"
            element={
              <RoleRoute
                allowedRoles={['admin', 'staff', 'cashier']}
                role={role}
                fallbackPath={defaultRoute}
                element={<TransactionHistory />}
              />
            }
          />
          <Route
            path="/predictions"
            element={
              <RoleRoute
                allowedRoles={['admin', 'staff', 'cashier']}
                role={role}
                fallbackPath={defaultRoute}
                element={<Predictions />}
              />
            }
          />
          <Route
            path="/audit"
            element={
              <RoleRoute
                allowedRoles={['admin']}
                role={role}
                fallbackPath={defaultRoute}
                element={<AuditLog />}
              />
            }
          />

          <Route path="*" element={<Navigate to={defaultRoute} replace />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
