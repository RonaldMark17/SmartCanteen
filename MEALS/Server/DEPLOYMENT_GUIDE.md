# MEALS System - Production Deployment & Operations Manual

This guide provides step-by-step instructions for deploying the **MEALS FastAPI Backend** to a remote virtual server (VPS) and distributing the **MEALS Windows Executable Client** to Admin and Staff PCs.

---

## Architecture Overview

- **Virtual Server (VPS)**: Hosts the single authoritative FastAPI backend and database (`canteen.db`).
- **Client PCs (Admin PC & Staff PC)**: Run `MEALS.exe` compiled via Electron. No local Python, Node, or local database installed on client PCs.
- **Protocol**: All client-server communication is strictly secured over **HTTPS**.

---

## 1. Deploy FastAPI Backend to Virtual Server

1. **Provision VPS**:
   - Operating System: Ubuntu 22.04 LTS or 24.04 LTS (or Debian 12).
   - Ensure inbound firewall permits ports `80` (HTTP), `443` (HTTPS), and `22` (SSH).

2. **Upload Server Code & Prepare Directory**:
   ```bash
   sudo mkdir -p /var/www/meals
   sudo chown -R $USER:$USER /var/www/meals
   cd /var/www/meals
   git clone <your-repository-url> .
   ```

3. **Set Up Python Virtual Environment & Service**:
   ```bash
   python3 -m venv venv
   source venv/bin/activate
   pip install -r backend/requirements.txt uvicorn gunicorn
   ```

4. **Initialize Production Database**:
   ```bash
   python MEALS/Server/init_db.py
   ```

5. **Configure Systemd Background Service**:
   - Copy `MEALS/Server/meals-backend.service` to `/etc/systemd/system/meals-backend.service`.
   - Update `Environment="JWT_SECRET_KEY=..."` with a strong random 32+ character secret string.
   - Start and enable service:
     ```bash
     sudo systemctl daemon-reload
     sudo systemctl enable --now meals-backend
     sudo systemctl status meals-backend
     ```

---

## 2. Configure Domain & API URL

1. Point your domain's DNS `A` record (e.g., `smartcanteen.yourdomain.com` or `meals.yourdomain.com`) to your virtual server's public IP address.
2. Verify DNS resolution from a local terminal:
   ```bash
   ping your-domain.com
   ```

---

## 3. Configure HTTPS (SSL via Certbot)

1. **Install NGINX & Certbot**:
   ```bash
   sudo apt update
   sudo apt install -y nginx certbot python3-certbot-nginx
   ```

2. **Deploy NGINX Site Configuration**:
   - Copy `MEALS/Server/nginx.conf` to `/etc/nginx/sites-available/meals`.
   - Replace all instances of `YOUR-DOMAIN.com` with your actual domain name.
   - Enable site:
     ```bash
     sudo ln -sf /etc/nginx/sites-available/meals /etc/nginx/sites-enabled/
     sudo nginx -t
     sudo systemctl reload nginx
     ```

3. **Obtain Free SSL Certificate via Let's Encrypt**:
   ```bash
   sudo certbot --nginx -d YOUR-DOMAIN.com -d www.YOUR-DOMAIN.com
   ```
   Certbot will automatically configure HTTPS SSL certificates in `/etc/nginx/sites-available/meals` and set up auto-renewal.

---

## 4. Build Windows Client `.exe`

Run the build on your development PC:

```powershell
cd smartcanteen
npm install
npm run electron:build
```

This generates two client distribution files inside `smartcanteen/dist-electron/`:
- `MEALS Setup.exe` (1-click/custom NSIS Installer with Start Menu & Desktop shortcuts)
- `MEALS.exe` (Standalone portable executable)

Copy `MEALS Setup.exe` (or `MEALS.exe`) and `README.txt` into `MEALS/Client/`.

---

## 5. Install `.exe` on Admin PC

1. Copy `MEALS Setup.exe` to the Admin PC.
2. Double-click `MEALS Setup.exe` to run the installer.
3. Open the installed folder (e.g., `C:\Program Files\MEALS\` or user app folder) and open `config.json`.
4. Set `"apiBaseUrl"` to your HTTPS domain:
   ```json
   {
     "apiBaseUrl": "https://YOUR-DOMAIN.com/api"
   }
   ```
5. Double-click the desktop shortcut `MEALS.exe`.
6. Log in using Admin credentials (`admin` / `admin123` or your custom admin account).

---

## 6. Install `.exe` on Staff PC

1. Copy `MEALS Setup.exe` to the Staff PC.
2. Double-click `MEALS Setup.exe` to run the installer.
3. Open `config.json` in the installation directory and set `"apiBaseUrl"` to the same domain:
   ```json
   {
     "apiBaseUrl": "https://YOUR-DOMAIN.com/api"
   }
   ```
4. Double-click `MEALS.exe` on Staff PC.
5. Log in using Staff account credentials.

---

## 7. Verify Two-PC Realtime Database Synchronization

1. **Staff Action**:
   - On Staff PC, log into Inventory view.
   - Update stock or record an inventory count change.
   - Ensure the updated stock level saves with a success confirmation.

2. **Admin Verification**:
   - On Admin PC, open **Inventory** or **Financial Reports**.
   - Confirm that the updated stock and expense data appear immediately.
   - Both PCs read/write directly to the same remote virtual server database.

---

## 8. Backup Production Database

To create an automated database backup on the VPS:

1. **Manual Backup Script**:
   ```bash
   cp /var/www/meals/canteen.db /var/www/meals/backups/canteen.db-backup-$(date +%Y%m%d-%H%M%S)
   ```

2. **Automated Daily Cron Backup**:
   Add to `crontab -e`:
   ```cron
   0 2 * * * cp /var/www/meals/canteen.db /var/www/meals/backups/canteen-$(date +\%Y\%m\%d).db
   ```

---

## 9. Update Remote Backend

When pushing code updates to the virtual server backend:

```bash
cd /var/www/meals
git pull origin main
source venv/bin/activate
pip install -r backend/requirements.txt
sudo systemctl restart meals-backend
sudo systemctl status meals-backend
```

---

## 10. Update Windows Client Application

When updating client features:
1. Re-build the `.exe` on dev PC: `npm run electron:build`
2. Distribute the new `MEALS Setup.exe` to Admin and Staff PCs.
3. Install the updated executable. `config.json` settings (`apiBaseUrl`) will be preserved.

---

## 🔗 Related Documentation

- [Release Package Overview](../README.md)
- [Client Installation Guide](../Client/README.md)
- [Root Repository README](../../README.md)
- [Backend Documentation](../../backend/README.md)
- [Frontend Client Documentation](../../smartcanteen/README.md)

