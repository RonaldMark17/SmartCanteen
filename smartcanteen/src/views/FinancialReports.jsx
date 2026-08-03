import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { API } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import {
  ArchiveBoxIcon,
  BanknotesIcon,
  CalendarDaysIcon,
  ChartBarIcon,
  ChartPieIcon,
  CheckCircleIcon,
  ClipboardDocumentListIcon,
  DocumentArrowDownIcon,
  DocumentChartBarIcon,
  DocumentTextIcon,
  EyeIcon,
  FunnelIcon,
  MagnifyingGlassIcon,
  PencilSquareIcon,
  PlusIcon,
  PrinterIcon,
  ReceiptPercentIcon,
  ScaleIcon,
  TableCellsIcon,
  TrashIcon,
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
  const expenseRows = (report.expenses || [])
    .map(
      (expense) => `
        <tr>
          <td>${expense.category}</td>
          <td style="text-align:right;">${formatCurrency(expense.amount)}</td>
        </tr>
      `
    )
    .join('');
  const allocationRows = allocations
    .map(
      (allocation) => `
        <tr>
          <td>${allocation.label}</td>
          <td style="text-align:right;">${formatPercent(allocation.percentage)}</td>
          <td style="text-align:right;">${formatCurrency(allocation.amount)}</td>
          <td style="text-align:right;">${formatCurrency(allocation.fund_current_balance ?? allocation.currentBalance ?? 0)}</td>
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
          .card { border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; }
          .label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.12em; color: #64748b; font-weight: 700; }
          .value { font-size: 24px; font-weight: 800; margin-top: 6px; }
          table { width: 100%; border-collapse: collapse; margin-top: 14px; }
          th, td { border: 1px solid #e2e8f0; padding: 10px 12px; font-size: 14px; }
          th { background: #f8fafc; text-align: left; }
          .section { margin-top: 24px; }
        </style>
      </head>
      <body>
        <h1>${schoolYearName} Monthly Financial Statement</h1>
        <p>${report.month_label}</p>
        <div class="grid">
          <div class="card"><div class="label">Beginning Cash</div><div class="value">${formatCurrency(statement.beginningCash)}</div></div>
          <div class="card"><div class="label">Current Sales</div><div class="value">${formatCurrency(statement.currentSales)}</div></div>
          <div class="card"><div class="label">Gross Income</div><div class="value">${formatCurrency(statement.grossIncome)}</div></div>
          <div class="card"><div class="label">Current Balance</div><div class="value">${formatCurrency(statement.currentBalance)}</div></div>
        </div>

        <div class="section">
          <h2>Statement Details</h2>
          <table>
            <tbody>
              <tr><td>Cost of Sales</td><td style="text-align:right;">${formatCurrency(statement.costOfSales)}</td></tr>
              <tr><td>Operation Expenses</td><td style="text-align:right;">${formatCurrency(statement.operationExpenses)}</td></tr>
              <tr><td>Net Profit</td><td style="text-align:right;">${formatCurrency(statement.netProfit)}</td></tr>
            </tbody>
          </table>
        </div>

        <div class="section">
          <h2>Operation Expenses</h2>
          <table>
            <thead><tr><th>Category</th><th>Amount</th></tr></thead>
            <tbody>${expenseRows}</tbody>
          </table>
        </div>

        <div class="section">
          <h2>Fund Allocation</h2>
          <table>
            <thead><tr><th>Fund</th><th>Rate</th><th>Allocation</th><th>Current Balance</th></tr></thead>
            <tbody>${allocationRows}</tbody>
          </table>
        </div>
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
          ${row.map((cell, index) => `<td${index > 0 ? ' style="text-align:right;"' : ''}>${cell}</td>`).join('')}
        </tr>
      `
    )
    .join('');

  return `
    <html>
      <head>
        <title>${payload.title}</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 32px; color: #0f172a; }
          h1 { margin: 0 0 8px; }
          p { margin: 0 0 24px; color: #475569; }
          .grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 24px; }
          .card { border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; }
          .label { color: #64748b; font-size: 11px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
          .value { margin-top: 6px; font-size: 22px; font-weight: 800; }
          table { width: 100%; border-collapse: collapse; }
          td, th { border: 1px solid #e2e8f0; padding: 10px; }
          th { background: #f8fafc; text-align: left; }
        </style>
      </head>
      <body>
        <h1>${payload.title}</h1>
        <p>${payload.subtitle}</p>
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
    <label className="flex flex-col gap-2">
      <span className="text-xs font-black uppercase tracking-widest text-slate-500">{label}</span>
      {children || (
        <input
          type={type}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          disabled={disabled}
          min={min}
          step={step}
          className="field-control min-h-12 text-base"
        />
      )}
    </label>
  );
}

function MetricTile({ label, value, tone = 'slate', icon: Icon }) {
  const toneClass = {
    slate: 'bg-slate-50 text-slate-900',
    teal: 'bg-primary/5 text-slate-900',
    emerald: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    rose: 'bg-rose-50 text-rose-700',
    sky: 'bg-sky-50 text-sky-700',
  }[tone] || 'bg-slate-50 text-slate-900';

  return (
    <div className={`rounded-lg border border-slate-200 p-4 ${toneClass}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-black uppercase tracking-widest text-slate-500">{label}</div>
          <div className="mt-2 break-words text-xl font-black leading-tight">{value}</div>
        </div>
        {Icon ? <Icon className="h-6 w-6 shrink-0 text-primary" /> : null}
      </div>
    </div>
  );
}

function EmptyState({ title, description, action }) {
  return (
    <div className="panel-card flex min-h-[280px] flex-col items-center justify-center text-center">
      <div className="max-w-lg">
        <div className="text-xl font-black text-slate-900">{title}</div>
        <div className="mt-3 text-base leading-7 text-slate-500">{description}</div>
        {action ? <div className="mt-6">{action}</div> : null}
      </div>
    </div>
  );
}

function PageHeader({ page, actions }) {
  return (
    <div className="view-header">
      <div>
        <div className="view-eyebrow">{page.eyebrow}</div>
        <h1 className="view-title mt-3">{page.title}</h1>
        <p className="view-subtitle max-w-3xl text-base">{page.subtitle}</p>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

function SchoolYearSelect({ schoolYears, selectedSchoolYearId, onChange }) {
  return (
    <FormField label="School Year">
      <select
        value={selectedSchoolYearId || ''}
        onChange={(event) => onChange(Number(event.target.value))}
        className="field-control min-h-12 text-base"
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
        className="field-control min-h-12 text-base"
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
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold leading-6 text-amber-700">
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
      return;
    }

    setReportDraft({
      beginning_cash_on_hand: toInputValue(selectedReport.default_inputs?.beginning_cash_on_hand ?? selectedReport.beginning_cash_on_hand),
      current_sales: toInputValue(selectedReport.default_inputs?.current_sales ?? selectedReport.current_sales),
      cost_of_sales: toInputValue(selectedReport.default_inputs?.cost_of_sales ?? selectedReport.cost_of_sales),
    });
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

  async function handleAddExpenseEntry() {
    if (!detail?.reports?.length) {
      return;
    }
    if (!canSaveSelectedSchoolYear) {
      window.showToast?.(selectedSchoolYearValidationMessage, 'error');
      return;
    }

    const amount = parseNonNegativeMoney(expenseEntryDraft.amount);
    const expenseType = expenseEntryDraft.type === 'monthly' ? 'monthly' : 'daily';
    if (expenseType === 'daily' && !expenseEntryDraft.date) {
      window.showToast?.('Choose an expense date.', 'error');
      return;
    }
    if (expenseType === 'monthly' && !expenseEntryDraft.month) {
      window.showToast?.('Choose an expense month.', 'error');
      return;
    }
    if (!expenseEntryDraft.category) {
      window.showToast?.('Choose an expense category.', 'error');
      return;
    }
    if (amount === null || amount <= 0) {
      window.showToast?.('Enter an expense amount greater than zero.', 'error');
      return;
    }

    const targetReport =
      expenseType === 'monthly'
        ? findReportForMonth(detail, expenseEntryDraft.month)
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
      const periodValue = expenseType === 'monthly' ? getReportMonthValue(targetReport) : expenseEntryDraft.date;
      const typeLabel = expenseType === 'monthly' ? 'Monthly Expense' : 'Daily Expense';
      const line = [
        `[${typeLabel}] ${periodValue}`,
        category,
        formatCurrency(amount),
        `Supplier: ${cleanNoteValue(expenseEntryDraft.supplier) || '-'}`,
        `Description: ${cleanNoteValue(expenseEntryDraft.description) || '-'}`,
        `Receipt: ${cleanNoteValue(expenseEntryDraft.receiptName) || 'No receipt'}`,
      ].join(' | ');

      await API.updateFinancialReportExpenses(targetReport.id, nextExpenses);
      await API.updateFinancialReport(targetReport.id, {
        notes: appendNoteLine(targetReport.notes, line),
      });
      window.showToast?.(`${typeLabel} added to ${targetReport.month_label}.`, 'success');
      setExpenseEntryDraft((currentDraft) => ({
        ...currentDraft,
        amount: '',
        supplier: '',
        description: '',
        receiptName: '',
      }));
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
      <div className={`panel-card grid grid-cols-1 gap-4 ${includeMonth ? 'lg:grid-cols-2' : ''}`}>
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
      <div className="view-shell overflow-x-hidden pr-0">
        <PageHeader
          page={PAGE_COPY.financial}
          actions={
            <>
              <button
                type="button"
                onClick={handleExportWorkbook}
                disabled={exportingWorkbook || !selectedSchoolYearId}
                className="primary-action-button min-h-12 text-base"
              >
                <TableCellsIcon className="h-5 w-5" />
                {exportingWorkbook ? 'Preparing...' : 'Export Excel'}
              </button>
              <button
                type="button"
                onClick={handleExportFinancialPdf}
                className="action-button min-h-12 text-base"
              >
                <DocumentArrowDownIcon className="h-5 w-5" />
                Export PDF
              </button>
              <button
                type="button"
                onClick={handlePrintFinancialReport}
                className="action-button min-h-12 text-base"
              >
                <PrinterIcon className="h-5 w-5" />
                Print Report
              </button>
            </>
          }
        />

        {renderSelectors()}
        <ValidationNotice message={selectedSchoolYearValidationMessage} />

        {detailLoading ? (
          <div className="panel-card flex min-h-[260px] items-center justify-center">
            <div className="text-base font-bold text-slate-500">Loading financial statement...</div>
          </div>
        ) : null}

        {!detailLoading && selectedReport ? (
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
            <section className="panel-card">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-xl font-black text-slate-900">{selectedReport.month_label}</h2>
                  <p className="mt-1 text-base leading-7 text-slate-500">
                    Auto calculations update while you edit Beginning Cash, Current Sales, and Cost of Sales.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleSaveStatement}
                  disabled={savingStatement || !canSaveSelectedSchoolYear}
                  className="primary-action-button min-h-12 text-base"
                >
                  <CheckCircleIcon className="h-5 w-5" />
                  {savingStatement ? 'Saving...' : 'Save Statement'}
                </button>
              </div>

              <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-3">
                <FormField
                  label="Beginning Cash"
                  value={reportDraft.beginning_cash_on_hand}
                  onChange={(event) => updateReportDraft('beginning_cash_on_hand', event.target.value)}
                  disabled={!canSaveSelectedSchoolYear}
                  min="0"
                  step="0.01"
                />
                <FormField
                  label="Current Sales"
                  value={reportDraft.current_sales}
                  onChange={(event) => updateReportDraft('current_sales', event.target.value)}
                  disabled={!canSaveSelectedSchoolYear}
                  min="0"
                  step="0.01"
                />
                <FormField
                  label="Cost of Sales"
                  value={reportDraft.cost_of_sales}
                  onChange={(event) => updateReportDraft('cost_of_sales', event.target.value)}
                  disabled={!canSaveSelectedSchoolYear}
                  min="0"
                  step="0.01"
                />
              </div>

              <div className="mt-6 overflow-hidden rounded-lg border border-slate-200">
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
                    className="grid grid-cols-1 gap-1 border-b border-slate-100 px-4 py-4 last:border-b-0 sm:grid-cols-[1fr_auto] sm:items-center"
                  >
                    <div className="text-base font-black text-slate-700">{label}</div>
                    <div className={`text-xl ${strong ? 'font-black text-slate-950' : 'font-bold text-slate-800'}`}>
                      {formatCurrency(amount)}
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <aside className="space-y-5">
              <section className="panel-card">
                <h2 className="text-lg font-black text-slate-900">Fund Allocation</h2>
                <p className="mt-1 text-sm leading-6 text-slate-500">
                  Read-only balance view. Expense updates belong on the Expenses page.
                </p>
                <div className="mt-4 space-y-3">
                  {(selectedReport.allocations || []).map((allocation) => (
                    <div key={allocation.category_key} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0 text-sm font-black text-slate-900">{allocation.label}</div>
                        <div className="text-sm font-black text-primary">{formatPercent(allocation.percentage)}</div>
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-3 text-sm">
                        <span className="text-slate-500">Allocation</span>
                        <span className="font-black text-slate-900">{formatCurrency(allocation.amount)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </aside>
          </div>
        ) : null}
      </div>
    );
  }

  function renderSalesPage() {
    const monthManualSalesTotal = dailySalesRows
      .filter((row) => Number(row.reportId) === Number(selectedReport?.id))
      .reduce((sum, row) => sum + row.amount, 0);

    return (
      <div className="view-shell overflow-x-hidden pr-0">
        <PageHeader page={PAGE_COPY.sales} />
        {renderSelectors({ compact: true })}
        <ValidationNotice message={selectedSchoolYearValidationMessage} />

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[420px_minmax(0,1fr)]">
          <section className="panel-card">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <PlusIcon className="h-6 w-6" />
              </div>
              <div>
                <h2 className="text-xl font-black text-slate-900">Sales Entry Form</h2>
                <p className="text-base text-slate-500">Add one daily total.</p>
              </div>
            </div>

            <div className="mt-5 space-y-4">
              <FormField label="Date">
                <input
                  type="date"
                  value={dailySaleDraft.date}
                  onChange={(event) => setDailySaleDraft((draft) => ({ ...draft, date: event.target.value }))}
                  className="field-control min-h-12 text-base"
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
                  className="field-control min-h-28 resize-none text-base"
                />
              </FormField>
              <button
                type="button"
                onClick={handleQuickAddSale}
                disabled={savingDailySale || !canSaveSelectedSchoolYear}
                className="primary-action-button min-h-12 w-full text-base"
              >
                <PlusIcon className="h-5 w-5" />
                {savingDailySale ? 'Adding...' : 'Quick Add Sale'}
              </button>
            </div>
          </section>

          <div className="space-y-5">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <MetricTile
                label="Monthly Total Sales"
                value={formatCurrency(selectedReport?.current_sales)}
                tone="teal"
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
                tone="emerald"
                icon={ClipboardDocumentListIcon}
              />
            </div>

            <section className="panel-card">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_220px]">
                <FormField label="Search Remarks">
                  <div className="relative">
                    <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                    <input
                      type="search"
                      value={salesSearch}
                      onChange={(event) => setSalesSearch(event.target.value)}
                      placeholder="Search sales remarks"
                      className="field-control min-h-12 w-full pl-10 text-base"
                    />
                  </div>
                </FormField>
                <FormField label="Filter by Date">
                  <input
                    type="date"
                    value={salesDateFilter}
                    onChange={(event) => setSalesDateFilter(event.target.value)}
                    className="field-control min-h-12 text-base"
                  />
                </FormField>
              </div>

              <div className="mt-5 overflow-x-auto custom-scrollbar rounded-lg border border-slate-200">
                <table className="w-full min-w-[700px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs font-black uppercase tracking-widest text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Date</th>
                      <th className="px-4 py-3">Amount</th>
                      <th className="px-4 py-3">Notes/Remarks</th>
                      <th className="px-4 py-3">Month</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {filteredDailySalesRows.length ? (
                      filteredDailySalesRows.map((row) => (
                        <tr key={row.id}>
                          <td className="px-4 py-4 text-base font-bold text-slate-900">{row.date}</td>
                          <td className="px-4 py-4 text-base font-black text-slate-900">{formatCurrency(row.amount)}</td>
                          <td className="px-4 py-4 text-base text-slate-600">{row.remarks}</td>
                          <td className="px-4 py-4 text-base text-slate-600">{row.monthLabel}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={4} className="px-4 py-10 text-center text-base font-semibold text-slate-500">
                          No daily sales entries match the current filters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </div>
      </div>
    );
  }

  function renderExpensesPage() {
    return (
      <div className="view-shell overflow-x-hidden pr-0">
        <PageHeader page={PAGE_COPY.expenses} />
        {renderSelectors({ compact: true })}
        <ValidationNotice message={selectedSchoolYearValidationMessage} />

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[440px_minmax(0,1fr)]">
          <section className="panel-card">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-rose-50 text-rose-700">
                <ReceiptPercentIcon className="h-6 w-6" />
              </div>
              <div>
                <h2 className="text-xl font-black text-slate-900">Add Expense</h2>
                <p className="text-base text-slate-500">Record one expense item.</p>
              </div>
            </div>

            <div className="mt-5 space-y-4">
              <FormField label="Expense Type">
                <div className="grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-1">
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
                        className={`min-h-11 rounded-md px-3 text-sm font-black transition ${
                          active
                            ? 'bg-white text-primary shadow-sm'
                            : 'text-slate-600 hover:bg-white/80 hover:text-slate-900'
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
                    className="field-control min-h-12 text-base"
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
                    className="field-control min-h-12 text-base"
                  />
                </FormField>
              )}
              <FormField label="Expense Category">
                <select
                  value={expenseEntryDraft.category}
                  onChange={(event) => setExpenseEntryDraft((draft) => ({ ...draft, category: event.target.value }))}
                  className="field-control min-h-12 text-base"
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
                  className="field-control min-h-12 text-base"
                />
              </FormField>
              <FormField label="Description">
                <textarea
                  value={expenseEntryDraft.description}
                  onChange={(event) => setExpenseEntryDraft((draft) => ({ ...draft, description: event.target.value }))}
                  rows={3}
                  placeholder="Optional description"
                  className="field-control min-h-24 resize-none text-base"
                />
              </FormField>
              <FormField label="Receipt Upload (Optional)">
                <input
                  type="file"
                  onChange={(event) =>
                    setExpenseEntryDraft((draft) => ({
                      ...draft,
                      receiptName: event.target.files?.[0]?.name || '',
                    }))
                  }
                  className="field-control min-h-12 text-base file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-2 file:text-sm file:font-bold file:text-white"
                />
              </FormField>
              <button
                type="button"
                onClick={handleAddExpenseEntry}
                disabled={savingExpenseEntry || !canSaveSelectedSchoolYear}
                className="primary-action-button min-h-12 w-full text-base"
              >
                <PlusIcon className="h-5 w-5" />
                {savingExpenseEntry
                  ? 'Adding...'
                  : expenseEntryDraft.type === 'monthly'
                    ? 'Add Monthly Expense'
                    : 'Add Daily Expense'}
              </button>
            </div>
          </section>

          <div className="space-y-5">
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
                tone="amber"
                icon={ClipboardDocumentListIcon}
              />
            </div>

            <section className="panel-card">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-xl font-black text-slate-900">Expense Summary by Category</h2>
                  <p className="mt-1 text-base text-slate-500">{selectedReport?.month_label}</p>
                </div>
                <FunnelIcon className="h-6 w-6 text-slate-400" />
              </div>
              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {expenseSummary.length ? (
                  expenseSummary.map((item) => (
                    <div key={item.category} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                      <div className="text-sm font-black text-slate-700">{item.category}</div>
                      <div className="mt-2 text-xl font-black text-slate-950">{formatCurrency(item.amount)}</div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-lg border border-dashed border-slate-200 p-6 text-base font-semibold text-slate-500">
                    No expenses recorded for this month.
                  </div>
                )}
              </div>
            </section>

            <section className="panel-card">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-[1fr_220px_220px]">
                <FormField label="Search Expenses">
                  <div className="relative">
                    <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                    <input
                      type="search"
                      value={expenseSearch}
                      onChange={(event) => setExpenseSearch(event.target.value)}
                      placeholder="Search expenses"
                      className="field-control min-h-12 w-full pl-10 text-base"
                    />
                  </div>
                </FormField>
                <FormField label="Filter by Category">
                  <select
                    value={expenseCategoryFilter}
                    onChange={(event) => setExpenseCategoryFilter(event.target.value)}
                    className="field-control min-h-12 text-base"
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
                    className="field-control min-h-12 text-base"
                  />
                </FormField>
              </div>

              <div className="mt-5 overflow-x-auto custom-scrollbar rounded-lg border border-slate-200">
                <table className="w-full min-w-[850px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs font-black uppercase tracking-widest text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Type</th>
                      <th className="px-4 py-3">Date</th>
                      <th className="px-4 py-3">Category</th>
                      <th className="px-4 py-3">Amount</th>
                      <th className="px-4 py-3">Supplier</th>
                      <th className="px-4 py-3">Description</th>
                      <th className="px-4 py-3">Receipt</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {filteredExpenseRows.length ? (
                      filteredExpenseRows.map((row) => (
                        <tr key={row.id}>
                          <td className="px-4 py-4 text-base font-bold text-slate-700">{row.typeLabel || row.source}</td>
                          <td className="px-4 py-4 text-base font-bold text-slate-900">{row.date}</td>
                          <td className="px-4 py-4 text-base text-slate-700">{row.category}</td>
                          <td className="px-4 py-4 text-base font-black text-slate-900">{formatCurrency(row.amount)}</td>
                          <td className="px-4 py-4 text-base text-slate-600">{row.supplier}</td>
                          <td className="px-4 py-4 text-base text-slate-600">{row.description}</td>
                          <td className="px-4 py-4 text-base text-slate-600">{row.receipt}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={7} className="px-4 py-10 text-center text-base font-semibold text-slate-500">
                          No expenses match the current filters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </div>
      </div>
    );
  }

  function renderReportsPage() {
    return (
      <div className="view-shell overflow-x-hidden pr-0">
        <PageHeader
          page={PAGE_COPY.reports}
          actions={
            <>
              <button
                type="button"
                onClick={handleExportWorkbook}
                disabled={exportingWorkbook || !selectedSchoolYearId}
                className="primary-action-button min-h-12 text-base"
              >
                <TableCellsIcon className="h-5 w-5" />
                {exportingWorkbook ? 'Preparing...' : 'Export Excel'}
              </button>
              <button
                type="button"
                onClick={handleExportGeneratedPdf}
                className="action-button min-h-12 text-base"
              >
                <DocumentArrowDownIcon className="h-5 w-5" />
                Export PDF
              </button>
              <button
                type="button"
                onClick={handlePrintGeneratedReport}
                className="action-button min-h-12 text-base"
              >
                <PrinterIcon className="h-5 w-5" />
                Print
              </button>
            </>
          }
        />
        {renderSelectors({ compact: true })}

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
          <section className="panel-card">
            <h2 className="text-xl font-black text-slate-900">Report Type</h2>
            <div className="mt-4 space-y-2">
              {REPORT_TYPES.map((item) => {
                const Icon = item.icon;
                const active = reportType === item.key;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setReportType(item.key)}
                    className={`w-full rounded-lg border p-4 text-left transition ${
                      active
                        ? 'border-primary bg-primary/10 text-slate-950'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-primary/30 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <Icon className="h-6 w-6 shrink-0 text-primary" />
                      <div className="min-w-0">
                        <div className="text-base font-black">{item.label}</div>
                        <div className="mt-1 text-sm leading-5 text-slate-500">{item.description}</div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="panel-card">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="inline-flex items-center gap-2 rounded-md bg-slate-50 px-3 py-1 text-xs font-black uppercase tracking-widest text-slate-500">
                  <EyeIcon className="h-4 w-4" />
                  Preview
                </div>
                <h2 className="mt-3 text-2xl font-black text-slate-900">{generatedReportPayload.title}</h2>
                <p className="mt-1 text-base text-slate-500">{generatedReportPayload.subtitle}</p>
              </div>
              <DocumentTextIcon className="h-8 w-8 text-slate-400" />
            </div>

            <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
              {generatedReportPayload.metrics.map(([label, value]) => (
                <MetricTile key={label} label={label} value={formatCurrency(value)} tone="teal" />
              ))}
            </div>

            <div className="mt-6 overflow-x-auto custom-scrollbar rounded-lg border border-slate-200">
              <table className="w-full min-w-[650px] text-left text-sm">
                <tbody className="divide-y divide-slate-100 bg-white">
                  {generatedReportPayload.rows.map((row, rowIndex) => (
                    <tr key={`${row[0]}-${rowIndex}`}>
                      {row.map((cell, cellIndex) => (
                        <td
                          key={`${cell}-${cellIndex}`}
                          className={`px-4 py-4 text-base ${
                            cellIndex === 0 ? 'font-black text-slate-900' : 'text-right font-bold text-slate-700'
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
      <div className="view-shell overflow-x-hidden pr-0">
        <PageHeader
          page={PAGE_COPY.schoolYears}
          actions={
            isAdmin ? (
              <button
                type="button"
                onClick={handleCreateSchoolYear}
                disabled={creatingSchoolYear || currentSchoolYearExists}
                className="primary-action-button min-h-12 text-base"
                title={currentSchoolYearExists ? `School year ${currentSchoolYearLabel} already exists` : `Create ${currentSchoolYearLabel}`}
              >
                <PlusIcon className="h-5 w-5" />
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

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
          <section className="panel-card">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-black text-slate-900">List of School Years</h2>
                <p className="mt-1 text-base text-slate-500">Active years are open; archived years are closed.</p>
              </div>
              <CalendarDaysIcon className="h-7 w-7 text-slate-400" />
            </div>

            <div className="mt-5 overflow-x-auto custom-scrollbar rounded-lg border border-slate-200">
              <table className="w-full min-w-[750px] text-left text-sm">
                <thead className="bg-slate-50 text-xs font-black uppercase tracking-widest text-slate-500">
                  <tr>
                    <th className="px-4 py-3">School Year</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Opening Beginning Cash</th>
                    <th className="px-4 py-3">Ending Balance</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {schoolYears.map((schoolYear) => {
                    const selectedRow = Number(schoolYear.id) === Number(selectedSchoolYearId);
                    const rowIsActive = Boolean(schoolYear.is_active);
                    return (
                      <tr key={schoolYear.id} className={selectedRow || rowIsActive ? 'bg-primary/5' : ''}>
                        <td className="px-4 py-4">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-base font-black text-slate-900">{schoolYear.name}</span>
                            {rowIsActive ? (
                              <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-black uppercase tracking-wider text-emerald-700">
                                <CheckCircleIcon className="h-3.5 w-3.5" />
                                Active Now
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-1 text-sm text-slate-500">
                            {schoolYear.months_with_entries || 0} of {schoolYear.report_count || 12} months started
                          </div>
                        </td>
                        <td className="px-4 py-4">
                          <span
                            className={`inline-flex rounded-md px-3 py-1 text-sm font-black ${
                              schoolYear.is_active
                                ? 'bg-emerald-50 text-emerald-700'
                                : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {rowIsActive ? 'Active' : 'Archived'}
                          </span>
                        </td>
                        <td className="px-4 py-4 text-base font-bold text-slate-700">
                          {formatCurrency(getSchoolYearOpeningCash(schoolYear, detail))}
                        </td>
                        <td className="px-4 py-4 text-base font-bold text-slate-700">
                          {formatCurrency(getSchoolYearEndingBalance(schoolYear, detail))}
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => loadSchoolYearDetail(schoolYear.id)}
                              className="action-button min-h-11 text-sm"
                            >
                              <PencilSquareIcon className="h-4 w-4" />
                              Edit
                            </button>
                            {isAdmin ? (
                              <button
                                type="button"
                                onClick={() => handleUpdateSchoolYearStatus(schoolYear.id, true)}
                                disabled={updatingSchoolYear || rowIsActive}
                                className="action-button min-h-11 text-sm"
                                title={rowIsActive ? 'This school year is already active' : `Activate ${schoolYear.name}`}
                              >
                                <CheckCircleIcon className="h-4 w-4" />
                                Activate
                              </button>
                            ) : null}
                            {isAdmin ? (
                              <button
                                type="button"
                                onClick={() => handleUpdateSchoolYearStatus(schoolYear.id, false)}
                                disabled={updatingSchoolYear || rowIsActive}
                                className="action-button min-h-11 text-sm"
                                title={rowIsActive ? 'Activate another school year before archiving this one' : `Archive ${schoolYear.name}`}
                              >
                                <ArchiveBoxIcon className="h-4 w-4" />
                                Archive
                              </button>
                            ) : null}
                            {isAdmin ? (
                              <button
                                type="button"
                                onClick={() => handleDeleteSchoolYear(schoolYear.id)}
                                disabled={deletingSchoolYear}
                                className="action-button min-h-11 border-red-200 text-sm text-red-700 hover:border-red-300 hover:bg-red-50"
                              >
                                <TrashIcon className="h-4 w-4" />
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
          </section>

          <section className="panel-card">
            <h2 className="text-xl font-black text-slate-900">Edit School Year</h2>
            <p className="mt-1 text-base leading-7 text-slate-500">
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
                    className="field-control min-h-12 text-base"
                  />
                </FormField>
                <FormField label="End Year">
                  <input
                    type="number"
                    value={schoolYearForm.endYear}
                    onChange={(event) => setSchoolYearForm((form) => ({ ...form, endYear: event.target.value }))}
                    disabled={!isAdmin}
                    className="field-control min-h-12 text-base"
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
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs font-black uppercase tracking-widest text-slate-500">School Year Status</div>
                <div className="mt-2 text-xl font-black text-slate-900">
                  {selectedSchoolYear?.is_active ? 'Active' : 'Closed'}
                </div>
              </div>
              {isAdmin ? (
                <button
                  type="button"
                  onClick={handleSaveSchoolYearForm}
                  disabled={updatingSchoolYear}
                  className="primary-action-button min-h-12 w-full text-base"
                >
                  <CheckCircleIcon className="h-5 w-5" />
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

  if (normalizedMode === 'sales') {
    return renderSalesPage();
  }
  if (normalizedMode === 'expenses') {
    return renderExpensesPage();
  }
  if (normalizedMode === 'reports') {
    return renderReportsPage();
  }
  if (normalizedMode === 'schoolYears') {
    return renderSchoolYearsPage();
  }

  return renderFinancialPage();
}
