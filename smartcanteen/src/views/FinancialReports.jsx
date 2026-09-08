import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { API } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import DismissibleAlert from '../components/DismissibleAlert';
import ReceiptPreviewModal from '../components/ReceiptPreviewModal';
import {
  validateReceiptFile,
  readFileAsDataUrl,
  sanitizeReceiptFilename,
} from '../services/receiptSanitizer';
import { saveReceipt } from '../services/receiptStorage';
import {
  ArchiveBoxIcon,
  ArrowDownTrayIcon,
  ArrowPathIcon,
  ArrowUpTrayIcon,
  BanknotesIcon,
  CalendarDaysIcon,
  ChartBarIcon,
  ChartPieIcon,
  CheckCircleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClipboardDocumentListIcon,
  ClockIcon,
  DocumentArrowDownIcon,
  DocumentChartBarIcon,
  DocumentTextIcon,
  ExclamationTriangleIcon,
  EyeIcon,
  FunnelIcon,
  LockClosedIcon,
  MagnifyingGlassIcon,
  MinusCircleIcon,
  PencilSquareIcon,
  PhotoIcon,
  PlusIcon,
  PrinterIcon,
  ReceiptPercentIcon,
  ScaleIcon,
  ShieldCheckIcon,
  Squares2X2Icon,
  TableCellsIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';

const PAGE_COPY = {
  financial: {
    eyebrow: 'Finance',
    title: 'Financial Management',
    subtitle: 'Review monthly finances, record daily sales, manage expenses, and monitor fund allocations in one place.',
  },
  'financial-management': {
    eyebrow: 'Finance',
    title: 'Financial Management',
    subtitle: 'Review monthly finances, record daily sales, manage expenses, and monitor fund allocations in one place.',
  },
  sales: {
    eyebrow: 'Finance',
    title: 'Financial Management',
    subtitle: 'Review monthly finances, record daily sales, manage expenses, and monitor fund allocations in one place.',
  },
  expenses: {
    eyebrow: 'Finance',
    title: 'Financial Management',
    subtitle: 'Review monthly finances, record daily sales, manage expenses, and monitor fund allocations in one place.',
  },
  reports: {
    eyebrow: 'Reports',
    title: 'Generate Reports',
    subtitle: 'Preview, print, and export reports without editing financial records.',
  },
  schoolYears: {
    eyebrow: 'School Years',
    title: 'Manage School Years',
    subtitle: 'Create, activate, archive, and review beginning cash balances for each school year.',
  },
};

const OPERATION_EXPENSE_FIELDS = [
  {
    key: 'transportation_freight',
    label: 'Transportation/Freight',
    category: 'Transportation/Freight',
  },
  { key: 'gas', label: 'Gas', category: 'Gas' },
  { key: 'supplies', label: 'Supplies', category: 'Supplies' },
  { key: 'helpers', label: 'Helpers', category: 'Helpers' },
  { key: 'repair', label: 'Repair', category: 'Repair' },
  {
    key: 'purchase_from_looses_of_tools',
    label: 'Purchase from the looses of tools',
    category: 'Purchase from the looses of tools',
  },
  { key: 'other_expenses', label: 'Other expenses', category: 'Other expenses' },
];

const EXPENSE_CATEGORY_OPTIONS = OPERATION_EXPENSE_FIELDS.map((field) => field.category);
const EXPENSE_CATEGORY_THEME_MAP = {
  'Transportation/Freight': {
    bar: 'bg-amber-500',
    badge: 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300',
  },
  Gas: {
    bar: 'bg-rose-500',
    badge: 'bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300',
  },
  Supplies: {
    bar: 'bg-sky-500',
    badge: 'bg-sky-50 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300',
  },
  Helpers: {
    bar: 'bg-violet-500',
    badge: 'bg-violet-50 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300',
  },
  Repair: {
    bar: 'bg-emerald-500',
    badge: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300',
  },
  'Purchase from the looses of tools': {
    bar: 'bg-indigo-500',
    badge: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300',
  },
  'Other expenses': {
    bar: 'bg-slate-500',
    badge: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  },
};

const DEFAULT_EXPENSE_THEME = {
  bar: 'bg-rose-500',
  badge: 'bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300',
};

const EXPENSE_TYPE_OPTIONS = [
  { key: 'daily', label: 'Daily Expense' },
  { key: 'monthly', label: 'Monthly Expense' },
];

const REPORT_TYPES = [
  {
    key: 'monthly',
    label: 'Monthly Report',
    icon: CalendarDaysIcon,
    description: 'One selected month with sales, expenses, cash, and profit.',
  },
  {
    key: 'quarterly',
    label: 'Quarterly Report',
    icon: ChartBarIcon,
    description: 'Three-month grouping for sales and expense review.',
  },
  {
    key: 'annual',
    label: 'Annual Report',
    icon: DocumentChartBarIcon,
    description: 'Full calendar-year style summary from available school-year months.',
  },
  {
    key: 'school-year',
    label: 'School Year Report',
    icon: ClipboardDocumentListIcon,
    description: 'June to May total view for the selected school year.',
  },
  {
    key: 'sales',
    label: 'Sales Report',
    icon: BanknotesIcon,
    description: 'Current sales by month with school-year totals.',
  },
  {
    key: 'expense',
    label: 'Expense Report',
    icon: ReceiptPercentIcon,
    description: 'Operating expense totals and category activity.',
  },
  {
    key: 'cash-flow',
    label: 'Cash Flow Report',
    icon: ScaleIcon,
    description: 'Beginning cash, net profit, and ending balance movement.',
  },
  {
    key: 'profit',
    label: 'Profit Report',
    icon: ChartPieIcon,
    description: 'Gross income, operating expenses, and net profit.',
  },
];

const FUTURE_FINANCIAL_REPORT_MESSAGE = 'You cannot add a financial report for a future school year.';

const EXPENSES_PER_PAGE = 5;
const MAX_PAGE_BUTTONS = 5;

function getPageNumbers(currentPage, totalPages) {
  const visibleCount = Math.min(MAX_PAGE_BUTTONS, totalPages);
  let start = Math.max(1, currentPage - Math.floor(visibleCount / 2));
  const end = Math.min(totalPages, start + visibleCount - 1);
  start = Math.max(1, end - visibleCount + 1);

  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
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
  const normalized = `${value ?? ''}`.replace(/,/g, '').replace(/^PHP\s*/i, '').trim();
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

function parseCurrencyInput(value) {
  return parseNonNegativeMoney(value);
}

function isValidDateString(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}

function isValidMonthString(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}$/.test(value.trim());
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

function getTodayInputValue() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

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
  return '';
}

function getReportMonthValue(report) {
  if (!report?.calendar_year || !report?.month_number) {
    return '';
  }

  return `${report.calendar_year}-${String(report.month_number).padStart(2, '0')}`;
}

function getCurrentReportId(reports = []) {
  const { year, month } = getPhilippineYearMonth();
  return (
    reports.find(
      (report) => Number(report.calendar_year) === year && Number(report.month_number) === month
    )?.id ||
    reports.find((report) => toMoney(report.current_sales) > 0 || toMoney(report.total_expenses) > 0)?.id ||
    reports[0]?.id ||
    null
  );
}

function findReportForDate(detail, dateValue) {
  if (!dateValue) {
    return null;
  }

  const [year, month] = String(dateValue).split('-').map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    return null;
  }

  return (
    (detail?.reports || []).find(
      (report) => Number(report.calendar_year) === year && Number(report.month_number) === month
    ) || null
  );
}

function findReportForMonth(detail, monthValue) {
  if (!monthValue) {
    return null;
  }

  const [year, month] = String(monthValue).split('-').map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    return null;
  }

  return (
    (detail?.reports || []).find(
      (report) => Number(report.calendar_year) === year && Number(report.month_number) === month
    ) || null
  );
}

function appendNoteLine(notes, line) {
  return [String(notes || '').trim(), line].filter(Boolean).join('\n');
}

function cleanNoteValue(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function parseDailySaleNotes(report) {
  return String(report?.notes || '')
    .split(/\r?\n/)
    .map((line, index) => {
      const match = line.match(/^\[Daily Sale\]\s*(\d{4}-\d{2}-\d{2})\s*\|\s*PHP\s*([0-9,.]+)\s*\|\s*(.*)$/i);
      if (!match) {
        return null;
      }

      return {
        id: `sale-${report.id}-${index}`,
        date: match[1],
        amount: toMoney(match[2]),
        remarks: match[3] || 'No remarks',
        monthLabel: report.month_label,
        reportId: report.id,
      };
    })
    .filter(Boolean);
}

function parseExpenseNotes(report) {
  return String(report?.notes || '')
    .split(/\r?\n/)
    .map((line, index) => {
      const typedMatch = line.match(
        /^\[(Daily|Monthly) Expense\]\s*(\d{4}-\d{2}(?:-\d{2})?)\s*\|\s*([^|]+)\|\s*PHP\s*([0-9,.]+)\s*\|\s*Supplier:\s*([^|]*)\|\s*Description:\s*([^|]*)\|\s*Receipt:\s*(.*)$/i
      );
      if (typedMatch) {
        const type = typedMatch[1].toLowerCase();
        return {
          id: `expense-note-${report.id}-${index}`,
          date: typedMatch[2],
          category: cleanNoteValue(typedMatch[3]),
          amount: toMoney(typedMatch[4]),
          supplier: cleanNoteValue(typedMatch[5]) || '-',
          description: cleanNoteValue(typedMatch[6]) || '-',
          receipt: cleanNoteValue(typedMatch[7]) || 'No receipt',
          monthLabel: report.month_label,
          reportId: report.id,
          type,
          typeLabel: type === 'monthly' ? 'Monthly Expense' : 'Daily Expense',
          source: 'Entry',
          rawLine: line,
          noteIndex: index,
        };
      }

      const legacyMatch = line.match(
        /^\[Expense\]\s*(\d{4}-\d{2}-\d{2})\s*\|\s*([^|]+)\|\s*PHP\s*([0-9,.]+)\s*\|\s*Supplier:\s*([^|]*)\|\s*Description:\s*([^|]*)\|\s*Receipt:\s*(.*)$/i
      );
      if (!legacyMatch) {
        return null;
      }

      return {
        id: `expense-note-${report.id}-${index}`,
        date: legacyMatch[1],
        category: cleanNoteValue(legacyMatch[2]),
        amount: toMoney(legacyMatch[3]),
        supplier: cleanNoteValue(legacyMatch[4]) || '-',
        description: cleanNoteValue(legacyMatch[5]) || '-',
        receipt: cleanNoteValue(legacyMatch[6]) || 'No receipt',
        monthLabel: report.month_label,
        reportId: report.id,
        type: 'daily',
        typeLabel: 'Daily Expense',
        source: 'Entry',
        rawLine: line,
        noteIndex: index,
      };
    })
    .filter(Boolean);
}

function buildDailySaleRows(detail) {
  return (detail?.reports || [])
    .flatMap(parseDailySaleNotes)
    .sort((left, right) => right.date.localeCompare(left.date));
}

function buildExpenseHistoryRows(detail) {
  const noteRows = (detail?.reports || []).flatMap(parseExpenseNotes);
  const monthlyRows = (detail?.reports || []).flatMap((report) => {
    const reportNoteCategories = new Set(
      parseExpenseNotes(report).map((n) => String(n.category || '').trim().toLowerCase())
    );
    return (report.expenses || [])
      .filter(
        (expense) =>
          toMoney(expense.amount) > 0 &&
          !reportNoteCategories.has(String(expense.category || '').trim().toLowerCase())
      )
      .map((expense) => ({
        id: `expense-summary-${report.id}-${expense.id || expense.category}`,
        date: getReportMonthValue(report),
        category: expense.category,
        amount: toMoney(expense.amount),
        supplier: '-',
        description: 'Monthly category total',
        receipt: 'No receipt',
        monthLabel: report.month_label,
        reportId: report.id,
        type: 'monthly',
        typeLabel: 'Monthly Total',
        source: 'Monthly total',
        isSummaryOnly: true,
      }));
  });

  return [...noteRows, ...monthlyRows].sort((left, right) => right.date.localeCompare(left.date));
}

function getExpenseSummaryByCategory(report) {
  return (report?.expenses || [])
    .map((expense) => ({
      category: expense.category,
      amount: toMoney(expense.amount),
    }))
    .filter((item) => item.amount > 0)
    .sort((left, right) => right.amount - left.amount);
}

function getSchoolYearOpeningCash(schoolYear, detail) {
  if (detail?.school_year?.id === schoolYear?.id) {
    return toMoney(detail.reports?.[0]?.beginning_cash_on_hand);
  }

  return toMoney(schoolYear?.opening_beginning_cash);
}

function getSchoolYearEndingBalance(schoolYear, detail) {
  if (detail?.school_year?.id === schoolYear?.id) {
    const lastReport = [...(detail.reports || [])].reverse()[0];
    return toMoney(lastReport?.fund_current_balance_total ?? lastReport?.ending_cash);
  }

  return toMoney(schoolYear?.ending_balance);
}

function buildStatementReport(selectedReport, draftBeginningCash, draftCurrentSales, draftCostOfSales) {
  const beginningCash = toMoney(draftBeginningCash);
  const currentSales = toMoney(draftCurrentSales);
  const costOfSales = toMoney(draftCostOfSales ?? selectedReport?.cost_of_sales);
  const operationExpenses = toMoney(selectedReport?.total_operating_expenses);
  const grossIncome = currentSales - costOfSales;
  const netProfit = grossIncome - operationExpenses;
  const currentBalance = beginningCash + netProfit;

  return {
    beginningCash,
    currentSales,
    costOfSales,
    operationExpenses,
    grossIncome,
    netProfit,
    currentBalance,
  };
}

function buildPrintableHtml(schoolYearName, report, statement, allocations = []) {
  const defaultCategories = [
    'Transportation/Freight',
    'Gas',
    'Supplies',
    'Helpers',
    'Repair',
    'Purchase from the looses of tools',
    'Other expenses',
  ];

  const expenseMap = new Map();
  (report.expenses || []).forEach((exp) => {
    expenseMap.set(exp.category, toMoney(exp.amount));
  });

  const expenseRows = defaultCategories
    .map(
      (cat) => `
        <tr>
          <td style="padding-left: 24px; border: 1px solid #334155;">${cat}</td>
          <td style="text-align: right; border: 1px solid #334155; font-family: monospace;">${formatCurrency(expenseMap.get(cat) || 0)}</td>
        </tr>
      `
    )
    .join('');

  // Map 6 standard allocations
  const allocMap = new Map();
  allocations.forEach((a) => {
    if (a.category_key) allocMap.set(a.category_key, a);
  });

  const stdAllocKeys = [
    { key: 'supplementary_feeding', label: 'SUPPLEMENTARY FEEDING 35%', rate: 0.35 },
    { key: 'school_clinic', label: 'SCHOOL CLINIC 5%', rate: 0.05 },
    { key: 'faculty_student_development', label: "FACULTY STUDENTS DEV'T FUND 15%", rate: 0.15 },
    { key: 'school_operating_fund', label: 'SCHOOL OPERATING FUND 25%', rate: 0.25 },
    { key: 'he_instructional_fund', label: 'H.E. INSTRUCTIONAL FUND 10%', rate: 0.10 },
    { key: 'revolving_capital_fund', label: 'REVOLVING CAPITAL FUND 10%', rate: 0.10 },
  ];

  const netProfit = statement.netProfit || 0;

  const prevBalCells = stdAllocKeys.map(k => {
    const item = allocMap.get(k.key);
    const val = item?.opening_balance ?? item?.openingBalance ?? 0;
    return `<td style="text-align: right; border: 1px solid #334155; font-family: monospace;">${formatCurrency(val)}</td>`;
  }).join('');

  const netIncCells = stdAllocKeys.map(k => {
    const item = allocMap.get(k.key);
    const val = item?.amount ?? (netProfit * k.rate);
    return `<td style="text-align: right; border: 1px solid #334155; font-family: monospace;">${formatCurrency(val)}</td>`;
  }).join('');

  const expMonthCells = stdAllocKeys.map(k => {
    const item = allocMap.get(k.key);
    const val = item?.fund_expenses ?? item?.fundExpenses ?? 0;
    return `<td style="text-align: right; border: 1px solid #334155; font-family: monospace;">${formatCurrency(val)}</td>`;
  }).join('');

  const totExpCells = stdAllocKeys.map(k => {
    const item = allocMap.get(k.key);
    const val = (item?.fund_expenses || 0) + (item?.fund_others || 0);
    return `<td style="text-align: right; border: 1px solid #334155; font-family: monospace;">${formatCurrency(val)}</td>`;
  }).join('');

  const currBalCells = stdAllocKeys.map(k => {
    const item = allocMap.get(k.key);
    const prevBal = item?.opening_balance || 0;
    const interest = item?.fund_interest || 0;
    const netInc = item?.amount ?? (netProfit * k.rate);
    const totalExp = (item?.fund_expenses || 0) + (item?.fund_others || 0);
    const curBal = prevBal + interest + netInc - totalExp;
    return `<td style="text-align: right; border: 1px solid #334155; font-family: monospace; font-weight: bold;">${formatCurrency(curBal)}</td>`;
  }).join('');

  const bankCells = stdAllocKeys.map(k => {
    const item = allocMap.get(k.key);
    const val = item?.fund_cash_on_bank ?? item?.fundCashOnBank ?? 0;
    return `<td style="text-align: right; border: 1px solid #334155; font-family: monospace;">${formatCurrency(val)}</td>`;
  }).join('');

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${schoolYearName} - ${report.month_label}</title>
        <style>
          @page {
            size: portrait;
            margin: 10mm 12mm;
          }
          body {
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 16px;
            color: #0f172a;
            background: #fff;
            font-size: 11px;
            line-height: 1.3;
          }
          .header {
            text-align: center;
            position: relative;
            margin-bottom: 16px;
          }
          .header-logo {
            position: absolute;
            left: 20px;
            top: 0;
            width: 75px;
            height: 75px;
            object-fit: contain;
          }
          .header-title-1 { font-size: 12px; font-weight: bold; text-transform: uppercase; margin-bottom: 2px; }
          .header-title-2 { font-size: 13px; font-weight: bold; text-transform: uppercase; margin-bottom: 2px; }
          .header-sub { font-size: 10px; font-weight: bold; color: #334155; margin-bottom: 1px; }
          .report-main-title { font-size: 13px; font-weight: 900; text-transform: uppercase; margin-top: 10px; margin-bottom: 2px; text-decoration: underline; }
          .report-month-title { font-size: 11px; font-weight: bold; margin-bottom: 14px; }
          
          table { width: 100%; border-collapse: collapse; margin-bottom: 14px; font-size: 10.5px; }
          th, td { padding: 4px 6px; }
          .section-heading { font-weight: bold; font-size: 11px; background: #f1f5f9; text-transform: uppercase; }
          
          .border-table th, .border-table td { border: 1px solid #334155; }
          .border-table th { background: #f8fafc; font-weight: bold; text-align: center; font-size: 9.5px; }

          .sig-table { margin-top: 24px; border: none; width: 100%; }
          .sig-table td { border: none; padding: 4px 8px; vertical-align: top; }
          .sig-line { margin-top: 35px; font-weight: bold; text-decoration: underline; font-size: 11px; }
          .sig-role { font-size: 10px; color: #475569; }

          @media print {
            body { padding: 0; }
            .no-print { display: none; }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <img src="/logo.png" alt="Logo" class="header-logo" onerror="this.style.display='none'" />
          <div class="header-title-1">Republic of the Philippines</div>
          <div class="header-title-2">Department of Education</div>
          <div class="header-sub">REGION IV-A CALABARZON</div>
          <div class="header-sub">SCHOOLS DIVISION OFFICE OF LAGUNA</div>
          <div class="header-sub">BAY SUB-OFFICE</div>
          <div class="header-sub" style="font-size: 11px; margin-bottom: 4px;">BAY CENTRAL ELEMENTARY SCHOOL</div>
          <div class="report-main-title">STATEMENT OF MONTHLY CANTEEN OPERATION</div>
          <div class="report-month-title">For the Month of ${report.month_label}</div>
        </div>

        <table class="border-table">
          <tbody>
            <tr>
              <td colspan="2" style="font-weight: bold; background: #f8fafc;">Operating Statement</td>
            </tr>
            <tr>
              <td style="width: 70%;">Cash on Hand from previous net</td>
              <td style="text-align: right; font-family: monospace;">${formatCurrency(statement.beginningCash)}</td>
            </tr>
            <tr>
              <td>Current Sales</td>
              <td style="text-align: right; font-family: monospace;">${formatCurrency(statement.currentSales)}</td>
            </tr>
            <tr>
              <td>Less: Cost of Sales</td>
              <td style="text-align: right; font-family: monospace;">${formatCurrency(statement.costOfSales)}</td>
            </tr>
            <tr style="font-weight: bold; background: #f1f5f9;">
              <td>Gross income of the Operation</td>
              <td style="text-align: right; font-family: monospace;">${formatCurrency(statement.grossIncome)}</td>
            </tr>
            <tr>
              <td colspan="2" style="font-weight: bold; background: #f8fafc;">Less: Operation Expenses</td>
            </tr>
            ${expenseRows}
            <tr style="font-weight: bold;">
              <td>Total Expenses</td>
              <td style="text-align: right; font-family: monospace;">${formatCurrency(statement.operationExpenses)}</td>
            </tr>
            <tr style="font-weight: bold; background: #e2e8f0; font-size: 11.5px;">
              <td>Net Profit</td>
              <td style="text-align: right; font-family: monospace;">${formatCurrency(statement.netProfit)}</td>
            </tr>
            <tr>
              <td colspan="2" style="font-weight: bold; background: #f8fafc;">Additional Income</td>
            </tr>
            <tr>
              <td style="padding-left: 24px;">Catering / Commission / Others</td>
              <td style="text-align: right; font-family: monospace;">₱0.00</td>
            </tr>
            <tr style="font-weight: bold; background: #cbd5e1; font-size: 12px;">
              <td>Over All Net Profit</td>
              <td style="text-align: right; font-family: monospace;">${formatCurrency(statement.netProfit)}</td>
            </tr>
          </tbody>
        </table>

        <div style="font-weight: bold; font-size: 11px; margin-top: 14px; margin-bottom: 6px; text-transform: uppercase;">
          Fund Allocation Monitoring
        </div>
        <table class="border-table">
          <thead>
            <tr>
              <th style="width: 16%;">${stdAllocKeys[0].label}</th>
              <th style="width: 16%;">${stdAllocKeys[1].label}</th>
              <th style="width: 20%;">${stdAllocKeys[2].label}</th>
              <th style="width: 16%;">${stdAllocKeys[3].label}</th>
              <th style="width: 16%;">${stdAllocKeys[4].label}</th>
              <th style="width: 16%;">${stdAllocKeys[5].label}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colspan="6" style="font-weight: bold; background: #f8fafc;">Balance in previous month</td>
            </tr>
            <tr>${prevBalCells}</tr>
            <tr>
              <td colspan="6" style="font-weight: bold; background: #f8fafc;">Interest on the bank</td>
            </tr>
            <tr>
              <td style="text-align: right; font-family: monospace;">₱0.00</td>
              <td style="text-align: right; font-family: monospace;">₱0.00</td>
              <td style="text-align: right; font-family: monospace;">₱0.00</td>
              <td style="text-align: right; font-family: monospace;">₱0.00</td>
              <td style="text-align: right; font-family: monospace;">₱0.00</td>
              <td style="text-align: right; font-family: monospace;">₱0.00</td>
            </tr>
            <tr>
              <td colspan="6" style="font-weight: bold; background: #f8fafc;">Net Income for the Month</td>
            </tr>
            <tr>${netIncCells}</tr>
            <tr>
              <td colspan="6" style="font-weight: bold; background: #f8fafc;">Expenses for the Month</td>
            </tr>
            <tr>${expMonthCells}</tr>
            <tr>
              <td colspan="6" style="font-weight: bold; background: #f8fafc;">Total Current Expenses</td>
            </tr>
            <tr>${totExpCells}</tr>
            <tr style="font-weight: bold; background: #e2e8f0;">
              <td colspan="6" style="font-weight: bold;">Current Balance</td>
            </tr>
            <tr>${currBalCells}</tr>
            <tr>
              <td colspan="6" style="font-weight: bold; background: #f8fafc;">Cash on Bank</td>
            </tr>
            <tr>${bankCells}</tr>
          </tbody>
        </table>

        <table class="sig-table">
          <tr>
            <td style="width: 38%;">
              <div>Prepared by:</div>
              <div class="sig-line">MYRNA A. DE MESA</div>
              <div class="sig-role">Canteen Manager</div>
            </td>
            <td style="width: 34%; text-align: center;">
              <div>Checked by:</div>
              <div class="sig-line">MARICAR A. AFUANG</div>
              <div class="sig-role">School Head</div>
            </td>
            <td style="width: 28%; text-align: right;">
              <div>Audited by:</div>
              <div class="sig-line">KATHLEEN B. HERNANDEZ</div>
              <div class="sig-role">School Canteen Auditor</div>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;
}

function buildGeneratedReportPayload(type, detail, selectedReport) {
  const reports = detail?.reports || [];
  const schoolYearName = detail?.school_year?.name || 'School Year';
  const reportType = REPORT_TYPES.find((item) => item.key === type) || REPORT_TYPES[0];
  const activeReport = selectedReport || reports[0] || {};
  const metrics = [];
  let rows = [];
  let subtitle = schoolYearName;

  if (type === 'monthly') {
    subtitle = `${schoolYearName} / ${activeReport.month_label || 'Selected month'}`;
    metrics.push(
      ['Sales', activeReport.current_sales],
      ['Expenses', activeReport.total_expenses],
      ['Net Profit', activeReport.net_profit],
      ['Ending Balance', activeReport.fund_current_balance_total ?? activeReport.ending_cash]
    );
    rows = [
      ['Beginning Cash', formatCurrency(activeReport.beginning_cash_on_hand)],
      ['Current Sales', formatCurrency(activeReport.current_sales)],
      ['Cost of Sales', formatCurrency(activeReport.cost_of_sales)],
      ['Operation Expenses', formatCurrency(activeReport.total_operating_expenses)],
      ['Gross Income', formatCurrency(activeReport.gross_income)],
      ['Current Balance', formatCurrency(activeReport.fund_current_balance_total ?? activeReport.ending_cash)],
    ];
  } else if (type === 'quarterly') {
    const selectedIndex = Math.max(0, Number(activeReport.month_index || 0));
    const quarterStart = Math.floor(selectedIndex / 3) * 3;
    const quarterReports = reports.slice(quarterStart, quarterStart + 3);
    subtitle = `${schoolYearName} / ${quarterReports[0]?.month_short || 'Quarter'}-${quarterReports.at(-1)?.month_short || ''}`;
    metrics.push(
      ['Quarter Sales', quarterReports.reduce((sum, report) => sum + toMoney(report.current_sales), 0)],
      ['Quarter Expenses', quarterReports.reduce((sum, report) => sum + toMoney(report.total_expenses), 0)],
      ['Quarter Profit', quarterReports.reduce((sum, report) => sum + toMoney(report.net_profit), 0)]
    );
    rows = quarterReports.map((report) => [
      report.month_label,
      formatCurrency(report.current_sales),
      formatCurrency(report.total_expenses),
      formatCurrency(report.net_profit),
    ]);
  } else if (type === 'sales') {
    metrics.push(['Total Sales', reports.reduce((sum, report) => sum + toMoney(report.current_sales), 0)]);
    rows = reports.map((report) => [report.month_label, formatCurrency(report.current_sales)]);
  } else if (type === 'expense') {
    const categoryTotals = new Map();
    reports.forEach((report) => {
      (report.expenses || []).forEach((expense) => {
        categoryTotals.set(
          expense.category,
          toMoney(categoryTotals.get(expense.category)) + toMoney(expense.amount)
        );
      });
    });
    metrics.push(['Total Expenses', reports.reduce((sum, report) => sum + toMoney(report.total_expenses), 0)]);
    rows = [...categoryTotals.entries()]
      .sort((left, right) => right[1] - left[1])
      .map(([category, amount]) => [category, formatCurrency(amount)]);
  } else if (type === 'cash-flow') {
    metrics.push(
      ['Opening Cash', reports[0]?.beginning_cash_on_hand || 0],
      ['Final Balance', reports.at(-1)?.fund_current_balance_total ?? reports.at(-1)?.ending_cash ?? 0]
    );
    rows = reports.map((report) => [
      report.month_label,
      formatCurrency(report.beginning_cash_on_hand),
      formatCurrency(report.net_profit),
      formatCurrency(report.fund_current_balance_total ?? report.ending_cash),
    ]);
  } else if (type === 'profit') {
    metrics.push(
      ['Gross Income', reports.reduce((sum, report) => sum + toMoney(report.gross_income), 0)],
      ['Operation Expenses', reports.reduce((sum, report) => sum + toMoney(report.total_operating_expenses), 0)],
      ['Net Profit', reports.reduce((sum, report) => sum + toMoney(report.net_profit), 0)]
    );
    rows = reports.map((report) => [
      report.month_label,
      formatCurrency(report.gross_income),
      formatCurrency(report.total_operating_expenses),
      formatCurrency(report.net_profit),
    ]);
  } else {
    metrics.push(
      ['Total Sales', reports.reduce((sum, report) => sum + toMoney(report.current_sales), 0)],
      ['Total Expenses', reports.reduce((sum, report) => sum + toMoney(report.total_expenses), 0)],
      ['Net Profit', reports.reduce((sum, report) => sum + toMoney(report.net_profit), 0)],
      ['Ending Balance', reports.at(-1)?.fund_current_balance_total ?? reports.at(-1)?.ending_cash ?? 0]
    );
    rows = reports.map((report) => [
      report.month_label,
      formatCurrency(report.current_sales),
      formatCurrency(report.total_expenses),
      formatCurrency(report.net_profit),
    ]);
  }

  return {
    title: reportType.label,
    subtitle,
    metrics,
    rows,
  };
}

function buildGeneratedReportHtml(payload) {
  const metrics = payload.metrics
    .map(
      ([label, value]) => `
        <div class="card">
          <div class="label">${label}</div>
          <div class="value">${formatCurrency(value)}</div>
        </div>
      `
    )
    .join('');
  const rows = payload.rows
    .map(
      (row) => `
        <tr>
          ${row.map((cell, index) => `<td${index > 0 ? ' style="text-align:right; font-family: monospace;"' : ''}>${cell}</td>`).join('')}
        </tr>
      `
    )
    .join('');

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${payload.title}</title>
        <style>
          @page {
            size: portrait;
            margin: 10mm 12mm;
          }
          body { font-family: Arial, sans-serif; margin: 0; padding: 16px; color: #0f172a; font-size: 11px; }
          .header {
            text-align: center;
            position: relative;
            margin-bottom: 16px;
          }
          .header-logo {
            position: absolute;
            left: 20px;
            top: 0;
            width: 75px;
            height: 75px;
            object-fit: contain;
          }
          .header-title-1 { font-size: 12px; font-weight: bold; text-transform: uppercase; margin-bottom: 2px; }
          .header-title-2 { font-size: 13px; font-weight: bold; text-transform: uppercase; margin-bottom: 2px; }
          .header-sub { font-size: 10px; font-weight: bold; color: #334155; margin-bottom: 1px; }
          .report-main-title { font-size: 13px; font-weight: 900; text-transform: uppercase; margin-top: 10px; margin-bottom: 2px; text-decoration: underline; }
          .report-month-title { font-size: 11px; font-weight: bold; margin-bottom: 14px; }
          
          .grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 20px; }
          .card { border: 1px solid #334155; border-radius: 6px; padding: 10px 12px; background: #f8fafc; }
          .label { color: #475569; font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
          .value { margin-top: 4px; font-size: 18px; font-weight: 800; font-family: monospace; }
          
          table { width: 100%; border-collapse: collapse; margin-top: 10px; }
          td, th { border: 1px solid #334155; padding: 6px 8px; font-size: 11px; }
          th { background: #f1f5f9; font-weight: bold; text-align: left; }

          @media print {
            body { padding: 0; }
            .no-print { display: none; }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <img src="/logo.png" alt="Logo" class="header-logo" onerror="this.style.display='none'" />
          <div class="header-title-1">Republic of the Philippines</div>
          <div class="header-title-2">Department of Education</div>
          <div class="header-sub">REGION IV-A CALABARZON</div>
          <div class="header-sub">SCHOOLS DIVISION OFFICE OF LAGUNA</div>
          <div class="header-sub">BAY SUB-OFFICE</div>
          <div class="header-sub" style="font-size: 11px; margin-bottom: 4px;">BAY CENTRAL ELEMENTARY SCHOOL</div>
          <div class="report-main-title">${payload.title}</div>
          <div class="report-month-title">${payload.subtitle}</div>
        </div>

        <div class="grid">${metrics}</div>
        <table><tbody>${rows}</tbody></table>
      </body>
    </html>
  `;
}

function openPrintableWindow(html, warning = 'Allow pop-ups to print the report.') {
  const printWindow = window.open('', '_blank', 'width=1100,height=900');
  if (!printWindow) {
    window.showToast?.(warning, 'warning');
    return;
  }

  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
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
  children,
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</span>
      {children || (
        <input
          type={type}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          disabled={disabled}
          readOnly={disabled}
          min={min}
          step={step}
          className={`h-11 w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 text-sm font-semibold text-slate-900 shadow-2xs outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white ${
            disabled ? 'cursor-not-allowed border-slate-200 bg-slate-100/80 text-slate-500 focus:outline-none focus:ring-0 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-500' : ''
          }`}
        />
      )}
    </label>
  );
}

function MetricTile({ label, value, tone = 'slate', icon: Icon }) {
  const iconToneStyle = {
    slate: 'border-slate-200/60 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200',
    teal: 'border-sky-100 bg-sky-50 text-sky-600 dark:border-sky-900/60 dark:bg-sky-950/60 dark:text-sky-400',
    emerald: 'border-emerald-100 bg-emerald-50 text-emerald-600 dark:border-emerald-900/60 dark:bg-emerald-950/60 dark:text-emerald-400',
    amber: 'border-amber-100 bg-amber-50 text-amber-600 dark:border-amber-900/60 dark:bg-amber-950/60 dark:text-amber-400',
    rose: 'border-rose-100 bg-rose-50 text-rose-600 dark:border-rose-900/60 dark:bg-rose-950/60 dark:text-rose-400',
    sky: 'border-sky-100 bg-sky-50 text-sky-600 dark:border-sky-900/60 dark:bg-sky-950/60 dark:text-sky-400',
  }[tone] || 'border-slate-200/60 bg-slate-100 text-slate-700';

  const valueColor = {
    emerald: 'text-emerald-700 dark:text-emerald-400',
    rose: 'text-rose-700 dark:text-rose-400',
    amber: 'text-amber-700 dark:text-amber-400',
    sky: 'text-sky-700 dark:text-sky-400',
    teal: 'text-slate-900 dark:text-white',
    slate: 'text-slate-900 dark:text-white',
  }[tone] || 'text-slate-900 dark:text-white';

  return (
    <div className="flex items-start justify-between rounded-2xl border border-slate-200/90 bg-white p-5 shadow-2xs transition-all dark:border-slate-800 dark:bg-slate-900">
      <div className="min-w-0 flex-1">
        <div className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</div>
        <div className={`mt-2 break-words text-2xl font-black tracking-tight ${valueColor}`}>{value}</div>
      </div>
      {Icon ? (
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${iconToneStyle}`}>
          <Icon className="h-5 w-5 stroke-[2]" />
        </div>
      ) : null}
    </div>
  );
}

function EmptyState({ title, description, action }) {
  return (
    <div className="rounded-2xl border border-slate-200/90 bg-white p-12 text-center shadow-2xs dark:border-slate-800 dark:bg-slate-900">
      <div className="mx-auto max-w-lg">
        <div className="text-xl font-black text-slate-900 dark:text-white">{title}</div>
        <div className="mt-3 text-sm leading-6 text-slate-500 dark:text-slate-400">{description}</div>
        {action ? <div className="mt-6">{action}</div> : null}
      </div>
    </div>
  );
}

function PageHeader({ page, actions }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="inline-flex items-center gap-2 rounded-lg border border-emerald-200/60 bg-emerald-50 px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-950/60 dark:text-emerald-300">
          {page.eyebrow}
        </div>
        <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-900 dark:text-white sm:text-3xl">
          {page.title}
        </h1>
        <p className="mt-1 text-sm font-medium text-slate-500 dark:text-slate-400 max-w-3xl">
          {page.subtitle}
        </p>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2.5">{actions}</div> : null}
    </div>
  );
}

function SchoolYearSelect({ schoolYears, selectedSchoolYearId, onChange }) {
  return (
    <FormField label="School Year">
      <select
        value={selectedSchoolYearId || ''}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 text-sm font-bold text-slate-700 shadow-2xs outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
      >
        {schoolYears.map((schoolYear) => (
          <option key={schoolYear.id} value={schoolYear.id}>
            {schoolYear.name}
          </option>
        ))}
      </select>
    </FormField>
  );
}

function MonthSelect({ reports, selectedReportId, onChange, label = 'Current Month' }) {
  return (
    <FormField label={label}>
      <select
        value={selectedReportId || ''}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 text-sm font-bold text-slate-700 shadow-2xs outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
      >
        {(reports || []).map((report) => (
          <option key={report.id} value={report.id}>
            {report.month_label}
          </option>
        ))}
      </select>
    </FormField>
  );
}

function ValidationNotice({ message }) {
  if (!message) {
    return null;
  }

  return (
    <div className="rounded-xl border border-amber-200/80 bg-amber-50 px-4 py-3 text-xs font-bold leading-5 text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/50 dark:text-amber-300">
      {message}
    </div>
  );
}

const FUND_MONITORING_VIEW_KEY = 'sc_fund_monitoring_view_mode';

function ViewToggle({ mode, onChange, options }) {
  return (
    <div className="inline-flex items-center rounded-xl border border-slate-200/90 bg-slate-100/70 p-1 dark:border-slate-800 dark:bg-slate-800/70">
      {options.map((opt) => {
        const Icon = opt.icon;
        const isActive = mode === opt.mode;
        return (
          <button
            key={opt.mode}
            type="button"
            onClick={() => onChange(opt.mode)}
            title={`${opt.label} View`}
            aria-pressed={isActive}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-all ${
              isActive
                ? 'bg-white text-slate-900 shadow-2xs dark:bg-slate-900 dark:text-white'
                : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
            }`}
          >
            <Icon className="h-4 w-4" />
            <span>{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}

const FINANCIAL_SY_STORAGE_KEY = 'sc_financial_selected_sy';
const FINANCIAL_REPORT_STORAGE_KEY = 'sc_financial_selected_report';

function getStoredFinancialSyId() {
  try {
    const val = sessionStorage.getItem(FINANCIAL_SY_STORAGE_KEY);
    return val ? Number(val) : null;
  } catch {
    return null;
  }
}

function getStoredFinancialReportId() {
  try {
    const val = sessionStorage.getItem(FINANCIAL_REPORT_STORAGE_KEY);
    return val ? Number(val) : null;
  } catch {
    return null;
  }
}

export default function FinancialReports({ mode = 'financial', defaultTab }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlTab = searchParams.get('tab');
  const resolveFinancialTab = useCallback((tab) => {
    if (tab === 'daily-sales' || tab === 'sales') return 'daily-sales';
    if (tab === 'expenses') return 'expenses';
    if (tab === 'fund-allocation') return 'fund-allocation';
    return 'overview';
  }, []);

  const isFinancialManagement = [
    'financial-management',
    'financial',
    'expenses',
    'daily-sales',
    'sales',
    'expense-management',
  ].includes(mode);

  const normalizedMode =
    mode === 'school-years'
      ? 'schoolYears'
      : isFinancialManagement
        ? 'financialManagement'
        : mode;

  const currentTab = resolveFinancialTab(
    urlTab ||
      (defaultTab === 'daily-sales' || defaultTab === 'sales' || mode === 'daily-sales' || mode === 'sales'
        ? 'daily-sales'
        : defaultTab === 'expenses' || mode === 'expenses' || mode === 'expense-management'
          ? 'expenses'
          : 'overview')
  );

  const handleTabChange = useCallback(
    (nextTab) => {
      const target = resolveFinancialTab(nextTab);
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('tab', target);
          return next;
        },
        { replace: false }
      );
    },
    [resolveFinancialTab, setSearchParams]
  );
  const { user: authUser, role } = useAuth();
  const user = authUser || {};
  const isAdmin = ['admin', 'administrator'].includes(String(role || user.role || '').trim().toLowerCase());
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
  const [fundMonitoringDraft, setFundMonitoringDraft] = useState({});
  const [exportingWorkbook, setExportingWorkbook] = useState(false);
  const [savingStatement, setSavingStatement] = useState(false);
  const [creatingSchoolYear, setCreatingSchoolYear] = useState(false);
  const [deletingSchoolYear, setDeletingSchoolYear] = useState(false);
  const [updatingSchoolYear, setUpdatingSchoolYear] = useState(false);
  const [savingDailySale, setSavingDailySale] = useState(false);
  const [savingExpenseEntry, setSavingExpenseEntry] = useState(false);
  const [salesSearch, setSalesSearch] = useState('');
  const [salesDateFilter, setSalesDateFilter] = useState('');
  const [dailySaleDraft, setDailySaleDraft] = useState({
    date: getTodayInputValue(),
    amount: '',
    notes: '',
  });
  const [expenseSearch, setExpenseSearch] = useState('');
  const [expenseCategoryFilter, setExpenseCategoryFilter] = useState('');
  const [expenseDateFilter, setExpenseDateFilter] = useState('');
  const [expensePage, setExpensePage] = useState(1);
  const [expenseEntryDraft, setExpenseEntryDraft] = useState({
    type: 'daily',
    date: getTodayInputValue(),
    month: '',
    category: EXPENSE_CATEGORY_OPTIONS[0],
    amount: '',
    supplier: '',
    description: '',
    receiptName: '',
  });
  const [activePreviewReceipt, setActivePreviewReceipt] = useState(null);
  const [expenseReceiptFile, setExpenseReceiptFile] = useState(null);
  const [expenseReceiptDataUrl, setExpenseReceiptDataUrl] = useState('');
  const [expenseReceiptError, setExpenseReceiptError] = useState('');
  const [expenseReceiptValidation, setExpenseReceiptValidation] = useState(null);
  const [expenseSuccessAlert, setExpenseSuccessAlert] = useState(null);
  const expenseFileInputRef = useRef(null);

  // Expense Edit & Delete State
  const [editingExpense, setEditingExpense] = useState(null);
  const [editExpenseDraft, setEditExpenseDraft] = useState({
    type: 'daily',
    date: '',
    month: '',
    category: EXPENSE_CATEGORY_OPTIONS[0],
    amount: '',
    supplier: '',
    description: '',
    receiptName: '',
  });
  const [editReceiptFile, setEditReceiptFile] = useState(null);
  const [editReceiptDataUrl, setEditReceiptDataUrl] = useState('');
  const [editReceiptError, setEditReceiptError] = useState('');
  const [editReceiptValidation, setEditReceiptValidation] = useState(null);
  const [savingEditExpense, setSavingEditExpense] = useState(false);
  const editExpenseFileInputRef = useRef(null);

  const [deletingExpense, setDeletingExpense] = useState(null);
  const [savingDeleteExpense, setSavingDeleteExpense] = useState(false);
  const [reportType, setReportType] = useState('monthly');
  const [fundMonitoringViewMode, setFundMonitoringViewMode] = useState(() => {
    try {
      return localStorage.getItem(FUND_MONITORING_VIEW_KEY) || 'table';
    } catch {
      return 'table';
    }
  });
  const [schoolYearForm, setSchoolYearForm] = useState({
    startYear: '',
    endYear: '',
    openingBeginningCash: '',
  });

  const handleFundMonitoringViewChange = (newMode) => {
    setFundMonitoringViewMode(newMode);
    try {
      localStorage.setItem(FUND_MONITORING_VIEW_KEY, newMode);
    } catch {
      // Ignore storage errors
    }
  };

  const selectedReport =
    detail?.reports?.find((report) => Number(report.id) === Number(selectedReportId)) ||
    detail?.reports?.[0] ||
    null;
  const selectedSchoolYear =
    detail?.school_year ||
    schoolYears.find((schoolYear) => Number(schoolYear.id) === Number(selectedSchoolYearId)) ||
    null;
  const selectedSchoolYearValidationMessage = getSchoolYearValidationMessage(
    selectedSchoolYear,
    schoolYearSuggestion
  );
  const canSaveSelectedSchoolYear = !selectedSchoolYearValidationMessage;
  const currentSchoolYearLabel = schoolYearSuggestion.label;
  const currentSchoolYearExists = schoolYears.some((schoolYear) =>
    isCurrentSchoolYear(schoolYear, schoolYearSuggestion)
  );
  const nextSchoolYearSuggestion = useMemo(() => {
    const nextStart = schoolYearSuggestion.startYear + 1;
    return {
      startYear: nextStart,
      endYear: nextStart + 1,
      label: `${nextStart}-${nextStart + 1}`,
    };
  }, [schoolYearSuggestion]);
  const nextSchoolYearLabel = nextSchoolYearSuggestion.label;
  const nextSchoolYearExists = schoolYears.some(
    (schoolYear) => Number(schoolYear.start_year) === nextSchoolYearSuggestion.startYear
  );

  const [showHistoricalModal, setShowHistoricalModal] = useState(false);
  const [historicalForm, setHistoricalForm] = useState({
    startYear: String(schoolYearSuggestion.startYear - 1),
    openingBeginningCash: '0.00',
  });
  const [creatingHistoricalYear, setCreatingHistoricalYear] = useState(false);
  const statement = buildStatementReport(
    selectedReport,
    reportDraft.beginning_cash_on_hand,
    reportDraft.current_sales,
    reportDraft.cost_of_sales
  );
  const dailySalesRows = useMemo(() => buildDailySaleRows(detail), [detail]);
  const filteredDailySalesRows = useMemo(() => {
    const query = salesSearch.trim().toLowerCase();
    return dailySalesRows.filter((row) => {
      const matchesQuery =
        !query ||
        row.remarks.toLowerCase().includes(query) ||
        row.monthLabel.toLowerCase().includes(query);
      const matchesDate = !salesDateFilter || row.date === salesDateFilter;
      return matchesQuery && matchesDate;
    });
  }, [dailySalesRows, salesDateFilter, salesSearch]);
  const monthDailySales = useMemo(() => {
    if (!selectedReport?.id) return [];
    return dailySalesRows.filter((row) => Number(row.reportId) === Number(selectedReport.id));
  }, [dailySalesRows, selectedReport?.id]);
  const monthDailySalesTotal = useMemo(() => {
    return monthDailySales.reduce((sum, row) => sum + row.amount, 0);
  }, [monthDailySales]);
  const expenseHistoryRows = useMemo(() => buildExpenseHistoryRows(detail), [detail]);
  const filteredExpenseRows = useMemo(() => {
    const query = expenseSearch.trim().toLowerCase();
    return expenseHistoryRows.filter((row) => {
      const matchesQuery =
        !query ||
        row.category.toLowerCase().includes(query) ||
        row.supplier.toLowerCase().includes(query) ||
        row.description.toLowerCase().includes(query) ||
        row.monthLabel.toLowerCase().includes(query);
      const matchesCategory = !expenseCategoryFilter || row.category === expenseCategoryFilter;
      const matchesDate = !expenseDateFilter || row.date.startsWith(expenseDateFilter);
      return matchesQuery && matchesCategory && matchesDate;
    });
  }, [expenseCategoryFilter, expenseDateFilter, expenseHistoryRows, expenseSearch]);

  useEffect(() => {
    setExpensePage(1);
  }, [expenseSearch, expenseCategoryFilter, expenseDateFilter, selectedSchoolYearId]);

  const totalExpensePages = Math.max(1, Math.ceil(filteredExpenseRows.length / EXPENSES_PER_PAGE));
  const safeExpensePage = Math.min(expensePage, totalExpensePages);
  const expenseStartIndex = filteredExpenseRows.length === 0 ? 0 : (safeExpensePage - 1) * EXPENSES_PER_PAGE;
  const paginatedExpenseRows = useMemo(
    () => filteredExpenseRows.slice(expenseStartIndex, expenseStartIndex + EXPENSES_PER_PAGE),
    [filteredExpenseRows, expenseStartIndex]
  );
  const expenseStartCount = filteredExpenseRows.length === 0 ? 0 : expenseStartIndex + 1;
  const expenseEndCount = Math.min(expenseStartIndex + paginatedExpenseRows.length, filteredExpenseRows.length);
  const expensePageNumbers = useMemo(
    () => getPageNumbers(safeExpensePage, totalExpensePages),
    [safeExpensePage, totalExpensePages]
  );

  const expenseSummary = useMemo(() => getExpenseSummaryByCategory(selectedReport), [selectedReport]);
  const generatedReportPayload = useMemo(
    () => buildGeneratedReportPayload(reportType, detail, selectedReport),
    [detail, reportType, selectedReport]
  );

  const selectedReportIndex = useMemo(() => {
    return (detail?.reports || []).findIndex((r) => Number(r.id) === Number(selectedReport?.id));
  }, [detail?.reports, selectedReport?.id]);

  const previousReport = useMemo(() => {
    return selectedReportIndex > 0 ? detail.reports[selectedReportIndex - 1] : null;
  }, [detail?.reports, selectedReportIndex]);

  const hasPreviousMonth = useMemo(() => {
    if (previousReport) return true;
    if (selectedReport?.has_previous_month) return true;
    return false;
  }, [previousReport, selectedReport?.has_previous_month]);

  const canEditFundOpeningBalance = !hasPreviousMonth && isAdmin && canSaveSelectedSchoolYear;

  const getFundPrevBalance = useCallback(
    (allocation) => {
      const key = allocation.category_key;
      // If no previous month exists in DB, use the draft or allocation opening balance
      if (!hasPreviousMonth) {
        const draftVal = fundMonitoringDraft[key]?.opening_balance;
        return draftVal !== undefined ? toMoney(draftVal) : toMoney(allocation.opening_balance);
      }
      // If previous month exists, pull ending Current Balance from previousReport or allocation.opening_balance
      if (previousReport) {
        const prevAlloc = (previousReport.allocations || []).find((a) => a.category_key === key);
        if (prevAlloc) {
          if (prevAlloc.current_balance !== undefined) {
            return toMoney(prevAlloc.current_balance);
          }
          const prevOpening = toMoney(prevAlloc.opening_balance);
          const prevNetInc = toMoney(prevAlloc.amount);
          const prevInterest = toMoney(prevAlloc.fund_interest);
          const prevExpenses = toMoney(prevAlloc.fund_expenses);
          const prevOthers = toMoney(prevAlloc.fund_others);
          return prevOpening + prevInterest + prevNetInc - (prevExpenses + prevOthers);
        }
      }
      return toMoney(allocation.opening_balance);
    },
    [fundMonitoringDraft, hasPreviousMonth, previousReport]
  );

  const fundAllocationTotals = useMemo(() => {
    return (selectedReport?.allocations || []).reduce(
      (acc, allocation) => {
        const key = allocation.category_key;
        const draft = fundMonitoringDraft[key] || {};
        const prevBal = getFundPrevBalance(allocation);
        const netInc = toMoney(allocation.amount);
        const interestVal = toMoney(draft.interest);
        const expensesVal = toMoney(draft.expenses);
        const othersVal = toMoney(draft.others);
        const cashOnBankVal = toMoney(draft.cash_on_bank);
        const totalExpVal = expensesVal + othersVal;
        const currentBalVal = prevBal + interestVal + netInc - totalExpVal;

        acc.prevBal += prevBal;
        acc.netInc += netInc;
        acc.expenses += expensesVal;
        acc.interest += interestVal;
        acc.others += othersVal;
        acc.cashOnBank += cashOnBankVal;
        acc.totalExp += totalExpVal;
        acc.currentBal += currentBalVal;
        return acc;
      },
      {
        prevBal: 0,
        netInc: 0,
        expenses: 0,
        interest: 0,
        others: 0,
        cashOnBank: 0,
        totalExp: 0,
        currentBal: 0,
      }
    );
  }, [selectedReport?.allocations, fundMonitoringDraft, getFundPrevBalance]);

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
      const reports = schoolYearDetail?.reports || [];
      const storedReportId = getStoredFinancialReportId();
      const nextReportId =
        reports.find((report) => Number(report.id) === Number(preferredReportId))?.id ||
        reports.find((report) => Number(report.id) === Number(selectedReportIdRef.current))?.id ||
        reports.find((report) => Number(report.id) === Number(storedReportId))?.id ||
        getCurrentReportId(reports);

      setDetail(schoolYearDetail);
      setSelectedReportId(nextReportId);
      setSelectedSchoolYearId(schoolYearId);
      try {
        if (schoolYearId) sessionStorage.setItem(FINANCIAL_SY_STORAGE_KEY, String(schoolYearId));
        if (nextReportId) sessionStorage.setItem(FINANCIAL_REPORT_STORAGE_KEY, String(nextReportId));
      } catch {
        // Ignore storage errors
      }
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
      const storedSyId = getStoredFinancialSyId();
      const storedReportId = getStoredFinancialReportId();
      const nextSchoolYearId =
        findSchoolYearId(preferredSchoolYearId) ||
        findSchoolYearId(selectedSchoolYearIdRef.current) ||
        findSchoolYearId(storedSyId) ||
        currentSchoolYearId ||
        normalizedSchoolYears.find((schoolYear) => schoolYear.is_active)?.id ||
        normalizedSchoolYears[0]?.id ||
        null;

      setSchoolYears(normalizedSchoolYears);
      setSelectedSchoolYearId(nextSchoolYearId);

      if (nextSchoolYearId) {
        await loadSchoolYearDetail(nextSchoolYearId, storedReportId);
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

  const handleSchoolYearChange = useCallback(
    (schoolYearId) => {
      try {
        if (schoolYearId) {
          sessionStorage.setItem(FINANCIAL_SY_STORAGE_KEY, String(schoolYearId));
        }
      } catch {
        // Ignore storage errors
      }
      loadSchoolYearDetail(schoolYearId);
    },
    [loadSchoolYearDetail]
  );

  const handleMonthChange = useCallback((reportId) => {
    setSelectedReportId(reportId);
    try {
      if (reportId) {
        sessionStorage.setItem(FINANCIAL_REPORT_STORAGE_KEY, String(reportId));
      }
    } catch {
      // Ignore storage errors
    }
  }, []);

  useEffect(() => {
    if (!selectedReport) {
      setFundMonitoringDraft({});
      return;
    }

    const reportDailySales = parseDailySaleNotes(selectedReport);
    const sumDailySales = reportDailySales.reduce((acc, row) => acc + row.amount, 0);
    const autoCurrentSales = reportDailySales.length > 0
      ? toInputValue(sumDailySales)
      : toInputValue(selectedReport.default_inputs?.current_sales ?? selectedReport.current_sales);

    setReportDraft({
      beginning_cash_on_hand: toInputValue(selectedReport.default_inputs?.beginning_cash_on_hand ?? selectedReport.beginning_cash_on_hand),
      current_sales: autoCurrentSales,
      cost_of_sales: toInputValue(selectedReport.default_inputs?.cost_of_sales ?? selectedReport.cost_of_sales),
    });

    const draft = {};
    (selectedReport.allocations || []).forEach((alloc) => {
      draft[alloc.category_key] = {
        opening_balance: toInputValue(alloc.opening_balance),
        interest: toInputValue(alloc.fund_interest),
        expenses: toInputValue(alloc.fund_expenses),
        others: toInputValue(alloc.fund_others),
        cash_on_bank: toInputValue(alloc.fund_cash_on_bank),
      };
    });
    setFundMonitoringDraft(draft);
  }, [selectedReport]);

  useEffect(() => {
    if (monthDailySales.length > 0) {
      const newSalesStr = toInputValue(monthDailySalesTotal);
      setReportDraft((currentDraft) => {
        if (currentDraft.current_sales === newSalesStr) {
          return currentDraft;
        }
        return {
          ...currentDraft,
          current_sales: newSalesStr,
        };
      });
    }
  }, [monthDailySales.length, monthDailySalesTotal]);

  useEffect(() => {
    const selectedMonth = getReportMonthValue(selectedReport);
    if (!selectedMonth) {
      return;
    }

    setExpenseEntryDraft((currentDraft) => {
      if (currentDraft.month && findReportForMonth(detail, currentDraft.month)) {
        return currentDraft;
      }

      return {
        ...currentDraft,
        month: selectedMonth,
      };
    });
  }, [detail, selectedReport]);

  useEffect(() => {
    if (!selectedSchoolYear) {
      return;
    }

    setSchoolYearForm({
      startYear: String(selectedSchoolYear.start_year || ''),
      endYear: String(selectedSchoolYear.end_year || ''),
      openingBeginningCash: toInputValue(getSchoolYearOpeningCash(selectedSchoolYear, detail)),
    });
  }, [detail, selectedSchoolYear]);

  function updateReportDraft(field, value) {
    if (/^\d*(?:\.\d{0,2})?$/.test(value)) {
      setReportDraft((currentDraft) => ({
        ...currentDraft,
        [field]: value,
      }));
    }
  }

  function updateFundMonitoringDraft(categoryKey, field, value) {
    if (value === '' || /^\d*(?:\.\d{0,2})?$/.test(value)) {
      setFundMonitoringDraft((currentDraft) => ({
        ...currentDraft,
        [categoryKey]: {
          ...(currentDraft[categoryKey] || {}),
          [field]: value,
        },
      }));
    }
  }

  async function handleCreateNextSchoolYear() {
    if (!isAdmin) {
      return;
    }
    const target = !currentSchoolYearExists ? schoolYearSuggestion : nextSchoolYearSuggestion;
    const isNext = currentSchoolYearExists;

    if (isNext && nextSchoolYearExists) {
      window.showToast?.(`Next school year ${nextSchoolYearLabel} already exists.`, 'warning');
      return;
    }

    setCreatingSchoolYear(true);
    try {
      const response = await API.createFinancialSchoolYear({
        start_year: target.startYear,
        end_year: target.endYear,
        set_active: !isNext,
      });
      window.showToast?.(`School year ${response?.school_year?.name || target.label} created successfully.`, 'success');
      await loadSchoolYears(response?.school_year?.id || null);
    } catch (error) {
      window.showToast?.(error.message || 'Unable to create the school year.', 'error');
    } finally {
      setCreatingSchoolYear(false);
    }
  }

  async function handleAddHistoricalYear(e) {
    if (e && e.preventDefault) {
      e.preventDefault();
    }
    if (!isAdmin) {
      return;
    }

    const startYear = Number(historicalForm.startYear);
    if (!Number.isInteger(startYear) || startYear >= schoolYearSuggestion.startYear) {
      window.showToast?.(`Historical start year must be earlier than ${schoolYearSuggestion.startYear}.`, 'error');
      return;
    }
    const endYear = startYear + 1;
    const name = `${startYear}-${endYear}`;
    if (schoolYears.some((sy) => sy.name === name || Number(sy.start_year) === startYear)) {
      window.showToast?.(`School year ${name} already exists.`, 'warning');
      return;
    }

    const openingBeginningCash = parseNonNegativeMoney(historicalForm.openingBeginningCash);
    if (openingBeginningCash === null) {
      window.showToast?.('Please enter a valid opening beginning cash amount (or 0.00).', 'error');
      return;
    }

    setCreatingHistoricalYear(true);
    try {
      const response = await API.createFinancialSchoolYear({
        start_year: startYear,
        end_year: endYear,
        set_active: false,
        opening_beginning_cash: openingBeginningCash,
      });
      window.showToast?.(`Historical school year ${name} added successfully.`, 'success');
      setShowHistoricalModal(false);
      setHistoricalForm({
        startYear: String(schoolYearSuggestion.startYear - 1),
        openingBeginningCash: '0.00',
      });
      await loadSchoolYears(response?.school_year?.id || null);
    } catch (error) {
      window.showToast?.(error.message || 'Unable to add historical school year.', 'error');
    } finally {
      setCreatingHistoricalYear(false);
    }
  }

  async function handleDeleteSchoolYear(schoolYearId = selectedSchoolYearId) {
    if (!schoolYearId || !isAdmin) {
      return;
    }

    const schoolYear = schoolYears.find((item) => Number(item.id) === Number(schoolYearId));
    const confirmed = window.confirm(
      `Remove school year ${schoolYear?.name || 'this school year'}? This deletes its monthly reports, expenses, and allocations.`
    );
    if (!confirmed) {
      return;
    }

    setDeletingSchoolYear(true);
    try {
      const response = await API.deleteFinancialSchoolYear(schoolYearId);
      window.showToast?.(response?.message || 'School year removed.', 'success');
      await loadSchoolYears(response?.active_school_year_id || null);
    } catch (error) {
      window.showToast?.(error.message || 'Unable to remove the school year.', 'error');
    } finally {
      setDeletingSchoolYear(false);
    }
  }

  async function handleUpdateSchoolYearStatus(schoolYearId, isActive) {
    if (!isAdmin) {
      return;
    }

    const schoolYear = schoolYears.find((item) => Number(item.id) === Number(schoolYearId));
    const actionLabel = isActive ? 'activate' : 'archive';
    if (isActive && schoolYear?.is_active) {
      window.showToast?.(`School year ${schoolYear.name} is already active.`, 'info');
      return;
    }
    if (!isActive && schoolYear?.is_active) {
      window.showToast?.('Activate another school year before archiving the active one.', 'warning');
      return;
    }
    if (!window.confirm(`${isActive ? 'Activate' : 'Archive'} school year ${schoolYear?.name || 'this school year'}?`)) {
      return;
    }

    setUpdatingSchoolYear(true);
    try {
      const response = isActive
        ? await API.activateFinancialSchoolYear(schoolYearId)
        : await API.archiveFinancialSchoolYear(schoolYearId);
      const nextSchoolYearId = response?.school_year?.id || schoolYearId;
      window.showToast?.(
        response?.message ||
          `School year ${response?.school_year?.name || schoolYear?.name || ''} ${isActive ? 'activated' : 'archived'}.`,
        'success'
      );
      await loadSchoolYears(nextSchoolYearId);
    } catch (error) {
      window.showToast?.(error.message || `Unable to ${actionLabel} the school year.`, 'error');
    } finally {
      setUpdatingSchoolYear(false);
    }
  }

  async function handleSaveSchoolYearForm() {
    if (!selectedSchoolYearId || !isAdmin) {
      return;
    }

    const startYear = Number(schoolYearForm.startYear);
    const endYear = Number(schoolYearForm.endYear);
    const openingBeginningCash = parseNonNegativeMoney(schoolYearForm.openingBeginningCash);
    if (!Number.isInteger(startYear) || !Number.isInteger(endYear) || endYear <= startYear) {
      window.showToast?.('Enter a valid school year range.', 'error');
      return;
    }
    if (openingBeginningCash === null) {
      window.showToast?.('Opening Beginning Cash must be a valid non-negative amount.', 'error');
      return;
    }

    setUpdatingSchoolYear(true);
    try {
      await API.updateFinancialSchoolYear(selectedSchoolYearId, {
        start_year: startYear,
        end_year: endYear,
      });

      const openingReport = (detail?.reports || []).find((report) => Number(report.month_index) === 0);
      if (openingReport?.id) {
        await API.updateFinancialReport(openingReport.id, {
          beginning_cash_on_hand: openingBeginningCash,
          beginning_cash_manual_override: true,
        });
      }

      window.showToast?.('School year details saved.', 'success');
      await loadSchoolYears(selectedSchoolYearId);
    } catch (error) {
      window.showToast?.(error.message || 'Unable to save school year details.', 'error');
    } finally {
      setUpdatingSchoolYear(false);
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
        window.showToast?.('Excel report exported.', 'success');
      }
    } catch (error) {
      const backendMessage =
        error?.apiDetail?.message ||
        error?.apiDetail?.detail ||
        error?.message ||
        '';
      const displayMessage = backendMessage || 'Unable to export the Excel report. Make sure the template file exists and the school year data is valid.';
      window.showToast?.(displayMessage, 'error');
    } finally {
      setExportingWorkbook(false);
    }
  }

  function handlePrintFinancialReport() {
    if (!selectedReport || !detail?.school_year?.name) {
      return;
    }

    openPrintableWindow(
      buildPrintableHtml(detail.school_year.name, selectedReport, statement, selectedReport.allocations || [])
    );
  }

  function handleExportFinancialPdf() {
    handlePrintFinancialReport();
    window.showToast?.('Choose "Save as PDF" in the print dialog to export a PDF.', 'info');
  }

  async function handleSaveStatement() {
    if (!selectedReport?.id) {
      return;
    }
    if (!canSaveSelectedSchoolYear) {
      window.showToast?.(selectedSchoolYearValidationMessage, 'error');
      return;
    }

    const nextBeginningCash = parseNonNegativeMoney(reportDraft.beginning_cash_on_hand);
    const nextCurrentSales = parseNonNegativeMoney(reportDraft.current_sales);
    const nextCostOfSales = parseNonNegativeMoney(reportDraft.cost_of_sales);
    if (nextBeginningCash === null) {
      window.showToast?.('Beginning Cash must be a valid non-negative amount.', 'error');
      return;
    }
    if (nextCurrentSales === null) {
      window.showToast?.('Current Sales must be a valid non-negative amount.', 'error');
      return;
    }
    if (nextCostOfSales === null) {
      window.showToast?.('Cost of Sales must be a valid non-negative amount.', 'error');
      return;
    }

    setSavingStatement(true);
    try {
      await API.updateFinancialReport(selectedReport.id, {
        beginning_cash_on_hand: nextBeginningCash,
        beginning_cash_manual_override: true,
        current_sales: nextCurrentSales,
        current_sales_manual_override: true,
        purchases: 0,
        inventory_used: 0,
        product_cost: nextCostOfSales,
      });

      const fundEntries = (selectedReport.allocations || []).map((alloc) => {
        const key = alloc.category_key;
        const itemDraft = fundMonitoringDraft[key] || {};
        return {
          category_key: key,
          opening_balance: canEditFundOpeningBalance
            ? (parseNonNegativeMoney(itemDraft.opening_balance) ?? 0)
            : toMoney(alloc.opening_balance),
          interest: parseNonNegativeMoney(itemDraft.interest) ?? 0,
          expenses: parseNonNegativeMoney(itemDraft.expenses) ?? 0,
          others: parseNonNegativeMoney(itemDraft.others) ?? 0,
          cash_on_bank: parseNonNegativeMoney(itemDraft.cash_on_bank) ?? 0,
        };
      });

      if (fundEntries.length > 0) {
        await API.updateFinancialFundMonitoring(selectedReport.id, fundEntries);
      }

      window.showToast?.(`${selectedReport.month_label} financial statement saved.`, 'success');
      await loadSchoolYearDetail(selectedSchoolYearId, selectedReport.id);
    } catch (error) {
      window.showToast?.(error.message || 'Unable to save the financial statement.', 'error');
    } finally {
      setSavingStatement(false);
    }
  }

  async function handleQuickAddSale() {
    if (!detail?.reports?.length) {
      return;
    }
    if (!canSaveSelectedSchoolYear) {
      window.showToast?.(selectedSchoolYearValidationMessage, 'error');
      return;
    }

    const amount = parseNonNegativeMoney(dailySaleDraft.amount);
    if (!dailySaleDraft.date) {
      window.showToast?.('Choose a sales date.', 'error');
      return;
    }
    if (amount === null || amount <= 0) {
      window.showToast?.('Enter a sales amount greater than zero.', 'error');
      return;
    }

    const targetReport = findReportForDate(detail, dailySaleDraft.date);
    if (!targetReport) {
      window.showToast?.('The sales date is outside the selected school year.', 'error');
      return;
    }

    setSavingDailySale(true);
    try {
      const existingEntries = parseDailySaleNotes(targetReport);
      const existingSum = existingEntries.reduce((sum, s) => sum + s.amount, 0);
      const baseSales = existingEntries.length > 0 ? existingSum : toMoney(targetReport.current_sales);
      const nextSalesTotal = baseSales + amount;
      const line = `[Daily Sale] ${dailySaleDraft.date} | ${formatCurrency(amount)} | ${cleanNoteValue(dailySaleDraft.notes) || 'No remarks'}`;
      await API.updateFinancialReport(targetReport.id, {
        current_sales: nextSalesTotal,
        current_sales_manual_override: true,
        notes: appendNoteLine(targetReport.notes, line),
      });
      window.showToast?.('Daily sale added.', 'success');
      setDailySaleDraft((currentDraft) => ({
        ...currentDraft,
        amount: '',
        notes: '',
      }));
      await loadSchoolYearDetail(selectedSchoolYearId, targetReport.id);
    } catch (error) {
      window.showToast?.(error.message || 'Unable to add the daily sale.', 'error');
    } finally {
      setSavingDailySale(false);
    }
  }

  async function handleReceiptFileChange(event) {
    const file = event.target.files?.[0];
    if (!file) {
      setExpenseReceiptFile(null);
      setExpenseReceiptDataUrl('');
      setExpenseReceiptError('');
      setExpenseReceiptValidation(null);
      setExpenseEntryDraft((draft) => ({ ...draft, receiptName: '' }));
      return;
    }

    const validation = validateReceiptFile(file);
    if (!validation.valid) {
      setExpenseReceiptError(validation.error || 'Invalid receipt file.');
      setExpenseReceiptFile(null);
      setExpenseReceiptDataUrl('');
      setExpenseReceiptValidation(null);
      setExpenseEntryDraft((draft) => ({ ...draft, receiptName: '' }));
      if (expenseFileInputRef.current) {
        expenseFileInputRef.current.value = '';
      }
      return;
    }

    setExpenseReceiptError('');
    setExpenseReceiptValidation(validation);
    setExpenseReceiptFile(file);
    setExpenseEntryDraft((draft) => ({ ...draft, receiptName: validation.sanitizedName }));

    try {
      const dataUrl = await readFileAsDataUrl(file);
      setExpenseReceiptDataUrl(dataUrl);
    } catch (err) {
      console.warn('Failed to read receipt preview data:', err);
    }
  }

  function handleClearReceiptUpload() {
    setExpenseReceiptFile(null);
    setExpenseReceiptDataUrl('');
    setExpenseReceiptError('');
    setExpenseReceiptValidation(null);
    setExpenseEntryDraft((draft) => ({ ...draft, receiptName: '' }));
    if (expenseFileInputRef.current) {
      expenseFileInputRef.current.value = '';
    }
  }

  function handleQuickPreviewUploadedReceipt(targetReport) {
    if (!expenseReceiptDataUrl && !expenseReceiptFile) return;
    const periodValue =
      expenseEntryDraft.type === 'monthly'
        ? getReportMonthValue(targetReport)
        : expenseEntryDraft.date;
    setActivePreviewReceipt({
      filename: expenseEntryDraft.receiptName || expenseReceiptFile?.name || 'Uploaded Receipt',
      dataUrl: expenseReceiptDataUrl,
      category: expenseEntryDraft.category,
      amount: expenseEntryDraft.amount || 0,
      date: periodValue,
      supplier: expenseEntryDraft.supplier,
      description: expenseEntryDraft.description,
      type: expenseEntryDraft.type,
      typeLabel: expenseEntryDraft.type === 'monthly' ? 'Monthly Expense' : 'Daily Expense',
      isPdf: expenseReceiptValidation?.isPdf,
      mimeType: expenseReceiptValidation?.mimeType,
    });
  }

  async function handleAddExpenseEntry() {
    if (savingExpenseEntry || !canSaveSelectedSchoolYear) {
      return;
    }

    const amount = parseCurrencyInput(expenseEntryDraft.amount);
    if (!amount || amount <= 0) {
      window.showToast?.('Please enter a valid expense amount greater than zero.', 'error');
      return;
    }

    const expenseType = expenseEntryDraft.type === 'monthly' ? 'monthly' : 'daily';
    const effectiveMonth = expenseEntryDraft.month || getReportMonthValue(selectedReport);
    if (expenseType === 'daily' && !isValidDateString(expenseEntryDraft.date)) {
      window.showToast?.('Please provide a valid expense date.', 'error');
      return;
    }
    if (expenseType === 'monthly' && !isValidMonthString(effectiveMonth)) {
      window.showToast?.('Please provide a valid expense month.', 'error');
      return;
    }

    const targetReport =
      expenseType === 'monthly'
        ? findReportForMonth(detail, effectiveMonth)
        : findReportForDate(detail, expenseEntryDraft.date);
    if (!targetReport) {
      window.showToast?.(
        expenseType === 'monthly'
          ? 'The expense month is outside the selected school year.'
          : 'The expense date is outside the selected school year.',
        'error'
      );
      return;
    }

    const category = expenseEntryDraft.category;
    const normalizedCategory = category.trim().toLowerCase();
    const expenseMap = new Map(
      (targetReport.expenses || []).map((expense) => [String(expense.category || '').trim().toLowerCase(), expense])
    );
    const nextExpenses = (targetReport.expenses || []).map((expense, index) => {
      if (String(expense.category || '').trim().toLowerCase() !== normalizedCategory) {
        return {
          category: expense.category,
          amount: toMoney(expense.amount),
          sort_order: expense.sort_order ?? index,
        };
      }

      return {
        category: expense.category,
        amount: toMoney(expense.amount) + amount,
        sort_order: expense.sort_order ?? index,
      };
    });

    if (!expenseMap.has(normalizedCategory)) {
      nextExpenses.push({
        category,
        amount,
        sort_order: nextExpenses.length,
      });
    }

    setSavingExpenseEntry(true);
    try {
      const sanitizedReceiptName = expenseEntryDraft.receiptName
        ? sanitizeReceiptFilename(expenseEntryDraft.receiptName)
        : '';
      const periodValue = expenseType === 'monthly' ? getReportMonthValue(targetReport) : expenseEntryDraft.date;
      const typeLabel = expenseType === 'monthly' ? 'Monthly Expense' : 'Daily Expense';
      const line = [
        `[${typeLabel}] ${periodValue}`,
        category,
        formatCurrency(amount),
        `Supplier: ${cleanNoteValue(expenseEntryDraft.supplier) || '-'}`,
        `Description: ${cleanNoteValue(expenseEntryDraft.description) || '-'}`,
        `Receipt: ${cleanNoteValue(sanitizedReceiptName) || 'No receipt'}`,
      ].join(' | ');

      // Save receipt to local IndexedDB/memory storage and upload to backend
      const dataUrlToSave = expenseReceiptDataUrl;
      const fileToSave = expenseReceiptFile;
      const validationToSave = expenseReceiptValidation;

      if (sanitizedReceiptName && (dataUrlToSave || fileToSave)) {
        const receiptEntry = {
          key: sanitizedReceiptName,
          filename: sanitizedReceiptName,
          rawName: fileToSave?.name || expenseEntryDraft.receiptName,
          dataUrl: dataUrlToSave,
          mimeType: validationToSave?.mimeType || 'image/png',
          size: validationToSave?.size || 0,
          sizeFormatted: validationToSave?.sizeFormatted || '',
          date: periodValue,
          category,
          amount,
          supplier: expenseEntryDraft.supplier,
          description: expenseEntryDraft.description,
          reportId: targetReport.id,
          type: expenseType,
          typeLabel,
          isPdf: validationToSave?.isPdf || false,
        };
        await saveReceipt(receiptEntry);

        // Also save under raw name if different
        if (fileToSave?.name && fileToSave.name !== sanitizedReceiptName) {
          await saveReceipt({
            ...receiptEntry,
            key: fileToSave.name,
            filename: fileToSave.name,
          });
        }

        if (fileToSave) {
          try {
            await API.uploadFinancialReceipt(fileToSave);
          } catch (uploadErr) {
            console.warn('Backend receipt upload fallback:', uploadErr);
          }
        }
      }

      await API.updateFinancialReportExpenses(targetReport.id, nextExpenses);
      await API.updateFinancialReport(targetReport.id, {
        notes: appendNoteLine(targetReport.notes, line),
      });

      // Set alert banner for the recorded expense
      setExpenseSuccessAlert({
        id: Date.now(),
        type: expenseType,
        typeLabel,
        date: periodValue,
        category,
        amount: formatCurrency(amount),
        supplier: cleanNoteValue(expenseEntryDraft.supplier) || '',
        description: cleanNoteValue(expenseEntryDraft.description) || '',
        receiptName: sanitizedReceiptName,
        monthLabel: targetReport.month_label,
      });

      window.showToast?.(`${typeLabel} of ${formatCurrency(amount)} added to ${targetReport.month_label}.`, 'success');
      setExpenseEntryDraft((currentDraft) => ({
        ...currentDraft,
        amount: '',
        supplier: '',
        description: '',
        receiptName: '',
      }));
      handleClearReceiptUpload();
      await loadSchoolYearDetail(selectedSchoolYearId, targetReport.id);
    } catch (error) {
      window.showToast?.(error.message || 'Unable to add the expense.', 'error');
    } finally {
      setSavingExpenseEntry(false);
    }
  }

  function handleOpenEditExpense(row) {
    if (!row) return;
    setEditingExpense(row);
    const isMonthly = row.type === 'monthly';
    setEditExpenseDraft({
      type: isMonthly ? 'monthly' : 'daily',
      date: isMonthly ? '' : row.date,
      month: isMonthly ? row.date.slice(0, 7) : '',
      category: row.category || EXPENSE_CATEGORY_OPTIONS[0],
      amount: String(row.amount || ''),
      supplier: row.supplier && row.supplier !== '-' ? row.supplier : '',
      description: row.description && row.description !== '-' && row.description !== 'Monthly category total' ? row.description : '',
      receiptName: row.receipt && row.receipt !== 'No receipt' && row.receipt !== '-' ? row.receipt : '',
    });
    setEditReceiptFile(null);
    setEditReceiptDataUrl('');
    setEditReceiptError('');
    setEditReceiptValidation(null);
  }

  function handleCloseEditExpense() {
    setEditingExpense(null);
    setEditReceiptFile(null);
    setEditReceiptDataUrl('');
    setEditReceiptError('');
    setEditReceiptValidation(null);
  }

  async function handleEditReceiptFileChange(event) {
    const file = event.target.files?.[0];
    if (!file) {
      setEditReceiptFile(null);
      setEditReceiptDataUrl('');
      setEditReceiptError('');
      setEditReceiptValidation(null);
      return;
    }

    const validation = validateReceiptFile(file);
    if (!validation.valid) {
      setEditReceiptError(validation.error || 'Invalid receipt file.');
      setEditReceiptFile(null);
      setEditReceiptDataUrl('');
      setEditReceiptValidation(null);
      if (editExpenseFileInputRef.current) {
        editExpenseFileInputRef.current.value = '';
      }
      return;
    }

    setEditReceiptError('');
    setEditReceiptValidation(validation);
    setEditReceiptFile(file);
    setEditExpenseDraft((draft) => ({ ...draft, receiptName: validation.sanitizedName }));

    try {
      const dataUrl = await readFileAsDataUrl(file);
      setEditReceiptDataUrl(dataUrl);
    } catch {
      setEditReceiptError('Failed to read receipt file preview.');
    }
  }

  function handleClearEditReceiptUpload() {
    setEditReceiptFile(null);
    setEditReceiptDataUrl('');
    setEditReceiptError('');
    setEditReceiptValidation(null);
    setEditExpenseDraft((draft) => ({ ...draft, receiptName: '' }));
    if (editExpenseFileInputRef.current) {
      editExpenseFileInputRef.current.value = '';
    }
  }

  async function handleSaveEditExpense() {
    if (!editingExpense || savingEditExpense || !canSaveSelectedSchoolYear) {
      return;
    }

    const amount = parseCurrencyInput(editExpenseDraft.amount);
    if (!amount || amount <= 0) {
      window.showToast?.('Please enter a valid expense amount greater than zero.', 'error');
      return;
    }

    const expenseType = editExpenseDraft.type === 'monthly' ? 'monthly' : 'daily';
    const effectiveMonth = editExpenseDraft.month || getReportMonthValue(selectedReport);
    if (expenseType === 'daily' && !isValidDateString(editExpenseDraft.date)) {
      window.showToast?.('Please provide a valid expense date.', 'error');
      return;
    }
    if (expenseType === 'monthly' && !isValidMonthString(effectiveMonth)) {
      window.showToast?.('Please provide a valid expense month.', 'error');
      return;
    }

    const targetReport =
      expenseType === 'monthly'
        ? findReportForMonth(detail, effectiveMonth)
        : findReportForDate(detail, editExpenseDraft.date);
    if (!targetReport) {
      window.showToast?.(
        expenseType === 'monthly'
          ? 'The expense month is outside the selected school year.'
          : 'The expense date is outside the selected school year.',
        'error'
      );
      return;
    }

    const originalReport = detail?.reports?.find((r) => Number(r.id) === Number(editingExpense.reportId));
    if (!originalReport) {
      window.showToast?.('Original monthly report not found.', 'error');
      return;
    }

    setSavingEditExpense(true);
    try {
      const sanitizedReceiptName = editExpenseDraft.receiptName
        ? sanitizeReceiptFilename(editExpenseDraft.receiptName)
        : '';
      const periodValue = expenseType === 'monthly' ? getReportMonthValue(targetReport) : editExpenseDraft.date;
      const typeLabel = expenseType === 'monthly' ? 'Monthly Expense' : 'Daily Expense';
      const newLine = [
        `[${typeLabel}] ${periodValue}`,
        editExpenseDraft.category,
        formatCurrency(amount),
        `Supplier: ${cleanNoteValue(editExpenseDraft.supplier) || '-'}`,
        `Description: ${cleanNoteValue(editExpenseDraft.description) || '-'}`,
        `Receipt: ${cleanNoteValue(sanitizedReceiptName) || 'No receipt'}`,
      ].join(' | ');

      // Save receipt if new file / dataUrl provided
      if (sanitizedReceiptName && (editReceiptDataUrl || editReceiptFile)) {
        const receiptEntry = {
          key: sanitizedReceiptName,
          filename: sanitizedReceiptName,
          rawName: editReceiptFile?.name || editExpenseDraft.receiptName,
          dataUrl: editReceiptDataUrl,
          mimeType: editReceiptValidation?.mimeType || 'image/png',
          size: editReceiptValidation?.size || 0,
          sizeFormatted: editReceiptValidation?.sizeFormatted || '',
          date: periodValue,
          category: editExpenseDraft.category,
          amount,
          supplier: editExpenseDraft.supplier,
          description: editExpenseDraft.description,
          reportId: targetReport.id,
          type: expenseType,
          typeLabel,
          isPdf: editReceiptValidation?.isPdf || false,
        };
        await saveReceipt(receiptEntry);
        if (editReceiptFile) {
          try {
            await API.uploadFinancialReceipt(editReceiptFile);
          } catch (uploadErr) {
            console.warn('Backend receipt upload fallback:', uploadErr);
          }
        }
      }

      const isSameReport = Number(originalReport.id) === Number(targetReport.id);
      const oldAmount = toMoney(editingExpense.amount);
      const oldCategory = String(editingExpense.category || '').trim().toLowerCase();
      const newCategory = String(editExpenseDraft.category || '').trim().toLowerCase();

      if (isSameReport) {
        // 1. Update notes
        const lines = String(targetReport.notes || '').split(/\r?\n/);
        let replaced = false;
        const nextLines = lines.map((line, idx) => {
          if (!replaced && (line === editingExpense.rawLine || idx === editingExpense.noteIndex)) {
            replaced = true;
            return newLine;
          }
          return line;
        });
        if (!replaced) {
          nextLines.push(newLine);
        }
        const updatedNotes = nextLines.join('\n');

        // 2. Update category totals in targetReport.expenses
        const expenseMap = new Map(
          (targetReport.expenses || []).map((exp) => [String(exp.category || '').trim().toLowerCase(), exp])
        );
        const nextExpenses = (targetReport.expenses || []).map((exp, idx) => {
          const cat = String(exp.category || '').trim().toLowerCase();
          let currentAmt = toMoney(exp.amount);
          if (cat === oldCategory) {
            currentAmt = Math.max(0, currentAmt - oldAmount);
          }
          if (cat === newCategory) {
            currentAmt += amount;
          }
          return {
            category: exp.category,
            amount: currentAmt,
            sort_order: exp.sort_order ?? idx,
          };
        });

        if (!expenseMap.has(newCategory)) {
          nextExpenses.push({
            category: editExpenseDraft.category,
            amount,
            sort_order: nextExpenses.length,
          });
        }

        await API.updateFinancialReportExpenses(targetReport.id, nextExpenses);
        await API.updateFinancialReport(targetReport.id, { notes: updatedNotes });
      } else {
        // Moved to a different month report
        // A. Remove from original report
        const origLines = String(originalReport.notes || '').split(/\r?\n/);
        let removed = false;
        const nextOrigLines = origLines.filter((line, idx) => {
          if (!removed && (line === editingExpense.rawLine || idx === editingExpense.noteIndex)) {
            removed = true;
            return false;
          }
          return true;
        });
        const updatedOrigNotes = nextOrigLines.join('\n');
        const nextOrigExpenses = (originalReport.expenses || []).map((exp, idx) => {
          if (String(exp.category || '').trim().toLowerCase() === oldCategory) {
            return {
              category: exp.category,
              amount: Math.max(0, toMoney(exp.amount) - oldAmount),
              sort_order: exp.sort_order ?? idx,
            };
          }
          return {
            category: exp.category,
            amount: toMoney(exp.amount),
            sort_order: exp.sort_order ?? idx,
          };
        });
        await API.updateFinancialReportExpenses(originalReport.id, nextOrigExpenses);
        await API.updateFinancialReport(originalReport.id, { notes: updatedOrigNotes });

        // B. Add to new target report
        const updatedTargetNotes = appendNoteLine(targetReport.notes, newLine);
        const targetExpenseMap = new Map(
          (targetReport.expenses || []).map((exp) => [String(exp.category || '').trim().toLowerCase(), exp])
        );
        const nextTargetExpenses = (targetReport.expenses || []).map((exp, idx) => {
          if (String(exp.category || '').trim().toLowerCase() === newCategory) {
            return {
              category: exp.category,
              amount: toMoney(exp.amount) + amount,
              sort_order: exp.sort_order ?? idx,
            };
          }
          return {
            category: exp.category,
            amount: toMoney(exp.amount),
            sort_order: exp.sort_order ?? idx,
          };
        });
        if (!targetExpenseMap.has(newCategory)) {
          nextTargetExpenses.push({
            category: editExpenseDraft.category,
            amount,
            sort_order: nextTargetExpenses.length,
          });
        }
        await API.updateFinancialReportExpenses(targetReport.id, nextTargetExpenses);
        await API.updateFinancialReport(targetReport.id, { notes: updatedTargetNotes });
      }

      window.showToast?.(`${typeLabel} updated successfully.`, 'success');
      handleCloseEditExpense();
      await loadSchoolYearDetail(selectedSchoolYearId, targetReport.id);
    } catch (err) {
      window.showToast?.(err.message || 'Unable to update the expense.', 'error');
    } finally {
      setSavingEditExpense(false);
    }
  }

  function handleOpenDeleteExpense(row) {
    if (!row) return;
    setDeletingExpense(row);
  }

  function handleCloseDeleteExpense() {
    setDeletingExpense(null);
  }

  async function handleConfirmDeleteExpense() {
    if (!deletingExpense || savingDeleteExpense || !canSaveSelectedSchoolYear) {
      return;
    }
    setSavingDeleteExpense(true);
    try {
      const targetReport = detail?.reports?.find((r) => Number(r.id) === Number(deletingExpense.reportId));
      if (!targetReport) {
        throw new Error('Monthly report for this expense could not be found.');
      }

      // 1. Remove note line from notes
      let updatedNotes = targetReport.notes || '';
      if (deletingExpense.rawLine) {
        const lines = updatedNotes.split(/\r?\n/);
        let removed = false;
        const newLines = lines.filter((line, idx) => {
          if (!removed && (line === deletingExpense.rawLine || idx === deletingExpense.noteIndex)) {
            removed = true;
            return false;
          }
          return true;
        });
        updatedNotes = newLines.join('\n');
      }

      // 2. Adjust category in targetReport.expenses
      const normalizedCategory = String(deletingExpense.category || '').trim().toLowerCase();
      const amountToSubtract = toMoney(deletingExpense.amount);
      const nextExpenses = (targetReport.expenses || []).map((exp, idx) => {
        if (String(exp.category || '').trim().toLowerCase() === normalizedCategory) {
          return {
            category: exp.category,
            amount: Math.max(0, toMoney(exp.amount) - amountToSubtract),
            sort_order: exp.sort_order ?? idx,
          };
        }
        return {
          category: exp.category,
          amount: toMoney(exp.amount),
          sort_order: exp.sort_order ?? idx,
        };
      });

      // 3. Save to backend
      await API.updateFinancialReportExpenses(targetReport.id, nextExpenses);
      await API.updateFinancialReport(targetReport.id, { notes: updatedNotes });

      window.showToast?.(
        `Expense for ${deletingExpense.category} (${formatCurrency(deletingExpense.amount)}) deleted.`,
        'success'
      );
      handleCloseDeleteExpense();
      await loadSchoolYearDetail(selectedSchoolYearId, targetReport.id);
    } catch (err) {
      window.showToast?.(err.message || 'Unable to delete the expense.', 'error');
    } finally {
      setSavingDeleteExpense(false);
    }
  }

  function handlePrintGeneratedReport() {
    openPrintableWindow(buildGeneratedReportHtml(generatedReportPayload));
  }

  function handleExportGeneratedPdf() {
    handlePrintGeneratedReport();
    window.showToast?.('Choose "Save as PDF" in the print dialog to export a PDF.', 'info');
  }

  function renderEmptySchoolYears() {
    const page = PAGE_COPY[normalizedMode] || PAGE_COPY.financial;
    return (
      <div className="view-shell">
        <PageHeader page={page} />
        <EmptyState
          title="No school year has been created yet"
          description={
            isAdmin
              ? 'Start by creating the current school year. The app will generate the June-to-May monthly records and carry over the previous ending balance when available.'
              : 'An administrator needs to create the school year before this page can show financial data.'
          }
          action={
            isAdmin ? (
              <div className="flex flex-wrap items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => setShowHistoricalModal(true)}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-black text-slate-700 shadow-xs transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                >
                  <ClockIcon className="h-5 w-5 text-amber-500" />
                  Add Historical Year
                </button>
                <button
                  type="button"
                  onClick={handleCreateNextSchoolYear}
                  disabled={creatingSchoolYear}
                  className="primary-action-button min-h-12 text-base"
                >
                  <PlusIcon className="h-5 w-5" />
                  {creatingSchoolYear
                    ? 'Creating...'
                    : !currentSchoolYearExists
                    ? `Create ${currentSchoolYearLabel}`
                    : `Create Next School Year (${nextSchoolYearLabel})`}
                </button>
              </div>
            ) : null
          }
        />
      </div>
    );
  }

  function renderSelectors({ includeMonth = true, compact = false } = {}) {
    return (
      <div className={`rounded-2xl border border-slate-200/90 bg-white p-4 shadow-2xs dark:border-slate-800 dark:bg-slate-900 grid grid-cols-1 gap-4 ${includeMonth ? 'lg:grid-cols-2' : ''}`}>
        <SchoolYearSelect
          schoolYears={schoolYears}
          selectedSchoolYearId={selectedSchoolYearId}
          onChange={handleSchoolYearChange}
        />
        {includeMonth ? (
          <MonthSelect
            reports={detail?.reports || []}
            selectedReportId={selectedReportId}
            onChange={handleMonthChange}
            label={compact ? 'Month' : 'Current Month'}
          />
        ) : null}
      </div>
    );
  }

  function renderFinancialManagementPage() {

    const overviewContent = (
      <div className="space-y-5 animate-in fade-in duration-200">
        <div className="grid grid-cols-1 gap-5 2xl:grid-cols-[minmax(0,1fr)_380px]">
          <section className="min-w-0 w-full rounded-2xl border border-slate-200/90 bg-white p-5 sm:p-6 shadow-2xs dark:border-slate-800 dark:bg-slate-900 space-y-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-xl font-black text-slate-900 dark:text-white">{selectedReport?.month_label} Financial Statement</h2>
                <p className="mt-1 text-sm font-medium text-slate-500 dark:text-slate-400">
                  {isAdmin
                    ? 'Auto calculations update while you edit Beginning Cash, Current Sales, and Cost of Sales.'
                    : 'Review monthly beginning cash, sales, cost of sales, and balances in read-only mode.'}
                </p>
              </div>
              {isAdmin ? (
                <button
                  type="button"
                  onClick={handleSaveStatement}
                  disabled={savingStatement || !canSaveSelectedSchoolYear}
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-black text-white shadow-xs transition hover:bg-emerald-700 active:scale-95 disabled:opacity-50"
                >
                  <CheckCircleIcon className="h-4 w-4 stroke-[2.5]" />
                  {savingStatement ? 'Saving...' : 'Save Statement'}
                </button>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-xl bg-slate-100 px-3.5 py-2 text-xs font-bold text-slate-600 border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  <EyeIcon className="h-4 w-4 text-slate-500" /> Read-Only View
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <FormField
                label="Beginning Cash"
                value={reportDraft.beginning_cash_on_hand}
                onChange={(event) => updateReportDraft('beginning_cash_on_hand', event.target.value)}
                disabled={!canSaveSelectedSchoolYear || !isAdmin}
                min="0"
                step="0.01"
              />
              <div>
                <FormField
                  label="Current Sales"
                  value={reportDraft.current_sales}
                  onChange={(event) => updateReportDraft('current_sales', event.target.value)}
                  disabled={!canSaveSelectedSchoolYear || !isAdmin}
                  min="0"
                  step="0.01"
                />
                {monthDailySales.length > 0 && (
                  <div className="mt-1.5 flex items-center justify-between gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                    <span>
                      Auto-summed from {monthDailySales.length} daily {monthDailySales.length === 1 ? 'sale' : 'sales'} ({formatCurrency(monthDailySalesTotal)})
                    </span>
                    <button
                      type="button"
                      onClick={() => handleTabChange('daily-sales')}
                      className="shrink-0 font-bold underline hover:text-emerald-700 dark:hover:text-emerald-300"
                    >
                      View &rarr;
                    </button>
                  </div>
                )}
              </div>
              <FormField
                label="Cost of Sales"
                value={reportDraft.cost_of_sales}
                onChange={(event) => updateReportDraft('cost_of_sales', event.target.value)}
                disabled={!canSaveSelectedSchoolYear || !isAdmin}
                min="0"
                step="0.01"
              />
            </div>

            <div className="overflow-hidden rounded-xl border border-slate-200/90 divide-y divide-slate-100 bg-white dark:border-slate-800 dark:divide-slate-800 dark:bg-slate-900">
              {[
                ['Beginning Cash', statement.beginningCash, true],
                ['Current Sales', statement.currentSales, true],
                ['Cost of Sales', statement.costOfSales],
                ['Gross Income', statement.grossIncome],
                ['Operation Expenses', statement.operationExpenses],
                ['Current Balance', statement.currentBalance, true],
              ].map(([label, amount, strong]) => (
                <div
                  key={label}
                  className={`grid grid-cols-1 gap-1 px-4 py-3.5 sm:grid-cols-[1fr_auto] sm:items-center ${
                    label === 'Current Balance'
                      ? 'bg-emerald-50/50 dark:bg-emerald-950/40'
                      : label === 'Gross Income'
                      ? 'bg-slate-50/50 dark:bg-slate-800/40'
                      : ''
                  }`}
                >
                  <div className="text-sm font-bold text-slate-700 dark:text-slate-300">
                    {label === 'Current Sales' ? (
                      <div className="flex items-center gap-2">
                        <span>{label}</span>
                        <button
                          type="button"
                          onClick={() => handleTabChange('daily-sales')}
                          className="text-xs font-semibold text-emerald-600 hover:text-emerald-700 hover:underline dark:text-emerald-400"
                        >
                          Daily Sales &rarr;
                        </button>
                      </div>
                    ) : label === 'Operation Expenses' ? (
                      <div className="flex items-center gap-2">
                        <span>{label}</span>
                        <button
                          type="button"
                          onClick={() => handleTabChange('expenses')}
                          className="text-xs font-semibold text-emerald-600 hover:text-emerald-700 hover:underline dark:text-emerald-400"
                        >
                          Manage &rarr;
                        </button>
                      </div>
                    ) : (
                      label
                    )}
                  </div>
                  <div className={`text-base font-mono ${strong ? 'font-black text-slate-950 dark:text-white' : 'font-bold text-slate-800 dark:text-slate-200'}`}>
                    {formatCurrency(amount)}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <aside className="min-w-0 w-full space-y-5">
            {/* Operating Expenses Summary Card */}
            <section className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-rose-100 bg-rose-50 text-rose-600 dark:border-rose-900/60 dark:bg-rose-950/60 dark:text-rose-400">
                      <ReceiptPercentIcon className="h-4 w-4" />
                    </div>
                    <h2 className="text-base font-black text-slate-900 dark:text-white">Operating Expenses</h2>
                  </div>
                  <p className="mt-1 text-xs font-medium text-slate-500 dark:text-slate-400">
                    Breakdown for {selectedReport?.month_label}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleTabChange('expenses')}
                  className="inline-flex items-center gap-1 text-xs font-bold text-rose-600 hover:text-rose-700 hover:underline dark:text-rose-400 shrink-0"
                >
                  View Details &rarr;
                </button>
              </div>

              {/* Total Operational Expenses Box */}
              <div className="mt-4 rounded-xl border border-rose-100 bg-gradient-to-r from-rose-50/80 to-amber-50/40 p-4 dark:border-rose-900/40 dark:from-rose-950/30 dark:to-slate-800/30">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-rose-700 dark:text-rose-300">
                    Total Operational Expenses
                  </span>
                  <span className="rounded-md bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-800 dark:bg-rose-900/70 dark:text-rose-200">
                    {expenseSummary.length} {expenseSummary.length === 1 ? 'Category' : 'Categories'}
                  </span>
                </div>
                <div className="mt-1.5 font-mono text-2xl font-black text-rose-700 dark:text-rose-400">
                  {formatCurrency(statement.operationExpenses)}
                </div>
              </div>

              {/* Top Expense Categories Breakdown */}
              <div className="mt-4 space-y-2.5">
                {expenseSummary.length > 0 ? (
                  expenseSummary.map((item) => {
                    const pct = statement.operationExpenses > 0
                      ? ((item.amount / statement.operationExpenses) * 100).toFixed(1)
                      : '0.0';
                    const numPct = parseFloat(pct) || 0;
                    const theme = EXPENSE_CATEGORY_THEME_MAP[item.category] || DEFAULT_EXPENSE_THEME;
                    return (
                      <div
                        key={item.category}
                        className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-800/60"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0 text-xs font-black text-slate-900 dark:text-white truncate">
                            {item.category}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${theme.badge}`}>
                              {pct}%
                            </span>
                            <span className="font-mono text-xs font-black text-slate-900 dark:text-white">
                              {formatCurrency(item.amount)}
                            </span>
                          </div>
                        </div>
                        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200/70 dark:bg-slate-700">
                          <div
                            className={`h-full rounded-full transition-all duration-300 ${theme.bar}`}
                            style={{ width: `${Math.max(3, Math.min(100, numPct))}%` }}
                          />
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-xs font-medium text-slate-500 dark:border-slate-800 dark:text-slate-400">
                    <ReceiptPercentIcon className="mx-auto h-6 w-6 text-slate-400 mb-1.5 opacity-60" />
                    No operating expenses recorded for this month.
                    <div className="mt-2">
                      <button
                        type="button"
                        onClick={() => handleTabChange('expenses')}
                        className="font-bold text-rose-600 hover:underline dark:text-rose-400"
                      >
                        Add Expense &rarr;
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-black text-slate-900 dark:text-white">Fund Allocation Summary</h2>
                  <p className="mt-0.5 text-xs font-medium text-slate-500 dark:text-slate-400">
                    Net income shares for {selectedReport?.month_label}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleTabChange('fund-allocation')}
                  className="text-xs font-bold text-emerald-600 hover:text-emerald-700 hover:underline dark:text-emerald-400 shrink-0"
                >
                  View Details &rarr;
                </button>
              </div>
              <div className="mt-4 space-y-2.5">
                {(selectedReport?.allocations || []).map((allocation) => (
                  <div key={allocation.category_key} className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-3.5 dark:border-slate-800 dark:bg-slate-800/60">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 text-xs font-black text-slate-900 dark:text-white">{allocation.label}</div>
                      <div className="rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-black text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                        {formatPercent(allocation.percentage)}
                      </div>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-3 text-xs">
                      <span className="font-semibold text-slate-500 dark:text-slate-400">Net Income Allocation</span>
                      <span className="font-mono font-black text-slate-900 dark:text-white">{formatCurrency(allocation.amount)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </aside>
        </div>
      </div>
    );

    const salesListContent = (
      <div className="min-w-0 w-full space-y-5">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <MetricTile
            label="Monthly Total Sales"
            value={formatCurrency(selectedReport?.current_sales)}
            tone="emerald"
            icon={BanknotesIcon}
          />
          <MetricTile
            label="Manual Entries This Month"
            value={formatCurrency(monthDailySalesTotal)}
            tone="sky"
            icon={DocumentChartBarIcon}
          />
          <MetricTile
            label="Entries Found"
            value={String(filteredDailySalesRows.length)}
            tone="slate"
            icon={ClipboardDocumentListIcon}
          />
        </div>

        <section className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-slate-900 space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_220px]">
            <FormField label="Search Remarks">
              <div className="relative">
                <MagnifyingGlassIcon className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                <input
                  type="search"
                  value={salesSearch}
                  onChange={(event) => setSalesSearch(event.target.value)}
                  placeholder="Search sales remarks..."
                  className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50/50 pl-10 pr-4 text-sm font-semibold text-slate-900 shadow-2xs outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>
            </FormField>
            <FormField label="Filter by Date">
              <input
                type="date"
                value={salesDateFilter}
                onChange={(event) => setSalesDateFilter(event.target.value)}
                className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 text-sm font-semibold text-slate-900 shadow-2xs outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </FormField>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-2xs dark:border-slate-800 dark:bg-slate-900">
            <div className="w-full overflow-hidden">
              <table className="w-full text-left text-xs sm:text-sm">
                <thead className="border-b border-slate-200/80 bg-slate-50/80 text-xs font-bold uppercase tracking-wider text-slate-500 dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-400">
                  <tr>
                    <th className="px-3 sm:px-5 py-3.5 w-28">Date</th>
                    <th className="px-3 sm:px-4 py-3.5 text-right w-28 sm:w-36">Amount</th>
                    <th className="px-3 sm:px-5 py-3.5">Notes/Remarks</th>
                    <th className="px-3 sm:px-4 py-3.5 w-24 sm:w-32 hidden sm:table-cell">Month</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white dark:divide-slate-800 dark:bg-slate-900">
                  {filteredDailySalesRows.length ? (
                    filteredDailySalesRows.map((row) => (
                      <tr key={row.id} className="transition hover:bg-slate-50/70 dark:hover:bg-slate-800/50">
                        <td className="px-3 sm:px-5 py-3.5 font-mono text-xs sm:text-sm font-bold text-slate-900 dark:text-white whitespace-nowrap">{row.date}</td>
                        <td className="px-3 sm:px-4 py-3.5 text-right font-mono text-xs sm:text-sm font-black text-emerald-700 dark:text-emerald-400 whitespace-nowrap">{formatCurrency(row.amount)}</td>
                        <td className="px-3 sm:px-5 py-3.5 text-xs sm:text-sm text-slate-600 dark:text-slate-300">{row.remarks}</td>
                        <td className="px-3 sm:px-4 py-3.5 text-xs font-semibold text-slate-500 dark:text-slate-400 hidden sm:table-cell">{row.monthLabel}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={4} className="px-6 py-12 text-center text-sm font-semibold text-slate-500 dark:text-slate-400">
                        No daily sales entries match the current filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>
    );

    const dailySalesContent = (
      <div className="space-y-5 animate-in fade-in duration-200">

        {isAdmin ? (
          <div className="grid grid-cols-1 gap-5 2xl:grid-cols-[340px_minmax(0,1fr)]">
            <section className="min-w-0 w-full rounded-2xl border border-slate-200/90 bg-white p-5 sm:p-6 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-100 bg-emerald-50 text-emerald-600 dark:border-emerald-900/60 dark:bg-emerald-950/60 dark:text-emerald-400">
                  <PlusIcon className="h-5 w-5 stroke-[2.5]" />
                </div>
                <div>
                  <h2 className="text-base font-black text-slate-900 dark:text-white">Sales Entry Form</h2>
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Add one daily total.</p>
                </div>
              </div>

              <div className="mt-5 space-y-4">
                <FormField label="Date">
                  <input
                    type="date"
                    value={dailySaleDraft.date}
                    onChange={(event) => setDailySaleDraft((draft) => ({ ...draft, date: event.target.value }))}
                    className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 text-sm font-semibold text-slate-900 shadow-2xs outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </FormField>
                <FormField
                  label="Amount"
                  value={dailySaleDraft.amount}
                  onChange={(event) => setDailySaleDraft((draft) => ({ ...draft, amount: event.target.value }))}
                  min="0"
                  step="0.01"
                />
                <FormField label="Notes/Remarks">
                  <textarea
                    value={dailySaleDraft.notes}
                    onChange={(event) => setDailySaleDraft((draft) => ({ ...draft, notes: event.target.value }))}
                    rows={4}
                    placeholder="Optional remarks"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50/50 p-3 text-sm font-semibold text-slate-900 shadow-2xs outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white resize-none"
                  />
                </FormField>
                <button
                  type="button"
                  onClick={handleQuickAddSale}
                  disabled={savingDailySale || !canSaveSelectedSchoolYear}
                  className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-xs font-black text-white shadow-xs transition hover:bg-emerald-700 active:scale-95 disabled:opacity-50"
                >
                  <PlusIcon className="h-4 w-4 stroke-[2.5]" />
                  {savingDailySale ? 'Adding...' : 'Quick Add Sale'}
                </button>
              </div>
            </section>

            {salesListContent}
          </div>
        ) : (
          salesListContent
        )}
      </div>
    );

    const fundAllocationContent = (
      <div className="space-y-5 animate-in fade-in duration-200">
        <section className="panel-card space-y-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-xl font-black text-slate-900 dark:text-white">Fund Allocation Monitoring (DepEd Form)</h2>
              <p className="mt-1 text-base leading-7 text-slate-500 dark:text-slate-400">
                {isAdmin
                  ? 'Auto calculations update while you edit expenses and bank entries per fund allocation.'
                  : 'Review fund allocations and balances per DepEd form in read-only mode.'}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <ViewToggle
                mode={fundMonitoringViewMode}
                onChange={handleFundMonitoringViewChange}
                options={[
                  { mode: 'table', icon: TableCellsIcon, label: 'Table' },
                  { mode: 'grid', icon: Squares2X2Icon, label: 'Grid' },
                ]}
              />
              {isAdmin ? (
                <button
                  type="button"
                  onClick={handleSaveStatement}
                  disabled={savingStatement || !canSaveSelectedSchoolYear}
                  className="primary-action-button min-h-12 text-base"
                >
                  <CheckCircleIcon className="h-5 w-5" />
                  {savingStatement ? 'Saving...' : 'Save Statement'}
                </button>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3.5 py-2 text-xs font-bold text-slate-600 border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  <EyeIcon className="h-4 w-4 text-slate-500 dark:text-slate-400" /> Read-Only View
                </span>
              )}
            </div>
          </div>

          {canEditFundOpeningBalance && (
            <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 text-sm text-emerald-900 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-200 flex items-start gap-3">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white font-bold text-xs">!</span>
              <div>
                <strong className="font-bold">Initial Setup / Starting Balances:</strong> No previous month record exists in the database. You can manually enter starting balances under <strong>Balance in previous month</strong> for all funds below. Subsequent months will automatically carry forward ending balances and lock the field.
              </div>
            </div>
          )}

          {fundMonitoringViewMode === 'table' ? (
            <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-2xs dark:border-slate-800 dark:bg-slate-900">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm border-collapse">
                  <thead className="border-b border-slate-200 bg-slate-50/80 text-xs font-bold uppercase tracking-wider text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-400">
                    <tr>
                      <th className="px-4 py-3.5 whitespace-nowrap min-w-[200px]">Fund Allocation</th>
                      <th className="px-4 py-3.5 text-right whitespace-nowrap min-w-[170px]">
                        <div className="inline-flex items-center justify-end gap-1.5">
                          <span>Balance in previous month</span>
                          {!canEditFundOpeningBalance && (
                            <LockClosedIcon className="h-3.5 w-3.5 text-slate-400 shrink-0" title="Locked: Automatically carried forward from previous month" />
                          )}
                        </div>
                      </th>
                      <th className="px-4 py-3.5 text-right whitespace-nowrap min-w-[130px]">Net Income Share</th>
                      <th className="px-3 py-3.5 text-right whitespace-nowrap min-w-[125px]">Expenses</th>
                      <th className="px-3 py-3.5 text-right whitespace-nowrap min-w-[125px]">Interest</th>
                      <th className="px-3 py-3.5 text-right whitespace-nowrap min-w-[125px]">Others</th>
                      <th className="px-3 py-3.5 text-right whitespace-nowrap min-w-[125px]">Cash on Bank</th>
                      <th className="px-4 py-3.5 text-right whitespace-nowrap min-w-[135px]">Total Expenses</th>
                      <th className="px-4 py-3.5 text-right whitespace-nowrap min-w-[135px]">Current Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {(selectedReport?.allocations || []).map((allocation) => {
                      const key = allocation.category_key;
                      const draft = fundMonitoringDraft[key] || {};
                      const prevBal = getFundPrevBalance(allocation);
                      const netInc = toMoney(allocation.amount);
                      const interestVal = toMoney(draft.interest);
                      const expensesVal = toMoney(draft.expenses);
                      const othersVal = toMoney(draft.others);
                      const cashOnBankVal = toMoney(draft.cash_on_bank);
                      const totalExpVal = expensesVal + othersVal;
                      const currentBalVal = prevBal + interestVal + netInc - totalExpVal;

                      return (
                        <tr key={key} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors">
                          <td className="px-4 py-3.5">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-slate-900 dark:text-white whitespace-nowrap">{allocation.label}</span>
                              <span className="inline-flex items-center rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-black text-emerald-700 border border-emerald-200/60 dark:border-emerald-800/60 dark:bg-emerald-950/60 dark:text-emerald-300">
                                {formatPercent(allocation.percentage)}
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-2.5">
                            {canEditFundOpeningBalance ? (
                              <input
                                type="text"
                                value={draft.opening_balance ?? ''}
                                onChange={(e) => updateFundMonitoringDraft(key, 'opening_balance', e.target.value)}
                                disabled={!isAdmin || !canSaveSelectedSchoolYear}
                                readOnly={!isAdmin}
                                placeholder="0.00"
                                title="Enter manual starting balance for initial month"
                                className={`h-10 w-full min-w-[120px] rounded-xl border px-3 text-right font-mono text-sm font-semibold transition ${
                                  !isAdmin
                                    ? 'bg-slate-100/80 text-slate-700 cursor-not-allowed border-slate-200 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400'
                                    : 'bg-emerald-50/20 border-emerald-300/80 hover:border-emerald-400 focus:bg-white focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-emerald-700 dark:bg-emerald-950/20 dark:focus:bg-slate-900 dark:text-white'
                                }`}
                              />
                            ) : (
                              <div
                                className="flex items-center justify-end gap-1.5 px-1 py-1 font-mono font-bold text-slate-700 dark:text-slate-300 whitespace-nowrap"
                                title="Carried over from previous month current balance (locked)"
                              >
                                <LockClosedIcon className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                                <span>{formatCurrency(prevBal)}</span>
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3.5 text-right font-mono font-bold text-slate-700 dark:text-slate-300 whitespace-nowrap">
                            {formatCurrency(netInc)}
                          </td>
                          <td className="px-3 py-2.5">
                            <input
                              type="text"
                              value={draft.expenses ?? ''}
                              onChange={(e) => updateFundMonitoringDraft(key, 'expenses', e.target.value)}
                              disabled={!isAdmin || !canSaveSelectedSchoolYear}
                              readOnly={!isAdmin}
                              placeholder="0.00"
                              className={`h-10 w-full min-w-[105px] rounded-xl border px-3 text-right font-mono text-sm font-semibold transition ${
                                !isAdmin
                                  ? 'bg-slate-100/80 text-slate-700 cursor-not-allowed border-slate-200 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400'
                                  : 'bg-slate-50/60 border-slate-200 hover:border-slate-300 focus:bg-white focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800/70 dark:focus:bg-slate-900 dark:text-white'
                              }`}
                            />
                          </td>
                          <td className="px-3 py-2.5">
                            <input
                              type="text"
                              value={draft.interest ?? ''}
                              onChange={(e) => updateFundMonitoringDraft(key, 'interest', e.target.value)}
                              disabled={!isAdmin || !canSaveSelectedSchoolYear}
                              readOnly={!isAdmin}
                              placeholder="0.00"
                              className={`h-10 w-full min-w-[105px] rounded-xl border px-3 text-right font-mono text-sm font-semibold transition ${
                                !isAdmin
                                  ? 'bg-slate-100/80 text-slate-700 cursor-not-allowed border-slate-200 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400'
                                  : 'bg-slate-50/60 border-slate-200 hover:border-slate-300 focus:bg-white focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800/70 dark:focus:bg-slate-900 dark:text-white'
                              }`}
                            />
                          </td>
                          <td className="px-3 py-2.5">
                            <input
                              type="text"
                              value={draft.others ?? ''}
                              onChange={(e) => updateFundMonitoringDraft(key, 'others', e.target.value)}
                              disabled={!isAdmin || !canSaveSelectedSchoolYear}
                              readOnly={!isAdmin}
                              placeholder="0.00"
                              className={`h-10 w-full min-w-[105px] rounded-xl border px-3 text-right font-mono text-sm font-semibold transition ${
                                !isAdmin
                                  ? 'bg-slate-100/80 text-slate-700 cursor-not-allowed border-slate-200 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400'
                                  : 'bg-slate-50/60 border-slate-200 hover:border-slate-300 focus:bg-white focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800/70 dark:focus:bg-slate-900 dark:text-white'
                              }`}
                            />
                          </td>
                          <td className="px-3 py-2.5">
                            <input
                              type="text"
                              value={draft.cash_on_bank ?? ''}
                              onChange={(e) => updateFundMonitoringDraft(key, 'cash_on_bank', e.target.value)}
                              disabled={!isAdmin || !canSaveSelectedSchoolYear}
                              readOnly={!isAdmin}
                              placeholder="0.00"
                              className={`h-10 w-full min-w-[105px] rounded-xl border px-3 text-right font-mono text-sm font-semibold transition ${
                                !isAdmin
                                  ? 'bg-slate-100/80 text-slate-700 cursor-not-allowed border-slate-200 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400'
                                  : 'bg-slate-50/60 border-slate-200 hover:border-slate-300 focus:bg-white focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800/70 dark:focus:bg-slate-900 dark:text-white'
                              }`}
                            />
                          </td>
                          <td className="px-4 py-3.5 text-right font-mono font-bold text-rose-600 dark:text-rose-400 whitespace-nowrap">
                            {formatCurrency(totalExpVal)}
                          </td>
                          <td className="px-4 py-3.5 text-right font-mono font-black text-emerald-600 dark:text-emerald-400 text-base whitespace-nowrap">
                            {formatCurrency(currentBalVal)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="border-t-2 border-slate-200 bg-slate-50/90 font-bold dark:border-slate-700 dark:bg-slate-800/80">
                    <tr>
                      <td className="px-4 py-3.5 text-slate-900 dark:text-white font-black uppercase text-xs">Total</td>
                      <td className="px-4 py-3.5 text-right font-mono font-bold text-slate-900 dark:text-white whitespace-nowrap">{formatCurrency(fundAllocationTotals.prevBal)}</td>
                      <td className="px-4 py-3.5 text-right font-mono font-bold text-slate-900 dark:text-white whitespace-nowrap">{formatCurrency(fundAllocationTotals.netInc)}</td>
                      <td className="px-3 py-3.5 text-right font-mono font-bold text-slate-900 dark:text-white whitespace-nowrap">{formatCurrency(fundAllocationTotals.expenses)}</td>
                      <td className="px-3 py-3.5 text-right font-mono font-bold text-slate-900 dark:text-white whitespace-nowrap">{formatCurrency(fundAllocationTotals.interest)}</td>
                      <td className="px-3 py-3.5 text-right font-mono font-bold text-slate-900 dark:text-white whitespace-nowrap">{formatCurrency(fundAllocationTotals.others)}</td>
                      <td className="px-3 py-3.5 text-right font-mono font-bold text-slate-900 dark:text-white whitespace-nowrap">{formatCurrency(fundAllocationTotals.cashOnBank)}</td>
                      <td className="px-4 py-3.5 text-right font-mono font-bold text-rose-600 dark:text-rose-400 whitespace-nowrap">{formatCurrency(fundAllocationTotals.totalExp)}</td>
                      <td className="px-4 py-3.5 text-right font-mono font-black text-emerald-600 dark:text-emerald-400 text-base whitespace-nowrap">{formatCurrency(fundAllocationTotals.currentBal)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          ) : (
            <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
              {(selectedReport?.allocations || []).map((allocation) => {
                const key = allocation.category_key;
                const draft = fundMonitoringDraft[key] || {};
                const prevBal = getFundPrevBalance(allocation);
                const netInc = toMoney(allocation.amount);
                const interestVal = toMoney(draft.interest);
                const expensesVal = toMoney(draft.expenses);
                const othersVal = toMoney(draft.others);
                const totalExpVal = expensesVal + othersVal;
                const currentBalVal = prevBal + interestVal + netInc - totalExpVal;

                return (
                  <div key={key} className="rounded-2xl border border-slate-200/90 bg-white p-5 space-y-5 shadow-2xs transition hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
                    <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3.5 dark:border-slate-800">
                      <div className="text-lg font-black text-slate-900 dark:text-white">{allocation.label}</div>
                      <span className="inline-flex items-center rounded-lg bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700 border border-emerald-200/60 dark:border-emerald-800/60 dark:bg-emerald-950/60 dark:text-emerald-300">
                        {formatPercent(allocation.percentage)}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                      {canEditFundOpeningBalance && (
                        <div className="flex flex-col gap-1.5 sm:col-span-2">
                          <label className="text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 whitespace-nowrap overflow-hidden text-ellipsis flex items-center gap-1.5">
                            <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
                            Balance in previous month (Starting Balance)
                          </label>
                          <input
                            type="text"
                            value={draft.opening_balance ?? ''}
                            onChange={(e) => updateFundMonitoringDraft(key, 'opening_balance', e.target.value)}
                            disabled={!isAdmin || !canSaveSelectedSchoolYear}
                            readOnly={!isAdmin}
                            placeholder="0.00"
                            className={`field-control min-h-11 w-full text-base font-semibold rounded-xl border ${
                              !isAdmin
                                ? 'bg-slate-100/80 text-slate-700 cursor-not-allowed border-slate-200 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400 focus:outline-none focus:ring-0'
                                : 'bg-emerald-50/20 border-emerald-300/80 focus:bg-white focus:border-emerald-500 dark:border-emerald-700 dark:bg-emerald-950/20 dark:focus:bg-slate-900 dark:text-white'
                            }`}
                          />
                        </div>
                      )}

                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 whitespace-nowrap overflow-hidden text-ellipsis">
                          Expenses for the Month
                        </label>
                        <input
                          type="text"
                          value={draft.expenses ?? ''}
                          onChange={(e) => updateFundMonitoringDraft(key, 'expenses', e.target.value)}
                          disabled={!isAdmin || !canSaveSelectedSchoolYear}
                          readOnly={!isAdmin}
                          placeholder="0.00"
                          className={`field-control min-h-11 w-full text-base font-semibold rounded-xl border ${
                            !isAdmin
                              ? 'bg-slate-100/80 text-slate-700 cursor-not-allowed border-slate-200 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400 focus:outline-none focus:ring-0'
                              : 'bg-slate-50/60 border-slate-200 focus:bg-white focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-800 dark:focus:bg-slate-900 dark:text-white'
                          }`}
                        />
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 whitespace-nowrap overflow-hidden text-ellipsis">
                          Interest on Bank
                        </label>
                        <input
                          type="text"
                          value={draft.interest ?? ''}
                          onChange={(e) => updateFundMonitoringDraft(key, 'interest', e.target.value)}
                          disabled={!isAdmin || !canSaveSelectedSchoolYear}
                          readOnly={!isAdmin}
                          placeholder="0.00"
                          className={`field-control min-h-11 w-full text-base font-semibold rounded-xl border ${
                            !isAdmin
                              ? 'bg-slate-100/80 text-slate-700 cursor-not-allowed border-slate-200 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400 focus:outline-none focus:ring-0'
                              : 'bg-slate-50/60 border-slate-200 focus:bg-white focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-800 dark:focus:bg-slate-900 dark:text-white'
                          }`}
                        />
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 whitespace-nowrap overflow-hidden text-ellipsis">
                          Others
                        </label>
                        <input
                          type="text"
                          value={draft.others ?? ''}
                          onChange={(e) => updateFundMonitoringDraft(key, 'others', e.target.value)}
                          disabled={!isAdmin || !canSaveSelectedSchoolYear}
                          readOnly={!isAdmin}
                          placeholder="0.00"
                          className={`field-control min-h-11 w-full text-base font-semibold rounded-xl border ${
                            !isAdmin
                              ? 'bg-slate-100/80 text-slate-700 cursor-not-allowed border-slate-200 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400 focus:outline-none focus:ring-0'
                              : 'bg-slate-50/60 border-slate-200 focus:bg-white focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-800 dark:focus:bg-slate-900 dark:text-white'
                          }`}
                        />
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 whitespace-nowrap overflow-hidden text-ellipsis">
                          Cash on Bank
                        </label>
                        <input
                          type="text"
                          value={draft.cash_on_bank ?? ''}
                          onChange={(e) => updateFundMonitoringDraft(key, 'cash_on_bank', e.target.value)}
                          disabled={!isAdmin || !canSaveSelectedSchoolYear}
                          readOnly={!isAdmin}
                          placeholder="0.00"
                          className={`field-control min-h-11 w-full text-base font-semibold rounded-xl border ${
                            !isAdmin
                              ? 'bg-slate-100/80 text-slate-700 cursor-not-allowed border-slate-200 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400 focus:outline-none focus:ring-0'
                              : 'bg-slate-50/60 border-slate-200 focus:bg-white focus:border-emerald-500 dark:border-slate-700 dark:bg-slate-800 dark:focus:bg-slate-900 dark:text-white'
                          }`}
                        />
                      </div>
                    </div>

                    <div className="overflow-hidden rounded-xl border border-slate-200/90 divide-y divide-slate-100 bg-white dark:border-slate-800 dark:divide-slate-800 dark:bg-slate-900">
                      <div className="flex items-center justify-between px-4 py-3 text-sm">
                        <span className="font-bold text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
                          <span>Balance in previous month</span>
                          {!canEditFundOpeningBalance && (
                            <LockClosedIcon className="h-3.5 w-3.5 text-slate-400 shrink-0" title="Locked: Carried over from previous month current balance" />
                          )}
                        </span>
                        <span className="font-black text-slate-900 dark:text-white">{formatCurrency(prevBal)}</span>
                      </div>
                      <div className="flex items-center justify-between px-4 py-3 text-sm">
                        <span className="font-bold text-slate-600 dark:text-slate-400">Net Income Share</span>
                        <span className="font-black text-slate-900 dark:text-white">{formatCurrency(netInc)}</span>
                      </div>
                      <div className="flex items-center justify-between px-4 py-3 text-sm">
                        <span className="font-bold text-slate-600 dark:text-slate-400">Total Current Expenses</span>
                        <span className="font-bold text-rose-600 dark:text-rose-400">{formatCurrency(totalExpVal)}</span>
                      </div>
                      <div className="flex items-center justify-between px-4 py-3.5 text-base bg-emerald-50/30 dark:bg-emerald-950/30">
                        <span className="font-black text-slate-950 dark:text-white">Current Balance</span>
                        <span className="font-black text-emerald-600 dark:text-emerald-400 text-lg">{formatCurrency(currentBalVal)}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    );

    const expensesListContent = (
      <div className="min-w-0 w-full space-y-5">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <MetricTile
            label="Total Expenses This Month"
            value={formatCurrency(selectedReport?.total_operating_expenses)}
            tone="rose"
            icon={ReceiptPercentIcon}
          />
          <MetricTile
            label="Expense History Rows"
            value={String(filteredExpenseRows.length)}
            tone="sky"
            icon={ClipboardDocumentListIcon}
          />
        </div>

        <section className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-black text-slate-900 dark:text-white">Expense Summary by Category</h2>
              <p className="mt-0.5 text-xs font-medium text-slate-500 dark:text-slate-400">{selectedReport?.month_label}</p>
            </div>
            <FunnelIcon className="h-5 w-5 text-slate-400" />
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {expenseSummary.length ? (
              expenseSummary.map((item) => (
                <div key={item.category} className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-3.5 dark:border-slate-800 dark:bg-slate-800/60">
                  <div className="text-xs font-bold text-slate-600 dark:text-slate-400">{item.category}</div>
                  <div className="mt-1 text-base font-mono font-black text-slate-900 dark:text-white">{formatCurrency(item.amount)}</div>
                </div>
              ))
            ) : (
              <div className="col-span-full rounded-xl border border-dashed border-slate-200 p-6 text-center text-xs font-medium text-slate-500 dark:border-slate-800 dark:text-slate-400">
                No expenses recorded for this month.
              </div>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-slate-900 space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_200px_200px]">
            <FormField label="Search Expenses">
              <div className="relative">
                <MagnifyingGlassIcon className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                <input
                  type="search"
                  value={expenseSearch}
                  onChange={(event) => setExpenseSearch(event.target.value)}
                  placeholder="Search expenses..."
                  className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50/50 pl-10 pr-4 text-sm font-semibold text-slate-900 shadow-2xs outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </div>
            </FormField>
            <FormField label="Filter by Category">
              <select
                value={expenseCategoryFilter}
                onChange={(event) => setExpenseCategoryFilter(event.target.value)}
                className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 text-sm font-bold text-slate-700 shadow-2xs outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                <option value="">All Categories</option>
                {EXPENSE_CATEGORY_OPTIONS.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Filter by Month">
              <input
                type="month"
                value={expenseDateFilter}
                onChange={(event) => setExpenseDateFilter(event.target.value)}
                className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 text-sm font-semibold text-slate-900 shadow-2xs outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              />
            </FormField>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-2xs dark:border-slate-800 dark:bg-slate-900">
            <div className="w-full overflow-hidden">
              {/* Desktop & Tablet Table (Fits fluidly on any screen width without horizontal scrollbars) */}
              <div className="hidden sm:block">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200/80 bg-slate-50/80 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-400">
                    <tr>
                      <th className="px-3 py-3 w-16">Type</th>
                      <th className="px-3 py-3 w-24">Date</th>
                      <th className="px-3 py-3">Category</th>
                      <th className="px-3 py-3 text-right w-28">Amount</th>
                      <th className="px-3 py-3 hidden md:table-cell">Supplier</th>
                      <th className="px-3 py-3 hidden lg:table-cell">Description</th>
                      <th className="px-3 py-3 text-center w-24">Receipt</th>
                      <th className="px-3 py-3 text-center w-20">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white dark:divide-slate-800 dark:bg-slate-900">
                    {paginatedExpenseRows.length ? (
                      paginatedExpenseRows.map((row) => (
                        <tr key={row.id} className="transition hover:bg-slate-50/70 dark:hover:bg-slate-800/50">
                          <td className="px-3 py-3 whitespace-nowrap">
                            <span
                              className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                                row.source === 'daily'
                                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                                  : 'bg-sky-50 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300'
                              }`}
                            >
                              {row.source === 'daily' ? 'Daily' : 'Monthly'}
                            </span>
                          </td>
                          <td className="px-3 py-3 font-mono text-xs text-slate-600 dark:text-slate-400 whitespace-nowrap">
                            {row.date}
                          </td>
                          <td className="px-3 py-3 text-xs font-semibold text-slate-800 dark:text-slate-200">
                            <span className="block truncate max-w-[130px] xl:max-w-none" title={row.category}>
                              {row.category}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-right font-mono text-xs font-black text-rose-700 dark:text-rose-400 whitespace-nowrap">
                            {formatCurrency(row.amount)}
                          </td>
                          <td className="px-3 py-3 text-xs text-slate-600 dark:text-slate-400 hidden md:table-cell">
                            <span className="block truncate max-w-[110px] xl:max-w-none" title={row.supplier || '-'}>
                              {row.supplier || '-'}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-xs text-slate-600 dark:text-slate-400 hidden lg:table-cell">
                            <span className="block truncate max-w-[130px] xl:max-w-none" title={row.description || '-'}>
                              {row.description || '-'}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-center whitespace-nowrap">
                            {row.receipt && row.receipt !== 'No receipt' && row.receipt !== '-' ? (
                              <button
                                type="button"
                                onClick={() => setActivePreviewReceipt(row)}
                                className="group inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-700 transition hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                                title={`Click to preview receipt: ${row.receipt}`}
                              >
                                <PhotoIcon className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                                <span className="max-w-[65px] truncate font-mono text-[10px]">
                                  {row.receipt}
                                </span>
                                <EyeIcon className="h-3 w-3 shrink-0 opacity-70 group-hover:opacity-100 transition-opacity" />
                              </button>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-xs text-slate-400">
                                <MinusCircleIcon className="h-3.5 w-3.5 text-slate-300 dark:text-slate-600" />
                                <span className="hidden xl:inline text-[11px]">None</span>
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-3 text-center whitespace-nowrap">
                            <div className="inline-flex items-center gap-1 justify-center">
                              <button
                                type="button"
                                onClick={() => handleOpenEditExpense(row)}
                                disabled={!isAdmin || !canSaveSelectedSchoolYear}
                                className="rounded-lg p-1.5 text-slate-500 hover:bg-emerald-50 hover:text-emerald-700 transition disabled:opacity-30 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-emerald-400"
                                title={isAdmin ? 'Edit Expense' : 'Admin only'}
                              >
                                <PencilSquareIcon className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleOpenDeleteExpense(row)}
                                disabled={!isAdmin || !canSaveSelectedSchoolYear}
                                className="rounded-lg p-1.5 text-slate-500 hover:bg-rose-50 hover:text-rose-600 transition disabled:opacity-30 dark:text-slate-400 dark:hover:bg-rose-950/60 dark:hover:text-rose-400"
                                title={isAdmin ? 'Delete Expense' : 'Admin only'}
                              >
                                <TrashIcon className="h-4 w-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={8} className="px-6 py-12 text-center text-sm font-semibold text-slate-500 dark:text-slate-400">
                          No expenses match the current filters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Mobile Card List (< sm / small screens) */}
              <div className="block sm:hidden divide-y divide-slate-100 dark:divide-slate-800">
                {paginatedExpenseRows.length ? (
                  paginatedExpenseRows.map((row) => (
                    <div key={row.id} className="p-4 space-y-2.5 transition hover:bg-slate-50/70 dark:hover:bg-slate-800/50">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                              row.source === 'daily'
                                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                                : 'bg-sky-50 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300'
                            }`}
                          >
                            {row.source === 'daily' ? 'Daily' : 'Monthly'}
                          </span>
                          <span className="text-xs font-bold text-slate-900 dark:text-white truncate">
                            {row.category}
                          </span>
                        </div>
                        <div className="font-mono text-sm font-black text-rose-700 dark:text-rose-400 shrink-0">
                          {formatCurrency(row.amount)}
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                        <span className="font-mono">{row.date}</span>
                        {row.supplier && row.supplier !== '-' ? (
                          <span className="truncate max-w-[150px]">{row.supplier}</span>
                        ) : null}
                      </div>

                      <div className="text-xs text-slate-600 dark:text-slate-300 truncate">
                        {row.description}
                      </div>

                      <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800">
                        {row.receipt && row.receipt !== 'No receipt' && row.receipt !== '-' ? (
                          <button
                            type="button"
                            onClick={() => setActivePreviewReceipt(row)}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                          >
                            <PhotoIcon className="h-3.5 w-3.5 text-emerald-600" />
                            <span className="max-w-[120px] truncate font-mono">{row.receipt}</span>
                            <EyeIcon className="h-3.5 w-3.5 opacity-70" />
                          </button>
                        ) : (
                          <span className="text-xs text-slate-400">No receipt</span>
                        )}

                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleOpenEditExpense(row)}
                            disabled={!isAdmin || !canSaveSelectedSchoolYear}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                          >
                            <PencilSquareIcon className="h-3.5 w-3.5 text-slate-500" />
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleOpenDeleteExpense(row)}
                            disabled={!isAdmin || !canSaveSelectedSchoolYear}
                            className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-bold text-rose-700 hover:bg-rose-100 disabled:opacity-40 dark:border-rose-900/60 dark:bg-rose-950/60 dark:text-rose-300"
                          >
                            <TrashIcon className="h-3.5 w-3.5 text-rose-600" />
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="px-6 py-12 text-center text-sm font-semibold text-slate-500 dark:text-slate-400">
                    No expenses match the current filters.
                  </div>
                )}
              </div>
            </div>

            {filteredExpenseRows.length > 0 && (
              <div className="flex flex-col gap-3 border-t border-slate-100 p-4 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                  Showing {expenseStartCount}-{expenseEndCount} of {filteredExpenseRows.length} expenses
                </div>

                {totalExpensePages > 1 && (
                  <div className="flex w-full flex-wrap items-center justify-center gap-1.5 sm:w-auto sm:justify-end sm:gap-2">
                    <button
                      type="button"
                      onClick={() => setExpensePage(Math.max(1, safeExpensePage - 1))}
                      disabled={safeExpensePage === 1}
                      aria-label="Previous expense page"
                      className="inline-flex h-9 items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-bold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                    >
                      <ChevronLeftIcon className="h-4 w-4" />
                      <span className="hidden sm:inline">Previous</span>
                    </button>

                    {expensePageNumbers.map((pageNumber) => (
                      <button
                        key={pageNumber}
                        type="button"
                        onClick={() => setExpensePage(pageNumber)}
                        aria-current={pageNumber === safeExpensePage ? 'page' : undefined}
                        className={`inline-flex h-9 min-w-9 items-center justify-center rounded-xl px-2 text-xs font-bold transition ${
                          pageNumber === safeExpensePage
                            ? 'bg-emerald-600 text-white font-black'
                            : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                        }`}
                      >
                        {pageNumber}
                      </button>
                    ))}

                    <button
                      type="button"
                      onClick={() => setExpensePage(Math.min(totalExpensePages, safeExpensePage + 1))}
                      disabled={safeExpensePage === totalExpensePages}
                      aria-label="Next expense page"
                      className="inline-flex h-9 items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-bold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                    >
                      <span className="hidden sm:inline">Next</span>
                      <ChevronRightIcon className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      </div>
    );

    const expensesContent = (
      <div className="space-y-5 animate-in fade-in duration-200">
        {expenseSuccessAlert && (
          <DismissibleAlert
            resetKey={expenseSuccessAlert.id}
            tone="emerald"
            icon={CheckCircleIcon}
            title={`${expenseSuccessAlert.typeLabel} Successfully Recorded!`}
            className="rounded-2xl border-emerald-300 bg-emerald-50 text-emerald-950 shadow-sm"
          >
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4 text-xs font-semibold text-emerald-900">
              <div className="rounded-xl bg-white/80 p-2.5 border border-emerald-200 shadow-2xs">
                <span className="text-slate-500 font-bold uppercase text-xs block">Category</span>
                <span className="font-bold text-slate-900">{expenseSuccessAlert.category}</span>
              </div>
              <div className="rounded-xl bg-white/80 p-2.5 border border-emerald-200 shadow-2xs">
                <span className="text-slate-500 font-bold uppercase text-xs block">Amount Paid</span>
                <span className="font-black text-rose-700 text-sm">{expenseSuccessAlert.amount}</span>
              </div>
              <div className="rounded-xl bg-white/80 p-2.5 border border-emerald-200 shadow-2xs">
                <span className="text-slate-500 font-bold uppercase text-xs block">Date / Period</span>
                <span className="font-bold text-slate-900">{expenseSuccessAlert.date}</span>
              </div>
              <div className="rounded-xl bg-white/80 p-2.5 border border-emerald-200 shadow-2xs">
                <span className="text-slate-500 font-bold uppercase text-xs block">Receipt</span>
                <span className="font-mono text-slate-900 truncate block" title={expenseSuccessAlert.receiptName || 'None'}>
                  {expenseSuccessAlert.receiptName || 'No receipt'}
                </span>
              </div>
            </div>
          </DismissibleAlert>
        )}

        {isAdmin ? (
          <div className="grid grid-cols-1 gap-5 2xl:grid-cols-[340px_minmax(0,1fr)]">
            <section className="min-w-0 w-full rounded-2xl border border-slate-200/90 bg-white p-5 sm:p-6 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-rose-100 bg-rose-50 text-rose-600 dark:border-rose-900/60 dark:bg-rose-950/60 dark:text-rose-400">
                  <ReceiptPercentIcon className="h-5 w-5 stroke-[2]" />
                </div>
                <div>
                  <h2 className="text-base font-black text-slate-900 dark:text-white">Add Expense</h2>
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Record one expense item.</p>
                </div>
              </div>

              <div className="mt-5 space-y-4">
                <FormField label="Expense Type">
                  <div className="grid grid-cols-2 gap-1.5 rounded-xl border border-slate-200/80 bg-slate-100/90 p-1 dark:border-slate-800 dark:bg-slate-800/80">
                    {EXPENSE_TYPE_OPTIONS.map((option) => {
                      const active = expenseEntryDraft.type === option.key;
                      return (
                        <button
                          key={option.key}
                          type="button"
                          onClick={() =>
                            setExpenseEntryDraft((draft) => ({
                              ...draft,
                              type: option.key,
                              month: draft.month || getReportMonthValue(selectedReport),
                            }))
                          }
                          className={`h-9 rounded-lg px-3 text-xs font-bold transition ${
                            active
                              ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white font-black'
                              : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                          }`}
                          aria-pressed={active}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </FormField>
                {expenseEntryDraft.type === 'monthly' ? (
                  <FormField label="Month">
                    <select
                      value={expenseEntryDraft.month || getReportMonthValue(selectedReport)}
                      onChange={(event) => setExpenseEntryDraft((draft) => ({ ...draft, month: event.target.value }))}
                      className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 text-sm font-bold text-slate-700 shadow-2xs outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                    >
                      {(detail?.reports || []).map((report) => (
                        <option key={report.id} value={getReportMonthValue(report)}>
                          {report.month_label}
                        </option>
                      ))}
                    </select>
                  </FormField>
                ) : (
                  <FormField label="Date">
                    <input
                      type="date"
                      value={expenseEntryDraft.date}
                      onChange={(event) => setExpenseEntryDraft((draft) => ({ ...draft, date: event.target.value }))}
                      className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 text-sm font-semibold text-slate-900 shadow-2xs outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    />
                  </FormField>
                )}
                <FormField label="Expense Category">
                  <select
                    value={expenseEntryDraft.category}
                    onChange={(event) => setExpenseEntryDraft((draft) => ({ ...draft, category: event.target.value }))}
                    className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 text-sm font-bold text-slate-700 shadow-2xs outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  >
                    {EXPENSE_CATEGORY_OPTIONS.map((category) => (
                      <option key={category} value={category}>
                        {category}
                      </option>
                    ))}
                  </select>
                </FormField>
                <FormField
                  label="Amount"
                  value={expenseEntryDraft.amount}
                  onChange={(event) => setExpenseEntryDraft((draft) => ({ ...draft, amount: event.target.value }))}
                  min="0"
                  step="0.01"
                />
                <FormField label="Supplier">
                  <input
                    type="text"
                    value={expenseEntryDraft.supplier}
                    onChange={(event) => setExpenseEntryDraft((draft) => ({ ...draft, supplier: event.target.value }))}
                    placeholder="Optional supplier"
                    className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 text-sm font-semibold text-slate-900 shadow-2xs outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </FormField>
                <FormField label="Description">
                  <textarea
                    value={expenseEntryDraft.description}
                    onChange={(event) => setExpenseEntryDraft((draft) => ({ ...draft, description: event.target.value }))}
                    rows={3}
                    placeholder="Optional description"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50/50 p-3 text-sm font-semibold text-slate-900 shadow-2xs outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white resize-none"
                  />
                </FormField>
                <FormField label="Receipt Upload (Optional)">
                  <div className="space-y-2.5">
                    <input
                      ref={expenseFileInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif,application/pdf"
                      onChange={handleReceiptFileChange}
                      className="hidden"
                    />

                    {!expenseReceiptValidation ? (
                      <button
                        type="button"
                        onClick={() => expenseFileInputRef.current?.click()}
                        className="group flex w-full items-center justify-between gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-3 text-left transition hover:border-emerald-500 hover:bg-emerald-50/40 dark:border-slate-700 dark:bg-slate-800/60 dark:hover:border-emerald-500 dark:hover:bg-emerald-950/20"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition group-hover:border-emerald-300 group-hover:text-emerald-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:group-hover:text-emerald-400">
                            <ArrowUpTrayIcon className="h-4 w-4" />
                          </div>
                          <div className="min-w-0">
                            <div className="text-xs font-bold text-slate-700 dark:text-slate-200 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
                              Choose a File
                            </div>
                            <div className="text-[11px] text-slate-400 dark:text-slate-500">
                              JPG, PNG, WEBP, GIF, PDF (Max: 5 MB)
                            </div>
                          </div>
                        </div>
                        <span className="shrink-0 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold text-slate-700 shadow-2xs group-hover:border-emerald-300 group-hover:text-emerald-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:group-hover:border-emerald-700 dark:group-hover:text-emerald-300 transition-colors">
                          Browse
                        </span>
                      </button>
                    ) : (
                      <div className="flex items-center justify-between rounded-xl border border-emerald-300/80 bg-emerald-50/80 p-3 dark:border-emerald-800/80 dark:bg-emerald-950/40">
                        <div className="flex items-center gap-2.5 overflow-hidden">
                          {expenseReceiptDataUrl && !expenseReceiptValidation.isPdf ? (
                            <img
                              src={expenseReceiptDataUrl}
                              alt="Receipt thumbnail"
                              className="h-10 w-10 shrink-0 rounded-lg object-cover border border-emerald-300 shadow-2xs"
                            />
                          ) : (
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300">
                              <PhotoIcon className="h-5 w-5" />
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate text-xs font-bold text-slate-900 dark:text-white font-mono" title={expenseEntryDraft.receiptName}>
                                {expenseEntryDraft.receiptName}
                              </span>
                              <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-900/80 dark:text-emerald-200">
                                <ShieldCheckIcon className="h-3 w-3" />
                                Ready
                              </span>
                            </div>
                            <span className="text-xs text-slate-500 dark:text-slate-400">
                              {expenseReceiptValidation.sizeFormatted}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleQuickPreviewUploadedReceipt(selectedReport)}
                            title="Preview uploaded receipt"
                            className="rounded-lg p-1.5 text-emerald-700 hover:bg-emerald-100 transition dark:text-emerald-300 dark:hover:bg-emerald-900/50"
                          >
                            <EyeIcon className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => expenseFileInputRef.current?.click()}
                            title="Change file"
                            className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-200/60 transition dark:text-slate-300 dark:hover:bg-slate-800"
                          >
                            <ArrowPathIcon className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={handleClearReceiptUpload}
                            title="Remove receipt"
                            className="rounded-lg p-1.5 text-rose-600 hover:bg-rose-100 transition dark:text-rose-400 dark:hover:bg-rose-950/60"
                          >
                            <TrashIcon className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    )}

                    {expenseReceiptError && (
                      <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/60 dark:text-rose-300">
                        <ExclamationTriangleIcon className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400 mt-0.5" />
                        <span>{expenseReceiptError}</span>
                      </div>
                    )}
                  </div>
                </FormField>
                <button
                  type="button"
                  onClick={handleAddExpenseEntry}
                  disabled={savingExpenseEntry || !canSaveSelectedSchoolYear}
                  className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-xs font-black text-white shadow-xs transition hover:bg-emerald-700 active:scale-95 disabled:opacity-50"
                >
                  <PlusIcon className="h-4 w-4 stroke-[2.5]" />
                  {savingExpenseEntry
                    ? 'Adding...'
                    : expenseEntryDraft.type === 'monthly'
                      ? 'Add Monthly Expense'
                      : 'Add Daily Expense'}
                </button>
              </div>
            </section>

            {expensesListContent}
          </div>
        ) : (
          expensesListContent
        )}
      </div>
    );

    return (
      <div className="view-shell overflow-x-hidden pr-0 space-y-5">
        <PageHeader
          page={PAGE_COPY['financial-management']}
          actions={
            <>
              {!isAdmin && (
                <span className="inline-flex items-center gap-1.5 rounded-xl bg-slate-100 px-3.5 py-2 text-xs font-bold text-slate-600 border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  <EyeIcon className="h-4 w-4 text-slate-500" /> Read-Only View
                </span>
              )}
              <button
                type="button"
                onClick={handleExportWorkbook}
                disabled={exportingWorkbook || !selectedSchoolYearId}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-black text-white shadow-xs transition hover:bg-emerald-700 active:scale-95 disabled:opacity-50"
              >
                <TableCellsIcon className="h-4 w-4 stroke-[2.5]" />
                {exportingWorkbook ? 'Preparing...' : 'Export Excel'}
              </button>
              <button
                type="button"
                onClick={handleExportFinancialPdf}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-bold text-slate-700 shadow-2xs transition hover:bg-slate-50 active:scale-95 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                <DocumentArrowDownIcon className="h-4 w-4 text-slate-500" />
                Export PDF
              </button>
              <button
                type="button"
                onClick={handlePrintFinancialReport}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-bold text-slate-700 shadow-2xs transition hover:bg-slate-50 active:scale-95 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                <PrinterIcon className="h-4 w-4 text-slate-500" />
                Print Report
              </button>
            </>
          }
        />

        {renderSelectors()}
        <ValidationNotice message={selectedSchoolYearValidationMessage} />

        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200/90 bg-slate-100/90 p-1.5 dark:border-slate-800 dark:bg-slate-800/80 w-fit">
          {[
            { id: 'overview', label: 'Overview', icon: BanknotesIcon },
            { id: 'daily-sales', label: 'Daily Sales', icon: DocumentChartBarIcon, badge: filteredDailySalesRows.length },
            { id: 'expenses', label: 'Expenses', icon: ReceiptPercentIcon, badge: filteredExpenseRows.length },
            { id: 'fund-allocation', label: 'Fund Allocation', icon: ChartPieIcon },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = currentTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => handleTabChange(tab.id)}
                className={`flex items-center gap-2.5 rounded-xl px-5 py-2.5 text-xs sm:text-sm font-bold transition-all shadow-2xs ${
                  isActive
                    ? 'bg-white text-emerald-700 shadow-sm dark:bg-slate-900 dark:text-emerald-400 font-black ring-1 ring-emerald-500/20'
                    : 'text-slate-600 hover:bg-white/70 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-white'
                }`}
              >
                <Icon className={`h-4 w-4 shrink-0 transition-colors ${isActive ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400 group-hover:text-slate-600 dark:text-slate-500'}`} />
                <span>{tab.label}</span>
                {tab.badge !== undefined && tab.badge > 0 ? (
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${
                    isActive
                      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                      : 'bg-slate-200/80 text-slate-700 dark:bg-slate-700 dark:text-slate-300'
                  }`}>
                    {tab.badge}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        {detailLoading ? (
          <div className="rounded-2xl border border-slate-200/90 bg-white p-12 text-center shadow-2xs dark:border-slate-800 dark:bg-slate-900">
            <div className="text-sm font-bold text-slate-500">Loading financial details...</div>
          </div>
        ) : null}

        {!detailLoading && selectedReport ? (
          currentTab === 'overview'
            ? overviewContent
            : currentTab === 'daily-sales' || currentTab === 'sales'
            ? dailySalesContent
            : currentTab === 'expenses'
            ? expensesContent
            : fundAllocationContent
        ) : null}
      </div>
    );
  }

  function renderFinancialPage() {
    return renderFinancialManagementPage();
  }

  function renderSalesPage() {
    return renderFinancialManagementPage();
  }

  function renderExpensesPage() {
    return renderFinancialManagementPage();
  }

  function renderReportsPage() {
    return (
      <div className="view-shell overflow-x-hidden pr-0 space-y-5">
        <PageHeader
          page={PAGE_COPY.reports}
          actions={
            <>
              <button
                type="button"
                onClick={handleExportWorkbook}
                disabled={exportingWorkbook || !selectedSchoolYearId}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-black text-white shadow-xs transition hover:bg-emerald-700 active:scale-95 disabled:opacity-50"
              >
                <TableCellsIcon className="h-4 w-4 stroke-[2.5]" />
                {exportingWorkbook ? 'Preparing...' : 'Export Excel'}
              </button>
              <button
                type="button"
                onClick={handleExportGeneratedPdf}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-bold text-slate-700 shadow-2xs transition hover:bg-slate-50 active:scale-95 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                <DocumentArrowDownIcon className="h-4 w-4 text-slate-500" />
                Export PDF
              </button>
              <button
                type="button"
                onClick={handlePrintGeneratedReport}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-bold text-slate-700 shadow-2xs transition hover:bg-slate-50 active:scale-95 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                <PrinterIcon className="h-4 w-4 text-slate-500" />
                Print
              </button>
            </>
          }
        />
        {renderSelectors({ compact: true })}

        <div className="grid grid-cols-1 gap-5 2xl:grid-cols-[320px_minmax(0,1fr)]">
          <section className="min-w-0 w-full rounded-2xl border border-slate-200/90 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
            <h2 className="text-base font-black text-slate-900 dark:text-white">Report Type</h2>
            <div className="mt-4 space-y-2">
              {REPORT_TYPES.map((item) => {
                const Icon = item.icon;
                const active = reportType === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setReportType(item.key)}
                    className={`w-full rounded-xl border p-3.5 text-left transition ${
                      active
                        ? 'border-emerald-500 bg-emerald-50/50 text-emerald-950 shadow-xs ring-1 ring-emerald-500/20 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${
                        active ? 'border-emerald-200 bg-emerald-100 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900 dark:text-emerald-300' : 'border-slate-200/60 bg-slate-100 text-slate-500 dark:border-slate-700 dark:bg-slate-700 dark:text-slate-300'
                      }`}>
                        <Icon className="h-5 w-5 stroke-[2]" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-black text-slate-900 dark:text-white">{item.label}</div>
                        <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{item.description}</div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="min-w-0 w-full rounded-2xl border border-slate-200/90 bg-white p-5 sm:p-6 shadow-2xs dark:border-slate-800 dark:bg-slate-900 space-y-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200/80 bg-slate-100 px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  <EyeIcon className="h-3.5 w-3.5" />
                  Preview
                </div>
                <h2 className="mt-2 text-xl font-black text-slate-900 dark:text-white">{generatedReportPayload.title}</h2>
                <p className="mt-0.5 text-xs font-medium text-slate-500 dark:text-slate-400">{generatedReportPayload.subtitle}</p>
              </div>
              <DocumentTextIcon className="h-8 w-8 text-slate-400" />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {generatedReportPayload.metrics.map(([label, value], idx) => {
                const tones = ['emerald', 'rose', 'sky', 'teal'];
                return (
                  <MetricTile key={label} label={label} value={formatCurrency(value)} tone={tones[idx % tones.length]} />
                );
              })}
            </div>

            <div className="overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-2xs dark:border-slate-800 dark:bg-slate-900">
              <div className="overflow-x-auto custom-scrollbar">
                <table className="w-full min-w-[650px] text-left text-sm">
                  <tbody className="divide-y divide-slate-100 bg-white dark:divide-slate-800 dark:bg-slate-900">
                    {generatedReportPayload.rows.map((row, rowIndex) => (
                      <tr key={`${row[0]}-${rowIndex}`} className="transition hover:bg-slate-50/70 dark:hover:bg-slate-800/50">
                        {row.map((cell, cellIndex) => (
                          <td
                            key={`${cell}-${cellIndex}`}
                            className={`px-5 py-3.5 text-sm ${
                              cellIndex === 0 ? 'font-black text-slate-900 dark:text-white' : 'text-right font-mono font-bold text-slate-700 dark:text-slate-300'
                            }`}
                          >
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </div>
      </div>
    );
  }

  function renderSchoolYearsPage() {
    const activeSchoolYear = schoolYears.find((schoolYear) => schoolYear.is_active) || null;
    const selectedSchoolYearSummary =
      schoolYears.find((schoolYear) => Number(schoolYear.id) === Number(selectedSchoolYearId)) || selectedSchoolYear;

    return (
      <div className="view-shell overflow-x-hidden pr-0 space-y-5">
        <PageHeader
          page={PAGE_COPY.schoolYears}
          actions={
            isAdmin ? (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowHistoricalModal(true)}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-xs font-black text-slate-700 shadow-2xs transition hover:bg-slate-50 hover:text-slate-900 active:scale-95 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-750"
                  title="Add previous/historical school year for entering old records"
                >
                  <ClockIcon className="h-4 w-4 stroke-[2.2] text-amber-600 dark:text-amber-400" />
                  Add Historical Year
                </button>
                <button
                  type="button"
                  onClick={handleCreateNextSchoolYear}
                  disabled={creatingSchoolYear || (currentSchoolYearExists && nextSchoolYearExists)}
                  className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-black shadow-xs transition active:scale-95 ${
                    currentSchoolYearExists && nextSchoolYearExists
                      ? 'border border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed dark:border-slate-700 dark:bg-slate-800 dark:text-slate-500'
                      : 'bg-emerald-600 text-white hover:bg-emerald-700'
                  }`}
                  title={
                    !currentSchoolYearExists
                      ? `Create current school year ${currentSchoolYearLabel}`
                      : nextSchoolYearExists
                      ? `Next school year ${nextSchoolYearLabel} has already been created`
                      : `Create next school year ${nextSchoolYearLabel}`
                  }
                >
                  <PlusIcon className="h-4 w-4 stroke-[2.5]" />
                  {creatingSchoolYear
                    ? 'Creating...'
                    : !currentSchoolYearExists
                    ? `Create Current Year (${currentSchoolYearLabel})`
                    : nextSchoolYearExists
                    ? `Next Year (${nextSchoolYearLabel}) Exists`
                    : `Create Next School Year (${nextSchoolYearLabel})`}
                </button>
              </div>
            ) : null
          }
        />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <MetricTile
            label="Active School Year"
            value={activeSchoolYear?.name || 'None'}
            tone="emerald"
            icon={CheckCircleIcon}
          />
          <MetricTile
            label="Opening Beginning Cash"
            value={formatCurrency(getSchoolYearOpeningCash(selectedSchoolYearSummary, detail))}
            tone="sky"
            icon={BanknotesIcon}
          />
          <MetricTile
            label="Ending Balance"
            value={formatCurrency(getSchoolYearEndingBalance(selectedSchoolYearSummary, detail))}
            tone="teal"
            icon={ScaleIcon}
          />
        </div>

        <div className="grid grid-cols-1 gap-5 2xl:grid-cols-[minmax(0,1fr)_340px]">
          <section className="min-w-0 w-full rounded-2xl border border-slate-200/90 bg-white p-5 sm:p-6 shadow-2xs dark:border-slate-800 dark:bg-slate-900 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-black text-slate-900 dark:text-white">List of School Years</h2>
                <p className="mt-0.5 text-xs font-medium text-slate-500 dark:text-slate-400">Active years are open; archived years are closed.</p>
              </div>
              <CalendarDaysIcon className="h-6 w-6 text-slate-400" />
            </div>

            <div className="overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-2xs dark:border-slate-800 dark:bg-slate-900">
              <div className="w-full overflow-hidden">
                <table className="w-full text-left text-xs sm:text-sm">
                  <thead className="border-b border-slate-200/80 bg-slate-50/80 text-[11px] sm:text-xs font-bold uppercase tracking-wider text-slate-500 dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-400">
                    <tr>
                      <th className="px-3 sm:px-5 py-3.5">School Year</th>
                      <th className="px-2 sm:px-3 py-3.5">Status</th>
                      <th className="px-2 sm:px-3 py-3.5 text-right">Opening Cash</th>
                      <th className="px-2 sm:px-3 py-3.5 text-right">Ending Balance</th>
                      <th className="px-3 sm:px-5 py-3.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white dark:divide-slate-800 dark:bg-slate-900">
                    {schoolYears.map((schoolYear) => {
                      const selectedRow = Number(schoolYear.id) === Number(selectedSchoolYearId);
                      const rowIsActive = Boolean(schoolYear.is_active);
                      const isHistorical = Number(schoolYear.start_year) < schoolYearSuggestion.startYear;
                      return (
                        <tr key={schoolYear.id} className={`transition hover:bg-slate-50/70 dark:hover:bg-slate-800/50 ${selectedRow || rowIsActive ? 'bg-emerald-50/20 dark:bg-emerald-950/20' : ''}`}>
                          <td className="px-3 sm:px-5 py-3.5">
                            <span className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white">{schoolYear.name}</span>
                            <div className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">
                              {schoolYear.months_with_entries || 0} of {schoolYear.report_count || 12} months
                            </div>
                          </td>
                          <td className="px-2 sm:px-3 py-3.5">
                            <span
                              className={`inline-flex rounded-lg px-2 py-0.5 text-xs font-bold ${
                                schoolYear.is_active
                                  ? 'border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300'
                                  : isHistorical
                                  ? 'border border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-300'
                                  : 'border border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                              }`}
                            >
                              {rowIsActive ? 'Active' : isHistorical ? 'Archived (Historical)' : 'Archived'}
                            </span>
                          </td>
                          <td className="px-2 sm:px-3 py-3.5 text-right font-mono text-xs sm:text-sm font-bold text-slate-700 dark:text-slate-300 whitespace-nowrap">
                            {formatCurrency(getSchoolYearOpeningCash(schoolYear, detail))}
                          </td>
                          <td className="px-2 sm:px-3 py-3.5 text-right font-mono text-xs sm:text-sm font-black text-slate-900 dark:text-white whitespace-nowrap">
                            {formatCurrency(getSchoolYearEndingBalance(schoolYear, detail))}
                          </td>
                          <td className="px-3 sm:px-5 py-3.5 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => loadSchoolYearDetail(schoolYear.id)}
                                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 shadow-2xs transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                              >
                                <PencilSquareIcon className="h-3.5 w-3.5" />
                                Edit
                              </button>
                              {isAdmin && !isHistorical ? (
                                <button
                                  type="button"
                                  onClick={() => handleUpdateSchoolYearStatus(schoolYear.id, !rowIsActive)}
                                  disabled={updatingSchoolYear || rowIsActive}
                                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 shadow-2xs transition hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                                  title={rowIsActive ? 'Activate another school year before archiving this one' : `Archive ${schoolYear.name}`}
                                >
                                  <ArchiveBoxIcon className="h-3.5 w-3.5" />
                                  Archive
                                </button>
                              ) : null}
                              {isAdmin ? (
                                <button
                                  type="button"
                                  onClick={() => handleDeleteSchoolYear(schoolYear.id)}
                                  disabled={deletingSchoolYear}
                                  className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-bold text-rose-700 shadow-2xs transition hover:bg-rose-100 disabled:opacity-40 dark:border-rose-800 dark:bg-rose-950/50 dark:text-rose-300"
                                >
                                  <TrashIcon className="h-3.5 w-3.5" />
                                  Remove
                                </button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section className="min-w-0 w-full rounded-2xl border border-slate-200/90 bg-white p-5 sm:p-6 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
            <h2 className="text-base font-black text-slate-900 dark:text-white">Edit School Year</h2>
            <p className="mt-0.5 text-xs font-medium text-slate-500 dark:text-slate-400">
              New school years carry over the previous ending balance as the opening Beginning Cash. Administrators can adjust it here.
            </p>

            <div className="mt-5 space-y-4">
              <SchoolYearSelect
                schoolYears={schoolYears}
                selectedSchoolYearId={selectedSchoolYearId}
                onChange={(schoolYearId) => loadSchoolYearDetail(schoolYearId)}
              />
              <div className="grid grid-cols-2 gap-3">
                <FormField label="Start Year">
                  <input
                    type="number"
                    value={schoolYearForm.startYear}
                    onChange={(event) => setSchoolYearForm((form) => ({ ...form, startYear: event.target.value }))}
                    disabled={!isAdmin}
                    className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 text-sm font-semibold text-slate-900 shadow-2xs outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </FormField>
                <FormField label="End Year">
                  <input
                    type="number"
                    value={schoolYearForm.endYear}
                    onChange={(event) => setSchoolYearForm((form) => ({ ...form, endYear: event.target.value }))}
                    disabled={!isAdmin}
                    className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 text-sm font-semibold text-slate-900 shadow-2xs outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </FormField>
              </div>
              <FormField
                label="Opening Beginning Cash"
                value={schoolYearForm.openingBeginningCash}
                onChange={(event) =>
                  setSchoolYearForm((form) => ({
                    ...form,
                    openingBeginningCash: event.target.value,
                  }))
                }
                disabled={!isAdmin}
                min="0"
                step="0.01"
              />
              <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-800/60">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">School Year Status</div>
                <div className="mt-1 text-lg font-black text-slate-900 dark:text-white">
                  {selectedSchoolYear?.is_active ? 'Active' : 'Closed'}
                </div>
              </div>
              {isAdmin ? (
                <button
                  type="button"
                  onClick={handleSaveSchoolYearForm}
                  disabled={updatingSchoolYear}
                  className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-xs font-black text-white shadow-xs transition hover:bg-emerald-700 active:scale-95 disabled:opacity-50"
                >
                  <CheckCircleIcon className="h-4 w-4 stroke-[2.5]" />
                  {updatingSchoolYear ? 'Saving...' : 'Save School Year'}
                </button>
              ) : null}
            </div>
          </section>
        </div>
      </div>
    );
  }

  if (schoolYearsLoading) {
    return (
      <div className="view-shell">
        <div className="panel-card flex min-h-[260px] items-center justify-center">
          <div className="text-base font-bold text-slate-500">Loading financial workspace...</div>
        </div>
      </div>
    );
  }

  if (!schoolYears.length) {
    return renderEmptySchoolYears();
  }

  let content = null;
  if (normalizedMode === 'sales') {
    content = renderSalesPage();
  } else if (normalizedMode === 'reports') {
    content = renderReportsPage();
  } else if (normalizedMode === 'schoolYears') {
    content = renderSchoolYearsPage();
  } else {
    content = renderFinancialManagementPage();
  }

  return (
    <>
      {content}
      {activePreviewReceipt && (
        <ReceiptPreviewModal
          receiptData={activePreviewReceipt}
          onClose={() => setActivePreviewReceipt(null)}
          onReceiptUpdated={(updated) => {
            setActivePreviewReceipt(updated);
            if (selectedSchoolYearId) {
              loadSchoolYearDetail(selectedSchoolYearId, selectedReportId);
            }
          }}
        />
      )}
      {showHistoricalModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900 space-y-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400">
                  <ClockIcon className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900 dark:text-white">Add Historical School Year</h3>
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                    Add a previous year for entering old records
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowHistoricalModal(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleAddHistoricalYear} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Start Year
                  </label>
                  <input
                    type="number"
                    required
                    max={schoolYearSuggestion.startYear - 1}
                    value={historicalForm.startYear}
                    onChange={(e) =>
                      setHistoricalForm((prev) => ({
                        ...prev,
                        startYear: e.target.value,
                      }))
                    }
                    className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 text-sm font-semibold text-slate-900 shadow-2xs outline-none transition focus:border-amber-500 focus:bg-white focus:ring-2 focus:ring-amber-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                    placeholder="e.g. 2024"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    End Year
                  </label>
                  <input
                    type="text"
                    disabled
                    value={
                      Number.isInteger(Number(historicalForm.startYear)) && Number(historicalForm.startYear) > 1900
                        ? String(Number(historicalForm.startYear) + 1)
                        : ''
                    }
                    className="h-11 w-full rounded-xl border border-slate-200 bg-slate-100 px-3.5 text-sm font-semibold text-slate-500 shadow-2xs cursor-not-allowed dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-400"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Opening Beginning Cash
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={historicalForm.openingBeginningCash}
                  onChange={(e) =>
                    setHistoricalForm((prev) => ({
                      ...prev,
                      openingBeginningCash: e.target.value,
                    }))
                  }
                  className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 text-sm font-semibold text-slate-900 shadow-2xs outline-none transition focus:border-amber-500 focus:bg-white focus:ring-2 focus:ring-amber-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  placeholder="0.00"
                />
                <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
                  Initial starting cash for the first month (June) of this school year.
                </p>
              </div>

              <div className="rounded-xl border border-amber-200/80 bg-amber-50/70 p-3 text-xs text-amber-800 dark:border-amber-800/50 dark:bg-amber-950/30 dark:text-amber-300">
                <strong>Historical Record Notice:</strong> Historical years are permanently archived and cannot become the active school year. You will be able to enter and edit monthly reports, expenses, and allocations for this period.
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowHistoricalModal(false)}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 shadow-2xs hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingHistoricalYear}
                  className="inline-flex items-center gap-2 rounded-xl bg-amber-600 px-4 py-2.5 text-xs font-black text-white shadow-xs transition hover:bg-amber-700 active:scale-95 disabled:opacity-50"
                >
                  <PlusIcon className="h-4 w-4 stroke-[2.5]" />
                  {creatingHistoricalYear ? 'Adding...' : 'Add Historical Year'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Expense Modal */}
      {editingExpense && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900 space-y-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400">
                  <PencilSquareIcon className="h-5 w-5 stroke-[2]" />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900 dark:text-white">Edit Expense Entry</h3>
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                    Modify expense details, amount, category, or receipt
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleCloseEditExpense}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSaveEditExpense();
              }}
              className="space-y-4"
            >
              <FormField label="Expense Type">
                <div className="grid grid-cols-2 gap-1.5 rounded-xl border border-slate-200/80 bg-slate-100/90 p-1 dark:border-slate-800 dark:bg-slate-800/80">
                  {EXPENSE_TYPE_OPTIONS.map((option) => {
                    const active = editExpenseDraft.type === option.key;
                    return (
                      <button
                        key={option.key}
                        type="button"
                        onClick={() =>
                          setEditExpenseDraft((draft) => ({
                            ...draft,
                            type: option.key,
                            month: draft.month || getReportMonthValue(selectedReport),
                            date: draft.date || (editingExpense.type === 'daily' ? editingExpense.date : getTodayInputValue()),
                          }))
                        }
                        className={`h-9 rounded-lg px-3 text-xs font-bold transition ${
                          active
                            ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white font-black'
                            : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                        }`}
                        aria-pressed={active}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </FormField>

              {editExpenseDraft.type === 'monthly' ? (
                <FormField label="Month">
                  <select
                    value={editExpenseDraft.month || getReportMonthValue(selectedReport)}
                    onChange={(event) =>
                      setEditExpenseDraft((draft) => ({ ...draft, month: event.target.value }))
                    }
                    className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 text-sm font-bold text-slate-700 shadow-2xs outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  >
                    {(detail?.reports || []).map((report) => (
                      <option key={report.id} value={getReportMonthValue(report)}>
                        {report.month_label}
                      </option>
                    ))}
                  </select>
                </FormField>
              ) : (
                <FormField label="Date">
                  <input
                    type="date"
                    value={editExpenseDraft.date}
                    onChange={(event) =>
                      setEditExpenseDraft((draft) => ({ ...draft, date: event.target.value }))
                    }
                    className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 text-sm font-semibold text-slate-900 shadow-2xs outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                </FormField>
              )}

              <FormField label="Expense Category">
                <select
                  value={editExpenseDraft.category}
                  onChange={(event) =>
                    setEditExpenseDraft((draft) => ({ ...draft, category: event.target.value }))
                  }
                  className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 text-sm font-bold text-slate-700 shadow-2xs outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                >
                  {EXPENSE_CATEGORY_OPTIONS.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </FormField>

              <FormField
                label="Amount"
                value={editExpenseDraft.amount}
                onChange={(event) =>
                  setEditExpenseDraft((draft) => ({ ...draft, amount: event.target.value }))
                }
                min="0"
                step="0.01"
              />

              <FormField label="Supplier">
                <input
                  type="text"
                  value={editExpenseDraft.supplier}
                  onChange={(event) =>
                    setEditExpenseDraft((draft) => ({ ...draft, supplier: event.target.value }))
                  }
                  placeholder="Optional supplier"
                  className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 text-sm font-semibold text-slate-900 shadow-2xs outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                />
              </FormField>

              <FormField label="Description">
                <textarea
                  value={editExpenseDraft.description}
                  onChange={(event) =>
                    setEditExpenseDraft((draft) => ({ ...draft, description: event.target.value }))
                  }
                  rows={2}
                  placeholder="Optional description"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50/50 p-3 text-sm font-semibold text-slate-900 shadow-2xs outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white resize-none"
                />
              </FormField>

              <FormField label="Receipt">
                <div className="space-y-2.5">
                  <input
                    ref={editExpenseFileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif,application/pdf"
                    onChange={handleEditReceiptFileChange}
                    className="hidden"
                  />

                  {!editReceiptValidation && !editExpenseDraft.receiptName ? (
                    <button
                      type="button"
                      onClick={() => editExpenseFileInputRef.current?.click()}
                      className="group flex w-full items-center justify-between gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-3 text-left transition hover:border-emerald-500 hover:bg-emerald-50/40 dark:border-slate-700 dark:bg-slate-800/60 dark:hover:border-emerald-500 dark:hover:bg-emerald-950/20"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition group-hover:border-emerald-300 group-hover:text-emerald-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:group-hover:text-emerald-400">
                          <ArrowUpTrayIcon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-slate-700 dark:text-slate-200 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
                            Attach Receipt File
                          </div>
                          <div className="text-[11px] text-slate-400 dark:text-slate-500">
                            JPG, PNG, WEBP, GIF, PDF (Max: 5 MB)
                          </div>
                        </div>
                      </div>
                      <span className="shrink-0 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold text-slate-700 shadow-2xs group-hover:border-emerald-300 group-hover:text-emerald-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:group-hover:border-emerald-700 dark:group-hover:text-emerald-300 transition-colors">
                        Browse
                      </span>
                    </button>
                  ) : (
                    <div className="flex items-center justify-between rounded-xl border border-emerald-300/80 bg-emerald-50/80 p-3 dark:border-emerald-800/80 dark:bg-emerald-950/40">
                      <div className="flex items-center gap-2.5 overflow-hidden">
                        {editReceiptDataUrl && !editReceiptValidation?.isPdf ? (
                          <img
                            src={editReceiptDataUrl}
                            alt="Receipt preview"
                            className="h-10 w-10 shrink-0 rounded-lg object-cover border border-emerald-300 shadow-2xs"
                          />
                        ) : (
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-300">
                            <PhotoIcon className="h-5 w-5" />
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span
                              className="truncate text-xs font-bold text-slate-900 dark:text-white font-mono"
                              title={editExpenseDraft.receiptName}
                            >
                              {editExpenseDraft.receiptName}
                            </span>
                            <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-900/80 dark:text-emerald-200">
                              <ShieldCheckIcon className="h-3 w-3" />
                              {editReceiptValidation ? 'New File' : 'Existing'}
                            </span>
                          </div>
                          {editReceiptValidation?.sizeFormatted && (
                            <span className="text-xs text-slate-500 dark:text-slate-400">
                              {editReceiptValidation.sizeFormatted}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            if (editReceiptDataUrl) {
                              setActivePreviewReceipt({
                                filename: editExpenseDraft.receiptName || 'Receipt',
                                dataUrl: editReceiptDataUrl,
                                category: editExpenseDraft.category,
                                amount: editExpenseDraft.amount || 0,
                                date: editExpenseDraft.type === 'monthly' ? editExpenseDraft.month : editExpenseDraft.date,
                                supplier: editExpenseDraft.supplier,
                                description: editExpenseDraft.description,
                                type: editExpenseDraft.type,
                                isPdf: editReceiptValidation?.isPdf,
                                mimeType: editReceiptValidation?.mimeType,
                              });
                            } else if (editingExpense.receipt && editingExpense.receipt !== 'No receipt') {
                              setActivePreviewReceipt(editingExpense);
                            }
                          }}
                          title="Preview receipt"
                          className="rounded-lg p-1.5 text-emerald-700 hover:bg-emerald-100 transition dark:text-emerald-300 dark:hover:bg-emerald-900/50"
                        >
                          <EyeIcon className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => editExpenseFileInputRef.current?.click()}
                          title="Change file"
                          className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-200/60 transition dark:text-slate-300 dark:hover:bg-slate-800"
                        >
                          <ArrowPathIcon className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={handleClearEditReceiptUpload}
                          title="Remove receipt"
                          className="rounded-lg p-1.5 text-rose-600 hover:bg-rose-100 transition dark:text-rose-400 dark:hover:bg-rose-950/60"
                        >
                          <TrashIcon className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  )}

                  {editReceiptError && (
                    <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/60 dark:text-rose-300">
                      <ExclamationTriangleIcon className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400 mt-0.5" />
                      <span>{editReceiptError}</span>
                    </div>
                  )}
                </div>
              </FormField>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={handleCloseEditExpense}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 shadow-2xs hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingEditExpense || !canSaveSelectedSchoolYear}
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-black text-white shadow-xs transition hover:bg-emerald-700 active:scale-95 disabled:opacity-50"
                >
                  <PencilSquareIcon className="h-4 w-4 stroke-[2]" />
                  {savingEditExpense ? 'Saving Changes...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Expense Confirmation Modal */}
      {deletingExpense && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900 space-y-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-50 text-rose-600 dark:bg-rose-950/50 dark:text-rose-400">
                  <TrashIcon className="h-5 w-5 stroke-[2]" />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900 dark:text-white">Delete Expense Record</h3>
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                    Are you sure you want to remove this expense?
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleCloseDeleteExpense}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
              >
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <div className="rounded-xl border border-rose-200/80 bg-rose-50/70 p-3 text-xs text-rose-800 dark:border-rose-800/50 dark:bg-rose-950/30 dark:text-rose-300">
              <strong>Warning:</strong> This will delete this expense entry and update the category totals in the monthly report. Operating expenses and net profit on the overview tab will be automatically recalculated.
            </div>

            <div className="rounded-xl border border-slate-200/80 bg-slate-50/70 p-3.5 space-y-2 text-xs dark:border-slate-800 dark:bg-slate-800/60">
              <div className="flex justify-between items-center">
                <span className="text-slate-500 dark:text-slate-400 font-bold">Category:</span>
                <span className="font-bold text-slate-900 dark:text-white">{deletingExpense.category}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500 dark:text-slate-400 font-bold">Amount:</span>
                <span className="font-black text-rose-600 dark:text-rose-400 text-sm">
                  {formatCurrency(deletingExpense.amount)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500 dark:text-slate-400 font-bold">Date / Month:</span>
                <span className="font-medium text-slate-800 dark:text-slate-200">{deletingExpense.date}</span>
              </div>
              {deletingExpense.supplier && deletingExpense.supplier !== '-' && (
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 dark:text-slate-400 font-bold">Supplier:</span>
                  <span className="font-medium text-slate-800 dark:text-slate-200">{deletingExpense.supplier}</span>
                </div>
              )}
              {deletingExpense.description && deletingExpense.description !== '-' && deletingExpense.description !== 'Monthly category total' && (
                <div className="flex justify-between items-start">
                  <span className="text-slate-500 dark:text-slate-400 font-bold">Description:</span>
                  <span className="font-medium text-slate-800 dark:text-slate-200 text-right max-w-[200px] truncate" title={deletingExpense.description}>
                    {deletingExpense.description}
                  </span>
                </div>
              )}
              {deletingExpense.receipt && deletingExpense.receipt !== 'No receipt' && (
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 dark:text-slate-400 font-bold">Receipt:</span>
                  <span className="font-mono text-slate-800 dark:text-slate-200 text-right max-w-[200px] truncate" title={deletingExpense.receipt}>
                    {deletingExpense.receipt}
                  </span>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={handleCloseDeleteExpense}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 shadow-2xs hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteExpense}
                disabled={savingDeleteExpense || !canSaveSelectedSchoolYear}
                className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2.5 text-xs font-black text-white shadow-xs transition hover:bg-rose-700 active:scale-95 disabled:opacity-50"
              >
                <TrashIcon className="h-4 w-4 stroke-[2.5]" />
                {savingDeleteExpense ? 'Deleting...' : 'Delete Expense'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
