export const MODULE_KEYS = {
  DASHBOARD: 'dashboard',
  FINANCIAL_REPORTS: 'financialReports',
  DAILY_SALES: 'dailySales',
  EXPENSE_MANAGEMENT: 'expenseManagement',
  SCHOOL_YEAR_MANAGEMENT: 'schoolYearManagement',
  REPORTS: 'reports',
  USER_MANAGEMENT: 'userManagement',
  AUDIT_LOGS: 'auditLogs',
  SETTINGS: 'settings',
  POS: 'pos',
  TRANSACTIONS: 'transactions',
  INVENTORY: 'inventory',
  DEMAND_FORECAST: 'demandForecast',
  ANALYTICS: 'analytics',
  NOTIFICATIONS: 'notifications',
};

export const SYSTEM_MODULES = [
  {
    key: MODULE_KEYS.DASHBOARD,
    label: 'Dashboard',
    group: 'Primary Workflow',
    defaultEnabled: true,
  },
  {
    key: MODULE_KEYS.FINANCIAL_REPORTS,
    label: 'Financial Reports',
    group: 'Financial',
    defaultEnabled: true,
  },
  {
    key: MODULE_KEYS.DAILY_SALES,
    label: 'Daily Sales',
    group: 'Financial',
    defaultEnabled: true,
  },
  {
    key: MODULE_KEYS.EXPENSE_MANAGEMENT,
    label: 'Expense Management',
    group: 'Financial',
    defaultEnabled: true,
  },
  {
    key: MODULE_KEYS.SCHOOL_YEAR_MANAGEMENT,
    label: 'School Year Management',
    group: 'Financial',
    defaultEnabled: true,
  },
  {
    key: MODULE_KEYS.REPORTS,
    label: 'Reports',
    group: 'Financial',
    defaultEnabled: true,
  },
  {
    key: MODULE_KEYS.USER_MANAGEMENT,
    label: 'User Management',
    group: 'Administration',
    defaultEnabled: true,
  },
  {
    key: MODULE_KEYS.AUDIT_LOGS,
    label: 'Audit Logs',
    group: 'Administration',
    defaultEnabled: true,
  },
  {
    key: MODULE_KEYS.SETTINGS,
    label: 'Settings',
    group: 'Administration',
    defaultEnabled: true,
  },
  {
    key: MODULE_KEYS.POS,
    label: 'POS',
    group: 'Optional Modules',
    defaultEnabled: false,
  },
  {
    key: MODULE_KEYS.TRANSACTIONS,
    label: 'Transactions',
    group: 'Optional Modules',
    defaultEnabled: false,
  },
  {
    key: MODULE_KEYS.INVENTORY,
    label: 'Inventory',
    group: 'Optional Modules',
    defaultEnabled: false,
  },
  {
    key: MODULE_KEYS.DEMAND_FORECAST,
    label: 'Demand Forecast',
    group: 'Optional Modules',
    defaultEnabled: false,
  },
  {
    key: MODULE_KEYS.ANALYTICS,
    label: 'Analytics',
    group: 'Optional Modules',
    defaultEnabled: false,
  },
  {
    key: MODULE_KEYS.NOTIFICATIONS,
    label: 'Notifications',
    group: 'Optional Modules',
    defaultEnabled: false,
  },
];

export const DEFAULT_MODULE_VISIBILITY = Object.fromEntries(
  SYSTEM_MODULES.map((module) => [module.key, module.defaultEnabled])
);

const MODULE_LABELS = Object.fromEntries(
  SYSTEM_MODULES.map((module) => [module.key, module.label])
);

export function getModuleLabel(moduleKey) {
  return MODULE_LABELS[moduleKey] || 'Module';
}

export function isModuleEnabled(moduleSettings, moduleKey) {
  if (!moduleKey) {
    return true;
  }

  return normalizeModuleSettings(moduleSettings)[moduleKey] !== false;
}

export function areModulesEnabled(moduleSettings, moduleKeys = []) {
  return moduleKeys.every((moduleKey) => isModuleEnabled(moduleSettings, moduleKey));
}

export function normalizeModuleSettings(value) {
  const normalized = { ...DEFAULT_MODULE_VISIBILITY };

  if (Array.isArray(value)) {
    value.forEach((item) => {
      const key = item?.module_key || item?.key;
      if (Object.prototype.hasOwnProperty.call(normalized, key)) {
        normalized[key] = Boolean(item.enabled);
      }
    });
    return normalized;
  }

  const source = value?.modules || value;
  if (Array.isArray(source)) {
    return normalizeModuleSettings(source);
  }

  if (source && typeof source === 'object') {
    Object.entries(source).forEach(([key, enabled]) => {
      if (Object.prototype.hasOwnProperty.call(normalized, key)) {
        normalized[key] = Boolean(enabled);
      }
    });
  }

  return normalized;
}

export function serializeModuleSettings(moduleSettings) {
  const normalized = normalizeModuleSettings(moduleSettings);
  return {
    modules: SYSTEM_MODULES.map((module) => ({
      module_key: module.key,
      enabled: Boolean(normalized[module.key]),
    })),
  };
}

