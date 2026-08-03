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
import { getThemeToken, getThemeTokens, useThemeMode } from '../utils/theme';
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

function getReportDateRange(report) {
  if (!report?.calendar_year || !report?.month_number) {
    return { startDate: '', endDate: '' };
  }

  const year = Number(report.calendar_year);
  const month = Number(report.month_number);
  const lastDay = new Date(year, month, 0).getDate();
  return {
    startDate: `${year}-${String(month).padStart(2, '0')}-01`,
    endDate: `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
  };
}

function hasReportEntries(report) {
  if (!report) return false;
  return [
    report.beginning_cash_on_hand,
    report.current_sales,
    report.other_income,
    report.cost_of_sales,
    report.total_operating_expenses,
  ].some((value) => Math.abs(toMoney(value)) > 0);
}

function normalizeExpenseLabel(label) {
  const normalized = String(label || '').trim();
  return EXPENSE_LABEL_FIXES[normalized.toLowerCase()] || normalized || 'Other Expenses';
}

function sumAllocations(report, key) {
  return (report?.allocations || []).reduce(
    (total, allocation) => total + toMoney(allocation?.[key]),
    0
  );
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

function downloadBlob(blob, filename) {
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename || 'download';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(url);
}

function mapRecentTransactions(transactions) {
  return (transactions || []).slice(0, 5).map((transaction) => ({
    id: `TXN-${String(transaction.id).padStart(6, '0')}`,
    date: formatPhilippineDate(transaction.created_at, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }),
    amount: toMoney(transaction.total),
    label: String(transaction.payment_type || 'cash').toLowerCase() === 'cash' ? 'Cash sale' : 'Sale',
  }));
}

function buildExpenseBreakdown(report) {
  const totals = Object.fromEntries(EXPENSE_LABELS.map((label) => [label, 0]));
  (report?.expenses || []).forEach((expense) => {
    const label = normalizeExpenseLabel(expense.category);
    totals[label] = toMoney(totals[label]) + toMoney(expense.amount);
  });
  return EXPENSE_LABELS.map((label) => ({ label, value: toMoney(totals[label]) }));
}

function buildLatestExpenseEntries(reports) {
  return [...(reports || [])]
    .sort((left, right) => Number(right.month_index) - Number(left.month_index))
    .flatMap((report) =>
      (report.expenses || [])
        .filter((expense) => toMoney(expense.amount) > 0)
        .map((expense) => ({
          id: `${report.id}-${expense.id || expense.category}`,
          title: normalizeExpenseLabel(expense.category),
          detail: report.month_label,
          value: formatCurrency(expense.amount),
        }))
    )
    .slice(0, 5);
}

function buildReportUpdates(reports) {
  return [...(reports || [])]
    .filter((report) => report.updated_at)
    .sort((left, right) => new Date(right.updated_at) - new Date(left.updated_at))
    .slice(0, 5)
    .map((report) => ({
      id: `report-${report.id}`,
      title: report.month_label,
      detail: formatPhilippineDateTime(report.updated_at),
      value: formatCurrency(report.net_profit),
    }));
}

function buildClosedMonthEntries(reports) {
  return [...(reports || [])]
    .filter(hasReportEntries)
    .sort((left, right) => Number(right.month_index) - Number(left.month_index))
    .slice(0, 5)
    .map((report) => ({
      id: `closed-${report.id}`,
      title: report.month_label,
      detail: 'Closed',
      value: formatCurrency(getCurrentBalance(report)),
    }));
}

function EmptyPanel({ message }) {
  return (
    <div className="flex h-full min-h-[220px] items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 text-center text-base text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
      {message}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="view-shell">
      <div className="view-header">
        <SkeletonText lines={['w-72 h-8', 'w-48 h-5']} />
        <div className="flex gap-3">
          <Skeleton className="h-12 w-44 rounded-lg" />
          <Skeleton className="h-12 w-44 rounded-lg" />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index} className="panel-card min-h-[150px]">
            <SkeletonText lines={['w-36 h-5', 'w-44 h-9', 'w-28 h-4']} />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Skeleton className="h-[320px] rounded-lg" />
        <Skeleton className="h-[320px] rounded-lg" />
      </div>
    </div>
  );
}

function SummaryCard({ title, value, detail, icon: IconComponent, tone = 'slate' }) {
  const toneClasses = {
    blue: {
      border: 'border-l-4 border-l-blue-500',
      icon: 'bg-blue-100 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400',
      detail: 'text-slate-500 dark:text-slate-400',
    },
    green: {
      border: 'border-l-4 border-l-emerald-500',
      icon: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400',
      detail: 'text-slate-500 dark:text-slate-400',
    },
    orange: {
      border: 'border-l-4 border-l-orange-500',
      icon: 'bg-orange-100 text-orange-600 dark:bg-orange-950/60 dark:text-orange-400',
      detail: 'text-slate-500 dark:text-slate-400',
    },
    yellow: {
      border: 'border-l-4 border-l-amber-500',
      icon: 'bg-amber-100 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400',
      detail: 'text-slate-500 dark:text-slate-400',
    },
    red: {
      border: 'border-l-4 border-l-rose-500',
      icon: 'bg-rose-100 text-rose-600 dark:bg-rose-950/60 dark:text-rose-400',
      detail: 'text-slate-500 dark:text-slate-400',
    },
    teal: {
      border: 'border-l-4 border-l-teal-500',
      icon: 'bg-teal-100 text-teal-600 dark:bg-teal-950/60 dark:text-teal-400',
      detail: 'text-slate-500 dark:text-slate-400',
    },
    purple: {
      border: 'border-l-4 border-l-purple-500',
      icon: 'bg-purple-100 text-purple-600 dark:bg-purple-950/60 dark:text-purple-400',
      detail: 'text-slate-500 dark:text-slate-400',
    },
    cyan: {
      border: 'border-l-4 border-l-cyan-500',
      icon: 'bg-cyan-100 text-cyan-600 dark:bg-cyan-950/60 dark:text-cyan-400',
      detail: 'text-slate-500 dark:text-slate-400',
    },
    indigo: {
      border: 'border-l-4 border-l-indigo-500',
      icon: 'bg-indigo-100 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400',
      detail: 'text-slate-500 dark:text-slate-400',
    },
    slate: {
      border: 'border-l-4 border-l-slate-400',
      icon: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
      detail: 'text-slate-500 dark:text-slate-400',
    },
  };
  const classes = toneClasses[tone] || toneClasses.slate;

  return (
    <section className={`group relative flex min-h-[135px] flex-col justify-between overflow-hidden rounded-xl border-y border-r border-slate-200 bg-white p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md dark:border-slate-800 dark:bg-slate-900 ${classes.border}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            {title}
          </div>
          <div className="mt-2 break-words text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            {value}
          </div>
        </div>
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-transform duration-200 group-hover:scale-105 ${classes.icon}`}>
          <IconComponent className="h-5 w-5 stroke-[1.8]" />
        </div>
      </div>
      <div className={`mt-3 text-xs font-medium ${classes.detail}`}>
        {detail}
      </div>
    </section>
  );
}

function OverviewMetric({ label, value }) {
  return (
    <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-4.5 transition-all duration-200 hover:border-slate-300/80 hover:bg-slate-100/60 dark:border-slate-800 dark:bg-slate-800/40 dark:hover:border-slate-700">
      <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</div>
      <div className="mt-2 break-words text-2xl font-bold tracking-tight text-slate-900 dark:text-white">{value}</div>
    </div>
  );
}

function ChartPanel({ title, icon: IconComponent, children }) {
  return (
    <section className="min-h-[330px] rounded-xl border border-slate-200/80 bg-white p-5 shadow-xs transition-all duration-200 hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-5 flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100/80 dark:bg-emerald-950/60 dark:text-emerald-400 dark:ring-emerald-900/50">
          <IconComponent className="h-4.5 w-4.5" />
        </span>
        <h2 className="text-base font-bold text-slate-900 dark:text-white">{title}</h2>
      </div>
      <div className="h-[250px]">{children}</div>
    </section>
  );
}

function ComparisonIndicator({ value, inverse = false }) {
  const numeric = toMoney(value);
  if (numeric === 0) {
    return <MinusIcon className="h-4.5 w-4.5 text-slate-400" />;
  }

  const improved = inverse ? numeric < 0 : numeric > 0;
  const IconComponent = numeric > 0 ? ArrowTrendingUpIcon : ArrowTrendingDownIcon;
  return (
    <IconComponent className={`h-4.5 w-4.5 ${improved ? 'text-emerald-600' : 'text-rose-600'}`} />
  );
}

function ActivityList({ title, icon: IconComponent, items, emptyMessage }) {
  return (
    <section className="rounded-xl border border-slate-200/80 bg-white p-5 shadow-xs transition-all duration-200 hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
      <div className="mb-4 flex items-center gap-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100/80 dark:bg-emerald-950/60 dark:text-emerald-400">
          <IconComponent className="h-4 w-4" />
        </span>
        <h2 className="text-base font-bold text-slate-900 dark:text-white">{title}</h2>
      </div>
      <div className="space-y-2.5">
        {items.length > 0 ? (
          items.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-slate-200/70 bg-slate-50/40 p-3 transition-all duration-200 hover:border-emerald-200 hover:bg-emerald-50/30 dark:border-slate-800 dark:bg-slate-900/60 dark:hover:border-slate-700"
            >
              <div className="min-w-0">
                <div className="truncate text-xs font-bold text-slate-900 dark:text-white">{item.title}</div>
                <div className="mt-0.5 truncate text-[11px] font-medium text-slate-500 dark:text-slate-400">{item.detail}</div>
              </div>
              <div className="shrink-0 text-right text-xs font-black text-slate-900 dark:text-white">
                {item.value}
              </div>
            </div>
          ))
        ) : (
          <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 p-4 text-center text-xs font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
            {emptyMessage}
          </div>
        )}
      </div>
    </section>
  );
}

function QuickActionButton({ icon: IconComponent, label, onClick, primary = false, disabled = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${primary ? 'primary-action-button' : 'action-button'} min-h-11 w-full justify-start text-xs font-semibold`}
    >
      <IconComponent className="h-4.5 w-4.5 stroke-[1.8]" />
      {label}
    </button>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { user: authUser } = useAuth();
  const user = authUser || {};
  const { modules } = useModuleSettings();
  const financialReportsEnabled = isModuleEnabled(modules, MODULE_KEYS.FINANCIAL_REPORTS);
  const posEnabled = isModuleEnabled(modules, MODULE_KEYS.POS);
  const transactionsEnabled = isModuleEnabled(modules, MODULE_KEYS.TRANSACTIONS);
  const inventoryEnabled = isModuleEnabled(modules, MODULE_KEYS.INVENTORY);
  const analyticsEnabled = isModuleEnabled(modules, MODULE_KEYS.ANALYTICS);
  const demandForecastEnabled = isModuleEnabled(modules, MODULE_KEYS.DEMAND_FORECAST);
  const auditLogsEnabled = isModuleEnabled(modules, MODULE_KEYS.AUDIT_LOGS);
  const canAccessFinancialReports =
    financialReportsEnabled && ['admin', 'staff'].includes(String(user.role || '').toLowerCase());
  const isAdmin = String(user.role || '').toLowerCase() === 'admin';
  const defaultMonthKey = useMemo(() => getCurrentMonthKey(), []);
  const [financialLoading, setFinancialLoading] = useState(canAccessFinancialReports);
  const [financialError, setFinancialError] = useState('');
  const [activityError, setActivityError] = useState('');
  const [schoolYears, setSchoolYears] = useState([]);
  const [selectedSchoolYearId, setSelectedSchoolYearId] = useState('');
  const [detail, setDetail] = useState(null);
  const [selectedReportId, setSelectedReportId] = useState('');
  const [transactions, setTransactions] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [exportingExcel, setExportingExcel] = useState(false);
  const [operationsData, setOperationsData] = useState({
    summary: null,
    predictions: [],
    topProducts: [],
  });

  useEffect(() => {
    let cancelled = false;

    async function loadSchoolYears() {
      if (!canAccessFinancialReports) {
        setFinancialLoading(false);
        return;
      }

      setFinancialLoading(true);
      setFinancialError('');
      try {
        const schoolYearList = await API.getFinancialSchoolYears();
        if (cancelled) return;

        const normalized = Array.isArray(schoolYearList) ? schoolYearList : [];
        const preferred =
          normalized.find((schoolYear) => schoolYear.is_active) ||
          normalized.find((schoolYear) => Number(schoolYear.months_with_entries || 0) > 0) ||
          normalized[0] ||
          null;

        setSchoolYears(normalized);
        setSelectedSchoolYearId((previous) => {
          const stillExists = normalized.some((schoolYear) => String(schoolYear.id) === String(previous));
          return stillExists ? previous : preferred?.id ? String(preferred.id) : '';
        });

        if (normalized.length === 0) {
          setDetail(null);
          setFinancialLoading(false);
        }
      } catch (error) {
        if (cancelled) return;
        setFinancialError(error.message || 'Unable to load financial school years.');
        setSchoolYears([]);
        setDetail(null);
        setFinancialLoading(false);
      }
    }

    loadSchoolYears();

    return () => {
      cancelled = true;
    };
  }, [canAccessFinancialReports]);

  useEffect(() => {
    let cancelled = false;

    async function loadDetail() {
      if (!canAccessFinancialReports || !selectedSchoolYearId) {
        return;
      }

      setFinancialLoading(true);
      setFinancialError('');
      try {
        const schoolYearDetail = await API.getFinancialSchoolYearDetail(selectedSchoolYearId);
        if (cancelled) return;

        const reports = Array.isArray(schoolYearDetail?.reports) ? schoolYearDetail.reports : [];
        const preferredReport =
          reports.find((report) => getMonthKeyFromReport(report) === defaultMonthKey) ||
          reports.find(hasReportEntries) ||
          reports[0] ||
          null;

        setDetail(schoolYearDetail);
        setSelectedReportId((previous) => {
          const stillExists = reports.some((report) => String(report.id) === String(previous));
          return stillExists ? previous : preferredReport?.id ? String(preferredReport.id) : '';
        });
      } catch (error) {
        if (cancelled) return;
        setFinancialError(error.message || 'Unable to load financial report details.');
        setDetail(null);
      } finally {
        if (!cancelled) {
          setFinancialLoading(false);
        }
      }
    }

    loadDetail();

    return () => {
      cancelled = true;
    };
  }, [canAccessFinancialReports, defaultMonthKey, selectedSchoolYearId]);

  const reports = detail?.reports || [];
  const selectedReport =
    reports.find((report) => String(report.id) === String(selectedReportId)) || reports[0] || null;
  const previousReport = getPreviousReport(reports, selectedReport);
  const selectedMonthLabel = selectedReport?.month_label || 'No month selected';
  const selectedSchoolYearName = detail?.school_year?.name || 'No school year';
  const currentBalance = getCurrentBalance(selectedReport);
  const cashOnBank = sumAllocations(selectedReport, 'fund_cash_on_bank');
  const interestOnBank = sumAllocations(selectedReport, 'fund_interest');
  const cashOnHand = currentBalance - cashOnBank;
  const totalIncome = toMoney(selectedReport?.current_sales) + toMoney(selectedReport?.other_income);
  const profitMargin = getProfitMargin(selectedReport);
  const reportStatus = selectedReport?.status || 'Open';
  const closedMonthCount = reports.filter(hasReportEntries).length;
  const remainingMonthCount = Math.max(0, reports.length - closedMonthCount);
  const latestBalanceReport =
    [...reports].reverse().find(hasReportEntries) || reports[reports.length - 1] || null;
  const schoolYearBalance = getCurrentBalance(latestBalanceReport);

  useEffect(() => {
    let cancelled = false;

    async function loadActivity() {
      if (!selectedReport) {
        setTransactions([]);
        setAuditLogs([]);
        return;
      }

      setActivityError('');
      const { startDate, endDate } = getReportDateRange(selectedReport);
      const salesRequest = canAccessFinancialReports
        ? API.getTransactions(startDate, endDate, { limit: 5 })
        : Promise.resolve([]);
      const auditRequest = isAdmin && auditLogsEnabled ? API.getAuditLogs() : Promise.resolve([]);

      const [salesResult, auditResult] = await Promise.allSettled([salesRequest, auditRequest]);
      if (cancelled) return;

      setTransactions(
        salesResult.status === 'fulfilled' && Array.isArray(salesResult.value)
          ? salesResult.value
          : []
      );
      setAuditLogs(
        auditResult.status === 'fulfilled' && Array.isArray(auditResult.value)
          ? auditResult.value
          : []
      );

      const failures = [
        salesResult.status === 'rejected' ? salesResult.reason?.message || 'Sales entries failed.' : null,
        auditResult.status === 'rejected' ? auditResult.reason?.message || 'Financial updates failed.' : null,
      ].filter(Boolean);
      setActivityError(failures.join(' | '));
    }

    loadActivity();

    return () => {
      cancelled = true;
    };
  }, [auditLogsEnabled, canAccessFinancialReports, isAdmin, selectedReport]);

  useEffect(() => {
    let cancelled = false;

    async function loadOperationsData() {
      const shouldLoadSummary = inventoryEnabled || analyticsEnabled || posEnabled || transactionsEnabled;
      const [summaryResult, predictionsResult, topProductsResult] = await Promise.allSettled([
        shouldLoadSummary ? API.getSummary() : Promise.resolve(null),
        demandForecastEnabled ? API.getPredictions() : Promise.resolve({ predictions: [] }),
        analyticsEnabled && posEnabled ? API.getTopProducts({ days: 30, limit: 5 }) : Promise.resolve([]),
      ]);

      if (cancelled) return;

      setOperationsData({
        summary: summaryResult.status === 'fulfilled' ? summaryResult.value : null,
        predictions:
          predictionsResult.status === 'fulfilled'
            ? predictionsResult.value?.predictions || []
            : [],
        topProducts:
          topProductsResult.status === 'fulfilled' && Array.isArray(topProductsResult.value)
            ? topProductsResult.value
            : [],
      });
    }

    loadOperationsData();

    return () => {
      cancelled = true;
    };
  }, [analyticsEnabled, demandForecastEnabled, inventoryEnabled, posEnabled, transactionsEnabled]);

  const isDark = useThemeMode();

  const chartTextColor = isDark ? '#cbd5e1' : '#64748b';
  const chartGridColor = isDark ? 'rgba(51, 65, 85, 0.4)' : 'rgba(226, 232, 240, 0.7)';
  const chartPrimaryColor = isDark ? '#34d399' : '#10b981';
  const chartRoseColor = isDark ? '#fb7185' : '#f43f5e';
  const chartBlueColor = isDark ? '#60a5fa' : '#2563eb';
  const chartBlueSoftColor = isDark ? 'rgba(96, 165, 250, 0.16)' : 'rgba(37, 99, 235, 0.12)';
  const chartNeutralColor = isDark ? '#94a3b8' : '#64748b';
  const chartNeutralSoftColor = isDark ? 'rgba(148, 163, 184, 0.16)' : 'rgba(100, 116, 139, 0.12)';
  const piePalette = isDark
    ? ['#34d399', '#60a5fa', '#fbbf24', '#fb7185', '#a78bfa', '#38bdf8', '#4ade80']
    : ['#10b981', '#2563eb', '#f59e0b', '#f43f5e', '#8b5cf6', '#06b6d4', '#10b981'];
  const commonChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        labels: {
          color: chartTextColor,
          font: { size: 14 },
        },
      },
      tooltip: {
        callbacks: {
          label: (context) => `${context.dataset.label || context.label}: ${formatCurrency(context.parsed.y ?? context.parsed)}`,
        },
      },
    },
    scales: {
      x: {
        ticks: { color: chartTextColor, font: { size: 13 } },
        grid: { color: chartGridColor },
      },
      y: {
        ticks: {
          color: chartTextColor,
          font: { size: 13 },
          callback: (value) => formatCurrency(value).replace('.00', ''),
        },
        grid: { color: chartGridColor },
      },
    },
  };

  const monthLabels = reports.map((report) => report.month_short || report.month_name);
  const salesTrendData = {
    labels: monthLabels,
    datasets: [
      {
        label: 'Sales',
        data: reports.map((report) => toMoney(report.current_sales)),
        backgroundColor: chartPrimaryColor,
        borderRadius: 6,
      },
    ],
  };
  const expensesTrendData = {
    labels: monthLabels,
    datasets: [
      {
        label: 'Expenses',
        data: reports.map((report) => toMoney(report.total_expenses)),
        backgroundColor: chartRoseColor,
        borderRadius: 6,
      },
    ],
  };
  const profitTrendData = {
    labels: monthLabels,
    datasets: [
      {
        label: 'Profit',
        data: reports.map((report) => toMoney(report.net_profit)),
        borderColor: chartBlueColor,
        backgroundColor: chartBlueSoftColor,
        tension: 0.25,
        pointRadius: 4,
      },
    ],
  };
  const balanceTrendData = {
    labels: monthLabels,
    datasets: [
      {
        label: 'Current Balance',
        data: reports.map(getCurrentBalance),
        borderColor: chartNeutralColor,
        backgroundColor: chartNeutralSoftColor,
        tension: 0.25,
        pointRadius: 4,
      },
    ],
  };
  const expenseBreakdown = buildExpenseBreakdown(selectedReport);
  const expenseBreakdownData = {
    labels: expenseBreakdown.map((item) => item.label),
    datasets: [
      {
        data: expenseBreakdown.map((item) => item.value),
        backgroundColor: piePalette,
        borderWidth: 0,
      },
    ],
  };
  const hasExpenseBreakdown = expenseBreakdown.some((item) => item.value > 0);
  const pieOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'bottom',
        labels: {
          color: chartTextColor,
          font: { size: 14 },
          boxWidth: 14,
        },
      },
      tooltip: {
        callbacks: {
          label: (context) => `${context.label}: ${formatCurrency(context.parsed)}`,
        },
      },
    },
  };

  const summaryCards = [
    ['Beginning Cash', formatCurrency(selectedReport?.beginning_cash_on_hand), BanknotesIcon, 'blue'],
    ['Current Sales', formatCurrency(selectedReport?.current_sales), CurrencyDollarIcon, 'green'],
    ['Cost of Sales', formatCurrency(selectedReport?.cost_of_sales), ScaleIcon, 'orange'],
    ['Gross Income', formatCurrency(selectedReport?.gross_income), ChartBarIcon, 'yellow'],
    ['Total Expenses', formatCurrency(selectedReport?.total_expenses), ClipboardDocumentCheckIcon, 'red'],
    ['Net Profit', formatCurrency(selectedReport?.net_profit), ArrowTrendingUpIcon, 'green'],
    ['Current Balance', formatCurrency(currentBalance), BanknotesIcon, 'blue'],
    ['Cash on Hand', formatCurrency(cashOnHand), CurrencyDollarIcon, 'teal'],
    ['Cash on Bank', formatCurrency(cashOnBank), BanknotesIcon, 'purple'],
    ['Other Income', formatCurrency(selectedReport?.other_income), PlusCircleIcon, 'cyan'],
    ['Interest on Bank', formatCurrency(interestOnBank), ScaleIcon, 'indigo'],
  ];

  const comparisonRows = [
    {
      label: 'Sales',
      current: toMoney(selectedReport?.current_sales),
      previous: toMoney(previousReport?.current_sales),
    },
    {
      label: 'Expenses',
      current: toMoney(selectedReport?.total_expenses),
      previous: toMoney(previousReport?.total_expenses),
      inverse: true,
    },
    {
      label: 'Profit',
      current: toMoney(selectedReport?.net_profit),
      previous: toMoney(previousReport?.net_profit),
    },
    {
      label: 'Current Balance',
      current: currentBalance,
      previous: getCurrentBalance(previousReport),
    },
  ].map((row) => ({
    ...row,
    difference: row.current - row.previous,
  }));

  const salesEntries = mapRecentTransactions(transactions).map((transaction) => ({
    id: transaction.id,
    title: transaction.id,
    detail: `${transaction.date} - ${transaction.label}`,
    value: formatCurrency(transaction.amount),
  }));
  const expenseEntries = buildLatestExpenseEntries(reports);
  const reportUpdatesFromAudit = auditLogs
    .filter((entry) => String(entry.action || '').startsWith('FINANCIAL_REPORT'))
    .slice(0, 5)
    .map((entry) => ({
      id: `audit-${entry.id}`,
      title: String(entry.action || '').replaceAll('_', ' '),
      detail: entry.timestamp ? formatPhilippineDateTime(entry.timestamp) : entry.details || 'Financial report',
      value: entry.details || 'Updated',
    }));
  const reportUpdates = reportUpdatesFromAudit.length > 0 ? reportUpdatesFromAudit : buildReportUpdates(reports);
  const closedMonthEntries = buildClosedMonthEntries(reports);
  const operationsCards = [
    inventoryEnabled
      ? {
          title: 'Low Stock Alerts',
          value: formatNumber(operationsData.summary?.low_stock_count || 0),
          detail: 'Inventory',
          route: '/inventory',
        }
      : null,
    analyticsEnabled
      ? {
          title: 'All-Time Revenue',
          value: formatCurrency(operationsData.summary?.total_revenue || 0),
          detail: 'Operations',
          route: '/analytics',
        }
      : null,
    demandForecastEnabled
      ? {
          title: 'Restock Priorities',
          value: formatNumber(operationsData.predictions.length),
          detail: 'Forecast',
          route: '/predictions',
        }
      : null,
  ].filter(Boolean);

  async function handleExportExcel() {
    if (!detail?.school_year?.id || !selectedReport?.id) {
      return;
    }

    setExportingExcel(true);
    try {
      const file = await API.downloadFinancialSchoolYearWorkbook(detail.school_year.id, selectedReport.id);
      if (file?.blob) {
        downloadBlob(file.blob, file.filename);
        window.showToast?.(`Excel report exported for ${selectedMonthLabel}.`, 'success');
      }
    } catch (error) {
      window.showToast?.(error.message || 'Unable to export the Excel report.', 'error');
    } finally {
      setExportingExcel(false);
    }
  }

  function handlePrintPdf() {
    window.print();
  }

  const error = [financialError, activityError].filter(Boolean).join(' | ');

  if (financialLoading && !detail && canAccessFinancialReports) {
    return <DashboardSkeleton />;
  }

  if (!canAccessFinancialReports) {
    return (
      <div className="view-shell custom-scrollbar">
        <div className="view-header">
          <div>
            <h1 className="view-title">Financial Overview Dashboard</h1>
            <p className="view-subtitle">Financial reports are available for administrators and canteen managers.</p>
          </div>
        </div>

        <DismissibleAlert resetKey="financial-access" tone="amber" className="rounded-lg">
          Sign in with an administrator or staff account to view financial reporting data.
        </DismissibleAlert>

        {operationsCards.length > 0 ? (
          <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {operationsCards.map((card) => (
              <button
                key={card.title}
                type="button"
                onClick={() => navigate(card.route)}
                className="panel-card min-h-[130px] text-left transition hover:border-primary"
              >
                <div className="text-base font-semibold text-slate-600 dark:text-slate-300">{card.title}</div>
                <div className="mt-2 text-2xl font-black text-slate-950 dark:text-white">{card.value}</div>
                <div className="mt-2 text-base text-slate-500 dark:text-slate-300">{card.detail}</div>
              </button>
            ))}
          </section>
        ) : null}
      </div>
    );
  }

  if (!selectedReport) {
    return (
      <div className="view-shell custom-scrollbar">
        <div className="panel-card flex min-h-[320px] flex-col justify-center">
          <h1 className="text-2xl font-black text-slate-950 dark:text-white">Financial Overview Dashboard</h1>
          <p className="mt-3 text-base text-slate-600 dark:text-slate-300">
            No financial school year is available yet.
          </p>
          <button
            type="button"
            onClick={() => navigate('/financial-reports')}
            className="primary-action-button mt-6 w-fit"
          >
            <PlusCircleIcon className="h-5 w-5" />
            Open Financial Report
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="view-shell custom-scrollbar gap-6 sm:gap-8">
      <div className="view-header">
        <div>
          <h1 className="view-title">Financial Overview Dashboard</h1>
          <p className="view-subtitle">
            {selectedMonthLabel} | {selectedSchoolYearName}
          </p>
        </div>

        <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 xl:w-auto">
          <label className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-sm transition-all hover:border-slate-400 focus-within:ring-2 focus-within:ring-emerald-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
            <CalendarDaysIcon className="h-4.5 w-4.5 shrink-0 text-slate-400 dark:text-slate-400" />
            <select
              value={selectedSchoolYearId}
              onChange={(event) => setSelectedSchoolYearId(event.target.value)}
              className="min-w-0 flex-1 cursor-pointer bg-white text-xs font-semibold text-slate-700 outline-none dark:bg-slate-800 dark:text-slate-200"
            >
              {schoolYears.map((schoolYear) => (
                <option key={schoolYear.id} value={schoolYear.id} className="bg-white text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                  {schoolYear.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-sm transition-all hover:border-slate-400 focus-within:ring-2 focus-within:ring-emerald-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
            <ClockIcon className="h-4.5 w-4.5 shrink-0 text-slate-400 dark:text-slate-400" />
            <select
              value={selectedReportId}
              onChange={(event) => setSelectedReportId(event.target.value)}
              className="min-w-0 flex-1 cursor-pointer bg-white text-xs font-semibold text-slate-700 outline-none dark:bg-slate-800 dark:text-slate-200"
            >
              {reports.map((report) => (
                <option key={report.id} value={report.id} className="bg-white text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                  {report.month_label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {error ? (
        <DismissibleAlert resetKey={error} tone="amber" className="rounded-xl">
          {error}
        </DismissibleAlert>
      ) : null}

      {/* KPI Cards */}
      <section className="grid grid-cols-1 gap-5 md:grid-cols-3">
        <div className="group flex min-h-[110px] items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Current Month</div>
            <div className="mt-1.5 text-xl font-bold tracking-tight text-slate-900 dark:text-white">{selectedMonthLabel}</div>
          </div>
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 transition-transform duration-200 group-hover:scale-105 dark:bg-emerald-950/60 dark:text-emerald-400">
            <CalendarDaysIcon className="h-5 w-5" />
          </span>
        </div>
        <div className="group flex min-h-[110px] items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Current School Year</div>
            <div className="mt-1.5 text-xl font-bold tracking-tight text-slate-900 dark:text-white">{selectedSchoolYearName}</div>
          </div>
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-600 transition-transform duration-200 group-hover:scale-105 dark:bg-blue-950/60 dark:text-blue-400">
            <DocumentTextIcon className="h-5 w-5" />
          </span>
        </div>
        <div className="group flex min-h-[110px] items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Report Status</div>
            <div className="mt-1.5 text-xl font-bold tracking-tight text-slate-900 dark:text-white">{reportStatus}</div>
          </div>
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600 transition-transform duration-200 group-hover:scale-105 dark:bg-slate-800 dark:text-slate-300">
            <CheckCircleIcon className="h-5 w-5" />
          </span>
        </div>
      </section>

      {/* Summary Cards */}
      <section className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
        {summaryCards.map(([title, value, icon, tone]) => (
          <SummaryCard
            key={title}
            title={title}
            value={value}
            detail={selectedMonthLabel}
            icon={icon}
            tone={tone}
          />
        ))}
      </section>

      {/* Monthly Financial Overview */}
      <section className="rounded-xl border border-slate-200/80 bg-white p-6 shadow-xs transition-all duration-200 hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-5 flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100/80 dark:bg-emerald-950/60 dark:text-emerald-400 dark:ring-emerald-900/50">
            <ChartBarIcon className="h-4.5 w-4.5" />
          </span>
          <h2 className="text-base font-bold text-slate-900 dark:text-white">Monthly Financial Overview</h2>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
          <OverviewMetric label="Total Income" value={formatCurrency(totalIncome)} />
          <OverviewMetric label="Total Expenses" value={formatCurrency(selectedReport.total_expenses)} />
          <OverviewMetric label="Net Profit" value={formatCurrency(selectedReport.net_profit)} />
          <OverviewMetric label="Current Balance" value={formatCurrency(currentBalance)} />
          <OverviewMetric label="Profit Margin" value={formatPercent(profitMargin)} />
        </div>
      </section>

      {/* Trend Charts */}
      <section className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <ChartPanel title="Monthly Sales Trend" icon={ChartBarIcon}>
          <Bar data={salesTrendData} options={commonChartOptions} />
        </ChartPanel>
        <ChartPanel title="Monthly Expenses Trend" icon={ChartBarIcon}>
          <Bar data={expensesTrendData} options={commonChartOptions} />
        </ChartPanel>
        <ChartPanel title="Profit Trend" icon={ArrowTrendingUpIcon}>
          <Line data={profitTrendData} options={commonChartOptions} />
        </ChartPanel>
        <ChartPanel title="Current Balance Trend" icon={BanknotesIcon}>
          <Line data={balanceTrendData} options={commonChartOptions} />
        </ChartPanel>
      </section>

      {/* Breakdown & Comparison */}
      <section className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <ChartPanel title="Expense Breakdown" icon={ChartPieIcon}>
          {hasExpenseBreakdown ? (
            <Pie data={expenseBreakdownData} options={pieOptions} />
          ) : (
            <EmptyPanel message="No expenses recorded for this month." />
          )}
        </ChartPanel>

        <section className="rounded-xl border border-slate-200/80 bg-white p-6 shadow-xs transition-all duration-200 hover:shadow-md dark:border-slate-800 dark:bg-slate-900 xl:col-span-2">
          <div className="mb-5 flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100/80 dark:bg-emerald-950/60 dark:text-emerald-400 dark:ring-emerald-900/50">
              <ScaleIcon className="h-4.5 w-4.5" />
            </span>
            <h2 className="text-base font-bold text-slate-900 dark:text-white">Financial Comparison</h2>
          </div>
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-slate-200/80 bg-slate-50/80 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-400">
                <tr>
                  <th className="px-3.5 py-3 font-semibold">Category</th>
                  <th className="px-3.5 py-3 text-right font-semibold">Current Month</th>
                  <th className="px-3.5 py-3 text-right font-semibold">Previous Month</th>
                  <th className="px-3.5 py-3 text-right font-semibold">Difference</th>
                  <th className="px-3.5 py-3 text-center font-semibold">Trend</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {comparisonRows.map((row) => (
                  <tr key={row.label} className="transition-colors hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                    <td className="px-3.5 py-3.5 font-bold text-slate-900 dark:text-white">{row.label}</td>
                    <td className="px-3.5 py-3.5 text-right font-semibold text-slate-700 dark:text-slate-300">
                      {formatCurrency(row.current)}
                    </td>
                    <td className="px-3.5 py-3.5 text-right font-semibold text-slate-700 dark:text-slate-300">
                      {formatCurrency(row.previous)}
                    </td>
                    <td className="px-3.5 py-3.5 text-right font-bold text-slate-900 dark:text-white">
                      {formatCurrency(row.difference)}
                    </td>
                    <td className="px-3.5 py-3.5">
                      <div className="flex justify-center">
                        <ComparisonIndicator value={row.difference} inverse={row.inverse} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </section>

      {/* School Year Summary */}
      <section className="rounded-xl border border-slate-200/80 bg-white p-6 shadow-xs transition-all duration-200 hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-5 flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100/80 dark:bg-emerald-950/60 dark:text-emerald-400 dark:ring-emerald-900/50">
            <CalendarDaysIcon className="h-4.5 w-4.5" />
          </span>
          <h2 className="text-base font-bold text-slate-900 dark:text-white">School Year Summary</h2>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <OverviewMetric label="Current School Year" value={selectedSchoolYearName} />
          <OverviewMetric label="Total Sales" value={formatCurrency(detail?.dashboard?.total_monthly_sales)} />
          <OverviewMetric label="Total Expenses" value={formatCurrency(detail?.dashboard?.total_expenses)} />
          <OverviewMetric label="Total Profit" value={formatCurrency(detail?.dashboard?.net_profit)} />
          <OverviewMetric label="School Year Balance" value={formatCurrency(schoolYearBalance)} />
          <OverviewMetric label="Closed Months" value={formatNumber(closedMonthCount)} />
          <OverviewMetric label="Remaining Months" value={formatNumber(remainingMonthCount)} />
        </div>
      </section>

      {/* Activity Lists */}
      <section className="grid grid-cols-1 gap-5 xl:grid-cols-4">
        <ActivityList
          title="Expense Entries"
          icon={ClipboardDocumentCheckIcon}
          items={expenseEntries}
          emptyMessage="No recent expense entries."
        />
        <ActivityList
          title="Sales Entries"
          icon={ShoppingCartIcon}
          items={salesEntries}
          emptyMessage="No recent sales entries."
        />
        <ActivityList
          title="Report Updates"
          icon={PencilSquareIcon}
          items={reportUpdates}
          emptyMessage="No recent report updates."
        />
        <ActivityList
          title="Monthly Closings"
          icon={CheckCircleIcon}
          items={closedMonthEntries}
          emptyMessage="No monthly closings yet."
        />
      </section>

      {/* Quick Actions & Period */}
      <section className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <section className="rounded-xl border border-slate-200/80 bg-white p-6 shadow-xs transition-all duration-200 hover:shadow-md dark:border-slate-800 dark:bg-slate-900 xl:col-span-2">
          <div className="mb-5 flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100/80 dark:bg-emerald-950/60 dark:text-emerald-400 dark:ring-emerald-900/50">
              <ArrowTopRightOnSquareIcon className="h-4.5 w-4.5" />
            </span>
            <h2 className="text-base font-bold text-slate-900 dark:text-white">Quick Actions</h2>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            <QuickActionButton
              icon={DocumentTextIcon}
              label="Open Financial Report"
              primary
              onClick={() => navigate('/financial-reports')}
            />
            <QuickActionButton icon={PlusCircleIcon} label="Add Expense" onClick={() => navigate('/expenses')} />
            <QuickActionButton
              icon={ShoppingCartIcon}
              label="Record Sales"
              onClick={() => navigate(posEnabled ? '/pos' : '/financial-reports')}
            />
            <QuickActionButton icon={PrinterIcon} label="Export PDF" onClick={handlePrintPdf} />
            <QuickActionButton
              icon={ArrowDownTrayIcon}
              label={exportingExcel ? 'Exporting Excel...' : 'Export Excel'}
              onClick={handleExportExcel}
              disabled={exportingExcel}
            />
            <QuickActionButton
              icon={CheckCircleIcon}
              label="Monthly Closing"
              onClick={() => navigate('/reports')}
            />
          </div>
        </section>

        <section className="rounded-xl border border-slate-200/80 bg-white p-6 shadow-xs transition-all duration-200 hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-5 flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100/80 dark:bg-emerald-950/60 dark:text-emerald-400 dark:ring-emerald-900/50">
              <ClockIcon className="h-4.5 w-4.5" />
            </span>
            <h2 className="text-base font-bold text-slate-900 dark:text-white">Current Period</h2>
          </div>
          <div className="space-y-2.5 text-sm">
            <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200/70 bg-slate-50/60 p-3.5 dark:border-slate-800 dark:bg-slate-800/40">
              <span className="font-semibold text-slate-600 dark:text-slate-400">Month</span>
              <span className="font-bold text-slate-900 dark:text-white">{selectedMonthLabel}</span>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200/70 bg-slate-50/60 p-3.5 dark:border-slate-800 dark:bg-slate-800/40">
              <span className="font-semibold text-slate-600 dark:text-slate-400">School Year</span>
              <span className="font-bold text-slate-900 dark:text-white">{selectedSchoolYearName}</span>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200/70 bg-slate-50/60 p-3.5 dark:border-slate-800 dark:bg-slate-800/40">
              <span className="font-semibold text-slate-600 dark:text-slate-400">Status</span>
              <span className="font-bold text-slate-900 dark:text-white">{reportStatus}</span>
            </div>
          </div>
        </section>
      </section>

      {operationsCards.length > 0 || operationsData.topProducts.length > 0 ? (
        <section className="rounded-xl border border-slate-200/80 bg-white p-6 shadow-xs transition-all duration-200 hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-5 flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100/80 dark:bg-emerald-950/60 dark:text-emerald-400 dark:ring-emerald-900/50">
              <ChartBarIcon className="h-4.5 w-4.5" />
            </span>
            <h2 className="text-base font-bold text-slate-900 dark:text-white">Operations Snapshot</h2>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {operationsCards.map((card) => (
              <button
                key={card.title}
                type="button"
                onClick={() => navigate(card.route)}
                className="rounded-xl border border-slate-200/80 bg-slate-50/60 p-4 text-left transition-all duration-200 hover:border-emerald-300 hover:bg-slate-100/70 dark:border-slate-800 dark:bg-slate-800/40 dark:hover:bg-slate-800"
              >
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{card.title}</div>
                <div className="mt-2 text-2xl font-bold tracking-tight text-slate-900 dark:text-white">{card.value}</div>
                <div className="mt-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">{card.detail}</div>
              </button>
            ))}
          </div>

          {operationsData.topProducts.length > 0 ? (
            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
              {operationsData.topProducts.slice(0, 5).map((product, index) => (
                <button
                  key={product.product_id || product.product_name || index}
                  type="button"
                  onClick={() => navigate('/analytics')}
                  className="rounded-xl border border-slate-200/80 bg-white p-4 text-left shadow-2xs transition-all duration-200 hover:border-emerald-300 hover:shadow-xs dark:border-slate-800 dark:bg-slate-900"
                >
                  <div className="text-xs font-bold text-slate-900 dark:text-white">
                    {product.product_name || `Product ${index + 1}`}
                  </div>
                  <div className="mt-1.5 text-xs font-medium text-slate-500 dark:text-slate-400">
                    {formatNumber(product.total_qty || 0)} sold
                  </div>
                  <div className="mt-2 text-base font-bold text-slate-900 dark:text-white">
                    {formatCurrency(product.revenue || 0)}
                  </div>
                </button>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
