from sqlalchemy.orm import Session
from typing import Optional

from . import models
from .time_utils import build_ph_date_range_bounds, get_ph_recent_cutoff_utc_naive, to_ph_time


def _get_transactions_for_range(
    db: Session,
    days: int = 7,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
):
    query = db.query(models.Transaction)

    if start_date and end_date:
        start, end = build_ph_date_range_bounds(start_date, end_date)
        return query.filter(models.Transaction.created_at.between(start, end)).all()

    cutoff = get_ph_recent_cutoff_utc_naive(days)
    return query.filter(models.Transaction.created_at >= cutoff).all()


def get_top_products(
    db: Session,
    days: int = 7,
    limit: int = 10,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
):
    transactions = _get_transactions_for_range(db, days, start_date, end_date)

    products = {}
    for transaction in transactions:
        for item in transaction.items or []:
            product_name = item.product.name if item.product else "Unknown"
            entry = products.setdefault(
                item.product_id,
                {
                    "product_id": item.product_id,
                    "product_name": product_name,
                    "total_qty": 0,
                    "revenue": 0.0,
                },
            )
            quantity = int(item.quantity or 0)
            price = float(item.unit_price or 0)
            entry["total_qty"] += quantity
            entry["revenue"] += quantity * price

    ranked = sorted(
        products.values(),
        key=lambda product: (-product["total_qty"], -product["revenue"], product["product_name"]),
    )[:limit]

    return [
        {
            **product,
            "revenue": round(product["revenue"], 2),
        }
        for product in ranked
    ]


def get_hourly_heatmap(
    db: Session,
    days: int = 30,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
):
    transactions = _get_transactions_for_range(db, days, start_date, end_date)

    hourly_sales = {hour: 0.0 for hour in range(24)}
    for transaction in transactions:
        created_at = to_ph_time(transaction.created_at)
        hourly_sales[created_at.hour] += float(transaction.total or 0)

    return [
        {"hour": hour, "sales": round(hourly_sales[hour], 2)}
        for hour in range(24)
    ]
