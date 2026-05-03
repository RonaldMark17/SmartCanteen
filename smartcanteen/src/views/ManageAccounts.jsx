import { useCallback, useEffect, useMemo, useState } from 'react';
import { API } from '../services/api';
import DismissibleAlert from '../components/DismissibleAlert';
import { Skeleton, SkeletonText } from '../components/Skeleton';
import {
  ArrowPathIcon,
  CheckCircleIcon,
  KeyIcon,
  MagnifyingGlassIcon,
  PencilSquareIcon,
  PlusIcon,
  ShieldCheckIcon,
  TrashIcon,
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

function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem('sc_user') || '{}');
  } catch {
    return {};
  }
}

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

function AccountMetricCard({ title, value, detail, icon, tone = 'slate' }) {
  const MetricIcon = icon;
  const tones = {
    teal: 'bg-teal-50 text-teal-700 ring-teal-100',
    emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
    amber: 'bg-amber-50 text-amber-700 ring-amber-100',
    slate: 'bg-slate-50 text-slate-700 ring-slate-100',
  };

  return (
    <div className="panel-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-medium uppercase tracking-wider text-slate-400">{title}</div>
          <div className="mt-2 truncate text-2xl font-semibold text-slate-900">{value}</div>
          <div className="mt-1 text-sm text-slate-500">{detail}</div>
        </div>
        <div className={`rounded-lg p-2 ring-1 ${tones[tone] || tones.slate}`}>
          <MetricIcon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

export default function ManageAccounts() {
  const currentUser = getStoredUser();
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

  useEffect(() => {
    loadUsers({ showLoading: true });
  }, [loadUsers]);

  const activeUsers = users.filter((user) => user.is_active);
  const activeAdmins = users.filter((user) => user.is_active && user.role === 'admin');
  const protectedMfaUsers = users.filter((user) => user.authenticator_mfa_enabled);
  const lowRecoveryUsers = users.filter(
    (user) => user.authenticator_mfa_enabled && Number(user.recovery_codes_remaining || 0) <= 1
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

  const deleteAccount = async (user) => {
    const confirmed = window.confirm(
      `Delete ${user.username}? This safely deactivates the account and preserves activity history.`
    );
    if (!confirmed) {
      return;
    }

    setBusyUserId(user.id);
    setError('');
    try {
      await API.deleteAdminUser(user.id);
      window.showToast?.(`Account deactivated for ${user.username}.`, 'success');
      await loadUsers();
    } catch (err) {
      setError(err.message || 'Account could not be deleted.');
    } finally {
      setBusyUserId(null);
    }
  };

  const resetAuthenticator = async (user) => {
    const confirmed = window.confirm(
      `Reset authenticator for ${user.username}? They will set up MFA again at next login.`
    );
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

  const isEditingSelf = editingUser?.id === currentUser.id;

  return (
    <div className="view-shell h-auto min-h-full gap-5 pb-6">
      <div className="view-header md:flex-row md:items-center">
        <div>
          <div className="view-eyebrow">
            <UserGroupIcon className="h-4 w-4" />
            Admin Access
          </div>
          <h1 className="view-title mt-3">Manage Accounts</h1>
          <p className="view-subtitle max-w-3xl">
            Create accounts, update roles, reset MFA, and deactivate access when needed.
          </p>
        </div>

        <div className="flex w-full flex-wrap gap-3 md:w-auto">
          <button type="button" onClick={() => loadUsers({ showLoading: true })} className="action-button">
            <ArrowPathIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
          <button type="button" onClick={openCreateModal} className="primary-action-button">
            <PlusIcon className="h-5 w-5" />
            Add Account
          </button>
        </div>
      </div>

      {error && (
        <DismissibleAlert resetKey={error} tone="red" title="Account issue" className="rounded-xl">
          {error}
        </DismissibleAlert>
      )}

      <div className="grid shrink-0 grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <AccountMetricCard
          title="Accounts"
          value={formatCount(users.length)}
          detail={`${formatCount(activeUsers.length)} active`}
          icon={UserGroupIcon}
          tone="teal"
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
      </div>

      <div className="control-surface grid gap-3 lg:grid-cols-[minmax(0,1fr)_13rem_13rem]">
        <label className="relative block">
          <span className="sr-only">Search accounts</span>
          <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search name, username, role, status, or ID"
            className="field-control w-full pl-10"
          />
        </label>

        <select
          value={roleFilter}
          onChange={(event) => setRoleFilter(event.target.value)}
          className="field-control w-full"
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
          className="field-control w-full"
          aria-label="Filter accounts by status"
        >
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      <section className="data-card shrink-0">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Authenticator Recovery</h2>
            <p className="mt-1 text-sm text-slate-500">
              Review backup-code coverage and reset MFA when an account loses access.
            </p>
          </div>
          <KeyIcon className="h-5 w-5 shrink-0 text-slate-400" />
        </div>

        <div className="grid gap-3 p-4 lg:grid-cols-2 2xl:grid-cols-3">
          {loading ? (
            Array.from({ length: 3 }, (_, index) => (
              <div key={`recovery-skeleton-${index}`} className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="flex items-center gap-3">
                  <Skeleton className="h-10 w-10 rounded-full" />
                  <SkeletonText lines={['h-4 w-32', 'h-3 w-24']} className="flex-1" />
                </div>
                <Skeleton className="mt-4 h-20 rounded-lg" />
              </div>
            ))
          ) : filteredUsers.length === 0 ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500 lg:col-span-2 2xl:col-span-3">
              No accounts match these recovery filters.
            </div>
          ) : (
            filteredUsers.map((user) => {
              const hasAuthenticator = Boolean(user.authenticator_mfa_enabled);
              const recoveryCodes = Number(user.recovery_codes_remaining || 0);
              const isBusy = busyUserId === user.id;

              return (
                <article key={`recovery-${user.id}`} className="rounded-lg border border-slate-200 bg-white p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white">
                      {getInitials(user)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold text-slate-900">
                        {user.full_name || user.username}
                      </div>
                      <div className="mt-1 truncate font-mono text-xs text-slate-400">@{user.username}</div>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ${
                        hasAuthenticator
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-amber-50 text-amber-700'
                      }`}
                    >
                      {hasAuthenticator ? 'MFA on' : 'Setup'}
                    </span>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                    <div className="rounded-lg bg-slate-50 px-3 py-2">
                      <div className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
                        Recovery
                      </div>
                      <div className={`mt-1 font-semibold ${recoveryCodes <= 1 ? 'text-amber-700' : 'text-slate-900'}`}>
                        {formatCount(recoveryCodes)} codes
                      </div>
                    </div>
                    <div className="rounded-lg bg-slate-50 px-3 py-2">
                      <div className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
                        Remembered
                      </div>
                      <div className="mt-1 font-semibold text-slate-900">
                        {formatCount(user.remembered_devices_active)} devices
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => resetAuthenticator(user)}
                    disabled={!hasAuthenticator || isBusy}
                    className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2.5 text-sm font-medium text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <ShieldCheckIcon className="h-4 w-4" />
                    {isBusy ? 'Resetting...' : 'Reset Authenticator'}
                  </button>
                </article>
              );
            })
          )}
        </div>
      </section>

      <section className="data-card flex min-h-0 flex-col">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">User Accounts</h2>
            <p className="mt-1 text-sm text-slate-500">
              {formatCount(filteredUsers.length)} shown of {formatCount(users.length)} total
            </p>
          </div>
        </div>

        <div className="custom-scrollbar hidden overflow-x-auto md:block">
          <table className="min-w-full text-left text-sm text-slate-600">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-6 py-4">Account</th>
                <th className="px-6 py-4">Role</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">MFA</th>
                <th className="px-6 py-4">Created</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                Array.from({ length: 6 }, (_, index) => (
                  <tr key={`account-skeleton-${index}`}>
                    <td className="px-6 py-4"><SkeletonText lines={['h-4 w-36', 'h-3 w-24']} /></td>
                    <td className="px-6 py-4"><Skeleton className="h-7 w-20 rounded-full" /></td>
                    <td className="px-6 py-4"><Skeleton className="h-7 w-20 rounded-full" /></td>
                    <td className="px-6 py-4"><Skeleton className="h-4 w-24" /></td>
                    <td className="px-6 py-4"><Skeleton className="h-4 w-24" /></td>
                    <td className="px-6 py-4"><Skeleton className="ml-auto h-8 w-48 rounded-lg" /></td>
                  </tr>
                ))
              ) : filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan="6" className="px-6 py-12 text-center text-slate-500">
                    No accounts match these filters.
                  </td>
                </tr>
              ) : (
                filteredUsers.map((user) => {
                  const isSelf = user.id === currentUser.id;
                  const isLastAdmin = user.role === 'admin' && user.is_active && activeAdmins.length <= 1;
                  const isBusy = busyUserId === user.id;

                  return (
                    <tr key={user.id} className="transition-colors hover:bg-slate-50">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white">
                            {getInitials(user)}
                          </div>
                          <div className="min-w-0">
                            <div className="truncate font-semibold text-slate-900">
                              {user.full_name || user.username}
                            </div>
                            <div className="mt-1 truncate font-mono text-xs text-slate-400">@{user.username}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                          {formatRole(user.role)}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium ${
                            user.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                          }`}
                        >
                          {user.is_active ? <CheckCircleIcon className="h-3.5 w-3.5" /> : <XMarkIcon className="h-3.5 w-3.5" />}
                          {user.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-slate-500">
                        {user.authenticator_mfa_enabled
                          ? `${formatCount(user.recovery_codes_remaining)} recovery codes`
                          : 'Setup pending'}
                      </td>
                      <td className="px-6 py-4 text-slate-500">{formatDate(user.created_at)}</td>
                      <td className="px-6 py-4">
                        <div className="flex justify-end gap-2">
                          <button type="button" onClick={() => openEditModal(user)} className="action-button px-3 py-2">
                            <PencilSquareIcon className="h-4 w-4" />
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => (user.is_active ? deleteAccount(user) : toggleAccountStatus(user))}
                            disabled={isBusy || isSelf || isLastAdmin}
                            className={`inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
                              user.is_active
                                ? 'border-red-100 bg-red-50 text-red-700 hover:bg-red-100'
                                : 'border-emerald-100 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                            }`}
                          >
                            {user.is_active ? <TrashIcon className="h-4 w-4" /> : <CheckCircleIcon className="h-4 w-4" />}
                            {user.is_active ? 'Delete' : 'Activate'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="space-y-3 p-4 md:hidden">
          {loading ? (
            Array.from({ length: 4 }, (_, index) => (
              <div key={`account-mobile-skeleton-${index}`} className="rounded-lg border border-slate-200 bg-white p-4">
                <SkeletonText lines={['h-4 w-36', 'h-3 w-24']} />
                <Skeleton className="mt-4 h-9 rounded-lg" />
              </div>
            ))
          ) : filteredUsers.length === 0 ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
              No accounts match these filters.
            </div>
          ) : (
            filteredUsers.map((user) => {
              const isSelf = user.id === currentUser.id;
              const isLastAdmin = user.role === 'admin' && user.is_active && activeAdmins.length <= 1;
              const isBusy = busyUserId === user.id;

              return (
                <article key={user.id} className="rounded-lg border border-slate-200 bg-white p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white">
                      {getInitials(user)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold text-slate-900">{user.full_name || user.username}</div>
                      <div className="mt-1 truncate font-mono text-xs text-slate-400">@{user.username}</div>
                    </div>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                      {formatRole(user.role)}
                    </span>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                    <div className="rounded-lg bg-slate-50 px-3 py-2">
                      <div className="text-[10px] uppercase tracking-wider text-slate-400">Status</div>
                      <div className="mt-1 font-semibold text-slate-900">{user.is_active ? 'Active' : 'Inactive'}</div>
                    </div>
                    <div className="rounded-lg bg-slate-50 px-3 py-2">
                      <div className="text-[10px] uppercase tracking-wider text-slate-400">MFA</div>
                      <div className="mt-1 font-semibold text-slate-900">
                        {user.authenticator_mfa_enabled ? 'Enabled' : 'Pending'}
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-2">
                    <button type="button" onClick={() => openEditModal(user)} className="action-button w-full">
                      <PencilSquareIcon className="h-4 w-4" />
                      Edit Account
                    </button>
                    <button
                      type="button"
                      onClick={() => (user.is_active ? deleteAccount(user) : toggleAccountStatus(user))}
                      disabled={isBusy || isSelf || isLastAdmin}
                      className={`inline-flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
                        user.is_active
                          ? 'border-red-100 bg-red-50 text-red-700 hover:bg-red-100'
                          : 'border-emerald-100 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                      }`}
                    >
                      {user.is_active ? <TrashIcon className="h-4 w-4" /> : <CheckCircleIcon className="h-4 w-4" />}
                      {user.is_active ? 'Delete Account' : 'Activate Account'}
                    </button>
                  </div>
                </article>
              );
            })
          )}
        </div>
      </section>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg overflow-hidden rounded-lg bg-white">
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">
                  {editingUser ? 'Edit Account' : 'Add Account'}
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  {editingUser ? 'Update role, status, profile, or password.' : 'Create an account for canteen access.'}
                </p>
              </div>
              <button
                type="button"
                onClick={closeModal}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-50 hover:text-slate-700"
                aria-label="Close account form"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={saveAccount} className="space-y-4 p-5">
              {formError && (
                <DismissibleAlert resetKey={formError} tone="red" title="Save issue" className="rounded-lg">
                  {formError}
                </DismissibleAlert>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-slate-700">Username *</span>
                  <input
                    type="text"
                    required
                    value={formData.username}
                    onChange={(event) => setFormData((value) => ({ ...value, username: event.target.value }))}
                    className="field-control w-full"
                    autoComplete="username"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-slate-700">Full Name</span>
                  <input
                    type="text"
                    value={formData.full_name}
                    onChange={(event) => setFormData((value) => ({ ...value, full_name: event.target.value }))}
                    className="field-control w-full"
                    autoComplete="name"
                  />
                </label>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-slate-700">Role *</span>
                  <select
                    value={formData.role}
                    onChange={(event) => setFormData((value) => ({ ...value, role: event.target.value }))}
                    className="field-control w-full"
                    disabled={isEditingSelf}
                  >
                    {ROLE_OPTIONS.map((role) => (
                      <option key={role.value} value={role.value}>
                        {role.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-sm font-medium text-slate-700">Status</span>
                  <select
                    value={formData.is_active ? 'active' : 'inactive'}
                    onChange={(event) =>
                      setFormData((value) => ({ ...value, is_active: event.target.value === 'active' }))
                    }
                    className="field-control w-full"
                    disabled={!editingUser || isEditingSelf}
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </label>
              </div>

              <label className="block">
                <span className="mb-1 block text-sm font-medium text-slate-700">
                  {editingUser ? 'New Password' : 'Password *'}
                </span>
                <input
                  type="password"
                  required={!editingUser}
                  minLength={6}
                  value={formData.password}
                  onChange={(event) => setFormData((value) => ({ ...value, password: event.target.value }))}
                  className="field-control w-full"
                  autoComplete={editingUser ? 'new-password' : 'current-password'}
                  placeholder={editingUser ? 'Leave blank to keep current password' : 'At least 6 characters'}
                />
                {editingUser && (
                  <span className="mt-1 block text-xs text-slate-500">
                    Changing the password resets MFA and remembered devices for this account.
                  </span>
                )}
              </label>

              <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
                <button type="button" onClick={closeModal} className="action-button" disabled={saving}>
                  Cancel
                </button>
                <button type="submit" className="primary-action-button" disabled={saving}>
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
