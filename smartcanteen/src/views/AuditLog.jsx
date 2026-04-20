import { useCallback, useState, useEffect } from 'react';
import { API } from '../services/api';
import { Skeleton, SkeletonText } from '../components/Skeleton';
import {
  ArrowPathIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  ShieldCheckIcon,
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
      console.error("Audit Log error:", err);
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
      console.error("User recovery error:", err);
      setUsersError(err.message || 'User recovery status could not be loaded.');
    } finally {
      if (showLoading) {
        setUsersLoading(false);
      }
    }
  }, []);

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

  return (
    <div className="view-shell-static h-auto min-h-full pb-6 md:h-full md:min-h-0 md:pb-0">
      <section className="panel-card shrink-0">
        <div className="view-header md:flex-row md:items-center">
          <div>
            <div className="view-eyebrow">
              <ShieldCheckIcon className="h-4 w-4" />
              Security Trail
            </div>
            <h1 className="view-title mt-3">Audit Log</h1>
            <p className="view-subtitle max-w-3xl">
              System actions securely tracked for accountability. All timestamps use Philippine time (UTC+8).
            </p>
          </div>

          <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={() => loadLogs({ showLoading: true })}
              className="action-button"
            >
              <ArrowPathIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>

            <div className="rounded-[20px] bg-sky-50 px-4 py-3 text-sm text-sky-800 shadow-sm ring-1 ring-sky-100">
              <div className="flex items-center gap-2 font-black">
                <ClockIcon className="h-4 w-4" />
                Philippine Time Now
              </div>
              <div className="mt-1 font-semibold">{philippineNow}</div>
              {lastUpdated && (
                <div className="mt-1 text-xs font-bold text-sky-700">
                  Last updated: {formatPhilippineDateTime(lastUpdated)}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {error && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          {error}
        </div>
      )}

      <section className="data-card shrink-0">
        <div className="flex flex-col gap-3 border-b border-slate-100 bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-[22px] font-extrabold tracking-tight text-slate-900">Authenticator Recovery</h2>
            <p className="mt-1 text-sm text-slate-500">
              Reset a lost authenticator app and check backup-code coverage per user.
            </p>
          </div>
          <button
            type="button"
            onClick={() => loadUsers({ showLoading: true })}
            className="action-button self-start sm:self-center"
          >
            <ArrowPathIcon className={`h-4 w-4 ${usersLoading ? 'animate-spin' : ''}`} />
            Refresh Users
          </button>
        </div>

        {usersError && (
          <div className="mx-5 mt-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
            {usersError}
          </div>
        )}

        <div className="grid gap-3 p-5 md:grid-cols-2 xl:grid-cols-3">
          {usersLoading ? (
            Array.from({ length: 3 }, (_, index) => (
              <div key={`user-recovery-skeleton-${index}`} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="mt-3 h-6 w-24 rounded-lg" />
                <SkeletonText lines={['h-4 w-full', 'h-4 w-4/5']} className="mt-3" />
              </div>
            ))
          ) : users.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500 md:col-span-2 xl:col-span-3">
              No users found.
            </div>
          ) : (
            users.map((user) => {
              const hasAuthenticator = Boolean(user.authenticator_mfa_enabled);
              return (
                <div key={user.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-base font-black text-slate-900">
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
                      {hasAuthenticator ? 'MFA on' : 'Setup needed'}
                    </span>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                    <div className="rounded-xl bg-slate-50 px-3 py-2">
                      <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                        Recovery
                      </div>
                      <div className="mt-1 font-black text-slate-900">
                        {formatCount(user.recovery_codes_remaining)} codes
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
                    disabled={!hasAuthenticator || resettingUserId === user.id}
                    className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-red-100 bg-red-50 px-3 py-2.5 text-sm font-black text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <ShieldCheckIcon className="h-4 w-4" />
                    {resettingUserId === user.id ? 'Resetting...' : 'Reset Authenticator'}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </section>

      <div className="data-card flex shrink-0 flex-col md:min-h-0 md:flex-1 md:shrink">
        <div className="flex shrink-0 flex-col gap-2 border-b border-slate-100 bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-[22px] font-extrabold tracking-tight text-slate-900">Activity Feed</h2>
            <p className="mt-1 text-sm text-slate-500">
              Login attempts, inventory reviews, seed activity, and cashier shift events.
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
                Array.from({ length: 6 }, (_, index) => (
                  <tr key={`audit-skeleton-${index}`}>
                    <td className="px-6 py-4"><Skeleton className="h-4 w-36" /></td>
                    <td className="px-6 py-4"><Skeleton className="h-6 w-24 rounded-md" /></td>
                    <td className="px-6 py-4"><SkeletonText lines={['h-4 w-full', 'h-4 w-4/5']} /></td>
                    <td className="px-6 py-4"><Skeleton className="h-4 w-24" /></td>
                  </tr>
                ))
              ) : logs.length === 0 ? (
                <tr><td colSpan="4" className="text-center py-10">No logs found.</td></tr>
              ) : paginatedLogs.map((l, idx) => (
                <tr key={l.id || `${l.timestamp}-${idx}`} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-4 whitespace-nowrap">{formatPhilippineDateTime(l.timestamp)}</td>
                  <td className="px-6 py-4">
                    <span className="font-mono text-xs font-bold bg-fuchsia-50 text-fuchsia-700 px-2 py-1 rounded">
                      {l.action}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-slate-800">{l.details || "N/A"}</td>
                  <td className="px-6 py-4 font-mono text-xs text-slate-400">{l.ip_address || "N/A"}</td>
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
                  <Skeleton className="mt-3 h-6 w-24 rounded-lg" />
                  <SkeletonText lines={['h-4 w-full', 'h-4 w-5/6']} className="mt-3" />
                  <Skeleton className="mt-3 h-3 w-20" />
                </div>
              ))}
            </div>
          ) : logs.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
              No logs found.
            </div>
          ) : (
            <div className="space-y-3">
              {paginatedLogs.map((l, idx) => (
                <div key={l.id || `${l.timestamp}-${idx}`} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="text-xs font-bold uppercase tracking-widest text-slate-400">
                    {formatPhilippineDateTime(l.timestamp)}
                  </div>
                  <div className="mt-3 inline-flex rounded-lg bg-fuchsia-50 px-3 py-1 text-xs font-bold text-fuchsia-700">
                    {l.action}
                  </div>
                  <div className="mt-3 text-sm text-slate-800">{l.details || 'N/A'}</div>
                  <div className="mt-3 text-xs text-slate-400">
                    <span className="font-bold uppercase tracking-widest text-slate-400">Real IP</span>{' '}
                    <span className="font-mono">{l.ip_address || 'N/A'}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {!loading && logs.length > 0 && (
          <div className="flex shrink-0 flex-col gap-3 border-t border-slate-200 bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm font-semibold text-slate-600">
              Showing {formatCount(pageStartCount)}-{formatCount(pageEndCount)} of {formatCount(logs.length)} activities
            </div>

            {totalPages > 1 && (
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
            )}
          </div>
        )}
      </div>
    </div>
  );
}
