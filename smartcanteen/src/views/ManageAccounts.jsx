import { useCallback, useEffect, useMemo, useState } from 'react';
import { API } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import DismissibleAlert from '../components/DismissibleAlert';
import { Skeleton, SkeletonText } from '../components/Skeleton';
import {
  ArrowPathIcon,
  BellAlertIcon,
  CheckCircleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  KeyIcon,
  ListBulletIcon,
  MagnifyingGlassIcon,
  NoSymbolIcon,
  PencilSquareIcon,
  PlusIcon,
  ShieldCheckIcon,
  Squares2X2Icon,
  UserGroupIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';

const ROLE_OPTIONS = [
  { value: 'admin', label: 'Admin' },
  { value: 'staff', label: 'Staff' },
  { value: 'cashier', label: 'Cashier' },
];

const EMPTY_FORM = {
  username: '',
  full_name: '',
  role: 'cashier',
  password: '',
  is_active: true,
};

const RESET_PAGE_SIZE = 6;
const RECOVERY_PAGE_SIZE = 6;
const ACCOUNTS_PAGE_SIZE = 9;

function formatCount(value) {
  return Number(value || 0).toLocaleString('en-PH');
}

function formatRole(role) {
  const value = String(role || 'cashier').trim();
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatDate(value) {
  if (!value) {
    return 'Not available';
  }

  const date = new Date(`${value}`.endsWith('Z') ? value : `${value}Z`);
  if (Number.isNaN(date.getTime())) {
    return 'Not available';
  }

  return date.toLocaleDateString('en-PH', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatDateTime(value) {
  if (!value) {
    return 'Not available';
  }

  const date = new Date(`${value}`.endsWith('Z') ? value : `${value}Z`);
  if (Number.isNaN(date.getTime())) {
    return 'Not available';
  }

  return date.toLocaleString('en-PH', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatResetStatus(status) {
  const value = String(status || 'pending').trim().toLowerCase().replace(/[\s-]+/g, '_');
  const label = value === 'denied' ? 'declined' : value === 'completed' ? 'used' : value;
  return label
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function getResetStatusClass(status) {
  const value = String(status || 'pending').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (value === 'approved' || value === 'appeal_approved') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300';
  }
  if (value === 'declined' || value === 'denied' || value === 'appeal_declined') {
    return 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/60 dark:text-rose-300';
  }
  if (value === 'appealed') {
    return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300';
  }
  if (value === 'completed' || value === 'used') {
    return 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950/60 dark:text-sky-300';
  }
  if (value === 'expired') {
    return 'border-slate-200 bg-slate-100 text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400';
  }
  return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300';
}

function getInitials(user) {
  const name = String(user?.full_name || user?.username || 'SC').trim();
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');

  return initials || 'SC';
}

function getAccountSearchText(user) {
  return [
    user.id,
    user.username,
    user.full_name,
    user.role,
    user.is_active ? 'active' : 'inactive',
  ]
    .join(' ')
    .toLowerCase();
}

function AccountMetricCard({ title, value, detail, icon: Icon, tone = 'slate' }) {
  const iconToneStyle = {
    teal: 'border-emerald-100 bg-emerald-50 text-emerald-600 dark:border-emerald-900/60 dark:bg-emerald-950/60 dark:text-emerald-400',
    emerald: 'border-emerald-100 bg-emerald-50 text-emerald-600 dark:border-emerald-900/60 dark:bg-emerald-950/60 dark:text-emerald-400',
    amber: 'border-amber-100 bg-amber-50 text-amber-600 dark:border-amber-900/60 dark:bg-amber-950/60 dark:text-amber-400',
    slate: 'border-slate-200/60 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200',
  }[tone] || 'border-slate-200/60 bg-slate-100 text-slate-700';

  return (
    <div className="flex items-start justify-between rounded-2xl border border-slate-200/90 bg-white p-5 shadow-2xs transition-all dark:border-slate-800 dark:bg-slate-900">
      <div className="min-w-0 flex-1">
        <div className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{title}</div>
        <div className="mt-2 truncate text-2xl font-black tracking-tight text-slate-900 dark:text-white">{value}</div>
        <div className="mt-1 truncate text-xs font-semibold text-slate-500 dark:text-slate-400">{detail}</div>
      </div>
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${iconToneStyle}`}>
        <Icon className="h-5 w-5 stroke-[2]" />
      </div>
    </div>
  );
}

function ViewToggle({ mode, onChange, options }) {
  return (
    <div className="inline-flex items-center rounded-xl border border-slate-200/90 bg-slate-100/70 p-1 dark:border-slate-800 dark:bg-slate-800/70">
      {options.map((opt) => {
        const Icon = opt.icon;
        const isActive = mode === opt.mode;
        return (
          <button
            key={opt.mode}
            type="button"
            onClick={() => onChange(opt.mode)}
            title={`${opt.label} View`}
            aria-pressed={isActive}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-bold transition-all ${
              isActive
                ? 'bg-white text-slate-900 shadow-2xs dark:bg-slate-900 dark:text-white'
                : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
            }`}
          >
            <Icon className="h-4 w-4" />
            <span className="hidden sm:inline">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function SectionPagination({
  currentPage,
  totalPages,
  totalItems,
  pageSize,
  onPageChange,
  itemName = 'items',
}) {
  if (totalItems === 0) return null;

  const startCount = (currentPage - 1) * pageSize + 1;
  const endCount = Math.min(currentPage * pageSize, totalItems);

  const pageNumbers = [];
  const maxButtons = 5;
  let start = Math.max(1, currentPage - Math.floor(maxButtons / 2));
  let end = Math.min(totalPages, start + maxButtons - 1);
  start = Math.max(1, end - maxButtons + 1);

  for (let i = start; i <= end; i++) {
    pageNumbers.push(i);
  }

  return (
    <div className="flex flex-col gap-3 border-t border-slate-100 pt-4 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
        Showing <span className="font-bold text-slate-900 dark:text-white">{formatCount(startCount)}-{formatCount(endCount)}</span> of <span className="font-bold text-slate-900 dark:text-white">{formatCount(totalItems)}</span> {itemName}
      </div>

      {totalPages > 1 && (
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
          <button
            type="button"
            onClick={() => onPageChange(Math.max(1, currentPage - 1))}
            disabled={currentPage === 1}
            aria-label="Previous page"
            className="inline-flex h-8 items-center gap-1 rounded-xl border border-slate-200 bg-white px-2 text-xs font-bold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
          >
            <ChevronLeftIcon className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Prev</span>
          </button>

          {pageNumbers.map((pageNumber) => (
            <button
              key={pageNumber}
              type="button"
              onClick={() => onPageChange(pageNumber)}
              aria-current={pageNumber === currentPage ? 'page' : undefined}
              className={`inline-flex h-8 min-w-8 items-center justify-center rounded-xl px-2 text-xs font-bold transition ${
                pageNumber === currentPage
                  ? 'bg-emerald-600 text-white font-black'
                  : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
              }`}
            >
              {pageNumber}
            </button>
          ))}

          <button
            type="button"
            onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
            disabled={currentPage === totalPages}
            aria-label="Next page"
            className="inline-flex h-8 items-center gap-1 rounded-xl border border-slate-200 bg-white px-2 text-xs font-bold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
          >
            <span className="hidden sm:inline">Next</span>
            <ChevronRightIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

export default function ManageAccounts() {
  const { user: currentUser = {} } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [busyUserId, setBusyUserId] = useState(null);
  const [passwordResetRequests, setPasswordResetRequests] = useState([]);
  const [resetRequestsLoading, setResetRequestsLoading] = useState(true);
  const [resetRequestError, setResetRequestError] = useState('');
  const [busyResetRequestId, setBusyResetRequestId] = useState(null);
  const [authRecoveryRequests, setAuthRecoveryRequests] = useState([]);
  const [authRecoveryLoading, setAuthRecoveryLoading] = useState(true);
  const [authRecoveryError, setAuthRecoveryError] = useState('');
  const [busyAuthRecoveryId, setBusyAuthRecoveryId] = useState(null);

  // View Mode & Pagination States
  const [resetViewMode, setResetViewMode] = useState('grid');
  const [resetPage, setResetPage] = useState(1);

  const [recoveryViewMode, setRecoveryViewMode] = useState('grid');
  const [recoveryPage, setRecoveryPage] = useState(1);

  const [accountsViewMode, setAccountsViewMode] = useState('list');
  const [accountsPage, setAccountsPage] = useState(1);

  const loadUsers = useCallback(async ({ showLoading = false } = {}) => {
    if (showLoading) {
      setLoading(true);
    }

    setError('');
    try {
      const data = await API.getAdminUsers();
      setUsers(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.message || 'Accounts could not be loaded.');
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  }, []);

  const loadPasswordResetRequests = useCallback(async ({ showLoading = false } = {}) => {
    if (showLoading) {
      setResetRequestsLoading(true);
    }

    setResetRequestError('');
    try {
      const data = await API.getPasswordResetRequests();
      setPasswordResetRequests(Array.isArray(data) ? data : []);
    } catch (err) {
      setResetRequestError(err.message || 'Password reset requests could not be loaded.');
    } finally {
      if (showLoading) {
        setResetRequestsLoading(false);
      }
    }
  }, []);

  const loadAuthenticatorRecoveryRequests = useCallback(async ({ showLoading = false } = {}) => {
    if (showLoading) {
      setAuthRecoveryLoading(true);
    }

    setAuthRecoveryError('');
    try {
      const data = await API.getAuthenticatorRecoveryRequests();
      setAuthRecoveryRequests(Array.isArray(data) ? data : []);
    } catch (err) {
      setAuthRecoveryError(err.message || 'Authenticator recovery requests could not be loaded.');
    } finally {
      if (showLoading) {
        setAuthRecoveryLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    loadUsers({ showLoading: true });
    loadPasswordResetRequests({ showLoading: true });
    loadAuthenticatorRecoveryRequests({ showLoading: true });
  }, [loadAuthenticatorRecoveryRequests, loadPasswordResetRequests, loadUsers]);

  const activeUsers = users.filter((user) => user.is_active);
  const activeAdmins = users.filter((user) => user.is_active && user.role === 'admin');
  const protectedMfaUsers = users.filter((user) => user.authenticator_mfa_enabled);
  const lowRecoveryUsers = users.filter(
    (user) => user.authenticator_mfa_enabled && Number(user.recovery_codes_remaining || 0) <= 1
  );
  const pendingResetRequests = passwordResetRequests.filter((request) => request.status === 'pending');
  const appealedResetRequests = passwordResetRequests.filter((request) => request.status === 'appealed');
  const openResetRequests = passwordResetRequests.filter((request) =>
    ['pending', 'approved', 'appealed', 'appeal_approved', 'expired'].includes(request.status)
  );
  const pendingAuthRecoveryRequests = authRecoveryRequests.filter((request) => request.status === 'pending');
  const appealedAuthRecoveryRequests = authRecoveryRequests.filter((request) => request.status === 'appealed');
  const openAuthRecoveryRequests = authRecoveryRequests.filter((request) =>
    ['pending', 'approved', 'appealed', 'appeal_approved', 'expired'].includes(request.status)
  );

  const filteredUsers = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLowerCase();

    return users.filter((user) => {
      const matchesSearch = !normalizedSearch || getAccountSearchText(user).includes(normalizedSearch);
      const matchesRole = roleFilter === 'all' || user.role === roleFilter;
      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'active' && user.is_active) ||
        (statusFilter === 'inactive' && !user.is_active);

      return matchesSearch && matchesRole && matchesStatus;
    });
  }, [roleFilter, searchQuery, statusFilter, users]);

  // Reset page when filters change
  useEffect(() => {
    setAccountsPage(1);
  }, [searchQuery, roleFilter, statusFilter]);

  // Pagination calculations
  const totalResetPages = Math.max(1, Math.ceil(passwordResetRequests.length / RESET_PAGE_SIZE));
  const safeResetPage = Math.min(resetPage, totalResetPages);
  const paginatedResetRequests = passwordResetRequests.slice(
    (safeResetPage - 1) * RESET_PAGE_SIZE,
    safeResetPage * RESET_PAGE_SIZE
  );

  const totalRecoveryPages = Math.max(1, Math.ceil(authRecoveryRequests.length / RECOVERY_PAGE_SIZE));
  const safeRecoveryPage = Math.min(recoveryPage, totalRecoveryPages);
  const paginatedRecoveryRequests = authRecoveryRequests.slice(
    (safeRecoveryPage - 1) * RECOVERY_PAGE_SIZE,
    safeRecoveryPage * RECOVERY_PAGE_SIZE
  );

  const totalAccountPages = Math.max(1, Math.ceil(filteredUsers.length / ACCOUNTS_PAGE_SIZE));
  const safeAccountsPage = Math.min(accountsPage, totalAccountPages);
  const paginatedUsers = filteredUsers.slice(
    (safeAccountsPage - 1) * ACCOUNTS_PAGE_SIZE,
    safeAccountsPage * ACCOUNTS_PAGE_SIZE
  );

  const openCreateModal = () => {
    setEditingUser(null);
    setFormData(EMPTY_FORM);
    setFormError('');
    setModalOpen(true);
  };

  const openEditModal = (user) => {
    setEditingUser(user);
    setFormData({
      username: user.username || '',
      full_name: user.full_name || '',
      role: user.role || 'cashier',
      password: '',
      is_active: Boolean(user.is_active),
    });
    setFormError('');
    setModalOpen(true);
  };

  const closeModal = () => {
    if (saving) {
      return;
    }
    setModalOpen(false);
    setEditingUser(null);
    setFormData(EMPTY_FORM);
    setFormError('');
  };

  const saveAccount = async (event) => {
    event.preventDefault();
    setSaving(true);
    setFormError('');

    try {
      const username = formData.username.trim();
      const payload = {
        username,
        full_name: formData.full_name.trim(),
        role: formData.role,
      };

      if (editingUser) {
        payload.is_active = Boolean(formData.is_active);
        if (formData.password.trim()) {
          payload.password = formData.password;
        }
        await API.updateAdminUser(editingUser.id, payload);
        window.showToast?.(`Account updated for ${username}.`, 'success');
      } else {
        payload.password = formData.password;
        await API.createAdminUser(payload);
        window.showToast?.(`Account created for ${username}.`, 'success');
      }

      await loadUsers();
      closeModal();
    } catch (err) {
      setFormError(err.message || 'Account could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const toggleAccountStatus = async (user) => {
    const nextActive = !user.is_active;
    const action = nextActive ? 'activate' : 'deactivate';
    if (!nextActive) {
      const confirmed = window.confirm(
        `Deactivate ${user.username}? They will no longer be able to sign in.`
      );
      if (!confirmed) {
        return;
      }
    }

    setBusyUserId(user.id);
    setError('');
    try {
      await API.updateAdminUser(user.id, { is_active: nextActive });
      window.showToast?.(`${formatRole(user.role)} account ${action}d.`, 'success');
      await loadUsers();
    } catch (err) {
      setError(err.message || `Account could not be ${action}d.`);
    } finally {
      setBusyUserId(null);
    }
  };

  const disableAccount = async (user) => {
    const confirmed = window.confirm(
      `Disable ${user.username}? This deactivates the account and preserves activity history.`
    );
    if (!confirmed) {
      return;
    }

    setBusyUserId(user.id);
    setError('');
    try {
      await API.deleteAdminUser(user.id);
      window.showToast?.(`Account disabled for ${user.username}.`, 'success');
      await loadUsers();
    } catch (err) {
      setError(err.message || 'Account could not be disabled.');
    } finally {
      setBusyUserId(null);
    }
  };

  const resetAuthenticator = async (user) => {
    const isUserAdmin = user.role === 'admin';
    const message = isUserAdmin
      ? `Reset authenticator for ${user.username}? They will be required to set up MFA again at next login.`
      : `Reset authenticator for ${user.username}? MFA is optional for staff, so they will log in directly.`;
    const confirmed = window.confirm(message);
    if (!confirmed) {
      return;
    }

    setBusyUserId(user.id);
    setError('');
    try {
      await API.resetUserAuthenticator(user.id, { revoke_remembered_devices: true });
      window.showToast?.(`Authenticator reset for ${user.username}.`, 'success');
      await loadUsers();
    } catch (err) {
      setError(err.message || 'Authenticator could not be reset.');
    } finally {
      setBusyUserId(null);
    }
  };

  const reviewPasswordResetRequest = async (request, action) => {
    const username = request.username || request.identifier;
    const approved = action === 'approve' || action === 'approve_appeal';
    const appealAction = action === 'approve_appeal' || action === 'deny_appeal';
    const confirmed = window.confirm(
      `${approved ? 'Approve' : 'Decline'} ${appealAction ? 'password reset appeal' : 'password reset'} for ${username}?`
    );
    if (!confirmed) {
      return;
    }

    const note = approved
      ? ''
      : window.prompt('Optional reason to show the user:', '') || '';

    setBusyResetRequestId(request.id);
    setResetRequestError('');
    try {
      if (action === 'approve') {
        await API.approvePasswordResetRequest(request.id);
        window.showToast?.(`Password reset approved for ${username}.`, 'success');
      } else if (action === 'approve_appeal') {
        await API.approvePasswordResetAppeal(request.id);
        window.showToast?.(`Password reset appeal approved for ${username}.`, 'success');
      } else if (action === 'deny_appeal') {
        await API.denyPasswordResetAppeal(request.id, { note: note.trim() });
        window.showToast?.(`Password reset appeal declined for ${username}.`, 'warning');
      } else {
        await API.denyPasswordResetRequest(request.id, { note: note.trim() });
        window.showToast?.(`Password reset declined for ${username}.`, 'warning');
      }
      await loadPasswordResetRequests();
    } catch (err) {
      setResetRequestError(err.message || 'Password reset request could not be updated.');
    } finally {
      setBusyResetRequestId(null);
    }
  };

  const reviewAuthenticatorRecoveryRequest = async (request, action) => {
    const username = request.username || request.identifier;
    const approved = action === 'approve' || action === 'approve_appeal';
    const appealAction = action === 'approve_appeal' || action === 'deny_appeal';
    const confirmed = window.confirm(
      `${approved ? 'Approve' : 'Decline'} ${appealAction ? 'authenticator recovery appeal' : 'authenticator recovery'} for ${username}?`
    );
    if (!confirmed) {
      return;
    }

    const note = approved
      ? ''
      : window.prompt('Optional reason to show the user:', '') || '';

    setBusyAuthRecoveryId(request.id);
    setAuthRecoveryError('');
    try {
      if (action === 'approve') {
        await API.approveAuthenticatorRecoveryRequest(request.id);
        window.showToast?.(`Authenticator recovery approved for ${username}.`, 'success');
      } else if (action === 'approve_appeal') {
        await API.approveAuthenticatorRecoveryAppeal(request.id);
        window.showToast?.(`Authenticator recovery appeal approved for ${username}.`, 'success');
      } else if (action === 'deny_appeal') {
        await API.denyAuthenticatorRecoveryAppeal(request.id, { note: note.trim() });
        window.showToast?.(`Authenticator recovery appeal declined for ${username}.`, 'warning');
      } else {
        await API.denyAuthenticatorRecoveryRequest(request.id, { note: note.trim() });
        window.showToast?.(`Authenticator recovery declined for ${username}.`, 'warning');
      }
      await loadAuthenticatorRecoveryRequests();
      await loadUsers();
    } catch (err) {
      setAuthRecoveryError(err.message || 'Authenticator recovery request could not be updated.');
    } finally {
      setBusyAuthRecoveryId(null);
    }
  };

  const isEditingSelf = editingUser?.id === currentUser.id;

  return (
    <div className="view-shell overflow-x-hidden pr-0 space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-lg border border-emerald-200/60 bg-emerald-50 px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-950/60 dark:text-emerald-300">
            <UserGroupIcon className="h-4 w-4" />
            Admin Access
          </div>
          <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-900 dark:text-white sm:text-3xl">
            Manage Accounts
          </h1>
          <p className="mt-1 text-sm font-medium text-slate-500 dark:text-slate-400 max-w-3xl">
            Create accounts, update roles, reset MFA, and deactivate access when needed.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => {
              loadUsers({ showLoading: true });
              loadPasswordResetRequests({ showLoading: true });
              loadAuthenticatorRecoveryRequests({ showLoading: true });
            }}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-bold text-slate-700 shadow-2xs transition hover:bg-slate-50 active:scale-95 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            <ArrowPathIcon className={`h-4 w-4 ${loading || resetRequestsLoading || authRecoveryLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-black text-white shadow-xs transition hover:bg-emerald-700 active:scale-95"
          >
            <PlusIcon className="h-4 w-4 stroke-[2.5]" />
            Add Account
          </button>
        </div>
      </div>

      {error && (
        <DismissibleAlert resetKey={error} tone="red" title="Account issue" className="rounded-xl">
          {error}
        </DismissibleAlert>
      )}

      {resetRequestError && (
        <DismissibleAlert resetKey={resetRequestError} tone="red" title="Password reset issue" className="rounded-xl">
          {resetRequestError}
        </DismissibleAlert>
      )}

      {authRecoveryError && (
        <DismissibleAlert resetKey={authRecoveryError} tone="red" title="Authenticator recovery issue" className="rounded-xl">
          {authRecoveryError}
        </DismissibleAlert>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <AccountMetricCard
          title="Accounts"
          value={formatCount(users.length)}
          detail={`${formatCount(activeUsers.length)} active`}
          icon={UserGroupIcon}
          tone="emerald"
        />
        <AccountMetricCard
          title="Active Admins"
          value={formatCount(activeAdmins.length)}
          detail="Protected admin access"
          icon={ShieldCheckIcon}
          tone={activeAdmins.length > 1 ? 'emerald' : 'amber'}
        />
        <AccountMetricCard
          title="MFA Enabled"
          value={formatCount(protectedMfaUsers.length)}
          detail="Authenticator protected"
          icon={KeyIcon}
          tone="slate"
        />
        <AccountMetricCard
          title="Recovery Risk"
          value={formatCount(lowRecoveryUsers.length)}
          detail="MFA users with 0-1 backup codes"
          icon={ShieldCheckIcon}
          tone={lowRecoveryUsers.length > 0 ? 'amber' : 'emerald'}
        />
        <AccountMetricCard
          title="Reset Requests"
          value={formatCount(pendingResetRequests.length)}
          detail={`${formatCount(openResetRequests.length)} open`}
          icon={BellAlertIcon}
          tone={pendingResetRequests.length > 0 ? 'amber' : 'slate'}
        />
        <AccountMetricCard
          title="MFA Requests"
          value={formatCount(pendingAuthRecoveryRequests.length)}
          detail={`${formatCount(openAuthRecoveryRequests.length)} open`}
          icon={KeyIcon}
          tone={pendingAuthRecoveryRequests.length > 0 ? 'amber' : 'slate'}
        />
      </div>

      <div className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-2xs dark:border-slate-800 dark:bg-slate-900 grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_13rem_13rem]">
        <div className="relative sm:col-span-2 lg:col-span-1">
          <MagnifyingGlassIcon className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search name, username, role, status, or ID..."
            className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50/50 pl-10 pr-4 text-sm font-semibold text-slate-900 shadow-2xs outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
          />
        </div>

        <select
          value={roleFilter}
          onChange={(event) => setRoleFilter(event.target.value)}
          className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 text-sm font-bold text-slate-700 shadow-2xs outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          aria-label="Filter accounts by role"
        >
          <option value="all">All roles</option>
          {ROLE_OPTIONS.map((role) => (
            <option key={role.value} value={role.value}>
              {role.label}
            </option>
          ))}
        </select>

        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
          className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 text-sm font-bold text-slate-700 shadow-2xs outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          aria-label="Filter accounts by status"
        >
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      {/* ─────────────────────────────────────────────────────────────────────────
          PASSWORD RESET REQUESTS SECTION
         ───────────────────────────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-slate-900 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-black text-slate-900 dark:text-white">Password Reset Requests</h2>
              <BellAlertIcon className="h-4 w-4 text-slate-400" />
            </div>
            <p className="mt-0.5 text-xs font-medium text-slate-500 dark:text-slate-400">
              Review requests and appeals so users can change passwords only after admin approval.
            </p>
            {appealedResetRequests.length > 0 && (
              <div className="mt-2 inline-flex rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
                {appealedResetRequests.length} appeal{appealedResetRequests.length > 1 ? 's' : ''} pending review
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 self-start sm:self-center">
            <ViewToggle
              mode={resetViewMode}
              onChange={setResetViewMode}
              options={[
                { mode: 'grid', icon: Squares2X2Icon, label: 'Grid' },
                { mode: 'list', icon: ListBulletIcon, label: 'List' },
              ]}
            />
          </div>
        </div>

        {resetRequestsLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }, (_, index) => (
              <div key={`reset-request-skeleton-${index}`} className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
                <div className="flex items-center gap-3">
                  <Skeleton className="h-10 w-10 rounded-full" />
                  <SkeletonText lines={['h-4 w-36', 'h-3 w-28']} className="flex-1" />
                </div>
                <Skeleton className="mt-4 h-16 rounded-lg" />
              </div>
            ))}
          </div>
        ) : passwordResetRequests.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-xs font-medium text-slate-500 dark:border-slate-800 dark:text-slate-400">
            No password reset requests right now.
          </div>
        ) : resetViewMode === 'grid' ? (
          /* GRID VIEW */
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {paginatedResetRequests.map((request) => {
              const isBusy = busyResetRequestId === request.id;
              const canApprove = request.status === 'pending' || request.status === 'expired';
              const canDeny = ['pending', 'approved', 'expired'].includes(request.status);
              const canApproveAppeal = request.status === 'appealed';
              const canDenyAppeal = request.status === 'appealed';
              const displayName = request.full_name || request.username || request.identifier;

              return (
                <article key={`reset-request-${request.id}`} className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-800/60 flex flex-col justify-between">
                  <div>
                    <div className="flex items-start gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-800 font-black text-sm">
                        {getInitials({ full_name: request.full_name, username: request.username || request.identifier })}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-bold text-sm text-slate-900 dark:text-white">{displayName}</div>
                        <div className="mt-0.5 truncate font-mono text-xs text-slate-400">
                          @{request.username || request.identifier}
                        </div>
                      </div>
                      <span
                        className={`shrink-0 rounded-lg border px-2.5 py-1 text-xs font-bold uppercase tracking-wider ${getResetStatusClass(request.status)}`}
                      >
                        {formatResetStatus(request.status)}
                      </span>
                    </div>

                    <div className="mt-4 space-y-1.5 text-xs text-slate-500 dark:text-slate-400">
                      <div className="flex items-center gap-2 rounded-lg bg-white/80 dark:bg-slate-900/60 p-2 border border-slate-100 dark:border-slate-800">
                        <ClockIcon className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                        <span>Requested {formatDateTime(request.requested_at)}</span>
                      </div>
                      {(request.status === 'approved' || request.status === 'appeal_approved') && (
                        <div className="rounded-lg bg-emerald-50 p-2 text-emerald-700 border border-emerald-200/60 dark:bg-emerald-950/60 dark:text-emerald-300">
                          Approved until {formatDateTime(request.expires_at)}
                        </div>
                      )}
                      {request.reviewer_username && (
                        <div className="rounded-lg bg-white/80 dark:bg-slate-900/60 p-2 border border-slate-100 dark:border-slate-800">
                          Reviewed by @{request.reviewer_username}
                        </div>
                      )}
                      {request.review_note && (
                        <div className="rounded-lg bg-rose-50 p-2 text-rose-700 border border-rose-200/60 dark:bg-rose-950/60 dark:text-rose-300">
                          Decline reason: {request.review_note}
                        </div>
                      )}
                      {request.appeal_reason && (
                        <div className="rounded-lg bg-amber-50 p-2 text-amber-700 border border-amber-200/60 dark:bg-amber-950/60 dark:text-amber-300">
                          Appeal reason: {request.appeal_reason}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-200/60 dark:border-slate-700/60">
                    {request.status === 'appealed' ? (
                      <div className="grid gap-2 sm:grid-cols-2">
                        <button
                          type="button"
                          onClick={() => reviewPasswordResetRequest(request, 'approve_appeal')}
                          disabled={!canApproveAppeal || isBusy}
                          className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-black text-white shadow-xs transition hover:bg-emerald-700 disabled:opacity-50"
                        >
                          <CheckCircleIcon className="h-4 w-4 stroke-[2.5]" />
                          {isBusy && canApproveAppeal ? 'Approving...' : 'Approve Appeal'}
                        </button>
                        <button
                          type="button"
                          onClick={() => reviewPasswordResetRequest(request, 'deny_appeal')}
                          disabled={!canDenyAppeal || isBusy}
                          className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 transition hover:bg-rose-100 disabled:opacity-50"
                        >
                          <XMarkIcon className="h-4 w-4 stroke-[2.5]" />
                          {isBusy && canDenyAppeal ? 'Declining...' : 'Decline Appeal'}
                        </button>
                      </div>
                    ) : (
                      <div className="grid gap-2 sm:grid-cols-2">
                        <button
                          type="button"
                          onClick={() => reviewPasswordResetRequest(request, 'approve')}
                          disabled={!canApprove || isBusy}
                          className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-black text-white shadow-xs transition hover:bg-emerald-700 disabled:opacity-50"
                        >
                          <CheckCircleIcon className="h-4 w-4 stroke-[2.5]" />
                          {isBusy && canApprove ? 'Approving...' : 'Approve'}
                        </button>
                        <button
                          type="button"
                          onClick={() => reviewPasswordResetRequest(request, 'deny')}
                          disabled={!canDeny || isBusy}
                          className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 transition hover:bg-rose-100 disabled:opacity-50"
                        >
                          <XMarkIcon className="h-4 w-4 stroke-[2.5]" />
                          {isBusy && canDeny ? 'Declining...' : 'Decline'}
                        </button>
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          /* LIST VIEW */
          <div className="overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-2xs dark:border-slate-800 dark:bg-slate-900">
            <div className="overflow-x-auto custom-scrollbar">
              <table className="min-w-[750px] w-full text-left text-sm text-slate-600 dark:text-slate-300">
                <thead className="border-b border-slate-200/80 bg-slate-50/80 text-xs font-bold uppercase tracking-wider text-slate-500 dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-400">
                  <tr>
                    <th className="px-5 py-3.5">Account</th>
                    <th className="px-4 py-3.5">Status</th>
                    <th className="px-4 py-3.5">Requested At</th>
                    <th className="px-5 py-3.5">Notes & Reasons</th>
                    <th className="px-5 py-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white dark:divide-slate-800 dark:bg-slate-900">
                  {paginatedResetRequests.map((request) => {
                    const isBusy = busyResetRequestId === request.id;
                    const canApprove = request.status === 'pending' || request.status === 'expired';
                    const canDeny = ['pending', 'approved', 'expired'].includes(request.status);
                    const canApproveAppeal = request.status === 'appealed';
                    const canDenyAppeal = request.status === 'appealed';
                    const displayName = request.full_name || request.username || request.identifier;

                    return (
                      <tr key={request.id} className="transition hover:bg-slate-50/70 dark:hover:bg-slate-800/50">
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-3">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-800 font-bold text-xs">
                              {getInitials({ full_name: request.full_name, username: request.username || request.identifier })}
                            </div>
                            <div className="min-w-0">
                              <div className="truncate font-bold text-sm text-slate-900 dark:text-white">{displayName}</div>
                              <div className="mt-0.5 truncate font-mono text-xs text-slate-400">
                                @{request.username || request.identifier}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <span className={`inline-flex rounded-lg border px-2.5 py-1 text-xs font-bold uppercase tracking-wider ${getResetStatusClass(request.status)}`}>
                            {formatResetStatus(request.status)}
                          </span>
                        </td>
                        <td className="px-4 py-4 font-mono text-xs text-slate-600 dark:text-slate-400">
                          {formatDateTime(request.requested_at)}
                        </td>
                        <td className="px-5 py-4 text-xs max-w-[20rem]">
                          {request.review_note && <div className="text-rose-700 font-medium">Decline: {request.review_note}</div>}
                          {request.appeal_reason && <div className="text-amber-700 font-medium">Appeal: {request.appeal_reason}</div>}
                          {request.reviewer_username && <div className="text-slate-400">By @{request.reviewer_username}</div>}
                          {!request.review_note && !request.appeal_reason && !request.reviewer_username && (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-5 py-4 text-right">
                          <div className="flex justify-end gap-1.5">
                            {request.status === 'appealed' ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => reviewPasswordResetRequest(request, 'approve_appeal')}
                                  disabled={!canApproveAppeal || isBusy}
                                  className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-bold text-white shadow-xs transition hover:bg-emerald-700 disabled:opacity-50"
                                >
                                  <CheckCircleIcon className="h-3.5 w-3.5" />
                                  Approve
                                </button>
                                <button
                                  type="button"
                                  onClick={() => reviewPasswordResetRequest(request, 'deny_appeal')}
                                  disabled={!canDenyAppeal || isBusy}
                                  className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-bold text-rose-700 transition hover:bg-rose-100 disabled:opacity-50"
                                >
                                  <XMarkIcon className="h-3.5 w-3.5" />
                                  Decline
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => reviewPasswordResetRequest(request, 'approve')}
                                  disabled={!canApprove || isBusy}
                                  className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-bold text-white shadow-xs transition hover:bg-emerald-700 disabled:opacity-50"
                                >
                                  <CheckCircleIcon className="h-3.5 w-3.5" />
                                  Approve
                                </button>
                                <button
                                  type="button"
                                  onClick={() => reviewPasswordResetRequest(request, 'deny')}
                                  disabled={!canDeny || isBusy}
                                  className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-bold text-rose-700 transition hover:bg-rose-100 disabled:opacity-50"
                                >
                                  <XMarkIcon className="h-3.5 w-3.5" />
                                  Decline
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <SectionPagination
          currentPage={safeResetPage}
          totalPages={totalResetPages}
          totalItems={passwordResetRequests.length}
          pageSize={RESET_PAGE_SIZE}
          onPageChange={setResetPage}
          itemName="reset requests"
        />
      </section>

      {/* ─────────────────────────────────────────────────────────────────────────
          AUTHENTICATOR RECOVERY REQUESTS SECTION
         ───────────────────────────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-slate-900 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-black text-slate-900 dark:text-white">Authenticator Recovery Requests</h2>
              <KeyIcon className="h-4 w-4 text-slate-400" />
            </div>
            <p className="mt-0.5 text-xs font-medium text-slate-500 dark:text-slate-400">
              Review requests from users who lost access to their authenticator app.
            </p>
            {appealedAuthRecoveryRequests.length > 0 && (
              <div className="mt-2 inline-flex rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
                {appealedAuthRecoveryRequests.length} appeal{appealedAuthRecoveryRequests.length > 1 ? 's' : ''} pending review
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 self-start sm:self-center">
            <ViewToggle
              mode={recoveryViewMode}
              onChange={setRecoveryViewMode}
              options={[
                { mode: 'grid', icon: Squares2X2Icon, label: 'Grid' },
                { mode: 'list', icon: ListBulletIcon, label: 'List' },
              ]}
            />
          </div>
        </div>

        {authRecoveryLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }, (_, index) => (
              <div key={`auth-recovery-request-skeleton-${index}`} className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs">
                <div className="flex items-center gap-3">
                  <Skeleton className="h-10 w-10 rounded-full" />
                  <SkeletonText lines={['h-4 w-36', 'h-3 w-28']} className="flex-1" />
                </div>
                <Skeleton className="mt-4 h-16 rounded-lg" />
              </div>
            ))}
          </div>
        ) : authRecoveryRequests.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-xs font-medium text-slate-500 dark:border-slate-800 dark:text-slate-400">
            No authenticator recovery requests right now.
          </div>
        ) : recoveryViewMode === 'grid' ? (
          /* GRID VIEW */
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {paginatedRecoveryRequests.map((request) => {
              const isBusy = busyAuthRecoveryId === request.id;
              const canApprove = request.status === 'pending' || request.status === 'expired';
              const canDeny = ['pending', 'approved', 'expired'].includes(request.status);
              const canApproveAppeal = request.status === 'appealed';
              const canDenyAppeal = request.status === 'appealed';
              const displayName = request.full_name || request.username || request.identifier;

              return (
                <article key={`auth-recovery-request-${request.id}`} className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-800/60 flex flex-col justify-between">
                  <div>
                    <div className="flex items-start gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-800 font-black text-sm">
                        {getInitials({ full_name: request.full_name, username: request.username || request.identifier })}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-bold text-sm text-slate-900 dark:text-white">{displayName}</div>
                        <div className="mt-0.5 flex flex-wrap gap-2 text-xs text-slate-400">
                          <span className="font-mono">@{request.username || request.identifier}</span>
                          {request.role && <span className="font-semibold text-slate-500">{formatRole(request.role)}</span>}
                        </div>
                      </div>
                      <span
                        className={`shrink-0 rounded-lg border px-2.5 py-1 text-xs font-bold uppercase tracking-wider ${getResetStatusClass(request.status)}`}
                      >
                        {formatResetStatus(request.status)}
                      </span>
                    </div>

                    <div className="mt-4 space-y-1.5 text-xs text-slate-500 dark:text-slate-400">
                      <div className="flex items-center gap-2 rounded-lg bg-white/80 dark:bg-slate-900/60 p-2 border border-slate-100 dark:border-slate-800">
                        <ClockIcon className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                        <span>Requested {formatDateTime(request.requested_at)}</span>
                      </div>
                      <div className="rounded-lg bg-white/80 dark:bg-slate-900/60 p-2 border border-slate-100 dark:border-slate-800">
                        Reason: {request.reason}
                      </div>
                      {(request.status === 'approved' || request.status === 'appeal_approved') && (
                        <div className="rounded-lg bg-emerald-50 p-2 text-emerald-700 border border-emerald-200/60 dark:bg-emerald-950/60 dark:text-emerald-300">
                          Approved until {formatDateTime(request.expires_at)}
                        </div>
                      )}
                      {request.reviewer_username && (
                        <div className="rounded-lg bg-white/80 dark:bg-slate-900/60 p-2 border border-slate-100 dark:border-slate-800">
                          Reviewed by @{request.reviewer_username}
                        </div>
                      )}
                      {request.review_note && (
                        <div className="rounded-lg bg-rose-50 p-2 text-rose-700 border border-rose-200/60 dark:bg-rose-950/60 dark:text-rose-300">
                          Decline reason: {request.review_note}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-200/60 dark:border-slate-700/60">
                    {request.status === 'appealed' ? (
                      <div className="grid gap-2 sm:grid-cols-2">
                        <button
                          type="button"
                          onClick={() => reviewAuthenticatorRecoveryRequest(request, 'approve_appeal')}
                          disabled={!canApproveAppeal || isBusy}
                          className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-black text-white shadow-xs transition hover:bg-emerald-700 disabled:opacity-50"
                        >
                          <CheckCircleIcon className="h-4 w-4 stroke-[2.5]" />
                          {isBusy && canApproveAppeal ? 'Approving...' : 'Approve Appeal'}
                        </button>
                        <button
                          type="button"
                          onClick={() => reviewAuthenticatorRecoveryRequest(request, 'deny_appeal')}
                          disabled={!canDenyAppeal || isBusy}
                          className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 transition hover:bg-rose-100 disabled:opacity-50"
                        >
                          <XMarkIcon className="h-4 w-4 stroke-[2.5]" />
                          {isBusy && canDenyAppeal ? 'Declining...' : 'Decline Appeal'}
                        </button>
                      </div>
                    ) : (
                      <div className="grid gap-2 sm:grid-cols-2">
                        <button
                          type="button"
                          onClick={() => reviewAuthenticatorRecoveryRequest(request, 'approve')}
                          disabled={!canApprove || isBusy}
                          className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-black text-white shadow-xs transition hover:bg-emerald-700 disabled:opacity-50"
                        >
                          <CheckCircleIcon className="h-4 w-4 stroke-[2.5]" />
                          {isBusy && canApprove ? 'Approving...' : 'Approve'}
                        </button>
                        <button
                          type="button"
                          onClick={() => reviewAuthenticatorRecoveryRequest(request, 'deny')}
                          disabled={!canDeny || isBusy}
                          className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 transition hover:bg-rose-100 disabled:opacity-50"
                        >
                          <XMarkIcon className="h-4 w-4 stroke-[2.5]" />
                          {isBusy && canDeny ? 'Declining...' : 'Decline'}
                        </button>
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          /* LIST VIEW */
          <div className="overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-2xs dark:border-slate-800 dark:bg-slate-900">
            <div className="overflow-x-auto custom-scrollbar">
              <table className="min-w-[750px] w-full text-left text-sm text-slate-600 dark:text-slate-300">
                <thead className="border-b border-slate-200/80 bg-slate-50/80 text-xs font-bold uppercase tracking-wider text-slate-500 dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-400">
                  <tr>
                    <th className="px-5 py-3.5">Account</th>
                    <th className="px-4 py-3.5">Status</th>
                    <th className="px-5 py-3.5">Reason</th>
                    <th className="px-4 py-3.5">Requested At</th>
                    <th className="px-5 py-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white dark:divide-slate-800 dark:bg-slate-900">
                  {paginatedRecoveryRequests.map((request) => {
                    const isBusy = busyAuthRecoveryId === request.id;
                    const canApprove = request.status === 'pending' || request.status === 'expired';
                    const canDeny = ['pending', 'approved', 'expired'].includes(request.status);
                    const canApproveAppeal = request.status === 'appealed';
                    const canDenyAppeal = request.status === 'appealed';
                    const displayName = request.full_name || request.username || request.identifier;

                    return (
                      <tr key={request.id} className="transition hover:bg-slate-50/70 dark:hover:bg-slate-800/50">
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-3">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-800 font-bold text-xs">
                              {getInitials({ full_name: request.full_name, username: request.username || request.identifier })}
                            </div>
                            <div className="min-w-0">
                              <div className="truncate font-bold text-sm text-slate-900 dark:text-white">{displayName}</div>
                              <div className="mt-0.5 flex flex-wrap gap-2 text-xs text-slate-400">
                                <span className="font-mono">@{request.username || request.identifier}</span>
                                {request.role && <span className="font-semibold text-slate-500">{formatRole(request.role)}</span>}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <span className={`inline-flex rounded-lg border px-2.5 py-1 text-xs font-bold uppercase tracking-wider ${getResetStatusClass(request.status)}`}>
                            {formatResetStatus(request.status)}
                          </span>
                        </td>
                        <td className="px-5 py-4 text-xs max-w-[18rem] text-slate-700 dark:text-slate-300">
                          {request.reason || 'N/A'}
                        </td>
                        <td className="px-4 py-4 font-mono text-xs text-slate-600 dark:text-slate-400">
                          {formatDateTime(request.requested_at)}
                        </td>
                        <td className="px-5 py-4 text-right">
                          <div className="flex justify-end gap-1.5">
                            {request.status === 'appealed' ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => reviewAuthenticatorRecoveryRequest(request, 'approve_appeal')}
                                  disabled={!canApproveAppeal || isBusy}
                                  className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-bold text-white shadow-xs transition hover:bg-emerald-700 disabled:opacity-50"
                                >
                                  <CheckCircleIcon className="h-3.5 w-3.5" />
                                  Approve
                                </button>
                                <button
                                  type="button"
                                  onClick={() => reviewAuthenticatorRecoveryRequest(request, 'deny_appeal')}
                                  disabled={!canDenyAppeal || isBusy}
                                  className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-bold text-rose-700 transition hover:bg-rose-100 disabled:opacity-50"
                                >
                                  <XMarkIcon className="h-3.5 w-3.5" />
                                  Decline
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => reviewAuthenticatorRecoveryRequest(request, 'approve')}
                                  disabled={!canApprove || isBusy}
                                  className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-bold text-white shadow-xs transition hover:bg-emerald-700 disabled:opacity-50"
                                >
                                  <CheckCircleIcon className="h-3.5 w-3.5" />
                                  Approve
                                </button>
                                <button
                                  type="button"
                                  onClick={() => reviewAuthenticatorRecoveryRequest(request, 'deny')}
                                  disabled={!canDeny || isBusy}
                                  className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-bold text-rose-700 transition hover:bg-rose-100 disabled:opacity-50"
                                >
                                  <XMarkIcon className="h-3.5 w-3.5" />
                                  Decline
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <SectionPagination
          currentPage={safeRecoveryPage}
          totalPages={totalRecoveryPages}
          totalItems={authRecoveryRequests.length}
          pageSize={RECOVERY_PAGE_SIZE}
          onPageChange={setRecoveryPage}
          itemName="recovery requests"
        />
      </section>

      {/* ─────────────────────────────────────────────────────────────────────────
          USER ACCOUNTS SECTION
         ───────────────────────────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-slate-900 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-black text-slate-900 dark:text-white">User Accounts</h2>
            <p className="mt-0.5 text-xs font-medium text-slate-500 dark:text-slate-400">
              {formatCount(filteredUsers.length)} shown of {formatCount(users.length)} total
            </p>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-center">
            <ViewToggle
              mode={accountsViewMode}
              onChange={setAccountsViewMode}
              options={[
                { mode: 'list', icon: ListBulletIcon, label: 'Table' },
                { mode: 'grid', icon: Squares2X2Icon, label: 'Grid' },
              ]}
            />
          </div>
        </div>

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }, (_, index) => (
              <div key={`account-skeleton-${index}`} className="rounded-xl border border-slate-200 p-4">
                <SkeletonText lines={['h-4 w-48', 'h-3 w-32']} />
              </div>
            ))}
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 p-12 text-center text-sm font-semibold text-slate-500 dark:border-slate-800 dark:text-slate-400">
            No accounts match these filters.
          </div>
        ) : accountsViewMode === 'list' ? (
          /* TABLE / LIST VIEW */
          <div className="overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-2xs dark:border-slate-800 dark:bg-slate-900">
            <div className="overflow-x-auto custom-scrollbar">
              <table className="min-w-[800px] w-full text-left text-sm text-slate-600 dark:text-slate-300">
                <thead className="border-b border-slate-200/80 bg-slate-50/80 text-xs font-bold uppercase tracking-wider text-slate-500 dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-400">
                  <tr>
                    <th className="px-5 py-3.5">Account</th>
                    <th className="px-4 py-3.5">Role</th>
                    <th className="px-4 py-3.5">Status</th>
                    <th className="px-4 py-3.5">MFA</th>
                    <th className="px-4 py-3.5">Created</th>
                    <th className="px-5 py-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white dark:divide-slate-800 dark:bg-slate-900">
                  {paginatedUsers.map((user) => {
                    const isSelf = user.id === currentUser.id;
                    const isLastAdmin = user.role === 'admin' && user.is_active && activeAdmins.length <= 1;
                    const isBusy = busyUserId === user.id;

                    return (
                      <tr key={user.id} className="transition hover:bg-slate-50/70 dark:hover:bg-slate-800/50">
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-3">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-800 font-bold text-xs">
                              {getInitials(user)}
                            </div>
                            <div className="min-w-0">
                              <div className="truncate font-bold text-sm text-slate-900 dark:text-white">
                                {user.full_name || user.username}
                              </div>
                              <div className="mt-0.5 truncate font-mono text-xs text-slate-400">@{user.username}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <span className="inline-flex rounded-lg border border-slate-200 bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                            {formatRole(user.role)}
                          </span>
                        </td>
                        <td className="px-4 py-4">
                          <span
                            className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-bold ${
                              user.is_active
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                                : 'border-slate-200 bg-slate-100 text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400'
                            }`}
                          >
                            {user.is_active ? <CheckCircleIcon className="h-3.5 w-3.5" /> : <XMarkIcon className="h-3.5 w-3.5" />}
                            {user.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="px-4 py-4 text-xs font-semibold text-slate-500 dark:text-slate-400">
                          {user.authenticator_mfa_enabled ? (
                            <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-bold text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
                              <CheckCircleIcon className="h-3.5 w-3.5" />
                              Enabled ({formatCount(user.recovery_codes_remaining)} codes)
                            </span>
                          ) : user.role === 'admin' ? (
                            <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-700 dark:bg-amber-950/60 dark:text-amber-300">
                              Mandatory (Pending)
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                              Optional (Off)
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-4 font-mono text-xs text-slate-500 dark:text-slate-400">{formatDate(user.created_at)}</td>
                        <td className="px-5 py-4">
                          <div className="flex justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => openEditModal(user)}
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 shadow-2xs transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                            >
                              <PencilSquareIcon className="h-3.5 w-3.5" />
                              Edit
                            </button>
                            {user.authenticator_mfa_enabled && (
                              <button
                                type="button"
                                onClick={() => resetAuthenticator(user)}
                                disabled={isBusy}
                                className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-bold text-amber-700 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                                title="Reset user MFA"
                              >
                                <KeyIcon className="h-3.5 w-3.5" />
                                Reset MFA
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => (user.is_active ? disableAccount(user) : toggleAccountStatus(user))}
                              disabled={isBusy || isSelf || isLastAdmin}
                              className={`inline-flex items-center justify-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                                user.is_active
                                  ? 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 dark:border-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
                                  : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                              }`}
                              title={user.is_active ? 'Disable user account' : 'Activate user account'}
                            >
                              {user.is_active ? <NoSymbolIcon className="h-3.5 w-3.5" /> : <CheckCircleIcon className="h-3.5 w-3.5" />}
                              {user.is_active ? 'Disable' : 'Activate'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          /* GRID VIEW */
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {paginatedUsers.map((user) => {
              const isSelf = user.id === currentUser.id;
              const isLastAdmin = user.role === 'admin' && user.is_active && activeAdmins.length <= 1;
              const isBusy = busyUserId === user.id;

              return (
                <article key={user.id} className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-800/60 flex flex-col justify-between">
                  <div>
                    <div className="flex items-start gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-800 font-bold text-sm">
                        {getInitials(user)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-bold text-sm text-slate-900 dark:text-white">
                          {user.full_name || user.username}
                        </div>
                        <div className="mt-0.5 truncate font-mono text-xs text-slate-400">@{user.username}</div>
                      </div>
                      <span className="rounded-lg border border-slate-200 bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                        {formatRole(user.role)}
                      </span>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-lg bg-white/80 p-2 border border-slate-100 dark:bg-slate-900/60 dark:border-slate-800">
                        <div className="text-xs font-bold uppercase tracking-wider text-slate-400">Status</div>
                        <div className="mt-1 flex items-center gap-1 font-bold">
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${
                              user.is_active
                                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                                : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                            }`}
                          >
                            {user.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </div>
                      </div>

                      <div className="rounded-lg bg-white/80 p-2 border border-slate-100 dark:bg-slate-900/60 dark:border-slate-800">
                        <div className="text-xs font-bold uppercase tracking-wider text-slate-400">MFA</div>
                        <div className="mt-1 font-bold text-slate-800 dark:text-slate-200">
                          {user.authenticator_mfa_enabled
                            ? `${formatCount(user.recovery_codes_remaining)} codes`
                            : user.role === 'admin'
                              ? 'Mandatory (Pending)'
                              : 'Optional (Off)'}
                        </div>
                      </div>
                    </div>

                    <div className="mt-2 text-xs text-slate-400 font-mono">
                      Created: {formatDate(user.created_at)}
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-200/60 dark:border-slate-700/60 flex flex-wrap gap-1.5 justify-end">
                    <button
                      type="button"
                      onClick={() => openEditModal(user)}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 shadow-2xs transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                    >
                      <PencilSquareIcon className="h-3.5 w-3.5" />
                      Edit
                    </button>
                    {user.authenticator_mfa_enabled && (
                      <button
                        type="button"
                        onClick={() => resetAuthenticator(user)}
                        disabled={isBusy}
                        className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-bold text-amber-700 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                        title="Reset user MFA"
                      >
                        <KeyIcon className="h-3.5 w-3.5" />
                        Reset MFA
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => (user.is_active ? disableAccount(user) : toggleAccountStatus(user))}
                      disabled={isBusy || isSelf || isLastAdmin}
                      className={`inline-flex items-center justify-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                        user.is_active
                          ? 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 dark:border-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
                          : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                      }`}
                      title={user.is_active ? 'Disable user account' : 'Activate user account'}
                    >
                      {user.is_active ? <NoSymbolIcon className="h-3.5 w-3.5" /> : <CheckCircleIcon className="h-3.5 w-3.5" />}
                      {user.is_active ? 'Disable' : 'Activate'}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        <SectionPagination
          currentPage={safeAccountsPage}
          totalPages={totalAccountPages}
          totalItems={filteredUsers.length}
          pageSize={ACCOUNTS_PAGE_SIZE}
          onPageChange={setAccountsPage}
          itemName="accounts"
        />
      </section>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 p-5 dark:border-slate-800">
              <div>
                <h3 className="text-lg font-black text-slate-900 dark:text-white">
                  {editingUser ? 'Edit Account' : 'Add Account'}
                </h3>
                <p className="mt-0.5 text-xs font-medium text-slate-500 dark:text-slate-400">
                  {editingUser ? 'Update role, status, profile, or password.' : 'Create an account for canteen access.'}
                </p>
              </div>
              <button
                type="button"
                onClick={closeModal}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
                aria-label="Close account form"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={saveAccount} className="space-y-4 p-5">
              {formError && (
                <DismissibleAlert resetKey={formError} tone="red" title="Save issue" className="rounded-xl">
                  {formError}
                </DismissibleAlert>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Username *</span>
                  <input
                    type="text"
                    required
                    value={formData.username}
                    onChange={(event) => setFormData((value) => ({ ...value, username: event.target.value }))}
                    className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 text-sm font-semibold text-slate-900 shadow-2xs outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    autoComplete="username"
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Full Name</span>
                  <input
                    type="text"
                    value={formData.full_name}
                    onChange={(event) => setFormData((value) => ({ ...value, full_name: event.target.value }))}
                    className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 text-sm font-semibold text-slate-900 shadow-2xs outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    autoComplete="name"
                  />
                </label>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Role *</span>
                  <select
                    value={formData.role}
                    onChange={(event) => setFormData((value) => ({ ...value, role: event.target.value }))}
                    className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 text-sm font-bold text-slate-700 shadow-2xs outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                    disabled={isEditingSelf}
                  >
                    {ROLE_OPTIONS.map((role) => (
                      <option key={role.value} value={role.value}>
                        {role.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Status</span>
                  <select
                    value={formData.is_active ? 'active' : 'inactive'}
                    onChange={(event) =>
                      setFormData((value) => ({ ...value, is_active: event.target.value === 'active' }))
                    }
                    className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 text-sm font-bold text-slate-700 shadow-2xs outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                    disabled={!editingUser || isEditingSelf}
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </label>
              </div>

              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  {editingUser ? 'New Password' : 'Password *'}
                </span>
                <input
                  type="password"
                  required={!editingUser}
                  minLength={6}
                  value={formData.password}
                  onChange={(event) => setFormData((value) => ({ ...value, password: event.target.value }))}
                  className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 text-sm font-semibold text-slate-900 shadow-2xs outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  autoComplete={editingUser ? 'new-password' : 'current-password'}
                  placeholder={editingUser ? 'Leave blank to keep current password' : 'At least 6 characters'}
                />
                {editingUser && (
                  <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                    Changing the password resets MFA and remembered devices for this account.
                  </span>
                )}
              </label>

              <div className="flex flex-col-reverse gap-2.5 pt-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={closeModal}
                  className="inline-flex h-11 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-xs font-bold text-slate-700 shadow-2xs transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-xs font-black text-white shadow-xs transition hover:bg-emerald-700 active:scale-95 disabled:opacity-50"
                  disabled={saving}
                >
                  <PlusIcon className="h-4 w-4 stroke-[2.5]" />
                  {saving ? 'Saving...' : editingUser ? 'Save Changes' : 'Create Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
