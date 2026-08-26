# 🌐 SmartCanteen Lightweight Web & PWA Client

[![PWA](https://img.shields.io/badge/PWA-Ready-orange.svg?style=flat&logo=PWA&logoColor=white)](https://web.dev/progressive-web-apps/)
[![JavaScript](https://img.shields.io/badge/JavaScript-Vanilla%20ES6+-F7DF1E.svg?style=flat&logo=JavaScript&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

This directory contains the **zero-build, standalone Progressive Web App (PWA)** client for **SmartCanteen / MEALS**. It provides a lightweight, pure HTML5/CSS3/JavaScript interface that can be served statically with no Node.js compilation required.

---

## 📑 Table of Contents

- [Overview](#-overview)
- [Key Features](#-key-features)
- [Directory Structure](#-directory-structure)
- [How to Run & Serve](#-how-to-run--serve)
- [Service Worker & Offline Support](#-service-worker--offline-support)
- [Comparison: Standalone PWA vs. React Client (`smartcanteen`)](#-comparison-standalone-pwa-vs-react-client-smartcanteen)

---

## 🌟 Overview

The lightweight PWA is designed for:
- Low-spec devices, tablets, or legacy browser terminals.
- Instant deployment without `npm build` steps.
- Quick cash-register operations and real-time inventory lookups.

---

## ✨ Key Features

- **Zero-Build Dependency**: Pure HTML5, modern CSS custom properties, and standard ES6 JavaScript.
- **Service Worker (`sw.js`)**: Caches static assets, stylesheets, and fonts for instant subsequent loads and offline resilience.
- **Web App Manifest (`manifest.json`)**: Enables "Add to Home Screen" on Android, iOS, and desktop browsers with custom theme colors.
- **Chart.js Integration**: Visualizes sales charts and traffic directly using CDN scripts.
- **Responsive Layout**: Designed for mobile touchscreens, tablets, and desktop displays.

---

## 📂 Directory Structure

```text
frontend/
├── index.html       # Single-page web application UI and view components
├── js/              # Client JavaScript utilities and API wrappers
├── manifest.json    # Web App Manifest for progressive installation
├── sw.js            # Service Worker for offline asset caching
└── README.md        # Documentation (this file)
```

---

## 🚀 How to Run & Serve

You can serve this directory using any static web server or reverse proxy.

### Option 1: Python Built-in HTTP Server
```bash
# From the repository root:
python -m http.server 3000 --directory frontend
```
Open [http://localhost:3000](http://localhost:3000) in your web browser.

### Option 2: Nginx Static File Server
```nginx
server {
    listen 80;
    server_name pwa.canteen.local;
    root /var/www/smartcanteen/frontend;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8000/api/;
    }
}
```

---

## 🔄 Service Worker & Offline Support

- `sw.js` caches application shells and vendor CDN assets.
- On network outage, static resources load instantly from the Service Worker cache.
- The PWA connects to the backend API at `/api` (or custom host configured via JavaScript).

---

## ⚖️ Comparison: Standalone PWA vs. React Client (`smartcanteen`)

| Feature | Standalone PWA (`frontend/`) | Primary Client (`smartcanteen/`) |
| :--- | :--- | :--- |
| **Framework** | Vanilla HTML5 / JS / CSS | React 19 + Vite 8 + TailwindCSS 4 |
| **Build Step** | ❌ None (zero build) | ✅ Vite & PostCSS compilation |
| **Desktop Executable** | ❌ Browser / PWA only | ✅ Electron (`.exe` installer & portable) |
| **Mobile App** | ✅ Web PWA install | ✅ Native Android via Capacitor |
| **DepEd Excel Reports** | Read-only figures | Full `.xlsx` live generation & download |
| **Target Use Case** | Lightweight terminals / quick POS | Full Admin, Cashier, Financial & ML Dashboard |

---

## 📄 Subproject Links

- [Root Documentation](../README.md)
- [Backend Documentation](../backend/README.md)
- [Primary Client Documentation](../smartcanteen/README.md)
