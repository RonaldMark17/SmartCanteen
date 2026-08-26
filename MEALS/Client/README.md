# 🖥️ MEALS Desktop Client Installation & Setup Guide

[![Windows](https://img.shields.io/badge/Platform-Windows%2010%20%7C%2011%20(64--bit)-0078D6.svg?style=flat&logo=Windows&logoColor=white)](#)
[![Client](https://img.shields.io/badge/Client-MEALS%20v1.1.0-009688.svg?style=flat)](#)

This folder contains pre-compiled Windows executable binaries for the **MEALS Desktop Client**.

---

## 💻 System Requirements

- **Operating System**: Windows 10 or Windows 11 (64-bit)
- **Network**: Internet or Local Area Network connection to your MEALS virtual server
- **Zero Runtime Dependencies**: No Python, Node.js, or terminal command-line tools needed on client PCs

---

## 📦 Available Distribution Files

1. **`MEALS Setup.exe`** (Recommended): Full NSIS Windows installer that creates Desktop and Start Menu shortcuts, sets up file associations, and includes an uninstaller.
2. **`MEALS.exe`**: Standalone portable single executable that can run directly without installation.

---

## 🚀 Installation & Setup Instructions

### Step 1: Install the Application
1. Double-click `MEALS Setup.exe`.
2. Follow the setup wizard prompts to select your destination directory.
3. The installer will create a desktop shortcut named **MEALS**.

---

### Step 2: Configure Your Virtual Server API URL
1. Navigate to the installation directory (e.g. `C:\Program Files\MEALS\` or custom chosen directory).
2. Locate and open the `config.json` file in Notepad or any text editor.
3. Set your server's public API URL:
   ```json
   {
     "apiBaseUrl": "https://YOUR-SERVER-DOMAIN.com/api"
   }
   ```
4. Save and close the file.

---

### Step 3: Launching & Logging In
1. Double-click the **MEALS** shortcut on your Desktop.
2. Log in using your assigned credentials:
   - **Admin PC**: Access Admin Dashboard, Sales Analytics, DepEd Financial Reports, and Settings.
   - **Staff / Cashier PC**: Access POS (Point of Sale) terminal and daily inventory operations.

---

## 👥 Multi-PC Real-Time Synchronization

Both Admin and Cashier workstations connect to the same central database on your virtual server via secure HTTPS. All sales, inventory deductions, and financial figures are synchronized in real-time.

---

## 📄 Related Guides

- [Package Overview](../README.md)
- [Server Deployment Guide](../Server/DEPLOYMENT_GUIDE.md)
- [Client Source Code & Build Guide](../../smartcanteen/README.md)
