import { useState, useEffect } from 'react';
import { API } from '../services/api';
import { Skeleton, SkeletonText } from '../components/Skeleton';
import { ShieldCheckIcon } from '@heroicons/react/24/outline';

const PH_TIMEZONE = 'Asia/Manila';

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

  const normalizedValue = /(?:[zZ]|[+\-]\d{2}:\d{2})$/.test(rawValue)
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
  const [philippineNow, setPhilippineNow] = useState(() => formatPhilippineDateTime(new Date()));

  useEffect(() => {
    async function loadLogs() {
      try {
        const data = await API.getAuditLogs();
        setLogs(data);
      } catch (err) {
        console.error("Audit Log error:", err);
      } finally {
        setLoading(false);
      }
    }
    loadLogs();
  }, []);

  useEffect(() => {
    const timerId = window.setInterval(() => {
      setPhilippineNow(formatPhilippineDateTime(new Date()));
    }, 1000);

    return () => {
      window.clearInterval(timerId);
    };
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col gap-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <ShieldCheckIcon className="w-6 h-6 text-slate-700" /> Audit Log
        </h1>
        <div className="rounded-xl border border-sky-100 bg-sky-50 px-4 py-3 text-sm text-sky-800">
          <div className="font-bold">Philippine Time Now</div>
          <div className="mt-1">{philippineNow}</div>
        </div>
      </div>

      <div>
        <p className="text-sm text-slate-500">System actions securely tracked for accountability. All timestamps below use Philippine time (UTC+8).</p>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="custom-scrollbar hidden min-h-0 flex-1 overflow-auto md:block">
          <table className="min-w-full text-left text-sm text-slate-600">
            <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 text-xs font-bold uppercase text-slate-500">
              <tr>
                <th className="px-6 py-4">Timestamp</th>
                <th className="px-6 py-4">Action</th>
                <th className="px-6 py-4">Details</th>
                <th className="px-6 py-4">IP Address</th>
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
              ) : logs.map((l, idx) => (
                <tr key={idx} className="hover:bg-slate-50 transition-colors">
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
              {logs.map((l, idx) => (
                <div key={idx} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="text-xs font-bold uppercase tracking-widest text-slate-400">
                    {formatPhilippineDateTime(l.timestamp)}
                  </div>
                  <div className="mt-3 inline-flex rounded-lg bg-fuchsia-50 px-3 py-1 text-xs font-bold text-fuchsia-700">
                    {l.action}
                  </div>
                  <div className="mt-3 text-sm text-slate-800">{l.details || 'N/A'}</div>
                  <div className="mt-3 text-xs text-slate-400">
                    <span className="font-bold uppercase tracking-widest text-slate-400">IP</span>{' '}
                    <span className="font-mono">{l.ip_address || 'N/A'}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
