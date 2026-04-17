"""
main.py  –  SmartCanteen AI  |  FastAPI Backend
─────────────────────────────────────────────────
Run:  uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
─────────────────────────────────────────────────
"""

from fastapi import BackgroundTasks, FastAPI, Depends, HTTPException, Request, Query, Response, WebSocket, WebSocketDisconnect
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


def _get_client_ip(request: Optional[Request] = None):
    if not request:
        return None

    def clean_ip(value):
        candidate = str(value or "").strip().strip('"')
        if not candidate or candidate.lower() in {"unknown", "none", "null"}:
            return None

        if candidate.startswith("[") and "]" in candidate:
            return candidate[1:candidate.index("]")]

        if candidate.count(":") == 1 and "." in candidate:
            candidate = candidate.split(":", 1)[0]

        return candidate or None

    for header_name in (
        "cf-connecting-ip",
        "true-client-ip",
        "x-client-ip",
        "x-forwarded-for",
        "x-real-ip",
    ):
        header_value = request.headers.get(header_name)
        if not header_value:
            continue

        for candidate in str(header_value).split(","):
            ip_address = clean_ip(candidate)
            if ip_address:
                return ip_address

    forwarded = request.headers.get("forwarded")
    if forwarded:
        for forwarded_entry in forwarded.split(","):
            for part in forwarded_entry.split(";"):
                key, _, value = part.strip().partition("=")
                if key.lower() == "for":
                    ip_address = clean_ip(value)
                    if ip_address:
                        return ip_address

    return clean_ip(request.client.host if request.client else None)


def _add_audit_log(
    db: Session,
    *,
    action: str,
    details: Optional[str] = None,
    user_id: Optional[int] = None,
    request: Optional[Request] = None,
):
    db.add(models.AuditLog(
        user_id=user_id,
        action=action,
        details=details,
        ip_address=_get_client_ip(request),
    ))


class RealtimeConnectionManager:
    def __init__(self):
        self._connections = set()

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self._connections.add(websocket)

    def disconnect(self, websocket: WebSocket):
        self._connections.discard(websocket)

    async def broadcast(self, message: dict):
        for websocket in list(self._connections):
            try:
                await websocket.send_json(message)
            except Exception:
                self.disconnect(websocket)


realtime_connections = RealtimeConnectionManager()


async def _broadcast_realtime_event(event_type: str, payload: Optional[dict] = None):
    await realtime_connections.broadcast({
        "type": event_type,
        "payload": payload or {},
        "created_at": datetime.utcnow().isoformat() + "Z",
    })


def _queue_stock_alert_refresh(background_tasks: BackgroundTasks, reason: str, **_payload):
    details = {"reason": reason}
    background_tasks.add_task(_broadcast_realtime_event, "alerts.changed", details)


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
        if product.stock <= 0:
            product.stock = 0
            product.is_active = False
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

cors_options = {
    "allow_origins": [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
        "http://13.55.37.38",
        "https://13.55.37.38",
        "http://smartcanteen.ct.ws",
        "https://smartcanteen.ct.ws",
        "https://smartcanteen.duckdns.org",
    ],
    "allow_origin_regex": (
        r"^https?://("
        r"localhost|"
        r"127\.0\.0\.1|"
        r"13\.55\.37\.38"
        r")(:\d+)?$"
    ),
    "allow_credentials": True,
    "allow_methods": ["*"],
    "allow_headers": ["*"],
}

app.add_middleware(
    CORSMiddleware,
    **cors_options,
)

# Serve the PWA frontend
BACKEND_DIR = os.path.abspath(os.path.dirname(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(BACKEND_DIR, ".."))


def _find_frontend_dir():
    configured_dir = os.environ.get("SMARTCANTEEN_FRONTEND_DIR")
    candidates = [
        configured_dir,
        os.path.join(PROJECT_ROOT, "smartcanteen", "dist"),
        os.path.join(PROJECT_ROOT, "dist"),
        os.path.join(BACKEND_DIR, "smartcanteen", "dist"),
        os.path.join(BACKEND_DIR, "dist"),
        os.path.join(os.getcwd(), "smartcanteen", "dist"),
        os.path.join(os.getcwd(), "dist"),
    ]

    for candidate in candidates:
        if not candidate:
            continue

        frontend_dir = os.path.abspath(candidate)
        if os.path.isfile(os.path.join(frontend_dir, "index.html")):
            return frontend_dir

    return None


FRONTEND_DIR = _find_frontend_dir()
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


@app.websocket("/api/realtime/alerts")
async def realtime_alerts(websocket: WebSocket):
    await realtime_connections.connect(websocket)
    try:
        await websocket.send_json({
            "type": "connected",
            "created_at": datetime.utcnow().isoformat() + "Z",
        })
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        realtime_connections.disconnect(websocket)
    except Exception:
        realtime_connections.disconnect(websocket)


# ═══════════════════════════════════════════════════════════════════════════════
# AUTH
# ═══════════════════════════════════════════════════════════════════════════════

@app.post("/auth/login", include_in_schema=False)
@app.post("/api/auth/login", tags=["Auth"])
def login(payload: schemas.LoginRequest, req: Request, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.username == payload.username).first()

    if not user or not auth.verify_password(payload.password, user.password_hash):
        _add_audit_log(
            db,
            action="LOGIN_FAILED",
            details=f"Username: {payload.username}",
            request=req,
        )
        db.commit()
        raise HTTPException(status_code=401, detail="Invalid username or password")

    token = auth.create_access_token({"sub": user.username})

    _add_audit_log(
        db,
        user_id=user.id,
        action="LOGIN",
        details="Successful login",
        request=req,
    )
    db.commit()

    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": user.id, "username": user.username,
            "full_name": user.full_name, "role": user.role,
        },
    }


@app.post("/auth/register", include_in_schema=False)
@app.post("/api/auth/register", tags=["Auth"])
def register(
    data: schemas.UserCreate,
    req: Request,
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

    _add_audit_log(
        db,
        user_id=current.id, action="USER_CREATED",
        details=f"Created user: {data.username} (role={data.role})",
        request=req,
    )
    db.commit()
    return {"message": "User created", "id": user.id}


@app.get("/auth/me", include_in_schema=False)
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
    req: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current: models.User = Depends(auth.require_admin),
):
    product = models.Product(**data.model_dump())
    product.is_active = product.stock > 0
    db.add(product)
    db.commit()
    db.refresh(product)
    _add_audit_log(
        db,
        user_id=current.id,
        action="PRODUCT_CREATED",
        details=f"Product: {data.name}",
        request=req,
    )
    db.commit()
    _queue_stock_alert_refresh(
        background_tasks,
        "product-created",
        product_id=product.id,
        stock=product.stock,
        is_active=product.is_active,
    )
    return product


@app.put("/api/products/{pid}", response_model=schemas.ProductResponse, tags=["Products"])
def update_product(
    pid: int,
    data: schemas.ProductUpdate,
    req: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current: models.User = Depends(auth.require_admin),
):
    product = db.query(models.Product).filter(models.Product.id == pid).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(product, field, value)
    product.is_active = product.stock > 0
    product.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(product)

    _add_audit_log(
        db,
        user_id=current.id,
        action="PRODUCT_UPDATED",
        details=f"Product ID: {pid}",
        request=req,
    )
    db.commit()
    _queue_stock_alert_refresh(
        background_tasks,
        "product-updated",
        product_id=product.id,
        stock=product.stock,
        is_active=product.is_active,
    )
    return product


@app.delete("/api/products/{pid}", tags=["Products"])
def delete_product(
    pid: int,
    req: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current: models.User = Depends(auth.require_admin),
):
    product = db.query(models.Product).filter(models.Product.id == pid).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    product.is_active = False
    db.commit()
    _add_audit_log(
        db,
        user_id=current.id,
        action="PRODUCT_DELETED",
        details=f"Deactivated product ID: {pid}",
        request=req,
    )
    db.commit()
    _queue_stock_alert_refresh(
        background_tasks,
        "product-deleted",
        product_id=pid,
        is_active=False,
    )
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
    req: Request,
    background_tasks: BackgroundTasks,
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
        _add_audit_log(
            db,
            user_id=current.id,
            action="TRANSACTION_CREATED",
            details=(
                f"Transaction ID: {txn.id}; "
                f"{len(data.items)} item(s); "
                f"Total: PHP {txn.total:.2f}; "
                f"Payment: {txn.payment_type}"
            ),
            request=req,
        )
        db.commit()
        _queue_stock_alert_refresh(
            background_tasks,
            "transaction-created",
            transaction_id=txn.id,
        )
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
    req: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current: models.User = Depends(auth.get_current_user),
):
    """Accept a batch of offline-captured transactions and persist them."""
    synced, synced_local_ids, errors = 0, [], []

    for t_data in payload.transactions:
        local_id = t_data.get("local_id")
        try:
            with db.begin_nested():
                txn = _persist_transaction(
                    db,
                    user_id=current.id,
                    items=t_data.get("items", []),
                    discount=t_data.get("discount", 0),
                    payment_type=t_data.get("payment_type", "cash"),
                    notes=t_data.get("notes"),
                    created_at=normalize_client_timestamp(t_data.get("created_at")),
                    synced=True,
                )
                _add_audit_log(
                    db,
                    user_id=current.id,
                    action="OFFLINE_TRANSACTION_SYNCED",
                    details=(
                        f"Transaction ID: {txn.id}; "
                        f"Local ID: {local_id or 'N/A'}; "
                        f"{len(t_data.get('items', []))} item(s); "
                        f"Total: PHP {txn.total:.2f}"
                    ),
                    request=req,
                )
            synced += 1
            synced_local_ids.append(local_id)
        except TransactionValidationError as exc:
            errors.append({"local_id": local_id, "message": str(exc)})
        except Exception as exc:
            errors.append({"local_id": local_id, "message": f"Unexpected sync failure: {exc}"})

    db.commit()
    if synced > 0:
        _queue_stock_alert_refresh(
            background_tasks,
            "offline-transactions-synced",
            synced=synced,
        )
    return {
        "synced": synced,
        "synced_local_ids": synced_local_ids,
        "failed_transactions": errors,
        "message": f"Synced {synced} offline transaction(s)",
    }


# ═══════════════════════════════════════════════════════════════════════════════
# ANALYTICS
# ═══════════════════════════════════════════════════════════════════════════════

def _resolve_analytics_date_range(
    days: int = 7,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
):
    if bool(start_date) != bool(end_date):
        raise HTTPException(
            status_code=400,
            detail="Provide both start_date and end_date for analytics filters.",
        )

    if start_date and end_date:
        try:
            start_day = datetime.strptime(start_date, "%Y-%m-%d").date()
            end_day = datetime.strptime(end_date, "%Y-%m-%d").date()
            start, end = build_ph_date_range_bounds(start_date, end_date)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Invalid analytics date filter.") from exc

        if end_day < start_day:
            raise HTTPException(status_code=400, detail="end_date must be on or after start_date.")

        day_count = (end_day - start_day).days + 1
        return {
            "days": day_count,
            "start": start,
            "end": end,
            "day_keys": [
                (start_day + timedelta(days=offset)).isoformat()
                for offset in range(day_count)
            ],
        }

    safe_days = max(1, min(int(days or 7), 3660))
    return {
        "days": safe_days,
        "start": get_ph_recent_cutoff_utc_naive(safe_days),
        "end": None,
        "day_keys": build_recent_ph_day_keys(safe_days),
    }


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
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _: models.User = Depends(auth.get_current_user),
):
    date_range = _resolve_analytics_date_range(days, start_date, end_date)
    query = db.query(models.Transaction).filter(
        models.Transaction.created_at >= date_range["start"]
    )

    if date_range["end"] is not None:
        query = query.filter(models.Transaction.created_at <= date_range["end"])

    txns = query.all()

    bucket: dict = {}
    for t in txns:
        k = to_ph_time(t.created_at).date().isoformat()
        bucket.setdefault(k, {"date": k, "revenue": 0.0, "transactions": 0})
        bucket[k]["revenue"]      += t.total
        bucket[k]["transactions"] += 1

    result = []
    for d in date_range["day_keys"]:
        entry = bucket.get(d, {"date": d, "revenue": 0.0, "transactions": 0})
        entry["revenue"] = round(entry["revenue"], 2)
        result.append(entry)
    return result


@app.get("/api/analytics/top-products", tags=["Analytics"])
def top_products(
    days: int = 7,
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _: models.User = Depends(auth.get_current_user),
):
    date_range = _resolve_analytics_date_range(days, start_date, end_date)
    return analytics_helpers.get_top_products(
        db,
        date_range["days"],
        start_date=start_date,
        end_date=end_date,
    )


@app.get("/api/analytics/hourly-heatmap", tags=["Analytics"])
def hourly_heatmap(
    days: int = 30,
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _: models.User = Depends(auth.get_current_user),
):
    date_range = _resolve_analytics_date_range(days, start_date, end_date)
    return analytics_helpers.get_hourly_heatmap(
        db,
        date_range["days"],
        start_date=start_date,
        end_date=end_date,
    )


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
