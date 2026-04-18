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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
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

  const totalPages = Math.max(1, Math.ceil(logs.length / AUDIT_LOGS_PER_PAGE));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const pageStartIndex = logs.length === 0 ? 0 : (safeCurrentPage - 1) * AUDIT_LOGS_PER_PAGE;
  const paginatedLogs = logs.slice(pageStartIndex, pageStartIndex + AUDIT_LOGS_PER_PAGE);
  const pageStartCount = logs.length === 0 ? 0 : pageStartIndex + 1;
  const pageEndCount = Math.min(pageStartIndex + paginatedLogs.length, logs.length);
  const pageNumbers = getPageNumbers(safeCurrentPage, totalPages);

  return (
    <div className="view-shell-static">
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

      <div className="data-card flex min-h-0 flex-1 flex-col">
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

        <div className="flex-1 overflow-y-auto p-4 md:hidden">
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
