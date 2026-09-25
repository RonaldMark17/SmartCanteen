# 📱 MEALS Android Mobile Client Installation & Setup Guide

[![Platform](https://img.shields.io/badge/Platform-Android%208.0%2B%20(API%2024%2B)-3DDC84.svg?style=flat&logo=Android&logoColor=white)](#)
[![Client](https://img.shields.io/badge/Client-MEALS%20v1.2.0-009688.svg?style=flat)](#)

This folder contains the pre-compiled Android APK binary for the **MEALS Mobile Application**.

---

## 📱 System Requirements

- **Operating System**: Android 8.0 (API Level 24) or higher (phones and tablets)
- **Network**: Wi-Fi or Mobile Data connection to your central MEALS virtual server
- **Permissions**: Internet access, Optional notification permission (for real-time low-stock and inventory threshold alerts)

---

## 📦 Available Distribution Files

- **`MEALS-Mobile.apk`**: Standalone Android application package containing the full MEALS client interface and background notification service.

---

## 🚀 Installation Instructions

### Step 1: Transfer or Download the APK
- Copy `MEALS-Mobile.apk` to your Android device via USB, Google Drive, local network, or direct browser download.

### Step 2: Allow Installation from Unknown Sources
- Tap on `MEALS-Mobile.apk` in your device's **Files** or **Downloads** app.
- If prompted: *“For your security, your phone is not allowed to install unknown apps from this source”*:
  1. Tap **Settings**.
  2. Toggle **Allow from this source** to ON.
  3. Return to the installer and tap **Install**.

### Step 3: Launch and Grant Notifications
- Open **MEALS** from your app drawer.
- When prompted, grant notification permissions so you can receive low-stock and replenishment alerts in real-time.

---

## 👥 Multi-Device Real-Time Synchronization

The mobile application connects directly to your central MEALS backend server:
- Stock checks and POS cashiering on Android tablets or phones update the database in real-time.
- Changes made on mobile are instantly reflected on Windows Desktop clients and web browsers.
- Works offline with local cache fallback when network connectivity is temporarily interrupted.

---

## 📄 Related Guides

- [Package Overview](../README.md)
- [Desktop Client Setup Guide](../Client/README.md)
- [Server Deployment Guide](../Server/DEPLOYMENT_GUIDE.md)
