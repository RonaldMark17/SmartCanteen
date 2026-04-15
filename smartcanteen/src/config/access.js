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
  },
  {
    key: 'pos',
    path: '/pos',
    allowedRoles: ['admin', 'cashier'],
  },
  {
    key: 'inventory',
    path: '/inventory',
    allowedRoles: ['admin', 'staff', 'cashier'],
  },
  {
    key: 'analytics',
    path: '/analytics',
    allowedRoles: ['admin', 'staff'],
  },
  {
    key: 'transactions',
    path: '/transactions',
    allowedRoles: ['admin', 'staff', 'cashier'],
  },
  {
    key: 'predictions',
    path: '/predictions',
    allowedRoles: ['admin', 'staff'],
  },
  {
    key: 'audit',
    path: '/audit',
    allowedRoles: ['admin'],
  },
];

export function getDefaultRoute(role) {
  return ROLE_DEFAULT_ROUTES[role] || '/pos';
}

export function isValidRole(role) {
  return Object.prototype.hasOwnProperty.call(ROLE_DEFAULT_ROUTES, role);
}

export function getAllowedRolesForPath(path) {
  return APP_ROUTE_ACCESS.find((route) => route.path === path)?.allowedRoles || [];
}

export function canAccessPath(role, path) {
  return getAllowedRolesForPath(path).includes(role);
}
