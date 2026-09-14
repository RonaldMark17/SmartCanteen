from datetime import datetime, timedelta, timezone
from typing import Optional
import uuid

import bcrypt
from jose import JWTError, jwt
from fastapi import Depends, HTTPException, Request, Response
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from .database import get_db
from . import models

import os

# ── Config ─────────────────────────────────────────────────────────────────────
# ⚠️  Change JWT_SECRET_KEY in production environment!
SECRET_KEY  = os.getenv("JWT_SECRET_KEY", "smartcanteen-secret-key-CHANGE-THIS-in-prod-2024!")
ALGORITHM   = "HS256"
EXPIRE_MINS = 480   # 8-hour sessions (canteen shift length)
MFA_EXPIRE_MINS = 5
BACKGROUND_ALERT_EXPIRE_DAYS = 30

AUTH_COOKIE_NAME = "sc_token"
TRUSTED_DEVICE_COOKIE_NAME = "sc_trusted_device"

security = HTTPBearer(auto_error=False)


# ── Helpers ────────────────────────────────────────────────────────────────────

def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except ValueError:
        return False

def get_password_hash(password: str) -> str:
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(password.encode("utf-8"), salt).decode("utf-8")

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    payload = data.copy()
    expire  = datetime.now(timezone.utc) + (expires_delta or timedelta(minutes=EXPIRE_MINS))
    payload.update({"exp": expire})
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def create_background_alert_token(username: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(days=BACKGROUND_ALERT_EXPIRE_DAYS)
    payload = {
        "sub": username,
        "purpose": "background_alert",
        "exp": expire,
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_background_alert_token(token: str) -> dict:
    exc = HTTPException(status_code=401, detail="Invalid or expired background alert token")
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        raise exc

    if payload.get("purpose") != "background_alert" or not payload.get("sub"):
        raise exc

    return payload


def create_mfa_token(username: str, purpose: str = "authenticator", extra: Optional[dict] = None) -> tuple[str, str]:
    token_id = uuid.uuid4().hex
    expire = datetime.now(timezone.utc) + timedelta(minutes=MFA_EXPIRE_MINS)
    payload = {
        "sub": username,
        "jti": token_id,
        "mfa": True,
        "purpose": purpose,
        "exp": expire,
    }
    if extra:
        payload.update(extra)
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM), token_id


def decode_mfa_token(token: str, purpose: str = "authenticator") -> dict:
    exc = HTTPException(status_code=401, detail="Invalid or expired MFA token")
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        raise exc

    if not payload.get("mfa") or payload.get("purpose") != purpose:
        raise exc

    if not payload.get("sub") or not payload.get("jti"):
        raise exc

    return payload


def _is_request_secure(request: Optional[Request]) -> bool:
    if not request:
        return False
    forwarded_proto = request.headers.get("x-forwarded-proto", "").lower()
    return request.url.scheme == "https" or forwarded_proto == "https"


def set_auth_cookie(
    response: Response,
    token: str,
    request: Optional[Request] = None,
    max_age: int = EXPIRE_MINS * 60,
) -> None:
    """Sets HttpOnly, Secure, SameSite session cookie containing JWT."""
    is_secure = _is_request_secure(request)
    response.set_cookie(
        key=AUTH_COOKIE_NAME,
        value=token,
        max_age=max_age,
        expires=max_age,
        path="/",
        httponly=True,
        secure=is_secure,
        samesite="lax",
    )


def set_trusted_device_cookie(
    response: Response,
    device_token: str,
    request: Optional[Request] = None,
    max_age: int = 30 * 86400,
) -> None:
    """Sets HttpOnly, Secure, SameSite cookie for trusted 2FA device bypass."""
    is_secure = _is_request_secure(request)
    response.set_cookie(
        key=TRUSTED_DEVICE_COOKIE_NAME,
        value=device_token,
        max_age=max_age,
        expires=max_age,
        path="/",
        httponly=True,
        secure=is_secure,
        samesite="lax",
    )


def clear_auth_cookies(response: Response) -> None:
    """Clears authentication and trusted device cookies on logout."""
    response.delete_cookie(key=AUTH_COOKIE_NAME, path="/")
    response.delete_cookie(key=TRUSTED_DEVICE_COOKIE_NAME, path="/")


# ── Dependencies ───────────────────────────────────────────────────────────────

def get_current_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: Session = Depends(get_db),
) -> models.User:
    """Validates JWT from HttpOnly cookie or Authorization Bearer header and returns the authenticated user."""
    token = None
    if request and request.cookies.get(AUTH_COOKIE_NAME):
        token = request.cookies.get(AUTH_COOKIE_NAME)
    elif credentials and credentials.credentials:
        token = credentials.credentials

    if not token:
        raise HTTPException(status_code=401, detail="Authentication credentials were not provided")

    exc = HTTPException(status_code=401, detail="Invalid or expired token")
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        if payload.get("purpose") == "background_alert":
            raise exc
        username = payload.get("sub")
        uid = payload.get("uid")
        if not username and not uid:
            raise exc
    except JWTError:
        raise exc

    user = None
    if username:
        user = db.query(models.User).filter(models.User.username == username).first()
    if not user and uid:
        user = db.query(models.User).filter(models.User.id == uid).first()

    if not user or not user.is_active:
        raise exc
    return user


def require_admin(current_user: models.User = Depends(get_current_user)) -> models.User:
    """Raises 403 if the caller is not an admin."""
    if (current_user.role or "").strip().lower() not in {"admin", "administrator"}:
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user


def require_staff_or_admin(current_user: models.User = Depends(get_current_user)) -> models.User:
    """Raises 403 if the caller is neither admin nor staff."""
    if (current_user.role or "").strip().lower() not in {"admin", "administrator", "staff"}:
        raise HTTPException(status_code=403, detail="Staff or admin access required")
    return current_user



def get_user_from_token(token: str, db: Session) -> Optional[models.User]:
    """Validates a JWT token string and returns the active user if valid."""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        if payload.get("purpose") == "background_alert":
            return None
        username = payload.get("sub")
        uid = payload.get("uid")
        if not username and not uid:
            return None
        user = None
        if username:
            user = db.query(models.User).filter(models.User.username == username).first()
        if not user and uid:
            user = db.query(models.User).filter(models.User.id == uid).first()
        if not user or not user.is_active:
            return None
        return user
    except Exception:
        return None
