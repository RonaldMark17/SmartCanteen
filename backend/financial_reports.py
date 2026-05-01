import calendar
import os
import shutil
import tempfile
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse
from openpyxl import load_workbook
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload
from starlette.background import BackgroundTask

import backend.auth as auth
import backend.models as models
import backend.schemas as schemas
from backend.database import SQLALCHEMY_DATABASE_URL, get_db
from backend.time_utils import build_ph_date_range_bounds, get_ph_today


router = APIRouter(tags=["Financial Reports"])

FINANCIAL_REPORT_ROLES = {"admin", "staff"}
TEMPLATE_FILENAME = "CANTEEN-REPORT-2025-2026-2 (1).xlsx"
MONTH_SEQUENCE = [
    (0, 6, "June"),
    (1, 7, "July"),
    (2, 8, "August"),
    (3, 9, "September"),
    (4, 10, "October"),
    (5, 11, "November"),
    (6, 12, "December"),
    (7, 1, "January"),
    (8, 2, "February"),
    (9, 3, "March"),
    (10, 4, "April"),
    (11, 5, "May"),
]
DEFAULT_EXPENSE_CATEGORIES = [
    "Transportation/Freight",
    "Gas",
    "Supplies",
    "Helpers",
    "Repair",
    "Purchase from the looses of tools",
    "Other expenses",
]
DEFAULT_ALLOCATIONS = [
    ("supplementary_feeding", "Supplementary Feeding", 35.0),
    ("school_clinic", "School Clinic", 5.0),
    ("faculty_student_development", "Faculty/Student Development", 15.0),
    ("school_operating_fund", "School Operating Fund", 25.0),
    ("he_instructional_fund", "H.E Instructional Fund", 10.0),
    ("revolving_capital_fund", "Revolving Capital Fund", 10.0),
]
EXPENSE_CELL_BY_CATEGORY = {
    "transportation/freight": "F21",
    "gas": "F22",
    "supplies": "F23",
    "helpers": "F24",
    "repair": "F25",
    "purchase from the looses of tools": "F26",
    "other expenses": "F27",
}
FUND_MONITORING_COLUMNS = ("B", "C", "D", "E", "F", "G")
EXCEL_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
DEMO_BEGINNING_CASH_ON_HAND = 11834.59
DEMO_MONTHLY_REPORT_ROWS = [
    {
        "month_index": 0,
        "current_sales": 39840.00,
        "cost_of_sales": 31872.00,
        "expenses": {
            "Gas": 950.00,
            "Supplies": 1000.00,
            "Helpers": 800.00,
            "Repair": 3000.00,
        },
    },
    {
        "month_index": 1,
        "current_sales": 68483.70,
        "cost_of_sales": 54498.70,
        "expenses": {
            "Gas": 950.00,
            "Supplies": 1000.00,
            "Helpers": 1300.00,
            "Repair": 1800.00,
        },
    },
    {
        "month_index": 2,
        "current_sales": 93243.00,
        "cost_of_sales": 74595.00,
        "expenses": {
            "Gas": 1800.00,
            "Supplies": 1600.00,
            "Helpers": 2300.00,
        },
    },
    {
        "month_index": 3,
        "current_sales": 89345.00,
        "cost_of_sales": 72476.00,
        "expenses": {
            "Gas": 1900.00,
            "Supplies": 2200.00,
            "Helpers": 2100.00,
        },
    },
    {
        "month_index": 4,
        "current_sales": 70345.00,
        "cost_of_sales": 54345.00,
        "expenses": {
            "Gas": 400.00,
            "Supplies": 915.00,
            "Helpers": 2600.00,
        },
    },
    {
        "month_index": 5,
        "current_sales": 190480.00,
        "cost_of_sales": 163840.00,
        "expenses": {
            "Gas": 300.00,
            "Supplies": 1830.00,
            "Helpers": 1480.00,
            "Repair": 6500.00,
        },
    },
    {
        "month_index": 6,
        "current_sales": 85165.00,
        "cost_of_sales": 68038.00,
        "expenses": {
            "Gas": 915.00,
            "Supplies": 1800.00,
            "Helpers": 6800.00,
        },
    },
    {
        "month_index": 7,
        "current_sales": 208342.00,
        "cost_of_sales": 179482.00,
        "expenses": {
            "Transportation/Freight": 450.00,
            "Gas": 2890.00,
            "Supplies": 3650.00,
            "Helpers": 2300.00,
            "Repair": 2800.00,
        },
    },
    {
        "month_index": 8,
        "current_sales": 164280.00,
        "cost_of_sales": 132940.00,
        "expenses": {
            "Transportation/Freight": 350.00,
            "Gas": 2100.00,
            "Supplies": 2400.00,
            "Helpers": 2200.00,
            "Other expenses": 300.00,
        },
    },
    {
        "month_index": 9,
        "current_sales": 152760.00,
        "cost_of_sales": 124180.00,
        "expenses": {
            "Transportation/Freight": 300.00,
            "Gas": 1750.00,
            "Supplies": 2150.00,
            "Helpers": 2150.00,
            "Repair": 600.00,
        },
    },
    {
        "month_index": 10,
        "current_sales": 167420.00,
        "cost_of_sales": 136050.00,
        "expenses": {
            "Transportation/Freight": 320.00,
            "Gas": 1950.00,
            "Supplies": 2280.00,
            "Helpers": 2350.00,
            "Repair": 900.00,
        },
    },
    {
        "month_index": 11,
        "current_sales": 173880.00,
        "cost_of_sales": 140920.00,
        "expenses": {
            "Transportation/Freight": 400.00,
            "Gas": 2200.00,
            "Supplies": 2460.00,
            "Helpers": 2500.00,
            "Repair": 1200.00,
        },
    },
]
DEMO_MONTHLY_REPORTS_BY_INDEX = {
    int(item["month_index"]): item for item in DEMO_MONTHLY_REPORT_ROWS
}


def require_financial_report_user(
    current_user: models.User = Depends(auth.get_current_user),
) -> models.User:
    if current_user.role not in FINANCIAL_REPORT_ROLES:
        raise HTTPException(status_code=403, detail="Admin or staff access required")
    return current_user


def _template_path() -> str:
    return os.path.join(os.path.abspath(os.path.dirname(__file__)), "report_templates", TEMPLATE_FILENAME)


def _format_school_year_name(start_year: int, end_year: int) -> str:
    return f"{int(start_year)}-{int(end_year)}"


def _round_money(value) -> float:
    return round(float(value or 0.0), 2)


def _month_calendar_year(school_year: models.SchoolYear, month_number: int) -> int:
    return school_year.start_year if month_number >= 6 else school_year.end_year


def _load_school_year(db: Session, school_year_id: int) -> Optional[models.SchoolYear]:
    return (
        db.query(models.SchoolYear)
        .options(
            joinedload(models.SchoolYear.monthly_reports).joinedload(models.MonthlyReport.expenses),
            joinedload(models.SchoolYear.monthly_reports).joinedload(models.MonthlyReport.fund_entries),
            joinedload(models.SchoolYear.allocations),
        )
        .filter(models.SchoolYear.id == school_year_id)
        .first()
    )


def _create_default_expenses(db: Session, report: models.MonthlyReport) -> bool:
    existing_names = {str(expense.category or "").strip().lower() for expense in report.expenses}
    changed = False

    for sort_order, category in enumerate(DEFAULT_EXPENSE_CATEGORIES):
        if category.strip().lower() in existing_names:
            continue
        db.add(
            models.Expense(
                report_id=report.id,
                category=category,
                amount=0.0,
                sort_order=sort_order,
            )
        )
        changed = True

    return changed


def _ensure_school_year_defaults(db: Session, school_year: models.SchoolYear) -> bool:
    changed = False
    existing_allocations = {
        str(allocation.category_key or "").strip().lower(): allocation
        for allocation in school_year.allocations
    }

    for sort_order, (category_key, label, percentage) in enumerate(DEFAULT_ALLOCATIONS):
        if category_key in existing_allocations:
            continue
        db.add(
            models.Allocation(
                school_year_id=school_year.id,
                category_key=category_key,
                label=label,
                percentage=percentage,
                sort_order=sort_order,
            )
        )
        changed = True

    existing_reports = {report.month_index: report for report in school_year.monthly_reports}
    for month_index, month_number, month_name in MONTH_SEQUENCE:
        if month_index in existing_reports:
            continue

        report = models.MonthlyReport(
            school_year_id=school_year.id,
            month_index=month_index,
            month_number=month_number,
            month_name=month_name,
            calendar_year=_month_calendar_year(school_year, month_number),
        )
        db.add(report)
        db.flush()
        school_year.monthly_reports.append(report)
        changed = True

    for report in school_year.monthly_reports:
        if _create_default_expenses(db, report):
            changed = True

    if changed:
        db.flush()

    return changed


def _school_year_has_report_values(school_year: models.SchoolYear) -> bool:
    return any(
        any(
            [
                report.beginning_cash_on_hand,
                report.current_sales,
                report.other_income,
                report.purchases,
                report.inventory_used,
                report.product_cost,
                any(float(expense.amount or 0.0) for expense in report.expenses),
            ]
        )
        for report in school_year.monthly_reports
    )


def clear_financial_reporting_tables(db: Session) -> None:
    db.query(models.Expense).delete(synchronize_session=False)
    db.query(models.FundMonitoringEntry).delete(synchronize_session=False)
    db.query(models.Allocation).delete(synchronize_session=False)
    db.query(models.MonthlyReport).delete(synchronize_session=False)
    db.query(models.SchoolYear).delete(synchronize_session=False)
    db.flush()


def _resolve_demo_school_year_bounds() -> tuple[int, int]:
    today = get_ph_today()
    start_year = today.year if today.month >= 6 else today.year - 1
    return start_year, start_year + 1


def seed_demo_financial_reporting(db: Session, *, reset: bool = False) -> dict:
    if reset:
        clear_financial_reporting_tables(db)

    start_year, end_year = _resolve_demo_school_year_bounds()
    school_year_name = _format_school_year_name(start_year, end_year)
    existing_school_years = int(db.query(models.SchoolYear).count())
    school_year = (
        db.query(models.SchoolYear)
        .options(
            joinedload(models.SchoolYear.monthly_reports).joinedload(models.MonthlyReport.expenses),
            joinedload(models.SchoolYear.monthly_reports).joinedload(models.MonthlyReport.fund_entries),
            joinedload(models.SchoolYear.allocations),
        )
        .filter(models.SchoolYear.name == school_year_name)
        .first()
    )
    active_school_year = (
        db.query(models.SchoolYear)
        .options(
            joinedload(models.SchoolYear.monthly_reports).joinedload(models.MonthlyReport.expenses),
            joinedload(models.SchoolYear.monthly_reports).joinedload(models.MonthlyReport.fund_entries),
            joinedload(models.SchoolYear.allocations),
        )
        .filter(models.SchoolYear.is_active.is_(True))
        .order_by(models.SchoolYear.updated_at.desc(), models.SchoolYear.id.desc())
        .first()
    )

    if not reset and active_school_year and not _school_year_has_report_values(active_school_year):
        school_year = active_school_year
        school_year_name = active_school_year.name
    elif school_year and not reset and _school_year_has_report_values(school_year):
        if active_school_year and active_school_year.id != school_year.id and not _school_year_has_report_values(active_school_year):
            school_year = active_school_year
            school_year_name = active_school_year.name
        else:
            return {
                "message": f"Monthly canteen reporting already seeded for {school_year_name}.",
                "school_year": school_year_name,
                "created": False,
                "months_populated": 0,
            }

    created = False
    if not school_year:
        school_year = models.SchoolYear(
            name=school_year_name,
            start_year=start_year,
            end_year=end_year,
            is_active=existing_school_years == 0,
        )
        db.add(school_year)
        db.flush()
        created = True

    _ensure_school_year_defaults(db, school_year)
    db.flush()

    school_year = _load_school_year(db, school_year.id) or school_year
    reports_by_index = {int(report.month_index): report for report in school_year.monthly_reports}
    running_beginning_cash = _round_money(DEMO_BEGINNING_CASH_ON_HAND)

    for month_index, month_number, month_name in MONTH_SEQUENCE:
        report = reports_by_index.get(month_index)
        if not report:
            continue

        demo_row = DEMO_MONTHLY_REPORTS_BY_INDEX.get(month_index, {})
        current_sales = _round_money(demo_row.get("current_sales"))
        cost_of_sales = _round_money(demo_row.get("cost_of_sales"))
        expense_values = {
            str(category or "").strip().lower(): _round_money(amount)
            for category, amount in dict(demo_row.get("expenses") or {}).items()
        }

        report.month_number = month_number
        report.month_name = month_name
        report.calendar_year = _month_calendar_year(school_year, month_number)
        report.beginning_cash_on_hand = running_beginning_cash
        report.current_sales = current_sales
        report.other_income = 0.0
        report.purchases = 0.0
        report.inventory_used = 0.0
        report.product_cost = cost_of_sales
        report.notes = "Seeded demo monthly canteen reporting data"

        _create_default_expenses(db, report)
        expense_map = {
            str(expense.category or "").strip().lower(): expense
            for expense in report.expenses
        }

        total_operating_expenses = 0.0
        for sort_order, category in enumerate(DEFAULT_EXPENSE_CATEGORIES):
            normalized_category = category.strip().lower()
            expense = expense_map.get(normalized_category)
            if not expense:
                expense = models.Expense(
                    report_id=report.id,
                    category=category,
                    amount=0.0,
                    sort_order=sort_order,
                )
                db.add(expense)
                report.expenses.append(expense)
                expense_map[normalized_category] = expense

            amount = _round_money(expense_values.get(normalized_category))
            expense.category = category
            expense.amount = amount
            expense.sort_order = sort_order
            total_operating_expenses += amount

        running_beginning_cash = _round_money(
            running_beginning_cash + (current_sales - cost_of_sales) - total_operating_expenses
        )

    db.flush()

    return {
        "message": f"Monthly canteen reporting demo data seeded for {school_year_name}.",
        "school_year": school_year_name,
        "created": created,
        "months_populated": len(DEMO_MONTHLY_REPORT_ROWS),
    }


def _serialize_expense(expense: models.Expense) -> dict:
    return {
        "id": expense.id,
        "category": expense.category,
        "amount": _round_money(expense.amount),
        "sort_order": int(expense.sort_order or 0),
    }


def _serialize_allocation(
    allocation: models.Allocation,
    net_profit: float = 0.0,
    *,
    fund_expenses: float = 0.0,
    fund_others: float = 0.0,
) -> dict:
    percentage = float(allocation.percentage or 0.0)
    return {
        "id": allocation.id,
        "category_key": allocation.category_key,
        "label": allocation.label,
        "percentage": round(percentage, 2),
        "opening_balance": _round_money(getattr(allocation, "opening_balance", 0.0)),
        "sort_order": int(allocation.sort_order or 0),
        "amount": _round_money(net_profit * percentage / 100.0),
        "fund_expenses": _round_money(fund_expenses),
        "fund_others": _round_money(fund_others),
    }


def _fund_entry_map(report: models.MonthlyReport) -> dict[str, models.FundMonitoringEntry]:
    return {
        str(entry.category_key or "").strip(): entry
        for entry in getattr(report, "fund_entries", []) or []
    }


def _build_report_month_bounds(report: models.MonthlyReport) -> tuple[datetime, datetime]:
    last_day = calendar.monthrange(int(report.calendar_year), int(report.month_number))[1]
    return build_ph_date_range_bounds(
        f"{int(report.calendar_year):04d}-{int(report.month_number):02d}-01",
        f"{int(report.calendar_year):04d}-{int(report.month_number):02d}-{last_day:02d}",
    )


def _get_report_transaction_sales(db: Session, report: models.MonthlyReport) -> float:
    start_utc, end_utc = _build_report_month_bounds(report)
    total_sales = (
        db.query(func.coalesce(func.sum(models.Transaction.total), 0.0))
        .filter(models.Transaction.created_at.between(start_utc, end_utc))
        .scalar()
    )
    return _round_money(total_sales)


def _serialize_report(
    report: models.MonthlyReport,
    allocations: list[models.Allocation],
    *,
    current_sales_override: Optional[float] = None,
) -> dict:
    expenses = sorted(report.expenses, key=lambda item: (item.sort_order, item.id))
    serialized_expenses = [_serialize_expense(expense) for expense in expenses]
    beginning_cash = _round_money(report.beginning_cash_on_hand)
    saved_current_sales = _round_money(report.current_sales)
    analytics_current_sales = (
        None if current_sales_override is None else _round_money(current_sales_override)
    )
    current_sales = saved_current_sales
    if current_sales <= 0 and analytics_current_sales is not None:
        current_sales = analytics_current_sales
    other_income = _round_money(report.other_income)
    purchases = _round_money(report.purchases)
    inventory_used = _round_money(report.inventory_used)
    product_cost = _round_money(report.product_cost)
    cost_of_sales = _round_money(purchases + inventory_used + product_cost)
    total_operating_expenses = _round_money(sum(expense["amount"] for expense in serialized_expenses))
    gross_income = _round_money(current_sales - cost_of_sales)
    # Other income is treated as non-sales income added after gross income.
    net_profit = _round_money(gross_income + other_income - total_operating_expenses)
    ending_cash = _round_money(beginning_cash + net_profit)
    total_expenses = _round_money(cost_of_sales + total_operating_expenses)
    fund_entries_by_key = _fund_entry_map(report)
    allocations_breakdown = [
        _serialize_allocation(
            allocation,
            net_profit,
            fund_expenses=fund_entries_by_key.get(str(allocation.category_key or "").strip()).expenses
            if fund_entries_by_key.get(str(allocation.category_key or "").strip())
            else 0.0,
            fund_others=fund_entries_by_key.get(str(allocation.category_key or "").strip()).others
            if fund_entries_by_key.get(str(allocation.category_key or "").strip())
            else 0.0,
        )
        for allocation in sorted(
            allocations, key=lambda item: (item.sort_order, item.id)
        )
    ]

    return {
        "id": report.id,
        "school_year_id": report.school_year_id,
        "month_index": report.month_index,
        "month_number": report.month_number,
        "month_name": report.month_name,
        "month_short": calendar.month_abbr[int(report.month_number or 0)] or report.month_name[:3],
        "calendar_year": report.calendar_year,
        "month_label": f"{report.month_name} {report.calendar_year}",
        "beginning_cash_on_hand": beginning_cash,
        "current_sales": current_sales,
        "analytics_current_sales": analytics_current_sales,
        "current_sales_source": (
            "saved" if saved_current_sales > 0 or analytics_current_sales is None else "analytics"
        ),
        "other_income": other_income,
        "purchases": purchases,
        "inventory_used": inventory_used,
        "product_cost": product_cost,
        "cost_of_sales": cost_of_sales,
        "expenses": serialized_expenses,
        "total_operating_expenses": total_operating_expenses,
        "gross_income": gross_income,
        "net_profit": net_profit,
        "ending_cash": ending_cash,
        "total_expenses": total_expenses,
        "expenses_exceed_sales": total_expenses > _round_money(current_sales + other_income),
        "allocations": allocations_breakdown,
        "notes": report.notes or "",
        "updated_at": report.updated_at.isoformat() if report.updated_at else None,
        "comparison": None,
    }


def _build_auto_input_payload(
    report: dict,
    *,
    previous_report: Optional[dict],
    transaction_sales: float,
    historical_reports: list[dict],
) -> tuple[dict, dict]:
    historical_cost_reports = [
        item for item in historical_reports if item["current_sales"] > 0 and item["cost_of_sales"] > 0
    ]
    historical_operation_reports = [
        item for item in historical_reports if item["total_operating_expenses"] > 0
    ]

    if historical_cost_reports:
        historical_cost_ratio = sum(item["cost_of_sales"] for item in historical_cost_reports) / max(
            sum(item["current_sales"] for item in historical_cost_reports),
            1,
        )
    else:
        historical_cost_ratio = None

    auto_inputs = {
        "beginning_cash_on_hand": {
            "value": _round_money(
                previous_report["ending_cash"] if previous_report else report["beginning_cash_on_hand"]
            ),
            "source": (
                f'Auto-carried from {previous_report["month_label"]} ending cash'
                if previous_report
                else 'Using the saved value for this month'
            ),
        },
        "current_sales": {
            "value": transaction_sales,
            "source": (
                f'Auto-calculated from POS transactions for {report["month_label"]}'
                if transaction_sales > 0
                else 'No POS transactions found for this month yet'
            ),
        },
        "cost_of_sales": {
            "value": 0.0,
            "source": 'No historical cost-of-sales pattern found yet',
        },
        "operation_expenses": {
            "value": 0.0,
            "source": 'No historical operation-expense pattern found yet',
        },
    }

    if report["cost_of_sales"] > 0:
        auto_inputs["cost_of_sales"] = {
            "value": report["cost_of_sales"],
            "source": 'Using the saved cost of sales for this month',
        }
    elif previous_report and previous_report["cost_of_sales"] > 0:
        auto_inputs["cost_of_sales"] = {
            "value": previous_report["cost_of_sales"],
            "source": f'Copied from {previous_report["month_label"]} cost of sales',
        }
    elif historical_cost_ratio is not None and transaction_sales > 0:
        auto_inputs["cost_of_sales"] = {
            "value": _round_money(transaction_sales * historical_cost_ratio),
            "source": 'Estimated from historical cost-of-sales rate',
        }

    if report["total_operating_expenses"] > 0:
        auto_inputs["operation_expenses"] = {
            "value": report["total_operating_expenses"],
            "source": 'Using the saved operation expenses for this month',
        }
    elif previous_report and previous_report["total_operating_expenses"] > 0:
        auto_inputs["operation_expenses"] = {
            "value": previous_report["total_operating_expenses"],
            "source": f'Copied from {previous_report["month_label"]} operation expenses',
        }
    elif historical_operation_reports:
        auto_inputs["operation_expenses"] = {
            "value": _round_money(
                sum(item["total_operating_expenses"] for item in historical_operation_reports)
                / len(historical_operation_reports)
            ),
            "source": 'Estimated from average historical operation expenses',
        }

    default_inputs = {
        "beginning_cash_on_hand": report["beginning_cash_on_hand"],
        "current_sales": report["current_sales"],
        "cost_of_sales": report["cost_of_sales"],
        "operation_expenses": report["total_operating_expenses"],
    }

    return auto_inputs, {
        key: _round_money(value) for key, value in default_inputs.items()
    }


def _build_dashboard(serialized_reports: list[dict], allocations: list[models.Allocation]) -> dict:
    total_sales = _round_money(sum(report["current_sales"] for report in serialized_reports))
    total_expenses = _round_money(sum(report["total_expenses"] for report in serialized_reports))
    total_net_profit = _round_money(sum(report["net_profit"] for report in serialized_reports))
    allocation_percent_total = round(sum(float(item.percentage or 0.0) for item in allocations), 2)

    populated_reports = [
        report
        for report in serialized_reports
        if any(
            [
                report["beginning_cash_on_hand"],
                report["current_sales"],
                report["other_income"],
                report["cost_of_sales"],
                report["total_operating_expenses"],
            ]
        )
    ]

    if populated_reports:
        best_month = max(populated_reports, key=lambda item: (item["net_profit"], item["current_sales"]))
        lowest_month = min(populated_reports, key=lambda item: (item["net_profit"], item["current_sales"]))
    else:
        best_month = None
        lowest_month = None

    return {
        "total_monthly_sales": total_sales,
        "total_expenses": total_expenses,
        "net_profit": total_net_profit,
        "best_month": (
            {
                "label": best_month["month_label"],
                "net_profit": best_month["net_profit"],
                "sales": best_month["current_sales"],
            }
            if best_month
            else None
        ),
        "lowest_month": (
            {
                "label": lowest_month["month_label"],
                "net_profit": lowest_month["net_profit"],
                "sales": lowest_month["current_sales"],
            }
            if lowest_month
            else None
        ),
        "warning_count": sum(1 for report in serialized_reports if report["expenses_exceed_sales"]),
        "allocation_percent_total": allocation_percent_total,
        "monthly_sales_chart": [
            {
                "label": report["month_short"],
                "sales": report["current_sales"],
                "expenses": report["total_expenses"],
            }
            for report in serialized_reports
        ],
        "monthly_profit_chart": [
            {
                "label": report["month_short"],
                "net_profit": report["net_profit"],
                "ending_cash": report["ending_cash"],
            }
            for report in serialized_reports
        ],
    }


def _serialize_school_year_detail(db: Session, school_year: models.SchoolYear) -> dict:
    allocations = sorted(school_year.allocations, key=lambda item: (item.sort_order, item.id))
    reports = sorted(school_year.monthly_reports, key=lambda item: item.month_index)
    transaction_sales_by_report_id = {
        report.id: _get_report_transaction_sales(db, report)
        for report in reports
    }
    serialized_reports = [
        _serialize_report(
            report,
            allocations,
            current_sales_override=transaction_sales_by_report_id[report.id],
        )
        for report in reports
    ]

    previous_report = None
    historical_reports = []
    for report in serialized_reports:
        transaction_sales = transaction_sales_by_report_id[report["id"]]
        auto_inputs, default_inputs = _build_auto_input_payload(
            report,
            previous_report=previous_report,
            transaction_sales=transaction_sales,
            historical_reports=historical_reports,
        )
        report["auto_inputs"] = auto_inputs
        report["default_inputs"] = default_inputs
        report["auto_fill_applied_by_default"] = False

        if previous_report:
            report["comparison"] = {
                "previous_month_label": previous_report["month_label"],
                "sales_delta": _round_money(report["current_sales"] - previous_report["current_sales"]),
                "net_profit_delta": _round_money(report["net_profit"] - previous_report["net_profit"]),
            }
        previous_report = report
        historical_reports.append(report)

    return {
        "school_year": {
            "id": school_year.id,
            "name": school_year.name,
            "start_year": school_year.start_year,
            "end_year": school_year.end_year,
            "is_active": bool(school_year.is_active),
            "created_at": school_year.created_at.isoformat() if school_year.created_at else None,
            "updated_at": school_year.updated_at.isoformat() if school_year.updated_at else None,
        },
        "allocations": [_serialize_allocation(allocation) for allocation in allocations],
        "reports": serialized_reports,
        "dashboard": _build_dashboard(serialized_reports, allocations),
    }


def _build_school_year_summary(db: Session, school_year: models.SchoolYear) -> dict:
    allocations = sorted(school_year.allocations, key=lambda item: (item.sort_order, item.id))
    reports = sorted(school_year.monthly_reports, key=lambda item: item.month_index)
    serialized_reports = [
        _serialize_report(
            report,
            allocations,
            current_sales_override=_get_report_transaction_sales(db, report),
        )
        for report in reports
    ]
    dashboard = _build_dashboard(serialized_reports, allocations)
    months_with_entries = sum(
        1
        for report in serialized_reports
        if any(
            [
                report["beginning_cash_on_hand"],
                report["current_sales"],
                report["other_income"],
                report["cost_of_sales"],
                report["total_operating_expenses"],
            ]
        )
    )

    return {
        "id": school_year.id,
        "name": school_year.name,
        "start_year": school_year.start_year,
        "end_year": school_year.end_year,
        "is_active": bool(school_year.is_active),
        "months_with_entries": months_with_entries,
        "report_count": len(serialized_reports),
        "total_sales": dashboard["total_monthly_sales"],
        "net_profit": dashboard["net_profit"],
        "updated_at": school_year.updated_at.isoformat() if school_year.updated_at else None,
    }


def _ensure_and_reload_school_year(db: Session, school_year_id: int) -> models.SchoolYear:
    school_year = _load_school_year(db, school_year_id)
    if not school_year:
        raise HTTPException(status_code=404, detail="School year not found")

    if _ensure_school_year_defaults(db, school_year):
        db.commit()
        school_year = _load_school_year(db, school_year_id)

    return school_year


def _audit_log(
    db: Session,
    *,
    user_id: int,
    action: str,
    details: str,
    request: Optional[Request] = None,
) -> None:
    db.add(
        models.AuditLog(
            user_id=user_id,
            action=action,
            details=details,
            ip_address=request.client.host if request and request.client else None,
        )
    )


def _sqlite_database_path() -> Optional[str]:
    if not SQLALCHEMY_DATABASE_URL.startswith("sqlite:///"):
        return None
    return os.path.abspath(SQLALCHEMY_DATABASE_URL.replace("sqlite:///", "", 1))


def _remove_file_if_exists(path: str) -> None:
    try:
        if path and os.path.isfile(path):
            os.remove(path)
    except OSError:
        pass


def _prepare_workbook_recalculation(workbook) -> None:
    workbook.calculation.fullCalcOnLoad = True
    workbook.calculation.forceFullCalc = True
    workbook.calculation.calcMode = "auto"


def _populate_report_worksheet(
    worksheet,
    report: models.MonthlyReport,
    *,
    current_sales_override: Optional[float] = None,
    beginning_cash_override: Optional[float] = None,
) -> dict:
    saved_current_sales = _round_money(report.current_sales)
    analytics_current_sales = (
        None if current_sales_override is None else _round_money(current_sales_override)
    )
    current_sales = saved_current_sales
    if current_sales <= 0 and analytics_current_sales is not None:
        current_sales = analytics_current_sales
    beginning_cash = _round_money(
        report.beginning_cash_on_hand
        if beginning_cash_override is None
        else beginning_cash_override
    )
    cost_of_sales = _round_money(
        _round_money(report.purchases)
        + _round_money(report.inventory_used)
        + _round_money(report.product_cost)
    )

    worksheet["A13"] = f"For the Month of {report.month_name} {report.calendar_year}"
    worksheet["C15"] = beginning_cash
    worksheet["F16"] = current_sales
    worksheet["F17"] = cost_of_sales
    worksheet["F18"] = _round_money(current_sales - cost_of_sales)

    for cell_address in EXPENSE_CELL_BY_CATEGORY.values():
        worksheet[cell_address] = 0.0

    total_operating_expenses = 0.0
    for expense in sorted(report.expenses, key=lambda item: (item.sort_order, item.id)):
        category = str(expense.category or "").strip().lower()
        cell_address = EXPENSE_CELL_BY_CATEGORY.get(category)
        if cell_address:
            amount = _round_money(expense.amount)
            worksheet[cell_address] = amount
            total_operating_expenses += amount

    total_operating_expenses = _round_money(total_operating_expenses)
    additional_income = _round_money(report.other_income)
    net_profit = _round_money(current_sales - cost_of_sales - total_operating_expenses + additional_income)
    ending_cash = _round_money(beginning_cash + net_profit)

    worksheet["G32"] = 0.0
    worksheet["G33"] = 0.0
    worksheet["G34"] = additional_income
    worksheet["F28"] = total_operating_expenses
    worksheet["F35"] = additional_income
    worksheet["F36"] = net_profit

    return {
        "beginning_cash": beginning_cash,
        "current_sales": current_sales,
        "cost_of_sales": cost_of_sales,
        "total_operating_expenses": total_operating_expenses,
        "additional_income": additional_income,
        "net_profit": net_profit,
        "ending_cash": ending_cash,
    }


def _populate_fund_monitoring_worksheet(
    worksheet,
    allocations: list[models.Allocation],
    *,
    net_profit: float,
    previous_balances: dict[str, float],
    fund_entries_by_key: dict[str, models.FundMonitoringEntry],
) -> dict[str, float]:
    next_balances = dict(previous_balances)

    for column_letter, allocation in zip(FUND_MONITORING_COLUMNS, allocations):
        category_key = str(allocation.category_key or "").strip()
        percentage = round(float(allocation.percentage or 0.0), 2)
        previous_balance = _round_money(previous_balances.get(category_key, 0.0))
        interest = 0.0
        net_income = _round_money(_round_money(net_profit) * percentage / 100.0)
        fund_entry = fund_entries_by_key.get(category_key)
        expenses = _round_money(fund_entry.expenses if fund_entry else 0.0)
        others = _round_money(fund_entry.others if fund_entry else 0.0)
        total_current_expenses = _round_money(expenses)
        current_balance = _round_money(
            previous_balance + interest + net_income - total_current_expenses + others
        )

        worksheet[f"{column_letter}38"] = f"{str(allocation.label or '').upper()}\n{percentage:.2f}%"
        worksheet[f"{column_letter}39"] = previous_balance
        worksheet[f"{column_letter}40"] = interest
        worksheet[f"{column_letter}41"] = net_income
        worksheet[f"{column_letter}42"] = expenses
        worksheet[f"{column_letter}43"] = others
        worksheet[f"{column_letter}44"] = total_current_expenses
        worksheet[f"{column_letter}45"] = current_balance
        worksheet[f"{column_letter}46"] = "-"

        next_balances[category_key] = current_balance

    for column_letter in FUND_MONITORING_COLUMNS[len(allocations):]:
        for row_number in range(39, 47):
            worksheet[f"{column_letter}{row_number}"] = "-" if row_number == 46 else 0.0

    worksheet["H45"] = _round_money(
        sum(next_balances.get(str(allocation.category_key or "").strip(), 0.0) for allocation in allocations)
    )
    return next_balances


def _build_school_year_workbook_export(
    db: Session,
    school_year: models.SchoolYear,
    *,
    selected_report_id: Optional[int] = None,
) -> str:
    template_path = _template_path()
    if not os.path.isfile(template_path):
        raise HTTPException(status_code=404, detail="Report template file not found")

    active_sheet_name = None
    if selected_report_id is not None:
        selected_report = next(
            (report for report in school_year.monthly_reports if report.id == selected_report_id),
            None,
        )
        if not selected_report:
            raise HTTPException(status_code=404, detail="Selected monthly report not found")
        active_sheet_name = selected_report.month_name

    workbook = load_workbook(template_path)
    _prepare_workbook_recalculation(workbook)

    allocations = sorted(school_year.allocations, key=lambda item: (item.sort_order, item.id))[
        :len(FUND_MONITORING_COLUMNS)
    ]
    previous_ending_cash = None
    previous_fund_balances: dict[str, float] = {
        str(allocation.category_key or "").strip(): _round_money(
            getattr(allocation, "opening_balance", 0.0)
        )
        for allocation in allocations
    }
    for report in sorted(school_year.monthly_reports, key=lambda item: item.month_index):
        if report.month_name in workbook.sheetnames:
            worksheet = workbook[report.month_name]
            result = _populate_report_worksheet(
                worksheet,
                report,
                current_sales_override=_get_report_transaction_sales(db, report),
                beginning_cash_override=previous_ending_cash,
            )
            previous_fund_balances = _populate_fund_monitoring_worksheet(
                worksheet,
                allocations,
                net_profit=result["net_profit"],
                previous_balances=previous_fund_balances,
                fund_entries_by_key=_fund_entry_map(report),
            )
            previous_ending_cash = result["ending_cash"]

    if active_sheet_name and active_sheet_name in workbook.sheetnames:
        for worksheet in workbook.worksheets:
            worksheet.sheet_view.tabSelected = False
        active_worksheet = workbook[active_sheet_name]
        workbook.active = active_worksheet
        active_worksheet.sheet_view.tabSelected = True

    export_file = tempfile.NamedTemporaryFile(
        delete=False,
        prefix=f"canteen-report-{school_year.name}-",
        suffix=".xlsx",
    )
    export_path = export_file.name
    export_file.close()

    try:
        workbook.save(export_path)
    except Exception:
        _remove_file_if_exists(export_path)
        raise
    finally:
        workbook.close()

    return export_path


@router.get("/api/financial-reports/school-years")
def list_school_years(
    db: Session = Depends(get_db),
    _: models.User = Depends(require_financial_report_user),
):
    school_years = (
        db.query(models.SchoolYear)
        .options(
            joinedload(models.SchoolYear.monthly_reports).joinedload(models.MonthlyReport.expenses),
            joinedload(models.SchoolYear.monthly_reports).joinedload(models.MonthlyReport.fund_entries),
            joinedload(models.SchoolYear.allocations),
        )
        .order_by(models.SchoolYear.start_year.desc(), models.SchoolYear.id.desc())
        .all()
    )

    summaries = []
    for school_year in school_years:
        if _ensure_school_year_defaults(db, school_year):
            db.commit()
            school_year = _load_school_year(db, school_year.id)
        summaries.append(_build_school_year_summary(db, school_year))

    return summaries


@router.post("/api/financial-reports/school-years")
def create_school_year(
    payload: schemas.FinancialSchoolYearCreate,
    request: Request,
    db: Session = Depends(get_db),
    current: models.User = Depends(auth.require_admin),
):
    start_year = int(payload.start_year)
    end_year = int(payload.end_year or (start_year + 1))

    if end_year <= start_year:
        raise HTTPException(status_code=400, detail="End year must be after the start year")

    school_year_name = _format_school_year_name(start_year, end_year)
    existing = db.query(models.SchoolYear).filter(models.SchoolYear.name == school_year_name).first()
    if existing:
        raise HTTPException(status_code=409, detail="School year already exists")

    if payload.set_active:
        db.query(models.SchoolYear).update({models.SchoolYear.is_active: False})

    school_year = models.SchoolYear(
        name=school_year_name,
        start_year=start_year,
        end_year=end_year,
        is_active=bool(payload.set_active),
    )
    db.add(school_year)
    db.flush()
    _ensure_school_year_defaults(db, school_year)
    _audit_log(
        db,
        user_id=current.id,
        action="FINANCIAL_REPORT_SCHOOL_YEAR_CREATED",
        details=f"Created school year {school_year_name}",
        request=request,
    )
    db.commit()

    return _serialize_school_year_detail(db, _ensure_and_reload_school_year(db, school_year.id))


@router.delete("/api/financial-reports/school-years/{school_year_id}")
def delete_school_year(
    school_year_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current: models.User = Depends(auth.require_admin),
):
    school_year = _load_school_year(db, school_year_id)
    if not school_year:
        raise HTTPException(status_code=404, detail="School year not found")

    deleted_name = school_year.name
    db.delete(school_year)
    db.flush()

    active_school_year = (
        db.query(models.SchoolYear)
        .filter(models.SchoolYear.is_active.is_(True))
        .order_by(models.SchoolYear.start_year.desc(), models.SchoolYear.id.desc())
        .first()
    )
    if not active_school_year:
        active_school_year = (
            db.query(models.SchoolYear)
            .order_by(models.SchoolYear.start_year.desc(), models.SchoolYear.id.desc())
            .first()
        )
        if active_school_year:
            active_school_year.is_active = True

    _audit_log(
        db,
        user_id=current.id,
        action="FINANCIAL_REPORT_SCHOOL_YEAR_DELETED",
        details=f"Deleted school year {deleted_name}",
        request=request,
    )
    db.commit()

    return {
        "message": f"School year {deleted_name} removed.",
        "deleted_id": school_year_id,
        "active_school_year_id": active_school_year.id if active_school_year else None,
    }


@router.get("/api/financial-reports/school-years/{school_year_id}")
def get_school_year_detail(
    school_year_id: int,
    db: Session = Depends(get_db),
    _: models.User = Depends(require_financial_report_user),
):
    school_year = _ensure_and_reload_school_year(db, school_year_id)
    return _serialize_school_year_detail(db, school_year)


@router.put("/api/financial-reports/reports/{report_id}")
def update_report(
    report_id: int,
    payload: schemas.FinancialReportUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current: models.User = Depends(require_financial_report_user),
):
    report = (
        db.query(models.MonthlyReport)
        .options(
            joinedload(models.MonthlyReport.expenses),
            joinedload(models.MonthlyReport.fund_entries),
            joinedload(models.MonthlyReport.school_year).joinedload(models.SchoolYear.allocations),
        )
        .filter(models.MonthlyReport.id == report_id)
        .first()
    )
    if not report:
        raise HTTPException(status_code=404, detail="Monthly report not found")

    updates = payload.model_dump(exclude_unset=True)
    for field_name, value in updates.items():
        if field_name == "notes":
            setattr(report, field_name, value or "")
        else:
            setattr(report, field_name, _round_money(value))

    _audit_log(
        db,
        user_id=current.id,
        action="FINANCIAL_REPORT_UPDATED",
        details=f"Updated {report.month_name} {report.calendar_year} for {report.school_year.name}",
        request=request,
    )
    db.commit()

    report = (
        db.query(models.MonthlyReport)
        .options(
            joinedload(models.MonthlyReport.expenses),
            joinedload(models.MonthlyReport.fund_entries),
            joinedload(models.MonthlyReport.school_year).joinedload(models.SchoolYear.allocations),
        )
        .filter(models.MonthlyReport.id == report_id)
        .first()
    )

    allocations = sorted(report.school_year.allocations, key=lambda item: (item.sort_order, item.id))
    return {
        "report": _serialize_report(
            report,
            allocations,
            current_sales_override=_get_report_transaction_sales(db, report),
        )
    }


@router.put("/api/financial-reports/reports/{report_id}/expenses")
def replace_report_expenses(
    report_id: int,
    payload: schemas.FinancialExpensesUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current: models.User = Depends(require_financial_report_user),
):
    report = (
        db.query(models.MonthlyReport)
        .options(
            joinedload(models.MonthlyReport.expenses),
            joinedload(models.MonthlyReport.fund_entries),
            joinedload(models.MonthlyReport.school_year).joinedload(models.SchoolYear.allocations),
        )
        .filter(models.MonthlyReport.id == report_id)
        .first()
    )
    if not report:
        raise HTTPException(status_code=404, detail="Monthly report not found")

    for expense in list(report.expenses):
        db.delete(expense)
    db.flush()

    for sort_order, item in enumerate(payload.expenses):
        category = str(item.category or "").strip()
        if not category:
            continue

        db.add(
            models.Expense(
                report_id=report.id,
                category=category,
                amount=_round_money(item.amount),
                sort_order=int(item.sort_order if item.sort_order is not None else sort_order),
            )
        )

    db.flush()
    report = (
        db.query(models.MonthlyReport)
        .options(
            joinedload(models.MonthlyReport.expenses),
            joinedload(models.MonthlyReport.fund_entries),
            joinedload(models.MonthlyReport.school_year).joinedload(models.SchoolYear.allocations),
        )
        .filter(models.MonthlyReport.id == report_id)
        .first()
    )
    _create_default_expenses(db, report)
    _audit_log(
        db,
        user_id=current.id,
        action="FINANCIAL_REPORT_EXPENSES_UPDATED",
        details=f"Replaced expenses for {report.month_name} {report.calendar_year} in {report.school_year.name}",
        request=request,
    )
    db.commit()

    report = (
        db.query(models.MonthlyReport)
        .options(
            joinedload(models.MonthlyReport.expenses),
            joinedload(models.MonthlyReport.fund_entries),
            joinedload(models.MonthlyReport.school_year).joinedload(models.SchoolYear.allocations),
        )
        .filter(models.MonthlyReport.id == report_id)
        .first()
    )
    allocations = sorted(report.school_year.allocations, key=lambda item: (item.sort_order, item.id))
    return {
        "report": _serialize_report(
            report,
            allocations,
            current_sales_override=_get_report_transaction_sales(db, report),
        )
    }


@router.put("/api/financial-reports/reports/{report_id}/fund-monitoring")
def replace_report_fund_monitoring(
    report_id: int,
    payload: schemas.FinancialFundMonitoringUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current: models.User = Depends(require_financial_report_user),
):
    report = (
        db.query(models.MonthlyReport)
        .options(
            joinedload(models.MonthlyReport.expenses),
            joinedload(models.MonthlyReport.fund_entries),
            joinedload(models.MonthlyReport.school_year).joinedload(models.SchoolYear.allocations),
        )
        .filter(models.MonthlyReport.id == report_id)
        .first()
    )
    if not report:
        raise HTTPException(status_code=404, detail="Monthly report not found")

    for entry in list(report.fund_entries):
        db.delete(entry)
    db.flush()

    valid_category_keys = {
        str(allocation.category_key or "").strip()
        for allocation in report.school_year.allocations
    }

    for item in payload.entries:
        category_key = str(item.category_key or "").strip()
        if not category_key or category_key not in valid_category_keys:
            continue

        db.add(
            models.FundMonitoringEntry(
                report_id=report.id,
                category_key=category_key,
                expenses=_round_money(item.expenses),
                others=_round_money(item.others),
            )
        )

    _audit_log(
        db,
        user_id=current.id,
        action="FINANCIAL_REPORT_FUND_MONITORING_UPDATED",
        details=f"Updated fund monitoring for {report.month_name} {report.calendar_year} in {report.school_year.name}",
        request=request,
    )
    db.commit()

    report = (
        db.query(models.MonthlyReport)
        .options(
            joinedload(models.MonthlyReport.expenses),
            joinedload(models.MonthlyReport.fund_entries),
            joinedload(models.MonthlyReport.school_year).joinedload(models.SchoolYear.allocations),
        )
        .filter(models.MonthlyReport.id == report_id)
        .first()
    )
    allocations = sorted(report.school_year.allocations, key=lambda item: (item.sort_order, item.id))
    return {
        "report": _serialize_report(
            report,
            allocations,
            current_sales_override=_get_report_transaction_sales(db, report),
        )
    }


@router.put("/api/financial-reports/school-years/{school_year_id}/allocations")
def replace_allocations(
    school_year_id: int,
    payload: schemas.FinancialAllocationsUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current: models.User = Depends(auth.require_admin),
):
    school_year = _ensure_and_reload_school_year(db, school_year_id)

    for allocation in list(school_year.allocations):
        db.delete(allocation)
    db.flush()

    for sort_order, item in enumerate(payload.allocations):
        label = str(item.label or "").strip()
        category_key = str(item.category_key or "").strip()
        if not label or not category_key:
            continue
        db.add(
            models.Allocation(
                school_year_id=school_year.id,
                category_key=category_key,
                label=label,
                percentage=round(float(item.percentage or 0.0), 2),
                opening_balance=_round_money(item.opening_balance),
                sort_order=int(item.sort_order if item.sort_order is not None else sort_order),
            )
        )

    _audit_log(
        db,
        user_id=current.id,
        action="FINANCIAL_REPORT_ALLOCATIONS_UPDATED",
        details=f"Updated allocations for {school_year.name}",
        request=request,
    )
    db.commit()

    school_year = _ensure_and_reload_school_year(db, school_year_id)
    detail = _serialize_school_year_detail(db, school_year)
    return {
        "allocations": detail["allocations"],
        "allocation_percent_total": detail["dashboard"]["allocation_percent_total"],
    }


@router.get("/api/financial-reports/school-years/{school_year_id}/export")
def export_school_year_workbook(
    school_year_id: int,
    report_id: Optional[int] = None,
    db: Session = Depends(get_db),
    _: models.User = Depends(require_financial_report_user),
):
    school_year = _ensure_and_reload_school_year(db, school_year_id)
    export_path = _build_school_year_workbook_export(
        db,
        school_year,
        selected_report_id=report_id,
    )

    return FileResponse(
        export_path,
        filename=f"CANTEEN-REPORT-{school_year.name}.xlsx",
        media_type=EXCEL_MEDIA_TYPE,
        background=BackgroundTask(_remove_file_if_exists, export_path),
    )


@router.get("/api/financial-reports/template")
def download_report_template(
    _: models.User = Depends(require_financial_report_user),
):
    template_path = _template_path()
    if not os.path.isfile(template_path):
        raise HTTPException(status_code=404, detail="Report template file not found")

    return FileResponse(
        template_path,
        filename=TEMPLATE_FILENAME,
        media_type=EXCEL_MEDIA_TYPE,
    )


@router.post("/api/financial-reports/backup")
def backup_database(
    request: Request,
    db: Session = Depends(get_db),
    current: models.User = Depends(auth.require_admin),
):
    database_path = _sqlite_database_path()
    if not database_path or not os.path.isfile(database_path):
        raise HTTPException(status_code=400, detail="Database backup is available only for local SQLite deployments")

    timestamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
    backup_path = f"{database_path}.backup-{timestamp}-financial-reports"
    shutil.copy2(database_path, backup_path)
    _audit_log(
        db,
        user_id=current.id,
        action="FINANCIAL_REPORT_DATABASE_BACKUP",
        details=os.path.basename(backup_path),
        request=request,
    )
    db.commit()

    return {
        "message": "Database backup created",
        "filename": os.path.basename(backup_path),
        "path": backup_path,
    }
