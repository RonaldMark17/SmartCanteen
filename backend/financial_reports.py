import calendar
import os
import shutil
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session, joinedload

import backend.auth as auth
import backend.models as models
import backend.schemas as schemas
from backend.database import SQLALCHEMY_DATABASE_URL, get_db


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
    "Gas",
    "Supplies",
    "Helper Salary",
    "Repairs",
    "Utilities",
    "Other Expenses",
]
DEFAULT_ALLOCATIONS = [
    ("supplementary_feeding", "Supplementary Feeding", 35.0),
    ("school_clinic", "School Clinic", 5.0),
    ("faculty_student_development", "Faculty/Student Development", 15.0),
    ("school_operating_fund", "School Operating Fund", 25.0),
    ("he_instructional_fund", "H.E Instructional Fund", 10.0),
    ("revolving_capital_fund", "Revolving Capital Fund", 10.0),
]


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


def _serialize_expense(expense: models.Expense) -> dict:
    return {
        "id": expense.id,
        "category": expense.category,
        "amount": _round_money(expense.amount),
        "sort_order": int(expense.sort_order or 0),
    }


def _serialize_allocation(allocation: models.Allocation, net_profit: float = 0.0) -> dict:
    percentage = float(allocation.percentage or 0.0)
    return {
        "id": allocation.id,
        "category_key": allocation.category_key,
        "label": allocation.label,
        "percentage": round(percentage, 2),
        "sort_order": int(allocation.sort_order or 0),
        "amount": _round_money(net_profit * percentage / 100.0),
    }


def _serialize_report(report: models.MonthlyReport, allocations: list[models.Allocation]) -> dict:
    expenses = sorted(report.expenses, key=lambda item: (item.sort_order, item.id))
    serialized_expenses = [_serialize_expense(expense) for expense in expenses]
    beginning_cash = _round_money(report.beginning_cash_on_hand)
    current_sales = _round_money(report.current_sales)
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
    allocations_breakdown = [
        _serialize_allocation(allocation, net_profit) for allocation in sorted(
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


def _serialize_school_year_detail(school_year: models.SchoolYear) -> dict:
    allocations = sorted(school_year.allocations, key=lambda item: (item.sort_order, item.id))
    reports = sorted(school_year.monthly_reports, key=lambda item: item.month_index)
    serialized_reports = [_serialize_report(report, allocations) for report in reports]

    previous_report = None
    for report in serialized_reports:
        if previous_report:
            report["comparison"] = {
                "previous_month_label": previous_report["month_label"],
                "sales_delta": _round_money(report["current_sales"] - previous_report["current_sales"]),
                "net_profit_delta": _round_money(report["net_profit"] - previous_report["net_profit"]),
            }
        previous_report = report

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


def _build_school_year_summary(school_year: models.SchoolYear) -> dict:
    detail = _serialize_school_year_detail(school_year)
    reports = detail["reports"]
    months_with_entries = sum(
        1
        for report in reports
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
        "id": detail["school_year"]["id"],
        "name": detail["school_year"]["name"],
        "start_year": detail["school_year"]["start_year"],
        "end_year": detail["school_year"]["end_year"],
        "is_active": detail["school_year"]["is_active"],
        "months_with_entries": months_with_entries,
        "report_count": len(reports),
        "total_sales": detail["dashboard"]["total_monthly_sales"],
        "net_profit": detail["dashboard"]["net_profit"],
        "updated_at": detail["school_year"]["updated_at"],
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


@router.get("/api/financial-reports/school-years")
def list_school_years(
    db: Session = Depends(get_db),
    _: models.User = Depends(require_financial_report_user),
):
    school_years = (
        db.query(models.SchoolYear)
        .options(
            joinedload(models.SchoolYear.monthly_reports).joinedload(models.MonthlyReport.expenses),
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
        summaries.append(_build_school_year_summary(school_year))

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

    return _serialize_school_year_detail(_ensure_and_reload_school_year(db, school_year.id))


@router.get("/api/financial-reports/school-years/{school_year_id}")
def get_school_year_detail(
    school_year_id: int,
    db: Session = Depends(get_db),
    _: models.User = Depends(require_financial_report_user),
):
    school_year = _ensure_and_reload_school_year(db, school_year_id)
    return _serialize_school_year_detail(school_year)


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
            joinedload(models.MonthlyReport.school_year).joinedload(models.SchoolYear.allocations),
        )
        .filter(models.MonthlyReport.id == report_id)
        .first()
    )

    allocations = sorted(report.school_year.allocations, key=lambda item: (item.sort_order, item.id))
    return {"report": _serialize_report(report, allocations)}


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
            joinedload(models.MonthlyReport.school_year).joinedload(models.SchoolYear.allocations),
        )
        .filter(models.MonthlyReport.id == report_id)
        .first()
    )
    allocations = sorted(report.school_year.allocations, key=lambda item: (item.sort_order, item.id))
    return {"report": _serialize_report(report, allocations)}


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
    detail = _serialize_school_year_detail(school_year)
    return {
        "allocations": detail["allocations"],
        "allocation_percent_total": detail["dashboard"]["allocation_percent_total"],
    }


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
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
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
