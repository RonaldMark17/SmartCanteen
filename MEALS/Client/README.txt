========================================================================
                      MEALS Desktop Client Setup
========================================================================

Welcome to the MEALS (Management of Expenses, Assets, and Logistics System).

System Requirements:
- Operating System: Windows 10 / Windows 11 (64-bit)
- Internet/Network Connection to your Virtual Server
- No Python installation required
- No Node.js installation required
- No terminal or command prompt required

------------------------------------------------------------------------
Installation Instructions:
------------------------------------------------------------------------
1. Run "MEALS Setup.exe" to install the application.
2. Follow the setup wizard prompts.
3. The installer will create a desktop shortcut "MEALS".

------------------------------------------------------------------------
Configuration (Setting Your Virtual Server Domain):
------------------------------------------------------------------------
1. Locate the installation directory (e.g. C:\Program Files\MEALS\ or your chosen folder).
2. Open the "config.json" file in any text editor (like Notepad).
3. Set your server API URL:
   {
     "apiBaseUrl": "https://YOUR-DOMAIN.com/api"
   }
4. Save the file.

------------------------------------------------------------------------
Launching the Application:
------------------------------------------------------------------------
- Double-click the "MEALS" shortcut on your Desktop or Start Menu.
- Log in with your Admin or Staff credentials.

------------------------------------------------------------------------
Role & Realtime Multi-PC Usage:
------------------------------------------------------------------------
- Admin PC: Access Admin Dashboard, Sales, Financial Reports, and Settings.
- Staff PC: Access Inventory Management, Stock Levels, and Daily Operations.
- Both Admin and Staff connect to the same central database on your virtual server via HTTPS.
========================================================================
