from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from . import models


def get_top_products(db: Session, days: int = 7, limit: int = 10):
    cutoff = datetime.utcnow() - timedelta(days=max(days, 1))
    transactions = (
        db.query(models.Transaction)
        .filter(models.Transaction.created_at >= cutoff)
        .all()
    )

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


def get_hourly_heatmap(db: Session, days: int = 30):
    cutoff = datetime.utcnow() - timedelta(days=max(days, 1))
    transactions = (
        db.query(models.Transaction)
        .filter(models.Transaction.created_at >= cutoff)
        .all()
    )

    hourly_sales = {hour: 0.0 for hour in range(24)}
    for transaction in transactions:
        created_at = transaction.created_at or datetime.utcnow()
        hourly_sales[created_at.hour] += float(transaction.total or 0)

    return [
        {"hour": hour, "sales": round(hourly_sales[hour], 2)}
        for hour in range(24)
    ]
