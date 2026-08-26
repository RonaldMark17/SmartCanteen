# 💻 MEALS Client — Desktop & Web Management Application

[![React](https://img.shields.io/badge/React-19.2.4-61DAFB.svg?style=flat&logo=React&logoColor=black)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-8.0.4-646CFF.svg?style=flat&logo=Vite&logoColor=white)](https://vitejs.dev/)
[![TailwindCSS](https://img.shields.io/badge/Tailwind_CSS-4.2.2-38B2AC.svg?style=flat&logo=TailwindCSS&logoColor=white)](https://tailwindcss.com/)
[![Electron](https://img.shields.io/badge/Electron-33.2.1-47848F.svg?style=flat&logo=Electron&logoColor=white)](https://www.electronjs.org/)
[![Chart.js](https://img.shields.io/badge/Chart.js-4.5.1-FF6384.svg?style=flat&logo=Chart.js&logoColor=white)](https://www.chartjs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**MEALS Client** is the cross-platform management client for the **MEALS Smart Canteen Ecosystem**. Built with **React 19**, **Vite 8**, and **Tailwind CSS 4**, it provides an intuitive administrative, inventory tracking, and DepEd-compliant financial accounting interface accessible via:
- **Windows Desktop Executables** (`.exe` via Electron with NSIS installer and portable builds).
- **Modern Web Browsers** (high-performance management dashboard).

---

## 📑 Table of Contents

- [Key Views & Features](#-key-views--features)
- [Architecture & Tech Stack](#-architecture--tech-stack)
- [Project Directory Structure](#-project-directory-structure)
- [Prerequisites](#-prerequisites)
- [Installation & Setup](#-installation--setup)
- [Environment Configuration](#-environment-configuration)
- [Running in Development](#-running-in-development)
- [Building for Desktop (Electron Windows `.exe`)](#-building-for-desktop-electron-windows-exe)
- [Available Scripts](#-available-scripts)
- [Troubleshooting](#-troubleshooting)

---

## ✨ Key Views & Features

### 1. 📊 DepEd Financial Reports (`src/views/FinancialReports.jsx`)
- **DepEd Canteen Fund Framework**: Monthly financial statements calculating Gross Sales, Cost of Goods Sold, Operating Expenses, and Net Income.
- **Statutory Fund Allocations**: Real-time distribution across mandatory DepEd percentage allocations (Feeding 35%, Operations 25%, Clinic 5%, Admin 5%, Faculty & Student Dev 15%).
- **Live Excel Export**: One-click generation and download of official DepEd `.xlsx` workbooks with preserved formulas, cell styles, formatting, and institutional logos.
- **Expense Voucher Proofs**: Upload, manage, and preview receipt photos for itemized operational expenses.

### 2. 📦 Inventory & Stock Control (`src/views/Inventory.jsx`)
- **Live Stock Tracking**: Real-time stock counts with color-coded warning badges for items below `min_stock`.
- **Multi-Unit Catalog**: Discrete pieces (`pcs`) and continuous bulk measures (`kg`, `g`, `l`, `ml`) with automatic unit conversions.
- **Product Catalog Management**: Add, update, and archive products, define base units, barcodes, categories, and cost/retail prices.
- **Stock Restock & Adjustments**: Direct stock level increments and deduction logging.

### 3. 📈 Sales Analytics & Reports (`src/views/Analytics.jsx`)
- **Interactive Visualizations**: Powered by Chart.js — daily revenue trends, top-selling items, and category revenue share.
- **Date Range Filters**: Custom date ranges, monthly views, and school term comparisons.

### 4. 🔐 Security, TOTP MFA & Account Management (`src/views/Login.jsx`, `ManageAccounts.jsx`)
- **Role-Based Guards**: Navigation and feature protection tailored for `admin` and `staff` roles.
- **Time-based MFA (TOTP)**: Google Authenticator setup with QR code generation, backup recovery codes, and 30-day device trust.
- **Account & Reset Queue**: Administrative password reset approval and MFA recovery review.

### 5. ⚙️ Settings & Dynamic Modules (`src/views/Settings.jsx`, `AuditLog.jsx`)
- **Dynamic Feature Switches**: Toggle system modules on/off dynamically.
- **Audit Logs**: Query timestamped activity logs with IP addresses and user actions.

---

## 🏛 Architecture & Tech Stack

```text
┌─────────────────────────────────────────────────────────────────┐
│                    React 19 Client Framework                    │
├────────────────────────────────┬────────────────────────────────┤
│       Context Providers        │          View Modules          │
│  - AuthContext (JWT & TOTP)    │  - Inventory Manager           │
│  - ThemeContext (Dark/Light)   │  - DepEd Financial Reports     │
│  - AlertContext (WebSockets)   │  - Sales Analytics & Charts    │
│                                │  - Account & Reset Management  │
├────────────────────────────────┴────────────────────────────────┤
│            Styling: Tailwind CSS 4 & Custom Design Tokens       │
├─────────────────────────────────────────────────────────────────┤
│       Electron Runtime                                          │
│  - Desktop Window Management                                    │
│  - Local config.json API resolver                               │
│  - NSIS Windows Installer & Portable Builds                     │
└─────────────────────────────────────────────────────────────────┘
```

| Technology | Version | Purpose |
| :--- | :--- | :--- |
| **React** | `19.2.4` | Core UI component framework |
| **Vite** | `8.0.4` | Fast bundler and development server |
| **TailwindCSS** | `4.2.2` | Utility-first CSS styling framework |
| **React Router** | `7.14.1` | Client-side declarative routing and route guards |
| **Electron** | `33.2.1` | Cross-platform desktop runtime for Windows |
| **electron-builder** | `25.1.8` | Packaging tool for NSIS installer and portable `.exe` |
| **Chart.js / react-chartjs-2** | `4.5.1` / `5.3.1` | Interactive analytics charts |
| **Heroicons** | `2.2.0` | Accessible SVG icon suite |
| **QRCode** | `1.5.4` | TOTP authenticator setup QR code rendering |

---

## 📂 Project Directory Structure

```text
smartcanteen/
├── dist/                          # Production web build artifacts
├── dist-electron/                 # Compiled Windows desktop executables
│   ├── MEALS Setup.exe            # Windows NSIS installer
│   └── MEALS.exe                  # Standalone portable executable
├── electron/                      # Electron main & preload scripts
│   ├── config.json                # Runtime desktop API endpoint configuration
│   ├── icon.png                   # Application desktop icon
│   ├── main.cjs                   # Electron main process
│   └── preload.cjs                # Secure context bridge script
├── public/                        # Static assets (favicons, manifest)
├── src/                           # Application source code
│   ├── assets/                    # Static image assets and logos
│   ├── components/                # Reusable UI widgets, modals & navbar
│   ├── config/                    # API client configurations
│   ├── contexts/                  # React state context providers
│   │   ├── AlertContext.jsx       # WebSocket live notification context
│   │   ├── AuthContext.jsx        # JWT session & MFA state context
│   │   └── ThemeContext.jsx       # Theme state context
│   ├── services/                  # Backend API HTTP & WebSocket clients
│   │   ├── api.js                 # Primary Fetch/REST wrapper
│   │   └── websocket.js           # Real-time WebSocket connection client
│   ├── utils/                     # Formatters, currency & date utilities
│   ├── views/                     # Main view pages
│   │   ├── Analytics.jsx          # Sales metrics & revenue charts
│   │   ├── AuditLog.jsx           # Activity & security audit trails
│   │   ├── Dashboard.jsx          # Role-tailored home dashboard
│   │   ├── FinancialReports.jsx   # DepEd financial statements & Excel export
│   │   ├── Inventory.jsx          # Product catalog & stock manager
│   │   ├── Login.jsx              # Login, TOTP MFA & password reset
│   │   ├── ManageAccounts.jsx     # User management & account review
│   │   ├── Settings.jsx           # Module toggles & preferences
│   │   └── TransactionHistory.jsx # Transaction query & ledger
│   ├── App.css                    # Component style adjustments
│   ├── App.jsx                    # Root router & layout wrapper
│   ├── index.css                  # Global Tailwind CSS and design tokens
│   └── main.jsx                   # React application mount entry point
├── .env.example                   # Environment configuration template
├── package.json                   # Project dependencies and script declarations
├── postcss.config.js              # PostCSS processor configuration
├── tailwind.config.js             # Tailwind CSS configuration
└── vite.config.js                 # Vite bundler & proxy configuration
```

---

## 📦 Prerequisites

- **Node.js**: `18.x`, `20.x`, or `22.x`
- **npm**: `9.x` or higher
- **FastAPI Backend**: Running locally or on a remote server

---

## 🚀 Installation & Setup

1. **Navigate into the client directory**:
   ```bash
   cd smartcanteen
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

---

## ⚙️ Environment Configuration

Create a `.env.local` file in `smartcanteen/` by copying `.env.example`:

```bash
cp .env.example .env.local
```

### Environment Variables Reference

| Variable | Default Value | Description |
| :--- | :--- | :--- |
| `VITE_API_BASE_URL` | `http://127.0.0.1:8000/api` | Base URL for REST API requests |
| `VITE_API_PROXY_TARGET` | `http://127.0.0.1:8000` | Vite local development proxy target |
| `VITE_NATIVE_API_BASE_URL`| `https://smartcanteen.yourdomain.com` | Absolute API target for native desktop builds |

---

## 🏃 Running in Development

### 1. Web Development Server
```bash
npm run dev
```
Accessible at [http://localhost:5173](http://localhost:5173) with full Hot Module Replacement (HMR).

### 2. Electron Desktop in Development Mode
```bash
npm run electron:start
```

---

## 🖥 Building for Desktop (Electron Windows `.exe`)

To compile the standalone Windows binaries:

```bash
npm run electron:build
```

This generates:
- **`dist-electron/MEALS Setup.exe`**: Full NSIS installer with desktop shortcut, start menu entry, and uninstaller.
- **`dist-electron/MEALS.exe`**: Standalone portable single executable requiring no installation.

### Configuring the Server URL for Desktop Clients

The desktop executable checks for an external `config.json` file in its directory:
```json
{
  "apiBaseUrl": "https://smartcanteen.yourdomain.com/api"
}
```
This allows distributing the pre-compiled `.exe` to Admin and Staff PCs while easily configuring the server domain on-site without recompilation.

---

## 📜 Available Scripts

| Command | Action |
| :--- | :--- |
| `npm run dev` | Starts Vite development server at `localhost:5173` |
| `npm run build` | Builds optimized production web distribution into `dist/` |
| `npm run preview` | Previews production build locally |
| `npm run lint` | Runs ESLint syntax and code quality checks |
| `npm run electron:start` | Launches Electron desktop window in development |
| `npm run electron:build` | Compiles web assets and generates Windows desktop `.exe` packages |

---

## 🔧 Troubleshooting

### 1. API Connection Errors / Network Error on Login
- Ensure the FastAPI backend server is running (`python app.py` or uvicorn).
- In browser dev mode, check that `VITE_API_BASE_URL` or Vite proxy target in `.env.local` points to `http://127.0.0.1:8000`.
- In the Electron `.exe`, confirm that `config.json` contains the correct `apiBaseUrl`.

### 2. Financial Report Excel Export Fails
- Ensure the backend has the official template in `backend/report_templates/CANTEEN-REPORT-2025-2026-2 (1).xlsx`.

---

## 📄 Subproject Links

- [Root Documentation](../README.md)
- [Backend Documentation](../backend/README.md)
- [MEALS Release Package](../MEALS/README.md)
