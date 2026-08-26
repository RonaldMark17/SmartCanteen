import {
  MODULE_KEYS,
  areModulesEnabled,
  normalizeModuleSettings,
} from './modules';

export const ROLE_DEFAULT_ROUTES = {
  admin: '/dashboard',
  staff: '/inventory',
  cashier: '/pos',
};

export const APP_ROUTE_ACCESS = [
  {
    key: 'dashboard',
    path: '/dashboard',
    allowedRoles: ['admin', 'staff', 'cashier'],
    moduleKey: MODULE_KEYS.DASHBOARD,
  },
  {
    key: 'pos',
    path: '/pos',
    allowedRoles: ['admin', 'cashier'],
    moduleKey: MODULE_KEYS.POS,
  },
  {
    key: 'inventory',
    path: '/inventory',
    allowedRoles: ['admin', 'staff', 'cashier'],
    moduleKey: MODULE_KEYS.INVENTORY,
  },
  {
    key: 'analytics',
    path: '/analytics',
    allowedRoles: ['admin'],
    moduleKey: MODULE_KEYS.ANALYTICS,
  },
  {
    key: 'financialReports',
    path: '/financial-reports',
    allowedRoles: ['admin'],
    moduleKey: MODULE_KEYS.FINANCIAL_REPORTS,
  },
  {
    key: 'dailySales',
    path: '/daily-sales',
    allowedRoles: ['admin'],
    moduleKey: MODULE_KEYS.DAILY_SALES,
    requiredModuleKeys: [MODULE_KEYS.FINANCIAL_REPORTS, MODULE_KEYS.DAILY_SALES],
  },
  {
    key: 'expenseManagement',
    path: '/expenses',
    allowedRoles: ['admin'],
    moduleKey: MODULE_KEYS.EXPENSE_MANAGEMENT,
    requiredModuleKeys: [MODULE_KEYS.FINANCIAL_REPORTS, MODULE_KEYS.EXPENSE_MANAGEMENT],
  },
  {
    key: 'schoolYearManagement',
    path: '/school-years',
    allowedRoles: ['admin'],
    moduleKey: MODULE_KEYS.SCHOOL_YEAR_MANAGEMENT,
    requiredModuleKeys: [MODULE_KEYS.FINANCIAL_REPORTS, MODULE_KEYS.SCHOOL_YEAR_MANAGEMENT],
  },
  {
    key: 'reports',
    path: '/reports',
    allowedRoles: ['admin'],
    moduleKey: MODULE_KEYS.REPORTS,
    requiredModuleKeys: [MODULE_KEYS.FINANCIAL_REPORTS, MODULE_KEYS.REPORTS],
  },
  {
    key: 'transactions',
    path: '/transactions',
    allowedRoles: ['admin', 'cashier'],
    moduleKey: MODULE_KEYS.TRANSACTIONS,
  },
  {
    key: 'predictions',
    path: '/predictions',
    allowedRoles: ['admin'],
    moduleKey: MODULE_KEYS.DEMAND_FORECAST,
  },
  {
    key: 'audit',
    path: '/audit',
    allowedRoles: ['admin'],
    moduleKey: MODULE_KEYS.AUDIT_LOGS,
  },
  {
    key: 'accounts',
    path: '/accounts',
    allowedRoles: ['admin'],
    moduleKey: MODULE_KEYS.USER_MANAGEMENT,
  },
  {
    key: 'settings',
    path: '/settings',
    allowedRoles: ['admin', 'staff'],
    moduleKey: MODULE_KEYS.SETTINGS,
  },
];

export function getRouteAccessForPath(path) {
  return APP_ROUTE_ACCESS.find((route) => route.path === path) || null;
}

export function isRouteEnabled(route, moduleSettings) {
  if (!route) {
    return true;
  }

  const normalizedSettings = normalizeModuleSettings(moduleSettings);
  const requiredModuleKeys = route.requiredModuleKeys || [route.moduleKey].filter(Boolean);
  return areModulesEnabled(normalizedSettings, requiredModuleKeys);
}

export function getDefaultRoute(role, moduleSettings) {
  const preferredRoute = getRouteAccessForPath(ROLE_DEFAULT_ROUTES[role]);
  if (
    preferredRoute &&
    preferredRoute.allowedRoles.includes(role) &&
    isRouteEnabled(preferredRoute, moduleSettings)
  ) {
    return preferredRoute.path;
  }

  return (
    APP_ROUTE_ACCESS.find(
      (route) => route.allowedRoles.includes(role) && isRouteEnabled(route, moduleSettings)
    )?.path || '/dashboard'
  );
}

export function isValidRole(role) {
  return Object.prototype.hasOwnProperty.call(ROLE_DEFAULT_ROUTES, role);
}

export function getAllowedRolesForPath(path) {
  return getRouteAccessForPath(path)?.allowedRoles || [];
}

export function canAccessPath(role, path, moduleSettings) {
  const route = getRouteAccessForPath(path);
  return Boolean(
    route &&
      route.allowedRoles.includes(role) &&
      isRouteEnabled(route, moduleSettings)
  );
}

