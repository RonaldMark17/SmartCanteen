"""
main.py  –  SmartCanteen  |  FastAPI Backend
─────────────────────────────────────────────────
Run:  uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
─────────────────────────────────────────────────
"""

from fastapi import BackgroundTasks, FastAPI, Depends, HTTPException, Request, Query, Response, WebSocket, WebSocketDisconnect
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
import os
import secrets
import struct
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


CASH_PAYMENT_TYPE = "cash"
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
AUTHENTICATOR_ISSUER = os.environ.get("SMARTCANTEEN_AUTHENTICATOR_ISSUER", "MEALS")
AUTHENTICATOR_PERIOD_SECONDS = 30
AUTHENTICATOR_DIGITS = 6
AUTHENTICATOR_WINDOW_STEPS = 1
RECOVERY_CODE_COUNT = 10
RECOVERY_CODE_GROUPS = 3
RECOVERY_CODE_GROUP_LENGTH = 4
RECOVERY_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def _normalize_transaction_payment_type(payment_type: Optional[str]) -> str:
    normalized = str(payment_type or CASH_PAYMENT_TYPE).strip().lower()
    if normalized != CASH_PAYMENT_TYPE:
        raise TransactionValidationError(
            "Only cash payment is allowed for canteen transactions"
        )

    return CASH_PAYMENT_TYPE


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


def _validate_user_password(password: str) -> str:
    raw_password = str(password or "")
    if len(raw_password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")
    return raw_password


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


def _effective_password_reset_status(reset_request: models.PasswordResetRequest) -> str:
    _expire_password_reset_request_if_needed(reset_request)
    return _normalize_password_reset_status(reset_request.status)


def _serialize_password_reset_status(reset_request: models.PasswordResetRequest) -> dict:
    status = _effective_password_reset_status(reset_request)
    return {
        "status": status,
        "message": PASSWORD_RESET_STATUS_MESSAGES.get(status, PASSWORD_RESET_STATUS_MESSAGES["none"]),
        "can_change_password": status in PASSWORD_RESET_APPROVED_STATUSES,
        "requested_at": reset_request.requested_at,
        "reviewed_at": reset_request.reviewed_at,
        "completed_at": reset_request.completed_at,
        "expires_at": reset_request.expires_at,
        "review_note": getattr(reset_request, "review_note", None),
        "appeal_reason": getattr(reset_request, "appeal_reason", None),
        "appealed_at": getattr(reset_request, "appealed_at", None),
        "appeal_review_note": getattr(reset_request, "appeal_review_note", None),
        "appeal_reviewed_at": getattr(reset_request, "appeal_reviewed_at", None),
    }


def _serialize_password_reset_account_notice(reset_request: models.PasswordResetRequest) -> dict:
    status = _effective_password_reset_status(reset_request)
    notice_time = (
        getattr(reset_request, "appeal_reviewed_at", None)
        or getattr(reset_request, "appealed_at", None)
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
        "review_note": getattr(reset_request, "review_note", None),
        "appeal_reason": getattr(reset_request, "appeal_reason", None),
        "appealed_at": getattr(reset_request, "appealed_at", None),
        "appeal_review_note": getattr(reset_request, "appeal_review_note", None),
        "appeal_reviewed_at": getattr(reset_request, "appeal_reviewed_at", None),
    }


def _serialize_password_reset_request(db: Session, reset_request: models.PasswordResetRequest) -> dict:
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
        "review_note": getattr(reset_request, "review_note", None),
        "appeal_reason": getattr(reset_request, "appeal_reason", None),
        "appealed_at": getattr(reset_request, "appealed_at", None),
        "appeal_review_note": getattr(reset_request, "appeal_review_note", None),
        "appeal_reviewed_at": getattr(reset_request, "appeal_reviewed_at", None),
    }


def _get_latest_password_reset_request_for_identifier(db: Session, identifier: str):
    normalized_identifier = _normalize_password_reset_identifier(identifier).lower()
    user = _find_user_by_reset_identifier(db, identifier)
    query = db.query(models.PasswordResetRequest)
    if user:
        query = query.filter(models.PasswordResetRequest.user_id == user.id)
    else:
        query = query.filter(models.PasswordResetRequest.normalized_identifier == normalized_identifier)

    return query.order_by(models.PasswordResetRequest.requested_at.desc()).first()


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
    recovery_request: models.AuthenticatorRecoveryRequest,
) -> dict:
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
        "review_note": getattr(recovery_request, "review_note", None),
        "appeal_reason": getattr(recovery_request, "appeal_reason", None),
        "appealed_at": getattr(recovery_request, "appealed_at", None),
        "appeal_review_note": getattr(recovery_request, "appeal_review_note", None),
        "appeal_reviewed_at": getattr(recovery_request, "appeal_reviewed_at", None),
    }


def _serialize_authenticator_recovery_account_notice(
    recovery_request: models.AuthenticatorRecoveryRequest,
) -> dict:
    status = _effective_authenticator_recovery_status(recovery_request)
    notice_time = (
        getattr(recovery_request, "appeal_reviewed_at", None)
        or getattr(recovery_request, "appealed_at", None)
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
        "review_note": getattr(recovery_request, "review_note", None),
        "appeal_reason": getattr(recovery_request, "appeal_reason", None),
        "appealed_at": getattr(recovery_request, "appealed_at", None),
        "appeal_review_note": getattr(recovery_request, "appeal_review_note", None),
        "appeal_reviewed_at": getattr(recovery_request, "appeal_reviewed_at", None),
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
        "review_note": getattr(recovery_request, "review_note", None),
        "appeal_reason": getattr(recovery_request, "appeal_reason", None),
        "appealed_at": getattr(recovery_request, "appealed_at", None),
        "appeal_review_note": getattr(recovery_request, "appeal_review_note", None),
        "appeal_reviewed_at": getattr(recovery_request, "appeal_reviewed_at", None),
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
    return query.order_by(models.AuthenticatorRecoveryRequest.requested_at.desc()).first()


def _get_authenticator_recovery_request_or_404(db: Session, request_id: int):
    recovery_request = (
        db.query(models.AuthenticatorRecoveryRequest)
        .filter(models.AuthenticatorRecoveryRequest.id == request_id)
        .first()
    )
    if not recovery_request:
        raise HTTPException(status_code=404, detail="Authenticator recovery request not found")
    return recovery_request


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
    label = f"{AUTHENTICATOR_ISSUER}:{user.username}"
    return (
        f"otpauth://totp/{quote(label)}"
        f"?secret={quote(secret)}"
        f"&issuer={quote(AUTHENTICATOR_ISSUER)}"
        f"&algorithm=SHA1"
        f"&digits={AUTHENTICATOR_DIGITS}"
        f"&period={AUTHENTICATOR_PERIOD_SECONDS}"
    )


def _normalize_recovery_code(code: str) -> str:
    return "".join(character for character in str(code or "").upper() if character.isalnum())


def _recovery_code_hash(code: str) -> str:
    normalized = _normalize_recovery_code(code)
    if not normalized:
        return ""
    return hmac.new(
        auth.SECRET_KEY.encode("utf-8"),
        f"recovery-code:{normalized}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def _generate_recovery_code() -> str:
    character_count = RECOVERY_CODE_GROUPS * RECOVERY_CODE_GROUP_LENGTH
    raw_code = "".join(secrets.choice(RECOVERY_CODE_ALPHABET) for _ in range(character_count))
    return "-".join(
        raw_code[index:index + RECOVERY_CODE_GROUP_LENGTH]
        for index in range(0, len(raw_code), RECOVERY_CODE_GROUP_LENGTH)
    )


def _replace_user_recovery_codes(db: Session, user: models.User) -> list[str]:
    db.query(models.UserRecoveryCode).filter(
        models.UserRecoveryCode.user_id == user.id
    ).delete(synchronize_session=False)

    codes = []
    code_hashes = set()
    while len(codes) < RECOVERY_CODE_COUNT:
        code = _generate_recovery_code()
        code_hash = _recovery_code_hash(code)
        if not code_hash or code_hash in code_hashes:
            continue
        code_hashes.add(code_hash)
        codes.append(code)
        db.add(models.UserRecoveryCode(user_id=user.id, code_hash=code_hash))
    return codes


def _build_authenticator_user_hint(user: models.User, enabled: bool) -> dict:
    return {
        "username": user.username,
        "full_name": user.full_name,
        "authenticator_mfa_enabled": enabled,
    }


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
    user_type: Optional[str] = None,
    request: Optional[Request] = None,
):
    resolved_user_type = user_type
    if not resolved_user_type:
        if user_id:
            user = db.query(models.User).filter(models.User.id == user_id).first()
            if user and user.role:
                resolved_user_type = user.role
            else:
                resolved_user_type = "user"
        else:
            resolved_user_type = "system"

    db.add(models.AuditLog(
        user_id=user_id,
        user_type=resolved_user_type,
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
    normalized_payment_type = _normalize_transaction_payment_type(payment_type)
    discount_value = float(discount or 0)
    subtotal = sum(item["quantity"] * item["unit_price"] for item in normalized_items)
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


def _ensure_password_reset_request_columns():
    try:
        with engine.begin() as connection:
            existing_columns = {
                row["name"]
                for row in connection.execute(text("PRAGMA table_info(password_reset_requests)")).mappings()
            }
            if "review_note" not in existing_columns:
                connection.execute(text("ALTER TABLE password_reset_requests ADD COLUMN review_note TEXT"))
            if "appeal_reason" not in existing_columns:
                connection.execute(text("ALTER TABLE password_reset_requests ADD COLUMN appeal_reason TEXT"))
            if "appealed_at" not in existing_columns:
                connection.execute(text("ALTER TABLE password_reset_requests ADD COLUMN appealed_at DATETIME"))
            if "appeal_review_note" not in existing_columns:
                connection.execute(text("ALTER TABLE password_reset_requests ADD COLUMN appeal_review_note TEXT"))
            if "appeal_reviewed_at" not in existing_columns:
                connection.execute(text("ALTER TABLE password_reset_requests ADD COLUMN appeal_reviewed_at DATETIME"))
            connection.execute(text(
                "UPDATE password_reset_requests SET status = 'declined' WHERE status = 'denied'"
            ))
            connection.execute(text(
                "UPDATE password_reset_requests SET status = 'used' WHERE status = 'completed'"
            ))
    except Exception:
        try:
            with engine.begin() as connection:
                try:
                    connection.execute(text("ALTER TABLE password_reset_requests ADD COLUMN review_note TEXT"))
                except Exception:
                    pass
                try:
                    connection.execute(text("ALTER TABLE password_reset_requests ADD COLUMN appeal_reason TEXT"))
                except Exception:
                    pass
                try:
                    connection.execute(text("ALTER TABLE password_reset_requests ADD COLUMN appealed_at DATETIME"))
                except Exception:
                    pass
                try:
                    connection.execute(text("ALTER TABLE password_reset_requests ADD COLUMN appeal_review_note TEXT"))
                except Exception:
                    pass
                try:
                    connection.execute(text("ALTER TABLE password_reset_requests ADD COLUMN appeal_reviewed_at DATETIME"))
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
    try:
        with engine.begin() as connection:
            existing_columns = {
                row["name"]
                for row in connection.execute(text("PRAGMA table_info(authenticator_recovery_requests)")).mappings()
            }
            if not existing_columns:
                return
            if "reason" not in existing_columns:
                connection.execute(text(
                    "ALTER TABLE authenticator_recovery_requests ADD COLUMN reason TEXT DEFAULT '' NOT NULL"
                ))
            if "review_note" not in existing_columns:
                connection.execute(text("ALTER TABLE authenticator_recovery_requests ADD COLUMN review_note TEXT"))
            if "appeal_reason" not in existing_columns:
                connection.execute(text("ALTER TABLE authenticator_recovery_requests ADD COLUMN appeal_reason TEXT"))
            if "appealed_at" not in existing_columns:
                connection.execute(text("ALTER TABLE authenticator_recovery_requests ADD COLUMN appealed_at DATETIME"))
            if "appeal_review_note" not in existing_columns:
                connection.execute(text("ALTER TABLE authenticator_recovery_requests ADD COLUMN appeal_review_note TEXT"))
            if "appeal_reviewed_at" not in existing_columns:
                connection.execute(text("ALTER TABLE authenticator_recovery_requests ADD COLUMN appeal_reviewed_at DATETIME"))
            connection.execute(text(
                "UPDATE authenticator_recovery_requests SET status = 'declined' WHERE status = 'denied'"
            ))
            connection.execute(text(
                "UPDATE authenticator_recovery_requests SET status = 'used' WHERE status = 'completed'"
            ))
    except Exception:
        try:
            with engine.begin() as connection:
                for statement in (
                    "ALTER TABLE authenticator_recovery_requests ADD COLUMN reason TEXT DEFAULT '' NOT NULL",
                    "ALTER TABLE authenticator_recovery_requests ADD COLUMN review_note TEXT",
                    "ALTER TABLE authenticator_recovery_requests ADD COLUMN appeal_reason TEXT",
                    "ALTER TABLE authenticator_recovery_requests ADD COLUMN appealed_at DATETIME",
                    "ALTER TABLE authenticator_recovery_requests ADD COLUMN appeal_review_note TEXT",
                    "ALTER TABLE authenticator_recovery_requests ADD COLUMN appeal_reviewed_at DATETIME",
                ):
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


_ensure_password_reset_request_columns()
_ensure_authenticator_recovery_request_columns()


app = FastAPI(
    title="MEALS",
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
    return {"message": "MEALS API is running. Visit /docs for Swagger UI."}


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


@app.post("/auth/authenticator/verify", include_in_schema=False)
@app.post("/api/auth/authenticator/verify", tags=["Auth"])
def authenticator_authentication_verify(
    data: schemas.AuthenticatorAuthenticationFinishRequest,
    req: Request,
    db: Session = Depends(get_db),
):
    token_payload = auth.decode_mfa_token(data.mfa_token, purpose="authenticator_setup")
    user = db.query(models.User).filter(models.User.username == token_payload["sub"]).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="Invalid or expired MFA token")

    secret = token_payload.get("totp_secret")
    if not secret:
        raise HTTPException(status_code=401, detail="Invalid or expired MFA token")

    recovery_request_id = token_payload.get("authenticator_recovery_request_id")
    recovery_request = None
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

    counter = _verify_authenticator_code(secret, data.code)
    now = datetime.utcnow()
    user.authenticator_secret = secret
    user.authenticator_enabled = True
    user.authenticator_last_counter = counter
    recovery_codes = _replace_user_recovery_codes(db, user)

    if recovery_request:
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

    _add_audit_log(
        db,
        user_id=user.id,
        action="LOGIN",
        details="Successful login after authenticator recovery setup",
        request=req,
    )
    db.commit()

    token = auth.create_access_token({"sub": user.username})
    return {
        "access_token": token,
        "token_type": "bearer",
        "authenticator_mfa_verified": True,
        "recovery_codes": recovery_codes,
        "recovery_codes_remaining": len(recovery_codes),
        "user": {
            "id": user.id,
            "username": user.username,
            "full_name": user.full_name,
            "role": user.role,
            "authenticator_mfa_enabled": True,
            "recovery_codes_remaining": len(recovery_codes),
            "remembered_devices_active": 0,
        },
    }


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

    if user and user.is_active:
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

        existing_status = _effective_authenticator_recovery_status(existing_request) if existing_request else None
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
    response_payload = {"message": PASSWORD_RESET_REQUEST_SENT_MESSAGE}

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
    if _expire_password_reset_request_if_needed(reset_request):
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

    password = _validate_user_password(data.new_password)
    user.password_hash = auth.get_password_hash(password)
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
    return {"message": "Password changed. Sign in with your new password."}


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


# ═══════════════════════════════════════════════════════════════════════════════
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

    today_txns   = db.query(models.Transaction).filter(
        models.Transaction.created_at.between(today_start, today_end)).all()
    all_txns     = db.query(models.Transaction).all()
    low_stock_ct = db.query(models.Product).filter(
        models.Product.is_active == True,
        models.Product.stock < models.Product.min_stock,
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
def seed(
    reset_demo: bool = Query(False, description="Rebuild the local canteen demo dataset."),
    db: Session = Depends(get_db),
):
    """Seed realistic SmartCanteen demo products, sales, weather, and school events."""
    return seed_demo_canteen_database(db, reset=reset_demo)


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
