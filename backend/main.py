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
from sqlalchemy import func, text
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
from typing import List, Optional
import ipaddress
import json
import os
import subprocess
from urllib.parse import urlparse

from webauthn import (
    generate_authentication_options,
    generate_registration_options,
    verify_authentication_response,
    verify_registration_response,
)
from webauthn.helpers import base64url_to_bytes, bytes_to_base64url, options_to_json_dict
from webauthn.helpers.exceptions import WebAuthnException
from webauthn.helpers.structs import (
    AuthenticatorSelectionCriteria,
    PublicKeyCredentialDescriptor,
    PublicKeyCredentialType,
    ResidentKeyRequirement,
    UserVerificationRequirement,
)

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

PASSKEY_RP_NAME = os.environ.get("SMARTCANTEEN_PASSKEY_RP_NAME", "SmartCanteen")
PASSKEY_CHALLENGE_TTL_SECONDS = 5 * 60


def _enum_value(value):
    return getattr(value, "value", value)


def _is_ip_hostname(hostname: str) -> bool:
    try:
        ipaddress.ip_address(hostname)
        return True
    except ValueError:
        return False


def _validate_passkey_origin(origin: str):
    parsed = urlparse(origin)
    hostname = (parsed.hostname or "").rstrip(".").lower()

    if not parsed.scheme or not hostname:
        raise HTTPException(status_code=400, detail="Unable to determine passkey origin")

    if hostname == "localhost":
        return

    if _is_ip_hostname(hostname):
        raise HTTPException(
            status_code=400,
            detail=(
                "Passkeys require a real HTTPS domain or localhost. "
                "Open SmartCanteen from https://smartcanteen.duckdns.org instead of an IP address."
            ),
        )

    if parsed.scheme != "https":
        raise HTTPException(
            status_code=400,
            detail="Passkeys require HTTPS in production or http://localhost for local development.",
        )


def _request_origin(req: Request) -> str:
    configured_origin = os.environ.get("SMARTCANTEEN_PASSKEY_ORIGIN")
    if configured_origin:
        return configured_origin.rstrip("/")

    for header_name in ("origin", "referer"):
        header_value = req.headers.get(header_name)
        if not header_value:
            continue
        parsed = urlparse(header_value)
        if parsed.scheme and parsed.netloc:
            return f"{parsed.scheme}://{parsed.netloc}".rstrip("/")

    forwarded_proto = (req.headers.get("x-forwarded-proto") or "").split(",", 1)[0].strip()
    forwarded_host = (req.headers.get("x-forwarded-host") or "").split(",", 1)[0].strip()
    scheme = forwarded_proto or req.url.scheme
    host = forwarded_host or req.headers.get("host") or req.url.netloc

    if not scheme or not host:
        raise HTTPException(status_code=400, detail="Unable to determine passkey origin")

    return f"{scheme}://{host}".rstrip("/")


def _rp_id_from_origin(origin: str) -> str:
    configured_rp_id = os.environ.get("SMARTCANTEEN_PASSKEY_RP_ID")
    hostname = urlparse(origin).hostname
    if not hostname:
        raise HTTPException(status_code=400, detail="Unable to determine passkey RP ID")

    hostname = hostname.rstrip(".").lower()

    if configured_rp_id:
        rp_id = configured_rp_id.strip().rstrip(".").lower()
        if hostname != rp_id and not hostname.endswith(f".{rp_id}"):
            raise HTTPException(
                status_code=400,
                detail="Passkey RP ID does not match the page domain.",
            )
        return rp_id

    return hostname


def _webauthn_context(req: Request) -> tuple[str, str]:
    origin = _request_origin(req)
    _validate_passkey_origin(origin)
    return origin, _rp_id_from_origin(origin)


def _active_passkeys(db: Session, user_id: int) -> List[models.UserPasskey]:
    return (
        db.query(models.UserPasskey)
        .filter(
            models.UserPasskey.user_id == user_id,
            models.UserPasskey.is_active == True,
        )
        .order_by(models.UserPasskey.created_at.asc())
        .all()
    )


def _user_payload(db: Session, user: models.User) -> dict:
    passkey_count = (
        db.query(models.UserPasskey)
        .filter(
            models.UserPasskey.user_id == user.id,
            models.UserPasskey.is_active == True,
        )
        .count()
    )

    return {
        "id": user.id,
        "username": user.username,
        "full_name": user.full_name,
        "role": user.role,
        "passkey_mfa_enabled": passkey_count > 0,
        "passkey_count": passkey_count,
    }


def _credential_descriptors(passkeys: List[models.UserPasskey]) -> List[PublicKeyCredentialDescriptor]:
    return [
        PublicKeyCredentialDescriptor(id=base64url_to_bytes(passkey.credential_id))
        for passkey in passkeys
    ]


def _store_webauthn_challenge(
    db: Session,
    *,
    user_id: int,
    purpose: str,
    challenge: bytes,
    rp_id: str,
    origin: str,
    token_id: Optional[str] = None,
) -> models.WebAuthnChallenge:
    record = models.WebAuthnChallenge(
        user_id=user_id,
        purpose=purpose,
        challenge=bytes_to_base64url(challenge),
        token_id=token_id,
        rp_id=rp_id,
        origin=origin,
        expires_at=datetime.utcnow() + timedelta(seconds=PASSKEY_CHALLENGE_TTL_SECONDS),
    )
    db.add(record)
    db.flush()
    return record


def _get_webauthn_challenge(
    db: Session,
    *,
    challenge_id: int,
    user_id: int,
    purpose: str,
    token_id: Optional[str] = None,
) -> models.WebAuthnChallenge:
    challenge = (
        db.query(models.WebAuthnChallenge)
        .filter(
            models.WebAuthnChallenge.id == challenge_id,
            models.WebAuthnChallenge.user_id == user_id,
            models.WebAuthnChallenge.purpose == purpose,
            models.WebAuthnChallenge.consumed_at.is_(None),
        )
        .first()
    )

    if not challenge or challenge.expires_at <= datetime.utcnow():
        raise HTTPException(status_code=400, detail="Passkey challenge expired. Try again.")

    if token_id and challenge.token_id != token_id:
        raise HTTPException(status_code=401, detail="Invalid passkey challenge")

    return challenge


def _build_login_success(db: Session, user: models.User):
    token = auth.create_access_token({"sub": user.username})
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": _user_payload(db, user),
    }


def _registration_options_for_user(db: Session, req: Request, user: models.User):
    origin, rp_id = _webauthn_context(req)
    options = generate_registration_options(
        rp_id=rp_id,
        rp_name=PASSKEY_RP_NAME,
        user_id=str(user.id).encode("utf-8"),
        user_name=user.username,
        user_display_name=user.full_name or user.username,
        exclude_credentials=_credential_descriptors(_active_passkeys(db, user.id)),
        authenticator_selection=AuthenticatorSelectionCriteria(
            resident_key=ResidentKeyRequirement.PREFERRED,
            user_verification=UserVerificationRequirement.REQUIRED,
        ),
    )
    return origin, rp_id, options


def _begin_passkey_login_registration(db: Session, req: Request, user: models.User):
    origin, rp_id, options = _registration_options_for_user(db, req, user)
    mfa_token, token_id = auth.create_mfa_token(user.username, purpose="passkey_registration")
    challenge = _store_webauthn_challenge(
        db,
        user_id=user.id,
        purpose="login_registration",
        challenge=options.challenge,
        rp_id=rp_id,
        origin=origin,
        token_id=token_id,
    )

    return {
        "passkey_registration_required": True,
        "mfa_type": "passkey_registration",
        "mfa_token": mfa_token,
        "passkey_options": options_to_json_dict(options),
        "passkey_challenge_id": challenge.id,
        "user": {
            "username": user.username,
            "full_name": user.full_name,
            "passkey_mfa_enabled": False,
        },
    }


def _begin_passkey_authentication(
    db: Session,
    req: Request,
    user: models.User,
    passkeys: List[models.UserPasskey],
):
    origin, rp_id = _webauthn_context(req)
    mfa_token, token_id = auth.create_mfa_token(user.username)
    options = generate_authentication_options(
        rp_id=rp_id,
        allow_credentials=_credential_descriptors(passkeys),
        user_verification=UserVerificationRequirement.REQUIRED,
    )
    challenge = _store_webauthn_challenge(
        db,
        user_id=user.id,
        purpose="authentication",
        challenge=options.challenge,
        rp_id=rp_id,
        origin=origin,
        token_id=token_id,
    )

    return {
        "mfa_required": True,
        "mfa_type": "passkey",
        "mfa_token": mfa_token,
        "passkey_options": options_to_json_dict(options),
        "passkey_challenge_id": challenge.id,
        "user": {
            "username": user.username,
            "full_name": user.full_name,
            "passkey_mfa_enabled": True,
        },
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

    passkeys = _active_passkeys(db, user.id)
    if passkeys:
        response = _begin_passkey_authentication(db, req, user, passkeys)
        _add_audit_log(
            db,
            user_id=user.id,
            action="LOGIN_MFA_REQUIRED",
            details="Password accepted; passkey MFA required",
            request=req,
        )
        db.commit()
        return response

    response = _begin_passkey_login_registration(db, req, user)
    _add_audit_log(
        db,
        user_id=user.id,
        action="LOGIN_PASSKEY_REGISTRATION_REQUIRED",
        details="Password accepted; passkey setup required before login",
        request=req,
    )
    db.commit()
    return response


@app.post("/auth/passkey/register/options", include_in_schema=False)
@app.post("/api/auth/passkey/register/options", tags=["Auth"])
def passkey_registration_options(
    req: Request,
    db: Session = Depends(get_db),
    current: models.User = Depends(auth.get_current_user),
):
    origin, rp_id, options = _registration_options_for_user(db, req, current)
    challenge = _store_webauthn_challenge(
        db,
        user_id=current.id,
        purpose="registration",
        challenge=options.challenge,
        rp_id=rp_id,
        origin=origin,
    )
    db.commit()

    return {
        "challenge_id": challenge.id,
        "passkey_options": options_to_json_dict(options),
    }


@app.post("/auth/passkey/register/verify", include_in_schema=False)
@app.post("/api/auth/passkey/register/verify", tags=["Auth"])
def passkey_registration_verify(
    data: schemas.PasskeyRegistrationFinishRequest,
    req: Request,
    db: Session = Depends(get_db),
    current: models.User = Depends(auth.get_current_user),
):
    challenge = _get_webauthn_challenge(
        db,
        challenge_id=data.challenge_id,
        user_id=current.id,
        purpose="registration",
    )

    try:
        verified = verify_registration_response(
            credential=data.credential,
            expected_challenge=base64url_to_bytes(challenge.challenge),
            expected_rp_id=challenge.rp_id,
            expected_origin=challenge.origin,
            require_user_verification=True,
        )
    except WebAuthnException as exc:
        _add_audit_log(
            db,
            user_id=current.id,
            action="PASSKEY_REGISTER_FAILED",
            details=str(exc),
            request=req,
        )
        challenge.consumed_at = datetime.utcnow()
        db.commit()
        raise HTTPException(status_code=400, detail="Passkey setup failed. Try again.") from exc

    credential_id = bytes_to_base64url(verified.credential_id)
    existing = (
        db.query(models.UserPasskey)
        .filter(models.UserPasskey.credential_id == credential_id)
        .first()
    )
    if existing:
        raise HTTPException(status_code=400, detail="This passkey is already registered")

    transports = data.credential.get("response", {}).get("transports")
    passkey = models.UserPasskey(
        user_id=current.id,
        credential_id=credential_id,
        public_key=bytes_to_base64url(verified.credential_public_key),
        sign_count=verified.sign_count,
        name=(data.name or "Passkey").strip()[:80],
        aaguid=verified.aaguid,
        transports=json.dumps(transports) if isinstance(transports, list) else None,
        device_type=_enum_value(verified.credential_device_type),
        backed_up=bool(verified.credential_backed_up),
    )
    db.add(passkey)
    challenge.consumed_at = datetime.utcnow()
    _add_audit_log(
        db,
        user_id=current.id,
        action="PASSKEY_REGISTERED",
        details=f"Passkey added: {passkey.name}",
        request=req,
    )
    db.commit()

    return {
        "message": "Passkey MFA enabled",
        "user": _user_payload(db, current),
    }


@app.post("/auth/passkey/login-register/verify", include_in_schema=False)
@app.post("/api/auth/passkey/login-register/verify", tags=["Auth"])
def passkey_login_registration_verify(
    data: schemas.PasskeyLoginRegistrationFinishRequest,
    req: Request,
    db: Session = Depends(get_db),
):
    token_payload = auth.decode_mfa_token(data.mfa_token, purpose="passkey_registration")
    user = db.query(models.User).filter(models.User.username == token_payload["sub"]).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="Invalid or expired MFA token")

    challenge = _get_webauthn_challenge(
        db,
        challenge_id=data.challenge_id,
        user_id=user.id,
        purpose="login_registration",
        token_id=token_payload["jti"],
    )

    try:
        verified = verify_registration_response(
            credential=data.credential,
            expected_challenge=base64url_to_bytes(challenge.challenge),
            expected_rp_id=challenge.rp_id,
            expected_origin=challenge.origin,
            require_user_verification=True,
        )
    except WebAuthnException as exc:
        _add_audit_log(
            db,
            user_id=user.id,
            action="PASSKEY_REGISTER_FAILED",
            details=str(exc),
            request=req,
        )
        challenge.consumed_at = datetime.utcnow()
        db.commit()
        raise HTTPException(status_code=400, detail="Passkey setup failed. Login was not completed.") from exc

    credential_id = bytes_to_base64url(verified.credential_id)
    existing = (
        db.query(models.UserPasskey)
        .filter(models.UserPasskey.credential_id == credential_id)
        .first()
    )
    if existing:
        raise HTTPException(status_code=400, detail="This passkey is already registered")

    transports = data.credential.get("response", {}).get("transports")
    passkey = models.UserPasskey(
        user_id=user.id,
        credential_id=credential_id,
        public_key=bytes_to_base64url(verified.credential_public_key),
        sign_count=verified.sign_count,
        name=(data.name or "SmartCanteen passkey").strip()[:80],
        aaguid=verified.aaguid,
        transports=json.dumps(transports) if isinstance(transports, list) else None,
        device_type=_enum_value(verified.credential_device_type),
        backed_up=bool(verified.credential_backed_up),
    )
    db.add(passkey)
    challenge.consumed_at = datetime.utcnow()
    _add_audit_log(
        db,
        user_id=user.id,
        action="PASSKEY_REGISTERED",
        details=f"Passkey added during login: {passkey.name}",
        request=req,
    )
    _add_audit_log(
        db,
        user_id=user.id,
        action="LOGIN",
        details="Successful login after passkey setup",
        request=req,
    )
    db.commit()

    return _build_login_success(db, user)


@app.post("/auth/passkey/authenticate/verify", include_in_schema=False)
@app.post("/api/auth/passkey/authenticate/verify", tags=["Auth"])
def passkey_authentication_verify(
    data: schemas.PasskeyAuthenticationFinishRequest,
    req: Request,
    db: Session = Depends(get_db),
):
    token_payload = auth.decode_mfa_token(data.mfa_token)
    user = db.query(models.User).filter(models.User.username == token_payload["sub"]).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="Invalid or expired MFA token")

    credential_id = data.credential.get("rawId") or data.credential.get("id")
    if not credential_id:
        raise HTTPException(status_code=400, detail="Passkey credential is missing")

    passkey = (
        db.query(models.UserPasskey)
        .filter(
            models.UserPasskey.user_id == user.id,
            models.UserPasskey.credential_id == credential_id,
            models.UserPasskey.is_active == True,
        )
        .first()
    )
    if not passkey:
        raise HTTPException(status_code=401, detail="Passkey is not registered for this account")

    challenge = _get_webauthn_challenge(
        db,
        challenge_id=data.challenge_id,
        user_id=user.id,
        purpose="authentication",
        token_id=token_payload["jti"],
    )

    try:
        verified = verify_authentication_response(
            credential=data.credential,
            expected_challenge=base64url_to_bytes(challenge.challenge),
            expected_rp_id=challenge.rp_id,
            expected_origin=challenge.origin,
            credential_public_key=base64url_to_bytes(passkey.public_key),
            credential_current_sign_count=passkey.sign_count or 0,
            require_user_verification=True,
        )
    except WebAuthnException as exc:
        _add_audit_log(
            db,
            user_id=user.id,
            action="LOGIN_MFA_FAILED",
            details=str(exc),
            request=req,
        )
        challenge.consumed_at = datetime.utcnow()
        db.commit()
        raise HTTPException(status_code=401, detail="Passkey verification failed") from exc

    if bytes_to_base64url(verified.credential_id) != passkey.credential_id:
        raise HTTPException(status_code=401, detail="Passkey verification failed")

    passkey.sign_count = verified.new_sign_count
    passkey.device_type = _enum_value(verified.credential_device_type)
    passkey.backed_up = bool(verified.credential_backed_up)
    passkey.last_used_at = datetime.utcnow()
    challenge.consumed_at = datetime.utcnow()
    _add_audit_log(
        db,
        user_id=user.id,
        action="LOGIN",
        details="Successful login with passkey MFA",
        request=req,
    )
    db.commit()

    return _build_login_success(db, user)


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


# ═══════════════════════════════════════════════════════════════════════════════
# PRODUCTS
# ═══════════════════════════════════════════════════════════════════════════════

ALERT_STATE_TYPES = {"low_stock", "high_demand"}
ALERT_STATES = {"read", "dismissed"}


def _normalize_alert_signature(value) -> str:
    return str(value or "").strip()[:240]


def _empty_alert_state_payload():
    return {
        "read": {"low_stock": [], "high_demand": []},
        "dismissed": {"low_stock": [], "high_demand": []},
    }


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
