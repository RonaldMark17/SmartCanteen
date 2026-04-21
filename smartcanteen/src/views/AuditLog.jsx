import { useCallback, useState, useEffect } from 'react';
import { API } from '../services/api';
import { Skeleton, SkeletonText } from '../components/Skeleton';
import {
  ArrowPathIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  ComputerDesktopIcon,
  KeyIcon,
  ShieldCheckIcon,
  UserGroupIcon,
} from '@heroicons/react/24/outline';

const PH_TIMEZONE = 'Asia/Manila';
const AUDIT_REFRESH_INTERVAL_MS = 15000;
const AUDIT_LOGS_PER_PAGE = 10;
const MAX_PAGE_BUTTONS = 5;

function formatCount(value) {
  return Number(value || 0).toLocaleString('en-PH');
}

function getPageNumbers(currentPage, totalPages) {
  const visibleCount = Math.min(MAX_PAGE_BUTTONS, totalPages);
  let start = Math.max(1, currentPage - Math.floor(visibleCount / 2));
  const end = Math.min(totalPages, start + visibleCount - 1);
  start = Math.max(1, end - visibleCount + 1);

  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function parseAuditTimestamp(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  const rawValue = String(value).trim();
  if (!rawValue) {
    return null;
  }

  const normalizedValue = /(?:[zZ]|[+-]\d{2}:\d{2})$/.test(rawValue)
    ? rawValue
    : `${rawValue}Z`;
  const date = new Date(normalizedValue);

  return Number.isNaN(date.getTime()) ? null : date;
}

function formatPhilippineDateTime(value) {
  const date = parseAuditTimestamp(value);
  if (!date) {
    return 'Not available';
  }

  return date.toLocaleString('en-PH', {
    timeZone: PH_TIMEZONE,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatActionLabel(action) {
  return String(action || 'UNKNOWN')
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getActionTone(action) {
  const value = String(action || '').toLowerCase();

  if (value.includes('login') || value.includes('auth')) {
    return 'bg-sky-50 text-sky-700 ring-sky-100';
  }
  if (value.includes('delete') || value.includes('reset') || value.includes('failed')) {
    return 'bg-red-50 text-red-700 ring-red-100';
  }
  if (value.includes('product') || value.includes('inventory')) {
    return 'bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-100';
  }
  if (value.includes('transaction') || value.includes('sale')) {
    return 'bg-emerald-50 text-emerald-700 ring-emerald-100';
  }
  if (value.includes('seed')) {
    return 'bg-amber-50 text-amber-700 ring-amber-100';
  }

  return 'bg-slate-100 text-slate-700 ring-slate-200';
}

function getInitials(user) {
  const name = String(user?.full_name || user?.username || 'SC').trim();
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('') || 'SC';
}

function MetricCard({ title, value, detail, icon, tone = 'slate' }) {
  const MetricIcon = icon;
  const toneClass = {
    emerald: 'bg-emerald-50 text-emerald-600 ring-emerald-100',
    sky: 'bg-sky-50 text-sky-600 ring-sky-100',
    amber: 'bg-amber-50 text-amber-600 ring-amber-100',
    slate: 'bg-slate-100 text-slate-600 ring-slate-200',
  }[tone];

  return (
    <div className="panel-card flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">{title}</div>
        <div className="mt-2 truncate text-2xl font-black text-slate-950">{value}</div>
        <div className="mt-1 truncate text-sm font-semibold text-slate-500">{detail}</div>
      </div>
      <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ring-1 ${toneClass}`}>
        <MetricIcon className="h-6 w-6" />
      </div>
    </div>
  );
}

function PageControls({
  safeCurrentPage,
  totalPages,
  pageNumbers,
  setCurrentPage,
}) {
  if (totalPages <= 1) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => setCurrentPage(Math.max(1, safeCurrentPage - 1))}
        disabled={safeCurrentPage === 1}
        aria-label="Previous audit log page"
        className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-black text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <ChevronLeftIcon className="h-4 w-4" />
        <span className="hidden sm:inline">Previous</span>
      </button>

      {pageNumbers.map((pageNumber) => (
        <button
          key={pageNumber}
          type="button"
          onClick={() => setCurrentPage(pageNumber)}
          aria-current={pageNumber === safeCurrentPage ? 'page' : undefined}
          className={`inline-flex h-10 min-w-10 items-center justify-center rounded-xl px-3 text-sm font-black transition ${
            pageNumber === safeCurrentPage
              ? 'bg-slate-900 text-white'
              : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
          }`}
        >
          {formatCount(pageNumber)}
        </button>
      ))}

      <button
        type="button"
        onClick={() => setCurrentPage(Math.min(totalPages, safeCurrentPage + 1))}
        disabled={safeCurrentPage === totalPages}
        aria-label="Next audit log page"
        className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-black text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="hidden sm:inline">Next</span>
        <ChevronRightIcon className="h-4 w-4" />
      </button>
    </div>
  );
}

export default function AuditLog() {
  const [logs, setLogs] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [usersLoading, setUsersLoading] = useState(true);
  const [error, setError] = useState('');
  const [usersError, setUsersError] = useState('');
  const [resettingUserId, setResettingUserId] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [philippineNow, setPhilippineNow] = useState(() => formatPhilippineDateTime(new Date()));

  const loadLogs = useCallback(async ({ showLoading = false } = {}) => {
    if (showLoading) {
      setLoading(true);
    }

    setError('');
    try {
      const data = await API.getAuditLogs();
      setLogs(Array.isArray(data) ? data : []);
      setLastUpdated(new Date());
    } catch (err) {
      console.error('Audit Log error:', err);
      setError(err.message || 'Audit activity could not be loaded.');
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  }, []);

  const loadUsers = useCallback(async ({ showLoading = false } = {}) => {
    if (showLoading) {
      setUsersLoading(true);
    }

    setUsersError('');
    try {
      const data = await API.getAdminUsers();
      setUsers(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('User recovery error:', err);
      setUsersError(err.message || 'User recovery status could not be loaded.');
    } finally {
      if (showLoading) {
        setUsersLoading(false);
      }
    }
  }, []);

  const refreshAll = () => {
    loadLogs({ showLoading: true });
    loadUsers({ showLoading: true });
  };

  const resetAuthenticator = async (user) => {
    const username = user?.username || 'this user';
    const confirmed = window.confirm(
      `Reset authenticator for ${username}? They will need to set up a new authenticator app at next login.`
    );

    if (!confirmed) {
      return;
    }

    setResettingUserId(user.id);
    setUsersError('');
    try {
      await API.resetUserAuthenticator(user.id, { revoke_remembered_devices: true });
      window.showToast?.(`Authenticator reset for ${username}.`, 'success');
      await Promise.all([loadUsers(), loadLogs()]);
    } catch (err) {
      setUsersError(err.message || 'Authenticator reset failed.');
    } finally {
      setResettingUserId(null);
    }
  };

  useEffect(() => {
    loadLogs({ showLoading: true });
    loadUsers({ showLoading: true });

    const refreshId = window.setInterval(() => {
      loadLogs();
      loadUsers();
    }, AUDIT_REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(refreshId);
    };
  }, [loadLogs, loadUsers]);

  useEffect(() => {
    const timerId = window.setInterval(() => {
      setPhilippineNow(formatPhilippineDateTime(new Date()));
    }, 1000);

    return () => {
      window.clearInterval(timerId);
    };
  }, []);

  const totalPages = Math.max(1, Math.ceil(logs.length / AUDIT_LOGS_PER_PAGE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const pageStartIndex = logs.length === 0 ? 0 : (safeCurrentPage - 1) * AUDIT_LOGS_PER_PAGE;
  const paginatedLogs = logs.slice(pageStartIndex, pageStartIndex + AUDIT_LOGS_PER_PAGE);
  const pageStartCount = logs.length === 0 ? 0 : pageStartIndex + 1;
  const pageEndCount = Math.min(pageStartIndex + paginatedLogs.length, logs.length);
  const pageNumbers = getPageNumbers(safeCurrentPage, totalPages);
  const mfaEnabledCount = users.filter((user) => Boolean(user.authenticator_mfa_enabled)).length;
  const lowRecoveryCount = users.filter((user) => Number(user.recovery_codes_remaining || 0) <= 1).length;

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  return (
    <div className="view-shell h-auto min-h-full pb-6">
      <div className="view-header md:flex-row md:items-center">
        <div>
          <div className="view-eyebrow">
            <ShieldCheckIcon className="h-4 w-4" />
            Security Trail
          </div>
          <h1 className="view-title mt-3">Audit Log</h1>
          <p className="view-subtitle max-w-3xl">
            System actions, authenticator recovery, and access events in Philippine time.
          </p>
        </div>

        <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center">
          <button
            type="button"
            onClick={refreshAll}
            className="action-button"
          >
            <ArrowPathIcon className={`h-4 w-4 ${loading || usersLoading ? 'animate-spin' : ''}`} />
            Refresh
          </button>

          <div className="rounded-2xl border border-sky-100 bg-sky-50 px-4 py-3 text-sm text-sky-800 shadow-sm">
            <div className="flex items-center gap-2 font-black">
              <ClockIcon className="h-4 w-4" />
              Philippine Time
            </div>
            <div className="mt-1 font-semibold">{philippineNow}</div>
            {lastUpdated && (
              <div className="mt-1 text-xs font-bold text-sky-700">
                Synced {formatPhilippineDateTime(lastUpdated)}
              </div>
            )}
          </div>
        </div>
      </div>

      {(error || usersError) && (
        <div className="space-y-3">
          {error && (
            <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
              {error}
            </div>
          )}
          {usersError && (
            <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
              {usersError}
            </div>
          )}
        </div>
      )}

      <div className="grid shrink-0 grid-cols-1 gap-4 md:grid-cols-3">
        <MetricCard
          title="Activities"
          value={formatCount(logs.length)}
          detail={loading ? 'Refreshing feed' : 'Recorded events'}
          icon={ShieldCheckIcon}
          tone="sky"
        />
        <MetricCard
          title="Protected Users"
          value={`${formatCount(mfaEnabledCount)}/${formatCount(users.length)}`}
          detail={usersLoading ? 'Checking MFA' : 'Authenticator enabled'}
          icon={UserGroupIcon}
          tone="emerald"
        />
        <MetricCard
          title="Recovery Risk"
          value={formatCount(lowRecoveryCount)}
          detail="Users with 0-1 backup codes"
          icon={KeyIcon}
          tone={lowRecoveryCount > 0 ? 'amber' : 'slate'}
        />
      </div>

      <div className="grid min-h-0 flex-1 gap-5 xl:grid-cols-[minmax(0,1fr)_26rem]">
        <section className="data-card flex min-h-0 flex-col">
          <div className="flex shrink-0 flex-col gap-3 border-b border-slate-100 bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-[22px] font-extrabold tracking-tight text-slate-900">Activity Feed</h2>
              <p className="mt-1 text-sm text-slate-500">
                Login attempts, inventory changes, seeding, and cashier activity.
              </p>
            </div>
            <span className="self-start rounded-full bg-slate-100 px-3 py-1.5 text-xs font-black text-slate-600 sm:self-center">
              {formatCount(logs.length)} activities
            </span>
          </div>

          <div className="custom-scrollbar hidden min-h-0 flex-1 overflow-auto md:block">
            <table className="min-w-full text-left text-sm text-slate-600">
              <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 text-xs font-bold uppercase text-slate-500">
                <tr>
                  <th className="px-6 py-4">Timestamp</th>
                  <th className="px-6 py-4">Action</th>
                  <th className="px-6 py-4">Details</th>
                  <th className="px-6 py-4">Real IP Address</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  Array.from({ length: 7 }, (_, index) => (
                    <tr key={`audit-skeleton-${index}`}>
                      <td className="px-6 py-4"><Skeleton className="h-4 w-36" /></td>
                      <td className="px-6 py-4"><Skeleton className="h-7 w-28 rounded-full" /></td>
                      <td className="px-6 py-4"><SkeletonText lines={['h-4 w-full', 'h-4 w-4/5']} /></td>
                      <td className="px-6 py-4"><Skeleton className="h-4 w-24" /></td>
                    </tr>
                  ))
                ) : logs.length === 0 ? (
                  <tr><td colSpan="4" className="text-center py-12 text-slate-500">No audit activity found.</td></tr>
                ) : paginatedLogs.map((log, index) => (
                  <tr key={log.id || `${log.timestamp}-${index}`} className="transition-colors hover:bg-slate-50">
                    <td className="whitespace-nowrap px-6 py-4 font-semibold text-slate-700">
                      {formatPhilippineDateTime(log.timestamp)}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-widest ring-1 ${getActionTone(log.action)}`}>
                        {formatActionLabel(log.action)}
                      </span>
                    </td>
                    <td className="max-w-[32rem] px-6 py-4 leading-6 text-slate-800">
                      {log.details || 'N/A'}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 font-mono text-xs text-slate-400">
                      {log.ip_address || 'N/A'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="p-4 md:hidden">
            {loading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }, (_, index) => (
                  <div key={`audit-mobile-skeleton-${index}`} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <Skeleton className="h-3 w-32" />
                    <Skeleton className="mt-3 h-7 w-28 rounded-full" />
                    <SkeletonText lines={['h-4 w-full', 'h-4 w-5/6']} className="mt-3" />
                    <Skeleton className="mt-3 h-3 w-24" />
                  </div>
                ))}
              </div>
            ) : logs.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
                No audit activity found.
              </div>
            ) : (
              <div className="space-y-3">
                {paginatedLogs.map((log, index) => (
                  <article key={log.id || `${log.timestamp}-${index}`} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="text-xs font-bold uppercase tracking-widest text-slate-400">
                        {formatPhilippineDateTime(log.timestamp)}
                      </div>
                      <ComputerDesktopIcon className="h-4 w-4 shrink-0 text-slate-300" />
                    </div>
                    <div className={`mt-3 inline-flex rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-widest ring-1 ${getActionTone(log.action)}`}>
                      {formatActionLabel(log.action)}
                    </div>
                    <div className="mt-3 text-sm leading-6 text-slate-800">{log.details || 'N/A'}</div>
                    <div className="mt-3 text-xs text-slate-400">
                      <span className="font-bold uppercase tracking-widest">Real IP</span>{' '}
                      <span className="font-mono">{log.ip_address || 'N/A'}</span>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>

          {!loading && logs.length > 0 && (
            <div className="flex shrink-0 flex-col gap-3 border-t border-slate-200 bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm font-semibold text-slate-600">
                Showing {formatCount(pageStartCount)}-{formatCount(pageEndCount)} of {formatCount(logs.length)} activities
              </div>

              <PageControls
                safeCurrentPage={safeCurrentPage}
                totalPages={totalPages}
                pageNumbers={pageNumbers}
                setCurrentPage={setCurrentPage}
              />
            </div>
          )}
        </section>

        <section className="data-card flex min-h-0 flex-col xl:max-h-full">
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 bg-white px-5 py-4">
            <div>
              <h2 className="text-[22px] font-extrabold tracking-tight text-slate-900">Authenticator Recovery</h2>
              <p className="mt-1 text-sm text-slate-500">
                Reset MFA and review backup-code coverage.
              </p>
            </div>
            <button
              type="button"
              onClick={() => loadUsers({ showLoading: true })}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Refresh users"
              disabled={usersLoading}
            >
              <ArrowPathIcon className={`h-4 w-4 ${usersLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          <div className="custom-scrollbar min-h-0 flex-1 overflow-auto">
            {usersLoading ? (
              <div className="divide-y divide-slate-100">
                {Array.from({ length: 5 }, (_, index) => (
                  <div key={`user-recovery-skeleton-${index}`} className="p-4">
                    <div className="flex items-center gap-3">
                      <Skeleton className="h-10 w-10 rounded-full" />
                      <SkeletonText lines={['h-4 w-32', 'h-3 w-24']} className="flex-1" />
                    </div>
                    <Skeleton className="mt-4 h-10 rounded-xl" />
                  </div>
                ))}
              </div>
            ) : users.length === 0 ? (
              <div className="px-5 py-12 text-center text-sm text-slate-500">
                No users found.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {users.map((user) => {
                  const hasAuthenticator = Boolean(user.authenticator_mfa_enabled);
                  const recoveryCodes = Number(user.recovery_codes_remaining || 0);
                  const isResetting = resettingUserId === user.id;

                  return (
                    <div key={user.id} className="p-4">
                      <div className="flex items-start gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-black text-white">
                          {getInitials(user)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-black text-slate-900">
                            {user.full_name || user.username}
                          </div>
                          <div className="mt-1 truncate font-mono text-xs font-bold text-slate-400">
                            @{user.username}
                          </div>
                        </div>
                        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-widest ${
                          hasAuthenticator
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-amber-50 text-amber-700'
                        }`}>
                          {hasAuthenticator ? 'MFA on' : 'Setup'}
                        </span>
                      </div>

                      <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                        <div className="rounded-xl bg-slate-50 px-3 py-2">
                          <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                            Recovery
                          </div>
                          <div className={`mt-1 font-black ${recoveryCodes <= 1 ? 'text-amber-700' : 'text-slate-900'}`}>
                            {formatCount(recoveryCodes)} codes
                          </div>
                        </div>
                        <div className="rounded-xl bg-slate-50 px-3 py-2">
                          <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                            Remembered
                          </div>
                          <div className="mt-1 font-black text-slate-900">
                            {formatCount(user.remembered_devices_active)} devices
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => resetAuthenticator(user)}
                        disabled={!hasAuthenticator || isResetting}
                        className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-red-100 bg-red-50 px-3 py-2.5 text-sm font-black text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <ShieldCheckIcon className="h-4 w-4" />
                        {isResetting ? 'Resetting...' : 'Reset Authenticator'}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
