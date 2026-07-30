from datetime import datetime, timedelta
from typing import Optional
import uuid

import bcrypt
from jose import JWTError, jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from .database import get_db
from . import models

# ── Config ─────────────────────────────────────────────────────────────────────
# ⚠️  Change SECRET_KEY to a random 32-char string in production!
SECRET_KEY  = "smartcanteen-secret-key-CHANGE-THIS-in-prod-2024!"
ALGORITHM   = "HS256"
EXPIRE_MINS = 480   # 8-hour sessions (canteen shift length)
MFA_EXPIRE_MINS = 5
BACKGROUND_ALERT_EXPIRE_DAYS = 30

security    = HTTPBearer()


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
    expire  = datetime.utcnow() + (expires_delta or timedelta(minutes=EXPIRE_MINS))
    payload.update({"exp": expire})
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def create_background_alert_token(username: str) -> str:
    expire = datetime.utcnow() + timedelta(days=BACKGROUND_ALERT_EXPIRE_DAYS)
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
    expire = datetime.utcnow() + timedelta(minutes=MFA_EXPIRE_MINS)
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


# ── Dependencies ───────────────────────────────────────────────────────────────

def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db)
) -> models.User:
    """Validates JWT and returns the authenticated user."""
    exc = HTTPException(status_code=401, detail="Invalid or expired token")
    try:
        payload  = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM])
        if payload.get("purpose") == "background_alert":
            raise exc
        username = payload.get("sub")
        if not username:
            raise exc
    except JWTError:
        raise exc

    user = db.query(models.User).filter(models.User.username == username).first()
    if not user or not user.is_active:
        raise exc
    return user


def require_admin(current_user: models.User = Depends(get_current_user)) -> models.User:
    """Raises 403 if the caller is not an admin."""
    if str(current_user.role or "").strip().lower() not in {"admin", "administrator"}:
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user
