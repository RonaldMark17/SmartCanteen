import { useEffect, useMemo, useState } from 'react';
import { API } from '../services/api';
import DismissibleAlert from '../components/DismissibleAlert';
import { Skeleton, SkeletonText } from '../components/Skeleton';
import {
  formatPhilippineDate,
  formatPhilippineDateTime,
  getPhilippineDateKey,
  getPhilippineDateParts,
  getPhilippineWeekday,
} from '../utils/dateTime';
import {
  ArrowDownTrayIcon,
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

const PERIOD_OPTIONS = [
  { key: 'day', label: 'Day' },
  { key: 'month', label: 'Month' },
  { key: 'year', label: 'Year' },
];

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function pluralize(count, singular, plural = `${singular}s`) {
  return Number(count) === 1 ? singular : plural;
}

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

function escapeCsvValue(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
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

function getDefaultMonth(parts) {
  const safeParts = parts || getPhilippineDateParts(new Date());
  const year = safeParts?.year || new Date().getFullYear();
  const month = safeParts?.month || new Date().getMonth() + 1;

  return `${year}-${String(month).padStart(2, '0')}`;
}

function getSafeDateInputValue(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))
    ? value
    : getPhilippineDateKey(new Date());
}

function getSafeMonthInputValue(value) {
  return /^\d{4}-\d{2}$/.test(String(value || '')) ? value : getDefaultMonth();
}

function getSafeYearInputValue(value) {
  const currentYear = getPhilippineDateParts(new Date())?.year || new Date().getFullYear();
  return /^\d{4}$/.test(String(value || '')) ? String(value) : String(currentYear);
}

function getPeriodTitle(period) {
  return PERIOD_OPTIONS.find((option) => option.key === period)?.label || 'Day';
}

function getPeriodDescription(period, referenceDate) {
  if (period === 'year') {
    return String(getPhilippineDateParts(referenceDate)?.year || new Date().getFullYear());
  }

  if (period === 'month') {
    return formatPhilippineDate(referenceDate, {
      month: 'long',
      year: 'numeric',
    });
  }

  return formatPhilippineDate(referenceDate, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function getRevenueTrendTitle(period, referenceDate) {
  if (period === 'year') {
    return `${getPeriodDescription(period, referenceDate)} Revenue Trend`;
  }

  if (period === 'month') {
    return `${getPeriodDescription(period, referenceDate)} Revenue Trend`;
  }

  return `${formatPhilippineDate(referenceDate, {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })} Revenue Trend`;
}

function buildAnalyticsRange(period, selectedDate, selectedMonth, selectedYear) {
  if (period === 'year') {
    const year = getSafeYearInputValue(selectedYear);

    return {
      startDate: `${year}-01-01`,
      endDate: `${year}-12-31`,
    };
  }

  if (period === 'month') {
    const monthValue = getSafeMonthInputValue(selectedMonth);
    const [rawYear, rawMonth] = monthValue.split('-');
    const year = Number(rawYear);
    const month = Number(rawMonth);
    const lastDay = year && month ? new Date(year, month, 0).getDate() : 31;

    return {
      startDate: `${monthValue}-01`,
      endDate: `${monthValue}-${String(lastDay).padStart(2, '0')}`,
    };
  }

  const dateValue = getSafeDateInputValue(selectedDate);

  return {
    startDate: dateValue,
    endDate: dateValue,
  };
}

function buildReferenceDate(period, selectedDate, selectedMonth, selectedYear) {
  if (period === 'year') {
    return new Date(`${getSafeYearInputValue(selectedYear)}-01-01T12:00:00+08:00`);
  }

  if (period === 'month') {
    return new Date(`${getSafeMonthInputValue(selectedMonth)}-01T12:00:00+08:00`);
  }

  return new Date(`${getSafeDateInputValue(selectedDate)}T12:00:00+08:00`);
}

function getExportFilterKey(period, selectedDate, selectedMonth, selectedYear) {
  if (period === 'year') {
    return getSafeYearInputValue(selectedYear);
  }

  if (period === 'month') {
    return getSafeMonthInputValue(selectedMonth);
  }

  return getSafeDateInputValue(selectedDate);
}

function buildDateKeysInRange(startDate, endDate) {
  const [startYear, startMonth, startDay] = String(startDate || '').split('-').map(Number);
  const [endYear, endMonth, endDay] = String(endDate || '').split('-').map(Number);

  if (!startYear || !startMonth || !startDay || !endYear || !endMonth || !endDay) {
    return [];
  }

  const dayKeys = [];
  const cursor = new Date(Date.UTC(startYear, startMonth - 1, startDay, 12));
  const end = new Date(Date.UTC(endYear, endMonth - 1, endDay, 12));

  while (cursor <= end) {
    const year = cursor.getUTCFullYear();
    const month = String(cursor.getUTCMonth() + 1).padStart(2, '0');
    const day = String(cursor.getUTCDate()).padStart(2, '0');
    dayKeys.push(`${year}-${month}-${day}`);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dayKeys;
}

function buildYearOptions(selectedYear) {
  const currentYear = getPhilippineDateParts(new Date())?.year || new Date().getFullYear();
  const years = Array.from({ length: 8 }, (_, index) => String(currentYear - index));

  if (selectedYear && !years.includes(String(selectedYear))) {
    years.push(String(selectedYear));
  }

  return years.sort((left, right) => Number(right) - Number(left));
}

function buildTransactionTrendPoints(transactions, period, selectedRange) {
  if (period === 'day') {
    const buckets = EMPTY_HEATMAP.map((item) => ({
      label: formatHour(item.hour),
      hour: item.hour,
      revenue: 0,
      transactions: 0,
    }));

    transactions.forEach((transaction) => {
      const hour = getPhilippineDateParts(transaction.created_at)?.hour;
      const bucket = buckets.find((item) => item.hour === hour);

      if (!bucket) {
        return;
      }

      bucket.revenue += transaction.total;
      bucket.transactions += 1;
    });

    return {
      labels: buckets.map((item) => item.label),
      values: buckets.map((item) => Number(item.revenue.toFixed(2))),
      counts: buckets.map((item) => item.transactions),
    };
  }

  if (period === 'year') {
    const revenueByMonth = Array.from({ length: 12 }, () => 0);
    const transactionsByMonth = Array.from({ length: 12 }, () => 0);

    transactions.forEach((transaction) => {
      const parts = getPhilippineDateParts(transaction.created_at);
      if (!parts?.month) {
        return;
      }

      revenueByMonth[parts.month - 1] += transaction.total;
      transactionsByMonth[parts.month - 1] += 1;
    });

    return {
      labels: MONTH_LABELS,
      values: revenueByMonth.map((value) => Number(value.toFixed(2))),
      counts: transactionsByMonth,
    };
  }

  const dayKeys = buildDateKeysInRange(selectedRange.startDate, selectedRange.endDate).filter(isSchoolDay);
  const revenueByDay = new Map(dayKeys.map((dayKey) => [dayKey, 0]));
  const transactionsByDay = new Map(dayKeys.map((dayKey) => [dayKey, 0]));

  transactions.forEach((transaction) => {
    const dayKey = getPhilippineDateKey(transaction.created_at);

    if (!revenueByDay.has(dayKey)) {
      return;
    }

    revenueByDay.set(dayKey, revenueByDay.get(dayKey) + transaction.total);
    transactionsByDay.set(dayKey, transactionsByDay.get(dayKey) + 1);
  });

  return {
    labels: dayKeys.map((dayKey) =>
      formatPhilippineDate(dayKey, {
        month: 'short',
        day: 'numeric',
      })
    ),
    values: dayKeys.map((dayKey) => Number((revenueByDay.get(dayKey) || 0).toFixed(2))),
    counts: dayKeys.map((dayKey) => transactionsByDay.get(dayKey) || 0),
  };
}

function buildSalesHeatmapBuckets(transactions, period, selectedRange) {
  if (period === 'day') {
    const buckets = EMPTY_HEATMAP.map((item) => ({
      key: `hour-${item.hour}`,
      label: formatHour(item.hour),
      sales: 0,
      transactions: 0,
    }));

    transactions.forEach((transaction) => {
      const hour = getPhilippineDateParts(transaction.created_at)?.hour;
      const bucket = buckets.find((item) => item.key === `hour-${hour}`);

      if (!bucket) {
        return;
      }

      bucket.sales += transaction.total;
      bucket.transactions += 1;
    });

    return buckets.map((item) => ({ ...item, sales: Number(item.sales.toFixed(2)) }));
  }

  if (period === 'year') {
    const buckets = MONTH_LABELS.map((label, index) => ({
      key: `month-${index + 1}`,
      label,
      sales: 0,
      transactions: 0,
    }));

    transactions.forEach((transaction) => {
      const month = getPhilippineDateParts(transaction.created_at)?.month;
      const bucket = buckets[Number(month || 0) - 1];

      if (!bucket) {
        return;
      }

      bucket.sales += transaction.total;
      bucket.transactions += 1;
    });

    return buckets.map((item) => ({ ...item, sales: Number(item.sales.toFixed(2)) }));
  }

  const dayKeys = buildDateKeysInRange(selectedRange.startDate, selectedRange.endDate).filter(isSchoolDay);
  const buckets = dayKeys.map((dayKey) => ({
    key: dayKey,
    label: formatPhilippineDate(dayKey, {
      month: 'short',
      day: 'numeric',
    }),
    sales: 0,
    transactions: 0,
  }));
  const byKey = new Map(buckets.map((item) => [item.key, item]));

  transactions.forEach((transaction) => {
    const dayKey = getPhilippineDateKey(transaction.created_at);
    const bucket = byKey.get(dayKey);

    if (!bucket) {
      return;
    }

    bucket.sales += transaction.total;
    bucket.transactions += 1;
  });

  return buckets.map((item) => ({ ...item, sales: Number(item.sales.toFixed(2)) }));
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

function normalizeTransactions(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((transaction) => ({
      ...transaction,
      created_at: transaction?.created_at || '',
      total: toNumber(transaction?.total),
      items: Array.isArray(transaction?.items) ? transaction.items : [],
    }))
    .filter((transaction) => transaction.created_at);
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
  const todayKey = getPhilippineDateKey(new Date());
  const todayParts = getPhilippineDateParts(new Date());
  const defaultMonth = getDefaultMonth(todayParts);
  const defaultYear = String(todayParts?.year || new Date().getFullYear());
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [error, setError] = useState('');
  const [period, setPeriod] = useState('day');
  const [selectedDate, setSelectedDate] = useState(todayKey);
  const [selectedMonth, setSelectedMonth] = useState(defaultMonth);
  const [selectedYear, setSelectedYear] = useState(defaultYear);
  const selectedRange = useMemo(
    () => buildAnalyticsRange(period, selectedDate, selectedMonth, selectedYear),
    [period, selectedDate, selectedMonth, selectedYear]
  );
  const [data, setData] = useState({
    daily: [],
    top: [],
    heatmap: EMPTY_HEATMAP,
    transactions: [],
  });

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      setLoading(true);
      setError('');
      const queryOptions = {
        startDate: selectedRange.startDate,
        endDate: selectedRange.endDate,
      };

      const [dailyResult, topResult, heatmapResult, transactionsResult] = await Promise.allSettled([
        API.getDailySales(queryOptions),
        API.getTopProducts(queryOptions),
        API.getHourlyHeatmap(queryOptions),
        API.getTransactions(selectedRange.startDate, selectedRange.endDate, { limit: 5000 }),
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
        transactions:
          transactionsResult.status === 'fulfilled'
            ? normalizeTransactions(transactionsResult.value)
            : [],
      };

      setData(nextData);

      const failures = [
        getErrorMessage(dailyResult, 'Failed to load revenue trend.'),
        getErrorMessage(topResult, 'Failed to load top products.'),
        getErrorMessage(heatmapResult, 'Failed to load hourly heatmap.'),
        getErrorMessage(transactionsResult, 'Failed to load transactions.'),
      ].filter(Boolean);

      if (failures.length > 0) {
        const allFailed = failures.length === 4;
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
  }, [reloadKey, selectedRange]);

  const referenceDate = buildReferenceDate(period, selectedDate, selectedMonth, selectedYear);
  const periodTitle = getPeriodTitle(period);
  const periodDescription = getPeriodDescription(period, referenceDate);
  const revenueTrendTitle = getRevenueTrendTitle(period, referenceDate);
  const yearOptions = buildYearOptions(selectedYear);
  const trendPoints = useMemo(
    () => buildTransactionTrendPoints(data.transactions, period, selectedRange),
    [data.transactions, period, selectedRange]
  );
  const heatmapBuckets = useMemo(
    () => buildSalesHeatmapBuckets(data.transactions, period, selectedRange),
    [data.transactions, period, selectedRange]
  );
  const hasTrendData =
    trendPoints.values.some((value) => value > 0) ||
    trendPoints.counts.some((count) => count > 0);
  const hasTopData = data.top.length > 0;
  const hasHeatmapData = heatmapBuckets.some((item) => item.sales > 0);
  const summary = useMemo(() => {
    const totalRevenue = data.transactions.reduce(
      (sum, transaction) => sum + transaction.total,
      0
    );
    const totalTransactions = data.transactions.length;
    const activeSchoolDays = new Set(
      data.transactions.map((transaction) => getPhilippineDateKey(transaction.created_at))
    ).size;
    const trackedSchoolDays = data.daily.length;
    const averageTicket = totalTransactions > 0 ? totalRevenue / totalTransactions : 0;
    const averageDailyRevenue =
      trackedSchoolDays > 0 ? totalRevenue / trackedSchoolDays : 0;
    const topProduct = data.top[0] || null;

    return {
      totalRevenue,
      totalTransactions,
      activeSchoolDays,
      trackedSchoolDays,
      averageTicket,
      averageDailyRevenue,
      topProduct,
    };
  }, [data.daily.length, data.top, data.transactions]);

  const lineChartData = useMemo(
    () => ({
      labels: trendPoints.labels,
      datasets: [
        {
          label: 'Revenue',
          data: trendPoints.values,
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
    [trendPoints]
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
            afterLabel: (context) => {
              const count = trendPoints.counts[context.dataIndex] || 0;
              return `${formatNumber(count)} ${pluralize(count, 'transaction')}`;
            },
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
    [trendPoints]
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

  const maxHeatmapSales = Math.max(0, ...heatmapBuckets.map((item) => item.sales));
  const heatmapScale = Math.max(1, maxHeatmapSales);
  const heatmapPeak = heatmapBuckets.reduce(
    (peak, item) => (item.sales > peak.sales ? item : peak),
    heatmapBuckets[0] || { label: 'No peak yet', sales: 0, transactions: 0 }
  );
  const heatmapPeakLabel =
    heatmapPeak?.sales > 0 ? heatmapPeak.label : 'No peak yet';
  const heatmapMetricTitle =
    period === 'year' ? 'Peak Month' : period === 'month' ? 'Peak Day' : 'Peak Hour';
  const heatmapTitle =
    period === 'year'
      ? 'School-Day Sales Heatmap by Month'
      : period === 'month'
        ? 'School-Day Sales Heatmap by Day'
        : 'School-Day Sales Heatmap by Hour';
  const heatmapDescription =
    period === 'year'
      ? `${periodDescription} monthly canteen activity`
      : period === 'month'
        ? `${periodDescription} daily canteen activity`
        : '7 AM through 5 PM canteen activity';
  const heatmapEmptyMessage =
    period === 'year'
      ? 'No monthly sales activity found for this year yet.'
      : period === 'month'
        ? 'No daily sales activity found for this month yet.'
        : 'No hourly sales activity found for school hours yet.';
  const heatmapGridClass =
    period === 'year'
      ? 'grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-12'
      : period === 'month'
        ? 'grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5 xl:grid-cols-7'
        : 'grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-11';
  const trendMeta =
    period === 'day'
      ? `${formatNumber(summary.totalTransactions)} ${pluralize(summary.totalTransactions, 'transaction')} across school hours`
      : `${formatNumber(summary.totalTransactions)} ${pluralize(summary.totalTransactions, 'transaction')} in the selected period`;

  function handleExportAnalytics() {
    const exportKey = getExportFilterKey(period, selectedDate, selectedMonth, selectedYear);
    const trendLabel = period === 'day' ? 'Hour' : period === 'year' ? 'Month' : 'Date';
    const rows = [
      ['SmartCanteen Analytics Report'],
      [],
      ['Generated At', formatPhilippineDateTime(new Date())],
      ['Filter', `${periodTitle} - ${periodDescription}`],
      ['Date Range', `${selectedRange.startDate} to ${selectedRange.endDate}`],
      [],
      ['Summary'],
      ['Revenue', formatCurrency(summary.totalRevenue)],
      ['Transactions', summary.totalTransactions],
      ['School Days Tracked', summary.trackedSchoolDays],
      ['Days With Activity', summary.activeSchoolDays],
      ['Average Ticket', formatCurrency(summary.averageTicket)],
      ['Average Daily Revenue', formatCurrency(summary.averageDailyRevenue)],
      [heatmapMetricTitle, heatmapPeakLabel],
      ['Top Product', summary.topProduct?.product_name || 'N/A'],
      [],
      [revenueTrendTitle],
      [trendLabel, 'Revenue (PHP)', 'Transactions'],
      ...(trendPoints.labels.length > 0
        ? trendPoints.labels.map((label, index) => [
            label,
            toNumber(trendPoints.values[index]).toFixed(2),
            trendPoints.counts[index] || 0,
          ])
        : [['No revenue trend data available', '', '']]),
      [],
      ['Daily Sales'],
      ['Date', 'Revenue (PHP)', 'Transactions'],
      ...(data.daily.length > 0
        ? data.daily.map((item) => [
            item.date,
            item.revenue.toFixed(2),
            item.transactions,
          ])
        : [['No daily sales data available', '', '']]),
      [],
      ['Top Products'],
      ['Rank', 'Product', 'Units Sold'],
      ...(data.top.length > 0
        ? data.top.map((item, index) => [
            index + 1,
            item.product_name,
            item.total_qty,
          ])
        : [['No top product data available', '', '']]),
      [],
      [heatmapTitle],
      [period === 'year' ? 'Month' : period === 'month' ? 'Day' : 'Hour', 'Sales (PHP)', 'Transactions'],
      ...(heatmapBuckets.length > 0
        ? heatmapBuckets.map((item) => [
            item.label,
            item.sales.toFixed(2),
            item.transactions,
          ])
        : [['No heatmap sales data available', '', '']]),
    ];
    const csv = rows.map((row) => row.map(escapeCsvValue).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = `SmartCanteen_Analytics_${period}_${exportKey}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    window.showToast?.('Analytics report exported.', 'success');
  }

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
            Sales performance for {periodDescription}
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center xl:justify-end">
          <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
            {PERIOD_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setPeriod(option.key)}
                className={`rounded-lg px-4 py-2 text-sm font-black transition-all ${
                  period === option.key
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          {period === 'day' && (
            <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-600 shadow-sm">
              <span>Pick day</span>
              <input
                type="date"
                value={selectedDate}
                onChange={(event) => {
                  const nextDate = event.target.value;
                  const [year, month] = nextDate.split('-');
                  setSelectedDate(nextDate);
                  if (year && month) {
                    setSelectedMonth(`${year}-${month}`);
                    setSelectedYear(year);
                  }
                }}
                className="rounded-lg border border-slate-200 px-2 py-1 text-sm text-slate-700 outline-none transition focus:border-primary"
              />
            </label>
          )}

          {period === 'month' && (
            <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-600 shadow-sm">
              <span>Pick month</span>
              <input
                type="month"
                value={selectedMonth}
                onChange={(event) => {
                  const nextMonth = event.target.value;
                  const [year] = nextMonth.split('-');
                  setSelectedMonth(nextMonth);
                  if (year) {
                    setSelectedYear(year);
                  }
                }}
                className="rounded-lg border border-slate-200 px-2 py-1 text-sm text-slate-700 outline-none transition focus:border-primary"
              />
            </label>
          )}

          {period === 'year' && (
            <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-600 shadow-sm">
              <span>Pick year</span>
              <select
                value={selectedYear}
                onChange={(event) => setSelectedYear(event.target.value)}
                className="rounded-lg border border-slate-200 px-2 py-1 text-sm text-slate-700 outline-none transition focus:border-primary"
              >
                {yearOptions.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </label>
          )}

          <button
            type="button"
            onClick={handleExportAnalytics}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-black text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
          >
            <ArrowDownTrayIcon className="h-4 w-4" />
            Export CSV
          </button>
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
          title={heatmapMetricTitle}
          value={heatmapPeakLabel}
          detail={
            heatmapPeak?.sales > 0
              ? `${formatCurrency(heatmapPeak.sales)} | ${formatNumber(heatmapPeak.transactions)} ${pluralize(heatmapPeak.transactions, 'transaction')}`
              : 'No sales activity yet'
          }
          icon={ClockIcon}
          tone="rose"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
        <Panel
          icon={ArrowTrendingUpIcon}
          title={revenueTrendTitle}
          meta={trendMeta}
          className="xl:col-span-3"
        >
          <div className="h-[300px]">
            {hasTrendData ? (
              <Line data={lineChartData} options={lineChartOptions} />
            ) : (
              <EmptyPanel
                icon={ArrowTrendingUpIcon}
                title="No sales in this period"
                message="Revenue will appear here after completed transactions for the selected filter."
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
                {heatmapTitle}
              </h3>
              <p className="mt-1 text-sm text-slate-500">
                {heatmapDescription}
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
            {heatmapEmptyMessage}
          </div>
        )}

        <div className={heatmapGridClass}>
          {heatmapBuckets.map((item) => {
            const intensity = getHeatmapIntensity(item.sales, heatmapScale);
            const isPeak = hasHeatmapData && item.key === heatmapPeak?.key;
            const share = item.sales > 0 ? Math.max(10, (item.sales / heatmapScale) * 100) : 0;

            return (
              <article
                key={item.key}
                className={`min-h-24 rounded-xl border p-3 transition hover:-translate-y-0.5 hover:shadow-md ${HEATMAP_INTENSITY_CLASSES[intensity]}`}
                title={`${item.label}: ${formatCurrency(item.sales)} from ${formatNumber(item.transactions)} ${pluralize(item.transactions, 'transaction')}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-black">{item.label}</div>
                  {isPeak && <FireIcon className="h-4 w-4 shrink-0" />}
                </div>
                <div className="mt-3 truncate text-sm font-black">
                  {formatCurrency(item.sales)}
                </div>
                <div className="mt-1 truncate text-[11px] font-bold opacity-80">
                  {formatNumber(item.transactions)} {pluralize(item.transactions, 'txn')}
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
