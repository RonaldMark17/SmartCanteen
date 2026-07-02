from sqlalchemy import (
    Column, Integer, String, Float, Date, DateTime,
    Boolean, ForeignKey, Text, UniqueConstraint
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
    authenticator_secret = Column(String, nullable=True)
    authenticator_enabled = Column(Boolean, default=False)
    authenticator_last_counter = Column(Integer, nullable=True)
    created_at    = Column(DateTime, default=utc_now_naive)

    transactions = relationship("Transaction", back_populates="user")
    audit_logs   = relationship("AuditLog",   back_populates="user")
    trusted_devices = relationship("UserTrustedDevice", back_populates="user",
                                   cascade="all, delete-orphan")
    recovery_codes = relationship("UserRecoveryCode", back_populates="user",
                                  cascade="all, delete-orphan")
    alert_states = relationship("UserAlertState", back_populates="user",
                                cascade="all, delete-orphan")


class UserTrustedDevice(Base):
    __tablename__ = "user_trusted_devices"

    id           = Column(Integer, primary_key=True, index=True)
    user_id      = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    token_hash   = Column(String, unique=True, index=True, nullable=False)
    label        = Column(String, nullable=True)
    created_at   = Column(DateTime, default=utc_now_naive)
    expires_at   = Column(DateTime, nullable=False, index=True)
    last_used_at = Column(DateTime, nullable=True)
    revoked_at   = Column(DateTime, nullable=True)

    user = relationship("User", back_populates="trusted_devices")


class UserRecoveryCode(Base):
    __tablename__ = "user_recovery_codes"

    id         = Column(Integer, primary_key=True, index=True)
    user_id    = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    code_hash  = Column(String, unique=True, index=True, nullable=False)
    created_at = Column(DateTime, default=utc_now_naive)
    used_at    = Column(DateTime, nullable=True, index=True)

    user = relationship("User", back_populates="recovery_codes")


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


class PasswordResetRequest(Base):
    __tablename__ = "password_reset_requests"

    id                    = Column(Integer, primary_key=True, index=True)
    user_id               = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    identifier            = Column(String, nullable=False)
    normalized_identifier = Column(String, nullable=False, index=True)
    status                = Column(String, default="pending", index=True)  # pending | approved | denied | completed
    requested_at          = Column(DateTime, default=utc_now_naive, index=True)
    reviewed_at           = Column(DateTime, nullable=True)
    completed_at          = Column(DateTime, nullable=True)
    expires_at            = Column(DateTime, nullable=True, index=True)
    reviewer_id           = Column(Integer, ForeignKey("users.id"), nullable=True)


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


class SchoolYear(Base):
    __tablename__ = "school_years"

    id         = Column(Integer, primary_key=True, index=True)
    name       = Column(String, unique=True, index=True, nullable=False)
    start_year = Column(Integer, nullable=False)
    end_year   = Column(Integer, nullable=False)
    is_active  = Column(Boolean, default=True)
    created_at = Column(DateTime, default=utc_now_naive)
    updated_at = Column(DateTime, default=utc_now_naive, onupdate=utc_now_naive)

    monthly_reports = relationship(
        "MonthlyReport",
        back_populates="school_year",
        cascade="all, delete-orphan",
        order_by="MonthlyReport.month_index",
    )
    allocations = relationship(
        "Allocation",
        back_populates="school_year",
        cascade="all, delete-orphan",
        order_by="Allocation.sort_order",
    )


class MonthlyReport(Base):
    __tablename__ = "monthly_reports"
    __table_args__ = (
        UniqueConstraint("school_year_id", "month_index", name="uq_monthly_reports_school_year_month"),
    )

    id                     = Column(Integer, primary_key=True, index=True)
    school_year_id         = Column(Integer, ForeignKey("school_years.id"), nullable=False, index=True)
    month_index            = Column(Integer, nullable=False)
    month_number           = Column(Integer, nullable=False)
    month_name             = Column(String, nullable=False)
    calendar_year          = Column(Integer, nullable=False)
    beginning_cash_on_hand = Column(Float, default=0.0)
    current_sales          = Column(Float, default=0.0)
    other_income           = Column(Float, default=0.0)
    purchases              = Column(Float, default=0.0)
    inventory_used         = Column(Float, default=0.0)
    product_cost           = Column(Float, default=0.0)
    notes                  = Column(Text, nullable=True)
    created_at             = Column(DateTime, default=utc_now_naive)
    updated_at             = Column(DateTime, default=utc_now_naive, onupdate=utc_now_naive)

    school_year = relationship("SchoolYear", back_populates="monthly_reports")
    expenses = relationship(
        "Expense",
        back_populates="report",
        cascade="all, delete-orphan",
        order_by="Expense.sort_order",
    )
    fund_entries = relationship(
        "FundMonitoringEntry",
        back_populates="report",
        cascade="all, delete-orphan",
        order_by="FundMonitoringEntry.category_key",
    )


class Expense(Base):
    __tablename__ = "expenses"

    id         = Column(Integer, primary_key=True, index=True)
    report_id   = Column(Integer, ForeignKey("monthly_reports.id"), nullable=False, index=True)
    category    = Column(String, nullable=False)
    amount      = Column(Float, default=0.0)
    sort_order  = Column(Integer, default=0)
    created_at  = Column(DateTime, default=utc_now_naive)
    updated_at  = Column(DateTime, default=utc_now_naive, onupdate=utc_now_naive)

    report = relationship("MonthlyReport", back_populates="expenses")


class Allocation(Base):
    __tablename__ = "allocations"
    __table_args__ = (
        UniqueConstraint("school_year_id", "category_key", name="uq_allocations_school_year_category"),
    )

    id            = Column(Integer, primary_key=True, index=True)
    school_year_id = Column(Integer, ForeignKey("school_years.id"), nullable=False, index=True)
    category_key   = Column(String, nullable=False)
    label          = Column(String, nullable=False)
    percentage     = Column(Float, default=0.0)
    opening_balance = Column(Float, default=0.0)
    sort_order     = Column(Integer, default=0)
    created_at     = Column(DateTime, default=utc_now_naive)
    updated_at     = Column(DateTime, default=utc_now_naive, onupdate=utc_now_naive)

    school_year = relationship("SchoolYear", back_populates="allocations")


class FundMonitoringEntry(Base):
    __tablename__ = "fund_monitoring_entries"
    __table_args__ = (
        UniqueConstraint("report_id", "category_key", name="uq_fund_monitoring_report_category"),
    )

    id           = Column(Integer, primary_key=True, index=True)
    report_id    = Column(Integer, ForeignKey("monthly_reports.id"), nullable=False, index=True)
    category_key = Column(String, nullable=False)
    interest     = Column(Float, default=0.0)
    expenses     = Column(Float, default=0.0)
    others       = Column(Float, default=0.0)
    cash_on_bank = Column(Float, default=0.0)
    created_at   = Column(DateTime, default=utc_now_naive)
    updated_at   = Column(DateTime, default=utc_now_naive, onupdate=utc_now_naive)

    report = relationship("MonthlyReport", back_populates="fund_entries")
