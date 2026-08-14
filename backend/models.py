from datetime import datetime, date
from typing import Optional, List
from sqlalchemy import (
    Integer, String, Float, Date, DateTime,
    Boolean, ForeignKey, Text, UniqueConstraint
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .database import Base
from .time_utils import utc_now_naive


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    username: Mapped[str] = mapped_column(String, unique=True, index=True, nullable=False)
    full_name: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    password_hash: Mapped[str] = mapped_column(String, nullable=False)
    role: Mapped[str] = mapped_column(String, default="cashier")   # admin | cashier | staff
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    authenticator_secret: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    authenticator_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    authenticator_last_counter: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    authenticator_failed_attempts: Mapped[int] = mapped_column(Integer, default=0)
    authenticator_locked_until: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now_naive)

    transactions: Mapped[List["Transaction"]] = relationship("Transaction", back_populates="user")
    audit_logs: Mapped[List["AuditLog"]] = relationship("AuditLog", back_populates="user")
    trusted_devices: Mapped[List["UserTrustedDevice"]] = relationship("UserTrustedDevice", back_populates="user",
                                   cascade="all, delete-orphan")
    recovery_codes: Mapped[List["UserRecoveryCode"]] = relationship("UserRecoveryCode", back_populates="user",
                                  cascade="all, delete-orphan")
    alert_states: Mapped[List["UserAlertState"]] = relationship("UserAlertState", back_populates="user",
                                cascade="all, delete-orphan")


class UserTrustedDevice(Base):
    __tablename__ = "user_trusted_devices"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    token_hash: Mapped[str] = mapped_column(String, unique=True, index=True, nullable=False)
    label: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now_naive)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    last_used_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    revoked_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    user: Mapped["User"] = relationship("User", back_populates="trusted_devices")


class UserRecoveryCode(Base):
    __tablename__ = "user_recovery_codes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    code_hash: Mapped[str] = mapped_column(String, unique=True, index=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now_naive)
    used_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, index=True)

    user: Mapped["User"] = relationship("User", back_populates="recovery_codes")


class UserAlertState(Base):
    __tablename__ = "user_alert_states"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    alert_type: Mapped[str] = mapped_column(String, nullable=False, index=True)
    signature: Mapped[str] = mapped_column(String, nullable=False, index=True)
    state: Mapped[str] = mapped_column(String, nullable=False, index=True)  # read | dismissed
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now_naive)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now_naive, onupdate=utc_now_naive)

    user: Mapped["User"] = relationship("User", back_populates="alert_states")


class SystemModuleSetting(Base):
    __tablename__ = "system_module_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    module_key: Mapped[str] = mapped_column(String, unique=True, index=True, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now_naive, onupdate=utc_now_naive)


class PasswordResetRequest(Base):
    __tablename__ = "password_reset_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    identifier: Mapped[str] = mapped_column(String, nullable=False)
    normalized_identifier: Mapped[str] = mapped_column(String, nullable=False, index=True)
    status: Mapped[str] = mapped_column(String, default="pending", index=True)  # pending | approved | declined | appealed | appeal_approved | appeal_declined | expired | used
    requested_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now_naive, index=True)
    reviewed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, index=True)
    reviewer_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    review_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    appeal_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    appealed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    appeal_review_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    appeal_reviewed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


class AuthenticatorRecoveryRequest(Base):
    __tablename__ = "authenticator_recovery_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    identifier: Mapped[str] = mapped_column(String, nullable=False)
    normalized_identifier: Mapped[str] = mapped_column(String, nullable=False, index=True)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String, default="pending", index=True)  # pending | approved | declined | appealed | appeal_approved | appeal_declined | expired | used
    requested_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now_naive, index=True)
    reviewed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, index=True)
    reviewer_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    review_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    appeal_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    appealed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    appeal_review_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    appeal_reviewed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


class Product(Base):
    __tablename__ = "products"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    category: Mapped[str] = mapped_column(String, default="General")
    price: Mapped[float] = mapped_column(Float, nullable=False)
    stock: Mapped[float] = mapped_column(Float, default=0.0)
    min_stock: Mapped[float] = mapped_column(Float, default=5.0)      # low-stock threshold
    unit_type: Mapped[str] = mapped_column(String, default="pcs")
    base_unit: Mapped[str] = mapped_column(String, default="pcs")
    barcode: Mapped[Optional[str]] = mapped_column(String, nullable=True, index=True)
    product_code: Mapped[Optional[str]] = mapped_column(String, nullable=True, index=True)
    is_favorite: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now_naive)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now_naive, onupdate=utc_now_naive)

    transaction_items: Mapped[List["TransactionItem"]] = relationship("TransactionItem", back_populates="product")


class Transaction(Base):
    __tablename__ = "transactions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    total: Mapped[float] = mapped_column(Float, nullable=False)
    discount: Mapped[float] = mapped_column(Float, default=0.0)
    payment_type: Mapped[str] = mapped_column(String, default="cash")   # cash
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now_naive)
    synced: Mapped[bool] = mapped_column(Boolean, default=True)   # False = came from offline queue

    user: Mapped[Optional["User"]] = relationship("User", back_populates="transactions")
    items: Mapped[List["TransactionItem"]] = relationship("TransactionItem", back_populates="transaction",
                         cascade="all, delete-orphan")


class TransactionItem(Base):
    __tablename__ = "transaction_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    transaction_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("transactions.id"), nullable=True)
    product_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("products.id"), nullable=True)
    quantity: Mapped[float] = mapped_column(Float, nullable=False)  # quantity in the product's base unit
    sale_quantity: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    sale_unit: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    unit_price: Mapped[float] = mapped_column(Float, nullable=False)  # price for one sale unit

    transaction: Mapped[Optional["Transaction"]] = relationship("Transaction", back_populates="items")
    product: Mapped[Optional["Product"]] = relationship("Product", back_populates="transaction_items")


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[Optional[int]] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    user_type: Mapped[Optional[str]] = mapped_column(String, nullable=True)   # admin | cashier | staff | system | anonymous
    action: Mapped[str] = mapped_column(String, nullable=False)   # LOGIN | PRODUCT_CREATED | …
    details: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    ip_address: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=utc_now_naive)

    user: Mapped[Optional["User"]] = relationship("User", back_populates="audit_logs")


class WeatherHistory(Base):
    __tablename__ = "weather_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    date: Mapped[date] = mapped_column(Date, unique=True, index=True, nullable=False)
    weather: Mapped[str] = mapped_column(String, nullable=False, default="clear")
    temperature_c: Mapped[float] = mapped_column(Float, nullable=False, default=30.0)
    humidity_pct: Mapped[float] = mapped_column(Float, nullable=False, default=70.0)
    rainfall_mm: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    source: Mapped[str] = mapped_column(String, nullable=False, default="bootstrap")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now_naive)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now_naive, onupdate=utc_now_naive)


class SchoolEventHistory(Base):
    __tablename__ = "school_event_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    date: Mapped[date] = mapped_column(Date, unique=True, index=True, nullable=False)
    event_type: Mapped[str] = mapped_column(String, nullable=False, default="none")
    label: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    is_school_day: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    source: Mapped[str] = mapped_column(String, nullable=False, default="bootstrap")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now_naive)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now_naive, onupdate=utc_now_naive)


class PredictionCache(Base):
    __tablename__ = "prediction_cache"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    request_key: Mapped[str] = mapped_column(String, unique=True, index=True, nullable=False)
    data_signature: Mapped[str] = mapped_column(Text, nullable=False)
    payload: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now_naive)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now_naive, onupdate=utc_now_naive)


class SchoolYear(Base):
    __tablename__ = "school_years"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String, unique=True, index=True, nullable=False)
    start_year: Mapped[int] = mapped_column(Integer, nullable=False)
    end_year: Mapped[int] = mapped_column(Integer, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now_naive)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now_naive, onupdate=utc_now_naive)

    monthly_reports: Mapped[List["MonthlyReport"]] = relationship(
        "MonthlyReport",
        back_populates="school_year",
        cascade="all, delete-orphan",
        order_by="MonthlyReport.month_index",
    )
    allocations: Mapped[List["Allocation"]] = relationship(
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

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    school_year_id: Mapped[int] = mapped_column(Integer, ForeignKey("school_years.id"), nullable=False, index=True)
    month_index: Mapped[int] = mapped_column(Integer, nullable=False)
    month_number: Mapped[int] = mapped_column(Integer, nullable=False)
    month_name: Mapped[str] = mapped_column(String, nullable=False)
    calendar_year: Mapped[int] = mapped_column(Integer, nullable=False)
    beginning_cash_on_hand: Mapped[float] = mapped_column(Float, default=0.0)
    beginning_cash_manual_override: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    current_sales: Mapped[float] = mapped_column(Float, default=0.0)
    current_sales_manual_override: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    other_income: Mapped[float] = mapped_column(Float, default=0.0)
    purchases: Mapped[float] = mapped_column(Float, default=0.0)
    inventory_used: Mapped[float] = mapped_column(Float, default=0.0)
    product_cost: Mapped[float] = mapped_column(Float, default=0.0)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now_naive)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now_naive, onupdate=utc_now_naive)

    school_year: Mapped["SchoolYear"] = relationship("SchoolYear", back_populates="monthly_reports")
    expenses: Mapped[List["Expense"]] = relationship(
        "Expense",
        back_populates="report",
        cascade="all, delete-orphan",
        order_by="Expense.sort_order",
    )
    fund_entries: Mapped[List["FundMonitoringEntry"]] = relationship(
        "FundMonitoringEntry",
        back_populates="report",
        cascade="all, delete-orphan",
        order_by="FundMonitoringEntry.category_key",
    )


class Expense(Base):
    __tablename__ = "expenses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    report_id: Mapped[int] = mapped_column(Integer, ForeignKey("monthly_reports.id"), nullable=False, index=True)
    category: Mapped[str] = mapped_column(String, nullable=False)
    amount: Mapped[float] = mapped_column(Float, default=0.0)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now_naive)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now_naive, onupdate=utc_now_naive)

    report: Mapped["MonthlyReport"] = relationship("MonthlyReport", back_populates="expenses")


class Allocation(Base):
    __tablename__ = "allocations"
    __table_args__ = (
        UniqueConstraint("school_year_id", "category_key", name="uq_allocations_school_year_category"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    school_year_id: Mapped[int] = mapped_column(Integer, ForeignKey("school_years.id"), nullable=False, index=True)
    category_key: Mapped[str] = mapped_column(String, nullable=False)
    label: Mapped[str] = mapped_column(String, nullable=False)
    percentage: Mapped[float] = mapped_column(Float, default=0.0)
    opening_balance: Mapped[float] = mapped_column(Float, default=0.0)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now_naive)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now_naive, onupdate=utc_now_naive)

    school_year: Mapped["SchoolYear"] = relationship("SchoolYear", back_populates="allocations")


class FundMonitoringEntry(Base):
    __tablename__ = "fund_monitoring_entries"
    __table_args__ = (
        UniqueConstraint("report_id", "category_key", name="uq_fund_monitoring_report_category"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    report_id: Mapped[int] = mapped_column(Integer, ForeignKey("monthly_reports.id"), nullable=False, index=True)
    category_key: Mapped[str] = mapped_column(String, nullable=False)
    interest: Mapped[float] = mapped_column(Float, default=0.0)
    expenses: Mapped[float] = mapped_column(Float, default=0.0)
    others: Mapped[float] = mapped_column(Float, default=0.0)
    cash_on_bank: Mapped[float] = mapped_column(Float, default=0.0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now_naive)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now_naive, onupdate=utc_now_naive)

    report: Mapped["MonthlyReport"] = relationship("MonthlyReport", back_populates="fund_entries")


class ExpenseReceipt(Base):
    __tablename__ = "expense_receipts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    filename: Mapped[str] = mapped_column(String, unique=True, index=True)
    original_name: Mapped[str] = mapped_column(String, index=True)
    normalized_name: Mapped[str] = mapped_column(String, index=True)
    mime_type: Mapped[str] = mapped_column(String, default="image/png")
    file_data_base64: Mapped[str] = mapped_column(Text, nullable=False)
    file_size: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now_naive)

