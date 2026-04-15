from sqlalchemy import (
    Column, Integer, String, Float, DateTime,
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
