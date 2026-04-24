import { useEffect, useState } from 'react';
import { API } from '../services/api';
import {
  ArrowDownTrayIcon,
  ArrowTrendingDownIcon,
  ArrowTrendingUpIcon,
  BanknotesIcon,
  CalendarDaysIcon,
  ChartBarIcon,
  ExclamationTriangleIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  PresentationChartLineIcon,
  PrinterIcon,
  ScaleIcon,
  WrenchScrewdriverIcon,
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
  Tooltip,
} from 'chart.js';
import { Bar, Line } from 'react-chartjs-2';


ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Tooltip,
  Legend,
  Filler
);

const DEFAULT_EXPENSE_CATEGORIES = [
  'Gas',
  'Supplies',
  'Helper Salary',
  'Repairs',
  'Utilities',
  'Other Expenses',
];

function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem('sc_user') || '{}');
  } catch {
    return {};
  }
}

function formatCurrency(value) {
  return `PHP ${Number(value || 0).toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatSignedCurrency(value) {
  const numeric = Number(value || 0);
  const prefix = numeric > 0 ? '+' : '';
  return `${prefix}${formatCurrency(numeric)}`;
}

function formatPercent(value) {
  return `${Number(value || 0).toFixed(2)}%`;
}

function toInputValue(value) {
  return Number(value || 0) === 0 ? '' : String(value);
}

function toMoney(value) {
  const normalized = `${value ?? ''}`.replace(/,/g, '').trim();
  if (!normalized) {
    return 0;
  }

  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : 0;
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

function buildSchoolYearSuggestion(now = new Date()) {
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const startYear = month >= 6 ? year : year - 1;
  return {
    startYear,
    endYear: startYear + 1,
    label: `${startYear}-${startYear + 1}`,
  };
}

function isProtectedExpenseCategory(category) {
  return DEFAULT_EXPENSE_CATEGORIES.some(
    (defaultCategory) => defaultCategory.toLowerCase() === String(category || '').trim().toLowerCase()
  );
}

function buildPrintableHtml(schoolYearName, report) {
  const expenseRows = report.expenses
    .map(
      (expense) => `
        <tr>
          <td>${expense.category}</td>
          <td style="text-align:right;">${formatCurrency(expense.amount)}</td>
        </tr>
      `
    )
    .join('');

  const allocationRows = report.allocations
    .map(
      (allocation) => `
        <tr>
          <td>${allocation.label}</td>
          <td style="text-align:right;">${formatPercent(allocation.percentage)}</td>
          <td style="text-align:right;">${formatCurrency(allocation.amount)}</td>
        </tr>
      `
    )
    .join('');

  return `
    <html>
      <head>
        <title>${schoolYearName} - ${report.month_label}</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 32px; color: #0f172a; }
          h1, h2 { margin: 0 0 10px; }
          p { margin: 0 0 8px; color: #475569; }
          .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin: 24px 0; }
          .card { border: 1px solid #e2e8f0; border-radius: 16px; padding: 16px; }
          .label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.12em; color: #64748b; font-weight: 700; }
          .value { font-size: 24px; font-weight: 800; margin-top: 6px; }
          table { width: 100%; border-collapse: collapse; margin-top: 14px; }
          th, td { border: 1px solid #e2e8f0; padding: 10px 12px; font-size: 14px; }
          th { background: #f8fafc; text-align: left; }
          .section { margin-top: 24px; }
        </style>
      </head>
      <body>
        <h1>${schoolYearName} Monthly Canteen Report</h1>
        <p>${report.month_label}</p>
        <div class="grid">
          <div class="card"><div class="label">Beginning Cash</div><div class="value">${formatCurrency(report.beginning_cash_on_hand)}</div></div>
          <div class="card"><div class="label">Current Sales</div><div class="value">${formatCurrency(report.current_sales)}</div></div>
          <div class="card"><div class="label">Gross Income</div><div class="value">${formatCurrency(report.gross_income)}</div></div>
          <div class="card"><div class="label">Net Profit</div><div class="value">${formatCurrency(report.net_profit)}</div></div>
        </div>

        <div class="section">
          <h2>Operating Expenses</h2>
          <table>
            <thead><tr><th>Category</th><th>Amount</th></tr></thead>
            <tbody>${expenseRows}</tbody>
          </table>
        </div>

        <div class="section">
          <h2>Fund Allocation</h2>
          <table>
            <thead><tr><th>Fund</th><th>Rate</th><th>Amount</th></tr></thead>
            <tbody>${allocationRows}</tbody>
          </table>
        </div>
      </body>
    </html>
  `;
}

function MetricCard({ title, value, detail, icon: Icon, tone = 'slate' }) {
  const toneClasses = {
    emerald: 'border-emerald-200 bg-emerald-50/80 text-emerald-700',
    blue: 'border-blue-200 bg-blue-50/80 text-blue-700',
    amber: 'border-amber-200 bg-amber-50/80 text-amber-700',
    rose: 'border-rose-200 bg-rose-50/80 text-rose-700',
    slate: 'border-slate-200 bg-white text-slate-700',
  };

  return (
    <div className={`rounded-[20px] border p-5 shadow-sm ${toneClasses[tone] || toneClasses.slate}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[11px] font-black uppercase tracking-widest">{title}</div>
          <div className="mt-2 text-2xl font-black text-slate-950">{value}</div>
          <div className="mt-2 text-sm text-slate-600">{detail}</div>
        </div>
        <div className="rounded-2xl bg-white/80 p-3 shadow-sm">
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

function FormField({ label, value, onChange, placeholder = '0.00', type = 'number', disabled = false }) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-[11px] font-black uppercase tracking-widest text-slate-500">{label}</span>
      <input
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        disabled={disabled}
        className="field-control"
      />
    </label>
  );
}

function EmptyState({ title, description, action }) {
  return (
    <div className="panel-card flex min-h-[280px] flex-col items-center justify-center text-center">
      <div className="max-w-lg">
        <div className="text-xl font-black text-slate-900">{title}</div>
        <div className="mt-3 text-sm leading-6 text-slate-500">{description}</div>
        {action ? <div className="mt-6">{action}</div> : null}
      </div>
    </div>
  );
}

export default function FinancialReports() {
  const user = getStoredUser();
  const isAdmin = user.role === 'admin';
  const schoolYearSuggestion = buildSchoolYearSuggestion();
  const [schoolYearsLoading, setSchoolYearsLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [schoolYears, setSchoolYears] = useState([]);
  const [detail, setDetail] = useState(null);
  const [selectedSchoolYearId, setSelectedSchoolYearId] = useState(null);
  const [selectedReportId, setSelectedReportId] = useState(null);
  const [reportDraft, setReportDraft] = useState({
    beginning_cash_on_hand: '',
    current_sales: '',
    other_income: '',
    purchases: '',
    inventory_used: '',
    product_cost: '',
    notes: '',
  });
  const [expenseDrafts, setExpenseDrafts] = useState([]);
  const [allocationDrafts, setAllocationDrafts] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [createStartYear, setCreateStartYear] = useState(String(schoolYearSuggestion.startYear));
  const [downloadingTemplate, setDownloadingTemplate] = useState(false);
  const [savingReport, setSavingReport] = useState(false);
  const [savingExpenses, setSavingExpenses] = useState(false);
  const [savingAllocations, setSavingAllocations] = useState(false);
  const [creatingSchoolYear, setCreatingSchoolYear] = useState(false);
  const [backingUpDatabase, setBackingUpDatabase] = useState(false);

  const selectedReport =
    detail?.reports?.find((report) => report.id === selectedReportId) || detail?.reports?.[0] || null;
  const dashboard = detail?.dashboard || {};
  const filteredReports = (detail?.reports || []).filter((report) => {
    const haystack = `${report.month_label} ${report.month_name} ${detail?.school_year?.name || ''}`.toLowerCase();
    return haystack.includes(searchTerm.trim().toLowerCase());
  });
  const allocationPercentTotal = allocationDrafts.reduce(
    (total, allocation) => total + toMoney(allocation.percentage),
    0
  );

  useEffect(() => {
    loadSchoolYears();
  }, []);

  useEffect(() => {
    if (!selectedReport) {
      return;
    }

    setReportDraft({
      beginning_cash_on_hand: toInputValue(selectedReport.beginning_cash_on_hand),
      current_sales: toInputValue(selectedReport.current_sales),
      other_income: toInputValue(selectedReport.other_income),
      purchases: toInputValue(selectedReport.purchases),
      inventory_used: toInputValue(selectedReport.inventory_used),
      product_cost: toInputValue(selectedReport.product_cost),
      notes: selectedReport.notes || '',
    });
    setExpenseDrafts(
      (selectedReport.expenses || []).map((expense, index) => ({
        id: expense.id,
        category: expense.category,
        amount: toInputValue(expense.amount),
        sort_order: expense.sort_order ?? index,
      }))
    );
  }, [selectedReportId, detail]);

  useEffect(() => {
    setAllocationDrafts(
      (detail?.allocations || []).map((allocation, index) => ({
        id: allocation.id,
        category_key: allocation.category_key,
        label: allocation.label,
        percentage: toInputValue(allocation.percentage),
        sort_order: allocation.sort_order ?? index,
      }))
    );
  }, [detail]);

  async function loadSchoolYears(preferredSchoolYearId = null) {
    setSchoolYearsLoading(true);
    try {
      const schoolYearList = await API.getFinancialSchoolYears();
      setSchoolYears(Array.isArray(schoolYearList) ? schoolYearList : []);

      const nextSchoolYearId =
        preferredSchoolYearId ||
        selectedSchoolYearId ||
        schoolYearList?.find((schoolYear) => schoolYear.is_active)?.id ||
        schoolYearList?.[0]?.id ||
        null;

      setSelectedSchoolYearId(nextSchoolYearId);
      if (nextSchoolYearId) {
        await loadSchoolYearDetail(nextSchoolYearId);
      } else {
        setDetail(null);
      }
    } catch (error) {
      window.showToast?.(error.message || 'Unable to load school years.', 'error');
      setDetail(null);
    } finally {
      setSchoolYearsLoading(false);
    }
  }

  async function loadSchoolYearDetail(schoolYearId, preferredReportId = null) {
    if (!schoolYearId) {
      setDetail(null);
      return;
    }

    setDetailLoading(true);
    try {
      const schoolYearDetail = await API.getFinancialSchoolYearDetail(schoolYearId);
      setDetail(schoolYearDetail);
      const nextReportId =
        preferredReportId ||
        selectedReportId ||
        schoolYearDetail?.reports?.[0]?.id ||
        null;
      setSelectedReportId(nextReportId);
      setSelectedSchoolYearId(schoolYearId);
    } catch (error) {
      window.showToast?.(error.message || 'Unable to load the selected school year.', 'error');
    } finally {
      setDetailLoading(false);
    }
  }

  async function handleCreateSchoolYear() {
    setCreatingSchoolYear(true);
    try {
      const startYear = Number(createStartYear || 0);
      const response = await API.createFinancialSchoolYear({
        start_year: startYear,
        end_year: startYear + 1,
        set_active: true,
      });
      window.showToast?.(`School year ${response?.school_year?.name || `${startYear}-${startYear + 1}`} created.`, 'success');
      await loadSchoolYears(response?.school_year?.id || null);
    } catch (error) {
      window.showToast?.(error.message || 'Unable to create the school year.', 'error');
    } finally {
      setCreatingSchoolYear(false);
    }
  }

  async function handleDownloadTemplate() {
    setDownloadingTemplate(true);
    try {
      const file = await API.downloadFinancialReportTemplate();
      if (file?.blob) {
        downloadBlob(file.blob, file.filename);
        window.showToast?.('Exact Excel template downloaded.', 'success');
      }
    } catch (error) {
      window.showToast?.(error.message || 'Unable to download the Excel template.', 'error');
    } finally {
      setDownloadingTemplate(false);
    }
  }

  function handlePrintReport() {
    if (!selectedReport || !detail?.school_year?.name) {
      return;
    }

    const printWindow = window.open('', '_blank', 'width=1100,height=900');
    if (!printWindow) {
      window.showToast?.('Allow pop-ups to print the report.', 'warning');
      return;
    }

    printWindow.document.write(buildPrintableHtml(detail.school_year.name, selectedReport));
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  }

  async function handleSaveReport() {
    if (!selectedReport?.id) {
      return;
    }

    setSavingReport(true);
    try {
      await API.updateFinancialReport(selectedReport.id, {
        beginning_cash_on_hand: toMoney(reportDraft.beginning_cash_on_hand),
        current_sales: toMoney(reportDraft.current_sales),
        other_income: toMoney(reportDraft.other_income),
        purchases: toMoney(reportDraft.purchases),
        inventory_used: toMoney(reportDraft.inventory_used),
        product_cost: toMoney(reportDraft.product_cost),
        notes: reportDraft.notes || '',
      });
      window.showToast?.(`${selectedReport.month_label} saved.`, 'success');
      await loadSchoolYearDetail(selectedSchoolYearId, selectedReport.id);
    } catch (error) {
      window.showToast?.(error.message || 'Unable to save report values.', 'error');
    } finally {
      setSavingReport(false);
    }
  }

  async function handleSaveExpenses() {
    if (!selectedReport?.id) {
      return;
    }

    setSavingExpenses(true);
    try {
      await API.updateFinancialReportExpenses(
        selectedReport.id,
        expenseDrafts.map((expense, index) => ({
          category: expense.category,
          amount: toMoney(expense.amount),
          sort_order: expense.sort_order ?? index,
        }))
      );
      window.showToast?.('Operating expenses updated.', 'success');
      await loadSchoolYearDetail(selectedSchoolYearId, selectedReport.id);
    } catch (error) {
      window.showToast?.(error.message || 'Unable to save expenses.', 'error');
    } finally {
      setSavingExpenses(false);
    }
  }

  async function handleSaveAllocations() {
    if (!detail?.school_year?.id || !isAdmin) {
      return;
    }

    setSavingAllocations(true);
    try {
      await API.updateFinancialAllocations(
        detail.school_year.id,
        allocationDrafts.map((allocation, index) => ({
          category_key: allocation.category_key,
          label: allocation.label,
          percentage: toMoney(allocation.percentage),
          sort_order: allocation.sort_order ?? index,
        }))
      );
      window.showToast?.('Fund allocation percentages updated.', 'success');
      await loadSchoolYearDetail(detail.school_year.id, selectedReportId);
    } catch (error) {
      window.showToast?.(error.message || 'Unable to save allocations.', 'error');
    } finally {
      setSavingAllocations(false);
    }
  }

  async function handleBackupDatabase() {
    setBackingUpDatabase(true);
    try {
      const result = await API.backupFinancialDatabase();
      window.showToast?.(result?.filename || 'Database backup created.', 'success');
    } catch (error) {
      window.showToast?.(error.message || 'Unable to create a backup.', 'error');
    } finally {
      setBackingUpDatabase(false);
    }
  }

  function updateReportDraft(field, value) {
    setReportDraft((currentDraft) => ({
      ...currentDraft,
      [field]: value,
    }));
  }

  function updateExpenseDraft(index, field, value) {
    setExpenseDrafts((currentExpenses) =>
      currentExpenses.map((expense, currentIndex) =>
        currentIndex === index
          ? {
              ...expense,
              [field]: value,
            }
          : expense
      )
    );
  }

  function addExpenseRow() {
    setExpenseDrafts((currentExpenses) => [
      ...currentExpenses,
      {
        category: '',
        amount: '',
        sort_order: currentExpenses.length,
      },
    ]);
  }

  function removeExpenseRow(index) {
    setExpenseDrafts((currentExpenses) => currentExpenses.filter((_, currentIndex) => currentIndex !== index));
  }

  function updateAllocationDraft(index, field, value) {
    setAllocationDrafts((currentAllocations) =>
      currentAllocations.map((allocation, currentIndex) =>
        currentIndex === index
          ? {
              ...allocation,
              [field]: value,
            }
          : allocation
      )
    );
  }

  const barData = {
    labels: (dashboard.monthly_sales_chart || []).map((item) => item.label),
    datasets: [
      {
        label: 'Sales',
        data: (dashboard.monthly_sales_chart || []).map((item) => item.sales),
        backgroundColor: '#8b5cf6',
        borderRadius: 10,
      },
      {
        label: 'Expenses',
        data: (dashboard.monthly_sales_chart || []).map((item) => item.expenses),
        backgroundColor: '#f97316',
        borderRadius: 10,
      },
    ],
  };

  const lineData = {
    labels: (dashboard.monthly_profit_chart || []).map((item) => item.label),
    datasets: [
      {
        label: 'Net Profit',
        data: (dashboard.monthly_profit_chart || []).map((item) => item.net_profit),
        borderColor: '#10b981',
        backgroundColor: 'rgba(16, 185, 129, 0.12)',
        tension: 0.35,
        fill: true,
      },
      {
        label: 'Ending Cash',
        data: (dashboard.monthly_profit_chart || []).map((item) => item.ending_cash),
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59, 130, 246, 0.08)',
        tension: 0.35,
      },
    ],
  };

  if (schoolYearsLoading) {
    return (
      <div className="view-shell">
        <div className="panel-card flex min-h-[260px] items-center justify-center">
          <div className="text-sm font-bold text-slate-500">Loading financial reports...</div>
        </div>
      </div>
    );
  }

  if (!schoolYears.length) {
    return (
      <div className="view-shell">
        <div className="view-header">
          <div>
            <div className="view-eyebrow">Financial Reports</div>
            <h1 className="view-title">Monthly Canteen Reporting</h1>
            <p className="view-subtitle">
              Manage school-year reports from June to May, review performance trends, and download the exact Excel template used by the canteen office.
            </p>
          </div>
        </div>

        <EmptyState
          title="No school year has been created yet"
          description={
            isAdmin
              ? 'Start by creating the current school year. The app will automatically generate the June-to-May monthly report tabs and default fund allocation percentages.'
              : 'An admin needs to create the school year first before staff can enter monthly sales and expense data.'
          }
          action={
            isAdmin ? (
              <button
                type="button"
                onClick={handleCreateSchoolYear}
                disabled={creatingSchoolYear}
                className="primary-action-button"
              >
                <PlusIcon className="h-4 w-4" />
                {creatingSchoolYear ? 'Creating...' : `Create ${createStartYear}-${Number(createStartYear) + 1}`}
              </button>
            ) : null
          }
        />
      </div>
    );
  }

  return (
    <div className="view-shell">
      <div className="view-header">
        <div>
          <div className="view-eyebrow">Financial Reports</div>
          <h1 className="view-title">Monthly Canteen Reporting</h1>
          <p className="view-subtitle">
            Review school-year performance, capture monthly report details, and use the official Excel workbook template for downloads and exports.
          </p>
        </div>

        <div className="flex flex-col gap-3 xl:items-end">
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <label className="flex min-w-[220px] flex-col gap-2">
              <span className="text-[11px] font-black uppercase tracking-widest text-slate-500">School Year</span>
              <select
                value={selectedSchoolYearId || ''}
                onChange={(event) => loadSchoolYearDetail(Number(event.target.value), selectedReportId)}
                className="field-control"
              >
                {schoolYears.map((schoolYear) => (
                  <option key={schoolYear.id} value={schoolYear.id}>
                    {schoolYear.name}
                  </option>
                ))}
              </select>
            </label>

            {isAdmin ? (
              <div className="flex items-end gap-2">
                <label className="flex min-w-[120px] flex-col gap-2">
                  <span className="text-[11px] font-black uppercase tracking-widest text-slate-500">New Start Year</span>
                  <select
                    value={createStartYear}
                    onChange={(event) => setCreateStartYear(event.target.value)}
                    className="field-control"
                  >
                    {Array.from({ length: 8 }, (_, index) => schoolYearSuggestion.startYear + 2 - index).map((year) => (
                      <option key={year} value={year}>
                        {year}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={handleCreateSchoolYear}
                  disabled={creatingSchoolYear}
                  className="action-button"
                >
                  <PlusIcon className="h-4 w-4" />
                  {creatingSchoolYear ? 'Creating...' : 'New School Year'}
                </button>
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleDownloadTemplate}
              disabled={downloadingTemplate}
              className="primary-action-button"
            >
              <ArrowDownTrayIcon className="h-4 w-4" />
              {downloadingTemplate ? 'Downloading...' : 'Download Report'}
            </button>
            <button
              type="button"
              onClick={handleDownloadTemplate}
              disabled={downloadingTemplate}
              className="action-button"
            >
              <BanknotesIcon className="h-4 w-4" />
              {downloadingTemplate ? 'Preparing...' : 'Export Excel'}
            </button>
            <button type="button" onClick={handlePrintReport} className="action-button">
              <PrinterIcon className="h-4 w-4" />
              Print Report
            </button>
            {isAdmin ? (
              <button
                type="button"
                onClick={handleBackupDatabase}
                disabled={backingUpDatabase}
                className="action-button"
              >
                <ArrowDownTrayIcon className="h-4 w-4" />
                {backingUpDatabase ? 'Backing Up...' : 'Backup Database'}
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {detailLoading ? (
        <div className="panel-card flex min-h-[260px] items-center justify-center">
          <div className="text-sm font-bold text-slate-500">Loading {detail?.school_year?.name || 'school year'}...</div>
        </div>
      ) : null}

      {!detailLoading && detail ? (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
            <MetricCard
              title="Total Monthly Sales"
              value={formatCurrency(dashboard.total_monthly_sales)}
              detail={`${detail.school_year.name} sales captured across June to May`}
              icon={BanknotesIcon}
              tone="emerald"
            />
            <MetricCard
              title="Total Expenses"
              value={formatCurrency(dashboard.total_expenses)}
              detail="Cost of sales plus operating expenses"
              icon={WrenchScrewdriverIcon}
              tone="amber"
            />
            <MetricCard
              title="Net Profit"
              value={formatCurrency(dashboard.net_profit)}
              detail="Gross income, other income, and operating costs combined"
              icon={ArrowTrendingUpIcon}
              tone="blue"
            />
            <MetricCard
              title="Best Month"
              value={dashboard.best_month?.label || 'No data yet'}
              detail={
                dashboard.best_month
                  ? `${formatCurrency(dashboard.best_month.net_profit)} net profit`
                  : 'Sales and profit trends will appear once entries are saved'
              }
              icon={PresentationChartLineIcon}
              tone="rose"
            />
            <MetricCard
              title="Lowest Month"
              value={dashboard.lowest_month?.label || 'No data yet'}
              detail={
                dashboard.lowest_month
                  ? `${formatCurrency(dashboard.lowest_month.net_profit)} net profit`
                  : 'The lowest-performing month will be highlighted here'
              }
              icon={ArrowTrendingDownIcon}
              tone="slate"
            />
          </div>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
            <div className="panel-card xl:col-span-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-black text-slate-900">Monthly Sales vs Expenses</h2>
                  <p className="mt-1 text-sm text-slate-500">Bar chart view for the current school year.</p>
                </div>
                <ChartBarIcon className="h-6 w-6 text-slate-400" />
              </div>
              <div className="mt-5 h-[320px]">
                <Bar
                  data={barData}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                      legend: {
                        position: 'bottom',
                      },
                    },
                  }}
                />
              </div>
            </div>

            <div className="panel-card">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-black text-slate-900">Net Profit Trend</h2>
                  <p className="mt-1 text-sm text-slate-500">Line chart for profit and ending cash.</p>
                </div>
                <PresentationChartLineIcon className="h-6 w-6 text-slate-400" />
              </div>
              <div className="mt-5 h-[320px]">
                <Line
                  data={lineData}
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                      legend: {
                        position: 'bottom',
                      },
                    },
                  }}
                />
              </div>
            </div>
          </div>

          <div className="panel-card">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-lg font-black text-slate-900">Monthly Tabs</h2>
                <p className="mt-1 text-sm text-slate-500">Jump between June to May and save figures per month.</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-600">
                {detail.dashboard.warning_count > 0
                  ? `${detail.dashboard.warning_count} month(s) currently have expenses above sales`
                  : 'All months are currently within the expected expense-to-sales range'}
              </div>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-6">
              {detail.reports.map((report) => (
                <button
                  key={report.id}
                  type="button"
                  onClick={() => setSelectedReportId(report.id)}
                  className={`rounded-2xl border px-4 py-3 text-left transition ${
                    report.id === selectedReportId
                      ? 'border-primary bg-primary/10 text-slate-900 shadow-sm'
                      : 'border-slate-200 bg-white hover:border-primary/30 hover:bg-slate-50'
                  }`}
                >
                  <div className="text-sm font-black">{report.month_name}</div>
                  <div className="mt-1 text-xs font-semibold text-slate-500">{report.calendar_year}</div>
                </button>
              ))}
            </div>
          </div>

          {selectedReport ? (
            <>
              {selectedReport.expenses_exceed_sales ? (
                <div className="rounded-[20px] border border-red-200 bg-red-50/80 px-5 py-4 text-red-700 shadow-sm">
                  <div className="flex items-start gap-3">
                    <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0" />
                    <div>
                      <div className="text-sm font-black uppercase tracking-widest">Expenses exceed sales</div>
                      <div className="mt-1 text-sm leading-6">
                        {selectedReport.month_label} currently shows {formatCurrency(selectedReport.total_expenses)} in total expenses against{' '}
                        {formatCurrency(selectedReport.current_sales + selectedReport.other_income)} in sales and other income.
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.35fr_0.85fr]">
                <div className="panel-card">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h2 className="text-lg font-black text-slate-900">{selectedReport.month_label}</h2>
                      <p className="mt-1 text-sm text-slate-500">Sales input and cost-of-sales section for this month.</p>
                    </div>
                    <button
                      type="button"
                      onClick={handleSaveReport}
                      disabled={savingReport}
                      className="primary-action-button"
                    >
                      <ScaleIcon className="h-4 w-4" />
                      {savingReport ? 'Saving...' : 'Save Month'}
                    </button>
                  </div>

                  <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
                    <div className="space-y-4">
                      <div>
                        <div className="text-sm font-black uppercase tracking-widest text-slate-500">Sales Input</div>
                        <div className="mt-4 grid grid-cols-1 gap-4">
                          <FormField
                            label="Beginning Cash on Hand"
                            value={reportDraft.beginning_cash_on_hand}
                            onChange={(event) => updateReportDraft('beginning_cash_on_hand', event.target.value)}
                          />
                          <FormField
                            label="Current Sales"
                            value={reportDraft.current_sales}
                            onChange={(event) => updateReportDraft('current_sales', event.target.value)}
                          />
                          <FormField
                            label="Other Income"
                            value={reportDraft.other_income}
                            onChange={(event) => updateReportDraft('other_income', event.target.value)}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div>
                        <div className="text-sm font-black uppercase tracking-widest text-slate-500">Cost of Sales</div>
                        <div className="mt-4 grid grid-cols-1 gap-4">
                          <FormField
                            label="Purchases"
                            value={reportDraft.purchases}
                            onChange={(event) => updateReportDraft('purchases', event.target.value)}
                          />
                          <FormField
                            label="Inventory Used"
                            value={reportDraft.inventory_used}
                            onChange={(event) => updateReportDraft('inventory_used', event.target.value)}
                          />
                          <FormField
                            label="Product Cost"
                            value={reportDraft.product_cost}
                            onChange={(event) => updateReportDraft('product_cost', event.target.value)}
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="mt-5">
                    <label className="flex flex-col gap-2">
                      <span className="text-[11px] font-black uppercase tracking-widest text-slate-500">Notes</span>
                      <textarea
                        rows={4}
                        value={reportDraft.notes}
                        onChange={(event) => updateReportDraft('notes', event.target.value)}
                        placeholder="Add monthly observations, reminders, or report notes..."
                        className="field-control"
                      />
                    </label>
                  </div>
                </div>

                <div className="panel-card">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-black text-slate-900">Auto Calculations</h2>
                      <p className="mt-1 text-sm text-slate-500">Live numbers from the last saved version of this month.</p>
                    </div>
                    <CalendarDaysIcon className="h-6 w-6 text-slate-400" />
                  </div>

                  <div className="mt-5 space-y-3">
                    {[
                      ['Gross Income', selectedReport.gross_income],
                      ['Net Profit', selectedReport.net_profit],
                      ['Ending Cash', selectedReport.ending_cash],
                      ['Cost of Sales', selectedReport.cost_of_sales],
                      ['Operating Expenses', selectedReport.total_operating_expenses],
                    ].map(([label, amount]) => (
                      <div
                        key={label}
                        className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-3"
                      >
                        <div className="text-sm font-bold text-slate-600">{label}</div>
                        <div className="text-sm font-black text-slate-900">{formatCurrency(amount)}</div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="text-[11px] font-black uppercase tracking-widest text-slate-500">Month Comparison</div>
                    {selectedReport.comparison ? (
                      <div className="mt-3 space-y-3">
                        <div className="text-sm text-slate-500">Compared with {selectedReport.comparison.previous_month_label}</div>
                        <div className="grid grid-cols-1 gap-3">
                          <div className="rounded-2xl bg-emerald-50/80 px-4 py-3 text-emerald-700">
                            <div className="text-[11px] font-black uppercase tracking-widest">Sales Delta</div>
                            <div className="mt-1 text-lg font-black">{formatSignedCurrency(selectedReport.comparison.sales_delta)}</div>
                          </div>
                          <div className="rounded-2xl bg-blue-50/80 px-4 py-3 text-blue-700">
                            <div className="text-[11px] font-black uppercase tracking-widest">Net Profit Delta</div>
                            <div className="mt-1 text-lg font-black">{formatSignedCurrency(selectedReport.comparison.net_profit_delta)}</div>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-3 text-sm text-slate-500">Comparison will appear after at least two months have data.</div>
                    )}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.2fr_0.8fr]">
                <div className="panel-card">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h2 className="text-lg font-black text-slate-900">Operating Expenses</h2>
                      <p className="mt-1 text-sm text-slate-500">Dynamic expense rows for gas, supplies, salary, repairs, utilities, and other monthly costs.</p>
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={addExpenseRow} className="action-button">
                        <PlusIcon className="h-4 w-4" />
                        Add Expense
                      </button>
                      <button
                        type="button"
                        onClick={handleSaveExpenses}
                        disabled={savingExpenses}
                        className="primary-action-button"
                      >
                        <WrenchScrewdriverIcon className="h-4 w-4" />
                        {savingExpenses ? 'Saving...' : 'Save Expenses'}
                      </button>
                    </div>
                  </div>

                  <div className="mt-5 space-y-3">
                    {expenseDrafts.map((expense, index) => (
                      <div key={`${expense.id || 'new'}-${index}`} className="grid grid-cols-1 gap-3 rounded-2xl border border-slate-200 bg-slate-50/60 p-4 md:grid-cols-[1fr_180px_auto]">
                        <input
                          type="text"
                          value={expense.category}
                          onChange={(event) => updateExpenseDraft(index, 'category', event.target.value)}
                          placeholder="Expense category"
                          className="field-control"
                        />
                        <input
                          type="number"
                          value={expense.amount}
                          onChange={(event) => updateExpenseDraft(index, 'amount', event.target.value)}
                          placeholder="0.00"
                          className="field-control"
                        />
                        <button
                          type="button"
                          onClick={() => removeExpenseRow(index)}
                          disabled={isProtectedExpenseCategory(expense.category)}
                          className="action-button"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="panel-card">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-black text-slate-900">Fund Allocation</h2>
                      <p className="mt-1 text-sm text-slate-500">
                        {isAdmin
                          ? 'Admins can edit the percentage split used for net profit allocation.'
                          : 'Staff can review the allocation split configured by admins.'}
                      </p>
                    </div>
                    <ScaleIcon className="h-6 w-6 text-slate-400" />
                  </div>

                  <div
                    className={`mt-4 rounded-2xl border px-4 py-3 text-sm font-semibold ${
                      allocationPercentTotal === 100
                        ? 'border-emerald-200 bg-emerald-50/80 text-emerald-700'
                        : 'border-amber-200 bg-amber-50/80 text-amber-700'
                    }`}
                  >
                    Total allocation rate: {formatPercent(allocationPercentTotal)}
                  </div>

                  <div className="mt-5 space-y-3">
                    {allocationDrafts.map((allocation, index) => (
                      <div key={allocation.id || allocation.category_key} className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
                        <div className="flex flex-col gap-3">
                          <input
                            type="text"
                            value={allocation.label}
                            onChange={(event) => updateAllocationDraft(index, 'label', event.target.value)}
                            disabled={!isAdmin}
                            className="field-control"
                          />
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <input
                              type="number"
                              value={allocation.percentage}
                              onChange={(event) => updateAllocationDraft(index, 'percentage', event.target.value)}
                              disabled={!isAdmin}
                              className="field-control"
                            />
                            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-900">
                              {selectedReport?.allocations?.find((item) => item.category_key === allocation.category_key)?.amount
                                ? formatCurrency(selectedReport.allocations.find((item) => item.category_key === allocation.category_key)?.amount)
                                : formatCurrency(0)}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {isAdmin ? (
                    <button
                      type="button"
                      onClick={handleSaveAllocations}
                      disabled={savingAllocations}
                      className="primary-action-button mt-5 w-full"
                    >
                      <ScaleIcon className="h-4 w-4" />
                      {savingAllocations ? 'Saving...' : 'Save Allocations'}
                    </button>
                  ) : null}
                </div>
              </div>
            </>
          ) : null}

          <div className="panel-card">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-lg font-black text-slate-900">Search Past Reports</h2>
                <p className="mt-1 text-sm text-slate-500">Search the monthly history and jump to the month you want to review.</p>
              </div>
              <label className="relative block w-full max-w-sm">
                <MagnifyingGlassIcon className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Search month or school year"
                  className="field-control pl-10"
                />
              </label>
            </div>

            <div className="mt-5 overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-3">Month</th>
                    <th className="px-4 py-3">Sales</th>
                    <th className="px-4 py-3">Expenses</th>
                    <th className="px-4 py-3">Net Profit</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredReports.map((report) => (
                    <tr key={report.id}>
                      <td className="px-4 py-4">
                        <div className="font-black text-slate-900">{report.month_label}</div>
                        <div className="mt-1 text-xs font-semibold text-slate-500">{detail.school_year.name}</div>
                      </td>
                      <td className="px-4 py-4 font-bold text-slate-700">{formatCurrency(report.current_sales)}</td>
                      <td className="px-4 py-4 font-bold text-slate-700">{formatCurrency(report.total_expenses)}</td>
                      <td className="px-4 py-4 font-black text-slate-900">{formatCurrency(report.net_profit)}</td>
                      <td className="px-4 py-4">
                        <span
                          className={`rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-widest ${
                            report.expenses_exceed_sales
                              ? 'bg-red-100 text-red-700'
                              : 'bg-emerald-100 text-emerald-700'
                          }`}
                        >
                          {report.expenses_exceed_sales ? 'Watchlist' : 'Healthy'}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-right">
                        <button type="button" onClick={() => setSelectedReportId(report.id)} className="action-button">
                          Open
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
