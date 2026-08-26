import { useCallback, useState, useEffect } from 'react';
import { API } from '../services/api';
import { Skeleton, SkeletonText } from '../components/Skeleton';
import {
  ArrowPathIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  ComputerDesktopIcon,
  FunnelIcon,
  MagnifyingGlassIcon,
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

function formatActionLabel(action) {
  return String(action || 'UNKNOWN')
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getActionTone(action) {
  const value = String(action || '').toLowerCase();

  if (value.includes('login') || value.includes('auth')) {
    return 'border-sky-200/80 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950/60 dark:text-sky-300';
  }
  if (value.includes('delete') || value.includes('reset') || value.includes('failed')) {
    return 'border-rose-200/80 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/60 dark:text-rose-300';
  }
  if (value.includes('product') || value.includes('inventory')) {
    return 'border-indigo-200/80 bg-indigo-50 text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300';
  }
  if (value.includes('transaction') || value.includes('sale')) {
    return 'border-emerald-200/80 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300';
  }
  if (value.includes('seed')) {
    return 'border-amber-200/80 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300';
  }

  return 'border-slate-200/80 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300';
}

function getUserTypeTone(userType) {
  const value = String(userType || '').toLowerCase();

  if (value.includes('admin')) {
    return 'border-purple-200/80 bg-purple-50 text-purple-700 dark:border-purple-800 dark:bg-purple-950/60 dark:text-purple-300';
  }
  if (value.includes('cashier')) {
    return 'border-emerald-200/80 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300';
  }
  if (value.includes('staff')) {
    return 'border-sky-200/80 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950/60 dark:text-sky-300';
  }
  if (value.includes('system')) {
    return 'border-slate-200/80 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400';
  }

  return 'border-amber-200/80 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300';
}

function getAuditSearchText(log) {
  return [
    log?.timestamp,
    log?.user_type,
    log?.action,
    log?.details,
    log?.ip_address,
  ].filter(Boolean).join(' ').toLowerCase();
}

function MetricCard({ title, value, detail, icon: Icon, tone = 'slate' }) {
  const iconToneStyle = {
    emerald: 'border-emerald-100 bg-emerald-50 text-emerald-600 dark:border-emerald-900/60 dark:bg-emerald-950/60 dark:text-emerald-400',
    sky: 'border-sky-100 bg-sky-50 text-sky-600 dark:border-sky-900/60 dark:bg-sky-950/60 dark:text-sky-400',
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
    <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
      <button
        type="button"
        onClick={() => setCurrentPage(Math.max(1, safeCurrentPage - 1))}
        disabled={safeCurrentPage === 1}
        aria-label="Previous audit log page"
        className="inline-flex h-9 items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-bold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
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
          className={`inline-flex h-9 min-w-9 items-center justify-center rounded-xl px-2 text-xs font-bold transition ${
            pageNumber === safeCurrentPage
              ? 'bg-emerald-600 text-white font-black'
              : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
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
        className="inline-flex h-9 items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-bold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
      >
        <span className="hidden sm:inline">Next</span>
        <ChevronRightIcon className="h-4 w-4" />
      </button>
    </div>
  );
}

export default function AuditLog() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [actionFilter, setActionFilter] = useState('All');
  const [philippineNow, setPhilippineNow] = useState(() => formatPhilippineDateTime(new Date()));

  const loadLogs = useCallback(async ({ showLoading = false } = {}) => {
    if (showLoading) {
      setLoading(true);
    }

    setError('');
    try {
      const data = await API.getAuditLogs();
      setLogs(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Audit Log error:', err);
      setError(err.message || 'Audit activity could not be loaded.');
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  }, []);

  const refreshAll = () => {
    loadLogs({ showLoading: true });
  };

  useEffect(() => {
    loadLogs({ showLoading: true });

    const refreshId = window.setInterval(() => {
      loadLogs();
    }, AUDIT_REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(refreshId);
    };
  }, [loadLogs]);

  useEffect(() => {
    const timerId = window.setInterval(() => {
      setPhilippineNow(formatPhilippineDateTime(new Date()));
    }, 1000);

    return () => {
      window.clearInterval(timerId);
    };
  }, []);

  const actionOptions = [
    'All',
    ...new Set(
      logs
        .map((log) => String(log.action || '').trim())
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right))
    ),
  ];
  const normalizedSearch = searchQuery.trim().toLowerCase();
  const filteredLogs = logs.filter((log) => {
    const matchesSearch = !normalizedSearch || getAuditSearchText(log).includes(normalizedSearch);
    const matchesAction = actionFilter === 'All' || log.action === actionFilter;

    return matchesSearch && matchesAction;
  });
  const filtersActive = normalizedSearch !== '' || actionFilter !== 'All';
  const totalPages = Math.max(1, Math.ceil(filteredLogs.length / AUDIT_LOGS_PER_PAGE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const pageStartIndex = filteredLogs.length === 0 ? 0 : (safeCurrentPage - 1) * AUDIT_LOGS_PER_PAGE;
  const paginatedLogs = filteredLogs.slice(pageStartIndex, pageStartIndex + AUDIT_LOGS_PER_PAGE);
  const pageStartCount = filteredLogs.length === 0 ? 0 : pageStartIndex + 1;
  const pageEndCount = Math.min(pageStartIndex + paginatedLogs.length, filteredLogs.length);
  const pageNumbers = getPageNumbers(safeCurrentPage, totalPages);
  const actionTypeCount = Math.max(0, actionOptions.length - 1);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  useEffect(() => {
    setCurrentPage(1);
  }, [actionFilter, searchQuery]);

  return (
    <div className="view-shell overflow-x-hidden pr-0 space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-lg border border-emerald-200/60 bg-emerald-50 px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-950/60 dark:text-emerald-300">
            <ShieldCheckIcon className="h-4 w-4" />
            Security Trail
          </div>
          <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-900 dark:text-white sm:text-3xl">
            Audit Log
          </h1>
          <p className="mt-1 text-sm font-medium text-slate-500 dark:text-slate-400 max-w-3xl">
            System actions and access events in Philippine time.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={refreshAll}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-bold text-slate-700 shadow-2xs transition hover:bg-slate-50 active:scale-95 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            <ArrowPathIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>

          <div className="rounded-xl border border-slate-200/90 bg-white px-3.5 py-2 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              <ClockIcon className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              Philippine Time
            </div>
            <div className="font-mono text-xs font-bold text-slate-900 dark:text-white">{philippineNow}</div>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-bold text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/60 dark:text-rose-300">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <MetricCard
          title="Activities"
          value={formatCount(logs.length)}
          detail={loading ? 'Refreshing feed...' : 'Recorded events'}
          icon={ShieldCheckIcon}
          tone="sky"
        />
        <MetricCard
          title="Shown"
          value={formatCount(filteredLogs.length)}
          detail={filtersActive ? 'Matching filters' : 'Visible activities'}
          icon={FunnelIcon}
          tone="slate"
        />
        <MetricCard
          title="Action Types"
          value={formatCount(actionTypeCount)}
          detail="Unique recorded actions"
          icon={ComputerDesktopIcon}
          tone="emerald"
        />
      </div>

      <section className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-slate-900 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-black text-slate-900 dark:text-white">Activity Feed</h2>
            <p className="mt-0.5 text-xs font-medium text-slate-500 dark:text-slate-400">
              Login attempts, inventory changes, seeding, and cashier activity.
            </p>
          </div>
          <span className="self-start rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300 sm:self-center">
            {filtersActive
              ? `${formatCount(filteredLogs.length)} of ${formatCount(logs.length)} activities`
              : `${formatCount(logs.length)} activities`}
          </span>
        </div>

        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_16rem]">
          <div className="relative">
            <MagnifyingGlassIcon className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search action, details, timestamp, or IP..."
              className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50/50 pl-10 pr-4 text-sm font-semibold text-slate-900 shadow-2xs outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </div>

          <div className="relative">
            <FunnelIcon className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
            <select
              value={actionFilter}
              onChange={(event) => setActionFilter(event.target.value)}
              className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50/50 pl-10 pr-4 text-sm font-bold text-slate-700 shadow-2xs outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            >
              {actionOptions.map((action) => (
                <option key={action} value={action}>
                  {action === 'All' ? 'All actions' : formatActionLabel(action)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-2xs dark:border-slate-800 dark:bg-slate-900">
          <div className="overflow-x-auto custom-scrollbar">
            <table className="min-w-[750px] w-full text-left text-sm text-slate-600 dark:text-slate-300">
              <thead className="border-b border-slate-200/80 bg-slate-50/80 text-xs font-bold uppercase tracking-wider text-slate-500 dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-400">
                <tr>
                  <th className="px-5 py-3.5">Timestamp</th>
                  <th className="px-4 py-3.5">User Type</th>
                  <th className="px-4 py-3.5">Action</th>
                  <th className="px-5 py-3.5">Details</th>
                  <th className="px-4 py-3.5">IP Address</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white dark:divide-slate-800 dark:bg-slate-900">
                {loading ? (
                  Array.from({ length: 7 }, (_, index) => (
                    <tr key={`audit-skeleton-${index}`}>
                      <td className="px-5 py-4"><Skeleton className="h-4 w-36" /></td>
                      <td className="px-4 py-4"><Skeleton className="h-7 w-20 rounded-lg" /></td>
                      <td className="px-4 py-4"><Skeleton className="h-7 w-28 rounded-lg" /></td>
                      <td className="px-5 py-4"><SkeletonText lines={['h-4 w-full', 'h-4 w-4/5']} /></td>
                      <td className="px-4 py-4"><Skeleton className="h-4 w-24" /></td>
                    </tr>
                  ))
                ) : filteredLogs.length === 0 ? (
                  <tr>
                    <td colSpan="5" className="px-6 py-12 text-center text-sm font-semibold text-slate-500 dark:text-slate-400">
                      {logs.length === 0 ? 'No audit activity found.' : 'No activity matches these filters.'}
                    </td>
                  </tr>
                ) : (
                  paginatedLogs.map((log, index) => (
                    <tr key={log.id || `${log.timestamp}-${index}`} className="transition hover:bg-slate-50/70 dark:hover:bg-slate-800/50">
                      <td className="whitespace-nowrap px-5 py-4 font-mono text-xs font-semibold text-slate-700 dark:text-slate-300">
                        {formatPhilippineDateTime(log.timestamp)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4">
                        <span className={`inline-flex rounded-lg px-2.5 py-1 text-xs font-bold uppercase tracking-wider border ${getUserTypeTone(log.user_type)}`}>
                          {log.user_type || 'System'}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-4">
                        <span className={`inline-flex rounded-lg px-2.5 py-1 text-xs font-bold uppercase tracking-wider border ${getActionTone(log.action)}`}>
                          {formatActionLabel(log.action)}
                        </span>
                      </td>
                      <td className="max-w-[32rem] px-5 py-4 text-xs font-medium leading-5 text-slate-800 dark:text-slate-200">
                        {log.details || 'N/A'}
                      </td>
                      <td className="whitespace-nowrap px-4 py-4 font-mono text-xs text-slate-400 dark:text-slate-500">
                        {log.ip_address || 'N/A'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {!loading && filteredLogs.length > 0 && (
            <div className="flex flex-col gap-3 border-t border-slate-100 p-4 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                Showing {formatCount(pageStartCount)}-{formatCount(pageEndCount)} of {formatCount(filteredLogs.length)} activities
              </div>

              <PageControls
                safeCurrentPage={safeCurrentPage}
                totalPages={totalPages}
                pageNumbers={pageNumbers}
                setCurrentPage={setCurrentPage}
              />
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
