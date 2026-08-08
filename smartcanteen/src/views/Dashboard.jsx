import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { API } from '../services/api';
import DismissibleAlert from '../components/DismissibleAlert';
import { Skeleton, SkeletonText } from '../components/Skeleton';
import { useModuleSettings } from '../contexts/useModuleSettings';
import { useAuth } from '../contexts/AuthContext';
import { MODULE_KEYS, isModuleEnabled } from '../config/modules';
import {
  formatPhilippineDate,
  formatPhilippineDateTime,
  getPhilippineDateParts,
} from '../utils/dateTime';
import {
  ArrowDownTrayIcon,
  ArrowTopRightOnSquareIcon,
  ArrowTrendingDownIcon,
  ArrowTrendingUpIcon,
  BanknotesIcon,
  CalendarDaysIcon,
  ChartBarIcon,
  ChartPieIcon,
  CheckCircleIcon,
  ClipboardDocumentCheckIcon,
  ClockIcon,
  CurrencyDollarIcon,
  DocumentTextIcon,
  MinusIcon,
  PencilSquareIcon,
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
import { Bar, Line, Pie } from 'react-chartjs-2';

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
  const posEnabled = isModuleEnabled(modules, MODULE_KEYS.POS);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [schoolYears, setSchoolYears] = useState([]);
  const [selectedSchoolYearId, setSelectedSchoolYearId] = useState('');
  const [detail, setDetail] = useState(null);
  const [selectedReportId, setSelectedReportId] = useState('');
  const [exportingExcel, setExportingExcel] = useState(false);

  useEffect(() => {
    let active = true;
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
      } catch (err) {
        if (!active) return;
        setError('Failed to load financial school years.');
      } finally {
        if (active) setLoading(false);
      }
    }

    loadSchoolYears();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedSchoolYearId) return;

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
      } catch (err) {
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
  }, [selectedSchoolYearId]);

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
          backgroundColor: '#10b981',
          borderRadius: 6,
        },
        {
          label: 'Net Profit',
          data: profit,
          backgroundColor: '#3b82f6',
          borderRadius: 6,
        },
      ],
    };
  }, [reports]);

  const expenseBreakdownData = useMemo(() => {
    return {
      labels: expenseBreakdownList.map((item) => item.label),
      datasets: [
        {
          data: expenseBreakdownList.map((item) => item.value),
          backgroundColor: [
            '#3b82f6',
            '#10b981',
            '#f59e0b',
            '#ef4444',
            '#8b5cf6',
            '#06b6d4',
            '#64748b',
          ],
        },
      ],
    };
  }, [expenseBreakdownList]);

  const commonChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'bottom' },
    },
    scales: {
      x: { grid: { display: false } },
      y: { grid: { borderDash: [4, 4] } },
    },
  };

  const pieOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'right' },
    },
  };

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

  if (loading && !detail) {
    return <SkeletonText lines={['w-72 h-8', 'w-48 h-5']} />;
  }

  return (
    <div className="view-shell custom-scrollbar gap-6 sm:gap-7">
      {/* Header & Controls */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Financial Overview Dashboard
          </h1>
          <p className="mt-1 text-sm font-medium text-slate-500 dark:text-slate-400">
            {selectedMonthLabel} | {selectedSchoolYearName}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* School Year Select */}
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-2xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
            <CalendarDaysIcon className="h-4 w-4 text-slate-400" />
            <select
              value={selectedSchoolYearId}
              onChange={(e) => setSelectedSchoolYearId(e.target.value)}
              className="cursor-pointer bg-transparent text-xs font-semibold outline-none"
            >
              {schoolYears.map((sy) => (
                <option key={sy.id} value={sy.id} className="bg-white text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                  {sy.name}
                </option>
              ))}
            </select>
          </div>

          {/* Month Select */}
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-2xs dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
            <ClockIcon className="h-4 w-4 text-slate-400" />
            <select
              value={selectedReportId}
              onChange={(e) => setSelectedReportId(e.target.value)}
              className="cursor-pointer bg-transparent text-xs font-semibold outline-none"
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
            className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-2xs transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
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

      {/* Primary KPI Row - Soft Colored Pastel Cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {/* TOTAL INCOME */}
        <div className="flex items-start justify-between rounded-xl border border-emerald-200/80 bg-emerald-50/20 p-5 shadow-2xs dark:border-emerald-900/40 dark:bg-emerald-950/20">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-600/80 dark:text-emerald-400">
              TOTAL INCOME
            </div>
            <div className="mt-2 text-xl font-bold tracking-tight text-slate-900 dark:text-white">
              {formatCurrency(totalIncome)}
            </div>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {selectedMonthLabel} Total Revenue
            </p>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-950/80 dark:text-emerald-400">
            <CurrencyDollarIcon className="h-5 w-5 stroke-[2]" />
          </div>
        </div>

        {/* TOTAL EXPENSES */}
        <div className="flex items-start justify-between rounded-xl border border-rose-200/80 bg-rose-50/20 p-5 shadow-2xs dark:border-rose-900/40 dark:bg-rose-950/20">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-rose-500/80 dark:text-rose-400">
              TOTAL EXPENSES
            </div>
            <div className="mt-2 text-xl font-bold tracking-tight text-slate-900 dark:text-white">
              {formatCurrency(selectedReport?.total_expenses)}
            </div>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Operating & Direct Costs
            </p>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-rose-100 text-rose-500 dark:bg-rose-950/80 dark:text-rose-400">
            <BanknotesIcon className="h-5 w-5 stroke-[2]" />
          </div>
        </div>

        {/* NET PROFIT */}
        <div className="flex items-start justify-between rounded-xl border border-blue-200/80 bg-blue-50/20 p-5 shadow-2xs dark:border-blue-900/40 dark:bg-blue-950/20">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-blue-600/80 dark:text-blue-400">
              NET PROFIT
            </div>
            <div className="mt-2 text-xl font-bold tracking-tight text-slate-900 dark:text-white">
              {formatCurrency(selectedReport?.net_profit)}
            </div>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Margin: {formatPercent(profitMargin)}
            </p>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-950/80 dark:text-blue-400">
            <ArrowTrendingUpIcon className="h-5 w-5 stroke-[2]" />
          </div>
        </div>

        {/* CURRENT BALANCE */}
        <div className="flex items-start justify-between rounded-xl border border-amber-200/80 bg-amber-50/20 p-5 shadow-2xs dark:border-amber-900/40 dark:bg-amber-950/20">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-amber-600/80 dark:text-amber-400">
              CURRENT BALANCE
            </div>
            <div className="mt-2 text-xl font-bold tracking-tight text-slate-900 dark:text-white">
              {formatCurrency(currentBalance)}
            </div>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Fund Account Balance
            </p>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-950/80 dark:text-amber-400">
            <ScaleIcon className="h-5 w-5 stroke-[2]" />
          </div>
        </div>
      </div>

      {/* Main Analytics Charts */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        {/* Monthly Sales & Profit Trend */}
        <div className="flex flex-col justify-between rounded-xl border border-slate-200/80 bg-white p-6 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400">
                ₱
              </span>
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                MONTHLY SALES & PROFIT TREND
              </h2>
            </div>
            <button
              type="button"
              onClick={() => navigate('/financial-reports')}
              className="text-slate-400 transition hover:text-slate-600 dark:hover:text-slate-200"
            >
              <ArrowTopRightOnSquareIcon className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-6 h-64 w-full">
            <Bar data={salesTrendData} options={commonChartOptions} />
          </div>
        </div>

        {/* Expense Breakdown */}
        <div className="flex flex-col justify-between rounded-xl border border-slate-200/80 bg-white p-6 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm">🍰</span>
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                EXPENSE BREAKDOWN
              </h2>
            </div>
            <button
              type="button"
              onClick={() => navigate('/expenses')}
              className="text-slate-400 transition hover:text-slate-600 dark:hover:text-slate-200"
            >
              <ArrowTopRightOnSquareIcon className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-6 flex h-64 w-full items-center justify-center">
            {hasExpenseBreakdown ? (
              <Pie data={expenseBreakdownData} options={pieOptions} />
            ) : (
              <div className="text-xs font-medium text-slate-400">
                No expenses recorded for this month.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Comparison & School Year Summary */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        {/* Financial Comparison Table */}
        <div className="rounded-xl border border-slate-200/80 bg-white p-6 shadow-2xs dark:border-slate-800 dark:bg-slate-900 xl:col-span-2">
          <div className="mb-5 flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400">
              <ScaleIcon className="h-4 w-4" />
            </span>
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-white">
              FINANCIAL COMPARISON
            </h2>
          </div>
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full min-w-[550px] text-left text-sm">
              <thead className="border-b border-slate-200/80 bg-slate-50/80 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-400">
                <tr>
                  <th className="px-3.5 py-2.5 font-semibold">Category</th>
                  <th className="px-3.5 py-2.5 text-right font-semibold">Current Month</th>
                  <th className="px-3.5 py-2.5 text-right font-semibold">Previous Month</th>
                  <th className="px-3.5 py-2.5 text-right font-semibold">Difference</th>
                  <th className="px-3.5 py-2.5 text-center font-semibold">Trend</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {comparisonRows.map((row) => (
                  <tr key={row.label} className="transition-colors hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                    <td className="px-3.5 py-3 font-bold text-slate-900 dark:text-white">{row.label}</td>
                    <td className="px-3.5 py-3 text-right font-semibold text-slate-700 dark:text-slate-300">
                      {formatCurrency(row.current)}
                    </td>
                    <td className="px-3.5 py-3 text-right font-semibold text-slate-700 dark:text-slate-300">
                      {formatCurrency(row.previous)}
                    </td>
                    <td className="px-3.5 py-3 text-right font-bold text-slate-900 dark:text-white">
                      {formatCurrency(row.difference)}
                    </td>
                    <td className="px-3.5 py-3">
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

        {/* School Year Summary Card */}
        <div className="flex flex-col justify-between rounded-xl border border-slate-200/80 bg-white p-6 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
          <div>
            <div className="mb-5 flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400">
                <CalendarDaysIcon className="h-4 w-4" />
              </span>
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-white">
                SCHOOL YEAR SUMMARY
              </h2>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-lg bg-slate-50/70 p-3 dark:bg-slate-800/40">
                <span className="text-xs font-medium text-slate-500">School Year</span>
                <span className="text-xs font-bold text-slate-900 dark:text-white">{selectedSchoolYearName}</span>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-slate-50/70 p-3 dark:bg-slate-800/40">
                <span className="text-xs font-medium text-slate-500">Total Sales</span>
                <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">{formatCurrency(detail?.dashboard?.total_monthly_sales)}</span>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-slate-50/70 p-3 dark:bg-slate-800/40">
                <span className="text-xs font-medium text-slate-500">Total Expenses</span>
                <span className="text-xs font-bold text-rose-600 dark:text-rose-400">{formatCurrency(detail?.dashboard?.total_expenses)}</span>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-slate-50/70 p-3 dark:bg-slate-800/40">
                <span className="text-xs font-medium text-slate-500">School Year Balance</span>
                <span className="text-xs font-bold text-slate-900 dark:text-white">{formatCurrency(detail?.dashboard?.school_year_balance || currentBalance)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Actions Toolbar */}
      <div className="rounded-xl border border-slate-200/80 bg-white p-6 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-4 flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-purple-100 text-purple-600 dark:bg-purple-950/60 dark:text-purple-400">
            <ArrowTopRightOnSquareIcon className="h-4 w-4" />
          </span>
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-white">
            QUICK ACTIONS
          </h2>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
          <button
            type="button"
            onClick={() => navigate('/financial-reports')}
            className="flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-xs font-semibold text-white shadow-2xs transition hover:bg-emerald-700"
          >
            <DocumentTextIcon className="h-4 w-4" />
            Open Financial Report
          </button>
          <button
            type="button"
            onClick={() => navigate('/expenses')}
            className="flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 shadow-2xs transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            <PlusCircleIcon className="h-4 w-4 text-emerald-600" />
            Add Expense
          </button>
          <button
            type="button"
            onClick={() => navigate(posEnabled ? '/pos' : '/financial-reports')}
            className="flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 shadow-2xs transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            <ShoppingCartIcon className="h-4 w-4 text-blue-600" />
            Record Sales
          </button>
          <button
            type="button"
            onClick={handlePrintPdf}
            className="flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 shadow-2xs transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            <PrinterIcon className="h-4 w-4 text-purple-600" />
            Export PDF
          </button>
          <button
            type="button"
            onClick={handleExportExcel}
            disabled={exportingExcel}
            className="flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 shadow-2xs transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 disabled:opacity-50"
          >
            <ArrowDownTrayIcon className="h-4 w-4 text-amber-600" />
            {exportingExcel ? 'Exporting Excel...' : 'Export Excel'}
          </button>
        </div>
      </div>
    </div>
  );
}
