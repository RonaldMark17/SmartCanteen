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

function getAuditSearchText(log) {
  return [
    log?.timestamp,
    log?.action,
    log?.details,
    log?.ip_address,
  ].filter(Boolean).join(' ').toLowerCase();
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);
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
    <div className="view-shell h-auto min-h-full pb-6">
      <div className="view-header md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="view-eyebrow">
            <ShieldCheckIcon className="h-4 w-4" />
            Security Trail
          </div>
          <h1 className="view-title mt-3">Audit Log</h1>
          <p className="view-subtitle max-w-3xl">
            System actions and access events in Philippine time.
          </p>
        </div>

        <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-start md:ml-auto md:justify-end">
          <button
            type="button"
            onClick={refreshAll}
            className="action-button shrink-0"
          >
            <ArrowPathIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>

          <div className="w-full rounded-lg border border-sky-100 bg-sky-50 px-4 py-3 text-sm text-sky-800 shadow-sm sm:w-auto sm:min-w-[240px]">
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

      {error && (
        <div className="space-y-3">
          <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
            {error}
          </div>
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

      <section className="data-card flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 flex-col gap-4 border-b border-slate-100 bg-white px-5 py-4">
            <div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-[22px] font-extrabold tracking-tight text-slate-900">Activity Feed</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Login attempts, inventory changes, seeding, and cashier activity.
                  </p>
                </div>
                <span className="self-start rounded-full bg-slate-100 px-3 py-1.5 text-xs font-black text-slate-600 sm:self-center">
                  {filtersActive
                    ? `${formatCount(filteredLogs.length)}/${formatCount(logs.length)} activities`
                    : `${formatCount(logs.length)} activities`}
                </span>
              </div>
            </div>

            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_15rem]">
              <label className="relative block">
                <span className="sr-only">Search audit activity</span>
                <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search action, details, timestamp, or IP"
                  className="field-control w-full pl-10"
                />
              </label>

              <label className="relative block">
                <span className="sr-only">Filter audit action</span>
                <FunnelIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                <select
                  value={actionFilter}
                  onChange={(event) => setActionFilter(event.target.value)}
                  className="field-control w-full appearance-none pl-10"
                >
                  {actionOptions.map((action) => (
                    <option key={action} value={action}>
                      {action === 'All' ? 'All actions' : formatActionLabel(action)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
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
                ) : filteredLogs.length === 0 ? (
                  <tr>
                    <td colSpan="4" className="text-center py-12 text-slate-500">
                      {logs.length === 0 ? 'No audit activity found.' : 'No activity matches these filters.'}
                    </td>
                  </tr>
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
            ) : filteredLogs.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
                {logs.length === 0 ? 'No audit activity found.' : 'No activity matches these filters.'}
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

          {!loading && filteredLogs.length > 0 && (
            <div className="flex shrink-0 flex-col gap-3 border-t border-slate-200 bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm font-semibold text-slate-600">
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
      </section>
    </div>
  );
}
