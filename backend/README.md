# 🍽️ MEALS Backend — Canteen Management & Financial Reporting Core

[![FastAPI](https://img.shields.io/badge/FastAPI-0.115.12-009688.svg?style=flat&logo=FastAPI&logoColor=white)](https://fastapi.tiangolo.com)
[![Python](https://img.shields.io/badge/Python-3.10%20%7C%203.11%20%7C%203.12-3776AB.svg?style=flat&logo=Python&logoColor=white)](https://www.python.org/)
[![SQLAlchemy](https://img.shields.io/badge/SQLAlchemy-2.0.49-D71F00.svg?style=flat&logo=SQLAlchemy&logoColor=white)](https://www.sqlalchemy.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Ready-336791.svg?style=flat&logo=PostgreSQL&logoColor=white)](https://www.postgresql.org/)
[![SQLite](https://img.shields.io/badge/SQLite-Supported-003B57.svg?style=flat&logo=SQLite&logoColor=white)](https://www.sqlite.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**MEALS Backend** is the high-performance, asynchronous core powering the **MEALS Smart Canteen Ecosystem**. Designed specifically for school canteens and institutional food services, the system provides multi-unit inventory tracking, automated DepEd-compliant financial statement computations, live Excel workbook generation (`.xlsx`), real-time WebSocket alerts, and robust multi-factor authentication (TOTP).

---

## 📑 Table of Contents

- [Key Features](#-key-features)
- [System Architecture](#-system-architecture)
- [Tech Stack](#-tech-stack)
- [Project Directory Structure](#-project-directory-structure)
- [Prerequisites](#-prerequisites)
- [Installation & Environment Setup](#-installation--environment-setup)
- [Configuration & Environment Variables](#-configuration--environment-variables)
- [Running the Server](#-running-the-server)
- [Database Seeding & Demo Data](#-database-seeding--demo-data)
- [API Documentation & Key Endpoints](#-api-documentation--key-endpoints)
- [Role-Based Access Control (RBAC) & Default Users](#-role-based-access-control-rbac--default-users)
- [Financial Reporting & DepEd Excel Generation](#-financial-reporting--deped-excel-generation)
- [Troubleshooting](#-troubleshooting)
- [License & Maintainer](#-license--maintainer)

---

## ✨ Key Features

### 1. 📊 DepEd-Compliant Financial Reporting & Excel Export
- **School Year & Monthly Cycles**: Multi-year management with month-by-month financial accounting.
- **DepEd Canteen Fund Framework**: Computes Gross Sales, Cost of Goods Sold, Beginning/Ending Inventory balances, Operating Expenses, and Net Operating Income.
- **Mandatory Allocation Tracking**: Manages DepEd standard canteen fund percentages (Supplementary Feeding 35%, Revolving/Operational Fund 25%, School Clinic 5%, Administrative Fund 20%, Faculty & Student Development 15%).
- **Excel Spreadsheet Automation**: Injects live calculations into standard official workbook templates (`.xlsx`) while preserving formatting, formulas, cell styles, and institutional logos.
- **Expense Receipt Storage**: Upload and manage expense attachments encoded with base64 storage and MIME typing.

### 2. 📦 Multi-Unit Inventory & Stock Management
- **Piece & Bulk Unit System**: Supports discrete items (`pcs`) and continuous bulk measures (`kg`, `g`, `l`, `ml`) with automatic unit conversions.
- **Stock Tracking & Thresholds**: Real-time stock adjustments with configurable `min_stock` low-stock threshold alerts.
- **Product Catalog**: Manage product categories, base units, barcodes, and cost/retail pricing.

### 3. 🔐 Security, TOTP MFA & Account Recovery
- **JWT Authentication**: Secure Bearer tokens with configurable expiration sessions.
- **Time-based MFA (TOTP)**: Google Authenticator-compatible two-factor authentication with QR code provisioning and 30-day trusted device memory.
- **Dual Recovery Mechanisms**: One-time backup recovery codes and administrative recovery/password reset review queues with formal appeal support.
- **Comprehensive Audit Trail**: Automatically logs user actions, security modifications, IP addresses, and module changes.

### 4. ⚡ Real-Time WebSockets & Timezone Alignment
- **Real-Time Alert WebSocket**: Active broadcast channel (`/api/realtime/alerts`) notifying staff of stock dips and system events.
- **Philippine Standard Time Awareness**: Built-in time normalization for `Asia/Manila` (PST/UTC+8) ensuring strict date alignment across daily reporting bounds.

---

## 🏛 System Architecture

```mermaid
graph TD
    Client["Client Applications<br/>(Desktop / Web Management)"]

    subgraph "MEALS FastAPI Backend"
        Router["API Gateway / FastAPI Router"]
        AuthMiddleware["JWT & TOTP Auth Guard"]
        WebSocketHub["Realtime WebSocket Manager"]
        
        subgraph "Core Services"
            InventoryService["Inventory & Unit Converter"]
            ReportEngine["DepEd Financial & Excel Generator"]
            AnalyticsService["Sales Analytics & Summary Engine"]
            AuditService["Audit Logger & Reset Queue"]
        end

        DatabaseLayer["SQLAlchemy ORM (SQLite / PostgreSQL)"]
    end

    subgraph "External & Storage"
        Database[(Canteen Database)]
        ExcelTemplate[("Excel Templates & Logos")]
    end

    Client <-->|REST API / HTTPS| Router
    Client <-->|Live Events / WSS| WebSocketHub
    Router --> AuthMiddleware
    AuthMiddleware --> InventoryService
    AuthMiddleware --> ReportEngine
    AuthMiddleware --> AnalyticsService
    AuthMiddleware --> AuditService

    InventoryService --> DatabaseLayer
    ReportEngine --> DatabaseLayer
    ReportEngine --> ExcelTemplate
    AnalyticsService --> DatabaseLayer
    AuditService --> DatabaseLayer

    DatabaseLayer <--> Database
```

---

## 🛠 Tech Stack

| Component | Technology | Version | Purpose |
| :--- | :--- | :--- | :--- |
| **Web Framework** | [FastAPI](https://fastapi.tiangolo.com/) | `0.115.12` | High-performance asynchronous REST API |
| **ASGI Server** | [Uvicorn](https://www.uvicorn.org/) | `0.29.0` | High-performance ASGI production server |
| **Data Validation** | [Pydantic](https://docs.pydantic.dev/) | `2.10.6` | Schema validation and serialization |
| **ORM / Database** | [SQLAlchemy](https://www.sqlalchemy.org/) | `2.0.49` | Database abstraction (SQLite & PostgreSQL) |
| **PostgreSQL Driver**| [psycopg](https://www.psycopg.org/) | `3.2.6` | High-performance PostgreSQL connector |
| **Data Processing** | [Pandas](https://pandas.pydata.org/) & [NumPy](https://numpy.org/) | `2.2.2` / `1.26.4` | Historical data transformations & summaries |
| **Spreadsheet Engine**| [OpenPyXL](https://openpyxl.readthedocs.io/) | `3.1.5` | Excel report rendering and formula processing |
| **Image Processing** | [Pillow](https://python-pillow.org/) | `>=10.0.0` | Image handling and logo embedding |
| **Auth & Security** | [python-jose](https://github.com/mpdavis/python-jose) / [bcrypt](https://github.com/pyca/bcrypt) | `3.3.0` / `4.1.3` | JWT token decoding, hashing, TOTP MFA |

---

## 📂 Project Directory Structure

```text
backend/
├── auth.py                          # JWT auth, TOTP verification, password hashing & dependencies
├── analytics_helpers.py             # Sales summaries, top products, and category aggregations
├── database.py                      # SQLAlchemy database engine, session factory & connection resolver
├── demo_data.py                     # Canteen baseline demo datasets & seeder
├── financial_reports.py             # DepEd financial statements, monthly calculations & Excel generator
├── main.py                          # Main FastAPI application, routing, WebSockets & startup hooks
├── models.py                        # SQLAlchemy declarative data models
├── report_templates/                # Official Excel report template & logo assets
│   ├── CANTEEN-REPORT-2025-2026-2 (1).xlsx
│   └── deped_logo.jpg
├── requirements.txt                 # Python dependency specifications
├── schemas.py                       # Pydantic request and response schemas
├── seed_historical_canteen_data.py  # Historical transaction simulation script
├── time_utils.py                    # Philippine timezone (Asia/Manila) utilities & parsing
└── uploads/                         # Temporary/cached uploads directory
```

---

## 📦 Prerequisites

Ensure you have the following installed on your system:
- **Python 3.10, 3.11, or 3.12**
- **pip** (Python package installer)
- **Git**
- *(Optional)* **PostgreSQL 14+** (if deploying to PostgreSQL instead of SQLite)

---

## 🚀 Installation & Environment Setup

### 1. Create and Activate a Virtual Environment

**Windows (PowerShell):**
```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
```

**macOS / Linux (Bash):**
```bash
python3 -m venv venv
source venv/bin/activate
```

### 2. Install Dependencies
```bash
pip install --upgrade pip
pip install -r backend/requirements.txt
```

---

## ⚙️ Configuration & Environment Variables

The backend automatically creates and utilizes a local SQLite database (`canteen.db`) by default. For production or custom setups, configure the following environment variables:

| Variable | Default Value | Description |
| :--- | :--- | :--- |
| `DATABASE_URL` | `sqlite:///./canteen.db` | Primary database connection string (SQLite or PostgreSQL) |
| `POSTGRES_URL` | *None* | Fallback PostgreSQL connection string if `DATABASE_URL` is omitted |
| `JWT_SECRET_KEY` | `smartcanteen-secret-key-...` | Secret key for signing authentication tokens (**Change in Production!**) |
| `SMARTCANTEEN_HOST` | `0.0.0.0` | Server bind IP address |
| `SMARTCANTEEN_PORT` | `8000` | Server bind port |
| `PORT` | `8000` | Alternative port environment variable (e.g. for Render/Railway/Heroku) |

> [!IMPORTANT]
> Always provide a secure, unique `JWT_SECRET_KEY` when running in a production environment:
> ```bash
> export JWT_SECRET_KEY="your-super-secure-random-secret-key-here"
> ```

---

## 🏃 Running the Server

### Option A: From Repository Root
```bash
python app.py
```

### Option B: Direct Python Execution from `backend/`
```bash
cd backend
python main.py
```

### Option C: Uvicorn ASGI Server (Recommended for Development)
From the repository root:
```bash
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```
Or from the `backend/` directory:
```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Once running, interactive documentation is available at:
- **Swagger UI**: [http://localhost:8000/docs](http://localhost:8000/docs)
- **ReDoc**: [http://localhost:8000/redoc](http://localhost:8000/redoc)
- **Health Check**: [http://localhost:8000/api/health](http://localhost:8000/api/health)

---

## 🌾 Database Seeding & Demo Data

The backend includes two methods for populating initial data:

### Method 1: Instant Quick Demo Seed (via API)
Populates demo users, product catalog, sample categories, and baseline inventory:
- Authenticate as an admin and send a POST request to `/api/seed`, or trigger it via Swagger UI.

### Method 2: Multi-Year Historical Simulation (CLI)
Generates realistic canteen transaction histories for reporting:
```bash
python backend/seed_historical_canteen_data.py --database canteen.db --start-date 2023-01-01 --end-date 2026-04-18
```

---

## 👥 Role-Based Access Control (RBAC) & Default Users

When seeded, the following default accounts are initialized:

| Username | Password | Role | Permissions & Access Scope |
| :--- | :--- | :--- | :--- |
| **`admin`** | `admin123` | `admin` | Full system access: User management, module switches, DepEd financial reports, audit logs, and inventory management. |
| **`staff`** | `staff123` | `staff` | Inventory access: Stock updates, low-stock restock alerts, and report viewing. |

---

## 📡 API Documentation & Key Endpoints

### 🔑 Authentication (`/api/auth`)
- `POST /api/auth/login` — Authenticate username & password; returns JWT or prompts MFA requirement.
- `POST /api/auth/authenticator/verify` — Validate TOTP 6-digit code or backup recovery code.
- `POST /api/auth/recovery-codes/regenerate` — Generate new set of TOTP recovery backup codes.
- `GET /api/auth/me` — Retrieve profile of currently authenticated user.
- `POST /api/auth/password-reset/request` — Submit administrative password reset request.
- `POST /api/auth/password-reset/appeal` — Appeal a declined password reset request.
- `POST /api/auth/password-reset/complete` — Finalize approved password reset.
- `POST /api/auth/authenticator-recovery/request` — Request admin approval to reset lost TOTP device.

### 👥 Admin & User Management (`/api/admin`)
- `GET /api/admin/users` — List all registered user accounts.
- `POST /api/admin/users` — Create new canteen staff or admin user.
- `PUT /api/admin/users/{user_id}` — Update user profile, password, or role.
- `DELETE /api/admin/users/{user_id}` — Deactivate or remove user.
- `POST /api/admin/users/{user_id}/authenticator/reset` — Admin override to clear MFA.
- `GET /api/admin/password-reset-requests` — Manage pending password reset requests.
- `GET /api/admin/authenticator-recovery-requests` — Manage pending MFA reset requests.

### 📦 Products & Inventory (`/api/products`)
- `GET /api/products` — Retrieve all active products with stock levels and units.
- `POST /api/products` — Create new product with category, unit type, base unit, barcode, and min stock threshold.
- `PUT /api/products/{pid}` — Update product pricing, stock count, barcode, or favorite status.
- `DELETE /api/products/{pid}` — Archive or delete product.
- `GET /api/products/low-stock` — Fetch products currently below threshold.

### 📈 Analytics (`/api/analytics`)
- `GET /api/analytics/summary` — Overview of revenue, transaction counts, and sales metrics.
- `GET /api/analytics/daily-sales` — Trend breakdown over specified date ranges.
- `GET /api/analytics/top-products` — Most popular items by quantity and revenue.
- `GET /api/analytics/category-sales` — Revenue share across categories.

### 📑 DepEd Financial Reports (`/api/financial-reports`)
- `GET /api/financial-reports/school-years` — List recorded school years.
- `POST /api/financial-reports/school-years` — Register new academic year.
- `GET /api/financial-reports/school-years/{id}` — Full 12-month financial matrix for the school year.
- `PUT /api/financial-reports/reports/{id}` — Update monthly statement figures & overrides.
- `PUT /api/financial-reports/reports/{id}/expenses` — Record itemized monthly operational expenses.
- `PUT /api/financial-reports/reports/{id}/fund-monitoring` — Record bank balances, interest, and clinic/feeding disbursements.
- `PUT /api/financial-reports/school-years/{id}/allocations` — Configure statutory percentage splits.
- `GET /api/financial-reports/school-years/{id}/export` — Download generated DepEd Excel Workbook (`.xlsx`).
- `POST /api/financial-reports/receipts/upload` — Attach expense vouchers and receipt images.

### 🔔 Alerts & System (`/api/alerts`, `/api/settings`, `/api/health`)
- `WS /api/realtime/alerts` — WebSocket stream for instant system-wide notifications.
- `GET /api/alert-state` & `POST /api/alert-state` — Sync user alert dismissal states.
- `GET /api/settings/modules` & `PUT /api/settings/modules` — Toggle feature modules dynamically.
- `GET /api/audit-logs` — Query timestamped administrative audit logs.
- `GET /api/health` — System uptime and health verification.

---

## 📑 Financial Reporting & DepEd Excel Generation

The financial engine (`financial_reports.py`) models the standard **Department of Education (DepEd) School Canteen Operations Framework**:

1. **Gross Sales Calculation**: Consolidated from recorded transactions.
2. **Cost of Sales**: Computed via starting stock + purchases − ending stock.
3. **Gross Income**: $\text{Gross Sales} - \text{Cost of Goods Sold}$.
4. **Operating Expenses**: Itemized utility bills, transportation, salaries, and canteen supplies.
5. **Net Income**: Distributed according to statutory school board allocations:
   - Supplementary Feeding Program (35%)
   - School Clinic Fund (5%)
   - Faculty & Student Development (15%)
   - Canteen Revolving / Maintenance Fund (25%)
   - Administrative Operations (20%)

The export feature merges this data into the official template (`report_templates/CANTEEN-REPORT-2025-2026-2 (1).xlsx`), ensuring all formula relationships and visual layouts remain 100% compliant.

---

## 🔧 Troubleshooting

### 1. Database Locked (SQLite)
- *Cause*: Concurrent threads writing simultaneously.
- *Solution*: `database.py` enables `check_same_thread: False` and WAL mode. For higher concurrency, switch to PostgreSQL by setting `DATABASE_URL=postgresql://user:password@localhost:5432/meals_db`.

### 2. Timezone Discrepancies in Analytics
- *Cause*: Server running in UTC while school operates in Philippine Standard Time.
- *Solution*: All date aggregations strictly utilize `backend.time_utils` to compute Manila boundaries (`Asia/Manila` / UTC+8).

### 3. Missing Template Error on Export
- Ensure `report_templates/CANTEEN-REPORT-2025-2026-2 (1).xlsx` exists in the backend directory.

---

## 📄 License & Maintainer

Distributed under the **MIT License**.

Developed and maintained by **Ronald Mark** ([@RonaldMark17](https://github.com/RonaldMark17)).  
*MEALS — Modern, Efficient, Automated, Learning-driven Smart Canteen Backend.*
