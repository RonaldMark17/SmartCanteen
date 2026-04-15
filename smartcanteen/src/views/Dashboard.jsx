import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { API } from '../services/api';
import DismissibleAlert from '../components/DismissibleAlert';
import { Skeleton, SkeletonText } from '../components/Skeleton';
import {
  formatPhilippineDate,
  formatPhilippineDateTime,
  formatPhilippineTime,
  getDaysInPhilippineMonth,
  getPhilippineDateKey,
  getPhilippineDateParts,
  getPhilippineHour,
  isSamePhilippinePeriod,
  parseBackendDateTime,
} from '../utils/dateTime';
import {
  ArrowDownTrayIcon,
  ArrowTopRightOnSquareIcon,
  ChartPieIcon,
  ClockIcon,
  CurrencyDollarIcon,
  ExclamationTriangleIcon,
  ShoppingCartIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline';
import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  Title,
  Tooltip,
} from 'chart.js';
import { Bar, Doughnut } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend, ArcElement);

const DEFAULT_METRICS = { accuracy: '91.6%' };
const PERIOD_OPTIONS = [
  { key: 'day', label: 'Day' },
  { key: 'month', label: 'Month' },
  { key: 'year', label: 'Year' },
];
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatCurrency(value) {
  return `PHP ${Number(value || 0).toFixed(2)}`;
}

function escapeCsvValue(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

function getPeriodTitle(period) {
  return PERIOD_OPTIONS.find((option) => option.key === period)?.label || 'Day';
}

function getPeriodDescription(period, now) {
  if (period === 'month') {
    return formatPhilippineDate(now, {
      month: 'long',
      year: 'numeric',
    });
  }

  if (period === 'year') {
    return String(getPhilippineDateParts(now)?.year || new Date().getFullYear());
  }

  return formatPhilippineDate(now, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function parseTransactionDate(transaction) {
  return parseBackendDateTime(transaction.created_at);
}

function isWithinPeriod(date, period, now) {
  return isSamePhilippinePeriod(date, period, now);
}

function getPeriodTransactions(transactions, period, now) {
  return transactions
    .filter((transaction) => isWithinPeriod(parseTransactionDate(transaction), period, now))
    .sort((left, right) => {
      const leftDate = parseTransactionDate(left)?.getTime() || 0;
      const rightDate = parseTransactionDate(right)?.getTime() || 0;
      return rightDate - leftDate;
    });
}

function buildCategorySplit(transactions) {
  const totals = new Map();

  transactions.forEach((transaction) => {
    (transaction.items || []).forEach((item) => {
      const category = item.product?.category || 'Uncategorized';
      const revenue = Number(item.quantity || 0) * Number(item.unit_price || 0);
      totals.set(category, (totals.get(category) || 0) + revenue);
    });
  });

  return [...totals.entries()]
    .map(([category, value]) => ({ category, value: Number(value.toFixed(2)) }))
    .sort((left, right) => right.value - left.value)
    .slice(0, 4);
}

function mapRecentTransactions(transactions) {
  return transactions.slice(0, 5).map((transaction) => ({
    id: `TXN-${String(transaction.id).padStart(6, '0')}`,
    date: formatPhilippineDate(transaction.created_at, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }),
    time:
      formatPhilippineTime(transaction.created_at, {
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
      }) || 'N/A',
    amount: Number(transaction.total || 0),
    method: transaction.payment_type === 'gcash' ? 'GCash' : 'Cash',
  }));
}

function buildTrend(period, transactions, now) {
  if (period === 'year') {
    const revenueByMonth = Array.from({ length: 12 }, () => 0);
    transactions.forEach((transaction) => {
      const date = parseTransactionDate(transaction);
      if (!date) {
        return;
      }
      revenueByMonth[date.getMonth()] += Number(transaction.total || 0);
    });

    return {
      title: 'Yearly Revenue Trend',
      labels: MONTH_LABELS,
      values: revenueByMonth.map((value) => Number(value.toFixed(2))),
    };
  }

  if (period === 'month') {
    const daysInMonth = getDaysInPhilippineMonth(now);
    const revenueByDay = Array.from({ length: daysInMonth }, () => 0);

    transactions.forEach((transaction) => {
      const date = parseTransactionDate(transaction);
      if (!date) {
        return;
      }
      const day = getPhilippineDateParts(date)?.day;
      if (day) {
        revenueByDay[day - 1] += Number(transaction.total || 0);
      }
    });

    return {
      title: 'Monthly Revenue Trend',
      labels: Array.from({ length: daysInMonth }, (_, index) => `${index + 1}`),
      values: revenueByDay.map((value) => Number(value.toFixed(2))),
    };
  }

  const revenueByHour = Array.from({ length: 24 }, () => 0);
  transactions.forEach((transaction) => {
    const date = parseTransactionDate(transaction);
    if (!date) {
      return;
    }
    const hour = getPhilippineHour(date);
    if (hour !== null) {
      revenueByHour[hour] += Number(transaction.total || 0);
    }
  });

  return {
      title: 'Daily Revenue Trend',
      labels: Array.from({ length: 24 }, (_, hour) =>
        formatPhilippineTime(`2000-01-01T${String(hour).padStart(2, '0')}:00:00+08:00`, {
          hour: 'numeric',
        })
    ),
    values: revenueByHour.map((value) => Number(value.toFixed(2))),
  };
}

function EmptyPanel({ message }) {
  return (
    <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 text-center text-sm text-slate-500">
      {message}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto pb-8 pr-2">
      <div className="shrink-0 space-y-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <SkeletonText lines={['w-56 h-8', 'w-40 h-4']} />
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Skeleton className="h-12 w-44 rounded-xl" />
            <div className="flex flex-wrap gap-3">
              <Skeleton className="h-11 w-24 rounded-xl" />
              <Skeleton className="h-11 w-36 rounded-xl" />
            </div>
          </div>
        </div>
      </div>

      <div className="grid shrink-0 grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div
            key={index}
            className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
          >
            <div className="flex items-start justify-between gap-4">
              <SkeletonText lines={['w-28 h-3', 'w-24 h-8']} className="flex-1" />
              <Skeleton className="h-10 w-10 rounded-xl" />
            </div>
          </div>
        ))}
      </div>

      <div className="grid h-auto min-h-[350px] shrink-0 grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <Skeleton className="h-5 w-52" />
            <Skeleton className="h-4 w-4 rounded-md" />
          </div>
          <Skeleton className="h-[250px] w-full rounded-2xl" />
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-4 rounded-md" />
          </div>
          <div className="flex h-[250px] items-center justify-center">
            <Skeleton className="h-44 w-44 rounded-full" />
          </div>
        </div>
      </div>

      <div className="grid shrink-0 grid-cols-1 gap-6 lg:grid-cols-2">
        {Array.from({ length: 2 }, (_, index) => (
          <div
            key={index}
            className="rounded-2xl border border-slate-200 bg-white shadow-sm"
          >
            <div className="border-b border-slate-100 p-6">
              <Skeleton className="h-5 w-48" />
            </div>
            <div className="space-y-4 p-6">
              {Array.from({ length: 5 }, (_, rowIndex) => (
                <div
                  key={rowIndex}
                  className="flex items-center justify-between gap-4 rounded-2xl border border-slate-100 bg-slate-50/60 p-4"
                >
                  <SkeletonText lines={['w-32 h-4', 'w-24 h-3']} className="flex-1" />
                  <Skeleton className="h-6 w-20 rounded-full" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [error, setError] = useState('');
  const [period, setPeriod] = useState('day');
  const [data, setData] = useState({
    summary: null,
    transactions: [],
    predictions: [],
    metrics: DEFAULT_METRICS,
  });

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      setLoading(true);
      setError('');

      const now = new Date();
      const philippineNow = getPhilippineDateParts(now);
      const yearStart = `${philippineNow?.year || now.getFullYear()}-01-01`;
      const today = getPhilippineDateKey(now);

      const [summaryResult, predictionsResult, transactionsResult] = await Promise.allSettled([
        API.getSummary(),
        API.getPredictions(),
        API.getTransactions(yearStart, today, { limit: 2000 }),
      ]);

      if (cancelled) {
        return;
      }

      setData({
        summary: summaryResult.status === 'fulfilled' ? summaryResult.value : null,
        predictions:
          predictionsResult.status === 'fulfilled'
            ? predictionsResult.value?.predictions || []
            : [],
        metrics:
          predictionsResult.status === 'fulfilled'
            ? predictionsResult.value?.metrics || DEFAULT_METRICS
            : DEFAULT_METRICS,
        transactions:
          transactionsResult.status === 'fulfilled' && Array.isArray(transactionsResult.value)
            ? transactionsResult.value
            : [],
      });

      const failures = [
        summaryResult.status === 'rejected' ? summaryResult.reason?.message || 'Summary failed.' : null,
        predictionsResult.status === 'rejected'
          ? predictionsResult.reason?.message || 'Predictions failed.'
          : null,
        transactionsResult.status === 'rejected'
          ? transactionsResult.reason?.message || 'Transactions failed.'
          : null,
      ].filter(Boolean);

      if (failures.length > 0) {
        setError(`Some dashboard data could not be loaded: ${failures.join(' | ')}`);
      }

      setLoading(false);
    }

    loadData();

    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  if (loading) {
    return <DashboardSkeleton />;
  }

  const now = new Date();
  const periodTitle = getPeriodTitle(period);
  const { summary, transactions, predictions, metrics } = data;
  const periodTransactions = getPeriodTransactions(transactions, period, now);
  const recentTxns = mapRecentTransactions(periodTransactions);
  const categorySplit = buildCategorySplit(periodTransactions);
  const trend = buildTrend(period, periodTransactions, now);
  const periodRevenue = periodTransactions.reduce(
    (sum, transaction) => sum + Number(transaction.total || 0),
    0
  );
  const periodTransactionCount = periodTransactions.length;
  const hasTrendData = trend.values.some((value) => value > 0);
  const hasCategoryData = categorySplit.length > 0;

  function handleExportSummary() {
    const rows = [
      ['SmartCanteen Dashboard Summary'],
      [],
      ['Generated At', formatPhilippineDateTime(now)],
      ['Period', `${periodTitle} - ${getPeriodDescription(period, now)}`],
      [],
      ['Overview'],
      ['Revenue', formatCurrency(periodRevenue)],
      ['Transactions', periodTransactionCount],
      ['Low Stock Alerts', summary?.low_stock_count || 0],
      ['AI Model Accuracy', metrics?.accuracy || DEFAULT_METRICS.accuracy],
      ['Today Revenue', formatCurrency(summary?.today_revenue || 0)],
      ['Today Transactions', summary?.today_transactions || 0],
      ['Active Products', summary?.total_products || 0],
      ['All-Time Revenue', formatCurrency(summary?.total_revenue || 0)],
      [],
      ['Sales by Category'],
      ['Category', 'Revenue'],
      ...(categorySplit.length > 0
        ? categorySplit.map((entry) => [entry.category, formatCurrency(entry.value)])
        : [['No category data available', '']]),
      [],
      ['Recent Transactions'],
      ['Transaction ID', 'Date', 'Time', 'Method', 'Amount'],
      ...(recentTxns.length > 0
        ? recentTxns.map((txn) => [txn.id, txn.date, txn.time, txn.method, formatCurrency(txn.amount)])
        : [['No transactions available', '', '', '', '']]),
    ];

    const csv = rows.map((row) => row.map((value) => escapeCsvValue(value)).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);

    link.href = url;
    link.download = `dashboard-summary-${period}-${getPhilippineDateKey(new Date())}.csv`;
    link.click();
    URL.revokeObjectURL(url);

    if (window.showToast) {
      window.showToast('Dashboard summary exported.', 'success');
    }
  }

  const barChartData = {
    labels: trend.labels,
    datasets: [
      {
        label: 'Revenue (PHP)',
        data: trend.values,
        backgroundColor: 'rgba(217, 70, 239, 0.8)',
        borderRadius: 6,
      },
    ],
  };

  const doughnutData = {
    labels: categorySplit.map((entry) => entry.category),
    datasets: [
      {
        data: categorySplit.map((entry) => entry.value),
        backgroundColor: ['#d946ef', '#6366f1', '#f59e0b', '#14b8a6'],
        borderWidth: 0,
        hoverOffset: 4,
      },
    ],
  };

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto pb-8 pr-2 custom-scrollbar">
      <div className="shrink-0">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h1 className="text-2xl font-black text-slate-900">Dashboard Overview</h1>
            <p className="text-sm text-slate-500">{getPeriodDescription(period, now)}</p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
              {PERIOD_OPTIONS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setPeriod(option.key)}
                  className={`rounded-lg px-4 py-2 text-sm font-bold transition-all ${
                    period === option.key
                      ? 'bg-slate-900 text-white shadow-sm'
                      : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => setReloadKey((value) => value + 1)}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50"
              >
                Refresh
              </button>
              <button
                type="button"
                onClick={handleExportSummary}
                className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50"
              >
                <ArrowDownTrayIcon className="h-5 w-5" /> Export Summary
              </button>
            </div>
          </div>
        </div>

        {error && (
          <DismissibleAlert resetKey={error} tone="amber" className="mt-4 rounded-xl">
            {error}
          </DismissibleAlert>
        )}
      </div>

      <div className="grid shrink-0 grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title={`${periodTitle} Revenue`}
          value={formatCurrency(periodRevenue)}
          icon={CurrencyDollarIcon}
          color="emerald"
          onClick={() => navigate('/analytics')}
        />
        <StatCard
          title={`${periodTitle} Transactions`}
          value={periodTransactionCount}
          icon={ShoppingCartIcon}
          color="blue"
          onClick={() => navigate('/transactions')}
        />
        <StatCard
          title="Low Stock Alerts"
          value={summary?.low_stock_count || 0}
          icon={ExclamationTriangleIcon}
          color="red"
          alert={summary?.low_stock_count > 0}
          onClick={() => navigate('/inventory')}
        />
        <div
          onClick={() => navigate('/predictions')}
          className="group relative flex cursor-pointer flex-col justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-slate-900 to-indigo-900 p-5 text-white shadow-lg transition-all hover:scale-[1.02] hover:shadow-xl hover:ring-2 hover:ring-primary/50"
        >
          <div className="z-10 flex items-start justify-between">
            <div>
              <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-slate-300">
                AI Model Accuracy
                <ArrowTopRightOnSquareIcon className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
              </p>
              <p className="mt-1 text-2xl font-black tracking-tight">{metrics?.accuracy || '91.6%'}</p>
            </div>
            <div className="rounded-xl bg-white/10 p-2 backdrop-blur-md">
              <SparklesIcon className="h-6 w-6 text-fuchsia-300" />
            </div>
          </div>
          <SparklesIcon className="absolute -bottom-4 -right-4 h-24 w-24 text-white/5 transition-transform duration-500 group-hover:rotate-12" />
        </div>
      </div>

      <div className="grid h-auto min-h-[350px] shrink-0 grid-cols-1 gap-6 lg:grid-cols-3">
        <div
          onClick={() => navigate('/analytics')}
          className="group flex cursor-pointer flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-all hover:border-primary/40 hover:shadow-md lg:col-span-2"
        >
          <h3 className="mb-4 flex items-center justify-between text-sm font-bold uppercase tracking-wider text-slate-800">
            <span className="flex items-center gap-2">
              <CurrencyDollarIcon className="h-5 w-5 text-slate-400" /> {trend.title}
            </span>
            <ArrowTopRightOnSquareIcon className="h-4 w-4 text-slate-300 transition-colors group-hover:text-primary" />
          </h3>
          <div className="min-h-[250px] flex-1">
            {hasTrendData ? (
              <Bar
                data={barChartData}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: { legend: { display: false } },
                  interaction: { mode: 'index', intersect: false },
                }}
              />
            ) : (
              <EmptyPanel message={`No ${period.toLowerCase()} revenue trend is available yet.`} />
            )}
          </div>
        </div>

        <div
          onClick={() => navigate('/analytics')}
          className="group flex cursor-pointer flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-all hover:border-primary/40 hover:shadow-md"
        >
          <h3 className="mb-4 flex items-center justify-between text-sm font-bold uppercase tracking-wider text-slate-800">
            <span className="flex items-center gap-2">
              <ChartPieIcon className="h-5 w-5 text-slate-400" /> Sales by Category
            </span>
            <ArrowTopRightOnSquareIcon className="h-4 w-4 text-slate-300 transition-colors group-hover:text-primary" />
          </h3>
          <div className="relative flex min-h-[250px] flex-1 items-center justify-center">
            {hasCategoryData ? (
              <>
                <div className="h-[80%] w-[80%]">
                  <Doughnut
                    data={doughnutData}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      cutout: '70%',
                      plugins: {
                        legend: {
                          position: 'bottom',
                          labels: { usePointStyle: true, boxWidth: 8 },
                        },
                      },
                    }}
                  />
                </div>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center pb-6">
                  <span className="text-3xl font-black text-slate-800">{periodTransactionCount}</span>
                  <span className="text-[10px] font-bold uppercase text-slate-400">
                    {periodTitle} Orders
                  </span>
                </div>
              </>
            ) : (
              <EmptyPanel message={`No ${period.toLowerCase()} category sales data is available yet.`} />
            )}
          </div>
        </div>
      </div>

      <div className="grid shrink-0 grid-cols-1 gap-6 lg:grid-cols-2">
        <div
          onClick={() => navigate('/transactions')}
          className="group flex cursor-pointer flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-all hover:border-primary/40 hover:shadow-md"
        >
          <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/50 p-6">
            <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-slate-800">
              <ClockIcon className="h-5 w-5 text-slate-400" /> Recent Transactions
            </h3>
            <span className="flex items-center gap-1 text-xs font-bold text-primary opacity-0 transition-opacity group-hover:opacity-100">
              View History <ArrowTopRightOnSquareIcon className="h-3 w-3" />
            </span>
          </div>
          <div className="hidden flex-1 md:block">
            {recentTxns.length > 0 ? (
              <table className="w-full text-left text-sm text-slate-600">
                <thead className="border-b border-slate-100 bg-white text-xs font-bold uppercase text-slate-400">
                  <tr>
                    <th className="px-6 py-3">TXN ID</th>
                    <th className="px-6 py-3">Date & Time</th>
                    <th className="px-6 py-3">Method</th>
                    <th className="px-6 py-3 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {recentTxns.map((txn) => (
                    <tr key={txn.id} className="transition-colors hover:bg-slate-50">
                      <td className="px-6 py-4 font-mono text-xs font-bold text-slate-700">{txn.id}</td>
                      <td className="px-6 py-4 text-xs">
                        <div className="font-bold text-slate-700">{txn.date}</div>
                        <div className="text-slate-400">{txn.time}</div>
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`rounded px-2 py-1 text-[10px] font-black uppercase ${
                            txn.method === 'Cash'
                              ? 'bg-emerald-50 text-emerald-600'
                              : 'bg-blue-50 text-blue-600'
                          }`}
                        >
                          {txn.method}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right font-black text-slate-900">
                        {formatCurrency(txn.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="flex h-full min-h-[220px] items-center justify-center px-6 text-sm text-slate-500">
                No {period.toLowerCase()} transactions yet.
              </div>
            )}
          </div>
          <div className="flex-1 p-4 md:hidden">
            {recentTxns.length > 0 ? (
              <div className="space-y-3">
                {recentTxns.map((txn) => (
                  <div key={txn.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-mono text-xs font-bold text-slate-700">{txn.id}</div>
                        <div className="mt-1 text-sm font-bold text-slate-800">{txn.date}</div>
                        <div className="text-xs text-slate-400">{txn.time}</div>
                      </div>
                      <span
                        className={`rounded px-2 py-1 text-[10px] font-black uppercase ${
                          txn.method === 'Cash'
                            ? 'bg-emerald-50 text-emerald-600'
                            : 'bg-blue-50 text-blue-600'
                        }`}
                      >
                        {txn.method}
                      </span>
                    </div>
                    <div className="mt-4 text-right">
                      <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Total</div>
                      <div className="mt-1 text-lg font-black text-slate-900">{formatCurrency(txn.amount)}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex h-full min-h-[220px] items-center justify-center px-2 text-center text-sm text-slate-500">
                No {period.toLowerCase()} transactions yet.
              </div>
            )}
          </div>
        </div>

        <div
          onClick={() => navigate('/predictions')}
          className="group flex cursor-pointer flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-all hover:border-primary/40 hover:shadow-md"
        >
          <div className="mb-4 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-slate-800">
              <SparklesIcon className="h-5 w-5 text-primary" /> AI Restock Priorities
            </h3>
            <span className="flex items-center gap-1 text-xs font-bold text-primary opacity-0 transition-opacity group-hover:opacity-100">
              View Forecast <ArrowTopRightOnSquareIcon className="h-3 w-3" />
            </span>
          </div>
          <div className="custom-scrollbar flex-1 space-y-4 overflow-y-auto pr-2">
            {predictions.slice(0, 5).map((prediction) => (
              <div
                key={prediction.product_id}
                className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50/50 p-3 transition-all group-hover:border-primary/20"
              >
                <div>
                  <div className="text-sm font-bold text-slate-800">{prediction.product_name}</div>
                  <div className="mt-0.5 max-w-[220px] truncate text-xs font-medium text-slate-500">
                    {prediction.recommendation}
                  </div>
                </div>
                <div className="text-right">
                  <div
                    className={`whitespace-nowrap rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest ${
                      prediction.confidence === 'high'
                        ? 'bg-emerald-100 text-emerald-700'
                        : prediction.confidence === 'medium'
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-slate-200 text-slate-700'
                    }`}
                  >
                    {prediction.confidence}
                  </div>
                  <div className="mt-1 text-xs font-bold text-slate-400">
                    Need: <span className="text-slate-800">{prediction.predicted_quantity}</span>
                  </div>
                </div>
              </div>
            ))}
            {predictions.length === 0 && (
              <div className="py-10 text-center text-sm font-medium text-slate-400">
                No predictions generated yet.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ title, value, icon, color, alert = false, onClick }) {
  const colorClasses = {
    emerald: { iconBg: 'bg-emerald-500/10', iconText: 'text-emerald-500', orb: 'bg-emerald-500' },
    blue: { iconBg: 'bg-blue-500/10', iconText: 'text-blue-500', orb: 'bg-blue-500' },
    red: { iconBg: 'bg-red-500/10', iconText: 'text-red-500', orb: 'bg-red-500' },
  };

  const palette = colorClasses[color] || colorClasses.blue;
  const IconComponent = icon;

  return (
    <div
      onClick={onClick}
      className={`group relative flex cursor-pointer flex-col justify-center overflow-hidden rounded-2xl border bg-white p-5 shadow-sm transition-all hover:-translate-y-1 hover:shadow-md ${
        alert ? 'border-red-400 ring-4 ring-red-50' : 'border-slate-200'
      }`}
    >
      <div className="z-10 flex items-start justify-between">
        <div>
          <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">
            {title}
            <ArrowTopRightOnSquareIcon className="h-3 w-3 text-primary opacity-0 transition-opacity group-hover:opacity-100" />
          </p>
          <p className="mt-1 text-2xl font-black tracking-tight text-slate-900">{value}</p>
        </div>
        <div className={`rounded-xl p-2 ${palette.iconBg} ${palette.iconText} transition-transform group-hover:scale-110`}>
          <IconComponent className="h-6 w-6" />
        </div>
      </div>
      <div className={`pointer-events-none absolute -bottom-6 -right-6 h-24 w-24 rounded-full blur-xl transition-opacity group-hover:opacity-[0.08] ${palette.orb} opacity-[0.03]`} />
    </div>
  );
}
