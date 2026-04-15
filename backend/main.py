"""
main.py  –  SmartCanteen AI  |  FastAPI Backend
─────────────────────────────────────────────────
Run:  uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
─────────────────────────────────────────────────
"""

from fastapi import FastAPI, Depends, HTTPException, Request, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
from typing import List, Optional
import os

import backend.models as models
import backend.schemas as schemas
import backend.auth as auth
import backend.analytics_helpers as analytics_helpers
import backend.ml_predictor as ml_predictor
from backend.database import engine, get_db, Base
from backend.time_utils import (
    build_ph_date_range_bounds,
    build_recent_ph_day_keys,
    get_ph_day_bounds_utc_naive,
    get_ph_recent_cutoff_utc_naive,
    get_ph_today,
    normalize_client_timestamp,
    to_ph_time,
)

from sqlalchemy.orm import joinedload


class TransactionValidationError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.status_code = status_code


def _normalize_transaction_items(items) -> List[dict]:
    normalized_items = []

    for item in items:
        try:
            if isinstance(item, dict):
                normalized_items.append({
                    "product_id": int(item["product_id"]),
                    "quantity": int(item["quantity"]),
                    "unit_price": float(item["unit_price"]),
                })
            else:
                normalized_items.append({
                    "product_id": int(item.product_id),
                    "quantity": int(item.quantity),
                    "unit_price": float(item.unit_price),
                })
        except (AttributeError, KeyError, TypeError, ValueError) as exc:
            raise TransactionValidationError("Invalid transaction item payload") from exc

    if not normalized_items:
        raise TransactionValidationError("Transaction must include at least one item")

    return normalized_items


def _persist_transaction(
    db: Session,
    *,
    user_id: int,
    items,
    discount: float = 0.0,
    payment_type: str = "cash",
    notes: Optional[str] = None,
    created_at: Optional[datetime] = None,
    synced: bool = True,
):
    normalized_items = _normalize_transaction_items(items)
    discount_value = float(discount or 0)
    subtotal = sum(item["quantity"] * item["unit_price"] for item in normalized_items)
    total = max(0.0, subtotal - discount_value)

    txn_kwargs = {
        "user_id": user_id,
        "total": total,
        "discount": discount_value,
        "payment_type": payment_type or "cash",
        "notes": notes,
        "synced": synced,
    }
    if created_at is not None:
        txn_kwargs["created_at"] = created_at

    txn = models.Transaction(**txn_kwargs)
    db.add(txn)
    db.flush()

    for item in normalized_items:
        if item["quantity"] <= 0:
            raise TransactionValidationError("Transaction item quantity must be greater than zero")

        product = db.query(models.Product).filter(models.Product.id == item["product_id"]).first()
        if not product or not product.is_active:
            raise TransactionValidationError(
                f"Product {item['product_id']} not found",
                status_code=404,
            )
        if product.stock < item["quantity"]:
            raise TransactionValidationError(
                f"Insufficient stock for '{product.name}' "
                f"(available: {product.stock}, requested: {item['quantity']})",
            )

        product.stock -= item["quantity"]
        db.add(models.TransactionItem(
            transaction_id=txn.id,
            product_id=item["product_id"],
            quantity=item["quantity"],
            unit_price=item["unit_price"],
        ))

    db.flush()
    return txn

# ── Bootstrap ─────────────────────────────────────────────────────────────────
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="SmartCanteen AI",
    description="Predictive Inventory & Sales System",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve the PWA frontend
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
FRONTEND_CANDIDATES = [
    os.path.join(PROJECT_ROOT, "smartcanteen", "dist"),
    os.path.join(PROJECT_ROOT, "frontend"),
]
FRONTEND_DIR = next((path for path in FRONTEND_CANDIDATES if os.path.isdir(path)), None)
RESERVED_FRONTEND_PREFIXES = {"api", "docs", "redoc", "openapi.json"}


def _resolve_frontend_file(path: str):
    if not FRONTEND_DIR:
        return None

    relative_path = os.path.normpath(path).lstrip("\\/")
    absolute_root = os.path.abspath(FRONTEND_DIR)
    absolute_path = os.path.abspath(os.path.join(absolute_root, relative_path))

    if os.path.commonpath([absolute_root, absolute_path]) != absolute_root:
        return None

    return absolute_path if os.path.isfile(absolute_path) else None


def _frontend_index_response():
    index_file = _resolve_frontend_file("index.html")
    if index_file:
        return FileResponse(index_file)
    return {"message": "SmartCanteen AI API is running. Visit /docs for Swagger UI."}


if FRONTEND_DIR:
    app.mount("/app", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")

@app.get("/", include_in_schema=False)
def root():
    return _frontend_index_response()


@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    favicon_file = _resolve_frontend_file("favicon.ico") or _resolve_frontend_file("favicon.svg")
    if favicon_file:
        return FileResponse(favicon_file)
    return Response(status_code=204)


# ═══════════════════════════════════════════════════════════════════════════════
# AUTH
# ═══════════════════════════════════════════════════════════════════════════════

@app.post("/api/auth/login", tags=["Auth"])
def login(payload: schemas.LoginRequest, req: Request, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.username == payload.username).first()

    if not user or not auth.verify_password(payload.password, user.password_hash):
        db.add(models.AuditLog(
            action="LOGIN_FAILED",
            details=f"Username: {payload.username}",
            ip_address=req.client.host,
        ))
        db.commit()
        raise HTTPException(status_code=401, detail="Invalid username or password")

    token = auth.create_access_token({"sub": user.username})

    db.add(models.AuditLog(
        user_id=user.id, action="LOGIN",
        details="Successful login", ip_address=req.client.host,
    ))
    db.commit()

    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": user.id, "username": user.username,
            "full_name": user.full_name, "role": user.role,
        },
    }


@app.post("/api/auth/register", tags=["Auth"])
def register(
    data: schemas.UserCreate,
    db: Session = Depends(get_db),
    current: models.User = Depends(auth.require_admin),
):
    if db.query(models.User).filter(models.User.username == data.username).first():
        raise HTTPException(status_code=400, detail="Username already exists")

    user = models.User(
        username=data.username,
        full_name=data.full_name,
        password_hash=auth.get_password_hash(data.password),
        role=data.role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    db.add(models.AuditLog(
        user_id=current.id, action="USER_CREATED",
        details=f"Created user: {data.username} (role={data.role})",
    ))
    db.commit()
    return {"message": "User created", "id": user.id}


@app.get("/api/auth/me", tags=["Auth"])
def me(current: models.User = Depends(auth.get_current_user)):
    return {"id": current.id, "username": current.username,
            "full_name": current.full_name, "role": current.role}


# ═══════════════════════════════════════════════════════════════════════════════
# PRODUCTS
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/api/products", response_model=List[schemas.ProductResponse], tags=["Products"])
def list_products(
    active_only: bool = True,
    db: Session = Depends(get_db),
    _: models.User = Depends(auth.get_current_user),
):
    q = db.query(models.Product)
    if active_only:
        q = q.filter(models.Product.is_active == True)
    return q.order_by(models.Product.category, models.Product.name).all()


@app.post("/api/products", response_model=schemas.ProductResponse, tags=["Products"])
def create_product(
    data: schemas.ProductCreate,
    db: Session = Depends(get_db),
    current: models.User = Depends(auth.require_admin),
):
    product = models.Product(**data.model_dump())
    db.add(product)
    db.commit()
    db.refresh(product)
    db.add(models.AuditLog(user_id=current.id, action="PRODUCT_CREATED",
                           details=f"Product: {data.name}"))
    db.commit()
    return product


@app.put("/api/products/{pid}", response_model=schemas.ProductResponse, tags=["Products"])
def update_product(
    pid: int,
    data: schemas.ProductUpdate,
    db: Session = Depends(get_db),
    current: models.User = Depends(auth.require_admin),
):
    product = db.query(models.Product).filter(models.Product.id == pid).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(product, field, value)
    product.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(product)

    db.add(models.AuditLog(user_id=current.id, action="PRODUCT_UPDATED",
                           details=f"Product ID: {pid}"))
    db.commit()
    return product


@app.delete("/api/products/{pid}", tags=["Products"])
def delete_product(
    pid: int,
    db: Session = Depends(get_db),
    current: models.User = Depends(auth.require_admin),
):
    product = db.query(models.Product).filter(models.Product.id == pid).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    product.is_active = False
    db.commit()
    db.add(models.AuditLog(user_id=current.id, action="PRODUCT_DELETED",
                           details=f"Deactivated product ID: {pid}"))
    db.commit()
    return {"message": "Product deactivated"}


@app.get("/api/products/low-stock", tags=["Products"])
def low_stock(
    db: Session = Depends(get_db),
    _: models.User = Depends(auth.get_current_user),
):
    return (
        db.query(models.Product)
        .filter(models.Product.is_active == True,
                models.Product.stock <= models.Product.min_stock)
        .all()
    )


# ═══════════════════════════════════════════════════════════════════════════════
# TRANSACTIONS  (POS)
# ═══════════════════════════════════════════════════════════════════════════════

@app.post("/api/transactions", response_model=schemas.TransactionResponse, tags=["Transactions"])
def create_transaction(
    data: schemas.TransactionCreate,
    db: Session = Depends(get_db),
    current: models.User = Depends(auth.get_current_user),
):
    try:
        txn = _persist_transaction(
            db,
            user_id=current.id,
            items=data.items,
            discount=data.discount,
            payment_type=data.payment_type,
            notes=data.notes,
            synced=True,
        )
        db.commit()
    except TransactionValidationError as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc

    db.refresh(txn)
    return txn


@app.get("/api/transactions", response_model=List[schemas.TransactionResponse], tags=["Transactions"])
def list_transactions(
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    skip: int = 0,       # ✅ ADD THIS
    limit: int = 100,    # ✅ ADD THIS
    db: Session = Depends(get_db),
    _: models.User = Depends(auth.get_current_user),
):
    """Fulfills Research Objective: Date-filtered transaction logs for audit."""
    query = db.query(models.Transaction).options(
        joinedload(models.Transaction.items).joinedload(models.TransactionItem.product)
    )

    # Apply Date Filtering if dates are provided
    if start_date and end_date:
        try:
            start, end = build_ph_date_range_bounds(start_date, end_date)
            query = query.filter(models.Transaction.created_at.between(start, end))
        except ValueError:
            pass # Ignore invalid date formats

    return (
        query.order_by(models.Transaction.created_at.desc())
        .offset(skip).limit(limit).all()
    )


@app.post("/api/transactions/sync", tags=["Transactions"])
def sync_offline(
    payload: schemas.OfflineSyncRequest,
    db: Session = Depends(get_db),
    current: models.User = Depends(auth.get_current_user),
):
    """Accept a batch of offline-captured transactions and persist them."""
    synced, synced_local_ids, errors = 0, [], []

    for t_data in payload.transactions:
        local_id = t_data.get("local_id")
        try:
            with db.begin_nested():
                _persist_transaction(
                    db,
                    user_id=current.id,
                    items=t_data.get("items", []),
                    discount=t_data.get("discount", 0),
                    payment_type=t_data.get("payment_type", "cash"),
                    notes=t_data.get("notes"),
                    created_at=normalize_client_timestamp(t_data.get("created_at")),
                    synced=True,
                )
            synced += 1
            synced_local_ids.append(local_id)
        except TransactionValidationError as exc:
            errors.append({"local_id": local_id, "message": str(exc)})
        except Exception as exc:
            errors.append({"local_id": local_id, "message": f"Unexpected sync failure: {exc}"})

    db.commit()
    return {
        "synced": synced,
        "synced_local_ids": synced_local_ids,
        "failed_transactions": errors,
        "message": f"Synced {synced} offline transaction(s)",
    }


# ═══════════════════════════════════════════════════════════════════════════════
# ANALYTICS
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/api/analytics/summary", tags=["Analytics"])
def summary(
    db: Session = Depends(get_db),
    _: models.User = Depends(auth.get_current_user),
):
    today_start, today_end = get_ph_day_bounds_utc_naive(get_ph_today())

    today_txns   = db.query(models.Transaction).filter(
        models.Transaction.created_at.between(today_start, today_end)).all()
    all_txns     = db.query(models.Transaction).all()
    low_stock_ct = db.query(models.Product).filter(
        models.Product.is_active == True,
        models.Product.stock <= models.Product.min_stock,
    ).count()

    return {
        "today_revenue":      round(sum(t.total for t in today_txns), 2),
        "today_transactions": len(today_txns),
        "total_products":     db.query(models.Product).filter(
                                  models.Product.is_active == True).count(),
        "low_stock_count":    low_stock_ct,
        "total_revenue":      round(sum(t.total for t in all_txns), 2),
    }


@app.get("/api/analytics/daily-sales", tags=["Analytics"])
def daily_sales(
    days: int = 7,
    db: Session = Depends(get_db),
    _: models.User = Depends(auth.get_current_user),
):
    cutoff = get_ph_recent_cutoff_utc_naive(days)
    txns   = db.query(models.Transaction).filter(
        models.Transaction.created_at >= cutoff).all()

    bucket: dict = {}
    for t in txns:
        k = to_ph_time(t.created_at).date().isoformat()
        bucket.setdefault(k, {"date": k, "revenue": 0.0, "transactions": 0})
        bucket[k]["revenue"]      += t.total
        bucket[k]["transactions"] += 1

    result = []
    for d in build_recent_ph_day_keys(days):
        entry = bucket.get(d, {"date": d, "revenue": 0.0, "transactions": 0})
        entry["revenue"] = round(entry["revenue"], 2)
        result.append(entry)
    return result


@app.get("/api/analytics/top-products", tags=["Analytics"])
def top_products(
    days: int = 7,
    db: Session = Depends(get_db),
    _: models.User = Depends(auth.get_current_user),
):
    return analytics_helpers.get_top_products(db, days)


@app.get("/api/analytics/hourly-heatmap", tags=["Analytics"])
def hourly_heatmap(
    db: Session = Depends(get_db),
    _: models.User = Depends(auth.get_current_user),
):
    return analytics_helpers.get_hourly_heatmap(db)


# ═══════════════════════════════════════════════════════════════════════════════
# ML PREDICTIONS
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/api/predictions/tomorrow", tags=["Predictions"])
def predict_tomorrow(
    algorithm: str = "XGBoost",
    weather: str = "clear",
    event: str = "none",
    db: Session = Depends(get_db),
    _: models.User = Depends(auth.get_current_user), 
):
    """Fulfills Research Objective (d): Predict demand to reduce food waste."""
    try:
        result = ml_predictor.predict_tomorrow_sales(db, algorithm, weather, event)

        return {
            "metrics": result.get("metrics", {}),
            "feature_summary": result.get("feature_summary", {}),
            "predictions": result.get("predictions", []),  # ✅ safe
            "weekly_sales_trend": result.get("weekly_sales_trend", []),
            "summary": result.get("summary", {}),
            "insights": result.get("insights", []),
            "data_source": result.get("data_source", "heuristic"),
            "generated_at": datetime.utcnow().isoformat()
        }

    except Exception as e:
        return {
            "metrics": {},
            "feature_summary": {},
            "predictions": [],
            "weekly_sales_trend": [],
            "summary": {
                "total_products": 0,
                "restock_count": 0,
                "waste_risk_count": 0,
                "expected_revenue": 0.0,
                "expected_units": 0,
                "model_backed_predictions": 0,
                "heuristic_predictions": 0,
            },
            "insights": [],
            "data_source": "error",
            "error": str(e),
            "generated_at": datetime.utcnow().isoformat()
        }


@app.get("/api/predictions/restock-alerts", tags=["Predictions"])
def restock_alerts(
    db: Session = Depends(get_db),
    _: models.User = Depends(auth.get_current_user),
):
    predictions_data = ml_predictor.predict_tomorrow_sales(db)
    preds = predictions_data.get("predictions", [])
    alerts = [p for p in preds if p.get("recommendation_type") == "restock"]
    return {
        "alerts": alerts,
        "count": len(alerts),
        "generated_at": datetime.utcnow().isoformat(),
    }


# ═══════════════════════════════════════════════════════════════════════════════
# AUDIT LOGS  (admin only)
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/api/audit-logs", tags=["Admin"])
def audit_logs(
    skip: int = 0, limit: int = 100,
    db: Session = Depends(get_db),
    _: models.User = Depends(auth.require_admin),
):
    return (
        db.query(models.AuditLog)
        .order_by(models.AuditLog.timestamp.desc())
        .offset(skip).limit(limit).all()
    )


# ═══════════════════════════════════════════════════════════════════════════════
# HEALTH + SEED
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/api/health", tags=["System"])
def health():
    return {"status": "online", "timestamp": datetime.utcnow().isoformat(), "version": "1.0.0"}


@app.post("/api/seed", tags=["System"])
def seed(db: Session = Depends(get_db)):
    """One-time demo data seeder. Idempotent."""
    if db.query(models.User).count() > 0:
        return {"message": "Already seeded — nothing changed."}

    # Users
    db.add_all([
        models.User(username="admin",   full_name="Admin User",
                    password_hash=auth.get_password_hash("admin123"),   role="admin"),
        models.User(username="cashier", full_name="Main Cashier",
                    password_hash=auth.get_password_hash("cashier123"), role="cashier"),
        models.User(username="staff",   full_name="Kitchen Staff",
                    password_hash=auth.get_password_hash("staff123"),   role="staff"),
    ])

    # Products (typical Filipino school canteen)
    db.add_all([
        models.Product(name="Rice (per order)",      category="Staple",   price=15.0,  stock=200, min_stock=30),
        models.Product(name="Pork Adobo",            category="Viand",    price=45.0,  stock=50,  min_stock=10),
        models.Product(name="Chicken Tinola",        category="Soup",     price=50.0,  stock=40,  min_stock=10),
        models.Product(name="Sinigang na Baboy",     category="Soup",     price=55.0,  stock=35,  min_stock=8),
        models.Product(name="Ginisang Ampalaya",     category="Viand",    price=35.0,  stock=30,  min_stock=8),
        models.Product(name="Lumpia (2 pcs)",        category="Snacks",   price=20.0,  stock=80,  min_stock=20),
        models.Product(name="Pandesal",              category="Bread",    price=5.0,   stock=100, min_stock=25),
        models.Product(name="Banana Cue",            category="Snacks",   price=15.0,  stock=60,  min_stock=15),
        models.Product(name="Soft Drinks (small)",   category="Drinks",   price=20.0,  stock=120, min_stock=20),
        models.Product(name="Water (500ml)",         category="Drinks",   price=15.0,  stock=150, min_stock=30),
        models.Product(name="Mango Float (slice)",   category="Dessert",  price=30.0,  stock=20,  min_stock=5),
        models.Product(name="Biko (per slice)",      category="Dessert",  price=25.0,  stock=15,  min_stock=4),
    ])
    db.commit()

    return {
        "message": "✅ Seed complete!",
        "credentials": {
            "admin":   "admin / admin123",
            "cashier": "cashier / cashier123",
            "staff":   "staff / staff123",
        },
    }


@app.get("/{full_path:path}", include_in_schema=False)
def frontend_catch_all(full_path: str):
    if not FRONTEND_DIR:
        raise HTTPException(status_code=404, detail="Not found")

    top_level = full_path.split("/", 1)[0]
    if top_level in RESERVED_FRONTEND_PREFIXES:
        raise HTTPException(status_code=404, detail="Not found")

    requested_file = _resolve_frontend_file(full_path)
    if requested_file:
        return FileResponse(requested_file)

    if "." in os.path.basename(full_path):
        raise HTTPException(status_code=404, detail="File not found")

    return _frontend_index_response()
