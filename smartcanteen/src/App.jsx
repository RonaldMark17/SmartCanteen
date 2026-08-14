import { useState } from 'react';
import { BrowserRouter, HashRouter, Link, Navigate, Route, Routes } from 'react-router-dom';

const isDesktopApp =
  typeof window !== 'undefined' &&
  (window.electronAPI?.isElectron || window.location?.protocol === 'file:');

const AppRouter = isDesktopApp ? HashRouter : BrowserRouter;
import Layout from './components/Layout';
import TitleBar from './components/TitleBar';
import Toaster from './components/Toaster';
import AppSplashScreen from './components/AppSplashScreen';
import Login from './views/Login';
import Dashboard from './views/Dashboard';
import POS from './views/POS';
import Inventory from './views/Inventory';
import Analytics from './views/Analytics';
import FinancialReports from './views/FinancialReports';
import Predictions from './views/Predictions';
import AuditLog from './views/AuditLog';
import TransactionHistory from './views/TransactionHistory';
import ManageAccounts from './views/ManageAccounts';
import Settings from './views/Settings';
import { ModuleSettingsProvider } from './contexts/ModuleSettingsContext';
import { useModuleSettings } from './contexts/useModuleSettings';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import {
  APP_ROUTE_ACCESS,
  getDefaultRoute,
  isValidRole,
  isRouteEnabled,
} from './config/access';
import { getModuleLabel } from './config/modules';

function ModuleDisabled({ moduleLabel, fallbackPath }) {
  return (
    <div className="view-shell">
      <div className="panel-card flex min-h-[320px] flex-col justify-center">
        <div className="max-w-2xl">
          <div className="text-sm font-black uppercase tracking-widest text-primary">
            Module disabled
          </div>
          <h1 className="mt-3 text-2xl font-black text-slate-950 dark:text-white">
            This module is currently disabled by the Administrator.
          </h1>
          <p className="mt-3 text-base leading-7 text-slate-600 dark:text-slate-300">
            {moduleLabel} is still installed and its data is preserved. An administrator can enable it again from Module Management.
          </p>
          <Link to={fallbackPath} className="primary-action-button mt-6 w-fit">
            Return to workspace
          </Link>
        </div>
      </div>
    </div>
  );
}

function ModuleSettingsLoading() {
  return (
    <div className="view-shell">
      <div className="panel-card flex min-h-[220px] items-center justify-center text-sm font-semibold text-slate-500 dark:text-slate-400">
        Loading module settings...
      </div>
    </div>
  );
}

function RoleRoute({ route, role, fallbackPath, element }) {
  const { modules, loading } = useModuleSettings();

  if (!route.allowedRoles.includes(role)) {
    return <Navigate to={fallbackPath} replace />;
  }

  if (loading) {
    return <ModuleSettingsLoading />;
  }

  if (!isRouteEnabled(route, modules)) {
    return (
      <ModuleDisabled
        moduleLabel={getModuleLabel(route.moduleKey)}
        fallbackPath={fallbackPath}
      />
    );
  }

  return element;
}

function AuthenticatedWorkspace() {
  const { role, logout } = useAuth();
  const { modules } = useModuleSettings();
  const defaultRoute = getDefaultRoute(role, modules);
  const routeElements = {
    dashboard: <Dashboard />,
    pos: <POS />,
    inventory: <Inventory />,
    analytics: <Analytics />,
    financialReports: <FinancialReports mode="financial" />,
    dailySales: <FinancialReports mode="daily-sales" />,
    expenseManagement: <FinancialReports mode="expenses" />,
    schoolYearManagement: <FinancialReports mode="school-years" />,
    reports: <FinancialReports mode="reports" />,
    transactions: <TransactionHistory />,
    predictions: <Predictions />,
    audit: <AuditLog />,
    accounts: <ManageAccounts />,
    settings: <Settings />,
  };

  return (
    <Layout onLogout={logout}>
      <Routes>
        <Route path="/" element={<Navigate to={defaultRoute} replace />} />

        {APP_ROUTE_ACCESS.map((route) => (
          <Route
            key={route.key}
            path={route.path}
            element={
              <RoleRoute
                route={route}
                role={role}
                fallbackPath={defaultRoute}
                element={routeElements[route.key]}
              />
            }
          />
        ))}

        <Route path="/inventory/inactive" element={<Navigate to="/inventory" replace />} />

        <Route path="*" element={<Navigate to={defaultRoute} replace />} />
      </Routes>
    </Layout>
  );
}

function AppContent() {
  const { isAuthenticated, role, loading, refreshUser } = useAuth();
  const [splashFinished, setSplashFinished] = useState(false);

  if (loading || !splashFinished) {
    return <AppSplashScreen onFinished={() => setSplashFinished(true)} />;
  }

  if (!isAuthenticated || !isValidRole(role)) {
    return (
      <>
        <Toaster />
        <Login onLogin={() => refreshUser()} />
      </>
    );
  }

  return (
    <>
      <Toaster />
      <ModuleSettingsProvider>
        <AuthenticatedWorkspace />
      </ModuleSettingsProvider>
    </>
  );
}

export default function App() {
  return (
    <AppRouter>
      <AuthProvider>
        <div className="flex h-screen w-screen flex-col overflow-hidden bg-slate-50 text-slate-900 antialiased dark:bg-slate-950 dark:text-slate-100">
          <TitleBar />
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <AppContent />
          </div>
        </div>
      </AuthProvider>
    </AppRouter>
  );
}
