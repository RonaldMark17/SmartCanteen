from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime


# ── Auth ───────────────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    username: str
    password: str
    remember_device_token: Optional[str] = None


class AuthenticatorAuthenticationFinishRequest(BaseModel):
    username: Optional[str] = None
    mfa_token: Optional[str] = None
    code: str
    remember_device: bool = False


class AuthenticatorResetRequest(BaseModel):
    revoke_remembered_devices: bool = True


# ── User ───────────────────────────────────────────────────────────────────────

class PasswordResetRequestCreate(BaseModel):
    identifier: Optional[str] = None
    usernameOrEmail: Optional[str] = None


class PasswordResetComplete(BaseModel):
    identifier: Optional[str] = None
    usernameOrEmail: Optional[str] = None
    new_password: str


class PasswordResetReviewUpdate(BaseModel):
    note: Optional[str] = None


class PasswordResetAppealCreate(BaseModel):
    identifier: Optional[str] = None
    usernameOrEmail: Optional[str] = None
    reason: Optional[str] = None
    appeal_reason: Optional[str] = None


class PasswordResetRequestResponse(BaseModel):
    id: int
    identifier: str
    username: Optional[str] = None
    full_name: Optional[str] = None
    role: Optional[str] = None
    is_active: Optional[bool] = None
    status: str
    requested_at: datetime
    reviewed_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None
    reviewer_username: Optional[str] = None
    review_note: Optional[str] = None
    appeal_reason: Optional[str] = None
    appealed_at: Optional[datetime] = None
    appeal_review_note: Optional[str] = None
    appeal_reviewed_at: Optional[datetime] = None


class PasswordResetStatusResponse(BaseModel):
    status: str
    message: str
    can_change_password: bool = False
    requested_at: Optional[datetime] = None
    reviewed_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None
    review_note: Optional[str] = None
    appeal_reason: Optional[str] = None
    appealed_at: Optional[datetime] = None
    appeal_review_note: Optional[str] = None
    appeal_reviewed_at: Optional[datetime] = None


class AuthenticatorRecoveryRequestCreate(BaseModel):
    identifier: Optional[str] = None
    usernameOrEmail: Optional[str] = None
    reason: Optional[str] = None


class AuthenticatorRecoveryStatusCheck(BaseModel):
    identifier: Optional[str] = None
    usernameOrEmail: Optional[str] = None


class AuthenticatorRecoveryAppealCreate(BaseModel):
    identifier: Optional[str] = None
    usernameOrEmail: Optional[str] = None
    reason: Optional[str] = None
    appeal_reason: Optional[str] = None


class AuthenticatorRecoverySetupStart(BaseModel):
    identifier: Optional[str] = None
    usernameOrEmail: Optional[str] = None


class AuthenticatorRecoveryRequestResponse(BaseModel):
    id: int
    identifier: str
    username: Optional[str] = None
    full_name: Optional[str] = None
    role: Optional[str] = None
    is_active: Optional[bool] = None
    reason: str
    status: str
    requested_at: datetime
    reviewed_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None
    reviewer_username: Optional[str] = None
    review_note: Optional[str] = None
    appeal_reason: Optional[str] = None
    appealed_at: Optional[datetime] = None
    appeal_review_note: Optional[str] = None
    appeal_reviewed_at: Optional[datetime] = None


class AuthenticatorRecoveryStatusResponse(BaseModel):
    status: str
    message: str
    can_recover_authenticator: bool = False
    reason: Optional[str] = None
    requested_at: Optional[datetime] = None
    reviewed_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None
    review_note: Optional[str] = None
    appeal_reason: Optional[str] = None
    appealed_at: Optional[datetime] = None
    appeal_review_note: Optional[str] = None
    appeal_reviewed_at: Optional[datetime] = None


class UserCreate(BaseModel):
    username:  str
    full_name: str
    password:  str
    role:      str = "cashier"

class UserUpdate(BaseModel):
    username:  Optional[str] = None
    full_name: Optional[str] = None
    password:  Optional[str] = None
    role:      Optional[str] = None
    is_active: Optional[bool] = None

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
    name:         str
    category:     str   = "General"
    price:        float
    stock:        float = 0.0
    min_stock:    float = 5.0
    unit_type:    str   = "pcs"
    base_unit:    str   = "pcs"
    is_favorite:  bool = False

class ProductUpdate(BaseModel):
    name:         Optional[str]   = None
    category:     Optional[str]   = None
    price:        Optional[float] = None
    stock:        Optional[float] = None
    min_stock:    Optional[float] = None
    unit_type:    Optional[str]   = None
    base_unit:    Optional[str]   = None
    is_favorite:  Optional[bool]  = None
    is_active:    Optional[bool]  = None

class ProductResponse(BaseModel):
    id:           int
    name:         str
    category:     str
    price:        float
    stock:        float
    min_stock:    float
    unit_type:    str = "pcs"
    base_unit:    str = "pcs"
    is_favorite:  bool = False
    is_active:    bool
    class Config:
        from_attributes = True


class QuickSaleProductResponse(ProductResponse):
    sales_last_30_days: float = 0.0
    orders_last_30_days: int = 0
    last_sold_at: Optional[datetime] = None


# ── Transaction ────────────────────────────────────────────────────────────────

class TransactionItemCreate(BaseModel):
    product_id: int
    quantity:   float
    unit_price: float
    sale_unit:  Optional[str] = None

class TransactionCreate(BaseModel):
    items:        List[TransactionItemCreate]
    discount:     float = 0.0
    payment_type: str   = "cash"
    notes:        Optional[str] = None

class TransactionItemResponse(BaseModel):
    product_id: int
    quantity:   float
    sale_quantity: Optional[float] = None
    sale_unit: Optional[str] = None
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


# Financial reports

class FinancialSchoolYearCreate(BaseModel):
    start_year: int
    end_year: Optional[int] = None
    set_active: bool = True


class FinancialReportUpdate(BaseModel):
    beginning_cash_on_hand: Optional[float] = Field(default=None, ge=0, allow_inf_nan=False)
    beginning_cash_manual_override: Optional[bool] = None
    current_sales: Optional[float] = Field(default=None, ge=0, allow_inf_nan=False)
    current_sales_manual_override: Optional[bool] = None
    other_income: Optional[float] = None
    purchases: Optional[float] = None
    inventory_used: Optional[float] = None
    product_cost: Optional[float] = None
    notes: Optional[str] = None


class FinancialExpenseInput(BaseModel):
    category: str
    amount: float = 0.0
    sort_order: int = 0


class FinancialExpensesUpdate(BaseModel):
    expenses: List[FinancialExpenseInput]


class FinancialAllocationInput(BaseModel):
    category_key: str
    label: str
    percentage: float
    opening_balance: float = 0.0
    sort_order: int = 0


class FinancialAllocationsUpdate(BaseModel):
    allocations: List[FinancialAllocationInput]


class FinancialFundMonitoringInput(BaseModel):
    category_key: str
    interest: float = 0.0
    expenses: float = 0.0
    others: float = 0.0
    cash_on_bank: float = 0.0


class FinancialFundMonitoringUpdate(BaseModel):
    entries: List[FinancialFundMonitoringInput]
