import { useEffect, useMemo, useState } from 'react';
import { API } from '../services/api';
import DismissibleAlert from '../components/DismissibleAlert';
import { Skeleton, SkeletonText } from '../components/Skeleton';
import { formatPhilippineDate, getPhilippineWeekday } from '../utils/dateTime';
import {
  ArrowPathIcon,
  ArrowTrendingUpIcon,
  BanknotesIcon,
  CalendarDaysIcon,
  ChartBarIcon,
  ClockIcon,
  FireIcon,
  ShoppingBagIcon,
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

const SCHOOL_START_HOUR = 7;
const SCHOOL_END_HOUR = 17;

const EMPTY_HEATMAP = Array.from(
  { length: SCHOOL_END_HOUR - SCHOOL_START_HOUR + 1 },
  (_, index) => ({
    hour: SCHOOL_START_HOUR + index,
    sales: 0,
  })
);

const TOP_PRODUCT_COLORS = [
  '#0f766e',
  '#0284c7',
  '#d946ef',
  '#f59e0b',
  '#ef4444',
  '#6366f1',
  '#14b8a6',
  '#84cc16',
  '#f97316',
  '#64748b',
];

const HEATMAP_INTENSITY_CLASSES = [
  'border-slate-200 bg-slate-50 text-slate-500',
  'border-cyan-100 bg-cyan-50 text-cyan-800',
  'border-cyan-200 bg-cyan-100 text-cyan-900',
  'border-sky-200 bg-sky-100 text-sky-900',
  'border-teal-200 bg-teal-100 text-teal-900',
  'border-teal-300 bg-teal-200 text-teal-950',
  'border-emerald-300 bg-emerald-300 text-emerald-950',
  'border-emerald-500 bg-emerald-500 text-white',
  'border-teal-700 bg-teal-700 text-white',
  'border-slate-900 bg-slate-900 text-white',
];

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCurrency(value) {
  const numeric = toNumber(value);
  const hasFraction = Math.abs(numeric % 1) > 0;

  return `PHP ${numeric.toLocaleString('en-PH', {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}

function formatNumber(value) {
  return toNumber(value).toLocaleString('en-PH');
}

function formatHour(hour) {
  if (hour === 0) {
    return '12 AM';
  }

  if (hour < 12) {
    return `${hour} AM`;
  }

  if (hour === 12) {
    return '12 PM';
  }

  return `${hour - 12} PM`;
}

function getHeatmapIntensity(sales, maxSales) {
  if (sales <= 0 || maxSales <= 0) {
    return 0;
  }

  return Math.max(1, Math.round((sales / maxSales) * 9));
}

function isSchoolDay(dateValue) {
  const day = getPhilippineWeekday(dateValue);
  if (day === null) {
    return true;
  }

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

function EmptyPanel({ icon = ChartBarIcon, title = 'No data yet', message }) {
  const IconComponent = icon;

  return (
    <div className="flex h-full min-h-[220px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 px-6 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-400">
        <IconComponent className="h-5 w-5" />
      </div>
      <div className="mt-4 text-sm font-black text-slate-800">{title}</div>
      <div className="mt-1 max-w-sm text-sm leading-6 text-slate-500">{message}</div>
    </div>
  );
}

function Panel({ icon, title, meta, children, className = '' }) {
  const IconComponent = icon;

  return (
    <section
      className={`flex min-h-[390px] flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6 ${className}`}
    >
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
            <IconComponent className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-black uppercase tracking-[0.18em] text-slate-800">
              {title}
            </h3>
            {meta && <div className="mt-1 text-sm text-slate-500">{meta}</div>}
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  );
}

function MetricCard({ title, value, detail, icon, tone = 'slate' }) {
  const IconComponent = icon;
  const toneClasses = {
    emerald: {
      icon: 'bg-emerald-50 text-emerald-600 ring-emerald-100',
      bar: 'bg-emerald-500',
    },
    sky: {
      icon: 'bg-sky-50 text-sky-600 ring-sky-100',
      bar: 'bg-sky-500',
    },
    amber: {
      icon: 'bg-amber-50 text-amber-600 ring-amber-100',
      bar: 'bg-amber-500',
    },
    rose: {
      icon: 'bg-rose-50 text-rose-600 ring-rose-100',
      bar: 'bg-rose-500',
    },
    slate: {
      icon: 'bg-slate-100 text-slate-600 ring-slate-200',
      bar: 'bg-slate-500',
    },
  };
  const palette = toneClasses[tone] || toneClasses.slate;

  return (
    <article className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className={`absolute inset-x-0 top-0 h-1 ${palette.bar}`} />
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">
            {title}
          </div>
          <div className="mt-3 truncate text-2xl font-black tracking-tight text-slate-950">
            {value}
          </div>
          <div className="mt-1 min-h-5 truncate text-sm font-medium text-slate-500">
            {detail}
          </div>
        </div>
        <div className={`rounded-xl p-2.5 ring-1 ${palette.icon}`}>
          <IconComponent className="h-5 w-5" />
        </div>
      </div>
    </article>
  );
}

function AnalyticsSkeleton() {
  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto pb-8 pr-2 custom-scrollbar">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <SkeletonText lines={['h-8 w-44', 'h-4 w-72']} />
        <div className="flex flex-wrap gap-3">
          <Skeleton className="h-9 w-32 rounded-full" />
          <Skeleton className="h-10 w-28 rounded-xl" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div
            key={index}
            className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
          >
            <div className="flex items-start justify-between gap-4">
              <SkeletonText lines={['h-3 w-28', 'h-8 w-24', 'h-4 w-36']} />
              <Skeleton className="h-10 w-10 rounded-xl" />
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm xl:col-span-3">
          <Skeleton className="mb-5 h-10 w-64 rounded-xl" />
          <Skeleton className="h-[280px] w-full rounded-2xl" />
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm xl:col-span-2">
          <Skeleton className="mb-5 h-10 w-56 rounded-xl" />
          <Skeleton className="h-[280px] w-full rounded-2xl" />
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <Skeleton className="h-10 w-72 rounded-xl" />
          <Skeleton className="h-7 w-32 rounded-full" />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-11">
          {Array.from({ length: EMPTY_HEATMAP.length }, (_, index) => (
            <Skeleton key={index} className="h-24 rounded-xl" />
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
  const summary = useMemo(() => {
    const totalRevenue = data.daily.reduce((sum, item) => sum + item.revenue, 0);
    const totalTransactions = data.daily.reduce((sum, item) => sum + item.transactions, 0);
    const activeSchoolDays = data.daily.filter(
      (item) => item.revenue > 0 || item.transactions > 0
    ).length;
    const trackedSchoolDays = data.daily.length;
    const averageTicket = totalTransactions > 0 ? totalRevenue / totalTransactions : 0;
    const averageDailyRevenue =
      trackedSchoolDays > 0 ? totalRevenue / trackedSchoolDays : 0;
    const peakHour = data.heatmap.reduce(
      (peak, item) => (item.sales > peak.sales ? item : peak),
      EMPTY_HEATMAP[0]
    );
    const topProduct = data.top[0] || null;

    return {
      totalRevenue,
      totalTransactions,
      activeSchoolDays,
      trackedSchoolDays,
      averageTicket,
      averageDailyRevenue,
      peakHour,
      topProduct,
    };
  }, [data.daily, data.heatmap, data.top]);

  const lineChartData = useMemo(
    () => ({
      labels: data.daily.map((item) =>
        item.date
          ? formatPhilippineDate(item.date, {
              month: 'short',
              day: 'numeric',
            })
          : ''
      ),
      datasets: [
        {
          label: 'Revenue',
          data: data.daily.map((item) => item.revenue),
          borderColor: '#0f766e',
          backgroundColor: 'rgba(20, 184, 166, 0.12)',
          pointBackgroundColor: '#0f766e',
          pointBorderColor: '#ffffff',
          pointBorderWidth: 2,
          pointHoverRadius: 6,
          pointRadius: 4,
          fill: true,
          tension: 0.38,
        },
      ],
    }),
    [data.daily]
  );

  const barChartData = useMemo(
    () => ({
      labels: data.top.map((item) => item.product_name),
      datasets: [
        {
          label: 'Units Sold',
          data: data.top.map((item) => item.total_qty),
          backgroundColor: data.top.map(
            (_, index) => TOP_PRODUCT_COLORS[index % TOP_PRODUCT_COLORS.length]
          ),
          borderRadius: 8,
          borderSkipped: false,
          maxBarThickness: 28,
        },
      ],
    }),
    [data.top]
  );

  const lineChartOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#0f172a',
          bodyColor: '#e2e8f0',
          borderColor: 'rgba(148, 163, 184, 0.24)',
          borderWidth: 1,
          displayColors: false,
          padding: 12,
          titleColor: '#ffffff',
          callbacks: {
            label: (context) => `Revenue: ${formatCurrency(context.parsed.y)}`,
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: '#64748b', font: { weight: '600' } },
        },
        y: {
          beginAtZero: true,
          border: { display: false },
          grid: { color: 'rgba(148, 163, 184, 0.18)' },
          ticks: {
            color: '#64748b',
            callback: (value) => formatCurrency(value),
          },
        },
      },
    }),
    []
  );

  const barChartOptions = useMemo(
    () => ({
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#0f172a',
          bodyColor: '#e2e8f0',
          borderColor: 'rgba(148, 163, 184, 0.24)',
          borderWidth: 1,
          displayColors: false,
          padding: 12,
          titleColor: '#ffffff',
          callbacks: {
            label: (context) => `Sold: ${formatNumber(context.parsed.x)} units`,
          },
        },
      },
      scales: {
        x: {
          beginAtZero: true,
          border: { display: false },
          grid: { color: 'rgba(148, 163, 184, 0.18)' },
          ticks: {
            color: '#64748b',
            precision: 0,
          },
        },
        y: {
          grid: { display: false },
          ticks: {
            color: '#334155',
            font: { weight: '700' },
            callback(value) {
              const label = this.getLabelForValue(value);
              return label.length > 18 ? `${label.slice(0, 18)}...` : label;
            },
          },
        },
      },
    }),
    []
  );

  const maxHeatmapSales = Math.max(0, ...data.heatmap.map((item) => item.sales));
  const heatmapScale = Math.max(1, maxHeatmapSales);
  const heatmapPeakLabel =
    summary.peakHour?.sales > 0 ? formatHour(summary.peakHour.hour) : 'No peak yet';

  if (loading) {
    return <AnalyticsSkeleton />;
  }

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto pb-8 pr-2 custom-scrollbar">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-teal-100 bg-teal-50 px-3 py-1 text-[11px] font-black uppercase tracking-[0.22em] text-teal-700">
            <CalendarDaysIcon className="h-4 w-4" />
            School Days
          </div>
          <h1 className="mt-3 text-3xl font-black tracking-tight text-slate-950">
            Analytics
          </h1>
          <p className="mt-1 text-sm font-medium text-slate-500">
            Sales performance across school days and canteen hours
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-black uppercase tracking-[0.18em] text-slate-500 shadow-sm">
            7 AM-5 PM
          </div>
          <button
            type="button"
            onClick={() => setReloadKey((value) => value + 1)}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-black text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
          >
            <ArrowPathIcon className="h-4 w-4" />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <DismissibleAlert resetKey={error} tone="amber" className="rounded-xl">
          {error}
        </DismissibleAlert>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="Revenue"
          value={formatCurrency(summary.totalRevenue)}
          detail={`${formatNumber(summary.trackedSchoolDays)} school days tracked`}
          icon={BanknotesIcon}
          tone="emerald"
        />
        <MetricCard
          title="Transactions"
          value={formatNumber(summary.totalTransactions)}
          detail={`${formatNumber(summary.activeSchoolDays)} days with activity`}
          icon={ShoppingBagIcon}
          tone="sky"
        />
        <MetricCard
          title="Average Ticket"
          value={formatCurrency(summary.averageTicket)}
          detail={`${formatCurrency(summary.averageDailyRevenue)} daily average`}
          icon={ArrowTrendingUpIcon}
          tone="amber"
        />
        <MetricCard
          title="Peak Hour"
          value={heatmapPeakLabel}
          detail={
            summary.peakHour?.sales > 0
              ? formatCurrency(summary.peakHour.sales)
              : 'No sales activity yet'
          }
          icon={ClockIcon}
          tone="rose"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
        <Panel
          icon={ArrowTrendingUpIcon}
          title="School-Day Revenue Trend"
          meta={`Average ${formatCurrency(summary.averageDailyRevenue)} per school day`}
          className="xl:col-span-3"
        >
          <div className="h-[300px]">
            {hasDailyData ? (
              <Line data={lineChartData} options={lineChartOptions} />
            ) : (
              <EmptyPanel
                icon={ArrowTrendingUpIcon}
                title="No school-day sales"
                message="Revenue will appear here after completed school-day transactions."
              />
            )}
          </div>
        </Panel>

        <Panel
          icon={TrophyIcon}
          title="Top-Selling Products"
          meta={
            summary.topProduct
              ? `Leader: ${summary.topProduct.product_name}`
              : 'No product leader yet'
          }
          className="xl:col-span-2"
        >
          <div className="h-[300px]">
            {hasTopData ? (
              <Bar data={barChartData} options={barChartOptions} />
            ) : (
              <EmptyPanel
                icon={TrophyIcon}
                title="No product sales"
                message="Product rankings will appear after itemized sales are recorded."
              />
            )}
          </div>
        </Panel>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
              <ClockIcon className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-black uppercase tracking-[0.18em] text-slate-800">
                School-Day Sales Heatmap by Hour
              </h3>
              <p className="mt-1 text-sm text-slate-500">
                7 AM through 5 PM canteen activity
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-black text-slate-600">
              <FireIcon className="h-4 w-4 text-rose-500" />
              Peak: {heatmapPeakLabel}
            </span>
            <span className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-black text-slate-600">
              Max {formatCurrency(maxHeatmapSales)}
            </span>
          </div>
        </div>

        {!hasHeatmapData && (
          <div className="mb-4 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-500">
            No hourly sales activity found for school hours yet.
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-11">
          {data.heatmap.map((item) => {
            const intensity = getHeatmapIntensity(item.sales, heatmapScale);
            const label = formatHour(item.hour);
            const isPeak = hasHeatmapData && item.hour === summary.peakHour?.hour;
            const share = item.sales > 0 ? Math.max(10, (item.sales / heatmapScale) * 100) : 0;

            return (
              <article
                key={item.hour}
                className={`min-h-24 rounded-xl border p-3 transition hover:-translate-y-0.5 hover:shadow-md ${HEATMAP_INTENSITY_CLASSES[intensity]}`}
                title={`${label}: ${formatCurrency(item.sales)}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-black">{label}</div>
                  {isPeak && <FireIcon className="h-4 w-4 shrink-0" />}
                </div>
                <div className="mt-3 truncate text-sm font-black">
                  {formatCurrency(item.sales)}
                </div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/45">
                  <div
                    className="h-full rounded-full bg-current opacity-70"
                    style={{ width: `${share}%` }}
                  />
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
