import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  BanknotesIcon,
  CalendarDaysIcon,
  ChartBarIcon,
  ChartPieIcon,
  CheckCircleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClipboardDocumentListIcon,
  DocumentArrowDownIcon,
  DocumentChartBarIcon,
  DocumentTextIcon,
  ExclamationTriangleIcon,
  EyeIcon,
  FunnelIcon,
  MagnifyingGlassIcon,
  MinusCircleIcon,
  PencilSquareIcon,
  PhotoIcon,
  PlusIcon,
  PrinterIcon,
  ReceiptPercentIcon,
  ScaleIcon,
  ShieldCheckIcon,
  TableCellsIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';

const PAGE_COPY = {
  financial: {
    eyebrow: 'Financial Reports',
    title: 'Monthly Financial Statement',
    subtitle: 'Review the month, adjust beginning cash and current sales, then export or print the statement.',
  },
  sales: {
    eyebrow: 'Daily Sales',
    title: 'Record Daily Sales',
    subtitle: 'Add one day of sales at a time and review sales entries without opening the full financial statement.',
  },
  expenses: {
    eyebrow: 'Expenses',
    title: 'Manage Expenses',
    subtitle: 'Record canteen operating expenses, filter the history, and review category totals.',
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
const CURRENT_FINANCIAL_REPORT_MESSAGE = 'Financial reports can only be saved for the current active school year.';

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
  if (comparison < 0) {
    return CURRENT_FINANCIAL_REPORT_MESSAGE;
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
  const monthlyRows = (detail?.reports || []).flatMap((report) =>
    (report.expenses || [])
      .filter((expense) => toMoney(expense.amount) > 0)
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
        type: 'summary',
        typeLabel: 'Monthly Total',
        source: 'Monthly total',
      }))
  );

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

export default function FinancialReports({ mode = 'financial' }) {
  const normalizedMode =
    mode === 'daily-sales'
      ? 'sales'
      : mode === 'school-years'
        ? 'schoolYears'
        : mode === 'expense-management'
          ? 'expenses'
            : mode;
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
  const [reportType, setReportType] = useState('monthly');
  const [schoolYearForm, setSchoolYearForm] = useState({
    startYear: '',
    endYear: '',
    openingBeginningCash: '',
  });

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
      const nextReportId =
        reports.find((report) => Number(report.id) === Number(preferredReportId))?.id ||
        reports.find((report) => Number(report.id) === Number(selectedReportIdRef.current))?.id ||
        getCurrentReportId(reports);

      setDetail(schoolYearDetail);
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
      const nextSchoolYearId =
        findSchoolYearId(preferredSchoolYearId) ||
        findSchoolYearId(selectedSchoolYearIdRef.current) ||
        currentSchoolYearId ||
        normalizedSchoolYears.find((schoolYear) => schoolYear.is_active)?.id ||
        normalizedSchoolYears[0]?.id ||
        null;

      setSchoolYears(normalizedSchoolYears);
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
    if (!selectedReport) {
      setFundMonitoringDraft({});
      return;
    }

    setReportDraft({
      beginning_cash_on_hand: toInputValue(selectedReport.default_inputs?.beginning_cash_on_hand ?? selectedReport.beginning_cash_on_hand),
      current_sales: toInputValue(selectedReport.default_inputs?.current_sales ?? selectedReport.current_sales),
      cost_of_sales: toInputValue(selectedReport.default_inputs?.cost_of_sales ?? selectedReport.cost_of_sales),
    });

    const draft = {};
    (selectedReport.allocations || []).forEach((alloc) => {
      draft[alloc.category_key] = {
        interest: toInputValue(alloc.fund_interest),
        expenses: toInputValue(alloc.fund_expenses),
        others: toInputValue(alloc.fund_others),
        cash_on_bank: toInputValue(alloc.fund_cash_on_bank),
      };
    });
    setFundMonitoringDraft(draft);
  }, [selectedReport]);

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

  async function handleCreateSchoolYear() {
    if (!isAdmin) {
      return;
    }
    if (currentSchoolYearExists) {
      window.showToast?.(`School year ${currentSchoolYearLabel} already exists.`, 'warning');
      return;
    }

    setCreatingSchoolYear(true);
    try {
      const response = await API.createFinancialSchoolYear({
        start_year: schoolYearSuggestion.startYear,
        end_year: schoolYearSuggestion.endYear,
        set_active: true,
      });
      window.showToast?.(`School year ${response?.school_year?.name || currentSchoolYearLabel} created.`, 'success');
      await loadSchoolYears(response?.school_year?.id || null);
    } catch (error) {
      window.showToast?.(error.message || 'Unable to create the school year.', 'error');
    } finally {
      setCreatingSchoolYear(false);
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
      const nextSalesTotal = toMoney(targetReport.current_sales) + amount;
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
              <button
                type="button"
                onClick={handleCreateSchoolYear}
                disabled={creatingSchoolYear}
                className="primary-action-button min-h-12 text-base"
              >
                <PlusIcon className="h-5 w-5" />
                {creatingSchoolYear ? 'Creating...' : `Create ${currentSchoolYearLabel}`}
              </button>
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
          onChange={(schoolYearId) => loadSchoolYearDetail(schoolYearId)}
        />
        {includeMonth ? (
          <MonthSelect
            reports={detail?.reports || []}
            selectedReportId={selectedReportId}
            onChange={setSelectedReportId}
            label={compact ? 'Month' : 'Current Month'}
          />
        ) : null}
      </div>
    );
  }

  function renderFinancialPage() {
    return (
      <div className="view-shell overflow-x-hidden pr-0 space-y-5">
        <PageHeader
          page={PAGE_COPY.financial}
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

        {detailLoading ? (
          <div className="rounded-2xl border border-slate-200/90 bg-white p-12 text-center shadow-2xs dark:border-slate-800 dark:bg-slate-900">
            <div className="text-sm font-bold text-slate-500">Loading financial statement...</div>
          </div>
        ) : null}

        {!detailLoading && selectedReport ? (
          <div className="space-y-5">
            <div className="grid grid-cols-1 gap-5 2xl:grid-cols-[minmax(0,1fr)_360px]">
              <section className="min-w-0 w-full rounded-2xl border border-slate-200/90 bg-white p-5 sm:p-6 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h2 className="text-xl font-black text-slate-900 dark:text-white">{selectedReport.month_label}</h2>
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

                <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
                  <FormField
                    label="Beginning Cash"
                    value={reportDraft.beginning_cash_on_hand}
                    onChange={(event) => updateReportDraft('beginning_cash_on_hand', event.target.value)}
                    disabled={!canSaveSelectedSchoolYear || !isAdmin}
                    min="0"
                    step="0.01"
                  />
                  <FormField
                    label="Current Sales"
                    value={reportDraft.current_sales}
                    onChange={(event) => updateReportDraft('current_sales', event.target.value)}
                    disabled={!canSaveSelectedSchoolYear || !isAdmin}
                    min="0"
                    step="0.01"
                  />
                  <FormField
                    label="Cost of Sales"
                    value={reportDraft.cost_of_sales}
                    onChange={(event) => updateReportDraft('cost_of_sales', event.target.value)}
                    disabled={!canSaveSelectedSchoolYear || !isAdmin}
                    min="0"
                    step="0.01"
                  />
                </div>

                <div className="mt-6 overflow-hidden rounded-xl border border-slate-200/90 divide-y divide-slate-100 bg-white dark:border-slate-800 dark:divide-slate-800 dark:bg-slate-900">
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
                      <div className="text-sm font-bold text-slate-700 dark:text-slate-300">{label}</div>
                      <div className={`text-base font-mono ${strong ? 'font-black text-slate-950 dark:text-white' : 'font-bold text-slate-800 dark:text-slate-200'}`}>
                        {formatCurrency(amount)}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <aside className="min-w-0 w-full space-y-5">
                <section className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
                  <h2 className="text-base font-black text-slate-900 dark:text-white">Fund Allocation Summary</h2>
                  <p className="mt-1 text-xs font-medium text-slate-500 dark:text-slate-400">
                    Net income shares per fund category for {selectedReport.month_label}.
                  </p>
                  <div className="mt-4 space-y-2.5">
                    {(selectedReport.allocations || []).map((allocation) => (
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

            <section className="panel-card">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-xl font-black text-slate-900">Fund Allocation Monitoring (DepEd Form)</h2>
                  <p className="mt-1 text-base leading-7 text-slate-500">
                    {isAdmin
                      ? 'Auto calculations update while you edit expenses and bank entries per fund allocation.'
                      : 'Review fund allocations and balances per DepEd form in read-only mode.'}
                  </p>
                </div>
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
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3.5 py-2 text-xs font-bold text-slate-600 border border-slate-200">
                    <EyeIcon className="h-4 w-4 text-slate-500" /> Read-Only View
                  </span>
                )}
              </div>

              <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
                {(selectedReport.allocations || []).map((allocation) => {
                  const key = allocation.category_key;
                  const draft = fundMonitoringDraft[key] || {};
                  const prevBal = toMoney(allocation.opening_balance);
                  const netInc = toMoney(allocation.amount);
                  const interestVal = toMoney(draft.interest);
                  const expensesVal = toMoney(draft.expenses);
                  const othersVal = toMoney(draft.others);
                  const totalExpVal = expensesVal + othersVal;
                  const currentBalVal = prevBal + interestVal + netInc - totalExpVal;

                  return (
                    <div key={key} className="rounded-2xl border border-slate-200/90 bg-white p-5 space-y-5 shadow-2xs transition hover:shadow-md">
                      <div className="flex items-center justify-between gap-3 border-b border-slate-100 pb-3.5">
                        <div className="text-lg font-black text-slate-900">{allocation.label}</div>
                        <span className="inline-flex items-center rounded-lg bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700 border border-emerald-200/60">
                          {formatPercent(allocation.percentage)}
                        </span>
                      </div>

                      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                        <div className="flex flex-col gap-1.5">
                          <label className="text-xs font-bold uppercase tracking-wider text-slate-500 whitespace-nowrap overflow-hidden text-ellipsis">
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
                                ? 'bg-slate-100/80 text-slate-700 cursor-not-allowed border-slate-200 focus:outline-none focus:ring-0'
                                : 'bg-slate-50/60 border-slate-200 focus:bg-white focus:border-emerald-500'
                            }`}
                          />
                        </div>

                        <div className="flex flex-col gap-1.5">
                          <label className="text-xs font-bold uppercase tracking-wider text-slate-500 whitespace-nowrap overflow-hidden text-ellipsis">
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
                                ? 'bg-slate-100/80 text-slate-700 cursor-not-allowed border-slate-200 focus:outline-none focus:ring-0'
                                : 'bg-slate-50/60 border-slate-200 focus:bg-white focus:border-emerald-500'
                            }`}
                          />
                        </div>

                        <div className="flex flex-col gap-1.5">
                          <label className="text-xs font-bold uppercase tracking-wider text-slate-500 whitespace-nowrap overflow-hidden text-ellipsis">
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
                                ? 'bg-slate-100/80 text-slate-700 cursor-not-allowed border-slate-200 focus:outline-none focus:ring-0'
                                : 'bg-slate-50/60 border-slate-200 focus:bg-white focus:border-emerald-500'
                            }`}
                          />
                        </div>

                        <div className="flex flex-col gap-1.5">
                          <label className="text-xs font-bold uppercase tracking-wider text-slate-500 whitespace-nowrap overflow-hidden text-ellipsis">
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
                                ? 'bg-slate-100/80 text-slate-700 cursor-not-allowed border-slate-200 focus:outline-none focus:ring-0'
                                : 'bg-slate-50/60 border-slate-200 focus:bg-white focus:border-emerald-500'
                            }`}
                          />
                        </div>
                      </div>

                      <div className="overflow-hidden rounded-xl border border-slate-200/90 divide-y divide-slate-100 bg-white">
                        <div className="flex items-center justify-between px-4 py-3 text-sm">
                          <span className="font-bold text-slate-600">Prev Month Balance</span>
                          <span className="font-black text-slate-900">{formatCurrency(prevBal)}</span>
                        </div>
                        <div className="flex items-center justify-between px-4 py-3 text-sm">
                          <span className="font-bold text-slate-600">Net Income Share</span>
                          <span className="font-black text-slate-900">{formatCurrency(netInc)}</span>
                        </div>
                        <div className="flex items-center justify-between px-4 py-3 text-sm">
                          <span className="font-bold text-slate-600">Total Current Expenses</span>
                          <span className="font-bold text-rose-600">{formatCurrency(totalExpVal)}</span>
                        </div>
                        <div className="flex items-center justify-between px-4 py-3.5 text-base bg-emerald-50/30">
                          <span className="font-black text-slate-950">Current Balance</span>
                          <span className="font-black text-emerald-600 text-lg">{formatCurrency(currentBalVal)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
        ) : null}
      </div>
    );
  }

  function renderSalesPage() {
    const monthManualSalesTotal = dailySalesRows
      .filter((row) => Number(row.reportId) === Number(selectedReport?.id))
      .reduce((sum, row) => sum + row.amount, 0);

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
            value={formatCurrency(monthManualSalesTotal)}
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
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full min-w-[700px] text-left text-sm">
                <thead className="border-b border-slate-200/80 bg-slate-50/80 text-xs font-bold uppercase tracking-wider text-slate-500 dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-400">
                  <tr>
                    <th className="px-5 py-3.5">Date</th>
                    <th className="px-4 py-3.5 text-right">Amount</th>
                    <th className="px-5 py-3.5">Notes/Remarks</th>
                    <th className="px-4 py-3.5">Month</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white dark:divide-slate-800 dark:bg-slate-900">
                  {filteredDailySalesRows.length ? (
                    filteredDailySalesRows.map((row) => (
                      <tr key={row.id} className="transition hover:bg-slate-50/70 dark:hover:bg-slate-800/50">
                        <td className="px-5 py-4 font-mono text-sm font-bold text-slate-900 dark:text-white">{row.date}</td>
                        <td className="px-4 py-4 text-right font-mono text-sm font-black text-emerald-700 dark:text-emerald-400">{formatCurrency(row.amount)}</td>
                        <td className="px-5 py-4 text-sm text-slate-600 dark:text-slate-300">{row.remarks}</td>
                        <td className="px-4 py-4 text-xs font-semibold text-slate-500 dark:text-slate-400">{row.monthLabel}</td>
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

    return (
      <div className="view-shell overflow-x-hidden pr-0 space-y-5">
        <PageHeader
          page={PAGE_COPY.sales}
          actions={
            !isAdmin ? (
              <span className="inline-flex items-center gap-1.5 rounded-xl bg-slate-100 px-3.5 py-2 text-xs font-bold text-slate-600 border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                <EyeIcon className="h-4 w-4 text-slate-500" /> Read-Only View
              </span>
            ) : null
          }
        />
        {renderSelectors({ compact: true })}
        <ValidationNotice message={selectedSchoolYearValidationMessage} />

        {isAdmin ? (
          <div className="grid grid-cols-1 gap-5 2xl:grid-cols-[340px_minmax(0,1fr)]">
            <section className="min-w-0 w-full rounded-2xl border border-slate-200/90 bg-white p-6 shadow-2xs dark:border-slate-800 dark:bg-slate-900">
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
  }

  function renderExpensesPage() {
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
                className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3.5 text-sm font-semibold text-slate-900 shadow-2xs outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </FormField>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-2xs dark:border-slate-800 dark:bg-slate-900">
            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full min-w-[850px] text-left text-sm">
                <thead className="border-b border-slate-200/80 bg-slate-50/80 text-xs font-bold uppercase tracking-wider text-slate-500 dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-400">
                  <tr>
                    <th className="px-5 py-3.5">Type</th>
                    <th className="px-4 py-3.5">Date</th>
                    <th className="px-4 py-3.5">Category</th>
                    <th className="px-4 py-3.5 text-right">Amount</th>
                    <th className="px-4 py-3.5">Supplier</th>
                    <th className="px-4 py-3.5">Description</th>
                    <th className="px-5 py-3.5">Receipt</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white dark:divide-slate-800 dark:bg-slate-900">
                  {paginatedExpenseRows.length ? (
                    paginatedExpenseRows.map((row) => (
                      <tr key={row.id} className="transition hover:bg-slate-50/70 dark:hover:bg-slate-800/50">
                        <td className="px-5 py-4 text-xs font-bold text-slate-700 dark:text-slate-300">{row.typeLabel || row.source}</td>
                        <td className="px-4 py-4 font-mono text-xs text-slate-600 dark:text-slate-400">{row.date}</td>
                        <td className="px-4 py-4 text-xs font-semibold text-slate-800 dark:text-slate-200">{row.category}</td>
                        <td className="px-4 py-4 text-right font-mono text-sm font-black text-rose-700 dark:text-rose-400">{formatCurrency(row.amount)}</td>
                        <td className="px-4 py-4 text-xs text-slate-600 dark:text-slate-400">{row.supplier}</td>
                        <td className="px-4 py-4 text-xs text-slate-600 dark:text-slate-400">{row.description}</td>
                        <td className="px-5 py-4 text-xs">
                          {row.receipt && row.receipt !== 'No receipt' && row.receipt !== '-' ? (
                            <button
                              type="button"
                              onClick={() => setActivePreviewReceipt(row)}
                              className="group inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700 transition hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                              title={`Click to preview receipt: ${row.receipt}`}
                            >
                              <PhotoIcon className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                              <span className="max-w-[130px] truncate font-mono text-xs">
                                {row.receipt}
                              </span>
                              <EyeIcon className="h-3.5 w-3.5 shrink-0 opacity-70 group-hover:opacity-100 transition-opacity" />
                            </button>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-400">
                              <MinusCircleIcon className="h-3.5 w-3.5 text-slate-300" />
                              No receipt
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={7} className="px-6 py-12 text-center text-sm font-semibold text-slate-500 dark:text-slate-400">
                        No expenses match the current filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
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

    return (
      <div className="view-shell overflow-x-hidden pr-0 space-y-5">
        <PageHeader
          page={PAGE_COPY.expenses}
          actions={
            !isAdmin ? (
              <span className="inline-flex items-center gap-1.5 rounded-xl bg-slate-100 px-3.5 py-2 text-xs font-bold text-slate-600 border border-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                <EyeIcon className="h-4 w-4 text-slate-500" /> Read-Only View
              </span>
            ) : null
          }
        />
        {renderSelectors({ compact: true })}
        <ValidationNotice message={selectedSchoolYearValidationMessage} />

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
                      className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50/50 px-3 text-xs font-semibold text-slate-900 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-200 file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-slate-800 hover:file:bg-slate-300"
                    />
                    <div className="flex items-center justify-between text-xs text-slate-400">
                      <span>Formats: JPG, PNG, WEBP, GIF, PDF</span>
                      <span>Max: 5 MB</span>
                    </div>

                    {expenseReceiptError && (
                      <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-700">
                        <ExclamationTriangleIcon className="h-4 w-4 shrink-0 text-rose-600 mt-0.5" />
                        <span>{expenseReceiptError}</span>
                      </div>
                    )}

                    {expenseReceiptValidation && (
                      <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50/70 p-3">
                        <div className="flex items-center gap-2.5 overflow-hidden">
                          {expenseReceiptDataUrl && !expenseReceiptValidation.isPdf ? (
                            <img
                              src={expenseReceiptDataUrl}
                              alt="Receipt thumbnail"
                              className="h-10 w-10 shrink-0 rounded-lg object-cover border border-emerald-300 shadow-2xs"
                            />
                          ) : (
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
                              <PhotoIcon className="h-5 w-5" />
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate text-xs font-bold text-slate-900 font-mono">
                                {expenseEntryDraft.receiptName}
                              </span>
                              <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-100 px-1.5 py-0.5 text-xs font-bold text-emerald-800">
                                <ShieldCheckIcon className="h-3 w-3" />
                                Sanitized
                              </span>
                            </div>
                            <span className="text-xs text-slate-500">
                              {expenseReceiptValidation.sizeFormatted}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleQuickPreviewUploadedReceipt(selectedReport)}
                            title="Preview uploaded receipt"
                            className="rounded-lg p-1.5 text-emerald-700 hover:bg-emerald-100 transition"
                          >
                            <EyeIcon className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={handleClearReceiptUpload}
                            title="Remove receipt"
                            className="rounded-lg p-1.5 text-rose-600 hover:bg-rose-100 transition"
                          >
                            <TrashIcon className="h-4 w-4" />
                          </button>
                        </div>
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
              <button
                type="button"
                onClick={handleCreateSchoolYear}
                disabled={creatingSchoolYear || currentSchoolYearExists}
                className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-black shadow-xs transition active:scale-95 ${
                  currentSchoolYearExists
                    ? 'border border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed dark:border-slate-700 dark:bg-slate-800 dark:text-slate-500'
                    : 'bg-emerald-600 text-white hover:bg-emerald-700'
                }`}
                title={currentSchoolYearExists ? `School year ${currentSchoolYearLabel} already exists` : `Create ${currentSchoolYearLabel}`}
              >
                <PlusIcon className="h-4 w-4 stroke-[2.5]" />
                {creatingSchoolYear ? 'Creating...' : currentSchoolYearExists ? 'Current Year Exists' : 'Create School Year'}
              </button>
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
              <div className="overflow-x-auto custom-scrollbar">
                <table className="w-full min-w-[750px] text-left text-sm">
                  <thead className="border-b border-slate-200/80 bg-slate-50/80 text-xs font-bold uppercase tracking-wider text-slate-500 dark:border-slate-800 dark:bg-slate-900/80 dark:text-slate-400">
                    <tr>
                      <th className="px-5 py-3.5">School Year</th>
                      <th className="px-4 py-3.5">Status</th>
                      <th className="px-4 py-3.5 text-right">Opening Beginning Cash</th>
                      <th className="px-4 py-3.5 text-right">Ending Balance</th>
                      <th className="px-5 py-3.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white dark:divide-slate-800 dark:bg-slate-900">
                    {schoolYears.map((schoolYear) => {
                      const selectedRow = Number(schoolYear.id) === Number(selectedSchoolYearId);
                      const rowIsActive = Boolean(schoolYear.is_active);
                      return (
                        <tr key={schoolYear.id} className={`transition hover:bg-slate-50/70 dark:hover:bg-slate-800/50 ${selectedRow || rowIsActive ? 'bg-emerald-50/20 dark:bg-emerald-950/20' : ''}`}>
                          <td className="px-5 py-4">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-bold text-slate-900 dark:text-white">{schoolYear.name}</span>
                              {rowIsActive ? (
                                <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-black uppercase tracking-wider text-emerald-700 border border-emerald-200/60 dark:bg-emerald-950 dark:text-emerald-300">
                                  <CheckCircleIcon className="h-3 w-3" />
                                  Active Now
                                </span>
                              ) : null}
                            </div>
                            <div className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">
                              {schoolYear.months_with_entries || 0} of {schoolYear.report_count || 12} months started
                            </div>
                          </td>
                          <td className="px-4 py-4">
                            <span
                              className={`inline-flex rounded-lg px-2.5 py-1 text-xs font-bold ${
                                schoolYear.is_active
                                  ? 'border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300'
                                  : 'border border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                              }`}
                            >
                              {rowIsActive ? 'Active' : 'Archived'}
                            </span>
                          </td>
                          <td className="px-4 py-4 text-right font-mono text-sm font-bold text-slate-700 dark:text-slate-300">
                            {formatCurrency(getSchoolYearOpeningCash(schoolYear, detail))}
                          </td>
                          <td className="px-4 py-4 text-right font-mono text-sm font-black text-slate-900 dark:text-white">
                            {formatCurrency(getSchoolYearEndingBalance(schoolYear, detail))}
                          </td>
                          <td className="px-5 py-4 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => loadSchoolYearDetail(schoolYear.id)}
                                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 shadow-2xs transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                              >
                                <PencilSquareIcon className="h-3.5 w-3.5" />
                                Edit
                              </button>
                              {isAdmin ? (
                                <button
                                  type="button"
                                  onClick={() => handleUpdateSchoolYearStatus(schoolYear.id, true)}
                                  disabled={updatingSchoolYear || rowIsActive}
                                  className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-bold text-emerald-700 shadow-2xs transition hover:bg-emerald-100 disabled:opacity-40 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
                                  title={rowIsActive ? 'This school year is already active' : `Activate ${schoolYear.name}`}
                                >
                                  <CheckCircleIcon className="h-3.5 w-3.5" />
                                  Activate
                                </button>
                              ) : null}
                              {isAdmin ? (
                                <button
                                  type="button"
                                  onClick={() => handleUpdateSchoolYearStatus(schoolYear.id, false)}
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

  let content = renderFinancialPage();
  if (normalizedMode === 'sales') {
    content = renderSalesPage();
  } else if (normalizedMode === 'expenses') {
    content = renderExpensesPage();
  } else if (normalizedMode === 'reports') {
    content = renderReportsPage();
  } else if (normalizedMode === 'schoolYears') {
    content = renderSchoolYearsPage();
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
    </>
  );
}
