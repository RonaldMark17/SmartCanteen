# 📦 MEALS System — Distribution & Deployment Package

[![System](https://img.shields.io/badge/System-MEALS-009688.svg?style=flat&logoColor=white)](#)
[![Client](https://img.shields.io/badge/Windows-10%20%7C%2011-0078D6.svg?style=flat&logo=Windows&logoColor=white)](#)
[![Server](https://img.shields.io/badge/Linux-Ubuntu%20%7C%20Debian-E95420.svg?style=flat&logo=Ubuntu&logoColor=white)](#)

This directory contains the production release artifacts, precompiled client binaries, and virtual server (VPS) deployment configurations for the **MEALS** (*Management of Expenses, Assets, and Logistics System*) canteen management and DepEd financial reporting platform.

---

## 📑 Package Structure

```text
MEALS/
├── Client/                     # Precompiled Windows Desktop Binaries
│   ├── MEALS Setup.exe         # 1-Click / Custom NSIS Windows Installer
│   ├── MEALS.exe               # Standalone Portable Single Executable
│   ├── README.md               # Client installation & configuration guide
│   └── README.txt              # Plain-text setup instructions
│
├── Server/                     # Production Server Deployment Configuration
│   ├── DEPLOYMENT_GUIDE.md     # Comprehensive step-by-step VPS operations manual
│   ├── init_db.py              # Server database initialization script
│   ├── meals-backend.service   # Systemd service unit for Ubuntu/Debian
│   ├── nginx.conf              # Production Nginx reverse proxy configuration
│   └── start_server.sh         # Production server startup script
│
└── README.md                   # Package documentation (this file)
```

---

## 🖥️ Client Distribution (`MEALS/Client`)

The client package is distributed to school administrative and canteen staff workstations:
- **No Python or Node.js required** on client PCs.
- **Configurable Server URL**: Edit `config.json` in the application directory to point `apiBaseUrl` to your central server (e.g., `https://smartcanteen.yourdomain.com/api`).
- **Multi-Workstation Synchronization**: Both Admin and Staff PCs communicate in real time over HTTPS with the central database on the server.

For client setup details, see [MEALS/Client/README.md](file:///c:/Users/ronal/OneDrive/Desktop/New%20folder%20%2811%29/MEALS/Client/README.md).

---

## 🌐 Server Deployment (`MEALS/Server`)

The server package provides complete production configurations for hosting on a remote Virtual Private Server (VPS):
- **FastAPI ASGI Backend** running under systemd daemon management (`meals-backend.service`).
- **Nginx Reverse Proxy & SSL** (`nginx.conf` with Let's Encrypt / Certbot automated renewals).
- **Central SQLite or PostgreSQL Database** with automated daily backup routines.

For complete VPS setup instructions, see [MEALS Server Deployment Guide](file:///c:/Users/ronal/OneDrive/Desktop/New%20folder%20%2811%29/MEALS/Server/DEPLOYMENT_GUIDE.md).

---

## 🔗 Related Documentation

- [Root Repository README](../README.md)
- [Backend Development Guide](../backend/README.md)
- [Frontend Client Guide](../smartcanteen/README.md)
