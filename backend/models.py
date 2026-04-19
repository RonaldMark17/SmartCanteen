from sqlalchemy import (
    Column, Integer, String, Float, Date, DateTime,
    Boolean, ForeignKey, Text
)
from sqlalchemy.orm import relationship
from .database import Base
from .time_utils import utc_now_naive


class User(Base):
    __tablename__ = "users"

    id            = Column(Integer, primary_key=True, index=True)
    username      = Column(String, unique=True, index=True, nullable=False)
    full_name     = Column(String, nullable=True)
    password_hash = Column(String, nullable=False)
    role          = Column(String, default="cashier")   # admin | cashier | staff
    is_active     = Column(Boolean, default=True)
    created_at    = Column(DateTime, default=utc_now_naive)

    transactions = relationship("Transaction", back_populates="user")
    audit_logs   = relationship("AuditLog",   back_populates="user")
    passkeys     = relationship("UserPasskey", back_populates="user",
                                cascade="all, delete-orphan")
    alert_states = relationship("UserAlertState", back_populates="user",
                                cascade="all, delete-orphan")


class UserPasskey(Base):
    __tablename__ = "user_passkeys"

    id              = Column(Integer, primary_key=True, index=True)
    user_id         = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    credential_id   = Column(String, unique=True, index=True, nullable=False)
    public_key      = Column(Text, nullable=False)
    sign_count      = Column(Integer, default=0)
    name            = Column(String, nullable=True)
    aaguid          = Column(String, nullable=True)
    transports      = Column(Text, nullable=True)
    device_type     = Column(String, nullable=True)
    backed_up       = Column(Boolean, default=False)
    is_active       = Column(Boolean, default=True)
    created_at      = Column(DateTime, default=utc_now_naive)
    updated_at      = Column(DateTime, default=utc_now_naive, onupdate=utc_now_naive)
    last_used_at    = Column(DateTime, nullable=True)

    user = relationship("User", back_populates="passkeys")


class WebAuthnChallenge(Base):
    __tablename__ = "webauthn_challenges"

    id          = Column(Integer, primary_key=True, index=True)
    user_id     = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    purpose     = Column(String, nullable=False, index=True)
    challenge   = Column(String, nullable=False, index=True)
    token_id    = Column(String, nullable=True, index=True)
    rp_id       = Column(String, nullable=False)
    origin      = Column(String, nullable=False)
    expires_at  = Column(DateTime, nullable=False)
    consumed_at = Column(DateTime, nullable=True)
    created_at  = Column(DateTime, default=utc_now_naive)


class UserAlertState(Base):
    __tablename__ = "user_alert_states"

    id         = Column(Integer, primary_key=True, index=True)
    user_id    = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    alert_type = Column(String, nullable=False, index=True)
    signature  = Column(String, nullable=False, index=True)
    state      = Column(String, nullable=False, index=True)  # read | dismissed
    created_at = Column(DateTime, default=utc_now_naive)
    updated_at = Column(DateTime, default=utc_now_naive, onupdate=utc_now_naive)

    user = relationship("User", back_populates="alert_states")


class Product(Base):
    __tablename__ = "products"

    id         = Column(Integer, primary_key=True, index=True)
    name       = Column(String, nullable=False)
    category   = Column(String, default="General")
    price      = Column(Float, nullable=False)
    stock      = Column(Integer, default=0)
    min_stock  = Column(Integer, default=5)      # low-stock threshold
    barcode    = Column(String, unique=True, nullable=True)
    is_active  = Column(Boolean, default=True)
    created_at = Column(DateTime, default=utc_now_naive)
    updated_at = Column(DateTime, default=utc_now_naive, onupdate=utc_now_naive)

    transaction_items = relationship("TransactionItem", back_populates="product")


class Transaction(Base):
    __tablename__ = "transactions"

    id           = Column(Integer, primary_key=True, index=True)
    user_id      = Column(Integer, ForeignKey("users.id"))
    total        = Column(Float, nullable=False)
    discount     = Column(Float, default=0.0)
    payment_type = Column(String, default="cash")   # cash | gcash
    notes        = Column(Text, nullable=True)
    created_at   = Column(DateTime, default=utc_now_naive)
    synced       = Column(Boolean, default=True)   # False = came from offline queue

    user  = relationship("User",            back_populates="transactions")
    items = relationship("TransactionItem", back_populates="transaction",
                         cascade="all, delete-orphan")


class TransactionItem(Base):
    __tablename__ = "transaction_items"

    id             = Column(Integer, primary_key=True, index=True)
    transaction_id = Column(Integer, ForeignKey("transactions.id"))
    product_id     = Column(Integer, ForeignKey("products.id"))
    quantity       = Column(Integer, nullable=False)
    unit_price     = Column(Float,   nullable=False)

    transaction = relationship("Transaction", back_populates="items")
    product     = relationship("Product",     back_populates="transaction_items")


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id         = Column(Integer, primary_key=True, index=True)
    user_id    = Column(Integer, ForeignKey("users.id"), nullable=True)
    action     = Column(String, nullable=False)   # LOGIN | PRODUCT_CREATED | …
    details    = Column(Text,   nullable=True)
    ip_address = Column(String, nullable=True)
    timestamp  = Column(DateTime, default=utc_now_naive)

    user = relationship("User", back_populates="audit_logs")


class WeatherHistory(Base):
    __tablename__ = "weather_history"

    id            = Column(Integer, primary_key=True, index=True)
    date          = Column(Date, unique=True, index=True, nullable=False)
    weather       = Column(String, nullable=False, default="clear")
    temperature_c = Column(Float, nullable=False, default=30.0)
    humidity_pct  = Column(Float, nullable=False, default=70.0)
    rainfall_mm   = Column(Float, nullable=False, default=0.0)
    source        = Column(String, nullable=False, default="bootstrap")
    created_at    = Column(DateTime, default=utc_now_naive)
    updated_at    = Column(DateTime, default=utc_now_naive, onupdate=utc_now_naive)


class SchoolEventHistory(Base):
    __tablename__ = "school_event_history"

    id            = Column(Integer, primary_key=True, index=True)
    date          = Column(Date, unique=True, index=True, nullable=False)
    event_type    = Column(String, nullable=False, default="none")
    label         = Column(String, nullable=True)
    is_school_day = Column(Boolean, nullable=False, default=True)
    source        = Column(String, nullable=False, default="bootstrap")
    created_at    = Column(DateTime, default=utc_now_naive)
    updated_at    = Column(DateTime, default=utc_now_naive, onupdate=utc_now_naive)


class PredictionCache(Base):
    __tablename__ = "prediction_cache"

    id             = Column(Integer, primary_key=True, index=True)
    request_key    = Column(String, unique=True, index=True, nullable=False)
    data_signature = Column(Text, nullable=False)
    payload        = Column(Text, nullable=False)
    created_at     = Column(DateTime, default=utc_now_naive)
    updated_at     = Column(DateTime, default=utc_now_naive, onupdate=utc_now_naive)
