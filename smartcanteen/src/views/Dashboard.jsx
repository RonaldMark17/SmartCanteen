import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { API } from '../services/api';
import DismissibleAlert from '../components/DismissibleAlert';
import { Skeleton, SkeletonText } from '../components/Skeleton';
import { useModuleSettings } from '../contexts/useModuleSettings';
import { useAuth } from '../contexts/AuthContext';
import { MODULE_KEYS, isModuleEnabled } from '../config/modules';
import {
  formatPhilippineDateTime,
  getPhilippineDateParts,
} from '../utils/dateTime';
import { useThemeMode } from '../utils/theme';
import {
  ArrowDownTrayIcon,
  ArrowTopRightOnSquareIcon,
  ArrowTrendingDownIcon,
  ArrowTrendingUpIcon,
  BanknotesIcon,
  CalendarDaysIcon,
  ChartBarIcon,
  CheckCircleIcon,
  ClipboardDocumentCheckIcon,
  ClockIcon,
  CubeIcon,
  CurrencyDollarIcon,
  DocumentTextIcon,
  ExclamationTriangleIcon,
  MinusIcon,
  PlusCircleIcon,
  PrinterIcon,
  ScaleIcon,
  ShoppingCartIcon,
} from '@heroicons/react/24/outline';
import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Title,
  Tooltip,
} from 'chart.js';
import { Bar, Pie } from 'react-chartjs-2';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Title,
  Tooltip,
  Legend,
  ArcElement
);

const EXPENSE_LABELS = [
  'Transportation/Freight',
  'Gas',
  'Supplies',
  'Helpers',
  'Repair',
  'Purchase from Losses of Tools',
  'Other Expenses',
];

const EXPENSE_LABEL_FIXES = {
  'purchase from the looses of tools': 'Purchase from Losses of Tools',
  'purchase from losses of tools': 'Purchase from Losses of Tools',
  'other expenses': 'Other Expenses',
};

function toMoney(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function formatCurrency(value) {
  return `PHP ${toMoney(value).toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('en-PH');
}

function formatPercent(value) {
  return `${Number(value || 0).toFixed(2)}%`;
}

function getMonthKeyFromReport(report) {
  if (!report) return '';
  return `${report.calendar_year}-${String(report.month_number).padStart(2, '0')}`;
}

function getCurrentMonthKey() {
  const parts = getPhilippineDateParts(new Date());
  const year = parts?.year || new Date().getFullYear();
  const month = parts?.month || new Date().getMonth() + 1;
  return `${year}-${String(month).padStart(2, '0')}`;
}

function normalizeExpenseLabel(label) {
  const normalized = String(label || '').trim();
  return EXPENSE_LABEL_FIXES[normalized.toLowerCase()] || normalized || 'Other Expenses';
}

function getCurrentBalance(report) {
  if (!report) return 0;
  const fundBalance = Number(report.fund_current_balance_total);
  return Number.isFinite(fundBalance) ? fundBalance : toMoney(report.ending_cash);
}

function getProfitMargin(report) {
  const totalIncome = toMoney(report?.current_sales) + toMoney(report?.other_income);
  if (totalIncome <= 0) return 0;
  return (toMoney(report?.net_profit) / totalIncome) * 100;
}

function getPreviousReport(reports, report) {
  const selectedIndex = Number(report?.month_index ?? -1);
  return reports.find((item) => Number(item.month_index) === selectedIndex - 1) || null;
}

function buildExpenseBreakdown(report) {
  const totals = Object.fromEntries(EXPENSE_LABELS.map((label) => [label, 0]));
  (report?.expenses || []).forEach((expense) => {
    const label = normalizeExpenseLabel(expense.category);
    totals[label] = toMoney(totals[label]) + toMoney(expense.amount);
  });
  return EXPENSE_LABELS.map((label) => ({ label, value: toMoney(totals[label]) }));
}

function ComparisonIndicator({ value, inverse = false }) {
  if (value > 0) {
    const colorClass = inverse
      ? 'bg-rose-50 text-rose-600 dark:bg-rose-950/60 dark:text-rose-400'
      : 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400';
    return (
      <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${colorClass}`}>
        <ArrowTrendingUpIcon className="h-3.5 w-3.5" />
        Up
      </span>
    );
  }

  if (value < 0) {
    const colorClass = inverse
      ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400'
      : 'bg-rose-50 text-rose-600 dark:bg-rose-950/60 dark:text-rose-400';
    return (
      <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${colorClass}`}>
        <ArrowTrendingDownIcon className="h-3.5 w-3.5" />
        Down
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
      <MinusIcon className="h-3.5 w-3.5" />
      Even
    </span>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { modules } = useModuleSettings();
  const role = String(user?.role || '').trim().toLowerCase();
  const isAdmin = ['admin', 'administrator'].includes(role);
  const isStaff = role === 'staff';
  const isCashier = role === 'cashier';
  const posEnabled = isModuleEnabled(modules, MODULE_KEYS.POS);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Admin Financial State
  const [schoolYears, setSchoolYears] = useState([]);
  const [selectedSchoolYearId, setSelectedSchoolYearId] = useState('');
  const [detail, setDetail] = useState(null);
  const [selectedReportId, setSelectedReportId] = useState('');
  const [exportingExcel, setExportingExcel] = useState(false);

  // Staff & Cashier Operational State
  const [operationalProducts, setOperationalProducts] = useState([]);
  const [operationalHistoryLogs, setOperationalHistoryLogs] = useState([]);

  useEffect(() => {
    let active = true;

    if (isAdmin) {
      async function loadSchoolYears() {
        try {
          const response = await API.getFinancialSchoolYears();
          if (!active) return;

          const list = Array.isArray(response) ? response : [];
          setSchoolYears(list);

          const activeYear = list.find((sy) => sy.is_active) || list[0];
          if (activeYear) {
            setSelectedSchoolYearId(String(activeYear.id));
          }
        } catch {
          if (!active) return;
          setError('Failed to load financial school years.');
        } finally {
          if (active) setLoading(false);
        }
      }
      loadSchoolYears();
    } else {
      async function loadOperationalData() {
        setLoading(true);
        setError(null);
        try {
          const [productsRes, historyRes] = await Promise.allSettled([
            API.getProducts(true),
            API.getInventoryHistory({ limit: 10 }),
          ]);

          if (!active) return;

          if (productsRes.status === 'fulfilled') {
            setOperationalProducts(Array.isArray(productsRes.value) ? productsRes.value : []);
          }
          if (historyRes.status === 'fulfilled') {
            const logs = historyRes.value?.logs || historyRes.value || [];
            setOperationalHistoryLogs(Array.isArray(logs) ? logs : []);
          }
        } catch {
          if (!active) return;
          setError('Failed to load operational data.');
        } finally {
          if (active) setLoading(false);
        }
      }
      loadOperationalData();
    }

    return () => {
      active = false;
    };
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin || !selectedSchoolYearId) return;

    let active = true;
    async function loadDetail() {
      setLoading(true);
      setError(null);
      try {
        const data = await API.getFinancialSchoolYearDetail(selectedSchoolYearId);
        if (!active) return;

        setDetail(data);

        const reportList = data?.reports || [];
        const currentKey = getCurrentMonthKey();
        const currentReport = reportList.find((r) => getMonthKeyFromReport(r) === currentKey);
        const initialReport = currentReport || reportList[reportList.length - 1] || reportList[0];

        if (initialReport) {
          setSelectedReportId(String(initialReport.id));
        }
      } catch {
        if (!active) return;
        setError('Failed to load financial overview data.');
      } finally {
        if (active) setLoading(false);
      }
    }

    loadDetail();
    return () => {
      active = false;
    };
  }, [isAdmin, selectedSchoolYearId]);

  // Admin Calculations
  const reports = useMemo(() => detail?.reports || [], [detail]);
  const selectedReport = useMemo(() => {
    return reports.find((r) => String(r.id) === String(selectedReportId)) || reports[0] || null;
  }, [reports, selectedReportId]);

  const previousReport = useMemo(() => {
    return getPreviousReport(reports, selectedReport);
  }, [reports, selectedReport]);

  const selectedMonthLabel = selectedReport?.month_label || 'Selected Month';
  const selectedSchoolYearName = detail?.school_year?.name || 'School Year';

  const totalIncome = useMemo(() => {
    if (!selectedReport) return 0;
    return toMoney(selectedReport.current_sales) + toMoney(selectedReport.other_income);
  }, [selectedReport]);

  const currentBalance = useMemo(() => {
    return getCurrentBalance(selectedReport);
  }, [selectedReport]);

  const profitMargin = useMemo(() => {
    return getProfitMargin(selectedReport);
  }, [selectedReport]);

  const expenseBreakdownList = useMemo(() => {
    return buildExpenseBreakdown(selectedReport);
  }, [selectedReport]);

  const hasExpenseBreakdown = useMemo(() => {
    return expenseBreakdownList.some((item) => item.value > 0);
  }, [expenseBreakdownList]);

  const comparisonRows = useMemo(() => {
    const currSales = toMoney(selectedReport?.current_sales);
    const prevSales = toMoney(previousReport?.current_sales);
    const currExp = toMoney(selectedReport?.total_expenses);
    const prevExp = toMoney(previousReport?.total_expenses);
    const currProfit = toMoney(selectedReport?.net_profit);
    const prevProfit = toMoney(previousReport?.net_profit);
    const currBal = getCurrentBalance(selectedReport);
    const prevBal = getCurrentBalance(previousReport);

    return [
      {
        label: 'Sales',
        current: currSales,
        previous: prevSales,
        difference: currSales - prevSales,
      },
      {
        label: 'Expenses',
        current: currExp,
        previous: prevExp,
        difference: currExp - prevExp,
        inverse: true,
      },
      {
        label: 'Profit',
        current: currProfit,
        previous: prevProfit,
        difference: currProfit - prevProfit,
      },
      {
        label: 'Current Balance',
        current: currBal,
        previous: prevBal,
        difference: currBal - prevBal,
      },
    ];
  }, [selectedReport, previousReport]);

  const salesTrendData = useMemo(() => {
    const labels = reports.map((r) => r.month_name?.substring(0, 3) || 'M');
    const sales = reports.map((r) => toMoney(r.current_sales));
    const profit = reports.map((r) => toMoney(r.net_profit));

    return {
      labels,
      datasets: [
        {
          label: 'Monthly Sales',
          data: sales,
          backgroundColor: '#059669',
          hoverBackgroundColor: '#047857',
          borderRadius: 8,
          borderSkipped: false,
          barPercentage: 0.65,
          categoryPercentage: 0.7,
        },
        {
          label: 'Net Profit',
          data: profit,
          backgroundColor: '#0284c7',
          hoverBackgroundColor: '#0369a1',
          borderRadius: 8,
          borderSkipped: false,
          barPercentage: 0.65,
          categoryPercentage: 0.7,
        },
      ],
    };
  }, [reports]);

  const isDark = useThemeMode();

  const chartTextColor = isDark ? '#f1f5f9' : '#475569';
  const chartMutedColor = isDark ? '#cbd5e1' : '#64748b';
  const chartGridColor = isDark ? 'rgba(241, 245, 249, 0.14)' : 'rgba(226, 232, 240, 0.7)';
  const chartBorderColor = isDark ? '#0f172a' : '#ffffff';
  const tooltipBg = isDark ? '#1e293b' : '#0f172a';

  const expenseBreakdownData = useMemo(() => {
    return {
      labels: expenseBreakdownList.map((item) => item.label),
      datasets: [
        {
          data: expenseBreakdownList.map((item) => item.value),
          backgroundColor: [
            '#10b981', // Emerald
            '#0284c7', // Sky
            '#f59e0b', // Amber
            '#8b5cf6', // Violet
            '#ef4444', // Rose
            '#06b6d4', // Cyan
            '#94a3b8', // Slate
          ],
          borderColor: chartBorderColor,
          borderWidth: 2,
          hoverOffset: 6,
        },
      ],
    };
  }, [expenseBreakdownList, chartBorderColor]);

  const commonChartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'bottom',
        labels: {
          boxWidth: 10,
          boxHeight: 10,
          usePointStyle: true,
          pointStyle: 'circle',
          padding: 16,
          font: { weight: 'bold', size: 11, family: 'inherit' },
          color: chartMutedColor,
        },
      },
      tooltip: {
        backgroundColor: tooltipBg,
        titleColor: '#ffffff',
        bodyColor: '#f1f5f9',
        titleFont: { weight: 'bold', size: 12 },
        bodyFont: { size: 12 },
        padding: 10,
        cornerRadius: 10,
        callbacks: {
          label: (context) => ` ${context.dataset.label}: ₱${Number(context.raw || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`,
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { font: { weight: 'bold', size: 11 }, color: chartTextColor },
      },
      y: {
        grid: { color: chartGridColor, borderDash: [4, 4] },
        ticks: {
          font: { weight: 'bold', size: 11 },
          color: chartTextColor,
          callback: (value) => `₱${Number(value).toLocaleString('en-PH')}`,
        },
      },
    },
  }), [chartTextColor, chartMutedColor, chartGridColor, tooltipBg]);

  const pieOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'right',
        labels: {
          boxWidth: 10,
          boxHeight: 10,
          usePointStyle: true,
          pointStyle: 'circle',
          padding: 12,
          font: { weight: 'bold', size: 11, family: 'inherit' },
          color: chartTextColor,
        },
      },
      tooltip: {
        backgroundColor: tooltipBg,
        titleColor: '#ffffff',
        bodyColor: '#f1f5f9',
        titleFont: { weight: 'bold', size: 12 },
        bodyFont: { size: 12 },
        padding: 10,
        cornerRadius: 10,
        callbacks: {
          label: (context) => ` ${context.label}: ₱${Number(context.raw || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`,
        },
      },
    },
  }), [chartTextColor, tooltipBg]);

  const handlePrintPdf = () => {
    window.print();
  };

  const handleExportExcel = () => {
    setExportingExcel(true);
    setTimeout(() => {
      window.print();
      setExportingExcel(false);
    }, 500);
  };

  // Operational Inventory Calculations (Staff & Cashier)
  const totalProductsCount = operationalProducts.length;
  const totalStockUnits = operationalProducts.reduce((sum, p) => sum + (Number(p.stock) || 0), 0);
  const inStockProducts = operationalProducts.filter((p) => Number(p.stock) > 0);
  const lowStockItems = operationalProducts.filter(
    (p) => Number(p.stock) > 0 && Number(p.stock) <= Number(p.min_stock)
  );
  const outOfStockItems = operationalProducts.filter((p) => Number(p.stock) <= 0);

  if (loading && (isAdmin ? !detail : operationalProducts.length === 0)) {
    return <SkeletonText lines={['w-72 h-8', 'w-48 h-5']} />;
  }

  // ═════════════════════════════════════════════════════════════════════════════
  // 1. CASHIER POS DASHBOARD
  // ═════════════════════════════════════════════════════════════════════════════
  if (isCashier) {
    return (
      <div className="view-shell custom-scrollbar gap-6 sm:gap-7">
        {/* Cashier Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white">
              Cashier Operations Dashboard
            </h1>
            <p className="mt-1 text-sm font-medium text-slate-500 dark:text-slate-400">
              Welcome back, {user?.full_name || user?.username || 'Cashier'}. Open the point of sale register to serve customers.
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigate('/pos')}
            className="primary-action-button min-h-12 w-fit px-6 text-sm font-black shadow-md transition active:scale-95"
          >
            <ShoppingCartIcon className="h-5 w-5 stroke-[2.5]" />
            Open POS Register
          </button>
        </div>

        {error ? (
          <DismissibleAlert resetKey={error} tone="amber" className="rounded-xl">
            {error}
          </DismissibleAlert>
        ) : null}

        {/* Cashier KPI Cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Available to Sell
              </span>
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400 border border-emerald-200/60">
                <CubeIcon className="h-5 w-5 stroke-[2]" />
              </div>
            </div>
            <div className="mt-3 text-2xl font-black text-slate-900 dark:text-white">
              {formatNumber(inStockProducts.length)}
            </div>
            <p className="mt-1 text-xs text-slate-500">Products ready for checkout</p>
          </div>

          <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Low Stock Warning
              </span>
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-50 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400 border border-amber-200/60">
                <ExclamationTriangleIcon className="h-5 w-5 stroke-[2]" />
              </div>
            </div>
            <div className="mt-3 text-2xl font-black text-amber-600 dark:text-amber-400">
              {formatNumber(lowStockItems.length)}
            </div>
            <p className="mt-1 text-xs text-slate-500">Items running low at register</p>
          </div>

          <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Out of Stock
              </span>
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-50 text-rose-600 dark:bg-rose-950/60 dark:text-rose-400 border border-rose-200/60">
                <MinusIcon className="h-5 w-5 stroke-[2]" />
              </div>
            </div>
            <div className="mt-3 text-2xl font-black text-rose-600 dark:text-rose-400">
              {formatNumber(outOfStockItems.length)}
            </div>
            <p className="mt-1 text-xs text-slate-500">Items currently unavailable</p>
          </div>

          <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Register Status
              </span>
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-50 text-sky-600 dark:bg-sky-950/60 dark:text-sky-400 border border-sky-200/60">
                <CheckCircleIcon className="h-5 w-5 stroke-[2]" />
              </div>
            </div>
            <div className="mt-3 text-2xl font-black text-emerald-600 dark:text-emerald-400">
              Ready
            </div>
            <p className="mt-1 text-xs text-slate-500">Terminal ready for sales</p>
          </div>
        </div>

        {/* Quick Actions & Ready Products */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Quick POS Launch Card */}
          <div className="flex flex-col justify-between rounded-2xl border border-emerald-200/80 bg-emerald-50/30 p-6 shadow-2xs dark:border-emerald-900/40 dark:bg-emerald-950/20 lg:col-span-1">
            <div>
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-md">
                <ShoppingCartIcon className="h-6 w-6 stroke-[2.5]" />
              </div>
              <h2 className="mt-4 text-lg font-black text-slate-900 dark:text-white">
                Start Selling Now
              </h2>
              <p className="mt-1 text-xs font-medium text-slate-600 dark:text-slate-300">
                Launch the POS cashier register to punch orders, scan items, and generate customer receipts.
              </p>
            </div>
            <div className="mt-6 space-y-2.5">
              <button
                type="button"
                onClick={() => navigate('/pos')}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-black text-white shadow-md transition hover:bg-emerald-700 active:scale-95"
              >
                <ShoppingCartIcon className="h-4 w-4" />
                Launch POS Register
              </button>
              <button
                type="button"
                onClick={() => navigate('/inventory')}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-700 shadow-2xs transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                <CubeIcon className="h-4 w-4 text-slate-500" />
                Browse Catalog
              </button>
            </div>
          </div>

          {/* In Stock Products Table */}
          <div className="rounded-2xl border border-slate-200/90 bg-white p-6 shadow-2xs dark:border-slate-800 dark:bg-slate-900 lg:col-span-2">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-200/60">
                  <CubeIcon className="h-5 w-5" />
                </div>
                <h2 className="text-sm font-black uppercase tracking-wider text-slate-900 dark:text-white">
                  Ready-for-Sale Products
                </h2>
              </div>
              <button
                type="button"
                onClick={() => navigate('/inventory')}
                className="text-xs font-black text-emerald-600 hover:text-emerald-700"
              >
                View all ({operationalProducts.length}) →
              </button>
            </div>

            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {inStockProducts.slice(0, 6).map((item) => (
                <div key={item.id} className="flex items-center justify-between py-3">
                  <div>
                    <div className="text-sm font-bold text-slate-900 dark:text-white">{item.name}</div>
                    <div className="text-xs text-slate-500">{item.category || 'General'}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-black text-emerald-600 dark:text-emerald-400">
                      ₱{Number(item.price || 0).toFixed(2)}
                    </div>
                    <div className="text-xs font-bold text-slate-500">
                      {item.stock} in stock
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ═════════════════════════════════════════════════════════════════════════════
  // 2. STAFF OPERATIONAL & INVENTORY DASHBOARD
  // ═════════════════════════════════════════════════════════════════════════════
  if (isStaff) {
    return (
      <div className="view-shell custom-scrollbar gap-6 sm:gap-7">
        {/* Staff Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white">
              Canteen Operations & Inventory Dashboard
            </h1>
            <p className="mt-1 text-sm font-medium text-slate-500 dark:text-slate-400">
              Welcome back, {user?.full_name || user?.username || 'Staff'}. Monitor stock levels and inventory alerts.
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigate('/inventory?action=replenish')}
            className="primary-action-button min-h-12 w-fit px-5 text-sm font-black shadow-md transition active:scale-95"
          >
            <PlusCircleIcon className="h-5 w-5 stroke-[2.5]" />
            + Add Stock / Delivery
          </button>
        </div>

        {error ? (
          <DismissibleAlert resetKey={error} tone="amber" className="rounded-xl">
            {error}
          </DismissibleAlert>
        ) : null}

        {/* Operational KPI Row - Uniform High-Contrast White Cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {/* TOTAL PRODUCTS */}
          <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Total Products
              </span>
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400 border border-emerald-200/60">
                <CubeIcon className="h-5 w-5 stroke-[2]" />
              </div>
            </div>
            <div className="mt-3 text-2xl font-black text-slate-900 dark:text-white">
              {formatNumber(totalProductsCount)}
            </div>
            <p className="mt-1 text-xs text-slate-500">Active items in catalog</p>
          </div>

          {/* TOTAL STOCK UNITS */}
          <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Total Stock Units
              </span>
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-50 text-sky-600 dark:bg-sky-950/60 dark:text-sky-400 border border-sky-200/60">
                <ClipboardDocumentCheckIcon className="h-5 w-5 stroke-[2]" />
              </div>
            </div>
            <div className="mt-3 text-2xl font-black text-slate-900 dark:text-white">
              {formatNumber(totalStockUnits)}
            </div>
            <p className="mt-1 text-xs text-slate-500">Physical units in storage</p>
          </div>

          {/* LOW STOCK ALERTS */}
          <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Low Stock Alerts
              </span>
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-50 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400 border border-amber-200/60">
                <ExclamationTriangleIcon className="h-5 w-5 stroke-[2]" />
              </div>
            </div>
            <div className="mt-3 text-2xl font-black text-amber-600 dark:text-amber-400">
              {formatNumber(lowStockItems.length)}
            </div>
            <p className="mt-1 text-xs text-slate-500">Products needing restock</p>
          </div>

          {/* OUT OF STOCK */}
          <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Out of Stock
              </span>
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-50 text-rose-600 dark:bg-rose-950/60 dark:text-rose-400 border border-rose-200/60">
                <MinusIcon className="h-5 w-5 stroke-[2]" />
              </div>
            </div>
            <div className="mt-3 text-2xl font-black text-rose-600 dark:text-rose-400">
              {formatNumber(outOfStockItems.length)}
            </div>
            <p className="mt-1 text-xs text-slate-500">Items with 0 inventory</p>
          </div>
        </div>

        {/* Quick Operations Actions Toolbar */}
        <div className="rounded-2xl border border-slate-200/90 bg-white p-6 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400">
              <CubeIcon className="h-5 w-5" />
            </div>
            <h2 className="text-sm font-black uppercase tracking-wider text-slate-900 dark:text-white">
              Quick Operations & Restock Actions
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <button
              type="button"
              onClick={() => navigate('/inventory?action=replenish')}
              className="flex items-center justify-center gap-2.5 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-black text-white shadow-2xs transition hover:bg-emerald-700 active:scale-95"
            >
              <PlusCircleIcon className="h-5 w-5" />
              + Restock / Delivery
            </button>
            <button
              type="button"
              onClick={() => navigate('/inventory?action=adjust')}
              className="flex items-center justify-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-black text-slate-700 shadow-2xs transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 active:scale-95"
            >
              <ScaleIcon className="h-5 w-5 text-sky-600" />
              Adjust Stock Count
            </button>
            <button
              type="button"
              onClick={() => navigate('/inventory?tab=alerts')}
              className="flex items-center justify-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-black text-slate-700 shadow-2xs transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 active:scale-95"
            >
              <ExclamationTriangleIcon className="h-5 w-5 text-amber-600" />
              Low-Stock Alerts
            </button>
            <button
              type="button"
              onClick={() => navigate('/inventory?tab=history')}
              className="flex items-center justify-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-black text-slate-700 shadow-2xs transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 active:scale-95"
            >
              <ClockIcon className="h-5 w-5 text-purple-600" />
              Inventory History
            </button>
          </div>
        </div>

        {/* Items Needing Attention & Recent History */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Low Stock Items Attention */}
          <div className="rounded-2xl border border-slate-200/90 bg-white p-6 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-50 text-amber-600 border border-amber-200/60">
                  <ExclamationTriangleIcon className="h-5 w-5" />
                </div>
                <h2 className="text-sm font-black uppercase tracking-wider text-slate-900 dark:text-white">
                  Items Needing Restock
                </h2>
              </div>
              <button
                type="button"
                onClick={() => navigate('/inventory?tab=alerts')}
                className="text-xs font-black text-emerald-600 hover:text-emerald-700"
              >
                View all alerts ({lowStockItems.length + outOfStockItems.length}) →
              </button>
            </div>

            {lowStockItems.length > 0 || outOfStockItems.length > 0 ? (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {[...outOfStockItems, ...lowStockItems].slice(0, 6).map((item) => (
                  <div key={item.id} className="flex items-center justify-between py-3">
                    <div>
                      <div className="text-sm font-bold text-slate-900 dark:text-white">{item.name}</div>
                      <div className="text-xs text-slate-500">{item.category || 'General'}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span
                        className={`inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-black ${
                          Number(item.stock) <= 0
                            ? 'bg-rose-50 text-rose-700 border border-rose-200/60'
                            : 'bg-amber-50 text-amber-700 border border-amber-200/60'
                        }`}
                      >
                        {item.stock} in stock (min {item.min_stock})
                      </span>
                      <button
                        type="button"
                        onClick={() => navigate(`/inventory?action=replenish&productId=${item.id}`)}
                        className="rounded-lg bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition"
                      >
                        + Restock
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <CheckCircleIcon className="h-10 w-10 text-emerald-500" />
                <p className="mt-2 text-sm font-bold text-slate-800 dark:text-slate-200">
                  All products have sufficient stock
                </p>
                <p className="text-xs text-slate-500">No low-stock alerts right now.</p>
              </div>
            )}
          </div>

          {/* Recent Inventory History */}
          <div className="rounded-2xl border border-slate-200/90 bg-white p-6 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-sky-50 text-sky-600 border border-sky-200/60">
                  <ClockIcon className="h-5 w-5" />
                </div>
                <h2 className="text-sm font-black uppercase tracking-wider text-slate-900 dark:text-white">
                  Recent Stock History
                </h2>
              </div>
              <button
                type="button"
                onClick={() => navigate('/inventory?tab=history')}
                className="text-xs font-black text-emerald-600 hover:text-emerald-700"
              >
                View full history →
              </button>
            </div>

            {operationalHistoryLogs.length > 0 ? (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {operationalHistoryLogs.slice(0, 6).map((log) => (
                  <div key={log.id} className="flex items-center justify-between py-3">
                    <div>
                      <div className="text-sm font-bold text-slate-900 dark:text-white">
                        {log.product_name || log.product?.name || `Product #${log.product_id}`}
                      </div>
                      <div className="text-xs text-slate-500">
                        {log.reason || log.movement_type || 'Stock update'}
                        {log.created_at ? ` • ${formatPhilippineDateTime(log.created_at)}` : ''}
                      </div>
                    </div>
                    <div className="text-right">
                      <span
                        className={`inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-black ${
                          Number(log.quantity) > 0
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/60'
                            : 'bg-rose-50 text-rose-700 border border-rose-200/60'
                        }`}
                      >
                        {Number(log.quantity) > 0 ? `+${log.quantity}` : log.quantity}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <ClockIcon className="h-10 w-10 text-slate-300 dark:text-slate-600" />
                <p className="mt-2 text-sm font-bold text-slate-600 dark:text-slate-400">
                  No recent stock movements recorded
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ═════════════════════════════════════════════════════════════════════════════
  // 3. ADMIN FINANCIAL & EXECUTIVE DASHBOARD
  // ═════════════════════════════════════════════════════════════════════════════
  return (
    <div className="view-shell overflow-x-hidden pr-0 space-y-6">
      {/* Header & Controls */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-lg border border-emerald-200/60 bg-emerald-50 px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-950/60 dark:text-emerald-300">
            <BanknotesIcon className="h-4 w-4" />
            Financial Administration
          </div>
          <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-900 dark:text-white sm:text-3xl">
            Financial Overview Dashboard
          </h1>
          <p className="mt-1 text-sm font-medium text-slate-500 dark:text-slate-400">
            {selectedMonthLabel} • {selectedSchoolYearName}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* School Year Select */}
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2 text-xs font-bold text-slate-700 shadow-2xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
            <CalendarDaysIcon className="h-4 w-4 text-slate-400" />
            <select
              value={selectedSchoolYearId}
              onChange={(e) => setSelectedSchoolYearId(e.target.value)}
              className="cursor-pointer bg-transparent text-xs font-bold outline-none"
              aria-label="Select School Year"
            >
              {schoolYears.map((sy) => (
                <option key={sy.id} value={sy.id} className="bg-white text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                  {sy.name}
                </option>
              ))}
            </select>
          </div>

          {/* Month Select */}
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 py-2 text-xs font-bold text-slate-700 shadow-2xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
            <ClockIcon className="h-4 w-4 text-slate-400" />
            <select
              value={selectedReportId}
              onChange={(e) => setSelectedReportId(e.target.value)}
              className="cursor-pointer bg-transparent text-xs font-bold outline-none"
              aria-label="Select Month"
            >
              {reports.map((r) => (
                <option key={r.id} value={r.id} className="bg-white text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                  {r.month_label}
                </option>
              ))}
            </select>
          </div>

          {/* Export Summary Button */}
          <button
            type="button"
            onClick={handlePrintPdf}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 shadow-2xs transition hover:bg-slate-50 active:scale-95 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            <ArrowDownTrayIcon className="h-4 w-4 stroke-[2]" />
            Export Summary
          </button>
        </div>
      </div>

      {error ? (
        <DismissibleAlert resetKey={error} tone="amber" className="rounded-xl">
          {error}
        </DismissibleAlert>
      ) : null}

      {/* Primary KPI Row - Standardized 60-30-10 Color Theory Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {/* TOTAL INCOME */}
        <div className="flex items-start justify-between rounded-2xl border border-slate-200/90 bg-white p-5 shadow-2xs transition-all dark:border-slate-800 dark:bg-slate-900">
          <div className="min-w-0 flex-1">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Total Income
            </div>
            <div className="mt-2 truncate text-2xl font-black tracking-tight text-slate-900 dark:text-white">
              {formatCurrency(totalIncome)}
            </div>
            <div className="mt-1 truncate text-xs font-semibold text-slate-500 dark:text-slate-400">
              {selectedMonthLabel} Total Revenue
            </div>
          </div>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-emerald-100 bg-emerald-50 text-emerald-600 dark:border-emerald-900/60 dark:bg-emerald-950/60 dark:text-emerald-400">
            <CurrencyDollarIcon className="h-5 w-5 stroke-[2]" />
          </div>
        </div>

        {/* TOTAL EXPENSES */}
        <div className="flex items-start justify-between rounded-2xl border border-slate-200/90 bg-white p-5 shadow-2xs transition-all dark:border-slate-800 dark:bg-slate-900">
          <div className="min-w-0 flex-1">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Total Expenses
            </div>
            <div className="mt-2 truncate text-2xl font-black tracking-tight text-slate-900 dark:text-white">
              {formatCurrency(selectedReport?.total_expenses)}
            </div>
            <div className="mt-1 truncate text-xs font-semibold text-slate-500 dark:text-slate-400">
              Operating & Direct Costs
            </div>
          </div>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-rose-100 bg-rose-50 text-rose-600 dark:border-rose-900/60 dark:bg-rose-950/60 dark:text-rose-400">
            <BanknotesIcon className="h-5 w-5 stroke-[2]" />
          </div>
        </div>

        {/* NET PROFIT */}
        <div className="flex items-start justify-between rounded-2xl border border-slate-200/90 bg-white p-5 shadow-2xs transition-all dark:border-slate-800 dark:bg-slate-900">
          <div className="min-w-0 flex-1">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Net Profit
            </div>
            <div className="mt-2 truncate text-2xl font-black tracking-tight text-slate-900 dark:text-white">
              {formatCurrency(selectedReport?.net_profit)}
            </div>
            <div className="mt-1 truncate text-xs font-semibold text-slate-500 dark:text-slate-400">
              Margin: <span className="font-bold text-emerald-600 dark:text-emerald-400">{formatPercent(profitMargin)}</span>
            </div>
          </div>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-sky-100 bg-sky-50 text-sky-600 dark:border-sky-900/60 dark:bg-sky-950/60 dark:text-sky-400">
            <ArrowTrendingUpIcon className="h-5 w-5 stroke-[2]" />
          </div>
        </div>

        {/* CURRENT BALANCE */}
        <div className="flex items-start justify-between rounded-2xl border border-slate-200/90 bg-white p-5 shadow-2xs transition-all dark:border-slate-800 dark:bg-slate-900">
          <div className="min-w-0 flex-1">
            <div className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Current Balance
            </div>
            <div className="mt-2 truncate text-2xl font-black tracking-tight text-slate-900 dark:text-white">
              {formatCurrency(currentBalance)}
            </div>
            <div className="mt-1 truncate text-xs font-semibold text-slate-500 dark:text-slate-400">
              Fund Account Balance
            </div>
          </div>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amber-100 bg-amber-50 text-amber-600 dark:border-amber-900/60 dark:bg-amber-950/60 dark:text-amber-400">
            <ScaleIcon className="h-5 w-5 stroke-[2]" />
          </div>
        </div>
      </div>

      {/* Main Analytics Charts */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        {/* Monthly Sales & Profit Trend */}
        <div className="flex flex-col justify-between rounded-2xl border border-slate-200/90 bg-white p-6 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-emerald-100 bg-emerald-50 text-emerald-600 dark:border-emerald-900/60 dark:bg-emerald-950/60 dark:text-emerald-400">
                <ChartBarIcon className="h-5 w-5 stroke-[2]" />
              </div>
              <div>
                <h2 className="text-sm font-black text-slate-900 dark:text-white">
                  Monthly Sales & Profit Trend
                </h2>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Monthly revenue compared against net earnings</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => navigate('/financial-reports')}
              className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600 hover:text-emerald-700 dark:text-emerald-400"
            >
              <span>View statement</span>
              <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="mt-6 h-64 w-full">
            <Bar data={salesTrendData} options={commonChartOptions} />
          </div>
        </div>

        {/* Expense Breakdown */}
        <div className="flex flex-col justify-between rounded-2xl border border-slate-200/90 bg-white p-6 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-rose-100 bg-rose-50 text-rose-600 dark:border-rose-900/60 dark:bg-rose-950/60 dark:text-rose-400">
                <BanknotesIcon className="h-5 w-5 stroke-[2]" />
              </div>
              <div>
                <h2 className="text-sm font-black text-slate-900 dark:text-white">
                  Expense Breakdown
                </h2>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Cost category distribution for {selectedMonthLabel}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => navigate('/expenses')}
              className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600 hover:text-emerald-700 dark:text-emerald-400"
            >
              <span>View expenses</span>
              <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="mt-6 flex h-64 w-full items-center justify-center">
            {hasExpenseBreakdown ? (
              <Pie data={expenseBreakdownData} options={pieOptions} />
            ) : (
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                No expenses recorded for this month.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Comparison & School Year Summary */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        {/* Financial Comparison Table */}
        <div className="min-w-0 w-full rounded-2xl border border-slate-200/90 bg-white p-5 sm:p-6 shadow-2xs dark:border-slate-800 dark:bg-slate-900 xl:col-span-2">
          <div className="mb-5 flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-sky-100 bg-sky-50 text-sky-600 dark:border-sky-900/60 dark:bg-sky-950/60 dark:text-sky-400">
              <ScaleIcon className="h-5 w-5 stroke-[2]" />
            </div>
            <div>
              <h2 className="text-sm font-black text-slate-900 dark:text-white">
                Financial Comparison
              </h2>
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Month-over-month performance analysis</p>
            </div>
          </div>
          <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-2xs dark:border-slate-800 dark:bg-slate-900">
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full min-w-[550px] text-left text-sm text-slate-600 dark:text-slate-300">
                <thead className="border-b border-slate-200/80 bg-slate-50/80 text-xs font-bold uppercase tracking-wider text-slate-500 dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-400">
                  <tr>
                    <th className="px-4 py-3 font-bold">Category</th>
                    <th className="px-4 py-3 text-right font-bold">Current Month</th>
                    <th className="px-4 py-3 text-right font-bold">Previous Month</th>
                    <th className="px-4 py-3 text-right font-bold">Difference</th>
                    <th className="px-4 py-3 text-center font-bold">Trend</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white dark:divide-slate-800 dark:bg-slate-900">
                  {comparisonRows.map((row) => (
                    <tr key={row.label} className="transition-colors hover:bg-slate-50/70 dark:hover:bg-slate-800/50">
                      <td className="px-4 py-3.5 font-bold text-slate-900 dark:text-white">{row.label}</td>
                      <td className="px-4 py-3.5 text-right font-semibold text-slate-700 dark:text-slate-300">
                        {formatCurrency(row.current)}
                      </td>
                      <td className="px-4 py-3.5 text-right font-semibold text-slate-500 dark:text-slate-400">
                        {formatCurrency(row.previous)}
                      </td>
                      <td className="px-4 py-3.5 text-right font-bold text-slate-900 dark:text-white">
                        {formatCurrency(row.difference)}
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex justify-center">
                          <ComparisonIndicator value={row.difference} inverse={row.inverse} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* School Year Summary Card */}
        <div className="min-w-0 w-full flex flex-col justify-between rounded-2xl border border-slate-200/90 bg-white p-5 sm:p-6 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
          <div>
            <div className="mb-5 flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-emerald-100 bg-emerald-50 text-emerald-600 dark:border-emerald-900/60 dark:bg-emerald-950/60 dark:text-emerald-400">
                <CalendarDaysIcon className="h-5 w-5 stroke-[2]" />
              </div>
              <div>
                <h2 className="text-sm font-black text-slate-900 dark:text-white">
                  School Year Summary
                </h2>
                <p className="text-xs font-medium text-slate-400">Cumulative academic period totals</p>
              </div>
            </div>
            <div className="space-y-2.5">
              <div className="flex items-center justify-between rounded-xl bg-slate-50/80 p-3 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
                <span className="text-xs font-semibold text-slate-500">School Year</span>
                <span className="text-xs font-bold text-slate-900 dark:text-white">{selectedSchoolYearName}</span>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-slate-50/80 p-3 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
                <span className="text-xs font-semibold text-slate-500">Total Sales</span>
                <span className="text-xs font-black text-emerald-600 dark:text-emerald-400">{formatCurrency(detail?.dashboard?.total_monthly_sales)}</span>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-slate-50/80 p-3 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
                <span className="text-xs font-semibold text-slate-500">Total Expenses</span>
                <span className="text-xs font-black text-rose-600 dark:text-rose-400">{formatCurrency(detail?.dashboard?.total_expenses)}</span>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-slate-50/80 p-3 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800">
                <span className="text-xs font-semibold text-slate-500">School Year Balance</span>
                <span className="text-xs font-black text-slate-900 dark:text-white">{formatCurrency(detail?.dashboard?.school_year_balance || currentBalance)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Actions Toolbar for Admin */}
      <div className="rounded-2xl border border-slate-200/90 bg-white p-6 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-purple-100 bg-purple-50 text-purple-600 dark:border-purple-900/60 dark:bg-purple-950/60 dark:text-purple-400">
            <ArrowTopRightOnSquareIcon className="h-5 w-5 stroke-[2]" />
          </div>
          <div>
            <h2 className="text-sm font-black text-slate-900 dark:text-white">
              Quick Actions
            </h2>
            <p className="text-xs font-medium text-slate-400">Direct shortcuts to common financial tasks</p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
          <button
            type="button"
            onClick={() => navigate('/financial-reports')}
            className="flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white shadow-xs transition hover:bg-emerald-700 active:scale-95"
          >
            <DocumentTextIcon className="h-4 w-4" />
            Open Statement
          </button>
          <button
            type="button"
            onClick={() => navigate('/expenses')}
            className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 shadow-2xs transition hover:bg-slate-50 active:scale-95 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            <PlusCircleIcon className="h-4 w-4 text-emerald-600" />
            Add Expense
          </button>
          <button
            type="button"
            onClick={() => navigate(posEnabled ? '/pos' : '/financial-reports')}
            className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 shadow-2xs transition hover:bg-slate-50 active:scale-95 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            <ShoppingCartIcon className="h-4 w-4 text-sky-600" />
            Record Sales
          </button>
          <button
            type="button"
            onClick={handlePrintPdf}
            className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 shadow-2xs transition hover:bg-slate-50 active:scale-95 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            <PrinterIcon className="h-4 w-4 text-purple-600" />
            Export PDF
          </button>
          <button
            type="button"
            onClick={handleExportExcel}
            disabled={exportingExcel}
            className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 shadow-2xs transition hover:bg-slate-50 active:scale-95 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 disabled:opacity-50"
          >
            <ArrowDownTrayIcon className="h-4 w-4 text-amber-600" />
            {exportingExcel ? 'Exporting...' : 'Export Excel'}
          </button>
        </div>
      </div>
    </div>
  );
}
