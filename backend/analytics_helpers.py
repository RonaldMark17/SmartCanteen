from sqlalchemy.orm import Session
from typing import Optional
from sqlalchemy import desc, func

from . import models
from .time_utils import build_ph_date_range_bounds, get_ph_recent_cutoff_utc_naive, to_ph_time


def _apply_transaction_range(query, days: int = 7, start_date: Optional[str] = None, end_date: Optional[str] = None):
    if start_date and end_date:
        start, end = build_ph_date_range_bounds(start_date, end_date)
        return query.filter(models.Transaction.created_at.between(start, end))

    cutoff = get_ph_recent_cutoff_utc_naive(days)
    return query.filter(models.Transaction.created_at >= cutoff)


def get_top_products(
    db: Session,
    days: int = 7,
    limit: int = 10,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
):
    quantity_total = func.coalesce(func.sum(models.TransactionItem.quantity), 0).label("total_qty")
    revenue_total = func.coalesce(
        func.sum(models.TransactionItem.quantity * models.TransactionItem.unit_price),
        0,
    ).label("revenue")

    query = (
        db.query(
            models.TransactionItem.product_id.label("product_id"),
            models.Product.name.label("product_name"),
            quantity_total,
            revenue_total,
        )
        .join(models.Transaction, models.Transaction.id == models.TransactionItem.transaction_id)
        .outerjoin(models.Product, models.Product.id == models.TransactionItem.product_id)
    )
    query = _apply_transaction_range(query, days, start_date, end_date)

    ranked = (
        query.group_by(models.TransactionItem.product_id, models.Product.name)
        .order_by(desc(quantity_total), desc(revenue_total), models.Product.name)
        .limit(limit)
        .all()
    )

    return [
        {
            "product_id": row.product_id,
            "product_name": row.product_name or "Unknown",
            "total_qty": int(row.total_qty or 0),
            "revenue": round(float(row.revenue or 0), 2),
        }
        for row in ranked
    ]


def get_hourly_heatmap(
    db: Session,
    days: int = 30,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
):
    query = db.query(models.Transaction.created_at, models.Transaction.total)
    rows = _apply_transaction_range(query, days, start_date, end_date).all()

    hourly_sales = {hour: 0.0 for hour in range(24)}
    hourly_transactions = {hour: 0 for hour in range(24)}
    for created_at, total in rows:
        local_created_at = to_ph_time(created_at)
        hourly_sales[local_created_at.hour] += float(total or 0)
        hourly_transactions[local_created_at.hour] += 1

    return [
        {
            "hour": hour,
            "sales": round(hourly_sales[hour], 2),
            "transactions": hourly_transactions[hour],
        }
        for hour in range(24)
    ]
