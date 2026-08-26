# 🍽️ MEALS Backend — Smart Canteen Management & Intelligence System

[![FastAPI](https://img.shields.io/badge/FastAPI-0.115.12-009688.svg?style=flat&logo=FastAPI&logoColor=white)](https://fastapi.tiangolo.com)
[![Python](https://img.shields.io/badge/Python-3.10%20%7C%203.11%20%7C%203.12-3776AB.svg?style=flat&logo=Python&logoColor=white)](https://www.python.org/)
[![SQLAlchemy](https://img.shields.io/badge/SQLAlchemy-2.0.49-D71F00.svg?style=flat&logo=SQLAlchemy&logoColor=white)](https://www.sqlalchemy.org/)
[![XGBoost](https://img.shields.io/badge/XGBoost-1.7.6-EB5424.svg?style=flat&logo=XGBoost&logoColor=white)](https://xgboost.readthedocs.io/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Ready-336791.svg?style=flat&logo=PostgreSQL&logoColor=white)](https://www.postgresql.org/)
[![SQLite](https://img.shields.io/badge/SQLite-Supported-003B57.svg?style=flat&logo=SQLite&logoColor=white)](https://www.sqlite.org/)

**MEALS Backend** is the high-performance, intelligent core powering the **MEALS Smart Canteen Ecosystem**. Designed specifically for school canteens and institutional food services, the system integrates Point of Sale (POS), multi-unit inventory tracking, AI/ML-driven daily demand forecasting, automated DepEd-compliant financial statements & Excel exports, real-time WebSocket alerts, and robust multi-factor authentication (TOTP).

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
- [Machine Learning Demand Predictor](#-machine-learning-demand-predictor)
- [Financial Reporting & DepEd Excel Generation](#-financial-reporting--deped-excel-generation)
- [Offline Transaction Sync & Real-Time Alerts](#-offline-transaction-sync--real-time-alerts)
- [Troubleshooting](#-troubleshooting)

---

## ✨ Key Features

### 1. 🛒 Point of Sale (POS) & Multi-Unit Inventory
- **Rapid POS Checkout**: Handles high-volume canteen cashier transactions with automatic cash/change calculation and discount handling.
- **Piece & Bulk Unit System**: Supports discrete items (`pcs`) and continuous bulk items (`kg`, `g`, `l`, `ml`) with automatic unit conversions.
- **Stock Tracking & Thresholds**: Real-time stock deduction on transaction commits with configurable `min_stock` low-stock threshold alerts.
- **Product Favorites & Quick Sale**: Pin popular canteen items for expedited cashier workflows.

### 2. 🤖 AI/ML Demand Forecasting & Smart Restock Alerts
- **XGBoost Predictive Engine**: Trains and predicts next-day canteen sales demand by product and category.
- **Context-Aware Features**: Factors in calendar day-of-week, weather forecasts (temperature, precipitation, humidity), and school events (regular, half-day, exam weeks, intramurals, holidays).
- **Intelligent Restocking**: Compares predicted consumption against current stock levels to deliver actionable restock warnings.
- **Inference Caching**: High-throughput cached prediction payloads with signature validation.

### 3. 📊 DepEd-Compliant Financial Reporting & Excel Export
- **School Year & Monthly Cycles**: Multi-year management with month-by-month financial tracking.
- **DepEd Canteen Fund Monitoring**: Automatically computes Gross Sales, Cost of Goods Sold, Beginning Cash on Hand, Operating Expenses, and Net Operating Income.
- **Mandatory Allocation Tracking**: Manages DepEd standard canteen fund percentages (e.g., Supplementary Feeding 35%, Revolving Fund/Operational 25%, School Clinic 5%, Administrative Fund 5%, etc.).
- **Excel Spreadsheet Automation**: Injects live calculations into standard official workbook templates (`.xlsx`) while preserving formatting, formulas, cell styles, and institutional logos.
- **Expense Receipt Storage**: Upload and manage expense attachments encoded with base64 storage and MIME typing.

### 4. 🔐 Security, TOTP MFA & Account Recovery
- **JWT Authentication**: Secure Bearer tokens with 8-hour shift sessions and 30-day background alert tokens.
- **Time-based MFA (TOTP)**: Google Authenticator-compatible two-factor authentication with QR code provisioning and 30-day trusted device memory.
- **Dual Recovery Mechanisms**: One-time backup recovery codes and administrative recovery/password reset review queues with formal appeal support.
- **Comprehensive Audit Trail**: Automatically logs user actions, security modifications, IP addresses, and module changes.

### 5. ⚡ Offline Sync & Real-Time WebSockets
- **Offline Transaction Sync**: Cashiers can continue operating during network drops. Offline queues sync seamlessly via `/api/transactions/sync` with idempotency and duplicate deduplication.
- **Real-Time Alert WebSocket**: Active broadcast channel (`/api/realtime/alerts`) notifying staff of stock dips, system events, and cashier activities.
- **Philippine Standard Time Awareness**: Built-in time normalization for `Asia/Manila` (PST/UTC+8) ensuring strict date alignment across daily reporting bounds.

---

## 🏛 System Architecture

```mermaid
graph TD
    Client["Client Applications<br/>(Desktop POS / Web / Mobile)"]

    subgraph "MEALS FastAPI Backend"
        Router["API Gateway / FastAPI Router"]
        AuthMiddleware["JWT & TOTP Auth Guard"]
        WebSocketHub["Realtime WebSocket Manager"]
        
        subgraph "Core Services"
            PosService["POS & Transaction Engine"]
            InventoryService["Inventory & Unit Converter"]
            MLPredictor["XGBoost Demand Predictor"]
            ReportEngine["DepEd Financial & Excel Generator"]
            SyncService["Offline Sync & Audit Logger"]
        end

        DatabaseLayer["SQLAlchemy ORM (SQLite / PostgreSQL)"]
    end

    subgraph "External & Storage"
        Database[(Canteen Database)]
        ExcelTemplate[("Excel Templates & Logos")]
        WeatherAPI["Weather Services"]
    end

    Client <-->|REST API / HTTPS| Router
    Client <-->|Live Events / WSS| WebSocketHub
    Router --> AuthMiddleware
    AuthMiddleware --> PosService
    AuthMiddleware --> InventoryService
    AuthMiddleware --> MLPredictor
    AuthMiddleware --> ReportEngine
    AuthMiddleware --> SyncService

    PosService --> DatabaseLayer
    InventoryService --> DatabaseLayer
    MLPredictor --> DatabaseLayer
    ReportEngine --> DatabaseLayer
    ReportEngine --> ExcelTemplate
    SyncService --> DatabaseLayer
    MLPredictor -.-> WeatherAPI

    DatabaseLayer <--> Database
```

---

## 🛠 Tech Stack

| Component | Technology | Version | Purpose |
| :--- | :--- | :--- | :--- |
| **Web Framework** | [FastAPI](https://fastapi.tiangolo.com/) | `0.115.12` | High-performance asynchronous REST API |
| **ASGI Server** | [Uvicorn](https://www.uvicorn.org/) | `0.29.0` | Lightning-fast ASGI production server |
| **Data Validation** | [Pydantic](https://docs.pydantic.dev/) | `2.10.6` | Schema validation and serialization |
| **ORM / Database** | [SQLAlchemy](https://www.sqlalchemy.org/) | `2.0.49` | Database abstraction (SQLite & PostgreSQL) |
| **PostgreSQL Driver**| [psycopg](https://www.psycopg.org/) | `3.2.6` | High-performance PostgreSQL connector |
| **Machine Learning** | [XGBoost](https://xgboost.readthedocs.io/) | `1.7.6` | Gradient boosted trees demand predictor |
| **ML Utilities** | [scikit-learn](https://scikit-learn.org/) | `1.5.2` | Metric evaluation & regression tools |
| **Data Analysis** | [Pandas](https://pandas.pydata.org/) & [NumPy](https://numpy.org/) | `2.2.2` / `1.26.4` | Historical data transformations |
| **Spreadsheet Engine**| [OpenPyXL](https://openpyxl.readthedocs.io/) | `3.1.5` | Excel report rendering and formula processing |
| **Image Processing** | [Pillow](https://python-pillow.org/) | `>=10.0.0` | Image handling and logo embedding |
| **Auth & Security** | [python-jose](https://github.com/mpdavis/python-jose) / [bcrypt](https://github.com/pyca/bcrypt) | `3.3.0` / `4.1.3` | JWT token decoding, hashing, TOTP |

---

## 📂 Project Directory Structure

```text
MEALS_backend/
├── auth.py                          # JWT auth, TOTP verification, password hashing & dependencies
├── analytics_helpers.py             # Sales summaries, top products, category & hourly aggregations
├── database.py                      # SQLAlchemy database engine, session factory & connection resolver
├── demo_data.py                     # Realistic canteen baseline demo datasets & seeder
├── financial_reports.py             # DepEd financial statements, monthly calculations & Excel generator
├── main.py                          # Main FastAPI application, routing, WebSockets & startup hooks
├── ml_predictor.py                  # XGBoost model training, weather/calendar feature engineering
├── ml_predictor_result.py           # ML prediction result structures
├── models.py                        # SQLAlchemy declarative data models
├── report_templates/                # Official Excel report template & logo assets
│   ├── CANTEEN-REPORT-2025-2026-2 (1).xlsx
│   └── deped_logo.jpg
├── requirements.txt                 # Python dependency specifications
├── schemas.py                       # Pydantic request and response schemas
├── seed_historical_canteen_data.py  # Multi-year historical transaction & weather simulation script
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

### 1. Clone the Repository
```bash
git clone https://github.com/RonaldMark17/MEALS_backend.git
cd MEALS_backend
```

### 2. Create and Activate a Virtual Environment

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

### 3. Install Dependencies
```bash
pip install --upgrade pip
pip install -r requirements.txt
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

### Option A: Direct Python Execution
```bash
python main.py
```

### Option B: Uvicorn ASGI Server (Recommended for Development)
From the repository directory:
```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```
Or from the parent directory:
```bash
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

Once running, the interactive documentation is available at:
- **Swagger UI**: [http://localhost:8000/docs](http://localhost:8000/docs)
- **ReDoc**: [http://localhost:8000/redoc](http://localhost:8000/redoc)
- **Health Check**: [http://localhost:8000/api/health](http://localhost:8000/api/health)

---

## 🌾 Database Seeding & Demo Data

The backend includes two methods for populating initial data:

### Method 1: Instant Quick Demo Seed (via API)
Populates demo users, product catalog, sample categories, and baseline inventory:
- Authenticate as an admin and send a POST request to `/api/seed`, or trigger it via Swagger UI.

### Method 2: Comprehensive Multi-Year Historical Simulation (CLI)
Generates 3+ years of realistic school transactions, recess/lunch traffic patterns, holiday calendars, and weather records:
```bash
python seed_historical_canteen_data.py --database canteen.db --start-date 2023-01-01 --end-date 2026-04-18
```

---

## 👥 Role-Based Access Control (RBAC) & Default Users

When seeded, the following default accounts are initialized:

| Username | Password | Role | Permissions & Access Scope |
| :--- | :--- | :--- | :--- |
| **`admin`** | `admin123` | `admin` | Full system access: User management, module switches, financial reports, audit logs, inventory, POS, and ML forecasts. |
| **`cashier`** | `cashier123` | `cashier` | Operational access: Point of Sale, offline transaction sync, product search, daily sales view. |
| **`staff`** | `staff123` | `staff` | Inventory & Kitchen access: Stock updates, low-stock restock alerts, report viewing. |

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
- `POST /api/admin/users` — Create new canteen staff/cashier/admin user.
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

### 💳 Transactions & Point of Sale (`/api/transactions`)
- `POST /api/transactions` — Process new POS sale (cash payment, line items, stock deduction).
- `GET /api/transactions` — Query transaction history with pagination and date filters.
- `POST /api/transactions/sync` — Bulk upload offline transactions with conflict resolution.

### 📈 Analytics (`/api/analytics`)
- `GET /api/analytics/summary` — Overview of revenue, transaction counts, and average order value.
- `GET /api/analytics/daily-sales` — Trend breakdown over specified date ranges.
- `GET /api/analytics/top-products` — Most popular items by quantity and revenue.
- `GET /api/analytics/category-sales` — Revenue share across categories (Staples, Viands, Snacks, Drinks).
- `GET /api/analytics/hourly-heatmap` — Cashier traffic distribution across operating hours.

### 🧠 AI / ML Demand Predictions (`/api/predictions`)
- `GET /api/predictions/tomorrow` — AI-projected item-by-item sales forecast for tomorrow.
- `GET /api/predictions/restock-alerts` — Intelligent restock suggestions based on projected demand vs current stock.

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
- `GET /api/audit-logs` — Query timestamped administrative and cashier audit logs.
- `GET /api/health` — System uptime and health verification.

---

## 🧠 Machine Learning Demand Predictor

The predictive module (`ml_predictor.py`) implements an **XGBoost Regressor** fine-tuned for high accuracy on canteen inventory turnover:

```text
┌─────────────────────────┐     ┌────────────────────────┐
│  Historical Sales Data  │     │ Weather API / Forecast │
└───────────┬─────────────┘     └───────────┬────────────┘
            │                               │
            ▼                               ▼
┌────────────────────────────────────────────────────────┐
│             Feature Engineering Pipeline               │
│  - Day of Week (Mon-Fri school weighting)              │
│  - Event Modifier (Exams, Half-day, Intrams, Holiday)  │
│  - Weather Modifiers (Rainfall, Temp, Humidity)        │
│  - Lagged Moving Averages & Trend Momentum             │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
               ┌────────────────────────┐
               │   XGBoost Regressor    │
               └────────────┬───────────┘
                            │
            ┌───────────────┴───────────────┐
            ▼                               ▼
┌────────────────────────┐     ┌────────────────────────┐
│ Tomorrow Demand Volume │     │ Restock Action Alerts  │
└────────────────────────┘     └────────────────────────┘
```

---

## 📑 Financial Reporting & DepEd Excel Generation

The financial engine (`financial_reports.py`) models the standard **Department of Education (DepEd) School Canteen Operations Framework**:

1. **Gross Sales Calculation**: Consolidated from completed POS cash transactions.
2. **Cost of Sales**: Computed via starting stock + purchases − ending stock.
3. **Gross Income**: $\text{Gross Sales} - \text{Cost of Goods Sold}$.
4. **Operating Expenses**: Itemized utility bills, transportation, salaries, and kitchen supplies.
5. **Net Income**: Distributed according to statutory school board allocations:
   - Supplementary Feeding Program (35%)
   - School Clinic Fund (5%)
   - Faculty & Student Development (15%)
   - Canteen Revolving / Maintenance Fund (25%)
   - Administrative Operations (20%)

The export feature merges this data into the official template (`report_templates/CANTEEN-REPORT-2025-2026-2 (1).xlsx`), ensuring all formula relationships and visual layouts remain 100% compliant.

---

## 🔄 Offline Transaction Sync & Real-Time Alerts

1. **Offline Queuing**: When internet connectivity is lost, the frontend/desktop client saves transactions locally.
2. **Idempotent Batch Sync**: When reconnected, the client posts all queued orders to `/api/transactions/sync`. The backend verifies duplicates using unique timestamps and client IDs, deducts stock, and records transactions smoothly.
3. **Live WebSocket Broadcast**: Any stock reduction below `min_stock` instantly pushes an alert payload across the `/api/realtime/alerts` WebSocket to all connected staff terminals.

---

## 🔧 Troubleshooting

### 1. Database Locked (SQLite)
- *Cause*: Concurrent threads writing simultaneously.
- *Solution*: `database.py` enables `check_same_thread: False` and WAL mode. For multi-cashier high concurrency, switch to PostgreSQL by setting `DATABASE_URL=postgresql://user:password@localhost:5432/meals_db`.

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
