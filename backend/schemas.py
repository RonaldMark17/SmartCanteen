from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


# ── Auth ───────────────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    username: str
    password: str
    remember_device_token: Optional[str] = None


class AuthenticatorAuthenticationFinishRequest(BaseModel):
    mfa_token: str
    code: str
    remember_device: bool = False


class AuthenticatorResetRequest(BaseModel):
    revoke_remembered_devices: bool = True


# ── User ───────────────────────────────────────────────────────────────────────

class UserCreate(BaseModel):
    username:  str
    full_name: str
    password:  str
    role:      str = "cashier"

class UserResponse(BaseModel):
    id:         int
    username:   str
    full_name:  Optional[str]
    role:       str
    is_active:  bool
    authenticator_mfa_enabled: bool = False
    recovery_codes_remaining: int = 0
    remembered_devices_active: int = 0
    created_at: datetime
    class Config:
        from_attributes = True


# ── Product ────────────────────────────────────────────────────────────────────

class ProductCreate(BaseModel):
    name:      str
    category:  str   = "General"
    price:     float
    stock:     int   = 0
    min_stock: int   = 5
    barcode:   Optional[str] = None

class ProductUpdate(BaseModel):
    name:      Optional[str]   = None
    category:  Optional[str]   = None
    price:     Optional[float] = None
    stock:     Optional[int]   = None
    min_stock: Optional[int]   = None
    is_active: Optional[bool]  = None

class ProductResponse(BaseModel):
    id:        int
    name:      str
    category:  str
    price:     float
    stock:     int
    min_stock: int
    barcode:   Optional[str]
    is_active: bool
    class Config:
        from_attributes = True


# ── Transaction ────────────────────────────────────────────────────────────────

class TransactionItemCreate(BaseModel):
    product_id: int
    quantity:   int
    unit_price: float

class TransactionCreate(BaseModel):
    items:        List[TransactionItemCreate]
    discount:     float = 0.0
    payment_type: str   = "cash"
    notes:        Optional[str] = None

class TransactionItemResponse(BaseModel):
    product_id: int
    quantity:   int
    unit_price: float
    product:    Optional[ProductResponse] = None
    class Config:
        from_attributes = True

class TransactionResponse(BaseModel):
    id:           int
    total:        float
    discount:     float
    payment_type: str
    created_at:   datetime
    items:        List[TransactionItemResponse] = []
    class Config:
        from_attributes = True


# ── Offline sync ───────────────────────────────────────────────────────────────

class OfflineSyncRequest(BaseModel):
    transactions: List[dict]


# Alert notification state

class AlertStateUpdateRequest(BaseModel):
    alert_type: str
    state: str
    signatures: List[str]
