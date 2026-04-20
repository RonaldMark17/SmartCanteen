"""
main.py  –  SmartCanteen AI  |  FastAPI Backend
─────────────────────────────────────────────────
Run:  uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
─────────────────────────────────────────────────
"""

from fastapi import BackgroundTasks, FastAPI, Depends, Header, HTTPException, Request, Query, Response, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlalchemy import func, text
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
from typing import List, Optional
import base64
import binascii
import hashlib
import hmac
import ipaddress
import os
import secrets
import struct
import subprocess
import time
from urllib.parse import quote

import backend.models as models
import backend.schemas as schemas
import backend.auth as auth
import backend.analytics_helpers as analytics_helpers
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


_ensure_user_authenticator_columns()
_ensure_analytics_indexes()

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

    FRONTEND_BUILD_ATTEMPTED = True
    frontend_source_dir = _find_frontend_source_dir()
    if not frontend_source_dir:
        FRONTEND_BUILD_ERROR = "Frontend source directory not found."
        return

    npm_command = "npm.cmd" if os.name == "nt" else "npm"
    try:
        subprocess.run(
            [npm_command, "run", "build", "--", "--configLoader", "native"],
            cwd=frontend_source_dir,
            check=True,
            text=True,
        )
    except (OSError, subprocess.CalledProcessError) as exc:
        FRONTEND_BUILD_ERROR = str(exc)


FRONTEND_DIR = _find_frontend_dir()
RESERVED_FRONTEND_PREFIXES = {"api", "docs", "redoc", "openapi.json"}


def _get_frontend_dir():
    global FRONTEND_DIR

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
        return FileResponse(index_file)
    message = "SmartCanteen AI API is running. Frontend build not found."
    if FRONTEND_BUILD_ERROR:
        message = f"{message} Auto-build failed: {FRONTEND_BUILD_ERROR}"
    return {"message": message, "docs": "/docs"}


FRONTEND_DIR = _get_frontend_dir()

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

AUTHENTICATOR_ISSUER = os.environ.get("SMARTCANTEEN_AUTHENTICATOR_ISSUER", "SmartCanteen")
AUTHENTICATOR_PERIOD_SECONDS = 30
AUTHENTICATOR_DIGITS = 6
AUTHENTICATOR_WINDOW_STEPS = 1
TRUSTED_DEVICE_DAYS = 30
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


def _begin_authenticator_setup(user: models.User):
    secret = _generate_authenticator_secret()
    mfa_token, _token_id = auth.create_mfa_token(
        user.username,
        purpose="authenticator_setup",
        extra={"totp_secret": secret},
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
    db: Session = Depends(get_db),
):
    token_payload, purpose = _decode_authenticator_mfa_token(data.mfa_token)
    user = db.query(models.User).filter(models.User.username == token_payload["sub"]).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="Invalid or expired MFA token")

    recovery_codes: list[str] = []
    recovery_code_used = False

    if purpose == "authenticator_setup":
        secret = token_payload.get("totp_secret")
        if not secret:
            raise HTTPException(status_code=401, detail="Invalid or expired MFA token")

        counter = _verify_authenticator_code(secret, data.code)
        user.authenticator_secret = secret
        user.authenticator_enabled = True
        user.authenticator_last_counter = counter
        recovery_codes = _replace_user_recovery_codes(db, user)
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
        except HTTPException as exc:
            if _verify_recovery_code(db, user, data.code):
                recovery_code_used = True
                audit_details = "Successful login with authenticator recovery code"
            elif len(_normalize_recovery_code(data.code)) == (
                RECOVERY_CODE_GROUPS * RECOVERY_CODE_GROUP_LENGTH
            ):
                raise HTTPException(status_code=401, detail="Invalid recovery code")
            else:
                raise exc

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
def me(
    db: Session = Depends(get_db),
    current: models.User = Depends(auth.get_current_user),
):
    return _user_payload(db, current)


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
    return [
        {
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
        for user in users
    ]


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


@app.post("/api/products", response_model=schemas.ProductResponse, tags=["Products"])
def create_product(
    data: schemas.ProductCreate,
    req: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current: models.User = Depends(auth.require_admin),
):
    product = models.Product(**data.model_dump())
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
# ML PREDICTIONS
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/api/predictions/tomorrow", tags=["Predictions"])
def predict_tomorrow(
    background_tasks: BackgroundTasks,
    algorithm: str = "XGBoost",
    weather: str = "clear",
    event: str = "none",
    db: Session = Depends(get_db),
    _: models.User = Depends(auth.get_current_user), 
):
    """Fulfills Research Objective (d): Predict demand to reduce food waste."""
    try:
        result = ml_predictor.predict_tomorrow_sales(db, algorithm, weather, event)
        if result.get("cache_refresh_needed"):
            if ml_predictor.begin_prediction_cache_refresh(algorithm, weather, event):
                background_tasks.add_task(
                    ml_predictor.refresh_prediction_cache,
                    algorithm,
                    weather,
                    event,
                )

        return {
            "metrics": result.get("metrics", {}),
            "algorithm_metrics": result.get("algorithm_metrics", {}),
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
    return {
        "frontend_dir": frontend_dir,
        "index_file": index_file,
        "index_exists": bool(index_file),
        "auto_build_attempted": FRONTEND_BUILD_ATTEMPTED,
        "auto_build_error": FRONTEND_BUILD_ERROR,
    }


@app.post("/api/seed", tags=["System"])
def seed(
    reset_demo: bool = Query(False, description="Rebuild the local canteen demo dataset."),
    db: Session = Depends(get_db),
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
        return FileResponse(requested_file)

    if "." in os.path.basename(full_path):
        raise HTTPException(status_code=404, detail="File not found")

    return _frontend_index_response()
