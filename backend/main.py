"""
main.py  –  SmartCanteen  |  FastAPI Backend
─────────────────────────────────────────────────
Run:  uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
─────────────────────────────────────────────────
"""

from fastapi import BackgroundTasks, FastAPI, Depends, Header, HTTPException, Request, Query, Response, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlalchemy import and_, func, or_, text
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
from typing import List, Optional
import base64
import binascii
import hashlib
import hmac
import ipaddress
import logging
import math
import os
import re
import secrets
import struct
import subprocess
import time
from urllib.parse import quote

import backend.models as models
import backend.schemas as schemas
import backend.auth as auth
import backend.analytics_helpers as analytics_helpers
import backend.financial_reports as financial_reports
import backend.ml_predictor as ml_predictor
from backend.demo_data import seed_demo_canteen_database
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


PRODUCT_NAME_CHARS_RE = re.compile(r"[^a-z0-9]+")
auth_logger = logging.getLogger("smartcanteen.auth")


class TransactionValidationError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.status_code = status_code


CASH_PAYMENT_TYPE = "cash"
PCS_UNIT_TYPE = "pcs"
BULK_UNIT_TYPE = "bulk"
PCS_BASE_UNIT = "pcs"
BULK_BASE_UNITS = {"kg", "g", "l", "ml"}


def _normalize_transaction_payment_type(payment_type: Optional[str]) -> str:
    normalized = str(payment_type or CASH_PAYMENT_TYPE).strip().lower()
    if normalized != CASH_PAYMENT_TYPE:
        raise TransactionValidationError(
            "Only cash payment is allowed for canteen transactions"
        )

    return CASH_PAYMENT_TYPE


def _normalize_product_name_for_match(name: str) -> str:
    normalized = PRODUCT_NAME_CHARS_RE.sub("", str(name or "").strip().lower())
    if len(normalized) > 3 and normalized.endswith("s") and not normalized.endswith("ss"):
        normalized = normalized[:-1]
    return normalized


def _find_duplicate_product_name(
    db: Session,
    name: str,
    exclude_product_id: Optional[int] = None,
):
    normalized_name = _normalize_product_name_for_match(name)
    if not normalized_name:
        raise HTTPException(status_code=400, detail="Product name is required")

    query = db.query(models.Product)
    if exclude_product_id is not None:
        query = query.filter(models.Product.id != exclude_product_id)

    for product in query.all():
        if _normalize_product_name_for_match(product.name) == normalized_name:
            return product

    return None


def _raise_duplicate_product_name(product: models.Product):
    status = "inactive" if product.is_active is False else "active"
    raise HTTPException(
        status_code=409,
        detail=(
            f"Product already exists: {product.name} ({status}). "
            "Update or restore that product instead of adding a duplicate."
        ),
    )


def _normalize_unit_type(value: Optional[str]) -> str:
    unit_type = str(value or PCS_UNIT_TYPE).strip().lower()
    if unit_type not in {PCS_UNIT_TYPE, BULK_UNIT_TYPE}:
        raise HTTPException(status_code=400, detail="Unit type must be PCS or Bulk")
    return unit_type


def _normalize_base_unit(value: Optional[str], unit_type: str) -> str:
    if unit_type == PCS_UNIT_TYPE:
        return PCS_BASE_UNIT

    base_unit = str(value or "kg").strip().lower()
    if base_unit not in BULK_BASE_UNITS:
        raise HTTPException(status_code=400, detail="Bulk products must use kg, g, L, or mL as the base unit")
    return base_unit


def _normalize_inventory_amount(value, *, field_name: str, require_whole: bool) -> float:
    try:
        amount = float(value)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=f"{field_name} must be a valid number") from exc

    if not math.isfinite(amount) or amount < 0:
        raise HTTPException(status_code=400, detail=f"{field_name} must be a non-negative number")
    if require_whole and not amount.is_integer():
        raise HTTPException(status_code=400, detail=f"{field_name} must be a whole number for PCS products")
    return float(round(amount, 6))


def _normalize_product_unit_fields(data: dict, product: Optional[models.Product] = None) -> None:
    unit_type = _normalize_unit_type(data.get("unit_type", getattr(product, "unit_type", PCS_UNIT_TYPE)))
    base_unit = _normalize_base_unit(data.get("base_unit", getattr(product, "base_unit", PCS_BASE_UNIT)), unit_type)
    data["unit_type"] = unit_type
    data["base_unit"] = base_unit

    for field_name in ("stock", "min_stock"):
        if field_name in data:
            data[field_name] = _normalize_inventory_amount(
                data[field_name],
                field_name=field_name.replace("_", " ").capitalize(),
                require_whole=unit_type == PCS_UNIT_TYPE,
            )
        elif product is not None:
            _normalize_inventory_amount(
                getattr(product, field_name),
                field_name=field_name.replace("_", " ").capitalize(),
                require_whole=unit_type == PCS_UNIT_TYPE,
            )


def _get_sale_unit_multiplier(product: models.Product, sale_unit: Optional[str]) -> tuple[str, float]:
    unit_type = _normalize_unit_type(getattr(product, "unit_type", PCS_UNIT_TYPE))
    base_unit = _normalize_base_unit(getattr(product, "base_unit", PCS_BASE_UNIT), unit_type)
    normalized_sale_unit = str(sale_unit or base_unit).strip().lower()

    if unit_type == PCS_UNIT_TYPE:
        if normalized_sale_unit != PCS_BASE_UNIT:
            raise TransactionValidationError("PCS products can only be sold in PCS")
        return PCS_BASE_UNIT, 1.0

    compatible_units = {
        "kg": {"kg": 1.0, "g": 0.001},
        "g": {"g": 1.0, "kg": 1000.0},
        "l": {"l": 1.0, "ml": 0.001},
        "ml": {"ml": 1.0, "l": 1000.0},
    }
    multiplier = compatible_units.get(base_unit, {}).get(normalized_sale_unit)
    if multiplier is None:
        raise TransactionValidationError(
            f"{product.name} must be sold in a unit compatible with {base_unit}"
        )
    return normalized_sale_unit, multiplier


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

        try:
            parsed_ip = ipaddress.ip_address(candidate)
        except ValueError:
            return None

        if getattr(parsed_ip, "ipv4_mapped", None):
            parsed_ip = parsed_ip.ipv4_mapped

        return str(parsed_ip)

    def is_device_network_ip(value):
        try:
            parsed_ip = ipaddress.ip_address(value)
        except ValueError:
            return False

        return (
            (parsed_ip.is_private or parsed_ip.is_link_local)
            and not parsed_ip.is_loopback
            and not parsed_ip.is_unspecified
        )

    def is_visible_client_ip(value):
        try:
            parsed_ip = ipaddress.ip_address(value)
        except ValueError:
            return False

        return not parsed_ip.is_loopback and not parsed_ip.is_unspecified

    direct_ip = clean_ip(request.client.host if request.client else None)
    if direct_ip and is_device_network_ip(direct_ip):
        return direct_ip

    forwarded_ips = []

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
                forwarded_ips.append(ip_address)

    forwarded = request.headers.get("forwarded")
    if forwarded:
        for forwarded_entry in forwarded.split(","):
            for part in forwarded_entry.split(";"):
                key, _, value = part.strip().partition("=")
                if key.lower() == "for":
                    ip_address = clean_ip(value)
                    if ip_address:
                        forwarded_ips.append(ip_address)

    for ip_address in forwarded_ips:
        if is_device_network_ip(ip_address):
            return ip_address

    for ip_address in forwarded_ips:
        if is_visible_client_ip(ip_address):
            return ip_address

    if direct_ip and is_visible_client_ip(direct_ip):
        return direct_ip

    return forwarded_ips[0] if forwarded_ips else direct_ip


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


SYSTEM_MODULE_DEFAULTS = [
    ("dashboard", True),
    ("financialReports", True),
    ("dailySales", True),
    ("expenseManagement", True),
    ("schoolYearManagement", True),
    ("reports", True),
    ("userManagement", True),
    ("auditLogs", True),
    ("settings", True),
    ("pos", False),
    ("transactions", False),
    ("inventory", False),
    ("demandForecast", False),
    ("analytics", False),
    ("notifications", False),
]
SYSTEM_MODULE_KEYS = {module_key for module_key, _enabled in SYSTEM_MODULE_DEFAULTS}
LOCKED_ENABLED_MODULE_KEYS = {"settings"}


def _ensure_system_module_settings(db: Session) -> dict:
    existing_settings = {
        setting.module_key: setting
        for setting in db.query(models.SystemModuleSetting).all()
    }
    created_defaults = False

    for module_key, enabled in SYSTEM_MODULE_DEFAULTS:
        if module_key not in existing_settings:
            setting = models.SystemModuleSetting(
                module_key=module_key,
                enabled=enabled,
            )
            db.add(setting)
            existing_settings[module_key] = setting
            created_defaults = True

    if created_defaults:
        db.commit()

    return existing_settings


def _serialize_module_settings(db: Session) -> dict:
    settings = _ensure_system_module_settings(db)
    return {
        "modules": [
            {
                "module_key": module_key,
                "enabled": bool(settings[module_key].enabled),
            }
            for module_key, _enabled in SYSTEM_MODULE_DEFAULTS
        ]
    }


def _normalize_transaction_items(items) -> List[dict]:
    normalized_items = []

    for item in items:
        try:
            if isinstance(item, dict):
                normalized_items.append({
                    "product_id": int(item["product_id"]),
                    "quantity": float(item["quantity"]),
                    "unit_price": float(item["unit_price"]),
                    "sale_unit": item.get("sale_unit"),
                })
            else:
                normalized_items.append({
                    "product_id": int(item.product_id),
                    "quantity": float(item.quantity),
                    "unit_price": float(item.unit_price),
                    "sale_unit": getattr(item, "sale_unit", None),
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
    normalized_payment_type = _normalize_transaction_payment_type(payment_type)
    discount_value = float(discount or 0)
    resolved_items = []
    for item in normalized_items:
        sale_quantity = float(item["quantity"])
        if not math.isfinite(sale_quantity) or sale_quantity <= 0:
            raise TransactionValidationError("Transaction item quantity must be greater than zero")

        product = db.query(models.Product).filter(models.Product.id == item["product_id"]).first()
        if not product or not product.is_active:
            raise TransactionValidationError(
                f"Product {item['product_id']} not found",
                status_code=404,
            )
        sale_unit, unit_multiplier = _get_sale_unit_multiplier(product, item["sale_unit"])
        if _normalize_unit_type(product.unit_type) == PCS_UNIT_TYPE and not sale_quantity.is_integer():
            raise TransactionValidationError("PCS products must be sold in whole numbers")

        inventory_quantity = round(sale_quantity * unit_multiplier, 6)
        if inventory_quantity <= 0:
            raise TransactionValidationError("Transaction item quantity must be greater than zero")
        if float(product.stock or 0) + 0.000001 < inventory_quantity:
            raise TransactionValidationError(
                f"Insufficient stock for '{product.name}' "
                f"(available: {product.stock}, requested: {inventory_quantity})",
            )

        unit_price = round(float(product.price or 0) * unit_multiplier, 2)
        resolved_items.append(
            {
                "product": product,
                "sale_quantity": sale_quantity,
                "sale_unit": sale_unit,
                "inventory_quantity": inventory_quantity,
                "unit_price": unit_price,
            }
        )

    subtotal = sum(item["sale_quantity"] * item["unit_price"] for item in resolved_items)
    total = max(0.0, subtotal - discount_value)
    txn_kwargs = {
        "user_id": user_id,
        "total": total,
        "discount": discount_value,
        "payment_type": normalized_payment_type,
        "notes": notes,
        "synced": synced,
    }
    if created_at is not None:
        txn_kwargs["created_at"] = created_at

    txn = models.Transaction(**txn_kwargs)
    db.add(txn)
    db.flush()

    for item in resolved_items:
        product = item["product"]
        product.stock = round(float(product.stock or 0) - item["inventory_quantity"], 6)
        if product.stock <= 0:
            product.stock = 0.0

        db.add(models.TransactionItem(
            transaction_id=txn.id,
            product_id=product.id,
            quantity=item["inventory_quantity"],
            sale_quantity=item["sale_quantity"],
            sale_unit=item["sale_unit"],
            unit_price=item["unit_price"],
        ))

    db.flush()
    return txn

# ── Bootstrap ─────────────────────────────────────────────────────────────────
Base.metadata.create_all(bind=engine)


def _ensure_user_authenticator_columns():
    column_statements = [
        ("authenticator_secret", "ALTER TABLE users ADD COLUMN authenticator_secret VARCHAR"),
        (
            "authenticator_enabled",
            "ALTER TABLE users ADD COLUMN authenticator_enabled BOOLEAN DEFAULT FALSE",
        ),
        (
            "authenticator_last_counter",
            "ALTER TABLE users ADD COLUMN authenticator_last_counter INTEGER",
        ),
        (
            "authenticator_failed_attempts",
            "ALTER TABLE users ADD COLUMN authenticator_failed_attempts INTEGER DEFAULT 0",
        ),
        (
            "authenticator_locked_until",
            "ALTER TABLE users ADD COLUMN authenticator_locked_until DATETIME",
        ),
    ]

    try:
        with engine.begin() as connection:
            existing_columns = {
                row["name"]
                for row in connection.execute(text("PRAGMA table_info(users)")).mappings()
            }
            for column_name, statement in column_statements:
                if column_name not in existing_columns:
                    connection.execute(text(statement))
    except Exception:
        try:
            with engine.begin() as connection:
                for column_name, statement in column_statements:
                    try:
                        connection.execute(text(statement))
                    except Exception:
                        pass
        except Exception as exc:
            print(f"Authenticator column setup skipped: {exc}")


def _ensure_analytics_indexes():
    index_statements = [
        "CREATE INDEX IF NOT EXISTS ix_transactions_created_at ON transactions(created_at)",
        "CREATE INDEX IF NOT EXISTS ix_transaction_items_transaction_id ON transaction_items(transaction_id)",
        "CREATE INDEX IF NOT EXISTS ix_transaction_items_product_id ON transaction_items(product_id)",
    ]

    try:
        with engine.begin() as connection:
            for statement in index_statements:
                connection.execute(text(statement))
    except Exception as exc:
        print(f"Analytics index setup skipped: {exc}")


def _ensure_product_quick_sale_columns():
    column_statements = [
        ("is_favorite", "ALTER TABLE products ADD COLUMN is_favorite BOOLEAN DEFAULT FALSE"),
    ]

    try:
        with engine.begin() as connection:
            existing_columns = {
                row["name"]
                for row in connection.execute(text("PRAGMA table_info(products)")).mappings()
            }
            for column_name, statement in column_statements:
                if column_name not in existing_columns:
                    connection.execute(text(statement))
    except Exception:
        try:
            with engine.begin() as connection:
                for _column_name, statement in column_statements:
                    try:
                        connection.execute(text(statement))
                    except Exception:
                        pass
        except Exception as exc:
            print(f"Product quick-sale column setup skipped: {exc}")


def _ensure_inventory_unit_columns():
    column_statements = [
        ("products", "unit_type", "ALTER TABLE products ADD COLUMN unit_type VARCHAR DEFAULT 'pcs'"),
        ("products", "base_unit", "ALTER TABLE products ADD COLUMN base_unit VARCHAR DEFAULT 'pcs'"),
        ("transaction_items", "sale_quantity", "ALTER TABLE transaction_items ADD COLUMN sale_quantity FLOAT"),
        ("transaction_items", "sale_unit", "ALTER TABLE transaction_items ADD COLUMN sale_unit VARCHAR"),
    ]

    try:
        with engine.begin() as connection:
            if engine.dialect.name == "postgresql":
                for table_name, column_name, _statement in column_statements:
                    connection.execute(
                        text(f"ALTER TABLE {table_name} ADD COLUMN IF NOT EXISTS {column_name} " + (
                            "VARCHAR DEFAULT 'pcs'" if column_name in {"unit_type", "base_unit"} else "FLOAT"
                        ))
                    )
                connection.execute(text("ALTER TABLE products ALTER COLUMN stock TYPE DOUBLE PRECISION USING stock::double precision"))
                connection.execute(text("ALTER TABLE products ALTER COLUMN min_stock TYPE DOUBLE PRECISION USING min_stock::double precision"))
                connection.execute(text("ALTER TABLE transaction_items ALTER COLUMN quantity TYPE DOUBLE PRECISION USING quantity::double precision"))
                return

            existing_columns_by_table = {}
            for table_name, _column_name, _statement in column_statements:
                if table_name not in existing_columns_by_table:
                    existing_columns_by_table[table_name] = {
                        row["name"]
                        for row in connection.execute(text(f"PRAGMA table_info({table_name})")).mappings()
                    }
            for table_name, column_name, statement in column_statements:
                if column_name not in existing_columns_by_table.get(table_name, set()):
                    connection.execute(text(statement))
    except Exception as exc:
        print(f"Inventory unit column setup skipped: {exc}")


def _ensure_financial_reporting_columns():
    column_statements = [
        ("allocations", "opening_balance", "ALTER TABLE allocations ADD COLUMN opening_balance FLOAT DEFAULT 0.0"),
        (
            "fund_monitoring_entries",
            "interest",
            "ALTER TABLE fund_monitoring_entries ADD COLUMN interest FLOAT DEFAULT 0.0",
        ),
        (
            "fund_monitoring_entries",
            "cash_on_bank",
            "ALTER TABLE fund_monitoring_entries ADD COLUMN cash_on_bank FLOAT DEFAULT 0.0",
        ),
        (
            "monthly_reports",
            "beginning_cash_manual_override",
            "ALTER TABLE monthly_reports ADD COLUMN beginning_cash_manual_override BOOLEAN NOT NULL DEFAULT FALSE",
        ),
        (
            "monthly_reports",
            "current_sales_manual_override",
            "ALTER TABLE monthly_reports ADD COLUMN current_sales_manual_override BOOLEAN NOT NULL DEFAULT FALSE",
        ),
    ]

    try:
        with engine.begin() as connection:
            existing_columns_by_table = {}
            for table_name, _column_name, _statement in column_statements:
                if table_name not in existing_columns_by_table:
                    existing_columns_by_table[table_name] = {
                        row["name"]
                        for row in connection.execute(text(f"PRAGMA table_info({table_name})")).mappings()
                    }

            for table_name, column_name, statement in column_statements:
                existing_columns = existing_columns_by_table.get(table_name, set())
                if column_name not in existing_columns:
                    connection.execute(text(statement))
                    if table_name == "monthly_reports" and column_name.endswith("_manual_override"):
                        # Existing reports predate automatic values, so preserve their saved totals.
                        connection.execute(text(f"UPDATE {table_name} SET {column_name} = TRUE"))
    except Exception:
        try:
            with engine.begin() as connection:
                for _table_name, _column_name, statement in column_statements:
                    try:
                        connection.execute(text(statement))
                        if _table_name == "monthly_reports" and _column_name.endswith("_manual_override"):
                            connection.execute(text(f"UPDATE {_table_name} SET {_column_name} = TRUE"))
                    except Exception:
                        pass
        except Exception as exc:
            print(f"Financial reporting column setup skipped: {exc}")


def _ensure_password_reset_request_columns():
    column_statements = [
        (
            "review_note",
            "ALTER TABLE password_reset_requests ADD COLUMN review_note TEXT",
        ),
        (
            "appeal_reason",
            "ALTER TABLE password_reset_requests ADD COLUMN appeal_reason TEXT",
        ),
        (
            "appealed_at",
            "ALTER TABLE password_reset_requests ADD COLUMN appealed_at DATETIME",
        ),
        (
            "appeal_review_note",
            "ALTER TABLE password_reset_requests ADD COLUMN appeal_review_note TEXT",
        ),
        (
            "appeal_reviewed_at",
            "ALTER TABLE password_reset_requests ADD COLUMN appeal_reviewed_at DATETIME",
        ),
    ]

    try:
        with engine.begin() as connection:
            existing_columns = {
                row["name"]
                for row in connection.execute(text("PRAGMA table_info(password_reset_requests)")).mappings()
            }
            for column_name, statement in column_statements:
                if column_name not in existing_columns:
                    connection.execute(text(statement))
            connection.execute(text(
                "UPDATE password_reset_requests SET status = 'declined' WHERE status = 'denied'"
            ))
            connection.execute(text(
                "UPDATE password_reset_requests SET status = 'used' WHERE status = 'completed'"
            ))
    except Exception:
        try:
            with engine.begin() as connection:
                for _column_name, statement in column_statements:
                    try:
                        connection.execute(text(statement))
                    except Exception:
                        pass
                try:
                    connection.execute(text(
                        "UPDATE password_reset_requests SET status = 'declined' WHERE status = 'denied'"
                    ))
                except Exception:
                    pass
                try:
                    connection.execute(text(
                        "UPDATE password_reset_requests SET status = 'used' WHERE status = 'completed'"
                    ))
                except Exception:
                    pass
        except Exception as exc:
            print(f"Password reset request column setup skipped: {exc}")


def _ensure_authenticator_recovery_request_columns():
    column_statements = [
        (
            "reason",
            "ALTER TABLE authenticator_recovery_requests ADD COLUMN reason TEXT DEFAULT '' NOT NULL",
        ),
        (
            "review_note",
            "ALTER TABLE authenticator_recovery_requests ADD COLUMN review_note TEXT",
        ),
        (
            "appeal_reason",
            "ALTER TABLE authenticator_recovery_requests ADD COLUMN appeal_reason TEXT",
        ),
        (
            "appealed_at",
            "ALTER TABLE authenticator_recovery_requests ADD COLUMN appealed_at DATETIME",
        ),
        (
            "appeal_review_note",
            "ALTER TABLE authenticator_recovery_requests ADD COLUMN appeal_review_note TEXT",
        ),
        (
            "appeal_reviewed_at",
            "ALTER TABLE authenticator_recovery_requests ADD COLUMN appeal_reviewed_at DATETIME",
        ),
    ]

    try:
        with engine.begin() as connection:
            existing_columns = {
                row["name"]
                for row in connection.execute(text("PRAGMA table_info(authenticator_recovery_requests)")).mappings()
            }
            if not existing_columns:
                return
            for column_name, statement in column_statements:
                if column_name not in existing_columns:
                    connection.execute(text(statement))
            connection.execute(text(
                "UPDATE authenticator_recovery_requests SET status = 'declined' WHERE status = 'denied'"
            ))
            connection.execute(text(
                "UPDATE authenticator_recovery_requests SET status = 'used' WHERE status = 'completed'"
            ))
    except Exception:
        try:
            with engine.begin() as connection:
                for _column_name, statement in column_statements:
                    try:
                        connection.execute(text(statement))
                    except Exception:
                        pass
                try:
                    connection.execute(text(
                        "UPDATE authenticator_recovery_requests SET status = 'declined' WHERE status = 'denied'"
                    ))
                except Exception:
                    pass
                try:
                    connection.execute(text(
                        "UPDATE authenticator_recovery_requests SET status = 'used' WHERE status = 'completed'"
                    ))
                except Exception:
                    pass
        except Exception as exc:
            print(f"Authenticator recovery request column setup skipped: {exc}")


_ensure_user_authenticator_columns()
_ensure_analytics_indexes()
_ensure_product_quick_sale_columns()
_ensure_inventory_unit_columns()
_ensure_financial_reporting_columns()
_ensure_password_reset_request_columns()
_ensure_authenticator_recovery_request_columns()

app = FastAPI(
    title="SmartCanteen",
    description="Predictive Inventory & Sales System",
    version="1.0.0",
)

cors_options = {
    "allow_origins": [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
        "capacitor://localhost",
        "ionic://localhost",
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

app.include_router(financial_reports.router)

# Serve the PWA frontend
BACKEND_DIR = os.path.abspath(os.path.dirname(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(BACKEND_DIR, ".."))
FRONTEND_BUILD_ATTEMPTED = False
FRONTEND_BUILD_ERROR = None


def _find_frontend_dir():
    configured_dir = os.environ.get("SMARTCANTEEN_FRONTEND_DIR")
    candidates = [
        configured_dir,
        "/var/www/smartcanteen/dist",
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


def _find_frontend_source_dir():
    configured_dir = os.environ.get("SMARTCANTEEN_FRONTEND_SOURCE_DIR")
    candidates = [
        configured_dir,
        os.path.join(PROJECT_ROOT, "smartcanteen"),
        os.path.join(os.getcwd(), "smartcanteen"),
    ]

    for candidate in candidates:
        if not candidate:
            continue

        frontend_source_dir = os.path.abspath(candidate)
        if os.path.isfile(os.path.join(frontend_source_dir, "package.json")):
            return frontend_source_dir

    return None


def _frontend_auto_build_enabled():
    value = os.environ.get("SMARTCANTEEN_AUTO_BUILD_FRONTEND", "1").strip().lower()
    return value not in {"0", "false", "no", "off"}


def _build_frontend_dist_once():
    global FRONTEND_BUILD_ATTEMPTED, FRONTEND_BUILD_ERROR

    if FRONTEND_BUILD_ATTEMPTED or not _frontend_auto_build_enabled():
        return

    frontend_source_dir = _find_frontend_source_dir()
    if not frontend_source_dir:
        FRONTEND_BUILD_ERROR = "Frontend source directory not found."
        return

    npm_command = "npm.cmd" if os.name == "nt" else "npm"
    try:
        subprocess.run(
            [npm_command, "run", "build"],
            cwd=frontend_source_dir,
            check=True,
            text=True,
        )
        FRONTEND_BUILD_ERROR = None
        FRONTEND_BUILD_ATTEMPTED = True
    except (OSError, subprocess.CalledProcessError) as exc:
        FRONTEND_BUILD_ERROR = str(exc)
        FRONTEND_BUILD_ATTEMPTED = False


FRONTEND_DIR = _find_frontend_dir()
RESERVED_FRONTEND_PREFIXES = {"api", "docs", "redoc", "openapi.json"}
FRONTEND_SOURCE_EXCLUDED_DIRS = {
    ".git",
    ".vite",
    "android",
    "dist",
    "node_modules",
}
FRONTEND_SOURCE_EXTENSIONS = {
    ".css",
    ".html",
    ".js",
    ".jsx",
    ".json",
    ".mjs",
    ".png",
    ".svg",
    ".ts",
    ".tsx",
}


def _frontend_rebuild_stale_enabled():
    value = os.environ.get("SMARTCANTEEN_REBUILD_STALE_FRONTEND", "1").strip().lower()
    return value not in {"0", "false", "no", "off"}


def _newest_mtime_in_dir(root_dir: str, *, include_extensions: Optional[set[str]] = None) -> float:
    newest_mtime = 0.0
    if not root_dir or not os.path.isdir(root_dir):
        return newest_mtime

    for current_root, dirnames, filenames in os.walk(root_dir):
        dirnames[:] = [
            dirname
            for dirname in dirnames
            if dirname not in FRONTEND_SOURCE_EXCLUDED_DIRS
        ]

        for filename in filenames:
            extension = os.path.splitext(filename)[1].lower()
            if include_extensions and extension not in include_extensions:
                continue

            try:
                newest_mtime = max(newest_mtime, os.path.getmtime(os.path.join(current_root, filename)))
            except OSError:
                continue

    return newest_mtime


def _frontend_dist_is_stale(frontend_dir: Optional[str] = None) -> bool:
    if not _frontend_rebuild_stale_enabled():
        return False

    frontend_source_dir = _find_frontend_source_dir()
    if not frontend_source_dir:
        return False

    frontend_dir = frontend_dir or _find_frontend_dir()
    index_file = os.path.join(frontend_dir, "index.html") if frontend_dir else ""
    if not frontend_dir or not os.path.isfile(index_file):
        return True

    source_mtime = _newest_mtime_in_dir(
        frontend_source_dir,
        include_extensions=FRONTEND_SOURCE_EXTENSIONS,
    )
    dist_mtime = _newest_mtime_in_dir(frontend_dir)
    return source_mtime > dist_mtime


def _ensure_frontend_dist_current():
    global FRONTEND_BUILD_ATTEMPTED, FRONTEND_DIR

    if not _frontend_dist_is_stale(FRONTEND_DIR):
        return

    FRONTEND_BUILD_ATTEMPTED = False
    _build_frontend_dist_once()
    FRONTEND_DIR = _find_frontend_dir()


def _set_frontend_cache_headers(response: Response, file_path: str):
    filename = os.path.basename(file_path).lower()
    if filename in {"index.html", "sw.js", "manifest.json"}:
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0, s-maxage=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    else:
        response.headers["Cache-Control"] = "no-cache, must-revalidate, max-age=0"
    return response


def _frontend_file_response(file_path: str):
    return _set_frontend_cache_headers(FileResponse(file_path), file_path)


class FrontendStaticFiles(StaticFiles):
    def file_response(self, *args, **kwargs):
        response = super().file_response(*args, **kwargs)
        file_path = args[0] if args else ""
        return _set_frontend_cache_headers(response, str(file_path))


def _get_frontend_dir():
    global FRONTEND_DIR

    _ensure_frontend_dist_current()

    if FRONTEND_DIR and os.path.isfile(os.path.join(FRONTEND_DIR, "index.html")):
        return FRONTEND_DIR

    FRONTEND_DIR = _find_frontend_dir()
    if FRONTEND_DIR:
        return FRONTEND_DIR

    _build_frontend_dist_once()
    FRONTEND_DIR = _find_frontend_dir()
    return FRONTEND_DIR


def _resolve_frontend_file(path: str):
    frontend_dir = _get_frontend_dir()
    if not frontend_dir:
        return None

    relative_path = os.path.normpath(path).lstrip("\\/")
    absolute_root = os.path.abspath(frontend_dir)
    absolute_path = os.path.abspath(os.path.join(absolute_root, relative_path))

    if os.path.commonpath([absolute_root, absolute_path]) != absolute_root:
        return None

    return absolute_path if os.path.isfile(absolute_path) else None


def _frontend_index_response():
    index_file = _resolve_frontend_file("index.html")
    if index_file:
        return _frontend_file_response(index_file)
    message = "SmartCanteen API is running. Frontend build not found."
    if FRONTEND_BUILD_ERROR:
        message = f"{message} Auto-build failed: {FRONTEND_BUILD_ERROR}"
    return {"message": message, "docs": "/docs"}


FRONTEND_DIR = _get_frontend_dir()

if FRONTEND_DIR:
    app.mount("/app", FrontendStaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")

@app.get("/", include_in_schema=False)
def root():
    return _frontend_index_response()


@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    favicon_file = _resolve_frontend_file("favicon.ico") or _resolve_frontend_file("favicon.svg")
    if favicon_file:
        return _frontend_file_response(favicon_file)
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

AUTHENTICATOR_ISSUER = os.environ.get("SMARTCANTEEN_AUTHENTICATOR_ISSUER", "SmartCanteen")
AUTHENTICATOR_PERIOD_SECONDS = 30
AUTHENTICATOR_DIGITS = 6
AUTHENTICATOR_WINDOW_STEPS = 1
TRUSTED_DEVICE_DAYS = 30
AUTHENTICATOR_MAX_FAILED_ATTEMPTS = 3
AUTHENTICATOR_LOCKOUT_SECONDS = 60
RECOVERY_CODE_COUNT = 10
RECOVERY_CODE_GROUPS = 3
RECOVERY_CODE_GROUP_LENGTH = 4
RECOVERY_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def _generate_authenticator_secret() -> str:
    return base64.b32encode(os.urandom(20)).decode("ascii").rstrip("=")


def _format_authenticator_secret(secret: str) -> str:
    compact = "".join(str(secret or "").upper().split())
    return " ".join(compact[index:index + 4] for index in range(0, len(compact), 4))


def _normalize_authenticator_code(code: str) -> str:
    return "".join(character for character in str(code or "") if character.isdigit())


def _decode_authenticator_secret(secret: str) -> bytes:
    normalized = "".join(str(secret or "").upper().split())
    padding = "=" * ((8 - len(normalized) % 8) % 8)
    try:
        return base64.b32decode(f"{normalized}{padding}", casefold=True)
    except (binascii.Error, ValueError):
        raise HTTPException(status_code=400, detail="Authenticator setup is invalid. Sign in again.")


def _authenticator_code_for_counter(secret: str, counter: int) -> str:
    key = _decode_authenticator_secret(secret)
    digest = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    truncated = struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF
    code = truncated % (10 ** AUTHENTICATOR_DIGITS)
    return str(code).zfill(AUTHENTICATOR_DIGITS)


def _verify_authenticator_code(secret: str, code: str, last_counter: Optional[int] = None) -> int:
    normalized_code = _normalize_authenticator_code(code)
    if len(normalized_code) != AUTHENTICATOR_DIGITS:
        raise HTTPException(status_code=400, detail="Enter the 6-digit authenticator code")

    current_counter = int(time.time() // AUTHENTICATOR_PERIOD_SECONDS)
    for offset in range(-AUTHENTICATOR_WINDOW_STEPS, AUTHENTICATOR_WINDOW_STEPS + 1):
        counter = current_counter + offset
        if last_counter is not None and counter <= last_counter:
            continue
        expected = _authenticator_code_for_counter(secret, counter)
        if hmac.compare_digest(normalized_code, expected):
            return counter

    raise HTTPException(status_code=401, detail="Invalid authenticator code")


def _authenticator_retry_after_seconds(locked_until: datetime, now: Optional[datetime] = None) -> int:
    now = now or datetime.utcnow()
    return max(1, int((locked_until - now).total_seconds() + 0.999))


def _authenticator_locked_detail(locked_until: datetime) -> dict:
    retry_after_seconds = _authenticator_retry_after_seconds(locked_until)
    return {
        "code": "authenticator_verification_locked",
        "title": "Verification locked",
        "message": "Too many invalid verification attempts. Please try again after 1 minute.",
        "remaining_attempts": 0,
        "locked": True,
        "lock_seconds": AUTHENTICATOR_LOCKOUT_SECONDS,
        "retry_after_seconds": retry_after_seconds,
        "locked_until": locked_until.isoformat() + "Z",
    }


def _raise_authenticator_locked(locked_until: datetime):
    detail = _authenticator_locked_detail(locked_until)
    raise HTTPException(
        status_code=429,
        detail=detail,
        headers={"Retry-After": str(detail["retry_after_seconds"])},
    )


def _clear_authenticator_verification_attempts(user: models.User):
    user.authenticator_failed_attempts = 0
    user.authenticator_locked_until = None


def _enforce_authenticator_verification_not_locked(user: models.User):
    now = datetime.utcnow()
    locked_until = getattr(user, "authenticator_locked_until", None)
    if locked_until and locked_until > now:
        _raise_authenticator_locked(locked_until)

    if locked_until and locked_until <= now:
        _clear_authenticator_verification_attempts(user)


def _record_failed_authenticator_verification(
    db: Session,
    user: models.User,
    req: Optional[Request],
):
    now = datetime.utcnow()
    current_attempts = int(getattr(user, "authenticator_failed_attempts", 0) or 0)
    attempts = min(AUTHENTICATOR_MAX_FAILED_ATTEMPTS, current_attempts + 1)
    remaining_attempts = max(0, AUTHENTICATOR_MAX_FAILED_ATTEMPTS - attempts)
    user.authenticator_failed_attempts = attempts
    forwarded_proto = req.headers.get("x-forwarded-proto") if req else None
    auth_logger.warning(
        "MFA verify rejected: invalid verification code; user_id=%s remaining_attempts=%s cookie_present=%s forwarded_proto=%s",
        user.id,
        remaining_attempts,
        bool(req.cookies) if req else False,
        forwarded_proto,
    )

    if remaining_attempts <= 0:
        locked_until = now + timedelta(seconds=AUTHENTICATOR_LOCKOUT_SECONDS)
        user.authenticator_locked_until = locked_until
        _add_audit_log(
            db,
            user_id=user.id,
            action="LOGIN_AUTHENTICATOR_LOCKED",
            details="Too many invalid authenticator verification attempts",
            request=req,
        )
        db.commit()
        _raise_authenticator_locked(locked_until)

    user.authenticator_locked_until = None
    attempt_label = "attempt" if remaining_attempts == 1 else "attempts"
    _add_audit_log(
        db,
        user_id=user.id,
        action="LOGIN_AUTHENTICATOR_FAILED",
        details=f"Invalid authenticator verification attempt; {remaining_attempts} {attempt_label} remaining",
        request=req,
    )
    db.commit()
    raise HTTPException(
        status_code=401,
        detail={
            "code": "authenticator_verification_failed",
            "title": "Verification issue",
            "message": (
                f"Invalid verification code. {remaining_attempts} {attempt_label} "
                "remaining before a 1-minute lock."
            ),
            "remaining_attempts": remaining_attempts,
            "locked": False,
            "lock_seconds": AUTHENTICATOR_LOCKOUT_SECONDS,
        },
    )


def _authenticator_otpauth_url(user: models.User, secret: str) -> str:
    issuer = AUTHENTICATOR_ISSUER
    account = user.username
    label = f"{issuer}:{account}"
    return (
        f"otpauth://totp/{quote(label)}"
        f"?secret={quote(secret)}"
        f"&issuer={quote(issuer)}"
        f"&algorithm=SHA1"
        f"&digits={AUTHENTICATOR_DIGITS}"
        f"&period={AUTHENTICATOR_PERIOD_SECONDS}"
    )


def _trusted_device_token_hash(token: str) -> str:
    normalized = str(token or "").strip()
    if not normalized:
        return ""

    return hmac.new(
        auth.SECRET_KEY.encode("utf-8"),
        normalized.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def _get_valid_trusted_device(db: Session, user: models.User, token: Optional[str]):
    token_hash = _trusted_device_token_hash(token or "")
    if not token_hash:
        return None

    trusted_device = (
        db.query(models.UserTrustedDevice)
        .filter(
            models.UserTrustedDevice.user_id == user.id,
            models.UserTrustedDevice.token_hash == token_hash,
            models.UserTrustedDevice.revoked_at.is_(None),
            models.UserTrustedDevice.expires_at > datetime.utcnow(),
        )
        .first()
    )

    if trusted_device:
        trusted_device.last_used_at = datetime.utcnow()

    return trusted_device


def _create_trusted_device(db: Session, user: models.User):
    raw_token = secrets.token_urlsafe(32)
    expires_at = datetime.utcnow() + timedelta(days=TRUSTED_DEVICE_DAYS)
    trusted_device = models.UserTrustedDevice(
        user_id=user.id,
        token_hash=_trusted_device_token_hash(raw_token),
        label="Remembered device",
        expires_at=expires_at,
        last_used_at=datetime.utcnow(),
    )
    db.add(trusted_device)
    return raw_token, expires_at


def _attach_trusted_device_response(response: dict, token: str, expires_at: datetime) -> dict:
    response["remember_device_token"] = token
    response["remember_device_expires_at"] = expires_at.isoformat() + "Z"
    response["remember_device_days"] = TRUSTED_DEVICE_DAYS
    return response


def _normalize_recovery_code(code: str) -> str:
    return "".join(
        character
        for character in str(code or "").upper()
        if character.isalnum()
    )


def _recovery_code_hash(code: str) -> str:
    normalized = _normalize_recovery_code(code)
    if not normalized:
        return ""

    return hmac.new(
        auth.SECRET_KEY.encode("utf-8"),
        f"recovery-code:{normalized}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def _format_recovery_code(raw_code: str) -> str:
    normalized = _normalize_recovery_code(raw_code)
    return "-".join(
        normalized[index:index + RECOVERY_CODE_GROUP_LENGTH]
        for index in range(0, len(normalized), RECOVERY_CODE_GROUP_LENGTH)
    )


def _generate_recovery_code() -> str:
    character_count = RECOVERY_CODE_GROUPS * RECOVERY_CODE_GROUP_LENGTH
    raw_code = "".join(secrets.choice(RECOVERY_CODE_ALPHABET) for _ in range(character_count))
    return _format_recovery_code(raw_code)


def _replace_user_recovery_codes(db: Session, user: models.User) -> list[str]:
    db.query(models.UserRecoveryCode).filter(
        models.UserRecoveryCode.user_id == user.id
    ).delete(synchronize_session=False)

    codes: list[str] = []
    code_hashes: set[str] = set()
    while len(codes) < RECOVERY_CODE_COUNT:
        code = _generate_recovery_code()
        code_hash = _recovery_code_hash(code)
        if not code_hash or code_hash in code_hashes:
            continue

        code_hashes.add(code_hash)
        codes.append(code)
        db.add(models.UserRecoveryCode(
            user_id=user.id,
            code_hash=code_hash,
        ))

    return codes


def _count_recovery_codes(db: Session, user: models.User) -> int:
    return (
        db.query(models.UserRecoveryCode)
        .filter(
            models.UserRecoveryCode.user_id == user.id,
            models.UserRecoveryCode.used_at.is_(None),
        )
        .count()
    )


def _count_active_trusted_devices(db: Session, user: models.User) -> int:
    return (
        db.query(models.UserTrustedDevice)
        .filter(
            models.UserTrustedDevice.user_id == user.id,
            models.UserTrustedDevice.revoked_at.is_(None),
            models.UserTrustedDevice.expires_at > datetime.utcnow(),
        )
        .count()
    )


def _verify_recovery_code(db: Session, user: models.User, code: str) -> bool:
    code_hash = _recovery_code_hash(code)
    if not code_hash:
        return False

    recovery_code = (
        db.query(models.UserRecoveryCode)
        .filter(
            models.UserRecoveryCode.user_id == user.id,
            models.UserRecoveryCode.code_hash == code_hash,
            models.UserRecoveryCode.used_at.is_(None),
        )
        .first()
    )

    if not recovery_code:
        return False

    recovery_code.used_at = datetime.utcnow()
    return True


def _reset_user_authenticator(db: Session, user: models.User, *, revoke_remembered_devices: bool = True):
    user.authenticator_secret = None
    user.authenticator_enabled = False
    user.authenticator_last_counter = None
    _clear_authenticator_verification_attempts(user)

    db.query(models.UserRecoveryCode).filter(
        models.UserRecoveryCode.user_id == user.id
    ).delete(synchronize_session=False)

    if revoke_remembered_devices:
        now = datetime.utcnow()
        db.query(models.UserTrustedDevice).filter(
            models.UserTrustedDevice.user_id == user.id,
            models.UserTrustedDevice.revoked_at.is_(None),
        ).update(
            {models.UserTrustedDevice.revoked_at: now},
            synchronize_session=False,
        )


def _user_payload(db: Session, user: models.User) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "full_name": user.full_name,
        "role": user.role,
        "authenticator_mfa_enabled": bool(getattr(user, "authenticator_enabled", False)),
        "recovery_codes_remaining": _count_recovery_codes(db, user),
        "remembered_devices_active": _count_active_trusted_devices(db, user),
    }


def _build_login_success(db: Session, user: models.User):
    token = auth.create_access_token({"sub": user.username})
    return {
        "access_token": token,
        "background_alert_token": auth.create_background_alert_token(user.username),
        "background_alert_expires_in_days": auth.BACKGROUND_ALERT_EXPIRE_DAYS,
        "token_type": "bearer",
        "user": _user_payload(db, user),
    }


def _build_authenticator_user_hint(user: models.User, enabled: bool) -> dict:
    return {
        "username": user.username,
        "full_name": user.full_name,
        "authenticator_mfa_enabled": enabled,
    }


USER_ROLES = {"admin", "staff", "cashier"}
PASSWORD_RESET_APPROVAL_EXPIRE_MINUTES = 60
PASSWORD_RESET_REQUEST_SENT_MESSAGE = "Your password reset request has been sent. Please wait for admin approval."
PASSWORD_RESET_DECLINED_MESSAGE = "Your password reset request was declined. You may submit an appeal if you believe this was a mistake."
PASSWORD_RESET_APPEAL_SENT_MESSAGE = "Your appeal has been submitted. Please wait for admin review."
PASSWORD_RESET_STATUS_MESSAGES = {
    "pending": "Your password reset request is still pending. Please wait for admin approval.",
    "approved": "Your password reset request has been approved. You may now change your password.",
    "declined": PASSWORD_RESET_DECLINED_MESSAGE,
    "appealed": PASSWORD_RESET_APPEAL_SENT_MESSAGE,
    "appeal_approved": "Your password reset appeal has been approved. You may now change your password.",
    "appeal_declined": "Your appeal was declined. Please contact the admin for assistance.",
    "expired": "Your password reset approval has expired. Please send a new request.",
    "used": "This password reset request has already been used. Please send a new request if you need another password change.",
    "none": "No password reset request was found for this account.",
}
PASSWORD_RESET_APPROVED_STATUSES = {"approved", "appeal_approved"}
PASSWORD_RESET_OPEN_STATUSES = {"pending", "approved", "appealed", "appeal_approved", "expired"}
AUTHENTICATOR_RECOVERY_APPROVAL_EXPIRE_MINUTES = 60
AUTHENTICATOR_RECOVERY_REQUEST_SENT_MESSAGE = "Your authenticator recovery request has been sent. Please wait for admin approval."
AUTHENTICATOR_RECOVERY_DECLINED_MESSAGE = "Your authenticator recovery request was declined. You may submit an appeal if you believe this was a mistake."
AUTHENTICATOR_RECOVERY_APPEAL_SENT_MESSAGE = "Your appeal has been submitted. Please wait for admin review."
AUTHENTICATOR_RECOVERY_STATUS_MESSAGES = {
    "pending": "Your authenticator recovery request is still pending. Please wait for admin approval.",
    "approved": "Your authenticator recovery request has been approved. You may now set up a new authenticator.",
    "declined": AUTHENTICATOR_RECOVERY_DECLINED_MESSAGE,
    "appealed": AUTHENTICATOR_RECOVERY_APPEAL_SENT_MESSAGE,
    "appeal_approved": "Your authenticator recovery request has been approved. You may now set up a new authenticator.",
    "appeal_declined": "Your appeal was declined. Please contact the admin for assistance.",
    "expired": "Your authenticator recovery approval has expired. Please send a new request.",
    "used": "This authenticator recovery request has already been used. Please send a new request if you need another recovery.",
    "none": "No authenticator recovery request was found for this account.",
}
AUTHENTICATOR_RECOVERY_APPROVED_STATUSES = {"approved", "appeal_approved"}
AUTHENTICATOR_RECOVERY_OPEN_STATUSES = {"pending", "approved", "appealed", "appeal_approved", "expired"}


def _normalize_username(value: str) -> str:
    username = str(value or "").strip()
    if not username:
        raise HTTPException(status_code=400, detail="Username is required")
    if len(username) > 64:
        raise HTTPException(status_code=400, detail="Username must be 64 characters or fewer")
    if not re.match(r"^[A-Za-z0-9._-]+$", username):
        raise HTTPException(
            status_code=400,
            detail="Username can only contain letters, numbers, dots, underscores, and hyphens",
        )
    return username


def _normalize_full_name(value: Optional[str]) -> Optional[str]:
    full_name = str(value or "").strip()
    return full_name or None


def _validate_user_role(role: str) -> str:
    normalized_role = str(role or "").strip().lower()
    if normalized_role not in USER_ROLES:
        raise HTTPException(status_code=400, detail="Role must be admin, staff, or cashier")
    return normalized_role


def _validate_user_password(password: str) -> str:
    raw_password = str(password or "")
    if len(raw_password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    return raw_password


def _find_user_by_username(db: Session, username: str, exclude_user_id: Optional[int] = None):
    query = db.query(models.User).filter(func.lower(models.User.username) == username.lower())
    if exclude_user_id is not None:
        query = query.filter(models.User.id != exclude_user_id)
    return query.first()


def _normalize_password_reset_identifier(value: str) -> str:
    identifier = str(value or "").strip()
    if not identifier:
        raise HTTPException(status_code=400, detail="Username or email is required")
    if len(identifier) > 128:
        raise HTTPException(status_code=400, detail="Username or email must be 128 characters or fewer")
    return identifier


def _password_reset_identifier_from_payload(data) -> str:
    return _normalize_password_reset_identifier(
        getattr(data, "identifier", None) or getattr(data, "usernameOrEmail", None)
    )


def _find_user_by_reset_identifier(db: Session, identifier: str):
    normalized_identifier = _normalize_password_reset_identifier(identifier).lower()
    return (
        db.query(models.User)
        .filter(func.lower(models.User.username) == normalized_identifier)
        .first()
    )


def _normalize_password_reset_status(status: str) -> str:
    normalized_status = str(status or "pending").strip().lower().replace("-", "_").replace(" ", "_")
    if normalized_status == "denied":
        return "declined"
    if normalized_status == "completed":
        return "used"
    if normalized_status in {"appealapproved", "appeal_approved"}:
        return "appeal_approved"
    if normalized_status in {"appealdeclined", "appeal_declined", "appealdenied", "appeal_denied"}:
        return "appeal_declined"
    return normalized_status


def _normalize_password_reset_note(value: Optional[str]) -> Optional[str]:
    note = str(value or "").strip()
    if len(note) > 500:
        raise HTTPException(status_code=400, detail="Admin note must be 500 characters or fewer")
    return note or None


def _password_reset_appeal_reason_from_payload(data) -> str:
    reason = str(
        getattr(data, "appeal_reason", None)
        or getattr(data, "reason", None)
        or ""
    ).strip()
    if not reason:
        raise HTTPException(status_code=400, detail="Appeal reason is required")
    if len(reason) > 1000:
        raise HTTPException(status_code=400, detail="Appeal reason must be 1000 characters or fewer")
    return reason


def _expire_password_reset_request_if_needed(
    reset_request: models.PasswordResetRequest,
    now: Optional[datetime] = None,
) -> bool:
    current_status = _normalize_password_reset_status(reset_request.status)
    if current_status != reset_request.status:
        reset_request.status = current_status

    now = now or datetime.utcnow()
    if (
        _normalize_password_reset_status(reset_request.status) in PASSWORD_RESET_APPROVED_STATUSES
        and reset_request.expires_at is not None
        and reset_request.expires_at <= now
    ):
        reset_request.status = "expired"
        return True

    return False


def _active_admin_count(db: Session, exclude_user_id: Optional[int] = None) -> int:
    query = db.query(models.User).filter(
        models.User.role == "admin",
        models.User.is_active == True,
    )
    if exclude_user_id is not None:
        query = query.filter(models.User.id != exclude_user_id)
    return query.count()


def _ensure_admin_can_be_changed(
    db: Session,
    user: models.User,
    *,
    next_role: Optional[str] = None,
    next_is_active: Optional[bool] = None,
):
    role_after_update = next_role if next_role is not None else user.role
    active_after_update = user.is_active if next_is_active is None else bool(next_is_active)
    removes_active_admin = user.role == "admin" and user.is_active and (
        role_after_update != "admin" or not active_after_update
    )

    if removes_active_admin and _active_admin_count(db, exclude_user_id=user.id) == 0:
        raise HTTPException(status_code=400, detail="At least one active admin account is required")


def _serialize_admin_user(db: Session, user: models.User) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "full_name": user.full_name,
        "role": user.role,
        "is_active": user.is_active,
        "authenticator_mfa_enabled": bool(user.authenticator_enabled and user.authenticator_secret),
        "recovery_codes_remaining": _count_recovery_codes(db, user),
        "remembered_devices_active": _count_active_trusted_devices(db, user),
        "created_at": user.created_at,
    }


def _effective_password_reset_status(reset_request: models.PasswordResetRequest) -> str:
    _expire_password_reset_request_if_needed(reset_request)
    return _normalize_password_reset_status(reset_request.status)


def _serialize_password_reset_request(
    db: Session,
    reset_request: models.PasswordResetRequest,
) -> dict:
    user = None
    reviewer = None
    if reset_request.user_id:
        user = db.query(models.User).filter(models.User.id == reset_request.user_id).first()
    if reset_request.reviewer_id:
        reviewer = db.query(models.User).filter(models.User.id == reset_request.reviewer_id).first()

    return {
        "id": reset_request.id,
        "identifier": reset_request.identifier,
        "username": user.username if user else None,
        "full_name": user.full_name if user else None,
        "role": user.role if user else None,
        "is_active": user.is_active if user else None,
        "status": _effective_password_reset_status(reset_request),
        "requested_at": reset_request.requested_at,
        "reviewed_at": reset_request.reviewed_at,
        "completed_at": reset_request.completed_at,
        "expires_at": reset_request.expires_at,
        "reviewer_username": reviewer.username if reviewer else None,
        "review_note": reset_request.review_note,
        "appeal_reason": reset_request.appeal_reason,
        "appealed_at": reset_request.appealed_at,
        "appeal_review_note": reset_request.appeal_review_note,
        "appeal_reviewed_at": reset_request.appeal_reviewed_at,
    }


def _serialize_password_reset_status(reset_request: Optional[models.PasswordResetRequest]) -> dict:
    if not reset_request:
        return {
            "status": "none",
            "message": PASSWORD_RESET_STATUS_MESSAGES["none"],
            "can_change_password": False,
            "requested_at": None,
            "reviewed_at": None,
            "completed_at": None,
            "expires_at": None,
            "review_note": None,
            "appeal_reason": None,
            "appealed_at": None,
            "appeal_review_note": None,
            "appeal_reviewed_at": None,
        }

    status = _effective_password_reset_status(reset_request)
    return {
        "status": status,
        "message": PASSWORD_RESET_STATUS_MESSAGES.get(status, PASSWORD_RESET_STATUS_MESSAGES["none"]),
        "can_change_password": status in PASSWORD_RESET_APPROVED_STATUSES,
        "requested_at": reset_request.requested_at,
        "reviewed_at": reset_request.reviewed_at,
        "completed_at": reset_request.completed_at,
        "expires_at": reset_request.expires_at,
        "review_note": reset_request.review_note,
        "appeal_reason": reset_request.appeal_reason,
        "appealed_at": reset_request.appealed_at,
        "appeal_review_note": reset_request.appeal_review_note,
        "appeal_reviewed_at": reset_request.appeal_reviewed_at,
    }


def _serialize_password_reset_account_notice(reset_request: models.PasswordResetRequest) -> dict:
    status = _effective_password_reset_status(reset_request)
    notice_time = (
        reset_request.appeal_reviewed_at
        or reset_request.appealed_at
        or reset_request.reviewed_at
        or reset_request.completed_at
        or reset_request.requested_at
    )
    return {
        "id": f"password-reset-{reset_request.id}-{status}",
        "type": "password_reset",
        "title": "Password reset request",
        "status": status,
        "message": PASSWORD_RESET_STATUS_MESSAGES.get(status, PASSWORD_RESET_STATUS_MESSAGES["none"]),
        "can_change_password": status in PASSWORD_RESET_APPROVED_STATUSES,
        "requested_at": reset_request.requested_at,
        "reviewed_at": reset_request.reviewed_at,
        "completed_at": reset_request.completed_at,
        "expires_at": reset_request.expires_at,
        "created_at": notice_time,
        "review_note": reset_request.review_note,
        "appeal_reason": reset_request.appeal_reason,
        "appealed_at": reset_request.appealed_at,
        "appeal_review_note": reset_request.appeal_review_note,
        "appeal_reviewed_at": reset_request.appeal_reviewed_at,
    }


def _get_latest_password_reset_request_for_identifier(db: Session, identifier: str):
    normalized_identifier = _normalize_password_reset_identifier(identifier).lower()
    user = _find_user_by_reset_identifier(db, identifier)
    query = db.query(models.PasswordResetRequest)
    if user:
        query = query.filter(models.PasswordResetRequest.user_id == user.id)
    else:
        query = query.filter(models.PasswordResetRequest.normalized_identifier == normalized_identifier)

    return (
        query
        .order_by(models.PasswordResetRequest.requested_at.desc())
        .first()
    )


def _get_password_reset_request_or_404(db: Session, request_id: int):
    reset_request = (
        db.query(models.PasswordResetRequest)
        .filter(models.PasswordResetRequest.id == request_id)
        .first()
    )
    if not reset_request:
        raise HTTPException(status_code=404, detail="Password reset request not found")
    return reset_request


def _authenticator_recovery_identifier_from_payload(data) -> str:
    return _normalize_password_reset_identifier(
        getattr(data, "identifier", None) or getattr(data, "usernameOrEmail", None)
    )


def _find_user_by_authenticator_recovery_identifier(db: Session, identifier: str):
    normalized_identifier = _normalize_password_reset_identifier(identifier).lower()
    return (
        db.query(models.User)
        .filter(func.lower(models.User.username) == normalized_identifier)
        .first()
    )


def _normalize_authenticator_recovery_status(status: str) -> str:
    return _normalize_password_reset_status(status)


def _normalize_authenticator_recovery_note(value: Optional[str]) -> Optional[str]:
    return _normalize_password_reset_note(value)


def _authenticator_recovery_reason_from_payload(data) -> str:
    reason = str(getattr(data, "reason", None) or "").strip()
    if not reason:
        raise HTTPException(status_code=400, detail="Recovery reason is required")
    if len(reason) > 1000:
        raise HTTPException(status_code=400, detail="Recovery reason must be 1000 characters or fewer")
    return reason


def _authenticator_recovery_appeal_reason_from_payload(data) -> str:
    reason = str(
        getattr(data, "appeal_reason", None)
        or getattr(data, "reason", None)
        or ""
    ).strip()
    if not reason:
        raise HTTPException(status_code=400, detail="Appeal reason is required")
    if len(reason) > 1000:
        raise HTTPException(status_code=400, detail="Appeal reason must be 1000 characters or fewer")
    return reason


def _expire_authenticator_recovery_request_if_needed(
    recovery_request: models.AuthenticatorRecoveryRequest,
    now: Optional[datetime] = None,
) -> bool:
    current_status = _normalize_authenticator_recovery_status(recovery_request.status)
    if current_status != recovery_request.status:
        recovery_request.status = current_status

    now = now or datetime.utcnow()
    if (
        _normalize_authenticator_recovery_status(recovery_request.status)
        in AUTHENTICATOR_RECOVERY_APPROVED_STATUSES
        and recovery_request.expires_at is not None
        and recovery_request.expires_at <= now
    ):
        recovery_request.status = "expired"
        return True

    return False


def _effective_authenticator_recovery_status(
    recovery_request: models.AuthenticatorRecoveryRequest,
) -> str:
    _expire_authenticator_recovery_request_if_needed(recovery_request)
    return _normalize_authenticator_recovery_status(recovery_request.status)


def _serialize_authenticator_recovery_status(
    recovery_request: Optional[models.AuthenticatorRecoveryRequest],
) -> dict:
    if not recovery_request:
        return {
            "status": "none",
            "message": AUTHENTICATOR_RECOVERY_STATUS_MESSAGES["none"],
            "can_recover_authenticator": False,
            "reason": None,
            "requested_at": None,
            "reviewed_at": None,
            "completed_at": None,
            "expires_at": None,
            "review_note": None,
            "appeal_reason": None,
            "appealed_at": None,
            "appeal_review_note": None,
            "appeal_reviewed_at": None,
        }

    status = _effective_authenticator_recovery_status(recovery_request)
    return {
        "status": status,
        "message": AUTHENTICATOR_RECOVERY_STATUS_MESSAGES.get(
            status,
            AUTHENTICATOR_RECOVERY_STATUS_MESSAGES["none"],
        ),
        "can_recover_authenticator": status in AUTHENTICATOR_RECOVERY_APPROVED_STATUSES,
        "reason": recovery_request.reason,
        "requested_at": recovery_request.requested_at,
        "reviewed_at": recovery_request.reviewed_at,
        "completed_at": recovery_request.completed_at,
        "expires_at": recovery_request.expires_at,
        "review_note": recovery_request.review_note,
        "appeal_reason": recovery_request.appeal_reason,
        "appealed_at": recovery_request.appealed_at,
        "appeal_review_note": recovery_request.appeal_review_note,
        "appeal_reviewed_at": recovery_request.appeal_reviewed_at,
    }


def _serialize_authenticator_recovery_account_notice(
    recovery_request: models.AuthenticatorRecoveryRequest,
) -> dict:
    status = _effective_authenticator_recovery_status(recovery_request)
    notice_time = (
        recovery_request.appeal_reviewed_at
        or recovery_request.appealed_at
        or recovery_request.reviewed_at
        or recovery_request.completed_at
        or recovery_request.requested_at
    )
    return {
        "id": f"authenticator-recovery-{recovery_request.id}-{status}",
        "type": "authenticator_recovery",
        "title": "Authenticator recovery request",
        "status": status,
        "message": AUTHENTICATOR_RECOVERY_STATUS_MESSAGES.get(
            status,
            AUTHENTICATOR_RECOVERY_STATUS_MESSAGES["none"],
        ),
        "can_recover_authenticator": status in AUTHENTICATOR_RECOVERY_APPROVED_STATUSES,
        "reason": recovery_request.reason,
        "requested_at": recovery_request.requested_at,
        "reviewed_at": recovery_request.reviewed_at,
        "completed_at": recovery_request.completed_at,
        "expires_at": recovery_request.expires_at,
        "created_at": notice_time,
        "review_note": recovery_request.review_note,
        "appeal_reason": recovery_request.appeal_reason,
        "appealed_at": recovery_request.appealed_at,
        "appeal_review_note": recovery_request.appeal_review_note,
        "appeal_reviewed_at": recovery_request.appeal_reviewed_at,
    }


def _serialize_authenticator_recovery_request(
    db: Session,
    recovery_request: models.AuthenticatorRecoveryRequest,
) -> dict:
    user = None
    reviewer = None
    if recovery_request.user_id:
        user = db.query(models.User).filter(models.User.id == recovery_request.user_id).first()
    if recovery_request.reviewer_id:
        reviewer = db.query(models.User).filter(models.User.id == recovery_request.reviewer_id).first()

    return {
        "id": recovery_request.id,
        "identifier": recovery_request.identifier,
        "username": user.username if user else None,
        "full_name": user.full_name if user else None,
        "role": user.role if user else None,
        "is_active": user.is_active if user else None,
        "reason": recovery_request.reason,
        "status": _effective_authenticator_recovery_status(recovery_request),
        "requested_at": recovery_request.requested_at,
        "reviewed_at": recovery_request.reviewed_at,
        "completed_at": recovery_request.completed_at,
        "expires_at": recovery_request.expires_at,
        "reviewer_username": reviewer.username if reviewer else None,
        "review_note": recovery_request.review_note,
        "appeal_reason": recovery_request.appeal_reason,
        "appealed_at": recovery_request.appealed_at,
        "appeal_review_note": recovery_request.appeal_review_note,
        "appeal_reviewed_at": recovery_request.appeal_reviewed_at,
    }


def _get_latest_authenticator_recovery_request_for_identifier(db: Session, identifier: str):
    normalized_identifier = _normalize_password_reset_identifier(identifier).lower()
    user = _find_user_by_authenticator_recovery_identifier(db, identifier)
    query = db.query(models.AuthenticatorRecoveryRequest)
    if user:
        query = query.filter(models.AuthenticatorRecoveryRequest.user_id == user.id)
    else:
        query = query.filter(
            models.AuthenticatorRecoveryRequest.normalized_identifier == normalized_identifier
        )

    return (
        query
        .order_by(models.AuthenticatorRecoveryRequest.requested_at.desc())
        .first()
    )


def _get_authenticator_recovery_request_or_404(db: Session, request_id: int):
    recovery_request = (
        db.query(models.AuthenticatorRecoveryRequest)
        .filter(models.AuthenticatorRecoveryRequest.id == request_id)
        .first()
    )
    if not recovery_request:
        raise HTTPException(status_code=404, detail="Authenticator recovery request not found")
    return recovery_request


def _begin_authenticator_setup(user: models.User, extra: Optional[dict] = None):
    secret = _generate_authenticator_secret()
    token_extra = {"totp_secret": secret}
    if extra:
        token_extra.update(extra)
    mfa_token, _token_id = auth.create_mfa_token(
        user.username,
        purpose="authenticator_setup",
        extra=token_extra,
    )
    return {
        "authenticator_setup_required": True,
        "mfa_required": True,
        "mfa_type": "authenticator_setup",
        "mfa_token": mfa_token,
        "authenticator": {
            "issuer": AUTHENTICATOR_ISSUER,
            "account": user.username,
            "secret": secret,
            "secret_formatted": _format_authenticator_secret(secret),
            "otpauth_url": _authenticator_otpauth_url(user, secret),
            "digits": AUTHENTICATOR_DIGITS,
            "period": AUTHENTICATOR_PERIOD_SECONDS,
        },
        "user": _build_authenticator_user_hint(user, False),
    }


def _begin_authenticator_authentication(user: models.User):
    mfa_token, _token_id = auth.create_mfa_token(user.username, purpose="authenticator")
    return {
        "mfa_required": True,
        "mfa_type": "authenticator",
        "mfa_token": mfa_token,
        "user": _build_authenticator_user_hint(user, True),
    }


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

    if user.authenticator_enabled and user.authenticator_secret:
        trusted_device = _get_valid_trusted_device(db, user, payload.remember_device_token)
        if trusted_device:
            response = _build_login_success(db, user)
            response["authenticator_mfa_verified"] = True
            response["remember_device_verified"] = True
            response["remember_device_expires_at"] = trusted_device.expires_at.isoformat() + "Z"
            _add_audit_log(
                db,
                user_id=user.id,
                action="LOGIN",
                details="Successful login with remembered authenticator device",
                request=req,
            )
            db.commit()
            return response

        response = _begin_authenticator_authentication(user)
        audit_action = "LOGIN_AUTHENTICATOR_REQUIRED"
        audit_details = "Password accepted; authenticator app MFA required"
    else:
        response = _begin_authenticator_setup(user)
        audit_action = "LOGIN_AUTHENTICATOR_SETUP_REQUIRED"
        audit_details = "Password accepted; authenticator app setup required before login"

    _add_audit_log(
        db,
        user_id=user.id,
        action=audit_action,
        details=audit_details,
        request=req,
    )
    db.commit()
    return response


def _extract_bearer_token(authorization: Optional[str]) -> str:
    header_value = str(authorization or "").strip()
    if not header_value.lower().startswith("bearer "):
        return ""
    return header_value.split(" ", 1)[1].strip()


def _mfa_verification_session_detail(message: str, code: str = "mfa_session_invalid") -> dict:
    return {
        "code": code,
        "title": "Verification issue",
        "message": message,
    }


def _raise_mfa_verification_session_issue(
    message: str = "Verification session expired. Please sign in again.",
    *,
    code: str = "mfa_session_invalid",
):
    raise HTTPException(
        status_code=401,
        detail=_mfa_verification_session_detail(message, code),
    )


def _decode_authenticator_mfa_token(token: str) -> tuple[dict, str]:
    try:
        return auth.decode_mfa_token(token, purpose="authenticator"), "authenticator"
    except HTTPException:
        return auth.decode_mfa_token(token, purpose="authenticator_setup"), "authenticator_setup"


@app.post("/auth/authenticator/verify", include_in_schema=False)
@app.post("/api/auth/authenticator/verify", tags=["Auth"])
def authenticator_authentication_verify(
    data: schemas.AuthenticatorAuthenticationFinishRequest,
    req: Request,
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    body_mfa_token = str(data.mfa_token or "").strip()
    bearer_mfa_token = _extract_bearer_token(authorization)
    mfa_token = body_mfa_token or bearer_mfa_token
    token_source = "body" if body_mfa_token else "authorization" if bearer_mfa_token else "missing"
    cookie_present = bool(req.cookies) if req else False
    forwarded_proto = req.headers.get("x-forwarded-proto") if req else None

    if not mfa_token:
        auth_logger.warning(
            "MFA verify rejected: missing MFA token; username_present=%s cookie_present=%s forwarded_proto=%s",
            bool(str(data.username or "").strip()),
            cookie_present,
            forwarded_proto,
        )
        _raise_mfa_verification_session_issue(
            "Verification session expired. Please sign in again.",
            code="mfa_token_missing",
        )

    try:
        token_payload, purpose = _decode_authenticator_mfa_token(mfa_token)
    except HTTPException as exc:
        auth_logger.warning(
            "MFA verify rejected: invalid or expired MFA token; token_source=%s username_present=%s cookie_present=%s forwarded_proto=%s",
            token_source,
            bool(str(data.username or "").strip()),
            cookie_present,
            forwarded_proto,
        )
        raise HTTPException(
            status_code=401,
            detail=_mfa_verification_session_detail(
                "Verification session expired. Please sign in again.",
                "mfa_token_invalid",
            ),
        ) from exc

    token_username = token_payload.get("sub")
    if not token_username:
        auth_logger.warning(
            "MFA verify rejected: decoded MFA token has no username; token_source=%s cookie_present=%s forwarded_proto=%s",
            token_source,
            cookie_present,
            forwarded_proto,
        )
        _raise_mfa_verification_session_issue(
            "Verification session expired. Please sign in again.",
            code="mfa_username_missing",
        )

    submitted_username = str(data.username or "").strip()
    if submitted_username and submitted_username.lower() != str(token_username).lower():
        auth_logger.warning(
            "MFA verify rejected: submitted username does not match MFA token subject; token_source=%s cookie_present=%s forwarded_proto=%s",
            token_source,
            cookie_present,
            forwarded_proto,
        )
        _raise_mfa_verification_session_issue(
            "Verification session expired. Please sign in again.",
            code="mfa_username_mismatch",
        )

    user = db.query(models.User).filter(models.User.username == token_username).first()
    if not user or not user.is_active:
        auth_logger.warning(
            "MFA verify rejected: MFA token subject is not an active user; token_source=%s cookie_present=%s forwarded_proto=%s",
            token_source,
            cookie_present,
            forwarded_proto,
        )
        _raise_mfa_verification_session_issue(
            "Verification session expired. Please sign in again.",
            code="mfa_user_invalid",
        )

    recovery_codes: list[str] = []
    recovery_code_used = False
    recovery_request = None
    _enforce_authenticator_verification_not_locked(user)

    if purpose == "authenticator_setup":
        secret = token_payload.get("totp_secret")
        if not secret:
            raise HTTPException(status_code=401, detail="Invalid or expired MFA token")

        recovery_request_id = token_payload.get("authenticator_recovery_request_id")
        if recovery_request_id is not None:
            try:
                recovery_request_pk = int(recovery_request_id)
            except (TypeError, ValueError):
                raise HTTPException(status_code=401, detail="Invalid or expired authenticator recovery approval")
            recovery_request = (
                db.query(models.AuthenticatorRecoveryRequest)
                .filter(models.AuthenticatorRecoveryRequest.id == recovery_request_pk)
                .first()
            )
            if not recovery_request or recovery_request.user_id != user.id:
                raise HTTPException(status_code=401, detail="Invalid or expired authenticator recovery approval")
            if _expire_authenticator_recovery_request_if_needed(recovery_request):
                db.commit()
                raise HTTPException(status_code=400, detail="This authenticator recovery approval has expired")
            if _effective_authenticator_recovery_status(recovery_request) not in AUTHENTICATOR_RECOVERY_APPROVED_STATUSES:
                raise HTTPException(status_code=400, detail="No approved authenticator recovery request is available")

        try:
            counter = _verify_authenticator_code(secret, data.code)
        except HTTPException:
            _record_failed_authenticator_verification(db, user, req)
        now = datetime.utcnow()
        user.authenticator_secret = secret
        user.authenticator_enabled = True
        user.authenticator_last_counter = counter
        recovery_codes = _replace_user_recovery_codes(db, user)
        if recovery_request:
            db.query(models.UserTrustedDevice).filter(
                models.UserTrustedDevice.user_id == user.id,
                models.UserTrustedDevice.revoked_at.is_(None),
            ).update(
                {models.UserTrustedDevice.revoked_at: now},
                synchronize_session=False,
            )
            recovery_request.status = "used"
            recovery_request.completed_at = now
            recovery_request.expires_at = None
            _add_audit_log(
                db,
                user_id=user.id,
                action="AUTHENTICATOR_RECOVERY_COMPLETED",
                details="User successfully re-enrolled authenticator after admin approval",
                request=req,
            )
            audit_details = "Successful login after authenticator recovery setup"
        else:
            audit_details = "Successful login after authenticator app setup"
    else:
        if not user.authenticator_enabled or not user.authenticator_secret:
            raise HTTPException(status_code=400, detail="Authenticator app is not set up for this account")

        try:
            counter = _verify_authenticator_code(
                user.authenticator_secret,
                data.code,
                user.authenticator_last_counter,
            )
            user.authenticator_last_counter = counter
            audit_details = "Successful login with authenticator app MFA"
        except HTTPException:
            if _verify_recovery_code(db, user, data.code):
                recovery_code_used = True
                audit_details = "Successful login with authenticator recovery code"
            else:
                _record_failed_authenticator_verification(db, user, req)

    _clear_authenticator_verification_attempts(user)
    remember_device_token = None
    remember_device_expires_at = None
    if data.remember_device:
        remember_device_token, remember_device_expires_at = _create_trusted_device(db, user)

    _add_audit_log(
        db,
        user_id=user.id,
        action="LOGIN",
        details=audit_details,
        request=req,
    )
    db.commit()

    response = _build_login_success(db, user)
    response["authenticator_mfa_verified"] = True
    response["user"]["authenticator_mfa_enabled"] = True
    response["recovery_codes_remaining"] = _count_recovery_codes(db, user)
    if recovery_codes:
        response["recovery_codes"] = recovery_codes
    if recovery_code_used:
        response["recovery_code_used"] = True
    if remember_device_token and remember_device_expires_at:
        _attach_trusted_device_response(response, remember_device_token, remember_device_expires_at)
    return response


@app.post("/auth/authenticator-recovery/request", include_in_schema=False)
@app.post("/api/auth/authenticator-recovery/request", tags=["Auth"])
def request_authenticator_recovery(
    data: schemas.AuthenticatorRecoveryRequestCreate,
    req: Request,
    db: Session = Depends(get_db),
):
    identifier = _authenticator_recovery_identifier_from_payload(data)
    reason = _authenticator_recovery_reason_from_payload(data)
    normalized_identifier = identifier.lower()
    user = _find_user_by_authenticator_recovery_identifier(db, identifier)
    response_payload = {"message": AUTHENTICATOR_RECOVERY_REQUEST_SENT_MESSAGE}

    if user and user.is_active and user.role in USER_ROLES:
        existing_request = (
            db.query(models.AuthenticatorRecoveryRequest)
            .filter(
                models.AuthenticatorRecoveryRequest.user_id == user.id,
                models.AuthenticatorRecoveryRequest.status.in_(
                    tuple(AUTHENTICATOR_RECOVERY_OPEN_STATUSES | {"declined", "appeal_declined"})
                ),
            )
            .order_by(models.AuthenticatorRecoveryRequest.requested_at.desc())
            .first()
        )

        existing_status = (
            _effective_authenticator_recovery_status(existing_request)
            if existing_request
            else None
        )
        if existing_request and existing_status in (
            AUTHENTICATOR_RECOVERY_APPROVED_STATUSES | {"pending", "appealed", "declined", "appeal_declined"}
        ):
            existing_request.identifier = identifier
            existing_request.normalized_identifier = normalized_identifier
            response_payload = _serialize_authenticator_recovery_status(existing_request)
        elif existing_request:
            existing_request.identifier = identifier
            existing_request.normalized_identifier = normalized_identifier
            existing_request.reason = reason
            existing_request.status = "pending"
            existing_request.requested_at = datetime.utcnow()
            existing_request.reviewed_at = None
            existing_request.completed_at = None
            existing_request.expires_at = None
            existing_request.reviewer_id = None
            existing_request.review_note = None
            existing_request.appeal_reason = None
            existing_request.appealed_at = None
            existing_request.appeal_review_note = None
            existing_request.appeal_reviewed_at = None
        else:
            db.add(models.AuthenticatorRecoveryRequest(
                user_id=user.id,
                identifier=identifier,
                normalized_identifier=normalized_identifier,
                reason=reason,
                status="pending",
            ))

    _add_audit_log(
        db,
        user_id=user.id if user else None,
        action="AUTHENTICATOR_RECOVERY_REQUESTED",
        details=f"Authenticator recovery requested for identifier: {identifier}",
        request=req,
    )
    db.commit()
    return response_payload


@app.post(
    "/auth/authenticator-recovery/status",
    include_in_schema=False,
    response_model=schemas.AuthenticatorRecoveryStatusResponse,
)
@app.post(
    "/api/auth/authenticator-recovery/status",
    response_model=schemas.AuthenticatorRecoveryStatusResponse,
    tags=["Auth"],
)
def check_authenticator_recovery_status(
    data: schemas.AuthenticatorRecoveryStatusCheck,
    db: Session = Depends(get_db),
):
    identifier = _authenticator_recovery_identifier_from_payload(data)
    recovery_request = _get_latest_authenticator_recovery_request_for_identifier(db, identifier)
    if not recovery_request:
        raise HTTPException(
            status_code=404,
            detail=AUTHENTICATOR_RECOVERY_STATUS_MESSAGES["none"],
        )
    if _expire_authenticator_recovery_request_if_needed(recovery_request):
        db.commit()
        db.refresh(recovery_request)
    return _serialize_authenticator_recovery_status(recovery_request)


@app.post("/auth/authenticator-recovery/appeal", include_in_schema=False)
@app.post(
    "/api/auth/authenticator-recovery/appeal",
    response_model=schemas.AuthenticatorRecoveryStatusResponse,
    tags=["Auth"],
)
def appeal_authenticator_recovery(
    data: schemas.AuthenticatorRecoveryAppealCreate,
    req: Request,
    db: Session = Depends(get_db),
):
    identifier = _authenticator_recovery_identifier_from_payload(data)
    recovery_request = _get_latest_authenticator_recovery_request_for_identifier(db, identifier)
    if not recovery_request:
        raise HTTPException(status_code=404, detail=AUTHENTICATOR_RECOVERY_STATUS_MESSAGES["none"])

    status = _effective_authenticator_recovery_status(recovery_request)
    if status == "appealed":
        raise HTTPException(status_code=400, detail="An appeal is already pending admin review")
    if status != "declined":
        raise HTTPException(status_code=400, detail="Only declined authenticator recovery requests can be appealed")

    recovery_request.identifier = identifier
    recovery_request.normalized_identifier = identifier.lower()
    recovery_request.status = "appealed"
    recovery_request.appeal_reason = _authenticator_recovery_appeal_reason_from_payload(data)
    recovery_request.appealed_at = datetime.utcnow()
    recovery_request.appeal_review_note = None
    recovery_request.appeal_reviewed_at = None
    recovery_request.expires_at = None

    _add_audit_log(
        db,
        user_id=recovery_request.user_id,
        action="AUTHENTICATOR_RECOVERY_APPEALED",
        details=f"Authenticator recovery appeal submitted for identifier: {identifier}",
        request=req,
    )
    db.commit()
    db.refresh(recovery_request)
    return _serialize_authenticator_recovery_status(recovery_request)


@app.post("/auth/authenticator-recovery/setup", include_in_schema=False)
@app.post("/api/auth/authenticator-recovery/setup", tags=["Auth"])
def start_authenticator_recovery_setup(
    data: schemas.AuthenticatorRecoverySetupStart,
    req: Request,
    db: Session = Depends(get_db),
):
    identifier = _authenticator_recovery_identifier_from_payload(data)
    user = _find_user_by_authenticator_recovery_identifier(db, identifier)
    if not user or not user.is_active:
        raise HTTPException(status_code=400, detail="No approved authenticator recovery request is available")

    recovery_request = (
        db.query(models.AuthenticatorRecoveryRequest)
        .filter(
            models.AuthenticatorRecoveryRequest.user_id == user.id,
            models.AuthenticatorRecoveryRequest.status.in_(tuple(AUTHENTICATOR_RECOVERY_APPROVED_STATUSES)),
        )
        .order_by(
            models.AuthenticatorRecoveryRequest.appeal_reviewed_at.desc(),
            models.AuthenticatorRecoveryRequest.reviewed_at.desc(),
            models.AuthenticatorRecoveryRequest.requested_at.desc(),
        )
        .first()
    )
    if not recovery_request:
        raise HTTPException(status_code=400, detail="No approved authenticator recovery request is available")
    if _expire_authenticator_recovery_request_if_needed(recovery_request):
        db.commit()
        raise HTTPException(status_code=400, detail="This authenticator recovery approval has expired")

    response = _begin_authenticator_setup(
        user,
        extra={
            "authenticator_recovery": True,
            "authenticator_recovery_request_id": recovery_request.id,
        },
    )
    response["message"] = AUTHENTICATOR_RECOVERY_STATUS_MESSAGES[_effective_authenticator_recovery_status(recovery_request)]

    _add_audit_log(
        db,
        user_id=user.id,
        action="AUTHENTICATOR_RECOVERY_SETUP_STARTED",
        details="User started approved authenticator recovery setup",
        request=req,
    )
    db.commit()
    return response


@app.post("/auth/password-reset/request", include_in_schema=False)
@app.post("/api/auth/password-reset/request", tags=["Auth"])
def request_password_reset(
    data: schemas.PasswordResetRequestCreate,
    req: Request,
    db: Session = Depends(get_db),
):
    identifier = _password_reset_identifier_from_payload(data)
    normalized_identifier = identifier.lower()
    user = _find_user_by_reset_identifier(db, identifier)
    response_payload = {
        "message": PASSWORD_RESET_REQUEST_SENT_MESSAGE,
    }

    if user and user.is_active:
        existing_request = (
            db.query(models.PasswordResetRequest)
            .filter(
                models.PasswordResetRequest.user_id == user.id,
                models.PasswordResetRequest.status.in_(
                    tuple(PASSWORD_RESET_OPEN_STATUSES | {"declined", "appeal_declined"})
                ),
            )
            .order_by(models.PasswordResetRequest.requested_at.desc())
            .first()
        )

        existing_status = _effective_password_reset_status(existing_request) if existing_request else None
        if existing_request and existing_status in PASSWORD_RESET_APPROVED_STATUSES:
            existing_request.identifier = identifier
            existing_request.normalized_identifier = normalized_identifier
            response_payload = _serialize_password_reset_status(existing_request)
        elif existing_request and existing_status in {"declined", "appealed", "appeal_declined"}:
            existing_request.identifier = identifier
            existing_request.normalized_identifier = normalized_identifier
            response_payload = _serialize_password_reset_status(existing_request)
        elif existing_request:
            existing_request.identifier = identifier
            existing_request.normalized_identifier = normalized_identifier
            existing_request.status = "pending"
            existing_request.requested_at = datetime.utcnow()
            existing_request.reviewed_at = None
            existing_request.completed_at = None
            existing_request.expires_at = None
            existing_request.reviewer_id = None
            existing_request.review_note = None
            existing_request.appeal_reason = None
            existing_request.appealed_at = None
            existing_request.appeal_review_note = None
            existing_request.appeal_reviewed_at = None
        else:
            db.add(models.PasswordResetRequest(
                user_id=user.id,
                identifier=identifier,
                normalized_identifier=normalized_identifier,
                status="pending",
            ))

    _add_audit_log(
        db,
        user_id=user.id if user else None,
        action="PASSWORD_RESET_REQUESTED",
        details=f"Password reset requested for identifier: {identifier}",
        request=req,
    )
    db.commit()

    return response_payload


@app.post(
    "/auth/password-reset/status",
    include_in_schema=False,
    response_model=schemas.PasswordResetStatusResponse,
)
@app.post(
    "/api/auth/password-reset/status",
    response_model=schemas.PasswordResetStatusResponse,
    tags=["Auth"],
)
def check_password_reset_status(
    data: schemas.PasswordResetRequestCreate,
    db: Session = Depends(get_db),
):
    identifier = _password_reset_identifier_from_payload(data)
    reset_request = _get_latest_password_reset_request_for_identifier(db, identifier)
    if not reset_request:
        raise HTTPException(
            status_code=404,
            detail=PASSWORD_RESET_STATUS_MESSAGES["none"],
        )
    if reset_request and _expire_password_reset_request_if_needed(reset_request):
        db.commit()
        db.refresh(reset_request)
    return _serialize_password_reset_status(reset_request)


@app.post("/auth/password-reset/appeal", include_in_schema=False)
@app.post(
    "/api/auth/password-reset/appeal",
    response_model=schemas.PasswordResetStatusResponse,
    tags=["Auth"],
)
def appeal_password_reset(
    data: schemas.PasswordResetAppealCreate,
    req: Request,
    db: Session = Depends(get_db),
):
    identifier = _password_reset_identifier_from_payload(data)
    reset_request = _get_latest_password_reset_request_for_identifier(db, identifier)
    if not reset_request:
        raise HTTPException(status_code=404, detail=PASSWORD_RESET_STATUS_MESSAGES["none"])

    status = _effective_password_reset_status(reset_request)
    if status == "appealed":
        raise HTTPException(status_code=400, detail="An appeal is already pending admin review")
    if status != "declined":
        raise HTTPException(status_code=400, detail="Only declined password reset requests can be appealed")

    reset_request.identifier = identifier
    reset_request.normalized_identifier = identifier.lower()
    reset_request.status = "appealed"
    reset_request.appeal_reason = _password_reset_appeal_reason_from_payload(data)
    reset_request.appealed_at = datetime.utcnow()
    reset_request.appeal_review_note = None
    reset_request.appeal_reviewed_at = None
    reset_request.expires_at = None

    _add_audit_log(
        db,
        user_id=reset_request.user_id,
        action="PASSWORD_RESET_APPEALED",
        details=f"Password reset appeal submitted for identifier: {identifier}",
        request=req,
    )
    db.commit()
    db.refresh(reset_request)
    return _serialize_password_reset_status(reset_request)


@app.post("/auth/password-reset/complete", include_in_schema=False)
@app.post("/api/auth/password-reset/complete", tags=["Auth"])
def complete_password_reset(
    data: schemas.PasswordResetComplete,
    req: Request,
    db: Session = Depends(get_db),
):
    identifier = _password_reset_identifier_from_payload(data)
    user = _find_user_by_reset_identifier(db, identifier)
    if not user or not user.is_active:
        raise HTTPException(status_code=400, detail="No approved password reset request is available")

    reset_request = (
        db.query(models.PasswordResetRequest)
        .filter(
            models.PasswordResetRequest.user_id == user.id,
            models.PasswordResetRequest.status.in_(tuple(PASSWORD_RESET_APPROVED_STATUSES)),
        )
        .order_by(models.PasswordResetRequest.reviewed_at.desc(), models.PasswordResetRequest.requested_at.desc())
        .first()
    )

    if not reset_request:
        raise HTTPException(status_code=400, detail="No approved password reset request is available")

    if _expire_password_reset_request_if_needed(reset_request):
        db.commit()
        raise HTTPException(status_code=400, detail="This password reset approval has expired")

    if _effective_password_reset_status(reset_request) not in PASSWORD_RESET_APPROVED_STATUSES:
        raise HTTPException(status_code=400, detail="No approved password reset request is available")

    password = _validate_user_password(data.new_password)
    user.password_hash = auth.get_password_hash(password)
    _reset_user_authenticator(db, user, revoke_remembered_devices=True)
    reset_request.status = "used"
    reset_request.completed_at = datetime.utcnow()
    reset_request.expires_at = None

    _add_audit_log(
        db,
        user_id=user.id,
        action="PASSWORD_RESET_COMPLETED",
        details="User changed password after admin approval",
        request=req,
    )
    db.commit()

    return {
        "message": "Password changed. Sign in with your new password.",
    }


@app.post("/auth/register", include_in_schema=False)
@app.post("/api/auth/register", tags=["Auth"])
def register(
    data: schemas.UserCreate,
    req: Request,
    db: Session = Depends(get_db),
    current: models.User = Depends(auth.require_admin),
):
    username = _normalize_username(data.username)
    if _find_user_by_username(db, username):
        raise HTTPException(status_code=400, detail="Username already exists")

    password = _validate_user_password(data.password)
    role = _validate_user_role(data.role)
    user = models.User(
        username=username,
        full_name=_normalize_full_name(data.full_name),
        password_hash=auth.get_password_hash(password),
        role=role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    _add_audit_log(
        db,
        user_id=current.id, action="USER_CREATED",
        details=f"Created user: {username} (role={role})",
        request=req,
    )
    db.commit()
    return {"message": "User created", "id": user.id}


@app.get("/auth/me", include_in_schema=False)
@app.get("/api/auth/me", tags=["Auth"])
def me(
    db: Session = Depends(get_db),
    current: models.User = Depends(auth.get_current_user),
):
    return _user_payload(db, current)


@app.get("/account/notices", include_in_schema=False)
@app.get("/api/account/notices", tags=["Account"])
def get_account_notices(
    db: Session = Depends(get_db),
    current: models.User = Depends(auth.get_current_user),
):
    reset_request = (
        db.query(models.PasswordResetRequest)
        .filter(models.PasswordResetRequest.user_id == current.id)
        .order_by(models.PasswordResetRequest.requested_at.desc())
        .first()
    )
    recovery_request = (
        db.query(models.AuthenticatorRecoveryRequest)
        .filter(models.AuthenticatorRecoveryRequest.user_id == current.id)
        .order_by(models.AuthenticatorRecoveryRequest.requested_at.desc())
        .first()
    )

    notices = []
    changed = False
    if reset_request and _expire_password_reset_request_if_needed(reset_request):
        changed = True
    if recovery_request and _expire_authenticator_recovery_request_if_needed(recovery_request):
        changed = True
    if changed:
        db.commit()
        if reset_request:
            db.refresh(reset_request)
        if recovery_request:
            db.refresh(recovery_request)

    if reset_request:
        notices.append(_serialize_password_reset_account_notice(reset_request))
    if recovery_request:
        notices.append(_serialize_authenticator_recovery_account_notice(recovery_request))

    return notices


@app.post("/auth/recovery-codes/regenerate", include_in_schema=False)
@app.post("/api/auth/recovery-codes/regenerate", tags=["Auth"])
def regenerate_my_recovery_codes(
    req: Request,
    db: Session = Depends(get_db),
    current: models.User = Depends(auth.get_current_user),
):
    if not current.authenticator_enabled or not current.authenticator_secret:
        raise HTTPException(status_code=400, detail="Authenticator app is not set up for this account")

    recovery_codes = _replace_user_recovery_codes(db, current)
    _add_audit_log(
        db,
        user_id=current.id,
        action="RECOVERY_CODES_REGENERATED",
        details="User regenerated authenticator recovery codes",
        request=req,
    )
    db.commit()

    return {
        "message": "Recovery codes regenerated",
        "recovery_codes": recovery_codes,
        "recovery_codes_remaining": len(recovery_codes),
    }


@app.get("/api/admin/users", response_model=List[schemas.UserResponse], tags=["Admin"])
def list_admin_users(
    db: Session = Depends(get_db),
    _: models.User = Depends(auth.require_admin),
):
    users = db.query(models.User).order_by(models.User.username).all()
    return [_serialize_admin_user(db, user) for user in users]


@app.get(
    "/api/admin/password-reset-requests",
    response_model=List[schemas.PasswordResetRequestResponse],
    tags=["Admin"],
)
def list_password_reset_requests(
    status: Optional[str] = None,
    db: Session = Depends(get_db),
    _: models.User = Depends(auth.require_admin),
):
    query = db.query(models.PasswordResetRequest)
    normalized_status = _normalize_password_reset_status(status or "")
    if normalized_status and normalized_status != "all":
        if normalized_status == "expired":
            query = query.filter(or_(
                models.PasswordResetRequest.status == "expired",
                and_(
                    models.PasswordResetRequest.status.in_(tuple(PASSWORD_RESET_APPROVED_STATUSES)),
                    models.PasswordResetRequest.expires_at <= datetime.utcnow(),
                ),
            ))
        else:
            query = query.filter(models.PasswordResetRequest.status == normalized_status)

    reset_requests = (
        query
        .order_by(models.PasswordResetRequest.requested_at.desc())
        .limit(100)
        .all()
    )

    expired_changed = False
    for reset_request in reset_requests:
        expired_changed = _expire_password_reset_request_if_needed(reset_request) or expired_changed
    if expired_changed:
        db.commit()

    return [_serialize_password_reset_request(db, reset_request) for reset_request in reset_requests]


@app.post(
    "/api/admin/password-reset-requests/{request_id}/approve",
    response_model=schemas.PasswordResetRequestResponse,
    tags=["Admin"],
)
def approve_password_reset_request(
    request_id: int,
    req: Request,
    data: Optional[schemas.PasswordResetReviewUpdate] = None,
    db: Session = Depends(get_db),
    current: models.User = Depends(auth.require_admin),
):
    reset_request = _get_password_reset_request_or_404(db, request_id)
    _expire_password_reset_request_if_needed(reset_request)
    if reset_request.status not in {"pending", "expired"}:
        raise HTTPException(status_code=400, detail="Only open reset requests can be approved")

    user = db.query(models.User).filter(models.User.id == reset_request.user_id).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=400, detail="This account is not active")

    now = datetime.utcnow()
    reset_request.status = "approved"
    reset_request.reviewed_at = now
    reset_request.completed_at = None
    reset_request.expires_at = now + timedelta(minutes=PASSWORD_RESET_APPROVAL_EXPIRE_MINUTES)
    reset_request.reviewer_id = current.id
    reset_request.review_note = _normalize_password_reset_note(data.note if data else None)

    _add_audit_log(
        db,
        user_id=current.id,
        action="PASSWORD_RESET_APPROVED",
        details=f"Approved password reset for {user.username}",
        request=req,
    )
    db.commit()
    db.refresh(reset_request)
    return _serialize_password_reset_request(db, reset_request)


@app.post(
    "/api/admin/password-reset-requests/{request_id}/deny",
    response_model=schemas.PasswordResetRequestResponse,
    tags=["Admin"],
)
def deny_password_reset_request(
    request_id: int,
    req: Request,
    data: Optional[schemas.PasswordResetReviewUpdate] = None,
    db: Session = Depends(get_db),
    current: models.User = Depends(auth.require_admin),
):
    reset_request = _get_password_reset_request_or_404(db, request_id)
    _expire_password_reset_request_if_needed(reset_request)
    if reset_request.status not in {"pending", "approved", "expired"}:
        raise HTTPException(status_code=400, detail="This reset request has already been closed")

    user = db.query(models.User).filter(models.User.id == reset_request.user_id).first()
    now = datetime.utcnow()
    reset_request.status = "declined"
    reset_request.reviewed_at = now
    reset_request.expires_at = None
    reset_request.reviewer_id = current.id
    reset_request.review_note = _normalize_password_reset_note(data.note if data else None)

    _add_audit_log(
        db,
        user_id=current.id,
        action="PASSWORD_RESET_DECLINED",
        details=f"Declined password reset for {user.username if user else reset_request.identifier}",
        request=req,
    )
    db.commit()
    db.refresh(reset_request)
    return _serialize_password_reset_request(db, reset_request)


@app.post(
    "/api/admin/password-reset-requests/{request_id}/appeal/approve",
    response_model=schemas.PasswordResetRequestResponse,
    tags=["Admin"],
)
def approve_password_reset_appeal(
    request_id: int,
    req: Request,
    data: Optional[schemas.PasswordResetReviewUpdate] = None,
    db: Session = Depends(get_db),
    current: models.User = Depends(auth.require_admin),
):
    reset_request = _get_password_reset_request_or_404(db, request_id)
    _expire_password_reset_request_if_needed(reset_request)
    if _normalize_password_reset_status(reset_request.status) != "appealed":
        raise HTTPException(status_code=400, detail="Only appealed reset requests can be appeal-approved")

    user = db.query(models.User).filter(models.User.id == reset_request.user_id).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=400, detail="This account is not active")

    now = datetime.utcnow()
    reset_request.status = "appeal_approved"
    reset_request.appeal_reviewed_at = now
    reset_request.appeal_review_note = _normalize_password_reset_note(data.note if data else None)
    reset_request.completed_at = None
    reset_request.expires_at = now + timedelta(minutes=PASSWORD_RESET_APPROVAL_EXPIRE_MINUTES)
    reset_request.reviewer_id = current.id

    _add_audit_log(
        db,
        user_id=current.id,
        action="PASSWORD_RESET_APPEAL_APPROVED",
        details=f"Approved password reset appeal for {user.username}",
        request=req,
    )
    db.commit()
    db.refresh(reset_request)
    return _serialize_password_reset_request(db, reset_request)


@app.post(
    "/api/admin/password-reset-requests/{request_id}/appeal/deny",
    response_model=schemas.PasswordResetRequestResponse,
    tags=["Admin"],
)
def deny_password_reset_appeal(
    request_id: int,
    req: Request,
    data: Optional[schemas.PasswordResetReviewUpdate] = None,
    db: Session = Depends(get_db),
    current: models.User = Depends(auth.require_admin),
):
    reset_request = _get_password_reset_request_or_404(db, request_id)
    _expire_password_reset_request_if_needed(reset_request)
    if _normalize_password_reset_status(reset_request.status) != "appealed":
        raise HTTPException(status_code=400, detail="Only appealed reset requests can be appeal-declined")

    user = db.query(models.User).filter(models.User.id == reset_request.user_id).first()
    now = datetime.utcnow()
    reset_request.status = "appeal_declined"
    reset_request.appeal_reviewed_at = now
    reset_request.appeal_review_note = _normalize_password_reset_note(data.note if data else None)
    reset_request.expires_at = None
    reset_request.reviewer_id = current.id

    _add_audit_log(
        db,
        user_id=current.id,
        action="PASSWORD_RESET_APPEAL_DECLINED",
        details=f"Declined password reset appeal for {user.username if user else reset_request.identifier}",
        request=req,
    )
    db.commit()
    db.refresh(reset_request)
    return _serialize_password_reset_request(db, reset_request)


@app.get(
    "/api/admin/authenticator-recovery-requests",
    response_model=List[schemas.AuthenticatorRecoveryRequestResponse],
    tags=["Admin"],
)
def list_authenticator_recovery_requests(
    status: Optional[str] = None,
    db: Session = Depends(get_db),
    _: models.User = Depends(auth.require_admin),
):
    query = db.query(models.AuthenticatorRecoveryRequest)
    normalized_status = _normalize_authenticator_recovery_status(status or "")
    if normalized_status and normalized_status != "all":
        if normalized_status == "expired":
            query = query.filter(or_(
                models.AuthenticatorRecoveryRequest.status == "expired",
                and_(
                    models.AuthenticatorRecoveryRequest.status.in_(tuple(AUTHENTICATOR_RECOVERY_APPROVED_STATUSES)),
                    models.AuthenticatorRecoveryRequest.expires_at <= datetime.utcnow(),
                ),
            ))
        else:
            query = query.filter(models.AuthenticatorRecoveryRequest.status == normalized_status)

    recovery_requests = (
        query
        .order_by(models.AuthenticatorRecoveryRequest.requested_at.desc())
        .limit(100)
        .all()
    )

    expired_changed = False
    for recovery_request in recovery_requests:
        expired_changed = _expire_authenticator_recovery_request_if_needed(recovery_request) or expired_changed
    if expired_changed:
        db.commit()

    return [
        _serialize_authenticator_recovery_request(db, recovery_request)
        for recovery_request in recovery_requests
    ]


@app.post(
    "/api/admin/authenticator-recovery-requests/{request_id}/approve",
    response_model=schemas.AuthenticatorRecoveryRequestResponse,
    tags=["Admin"],
)
def approve_authenticator_recovery_request(
    request_id: int,
    req: Request,
    data: Optional[schemas.PasswordResetReviewUpdate] = None,
    db: Session = Depends(get_db),
    current: models.User = Depends(auth.require_admin),
):
    recovery_request = _get_authenticator_recovery_request_or_404(db, request_id)
    _expire_authenticator_recovery_request_if_needed(recovery_request)
    if recovery_request.status not in {"pending", "expired"}:
        raise HTTPException(status_code=400, detail="Only open authenticator recovery requests can be approved")

    user = db.query(models.User).filter(models.User.id == recovery_request.user_id).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=400, detail="This account is not active")

    now = datetime.utcnow()
    recovery_request.status = "approved"
    recovery_request.reviewed_at = now
    recovery_request.completed_at = None
    recovery_request.expires_at = now + timedelta(minutes=AUTHENTICATOR_RECOVERY_APPROVAL_EXPIRE_MINUTES)
    recovery_request.reviewer_id = current.id
    recovery_request.review_note = _normalize_authenticator_recovery_note(data.note if data else None)

    _add_audit_log(
        db,
        user_id=current.id,
        action="AUTHENTICATOR_RECOVERY_APPROVED",
        details=f"Approved authenticator recovery for {user.username}",
        request=req,
    )
    db.commit()
    db.refresh(recovery_request)
    return _serialize_authenticator_recovery_request(db, recovery_request)


@app.post(
    "/api/admin/authenticator-recovery-requests/{request_id}/deny",
    response_model=schemas.AuthenticatorRecoveryRequestResponse,
    tags=["Admin"],
)
def deny_authenticator_recovery_request(
    request_id: int,
    req: Request,
    data: Optional[schemas.PasswordResetReviewUpdate] = None,
    db: Session = Depends(get_db),
    current: models.User = Depends(auth.require_admin),
):
    recovery_request = _get_authenticator_recovery_request_or_404(db, request_id)
    _expire_authenticator_recovery_request_if_needed(recovery_request)
    if recovery_request.status not in {"pending", "approved", "expired"}:
        raise HTTPException(status_code=400, detail="This authenticator recovery request has already been closed")

    user = db.query(models.User).filter(models.User.id == recovery_request.user_id).first()
    now = datetime.utcnow()
    recovery_request.status = "declined"
    recovery_request.reviewed_at = now
    recovery_request.expires_at = None
    recovery_request.reviewer_id = current.id
    recovery_request.review_note = _normalize_authenticator_recovery_note(data.note if data else None)

    _add_audit_log(
        db,
        user_id=current.id,
        action="AUTHENTICATOR_RECOVERY_DECLINED",
        details=f"Declined authenticator recovery for {user.username if user else recovery_request.identifier}",
        request=req,
    )
    db.commit()
    db.refresh(recovery_request)
    return _serialize_authenticator_recovery_request(db, recovery_request)


@app.post(
    "/api/admin/authenticator-recovery-requests/{request_id}/appeal/approve",
    response_model=schemas.AuthenticatorRecoveryRequestResponse,
    tags=["Admin"],
)
def approve_authenticator_recovery_appeal(
    request_id: int,
    req: Request,
    data: Optional[schemas.PasswordResetReviewUpdate] = None,
    db: Session = Depends(get_db),
    current: models.User = Depends(auth.require_admin),
):
    recovery_request = _get_authenticator_recovery_request_or_404(db, request_id)
    _expire_authenticator_recovery_request_if_needed(recovery_request)
    if _normalize_authenticator_recovery_status(recovery_request.status) != "appealed":
        raise HTTPException(status_code=400, detail="Only appealed authenticator recovery requests can be appeal-approved")

    user = db.query(models.User).filter(models.User.id == recovery_request.user_id).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=400, detail="This account is not active")

    now = datetime.utcnow()
    recovery_request.status = "appeal_approved"
    recovery_request.appeal_reviewed_at = now
    recovery_request.appeal_review_note = _normalize_authenticator_recovery_note(data.note if data else None)
    recovery_request.completed_at = None
    recovery_request.expires_at = now + timedelta(minutes=AUTHENTICATOR_RECOVERY_APPROVAL_EXPIRE_MINUTES)
    recovery_request.reviewer_id = current.id

    _add_audit_log(
        db,
        user_id=current.id,
        action="AUTHENTICATOR_RECOVERY_APPEAL_APPROVED",
        details=f"Approved authenticator recovery appeal for {user.username}",
        request=req,
    )
    db.commit()
    db.refresh(recovery_request)
    return _serialize_authenticator_recovery_request(db, recovery_request)


@app.post(
    "/api/admin/authenticator-recovery-requests/{request_id}/appeal/deny",
    response_model=schemas.AuthenticatorRecoveryRequestResponse,
    tags=["Admin"],
)
def deny_authenticator_recovery_appeal(
    request_id: int,
    req: Request,
    data: Optional[schemas.PasswordResetReviewUpdate] = None,
    db: Session = Depends(get_db),
    current: models.User = Depends(auth.require_admin),
):
    recovery_request = _get_authenticator_recovery_request_or_404(db, request_id)
    _expire_authenticator_recovery_request_if_needed(recovery_request)
    if _normalize_authenticator_recovery_status(recovery_request.status) != "appealed":
        raise HTTPException(status_code=400, detail="Only appealed authenticator recovery requests can be appeal-declined")

    user = db.query(models.User).filter(models.User.id == recovery_request.user_id).first()
    now = datetime.utcnow()
    recovery_request.status = "appeal_declined"
    recovery_request.appeal_reviewed_at = now
    recovery_request.appeal_review_note = _normalize_authenticator_recovery_note(data.note if data else None)
    recovery_request.expires_at = None
    recovery_request.reviewer_id = current.id

    _add_audit_log(
        db,
        user_id=current.id,
        action="AUTHENTICATOR_RECOVERY_APPEAL_DECLINED",
        details=f"Declined authenticator recovery appeal for {user.username if user else recovery_request.identifier}",
        request=req,
    )
    db.commit()
    db.refresh(recovery_request)
    return _serialize_authenticator_recovery_request(db, recovery_request)


@app.post("/api/admin/users", response_model=schemas.UserResponse, tags=["Admin"])
def admin_create_user(
    data: schemas.UserCreate,
    req: Request,
    db: Session = Depends(get_db),
    current: models.User = Depends(auth.require_admin),
):
    username = _normalize_username(data.username)
    if _find_user_by_username(db, username):
        raise HTTPException(status_code=400, detail="Username already exists")

    password = _validate_user_password(data.password)
    role = _validate_user_role(data.role)
    user = models.User(
        username=username,
        full_name=_normalize_full_name(data.full_name),
        password_hash=auth.get_password_hash(password),
        role=role,
        is_active=True,
    )
    db.add(user)
    db.flush()
    _add_audit_log(
        db,
        user_id=current.id,
        action="USER_CREATED",
        details=f"Created user: {username} (role={role})",
        request=req,
    )
    db.commit()
    db.refresh(user)
    return _serialize_admin_user(db, user)


@app.put("/api/admin/users/{user_id}", response_model=schemas.UserResponse, tags=["Admin"])
def admin_update_user(
    user_id: int,
    data: schemas.UserUpdate,
    req: Request,
    db: Session = Depends(get_db),
    current: models.User = Depends(auth.require_admin),
):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    changes = data.model_dump(exclude_unset=True) if hasattr(data, "model_dump") else data.dict(exclude_unset=True)
    next_role = _validate_user_role(changes["role"]) if "role" in changes and changes["role"] is not None else None
    next_is_active = bool(changes["is_active"]) if "is_active" in changes and changes["is_active"] is not None else None

    if user.id == current.id and (next_role and next_role != "admin" or next_is_active is False):
        raise HTTPException(status_code=400, detail="You cannot remove admin access from your own account")

    _ensure_admin_can_be_changed(db, user, next_role=next_role, next_is_active=next_is_active)

    audit_changes = []
    if "username" in changes and changes["username"] is not None:
        username = _normalize_username(changes["username"])
        if _find_user_by_username(db, username, exclude_user_id=user.id):
            raise HTTPException(status_code=400, detail="Username already exists")
        if username != user.username:
            audit_changes.append(f"username {user.username}->{username}")
            user.username = username

    if "full_name" in changes:
        full_name = _normalize_full_name(changes["full_name"])
        if full_name != user.full_name:
            audit_changes.append("full name updated")
            user.full_name = full_name

    if next_role is not None and next_role != user.role:
        audit_changes.append(f"role {user.role}->{next_role}")
        user.role = next_role

    if next_is_active is not None and next_is_active != user.is_active:
        audit_changes.append(f"active {user.is_active}->{next_is_active}")
        user.is_active = next_is_active

    if "password" in changes and changes["password"]:
        password = _validate_user_password(changes["password"])
        user.password_hash = auth.get_password_hash(password)
        _reset_user_authenticator(db, user, revoke_remembered_devices=True)
        audit_changes.append("password updated and authenticator reset")

    if audit_changes:
        _add_audit_log(
            db,
            user_id=current.id,
            action="USER_UPDATED",
            details=f"Updated user {user.username}: {', '.join(audit_changes)}",
            request=req,
        )

    db.commit()
    db.refresh(user)
    return _serialize_admin_user(db, user)


@app.delete("/api/admin/users/{user_id}", response_model=schemas.UserResponse, tags=["Admin"])
def admin_delete_user(
    user_id: int,
    req: Request,
    db: Session = Depends(get_db),
    current: models.User = Depends(auth.require_admin),
):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if user.id == current.id:
        raise HTTPException(status_code=400, detail="You cannot delete your own account")

    _ensure_admin_can_be_changed(db, user, next_is_active=False)

    if user.is_active:
        user.is_active = False
        _reset_user_authenticator(db, user, revoke_remembered_devices=True)
        _add_audit_log(
            db,
            user_id=current.id,
            action="USER_DEACTIVATED",
            details=f"Deactivated user: {user.username}",
            request=req,
        )
        db.commit()
        db.refresh(user)

    return _serialize_admin_user(db, user)


@app.post("/api/admin/users/{user_id}/authenticator/reset", tags=["Admin"])
def admin_reset_user_authenticator(
    user_id: int,
    data: schemas.AuthenticatorResetRequest,
    req: Request,
    db: Session = Depends(get_db),
    current: models.User = Depends(auth.require_admin),
):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    _reset_user_authenticator(
        db,
        user,
        revoke_remembered_devices=data.revoke_remembered_devices,
    )
    _add_audit_log(
        db,
        user_id=current.id,
        action="AUTHENTICATOR_RESET",
        details=f"Reset authenticator for {user.username}",
        request=req,
    )
    db.commit()

    return {
        "message": "Authenticator reset. The user must set up a new authenticator at next login.",
        "user_id": user.id,
        "username": user.username,
        "authenticator_mfa_enabled": False,
        "recovery_codes_remaining": 0,
        "remembered_devices_revoked": data.revoke_remembered_devices,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# PRODUCTS
# ═══════════════════════════════════════════════════════════════════════════════

LOW_STOCK_ALERT_TYPE = "low_stock"
HIGH_DEMAND_ALERT_TYPE = "high_demand"
ALERT_STATE_TYPES = {LOW_STOCK_ALERT_TYPE, HIGH_DEMAND_ALERT_TYPE}
ALERT_STATES = {"read", "dismissed"}


def _normalize_alert_signature(value) -> str:
    return str(value or "").strip()[:240]


def _empty_alert_state_payload():
    return {
        "read": {"low_stock": [], "high_demand": []},
        "dismissed": {"low_stock": [], "high_demand": []},
    }


def _build_high_demand_alert_items(predictions_response: dict) -> list[dict]:
    predictions = predictions_response.get("predictions", [])
    items = []

    for index, item in enumerate(predictions if isinstance(predictions, list) else []):
        predicted_quantity = float(item.get("predicted_quantity") or 0)
        historical_average = float(item.get("historical_average") or 0)
        stock_gap = float(item.get("stock_gap") or 0)
        current_stock = float(item.get("current_stock") or 0)
        min_stock = float(item.get("min_stock") or 0)
        demand_lift = predicted_quantity / historical_average if historical_average > 0 else 0
        high_demand_floor = max(12, min_stock, int(historical_average * 1.2 + 0.9999))
        is_high_demand = (
            predicted_quantity > 0 and (
                predicted_quantity >= high_demand_floor or
                demand_lift >= 1.35 or
                stock_gap >= 3 or
                predicted_quantity >= current_stock
            )
        )

        if not is_high_demand:
            continue

        items.append({
            "product_id": item.get("product_id", f"forecast-{index}"),
            "product_name": item.get("product_name") or f"Product {index + 1}",
            "category": item.get("category") or "General",
            "predicted_quantity": predicted_quantity,
            "historical_average": historical_average,
            "stock_gap": stock_gap,
            "current_stock": current_stock,
            "confidence": item.get("confidence") or "low",
            "demand_lift": demand_lift,
        })

    return sorted(
        items,
        key=lambda row: (
            -float(row.get("predicted_quantity") or 0),
            -float(row.get("stock_gap") or 0),
            -float(row.get("demand_lift") or 0),
        ),
    )[:5]


def _get_user_alert_state_signatures(db: Session, user_id: int, alert_type: str) -> set[str]:
    rows = (
        db.query(models.UserAlertState.signature)
        .filter(
            models.UserAlertState.user_id == user_id,
            models.UserAlertState.alert_type == alert_type,
            models.UserAlertState.state.in_(["read", "dismissed"]),
        )
        .all()
    )
    return {str(row[0]) for row in rows if row and row[0]}


@app.get("/api/alert-state", tags=["Alerts"])
def get_alert_state(
    db: Session = Depends(get_db),
    current: models.User = Depends(auth.get_current_user),
):
    payload = _empty_alert_state_payload()
    rows = (
        db.query(models.UserAlertState)
        .filter(models.UserAlertState.user_id == current.id)
        .all()
    )

    for row in rows:
        if row.alert_type in ALERT_STATE_TYPES and row.state in ALERT_STATES:
            payload[row.state][row.alert_type].append(row.signature)

    return payload


@app.post("/api/alert-state", tags=["Alerts"])
def update_alert_state(
    data: schemas.AlertStateUpdateRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current: models.User = Depends(auth.get_current_user),
):
    alert_type = str(data.alert_type or "").strip()
    state = str(data.state or "").strip()

    if alert_type not in ALERT_STATE_TYPES:
        raise HTTPException(status_code=400, detail="Invalid alert_type")
    if state not in ALERT_STATES:
        raise HTTPException(status_code=400, detail="Invalid alert state")

    signatures = [
        signature
        for signature in (_normalize_alert_signature(value) for value in data.signatures)
        if signature
    ]
    if not signatures:
        return get_alert_state(db, current)

    for signature in sorted(set(signatures)):
        row = (
            db.query(models.UserAlertState)
            .filter(
                models.UserAlertState.user_id == current.id,
                models.UserAlertState.alert_type == alert_type,
                models.UserAlertState.signature == signature,
                models.UserAlertState.state == state,
            )
            .first()
        )
        if row:
            row.updated_at = datetime.utcnow()
            continue

        db.add(models.UserAlertState(
            user_id=current.id,
            alert_type=alert_type,
            signature=signature,
            state=state,
        ))

    db.commit()
    _queue_stock_alert_refresh(
        background_tasks,
        "alert-state-updated",
        alert_type=alert_type,
        state=state,
        user_id=current.id,
    )
    return get_alert_state(db, current)


@app.get("/api/alerts/background-summary", tags=["Alerts"])
def get_background_alert_summary(
    x_smartcanteen_alert_token: Optional[str] = Header(None),
    db: Session = Depends(get_db),
):
    token_payload = auth.decode_background_alert_token(x_smartcanteen_alert_token or "")
    current = db.query(models.User).filter(models.User.username == token_payload["sub"]).first()
    if not current or not current.is_active:
        raise HTTPException(status_code=401, detail="Invalid or expired background alert token")

    low_stock_excluded = _get_user_alert_state_signatures(db, current.id, LOW_STOCK_ALERT_TYPE)
    high_demand_excluded = _get_user_alert_state_signatures(db, current.id, HIGH_DEMAND_ALERT_TYPE)

    low_stock_products = (
        db.query(models.Product)
        .filter(
            models.Product.is_active == True,
            models.Product.stock < models.Product.min_stock,
        )
        .order_by(models.Product.stock.asc(), models.Product.name.asc())
        .all()
    )
    low_stock_items = [
        {
            "id": product.id,
            "name": product.name,
            "category": product.category,
            "stock": product.stock,
            "min_stock": product.min_stock,
        }
        for product in low_stock_products
        if str(product.id or product.name or "") not in low_stock_excluded
    ]

    predictions_data = ml_predictor.predict_tomorrow_sales(db)
    high_demand_items = [
        item
        for item in _build_high_demand_alert_items(predictions_data)
        if str(item.get("product_id") or item.get("product_name") or "") not in high_demand_excluded
    ]

    return {
        "low_stock": low_stock_items,
        "high_demand": high_demand_items,
        "generated_at": datetime.utcnow().isoformat() + "Z",
    }


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


@app.get(
    "/api/products/quick-sale",
    response_model=List[schemas.QuickSaleProductResponse],
    tags=["Products"],
)
def list_quick_sale_products(
    db: Session = Depends(get_db),
    _: models.User = Depends(auth.get_current_user),
):
    cutoff = datetime.utcnow() - timedelta(days=30)
    sales_stats = (
        db.query(
            models.TransactionItem.product_id.label("product_id"),
            func.coalesce(func.sum(models.TransactionItem.quantity), 0).label("sales_last_30_days"),
            func.count(func.distinct(models.TransactionItem.transaction_id)).label("orders_last_30_days"),
            func.max(models.Transaction.created_at).label("last_sold_at"),
        )
        .join(models.Transaction, models.Transaction.id == models.TransactionItem.transaction_id)
        .filter(models.Transaction.created_at >= cutoff)
        .group_by(models.TransactionItem.product_id)
        .subquery()
    )
    sales_last_30_days = func.coalesce(sales_stats.c.sales_last_30_days, 0)
    orders_last_30_days = func.coalesce(sales_stats.c.orders_last_30_days, 0)
    rows = (
        db.query(
            models.Product,
            sales_last_30_days.label("sales_last_30_days"),
            orders_last_30_days.label("orders_last_30_days"),
            sales_stats.c.last_sold_at.label("last_sold_at"),
        )
        .outerjoin(sales_stats, sales_stats.c.product_id == models.Product.id)
        .filter(
            models.Product.is_active == True,
            models.Product.stock > 0,
        )
        .order_by(
            models.Product.is_favorite.desc(),
            sales_last_30_days.desc(),
            orders_last_30_days.desc(),
            sales_stats.c.last_sold_at.desc(),
            models.Product.name.asc(),
        )
        .all()
    )

    return [
        {
            "id": product.id,
            "name": product.name,
            "category": product.category,
            "price": product.price,
            "stock": product.stock,
            "min_stock": product.min_stock,
            "unit_type": product.unit_type,
            "base_unit": product.base_unit,
            "is_favorite": bool(product.is_favorite),
            "is_active": bool(product.is_active),
            "sales_last_30_days": round(float(sales_quantity or 0), 6),
            "orders_last_30_days": int(order_count or 0),
            "last_sold_at": last_sold_at,
        }
        for product, sales_quantity, order_count, last_sold_at in rows
    ]


@app.post("/api/products", response_model=schemas.ProductResponse, tags=["Products"])
def create_product(
    data: schemas.ProductCreate,
    req: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current: models.User = Depends(auth.require_admin),
):
    product_data = data.model_dump()
    product_data["name"] = str(product_data.get("name") or "").strip()
    _normalize_product_unit_fields(product_data)
    duplicate_product = _find_duplicate_product_name(db, product_data["name"])
    if duplicate_product:
        _raise_duplicate_product_name(duplicate_product)

    product = models.Product(**product_data)
    db.add(product)
    db.commit()
    db.refresh(product)
    _add_audit_log(
        db,
        user_id=current.id,
        action="PRODUCT_CREATED",
        details=f"Product: {product_data['name']}",
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

    update_data = data.model_dump(exclude_unset=True)
    if "name" in update_data and update_data["name"] is not None:
        update_data["name"] = str(update_data["name"]).strip()
        duplicate_product = _find_duplicate_product_name(
            db,
            update_data["name"],
            exclude_product_id=product.id,
        )
        if duplicate_product:
            _raise_duplicate_product_name(duplicate_product)

    _normalize_product_unit_fields(update_data, product)

    for field, value in update_data.items():
        setattr(product, field, value)
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
                models.Product.stock < models.Product.min_stock)
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

    today_revenue, today_transactions = db.query(
        func.coalesce(func.sum(models.Transaction.total), 0),
        func.count(models.Transaction.id),
    ).filter(models.Transaction.created_at.between(today_start, today_end)).one()
    total_revenue = db.query(
        func.coalesce(func.sum(models.Transaction.total), 0)
    ).scalar()
    low_stock_ct = db.query(models.Product).filter(
        models.Product.is_active == True,
        models.Product.stock < models.Product.min_stock,
    ).count()

    return {
        "today_revenue":      round(float(today_revenue or 0), 2),
        "today_transactions": int(today_transactions or 0),
        "total_products":     db.query(models.Product).filter(
                                  models.Product.is_active == True).count(),
        "low_stock_count":    low_stock_ct,
        "total_revenue":      round(float(total_revenue or 0), 2),
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

    txns = query.with_entities(models.Transaction.created_at, models.Transaction.total).all()

    bucket: dict = {}
    for created_at, total in txns:
        k = to_ph_time(created_at).date().isoformat()
        bucket.setdefault(k, {"date": k, "revenue": 0.0, "transactions": 0})
        bucket[k]["revenue"]      += float(total or 0)
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


@app.get("/api/analytics/category-sales", tags=["Analytics"])
def category_sales(
    days: int = 7,
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _: models.User = Depends(auth.get_current_user),
):
    date_range = _resolve_analytics_date_range(days, start_date, end_date)
    return analytics_helpers.get_category_sales(
        db,
        date_range["days"],
        start_date=start_date,
        end_date=end_date,
    )


@app.get("/api/analytics/payment-summary", tags=["Analytics"])
def payment_summary(
    days: int = 7,
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    _: models.User = Depends(auth.get_current_user),
):
    date_range = _resolve_analytics_date_range(days, start_date, end_date)
    return analytics_helpers.get_payment_summary(
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
# DEMAND FORECAST
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/api/predictions/tomorrow", tags=["Predictions"])
def predict_tomorrow(
    background_tasks: BackgroundTasks,
    weather: str = "clear",
    event: str = "none",
    db: Session = Depends(get_db),
    _: models.User = Depends(auth.get_current_user), 
):
    """Fulfills Research Objective (d): Predict demand to reduce food waste."""
    try:
        forecast_engine = ml_predictor.BEST_ALGORITHM
        result = ml_predictor.predict_tomorrow_sales(db, forecast_engine, weather, event)
        if result.get("cache_refresh_needed"):
            if ml_predictor.begin_prediction_cache_refresh(forecast_engine, weather, event):
                background_tasks.add_task(
                    ml_predictor.refresh_prediction_cache,
                    forecast_engine,
                    weather,
                    event,
                )

        return {
            "feature_summary": result.get("feature_summary", {}),
            "predictions": result.get("predictions", []),  # ✅ safe
            "weekly_sales_trend": result.get("weekly_sales_trend", []),
            "summary": result.get("summary", {}),
            "tomorrow_sales_outlook": result.get("tomorrow_sales_outlook", {}),
            "insights": result.get("insights", []),
            "data_source": result.get("data_source", "heuristic"),
            "cache_status": result.get("cache_status", "fresh"),
            "cache_updated_at": result.get("cache_updated_at"),
            "cache_refresh_needed": result.get("cache_refresh_needed", False),
            "generated_at": datetime.utcnow().isoformat()
        }

    except Exception as e:
        return {
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
            "tomorrow_sales_outlook": {},
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

# System settings

@app.get("/api/settings/modules", tags=["Settings"])
def get_module_settings(
    db: Session = Depends(get_db),
    _: models.User = Depends(auth.get_current_user),
):
    return _serialize_module_settings(db)


@app.put("/api/settings/modules", tags=["Settings"])
def update_module_settings(
    payload: schemas.ModuleSettingsUpdate,
    request: Request,
    db: Session = Depends(get_db),
    current: models.User = Depends(auth.require_admin),
):
    requested_settings = {}
    unknown_keys = []

    for item in payload.modules:
        module_key = str(item.module_key or "").strip()
        if module_key not in SYSTEM_MODULE_KEYS:
            unknown_keys.append(module_key or "(blank)")
            continue
        requested_settings[module_key] = bool(item.enabled)

    if unknown_keys:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown system module(s): {', '.join(sorted(set(unknown_keys)))}",
        )

    settings = _ensure_system_module_settings(db)
    for module_key, enabled in requested_settings.items():
        settings[module_key].enabled = True if module_key in LOCKED_ENABLED_MODULE_KEYS else enabled

    for module_key in LOCKED_ENABLED_MODULE_KEYS:
        if module_key in settings:
            settings[module_key].enabled = True

    enabled_keys = [
        module_key
        for module_key, _default_enabled in SYSTEM_MODULE_DEFAULTS
        if bool(settings[module_key].enabled)
    ]
    disabled_keys = [
        module_key
        for module_key, _default_enabled in SYSTEM_MODULE_DEFAULTS
        if not bool(settings[module_key].enabled)
    ]

    _add_audit_log(
        db,
        action="MODULE_SETTINGS_UPDATED",
        details=(
            f"Enabled modules: {', '.join(enabled_keys) or 'none'}; "
            f"Disabled modules: {', '.join(disabled_keys) or 'none'}"
        ),
        user_id=current.id,
        request=request,
    )
    db.commit()
    return _serialize_module_settings(db)


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


@app.get("/api/frontend-status", tags=["System"])
def frontend_status():
    frontend_dir = _get_frontend_dir()
    index_file = _resolve_frontend_file("index.html") if frontend_dir else None
    frontend_source_dir = _find_frontend_source_dir()
    return {
        "frontend_dir": frontend_dir,
        "frontend_source_dir": frontend_source_dir,
        "index_file": index_file,
        "index_exists": bool(index_file),
        "dist_is_stale": _frontend_dist_is_stale(frontend_dir),
        "auto_build_attempted": FRONTEND_BUILD_ATTEMPTED,
        "auto_build_error": FRONTEND_BUILD_ERROR,
    }


@app.post("/api/seed", tags=["System"])
def seed(
    reset_demo: bool = Query(False, description="Rebuild the local canteen demo dataset."),
    db: Session = Depends(get_db),
    _: models.User = Depends(auth.require_admin),
):
    """Seed realistic SmartCanteen demo products, sales, weather, and school events."""
    return seed_demo_canteen_database(db, reset=reset_demo)


@app.get("/{full_path:path}", include_in_schema=False)
def frontend_catch_all(full_path: str):
    if not _get_frontend_dir():
        raise HTTPException(status_code=404, detail="Not found")

    top_level = full_path.split("/", 1)[0]
    if top_level in RESERVED_FRONTEND_PREFIXES:
        raise HTTPException(status_code=404, detail="Not found")

    requested_file = _resolve_frontend_file(full_path)
    if requested_file:
        return _frontend_file_response(requested_file)

    if "." in os.path.basename(full_path):
        raise HTTPException(status_code=404, detail="File not found")

    return _frontend_index_response()
