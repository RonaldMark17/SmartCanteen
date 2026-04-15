import { useEffect, useState } from 'react';
import { API } from '../services/api';
import { Skeleton, SkeletonText } from '../components/Skeleton';
import {
  ArrowPathIcon,
  ArrowTrendingUpIcon,
  ClockIcon,
  TrophyIcon,
} from '@heroicons/react/24/outline';
import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Title,
  Tooltip,
} from 'chart.js';
import { Bar, Line } from 'react-chartjs-2';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

const EMPTY_HEATMAP = Array.from({ length: 24 }, (_, hour) => ({
  hour,
  sales: 0,
}));

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isSchoolDay(dateValue) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) {
    return true;
  }

  const day = date.getDay();
  return day >= 1 && day <= 5;
}

function normalizeDailySales(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => ({
      date: item?.date ?? '',
      revenue: toNumber(item?.revenue),
      transactions: toNumber(item?.transactions),
    }))
    .filter((item) => !item.date || isSchoolDay(item.date));
}

function normalizeTopProducts(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item, index) => ({
    product_name: item?.product_name || `Product ${index + 1}`,
    total_qty: toNumber(item?.total_qty),
  }));
}

function normalizeHeatmap(value) {
  if (!Array.isArray(value)) {
    return EMPTY_HEATMAP;
  }

  const byHour = new Map(
    value.map((item) => [
      toNumber(item?.hour),
      {
        hour: toNumber(item?.hour),
        sales: toNumber(item?.sales),
      },
    ])
  );

  return EMPTY_HEATMAP.map((item) => byHour.get(item.hour) || item);
}

function getErrorMessage(result, fallback) {
  if (!result || result.status !== 'rejected') {
    return null;
  }

  const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
  return message || fallback;
}

function EmptyPanel({ message }) {
  return (
    <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 text-center text-sm text-slate-500">
      {message}
    </div>
  );
}

function AnalyticsSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="mb-2 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <SkeletonText lines={['h-8 w-40', 'h-4 w-80']} />
        <Skeleton className="h-10 w-28 rounded-lg" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {Array.from({ length: 2 }, (_, index) => (
          <div
            key={index}
            className="flex h-[350px] flex-col rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
          >
            <Skeleton className="mb-4 h-5 w-48" />
            <Skeleton className="min-h-0 flex-1 rounded-2xl" />
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 pb-8 shadow-sm">
        <Skeleton className="mb-6 h-5 w-60" />
        <div className="grid grid-cols-4 gap-2 pb-2 md:grid-cols-8 lg:grid-cols-12">
          {Array.from({ length: 24 }, (_, index) => (
            <Skeleton key={index} className="h-16 rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Analytics() {
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [error, setError] = useState('');
  const [data, setData] = useState({
    daily: [],
    top: [],
    heatmap: EMPTY_HEATMAP,
  });

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      setLoading(true);
      setError('');

      const [dailyResult, topResult, heatmapResult] = await Promise.allSettled([
        API.getDailySales(14),
        API.getTopProducts(14),
        API.getHourlyHeatmap(),
      ]);

      if (cancelled) {
        return;
      }

      const nextData = {
        daily:
          dailyResult.status === 'fulfilled'
            ? normalizeDailySales(dailyResult.value)
            : [],
        top:
          topResult.status === 'fulfilled'
            ? normalizeTopProducts(topResult.value)
            : [],
        heatmap:
          heatmapResult.status === 'fulfilled'
            ? normalizeHeatmap(heatmapResult.value)
            : EMPTY_HEATMAP,
      };

      setData(nextData);

      const failures = [
        getErrorMessage(dailyResult, 'Failed to load revenue trend.'),
        getErrorMessage(topResult, 'Failed to load top products.'),
        getErrorMessage(heatmapResult, 'Failed to load hourly heatmap.'),
      ].filter(Boolean);

      if (failures.length > 0) {
        const allFailed = failures.length === 3;
        setError(
          allFailed
            ? failures[0]
            : `Some analytics data could not be loaded: ${failures.join(' | ')}`
        );
      }

      setLoading(false);
    }

    loadData();

    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const hasDailyData = data.daily.length > 0;
  const hasTopData = data.top.length > 0;
  const hasHeatmapData = data.heatmap.some((item) => item.sales > 0);

  const lineChartData = {
    labels: data.daily.map((item) =>
      item.date
        ? new Date(item.date).toLocaleDateString('en-PH', {
            month: 'short',
            day: 'numeric',
          })
        : ''
    ),
    datasets: [
      {
        label: 'Revenue (PHP)',
        data: data.daily.map((item) => item.revenue),
        borderColor: '#d946ef',
        backgroundColor: 'rgba(217, 70, 239, 0.1)',
        fill: true,
        tension: 0.4,
        pointRadius: 4,
      },
    ],
  };

  const barChartData = {
    labels: data.top.map((item) => item.product_name),
    datasets: [
      {
        label: 'Units Sold',
        data: data.top.map((item) => item.total_qty),
        backgroundColor: [
          '#d946ef',
          '#6366f1',
          '#22c55e',
          '#f59e0b',
          '#ef4444',
          '#06b6d4',
          '#84cc16',
          '#f97316',
          '#a855f7',
          '#14b8a6',
        ],
        borderRadius: 4,
      },
    ],
  };

  const maxHeatmapSales = Math.max(1, ...data.heatmap.map((item) => item.sales));

  if (loading) {
    return <AnalyticsSkeleton />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="mb-2 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Analytics</h1>
          <p className="text-sm text-slate-500">School-day sales performance and trends for the elementary canteen</p>
        </div>

        <button
          type="button"
          onClick={() => setReloadKey((value) => value + 1)}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
        >
          <ArrowPathIcon className="h-4 w-4" />
          Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {error}
        </div>
      )}

      

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="flex h-[350px] flex-col rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="mb-4 flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-slate-800">
            <ArrowTrendingUpIcon className="h-5 w-5 text-slate-400" /> School-Day Revenue Trend
          </h3>
          <div className="min-h-0 flex-1">
            {hasDailyData ? (
              <Line
                data={lineChartData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: { legend: { display: false } },
                }}
              />
            ) : (
              <EmptyPanel message="No school-day sales data available yet." />
            )}
          </div>
        </div>

        <div className="flex h-[350px] flex-col rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="mb-4 flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-slate-800">
            <TrophyIcon className="h-5 w-5 text-amber-500" /> Top-Selling Products
          </h3>
          <div className="min-h-0 flex-1">
            {hasTopData ? (
              <Bar
                data={barChartData}
                options={{
                  indexAxis: 'y',
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: { legend: { display: false } },
                }}
              />
            ) : (
              <EmptyPanel message="No product sales data available yet." />
            )}
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="mb-6 flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-slate-800">
          <ClockIcon className="h-5 w-5 text-slate-400" /> School-Day Sales Heatmap by Hour
        </h3>

        {hasHeatmapData ? null : (
          <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500">
            No hourly sales activity found yet. The grid is showing empty hours.
          </div>
        )}

        <div className="grid grid-cols-4 gap-2 md:grid-cols-8 lg:grid-cols-12">
          {data.heatmap.map((item) => {
            const intensity = Math.round((item.sales / maxHeatmapSales) * 9);
            const label =
              item.hour === 0
                ? '12am'
                : item.hour < 12
                  ? `${item.hour}am`
                  : item.hour === 12
                    ? '12pm'
                    : `${item.hour - 12}pm`;

            const intensityClasses = [
              'border border-slate-200 bg-slate-50 text-slate-500',
              'bg-fuchsia-50 text-fuchsia-800',
              'bg-fuchsia-100 text-fuchsia-900',
              'bg-fuchsia-200 text-fuchsia-900',
              'bg-fuchsia-300 text-fuchsia-900',
              'bg-fuchsia-500 text-white',
              'bg-fuchsia-600 text-white',
              'bg-fuchsia-700 text-white',
              'bg-fuchsia-800 text-white',
              'bg-fuchsia-900 text-white',
            ];

            return (
              <div
                key={item.hour}
                className={`cursor-default rounded-lg p-2 text-center transition-transform hover:scale-105 ${intensityClasses[intensity]}`}
                title={`${label}: PHP ${item.sales}`}
              >
                <div className="mb-1 text-xs font-bold">{label}</div>
                <div className="text-[10px] font-medium opacity-90">PHP {item.sales}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
