import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { API } from '../services/api';
import {
  BanknotesIcon,
  CalendarDaysIcon,
  CheckIcon,
  CircleStackIcon,
  ExclamationTriangleIcon,
  PencilSquareIcon,
  PlusIcon,
  PrinterIcon,
  ScaleIcon,
  TrashIcon,
  WrenchScrewdriverIcon,
} from '@heroicons/react/24/outline';

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

function formatPercent(value) {
  return `${Number(value || 0).toFixed(2)}%`;
}

function toInputValue(value) {
  const rawValue = value ?? 0;
  const normalized = String(rawValue).trim();
  if (!normalized) {
    return '0';
  }

  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? String(rawValue) : '0';
}

function toMoney(value) {
  const normalized = `${value ?? ''}`.replace(/,/g, '').trim();
  if (!normalized) {
    return 0;
  }

  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : 0;
}

function parseNonNegativeMoney(value) {
  const normalized = `${value ?? ''}`.trim();
  if (!/^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(normalized)) {
    return null;
  }

  const numeric = Number(normalized);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
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

function getPhilippineYearMonth(now = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Manila',
      year: 'numeric',
      month: 'numeric',
    }).formatToParts(now);
    const year = Number(parts.find((part) => part.type === 'year')?.value);
    const month = Number(parts.find((part) => part.type === 'month')?.value);

    if (Number.isFinite(year) && Number.isFinite(month)) {
      return { year, month };
    }
  } catch {
    // Fall back to the browser clock if the timezone formatter is unavailable.
  }

  return {
    year: now.getFullYear(),
    month: now.getMonth() + 1,
  };
}

function buildSchoolYearSuggestion(now = new Date()) {
  const { year, month } = getPhilippineYearMonth(now);
  const startYear = month >= 6 ? year : year - 1;
  return {
    startYear,
    endYear: startYear + 1,
    label: `${startYear}-${startYear + 1}`,
  };
}

const FUTURE_FINANCIAL_REPORT_MESSAGE = 'You cannot add a financial report for a future school year.';
const CURRENT_FINANCIAL_REPORT_MESSAGE = 'Financial reports can only be saved for the current active school year.';

function getSchoolYearBounds(schoolYear) {
  const startYear = Number(schoolYear?.start_year ?? schoolYear?.startYear);
  const rawEndYear = Number(schoolYear?.end_year ?? schoolYear?.endYear);
  const endYear = Number.isFinite(rawEndYear) && rawEndYear > 0 ? rawEndYear : startYear + 1;

  if (!Number.isFinite(startYear) || !Number.isFinite(endYear)) {
    return null;
  }

  return { startYear, endYear };
}

function compareSchoolYears(schoolYear, currentSchoolYear) {
  const selectedBounds = getSchoolYearBounds(schoolYear);
  const currentBounds = getSchoolYearBounds(currentSchoolYear);

  if (!selectedBounds || !currentBounds) {
    return 0;
  }

  if (selectedBounds.startYear !== currentBounds.startYear) {
    return selectedBounds.startYear > currentBounds.startYear ? 1 : -1;
  }

  if (selectedBounds.endYear !== currentBounds.endYear) {
    return selectedBounds.endYear > currentBounds.endYear ? 1 : -1;
  }

  return 0;
}

function isCurrentSchoolYear(schoolYear, currentSchoolYear) {
  return compareSchoolYears(schoolYear, currentSchoolYear) === 0;
}

function getSchoolYearValidationMessage(schoolYear, currentSchoolYear) {
  const comparison = compareSchoolYears(schoolYear, currentSchoolYear);
  if (comparison > 0) {
    return FUTURE_FINANCIAL_REPORT_MESSAGE;
  }
  if (comparison < 0) {
    return CURRENT_FINANCIAL_REPORT_MESSAGE;
  }
  return '';
}

const OPERATION_EXPENSE_FIELDS = [
  {
    key: 'transportation_freight',
    label: 'Transportation/Freight',
    category: 'Transportation/Freight',
  },
  {
    key: 'gas',
    label: 'Gas',
    category: 'Gas',
  },
  {
    key: 'supplies',
    label: 'Supplies',
    category: 'Supplies',
  },
  {
    key: 'helpers',
    label: 'Helpers',
    category: 'Helpers',
  },
  {
    key: 'repair',
    label: 'Repair',
    category: 'Repair',
  },
  {
    key: 'purchase_from_looses_of_tools',
    label: 'Purchase from the looses of tools',
    category: 'Purchase from the looses of tools',
  },
  {
    key: 'other_expenses',
    label: 'Other expenses',
    category: 'Other expenses',
  },
];

const OPERATION_EXPENSE_KEY_BY_CATEGORY = Object.fromEntries(
  OPERATION_EXPENSE_FIELDS.map((field) => [String(field.category || '').trim().toLowerCase(), field.key])
);

function createEmptyOperationExpenseDraft() {
  const draft = {};
  OPERATION_EXPENSE_FIELDS.forEach((field) => {
    draft[field.key] = '';
  });
  return draft;
}

function buildOperationExpenseDraft(report) {
  const draft = createEmptyOperationExpenseDraft();

  (report?.expenses || []).forEach((expense) => {
    const categoryKey = OPERATION_EXPENSE_KEY_BY_CATEGORY[String(expense.category || '').trim().toLowerCase()];
    if (categoryKey) {
      draft[categoryKey] = toInputValue(expense.amount);
    }
  });

  return draft;
}

function sumOperationExpenseDraft(expenseDraft) {
  return OPERATION_EXPENSE_FIELDS.reduce(
    (total, field) => total + toMoney(expenseDraft?.[field.key]),
    0
  );
}

function getPreviousFundBalance(detail, selectedReport, categoryKey, openingBalance = 0) {
  const selectedMonthIndex = Number(selectedReport?.month_index ?? -1);

  return toMoney(openingBalance) + (detail?.reports || [])
    .filter((report) => Number(report.month_index ?? 0) < selectedMonthIndex)
    .reduce((total, report) => {
      const allocation = (report.allocations || []).find((item) => item.category_key === categoryKey);
      return (
        total +
        toMoney(allocation?.fund_interest) +
        toMoney(allocation?.amount) -
        toMoney(allocation?.fund_expenses) -
        toMoney(allocation?.fund_others)
      );
    }, 0);
}

function buildFundMonitoringFunds(
  detail,
  selectedReport,
  allocationDrafts,
  fundInterestDrafts,
  fundExpenseDrafts,
  fundOtherDrafts,
  fundCashOnBankDrafts,
  netProfit
) {
  return (allocationDrafts || []).map((allocation) => {
    const savedAllocation = (selectedReport?.allocations || []).find(
      (item) => item.category_key === allocation.category_key
    );
    const percentage = toMoney(allocation.percentage ?? savedAllocation?.percentage);
    const openingBalance = toMoney(allocation.opening_balance ?? savedAllocation?.opening_balance);
    const previousBalance = getPreviousFundBalance(
      detail,
      selectedReport,
      allocation.category_key,
      openingBalance
    );
    const interest = toMoney(
      fundInterestDrafts?.[allocation.category_key] ?? savedAllocation?.fund_interest
    );
    const netIncome = (toMoney(netProfit) * percentage) / 100;
    const expenses = toMoney(
      fundExpenseDrafts?.[allocation.category_key] ?? savedAllocation?.fund_expenses
    );
    const others = toMoney(
      fundOtherDrafts?.[allocation.category_key] ?? savedAllocation?.fund_others
    );
    const cashOnBank = toMoney(
      fundCashOnBankDrafts?.[allocation.category_key] ?? savedAllocation?.fund_cash_on_bank
    );
    const totalCurrentExpenses = expenses + others;
    const currentBalance = previousBalance + interest + netIncome - totalCurrentExpenses;

    return {
      category_key: allocation.category_key,
      label: allocation.label || savedAllocation?.label || 'Fund',
      percentage,
      openingBalance,
      previousBalance,
      interest,
      netIncome,
      expenses,
      others,
      totalCurrentExpenses,
      currentBalance,
      cashOnBank,
    };
  });
}

const FUND_MONITORING_ROWS = [
  { key: 'previousBalance', label: 'Balance in Previous Month', editableForJuneOpeningBalance: true },
  { key: 'interest', label: 'Interest on the Bank', editableFundInterest: true },
  { key: 'netIncome', label: 'Net Income for the Month' },
  { key: 'expenses', label: 'Expenses for the Month', editableFundExpense: true },
  { key: 'others', label: 'Others', editableFundOther: true },
  { key: 'totalCurrentExpenses', label: 'Total Current Expenses' },
  { key: 'currentBalance', label: 'Current Balance', emphasis: true },
  { key: 'cashOnBank', label: 'Cash on Bank', editableCashOnBank: true, emphasis: true },
];

function formatFundMonitoringValue(row, fund) {
  return row.displayValue ?? formatCurrency(fund[row.key]);
}

function buildPrintableHtml(schoolYearName, report, fundMonitoringFunds = []) {
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

  const fundMonitoringHeader = fundMonitoringFunds
    .map((fund) => `<th style="text-align:right;">${fund.label}<br><span>${formatPercent(fund.percentage)}</span></th>`)
    .join('');
  const fundMonitoringRows = FUND_MONITORING_ROWS.map(
    (row) => `
      <tr>
        <td>${row.label}</td>
        ${fundMonitoringFunds
          .map(
            (fund) => `<td style="text-align:right;${row.emphasis ? ' font-weight:700;' : ''}">${formatFundMonitoringValue(row, fund)}</td>`
          )
          .join('')}
      </tr>
    `
  ).join('');

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
          <h2>Fund Allocation and Bank Monitoring</h2>
          <table>
            <thead><tr><th>Particulars</th>${fundMonitoringHeader}</tr></thead>
            <tbody>${fundMonitoringRows}</tbody>
          </table>
        </div>
      </body>
    </html>
  `;
}

function FormField({
  label,
  value,
  onChange,
  placeholder = '0.00',
  type = 'number',
  disabled = false,
  min,
  step,
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-[11px] font-black uppercase tracking-widest text-slate-500">{label}</span>
      <input
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        disabled={disabled}
        min={min}
        step={step}
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
  const schoolYearSuggestion = useMemo(() => buildSchoolYearSuggestion(), []);
  const [schoolYearsLoading, setSchoolYearsLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [schoolYears, setSchoolYears] = useState([]);
  const [detail, setDetail] = useState(null);
  const [selectedSchoolYearId, setSelectedSchoolYearId] = useState(null);
  const [selectedReportId, setSelectedReportId] = useState(null);
  const selectedSchoolYearIdRef = useRef(null);
  const selectedReportIdRef = useRef(null);
  const [reportDraft, setReportDraft] = useState({
    beginning_cash_on_hand: '',
    current_sales: '',
    cost_of_sales: '',
  });
  const [reportInputOverrides, setReportInputOverrides] = useState({
    beginning_cash_on_hand: false,
    current_sales: false,
  });
  const [expenseDraft, setExpenseDraft] = useState(() => createEmptyOperationExpenseDraft());
  const [fundInterestDrafts, setFundInterestDrafts] = useState({});
  const [fundExpenseDrafts, setFundExpenseDrafts] = useState({});
  const [fundOtherDrafts, setFundOtherDrafts] = useState({});
  const [fundCashOnBankDrafts, setFundCashOnBankDrafts] = useState({});
  const [allocationDrafts, setAllocationDrafts] = useState([]);
  const [exportingWorkbook, setExportingWorkbook] = useState(false);
  const [savingReport, setSavingReport] = useState(false);
  const [savingAllocations, setSavingAllocations] = useState(false);
  const [savingFundMonitoring, setSavingFundMonitoring] = useState(false);
  const [fundMonitoringEditing, setFundMonitoringEditing] = useState(false);
  const [creatingSchoolYear, setCreatingSchoolYear] = useState(false);
  const [deletingSchoolYear, setDeletingSchoolYear] = useState(false);
  const [backingUpDatabase, setBackingUpDatabase] = useState(false);
  const currentSchoolYearLabel = schoolYearSuggestion.label;
  const currentSchoolYearExists = schoolYears.some((schoolYear) =>
    isCurrentSchoolYear(schoolYear, schoolYearSuggestion)
  );

  const selectedReport =
    detail?.reports?.find((report) => report.id === selectedReportId) || detail?.reports?.[0] || null;
  const selectedSchoolYear =
    detail?.school_year ||
    schoolYears.find((schoolYear) => Number(schoolYear.id) === Number(selectedSchoolYearId)) ||
    null;
  const selectedSchoolYearValidationMessage = getSchoolYearValidationMessage(
    selectedSchoolYear,
    schoolYearSuggestion
  );
  const canSaveSelectedSchoolYear = !selectedSchoolYearValidationMessage;
  const isJuneReport = Number(selectedReport?.month_index ?? -1) === 0;
  const allocationPercentTotal = allocationDrafts.reduce(
    (total, allocation) => total + toMoney(allocation.percentage),
    0
  );
  const draftOperationExpensesTotal = sumOperationExpenseDraft(expenseDraft);
  const draftGrossIncome = toMoney(reportDraft.current_sales) - toMoney(reportDraft.cost_of_sales);
  const draftNetProfit = draftGrossIncome - draftOperationExpensesTotal;
  const draftEndingCash = toMoney(reportDraft.beginning_cash_on_hand) + draftNetProfit;
  const draftTotalExpenses = toMoney(reportDraft.cost_of_sales) + draftOperationExpensesTotal;
  const draftExpensesExceedSales = draftTotalExpenses > toMoney(reportDraft.current_sales);
  const fundMonitoringFunds = buildFundMonitoringFunds(
    detail,
    selectedReport,
    allocationDrafts,
    fundInterestDrafts,
    fundExpenseDrafts,
    fundOtherDrafts,
    fundCashOnBankDrafts,
    draftNetProfit
  );

  useEffect(() => {
    selectedSchoolYearIdRef.current = selectedSchoolYearId;
  }, [selectedSchoolYearId]);

  useEffect(() => {
    selectedReportIdRef.current = selectedReportId;
  }, [selectedReportId]);

  const loadSchoolYearDetail = useCallback(async (schoolYearId, preferredReportId = null) => {
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
        selectedReportIdRef.current ||
        schoolYearDetail?.reports?.[0]?.id ||
        null;
      setSelectedReportId(nextReportId);
      setSelectedSchoolYearId(schoolYearId);
    } catch (error) {
      window.showToast?.(error.message || 'Unable to load the selected school year.', 'error');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const loadSchoolYears = useCallback(async (preferredSchoolYearId = null) => {
    setSchoolYearsLoading(true);
    try {
      const schoolYearList = await API.getFinancialSchoolYears();
      const normalizedSchoolYears = Array.isArray(schoolYearList) ? schoolYearList : [];
      const findSchoolYearId = (schoolYearId) =>
        normalizedSchoolYears.find((schoolYear) => Number(schoolYear.id) === Number(schoolYearId))?.id || null;
      const currentSchoolYearId =
        normalizedSchoolYears.find((schoolYear) => isCurrentSchoolYear(schoolYear, schoolYearSuggestion))?.id ||
        null;
      setSchoolYears(normalizedSchoolYears);

      const nextSchoolYearId =
        findSchoolYearId(preferredSchoolYearId) ||
        findSchoolYearId(selectedSchoolYearIdRef.current) ||
        currentSchoolYearId ||
        normalizedSchoolYears.find((schoolYear) => schoolYear.is_active)?.id ||
        normalizedSchoolYears[0]?.id ||
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
  }, [loadSchoolYearDetail, schoolYearSuggestion]);

  useEffect(() => {
    loadSchoolYears();
  }, [loadSchoolYears]);

  useEffect(() => {
    setFundMonitoringEditing(false);
  }, [selectedReportId]);

  useEffect(() => {
    if (!selectedReport) {
      return;
    }

    setReportDraft({
      beginning_cash_on_hand: toInputValue(selectedReport.default_inputs?.beginning_cash_on_hand),
      current_sales: toInputValue(selectedReport.default_inputs?.current_sales),
      cost_of_sales: toInputValue(selectedReport.default_inputs?.cost_of_sales),
    });
    setReportInputOverrides({
      beginning_cash_on_hand: Boolean(selectedReport.beginning_cash_manual_override),
      current_sales: Boolean(selectedReport.current_sales_manual_override),
    });
    setExpenseDraft(buildOperationExpenseDraft(selectedReport));
    setFundInterestDrafts(
      Object.fromEntries(
        (selectedReport.allocations || []).map((allocation) => [
          allocation.category_key,
          toInputValue(allocation.fund_interest),
        ])
      )
    );
    setFundExpenseDrafts(
      Object.fromEntries(
        (selectedReport.allocations || []).map((allocation) => [
          allocation.category_key,
          toInputValue(allocation.fund_expenses),
        ])
      )
    );
    setFundOtherDrafts(
      Object.fromEntries(
        (selectedReport.allocations || []).map((allocation) => [
          allocation.category_key,
          toInputValue(allocation.fund_others),
        ])
      )
    );
    setFundCashOnBankDrafts(
      Object.fromEntries(
        (selectedReport.allocations || []).map((allocation) => [
          allocation.category_key,
          toInputValue(allocation.fund_cash_on_bank),
        ])
      )
    );
  }, [selectedReport]);

  useEffect(() => {
    setAllocationDrafts(
      (detail?.allocations || []).map((allocation, index) => ({
        id: allocation.id,
        category_key: allocation.category_key,
        label: allocation.label,
        percentage: toInputValue(allocation.percentage),
        opening_balance: toInputValue(allocation.opening_balance),
        sort_order: allocation.sort_order ?? index,
      }))
    );
  }, [detail]);

  async function handleDeleteSchoolYear() {
    if (!selectedSchoolYearId || !isAdmin) {
      return;
    }

    const selectedSchoolYearName =
      detail?.school_year?.name ||
      schoolYears.find((schoolYear) => Number(schoolYear.id) === Number(selectedSchoolYearId))?.name ||
      'the selected school year';

    const confirmed = window.confirm(
      `Remove school year ${selectedSchoolYearName}? This will delete its monthly reports, expenses, fund monitoring entries, and allocations.`
    );
    if (!confirmed) {
      return;
    }

    setDeletingSchoolYear(true);
    try {
      const response = await API.deleteFinancialSchoolYear(selectedSchoolYearId);
      window.showToast?.(response?.message || `School year ${selectedSchoolYearName} removed.`, 'success');
      setSelectedSchoolYearId(null);
      setSelectedReportId(null);
      setDetail(null);
      await loadSchoolYears(response?.active_school_year_id || null);
    } catch (error) {
      window.showToast?.(error.message || 'Unable to remove the school year.', 'error');
    } finally {
      setDeletingSchoolYear(false);
    }
  }

  async function handleCreateSchoolYear() {
    if (!isAdmin) {
      return;
    }
    if (currentSchoolYearExists) {
      window.showToast?.(`School year ${currentSchoolYearLabel} already exists.`, 'warning');
      return;
    }

    const startYear = schoolYearSuggestion.startYear;
    const schoolYearToCreate = {
      start_year: startYear,
      end_year: startYear + 1,
    };
    const validationMessage = getSchoolYearValidationMessage(schoolYearToCreate, schoolYearSuggestion);
    if (validationMessage) {
      window.showToast?.(validationMessage, 'error');
      return;
    }

    setCreatingSchoolYear(true);
    try {
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

  async function handleBackupDatabase() {
    if (!isAdmin) {
      return;
    }

    setBackingUpDatabase(true);
    try {
      const response = await API.backupFinancialDatabase();
      window.showToast?.(
        response?.filename
          ? `Backup created: ${response.filename}`
          : response?.message || 'Database backup created.',
        'success'
      );
    } catch (error) {
      window.showToast?.(error.message || 'Unable to create a database backup.', 'error');
    } finally {
      setBackingUpDatabase(false);
    }
  }

  async function handleExportWorkbook() {
    if (!selectedSchoolYearId) {
      return;
    }

    setExportingWorkbook(true);
    try {
      const file = await API.downloadFinancialSchoolYearWorkbook(selectedSchoolYearId, selectedReportId);
      if (file?.blob) {
        downloadBlob(file.blob, file.filename);
        window.showToast?.(`Excel report exported at ${selectedReport?.month_label || 'the selected month'}.`, 'success');
      }
    } catch (error) {
      window.showToast?.(error.message || 'Unable to export the Excel report.', 'error');
    } finally {
      setExportingWorkbook(false);
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

    printWindow.document.write(buildPrintableHtml(detail.school_year.name, selectedReport, fundMonitoringFunds));
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  }

  async function handleSaveAllocations() {
    if (!detail?.school_year?.id || !isAdmin) {
      return;
    }
    if (!canSaveSelectedSchoolYear) {
      window.showToast?.(selectedSchoolYearValidationMessage, 'error');
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
          opening_balance: toMoney(allocation.opening_balance),
          sort_order: allocation.sort_order ?? index,
        }))
      );
      window.showToast?.('Fund allocations saved.', 'success');
      await loadSchoolYearDetail(detail.school_year.id, selectedReportId);
    } catch (error) {
      window.showToast?.(error.message || 'Unable to save fund allocations.', 'error');
    } finally {
      setSavingAllocations(false);
    }
  }

  async function handleSaveReport() {
    if (!selectedReport?.id) {
      return;
    }
    if (!canSaveSelectedSchoolYear) {
      window.showToast?.(selectedSchoolYearValidationMessage, 'error');
      return;
    }

    const nextBeginningCash = parseNonNegativeMoney(reportDraft.beginning_cash_on_hand);
    if (nextBeginningCash === null) {
      window.showToast?.('Beginning Cash must be a valid non-negative amount with up to two decimal places.', 'error');
      return;
    }

    const nextCurrentSales = parseNonNegativeMoney(reportDraft.current_sales);
    if (nextCurrentSales === null) {
      window.showToast?.('Current Sales must be a valid non-negative amount with up to two decimal places.', 'error');
      return;
    }

    setSavingReport(true);
    try {
      const reportPayload = {
        beginning_cash_on_hand: nextBeginningCash,
        beginning_cash_manual_override: reportInputOverrides.beginning_cash_on_hand,
        current_sales: nextCurrentSales,
        current_sales_manual_override: reportInputOverrides.current_sales,
        other_income: 0,
        purchases: 0,
        inventory_used: 0,
        product_cost: toMoney(reportDraft.cost_of_sales),
      };

      const reportResponse = await API.updateFinancialReport(selectedReport.id, reportPayload);
      const nextExpenses = OPERATION_EXPENSE_FIELDS.map((field, index) => ({
        category: field.category,
        amount: toMoney(expenseDraft[field.key]),
        sort_order: index,
      }));
      const expenseResponse = await API.updateFinancialReportExpenses(
        selectedReport.id,
        nextExpenses
      );
      const nextFundEntries = allocationDrafts.map((allocation) => ({
        category_key: allocation.category_key,
        interest: toMoney(fundInterestDrafts[allocation.category_key]),
        expenses: toMoney(fundExpenseDrafts[allocation.category_key]),
        others: toMoney(fundOtherDrafts[allocation.category_key]),
        cash_on_bank: toMoney(fundCashOnBankDrafts[allocation.category_key]),
      }));
      const fundResponse = await API.updateFinancialFundMonitoring(
        selectedReport.id,
        nextFundEntries
      );
      const savedOffline = [reportResponse, expenseResponse, fundResponse].some(
        (response) => response?.offline_queued
      );

      if (savedOffline) {
        const nextEndingCash = nextBeginningCash + draftNetProfit;
        const nextDetail = {
          ...detail,
          reports: (detail?.reports || []).map((report) => {
            if (report.id !== selectedReport.id) {
              return report;
            }

            return {
              ...report,
              beginning_cash_on_hand: nextBeginningCash,
              beginning_cash_manual_override: reportInputOverrides.beginning_cash_on_hand,
              current_sales: nextCurrentSales,
              current_sales_manual_override: reportInputOverrides.current_sales,
              other_income: 0,
              purchases: 0,
              inventory_used: 0,
              product_cost: toMoney(reportDraft.cost_of_sales),
              cost_of_sales: toMoney(reportDraft.cost_of_sales),
              total_operating_expenses: draftOperationExpensesTotal,
              total_expenses: draftTotalExpenses,
              gross_income: draftGrossIncome,
              net_profit: draftNetProfit,
              ending_cash: nextEndingCash,
              expenses: nextExpenses,
              default_inputs: {
                ...(report.default_inputs || {}),
                beginning_cash_on_hand: nextBeginningCash,
                current_sales: nextCurrentSales,
                cost_of_sales: toMoney(reportDraft.cost_of_sales),
              },
              allocations: (report.allocations || []).map((allocation) => ({
                ...allocation,
                amount:
                  (draftNetProfit * toMoney(allocation.percentage)) / 100,
                fund_interest: toMoney(fundInterestDrafts[allocation.category_key]),
                fund_expenses: toMoney(fundExpenseDrafts[allocation.category_key]),
                fund_others: toMoney(fundOtherDrafts[allocation.category_key]),
                fund_cash_on_bank: toMoney(fundCashOnBankDrafts[allocation.category_key]),
              })),
            };
          }),
        };

        setDetail(nextDetail);
        API.cacheFinancialSchoolYearDetail(selectedSchoolYearId, nextDetail);
        window.showToast?.(
          `${selectedReport.month_label} saved on this device. It will sync when online.`,
          'success'
        );
      } else {
        window.showToast?.(`${selectedReport.month_label} saved.`, 'success');
        await loadSchoolYearDetail(selectedSchoolYearId, selectedReport.id);
      }
    } catch (error) {
      window.showToast?.(error.message || 'Unable to save report values.', 'error');
    } finally {
      setSavingReport(false);
    }
  }

  async function handleSaveFundMonitoring() {
    if (!selectedReport?.id) {
      return;
    }
    if (!canSaveSelectedSchoolYear) {
      window.showToast?.(selectedSchoolYearValidationMessage, 'error');
      return;
    }

    setSavingFundMonitoring(true);
    try {
      if (isJuneReport && isAdmin && detail?.school_year?.id) {
        await API.updateFinancialAllocations(
          detail.school_year.id,
          allocationDrafts.map((allocation, index) => ({
            category_key: allocation.category_key,
            label: allocation.label,
            percentage: toMoney(allocation.percentage),
            opening_balance: toMoney(allocation.opening_balance),
            sort_order: allocation.sort_order ?? index,
          }))
        );
      }

      const nextFundEntries = allocationDrafts.map((allocation) => ({
        category_key: allocation.category_key,
        interest: toMoney(fundInterestDrafts[allocation.category_key]),
        expenses: toMoney(fundExpenseDrafts[allocation.category_key]),
        others: toMoney(fundOtherDrafts[allocation.category_key]),
        cash_on_bank: toMoney(fundCashOnBankDrafts[allocation.category_key]),
      }));
      const fundResponse = await API.updateFinancialFundMonitoring(
        selectedReport.id,
        nextFundEntries
      );

      setFundMonitoringEditing(false);
      if (fundResponse?.offline_queued) {
        const nextDetail = {
          ...detail,
          reports: (detail?.reports || []).map((report) =>
            report.id === selectedReport.id
              ? {
                  ...report,
                  allocations: (report.allocations || []).map((allocation) => ({
                    ...allocation,
                    fund_interest: toMoney(fundInterestDrafts[allocation.category_key]),
                    fund_expenses: toMoney(fundExpenseDrafts[allocation.category_key]),
                    fund_others: toMoney(fundOtherDrafts[allocation.category_key]),
                    fund_cash_on_bank: toMoney(fundCashOnBankDrafts[allocation.category_key]),
                  })),
                }
              : report
          ),
        };

        setDetail(nextDetail);
        API.cacheFinancialSchoolYearDetail(selectedSchoolYearId, nextDetail);
        window.showToast?.(
          'Fund monitoring saved on this device. It will sync when online.',
          'success'
        );
      } else {
        window.showToast?.('Fund monitoring saved.', 'success');
        await loadSchoolYearDetail(selectedSchoolYearId, selectedReport.id);
      }
    } catch (error) {
      window.showToast?.(error.message || 'Unable to save fund monitoring values.', 'error');
    } finally {
      setSavingFundMonitoring(false);
    }
  }

  function updateReportDraft(field, value) {
    setReportDraft((currentDraft) => ({
      ...currentDraft,
      [field]: value,
    }));
  }

  function updateMoneyReportDraft(field, value) {
    if (/^\d*(?:\.\d{0,2})?$/.test(value)) {
      updateReportDraft(field, value);
      if (field === 'beginning_cash_on_hand' || field === 'current_sales') {
        setReportInputOverrides((currentOverrides) => ({
          ...currentOverrides,
          [field]: true,
        }));
      }
    }
  }

  function updateExpenseDraft(field, value) {
    setExpenseDraft((currentDraft) => ({
      ...currentDraft,
      [field]: value,
    }));
  }

  function updateFundInterestDraft(categoryKey, value) {
    setFundInterestDrafts((currentDrafts) => ({
      ...currentDrafts,
      [categoryKey]: value,
    }));
  }

  function updateFundExpenseDraft(categoryKey, value) {
    setFundExpenseDrafts((currentDrafts) => ({
      ...currentDrafts,
      [categoryKey]: value,
    }));
  }

  function updateFundOtherDraft(categoryKey, value) {
    setFundOtherDrafts((currentDrafts) => ({
      ...currentDrafts,
      [categoryKey]: value,
    }));
  }

  function updateFundCashOnBankDraft(categoryKey, value) {
    setFundCashOnBankDrafts((currentDrafts) => ({
      ...currentDrafts,
      [categoryKey]: value,
    }));
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
              Create a school year, choose a month, and enter canteen report values.
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
                {creatingSchoolYear ? 'Creating...' : `Create ${currentSchoolYearLabel}`}
              </button>
            ) : null
          }
        />
      </div>
    );
  }

  return (
    <div className="view-shell overflow-x-hidden pr-0">
      <div className="flex shrink-0 flex-col gap-4">
        <div>
          <div className="view-eyebrow">Financial Reports</div>
          <h1 className="view-title">Monthly Canteen Reporting</h1>
          <p className="view-subtitle">
            Choose a month, enter the canteen report values, then save or export.
          </p>
        </div>

        <div className="panel-card">
          <div className={`grid grid-cols-1 gap-3 md:grid-cols-2 ${isAdmin ? 'xl:grid-cols-[minmax(0,1fr)_170px_160px_170px_160px_150px]' : 'xl:grid-cols-[1fr_170px_160px]'}`}>
            <label className="flex min-w-0 flex-col gap-2">
              <span className="text-[11px] font-black uppercase tracking-widest text-slate-500">School Year</span>
              <select
                value={selectedSchoolYearId || ''}
                onChange={(event) => loadSchoolYearDetail(Number(event.target.value), selectedReportId)}
                className="field-control h-11 w-full"
              >
                {schoolYears.map((schoolYear) => (
                  <option key={schoolYear.id} value={schoolYear.id}>
                    {schoolYear.name}
                  </option>
                ))}
              </select>
            </label>

            {isAdmin ? (
              <button
                type="button"
                onClick={handleCreateSchoolYear}
                disabled={creatingSchoolYear || currentSchoolYearExists}
                className="action-button h-11 w-full self-end whitespace-nowrap"
                title={
                  currentSchoolYearExists
                    ? `School year ${currentSchoolYearLabel} already exists`
                    : `Create ${currentSchoolYearLabel}`
                }
              >
                <PlusIcon className="h-4 w-4" />
                {creatingSchoolYear ? 'Creating...' : currentSchoolYearExists ? 'Current Year Exists' : 'New School Year'}
              </button>
            ) : null}
            <button
              type="button"
              onClick={handleExportWorkbook}
              disabled={exportingWorkbook || !selectedSchoolYearId}
              className="primary-action-button h-11 w-full self-end whitespace-nowrap"
            >
              <BanknotesIcon className="h-4 w-4" />
              {exportingWorkbook ? 'Preparing...' : 'Export Excel'}
            </button>
            <button
              type="button"
              onClick={handlePrintReport}
              className="action-button h-11 w-full self-end whitespace-nowrap"
            >
              <PrinterIcon className="h-4 w-4" />
              Print Report
            </button>
            {isAdmin ? (
              <button
                type="button"
                onClick={handleBackupDatabase}
                disabled={backingUpDatabase}
                className="action-button h-11 w-full self-end whitespace-nowrap"
                title="Create a local database backup"
              >
                <CircleStackIcon className="h-4 w-4" />
                {backingUpDatabase ? 'Backing Up...' : 'Create Backup'}
              </button>
            ) : null}
            {isAdmin ? (
              <button
                type="button"
                onClick={handleDeleteSchoolYear}
                disabled={deletingSchoolYear || detailLoading || !selectedSchoolYearId}
                className="action-button h-11 w-full self-end whitespace-nowrap border-red-200 text-red-700 hover:border-red-300 hover:bg-red-50"
                title="Remove selected school year"
              >
                <TrashIcon className="h-4 w-4" />
                {deletingSchoolYear ? 'Removing...' : 'Remove Year'}
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
          <div className="space-y-4">
            <section className="panel-card">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-black text-slate-900">Select Month</h2>
                  <p className="mt-1 text-sm text-slate-500">{detail.school_year.name}</p>
                </div>
                <div className="flex items-center gap-3 rounded-[14px] border border-primary/15 bg-primary/5 px-3 py-2 text-right">
                  <CalendarDaysIcon className="h-5 w-5 text-primary" />
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">Current Reporting Period</div>
                    <div className="mt-0.5 text-sm font-black text-slate-900">
                      {selectedReport?.month_label || 'Select a month'}
                    </div>
                  </div>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
                {detail.reports.map((report) => (
                  <button
                    key={report.id}
                    type="button"
                    onClick={() => setSelectedReportId(report.id)}
                    className={`rounded-[14px] border px-3 py-2.5 text-left transition ${
                      report.id === selectedReportId
                        ? 'border-primary bg-primary/10 text-slate-950 shadow-sm'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-primary/30 hover:bg-slate-50'
                    }`}
                  >
                    <div className="text-sm font-black">{report.month_name}</div>
                    <div className="mt-0.5 text-xs font-semibold text-slate-500">{report.calendar_year}</div>
                  </button>
                ))}
              </div>
            </section>

            {selectedReport ? (
              <div className="space-y-5">
                {selectedSchoolYearValidationMessage ? (
                  <div className="rounded-[16px] border border-red-200 bg-red-50/80 px-4 py-3 text-red-700 shadow-sm">
                    <div className="flex items-start gap-3">
                      <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0" />
                      <div>
                        <div className="text-sm font-black">School year not available for saving</div>
                        <div className="mt-1 text-sm">{selectedSchoolYearValidationMessage}</div>
                      </div>
                    </div>
                  </div>
                ) : null}

                {draftExpensesExceedSales ? (
                  <div className="rounded-[16px] border border-red-200 bg-red-50/80 px-4 py-3 text-red-700 shadow-sm">
                    <div className="flex items-start gap-3">
                      <ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0" />
                      <div>
                        <div className="text-sm font-black">Expenses exceed sales</div>
                        <div className="mt-1 text-sm">
                          {formatCurrency(draftTotalExpenses)} expenses against {formatCurrency(toMoney(reportDraft.current_sales))} sales.
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}

                <section className="panel-card min-w-0">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h2 className="text-lg font-black text-slate-900">{selectedReport.month_label}</h2>
                      <p className="mt-1 text-sm text-slate-500">Enter the monthly values, then save.</p>
                    </div>
                    <button
                      type="button"
                      onClick={handleSaveReport}
                      disabled={savingReport || !canSaveSelectedSchoolYear}
                      className="primary-action-button"
                    >
                      <ScaleIcon className="h-4 w-4" />
                      {savingReport ? 'Saving...' : 'Save Month'}
                    </button>
                  </div>

                  <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                    {[
                      ['Gross Income', draftGrossIncome],
                      ['Operation Expenses', draftOperationExpensesTotal],
                      ['Net Profit', draftNetProfit],
                      ['Ending Cash', draftEndingCash],
                    ].map(([label, amount]) => (
                      <div key={label} className="rounded-[14px] bg-slate-50 px-4 py-3">
                        <div className="text-[11px] font-black uppercase tracking-widest text-slate-500">{label}</div>
                        <div className="mt-1 text-base font-black text-slate-900">{formatCurrency(amount)}</div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
                    <FormField
                      label="Beginning Cash"
                      value={reportDraft.beginning_cash_on_hand}
                      onChange={(event) => updateMoneyReportDraft('beginning_cash_on_hand', event.target.value)}
                      disabled={!canSaveSelectedSchoolYear}
                      min="0"
                      step="0.01"
                    />
                    <FormField
                      label="Current Sales"
                      value={reportDraft.current_sales}
                      onChange={(event) => updateMoneyReportDraft('current_sales', event.target.value)}
                      disabled={!canSaveSelectedSchoolYear}
                      min="0"
                      step="0.01"
                    />
                    <FormField
                      label="Cost of Sales"
                      value={reportDraft.cost_of_sales}
                      onChange={(event) => updateReportDraft('cost_of_sales', event.target.value)}
                      disabled={!canSaveSelectedSchoolYear}
                    />
                  </div>
                  <div className="mt-6 rounded-[16px] border border-slate-200 bg-slate-50/70 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <h3 className="text-base font-black text-slate-900">Operation Expenses</h3>
                        <p className="mt-1 text-sm text-slate-500">Fill only the rows that apply.</p>
                      </div>
                      <WrenchScrewdriverIcon className="h-5 w-5 text-slate-400" />
                    </div>
                    <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                      {OPERATION_EXPENSE_FIELDS.map((field) => (
                        <FormField
                          key={field.key}
                          label={field.label}
                          value={expenseDraft[field.key]}
                          onChange={(event) => updateExpenseDraft(field.key, event.target.value)}
                          disabled={!canSaveSelectedSchoolYear}
                        />
                      ))}
                    </div>
                  </div>
                </section>

                <section className="panel-card">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h2 className="text-lg font-black text-slate-900">Fund Allocation</h2>
                      <p className="mt-1 text-sm text-slate-500">
                        Total rate: {formatPercent(allocationPercentTotal)}
                      </p>
                    </div>
                    {isAdmin ? (
                      <button
                        type="button"
                        onClick={handleSaveAllocations}
                        disabled={savingAllocations || !canSaveSelectedSchoolYear}
                        className="action-button"
                      >
                        <ScaleIcon className="h-4 w-4" />
                        {savingAllocations ? 'Saving...' : 'Save Allocations'}
                      </button>
                    ) : null}
                  </div>

                  <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {allocationDrafts.map((allocation, index) => {
                      const allocationAmount = selectedReport?.allocations?.find(
                        (item) => item.category_key === allocation.category_key
                      )?.amount;

                      return (
                        <div
                          key={allocation.id || allocation.category_key}
                          className="rounded-[16px] border border-slate-200 bg-slate-50/60 p-3"
                        >
                          <input
                            type="text"
                            value={allocation.label}
                            onChange={(event) => updateAllocationDraft(index, 'label', event.target.value)}
                            disabled={!isAdmin || !canSaveSelectedSchoolYear}
                            className="field-control w-full"
                          />
                          <div className="mt-2 grid grid-cols-[100px_1fr] gap-2">
                            <input
                              type="number"
                              min="0"
                              max="100"
                              step="0.01"
                              value={allocation.percentage}
                              onChange={(event) => updateAllocationDraft(index, 'percentage', event.target.value)}
                              disabled={!isAdmin || !canSaveSelectedSchoolYear}
                              className="field-control w-full"
                              aria-label={`${allocation.label || 'Fund'} allocation percentage`}
                            />
                            <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-right text-sm font-black text-slate-900">
                              {formatCurrency(allocationAmount || 0)}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>

                <section className="panel-card">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h2 className="text-lg font-black text-slate-900">Fund Allocation and Bank Monitoring</h2>
                      <p className="mt-1 text-sm text-slate-500">
                        Current balance = previous balance + interest + net income - expenses - others.
                      </p>
                    </div>
                    <div className="flex w-full shrink-0 flex-wrap items-center gap-2 sm:w-auto">
                      <button
                        type="button"
                        onClick={() => setFundMonitoringEditing(true)}
                        disabled={fundMonitoringEditing || savingFundMonitoring || !canSaveSelectedSchoolYear}
                        className="action-button w-full sm:w-auto"
                      >
                        <PencilSquareIcon className="h-4 w-4" />
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={handleSaveFundMonitoring}
                        disabled={!fundMonitoringEditing || savingFundMonitoring || !canSaveSelectedSchoolYear}
                        className="primary-action-button w-full sm:w-auto"
                      >
                        <CheckIcon className="h-4 w-4" />
                        {savingFundMonitoring ? 'Saving...' : 'Save'}
                      </button>
                    </div>
                  </div>

                  <div className="mt-5 space-y-3 xl:hidden">
                    {fundMonitoringFunds.map((fund) => {
                      const allocationIndex = allocationDrafts.findIndex(
                        (allocation) => allocation.category_key === fund.category_key
                      );

                      return (
                        <div
                          key={`mobile-${fund.category_key}`}
                          className="w-full min-w-0 rounded-[16px] border border-slate-200 bg-white p-4 shadow-sm"
                        >
                          <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
                            <div className="min-w-0">
                              <div className="break-words text-sm font-black leading-5 text-slate-950">
                                {fund.label}
                              </div>
                              <div className="mt-1 text-[11px] font-black uppercase tracking-widest text-slate-500">
                                {formatPercent(fund.percentage)}
                              </div>
                            </div>
                          </div>

                          <div className="divide-y divide-slate-100">
                            {FUND_MONITORING_ROWS.map((row) => {
                              const canEditJuneOpeningBalance =
                                row.editableForJuneOpeningBalance &&
                                isJuneReport &&
                                isAdmin &&
                                fundMonitoringEditing &&
                                allocationIndex >= 0 &&
                                canSaveSelectedSchoolYear;
                              const canEditFundInterest =
                                row.editableFundInterest && fundMonitoringEditing && canSaveSelectedSchoolYear;
                              const canEditFundExpense =
                                row.editableFundExpense && fundMonitoringEditing && canSaveSelectedSchoolYear;
                              const canEditFundOther =
                                row.editableFundOther && fundMonitoringEditing && canSaveSelectedSchoolYear;
                              const canEditCashOnBank =
                                row.editableCashOnBank && fundMonitoringEditing && canSaveSelectedSchoolYear;

                              return (
                                <div key={`${row.key}-mobile-${fund.category_key}`} className="py-3">
                                  <div className="text-[11px] font-black uppercase tracking-widest text-slate-500">
                                    {row.label}
                                  </div>
                                  {canEditJuneOpeningBalance ? (
                                    <input
                                      type="number"
                                      min="0"
                                      step="0.01"
                                      value={allocationDrafts[allocationIndex]?.opening_balance ?? '0'}
                                      onChange={(event) => updateAllocationDraft(allocationIndex, 'opening_balance', event.target.value)}
                                      className="field-control mt-2 h-11 w-full text-right text-base"
                                    />
                                  ) : canEditFundInterest ? (
                                    <input
                                      type="number"
                                      min="0"
                                      step="0.01"
                                      value={fundInterestDrafts[fund.category_key] ?? '0'}
                                      onChange={(event) => updateFundInterestDraft(fund.category_key, event.target.value)}
                                      className="field-control mt-2 h-11 w-full text-right text-base"
                                    />
                                  ) : canEditFundExpense ? (
                                    <input
                                      type="number"
                                      min="0"
                                      step="0.01"
                                      value={fundExpenseDrafts[fund.category_key] ?? '0'}
                                      onChange={(event) => updateFundExpenseDraft(fund.category_key, event.target.value)}
                                      className="field-control mt-2 h-11 w-full text-right text-base"
                                    />
                                  ) : canEditFundOther ? (
                                    <input
                                      type="number"
                                      min="0"
                                      step="0.01"
                                      value={fundOtherDrafts[fund.category_key] ?? '0'}
                                      onChange={(event) => updateFundOtherDraft(fund.category_key, event.target.value)}
                                      className="field-control mt-2 h-11 w-full text-right text-base"
                                    />
                                  ) : canEditCashOnBank ? (
                                    <input
                                      type="number"
                                      min="0"
                                      step="0.01"
                                      value={fundCashOnBankDrafts[fund.category_key] ?? '0'}
                                      onChange={(event) => updateFundCashOnBankDraft(fund.category_key, event.target.value)}
                                      className="field-control mt-2 h-11 w-full text-right text-base"
                                    />
                                  ) : (
                                    <div className={`mt-1 break-words text-right text-base [overflow-wrap:anywhere] ${row.emphasis ? 'font-black text-slate-950' : 'font-bold text-slate-700'}`}>
                                      {formatFundMonitoringValue(row, fund)}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-5 hidden overflow-hidden rounded-[16px] border border-slate-200 bg-white p-2 sm:p-3 xl:block">
                    <table className="w-full table-fixed border-collapse text-left text-[11px] sm:text-xs xl:text-sm">
                      <thead className="bg-slate-50">
                        <tr>
                          <th className="w-[18%] border-b border-r border-slate-200 bg-slate-50 px-3 py-4 text-[10px] font-black uppercase tracking-widest text-slate-500 sm:px-4">
                            Particulars
                          </th>
                          {fundMonitoringFunds.map((fund) => (
                            <th
                              key={fund.category_key}
                              className="border-b border-slate-200 px-2.5 py-4 text-right align-top sm:px-3"
                            >
                              <div className="break-words text-[10px] font-black leading-4 text-slate-900 sm:text-xs xl:text-sm">
                                {fund.label}
                              </div>
                              <div className="mt-1 text-[11px] font-black uppercase tracking-widest text-slate-500">
                                {formatPercent(fund.percentage)}
                              </div>
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 bg-white">
                        {FUND_MONITORING_ROWS.map((row) => (
                          <tr key={row.key}>
                            <td className={`border-r border-slate-200 bg-white px-3 py-4 font-bold leading-4 sm:px-4 ${row.emphasis ? 'text-slate-950' : 'text-slate-600'}`}>
                              {row.label}
                            </td>
                            {fundMonitoringFunds.map((fund) => {
                              const canEditJuneOpeningBalance =
                                row.editableForJuneOpeningBalance &&
                                isJuneReport &&
                                isAdmin &&
                                fundMonitoringEditing &&
                                canSaveSelectedSchoolYear;
                              const canEditFundInterest =
                                row.editableFundInterest && fundMonitoringEditing && canSaveSelectedSchoolYear;
                              const canEditFundExpense =
                                row.editableFundExpense && fundMonitoringEditing && canSaveSelectedSchoolYear;
                              const canEditFundOther =
                                row.editableFundOther && fundMonitoringEditing && canSaveSelectedSchoolYear;
                              const canEditCashOnBank =
                                row.editableCashOnBank && fundMonitoringEditing && canSaveSelectedSchoolYear;

                              return (
                                <td
                                  key={`${row.key}-${fund.category_key}`}
                                  className={`break-words px-2.5 py-4 text-right leading-4 [overflow-wrap:anywhere] sm:px-3 ${row.emphasis ? 'font-black text-slate-950' : 'font-bold text-slate-700'}`}
                                >
                                  {canEditJuneOpeningBalance ? (
                                    <input
                                      type="number"
                                      min="0"
                                      step="0.01"
                                      value={allocationDrafts.find((allocation) => allocation.category_key === fund.category_key)?.opening_balance ?? '0'}
                                      onChange={(event) => {
                                        const allocationIndex = allocationDrafts.findIndex(
                                          (allocation) => allocation.category_key === fund.category_key
                                        );
                                        if (allocationIndex >= 0) {
                                          updateAllocationDraft(allocationIndex, 'opening_balance', event.target.value);
                                        }
                                      }}
                                      className="field-control h-9 w-full min-w-0 px-2 text-right text-[11px] sm:text-xs"
                                    />
                                  ) : canEditFundInterest ? (
                                    <input
                                      type="number"
                                      min="0"
                                      step="0.01"
                                      value={fundInterestDrafts[fund.category_key] ?? '0'}
                                      onChange={(event) => updateFundInterestDraft(fund.category_key, event.target.value)}
                                      className="field-control h-9 w-full min-w-0 px-2 text-right text-[11px] sm:text-xs"
                                    />
                                  ) : canEditFundExpense ? (
                                    <input
                                      type="number"
                                      min="0"
                                      step="0.01"
                                      value={fundExpenseDrafts[fund.category_key] ?? '0'}
                                      onChange={(event) => updateFundExpenseDraft(fund.category_key, event.target.value)}
                                      className="field-control h-9 w-full min-w-0 px-2 text-right text-[11px] sm:text-xs"
                                    />
                                  ) : canEditFundOther ? (
                                    <input
                                      type="number"
                                      min="0"
                                      step="0.01"
                                      value={fundOtherDrafts[fund.category_key] ?? '0'}
                                      onChange={(event) => updateFundOtherDraft(fund.category_key, event.target.value)}
                                      className="field-control h-9 w-full min-w-0 px-2 text-right text-[11px] sm:text-xs"
                                    />
                                  ) : canEditCashOnBank ? (
                                    <input
                                      type="number"
                                      min="0"
                                      step="0.01"
                                      value={fundCashOnBankDrafts[fund.category_key] ?? '0'}
                                      onChange={(event) => updateFundCashOnBankDraft(fund.category_key, event.target.value)}
                                      className="field-control h-9 w-full min-w-0 px-2 text-right text-[11px] sm:text-xs"
                                    />
                                  ) : (
                                    formatFundMonitoringValue(row, fund)
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
