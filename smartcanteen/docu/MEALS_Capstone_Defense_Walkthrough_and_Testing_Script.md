# MEALS (Smart Canteen AI)
## Comprehensive Capstone Defense Walkthrough & Live Testing Script
**Institution:** Bay Central Elementary School  
**System Name:** MEALS (Smart Canteen AI)  
**Document Purpose:** Official Thesis/Capstone Defense Demonstration Script, Verification Matrix, and Testing Plan

---

## 1. Actual MEALS Features

Based on direct inspection of the implemented frontend (`smartcanteen/src`), backend API (`backend/main.py`), and database models (`backend/models.py`), the following matrix identifies every functional module verified in the live code:

| Module / Feature | Where It Is Found | What It Does | User Who Can Access It | Implementation Status |
| :--- | :--- | :--- | :--- | :--- |
| **Authentication & Role Login** | `/login` | Authenticates username and password, enforces bcrypt hashing, issues session tokens, supports "Remember Me", and restricts account access by role. | All Registered Users (Admin, Staff, Cashier) | **IMPLEMENTED** |
| **Two-Factor Authentication (TOTP 2FA)** | `/admin/setup-2fa`, `/login` | QR code scanning with Google Authenticator, TOTP 6-digit verification code, fallback single-use recovery codes, and brute-force attempt lockout. Mandatory for Admin. | Admin (Mandatory), Staff/Cashier (Optional via profile) | **IMPLEMENTED** |
| **Self-Service Account Recovery** | `/login` (Modals) | Allows users who forgot passwords or lost 2FA devices to file structured recovery requests with administrative review and appeals. | All Users | **IMPLEMENTED** |
| **Admin Financial Dashboard** | `/admin/dashboard` | Displays School Year KPI cards (Monthly Sales, Operating Expenses, Net Profit, Current Balance), previous month comparisons, interactive bar & donut charts, and quick export shortcuts. | Administrator | **IMPLEMENTED** |
| **Operational Dashboard** | `/dashboard` | Displays live operational overview: products in stock count, low stock warnings, out-of-stock items, and recent inventory movement logs. | Staff, Cashier | **IMPLEMENTED** |
| **School Year Management** | `/school-years` or `/financial-management` | Configures DepEd academic years (June to May, 12 months), activates current academic periods, sets starting cash-on-hand balances, and prevents cross-year record contamination. | Administrator | **IMPLEMENTED** |
| **Product Catalog Management** | `/inventory` (Tab 1: Products & Stock) | Adds, views, edits, and archives canteen products. Configures selling price, cost price, unit type (PCS vs Bulk kg/g/L/mL), minimum reorder stock, and perishable classification. | Admin, Staff, Cashier (View-only for Cashier) | **IMPLEMENTED** |
| **Stock Replenishment** | `/inventory` (`+ Replenish Stock` button) | Records incoming food batches, ingredients, or cooked items. Increases stock on hand and writes an immutable audit record to `inventory_logs`. | Admin, Staff | **IMPLEMENTED** |
| **Stock Manual Adjustment** | `/inventory` (`Adjust Stock` button) | Manually corrects stock counts with designated reasons: damage, spoilage, shrinkage, kitchen prep spill, or audit recount. | Admin, Staff | **IMPLEMENTED** |
| **End-of-Day Perishable Reset & Food Waste** | `/inventory` (`🍲 End-of-Day Perishable Food Reset`) | Identifies unsold perishable cooked items at closing, clears stock to zero, and logs waste dispositions (`waste_spoiled`, `staff_meal`, `donated`). | Admin, Staff | **IMPLEMENTED** |
| **Morning Daily Prep & Recon API** | Backend API (`/api/inventory/daily-prep/batch`, `/api/inventory/daily-reconciliation/submit`) | Records morning batch preparation quantities and matches them against afternoon remaining quantities to compute exact food waste cost. | Admin, Staff | **IMPLEMENTED** |
| **Stock Alerts & Monitoring** | `/inventory` (Tab 2: Alerts) & Top Header Bell | Real-time monitoring of Out of Stock and Low Stock items based on `min_stock` thresholds, with desktop notification sync. | Admin, Staff, Cashier | **IMPLEMENTED** |
| **Inventory Audit History** | `/inventory` (Tab 3: Stock History) | Complete chronological audit log of all stock movements (replenishment, adjustment, perishable reset) with timestamps, quantities, and user attribution. | Admin, Staff | **IMPLEMENTED** |
| **POS / Cashier Checkout** | `/pos` | Quick cashier counter interface with category filtering, search, quantity toggles, cash calculation, change computation, and printable thermal receipt modal. | Admin, Cashier | **IMPLEMENTED** |
| **Offline Transaction Queue** | `/pos` (`offlineStore.js`) | Caches cash transactions in browser IndexedDB/LocalStorage when the internet or server connection drops, syncing automatically when reconnected. | Admin, Cashier | **IMPLEMENTED** |
| **Transaction History** | `/transactions` | Detailed searchable ledger of all customer POS sales, displaying date/time, cashier name, itemized products, total, discount, and sync status. | Admin, Cashier | **IMPLEMENTED** |
| **Financial Management Overview** | `/financial-management` (Tab: Overview) | Comprehensive monthly DepEd financial statement: Beginning Cash, Current Sales, Cost of Sales, Gross Profit, Operating Expenses breakdown, Net Profit, and Ending Cash. | Administrator | **IMPLEMENTED** |
| **Daily Sales Ledger** | `/financial-management` (Tab: Daily Sales) | Records and tracks daily cash collections or monthly sales summaries, with date search, filtering, and manual override capabilities. | Administrator | **IMPLEMENTED** |
| **Operating Expense Management** | `/financial-management` (Tab: Expenses) | Logs operational expenses categorized into 7 DepEd operational expense lines, supplier names, notes, and image receipt uploads with instant preview modal. | Administrator | **IMPLEMENTED** |
| **Fund Allocation & Monitoring** | `/financial-management` (Tab: Fund Allocation) | Tracks DepEd prescribed canteen fund allocations (e.g., School Operations, Revolving Capital, Faculty Fund) with automatic forward-balance roll calculations. | Administrator | **IMPLEMENTED** |
| **Demand Forecasting (AI/ML)** | `/predictions` | Predicts tomorrow's product demand using **XGBoost** machine learning (with heuristic fallback). Analyzes weekday patterns, historical sales, weather, and school events. | Administrator | **IMPLEMENTED** |
| **Official Reports & Exports** | `/reports` | Generates 8 distinct financial reports (Monthly, Quarterly, Annual, School Year, Sales, Expense, Cash Flow, Profit). Direct export to `.xlsx` Excel, Official PDF, and Print. | Administrator | **IMPLEMENTED** |
| **User Account Management** | `/accounts` | Administrative creation, editing, role assignment (`admin`, `staff`, `cashier`), password reset approval, and account deactivation. | Administrator | **IMPLEMENTED** |
| **Audit Logs** | `/audit` | Immutable security log recording every administrative action, user login, product modification, 2FA change, and financial update with IP address and timestamp. | Administrator | **IMPLEMENTED** |
| **System Settings & Module Toggles** | `/settings` | Configures workspace preferences, dark mode toggle, database backup download, and modular feature enabling/disabling (`ModuleSettingsContext`). | Administrator (Full), Staff (Partial) | **IMPLEMENTED** |

---

## 2. Actual User Roles and Permissions

The system implements strict **Role-Based Access Control (RBAC)** defined in `smartcanteen/src/config/access.js` and enforced by FastAPI backend dependencies (`auth.require_admin`, `auth.require_staff_or_admin`, `auth.get_current_user`).

### Role-Permission Matrix

| Functional Area / Route | Administrator (`admin`) | Canteen Staff (`staff`) | Cashier (`cashier`) |
| :--- | :---: | :---: | :---: |
| **Default Landing Route** | `/admin/dashboard` | `/inventory` | `/pos` |
| **Financial Dashboard** | Full Access | No Access | No Access |
| **Operational Dashboard** | Full Access | Full Access | Full Access |
| **POS / Cashier Checkout** | Full Access | No Access | Full Access |
| **View Product Inventory** | Full Access | Full Access | View Only |
| **Add / Edit Products** | Full Access | Full Access | No Access |
| **Stock Replenishment** | Full Access | Full Access | No Access |
| **Stock Adjustment & Waste Reset** | Full Access | Full Access | No Access |
| **View Stock History & Alerts** | Full Access | Full Access | Alerts Only |
| **Transaction History** | Full Access | No Access | Full Access |
| **Financial Management & Daily Sales** | Full Access | No Access | No Access |
| **Operating Expenses & Receipt Upload** | Full Access | No Access | No Access |
| **School Year Management** | Full Access | No Access | No Access |
| **DepEd Financial Reports & Exports** | Full Access | No Access | No Access |
| **Demand Forecast (AI / ML)** | Full Access | No Access | No Access |
| **User Management & Password Approvals** | Full Access | No Access | No Access |
| **Audit Logs** | Full Access | No Access | No Access |
| **System Settings (Modules & Database)**| Full Access | Workspace Only | No Access |

### Short Defense Line on Role-Based Access Control
> *"Members of the panel, MEALS uses strict role-based access control so that each canteen worker can only access the tools necessary for their specific job. The Cashier focuses entirely on fast checkout at the counter without seeing sensitive school financial statements; the Canteen Staff manages kitchen preparation, stock replenishment, and daily food waste; while the School Canteen Administrator holds full authority over financial allocations, user accounts, DepEd reports, and AI demand forecasting."*

---

## 3. Opening Defense Script

*(To be delivered naturally and with confidence by the group leader and presenters)*

> **Presenter 1 (Introduction):**  
> *"Good morning, esteemed members of the panel, our research adviser, and guests. We are here today to present our capstone project entitled **MEALS: Smart Canteen Management and Demand Forecasting System** developed specifically for **Bay Central Elementary School**.*
> 
> *Public school elementary canteens operate under very unique operational conditions. Unlike standard retail convenience stores that stock non-perishable packaged goods with months of shelf life, the Bay Central Elementary School canteen prepares, cooks, and sells **perishable daily meals and cooked snacks** — such as cooked viands, arroz caldo, pancit, sandwiches, and fresh juices. These items must be prepared fresh in the morning and consumed within the school day.*
> 
> *In their manual system, the canteen faced three critical challenges:*  
> 1. *First, **unpredictable daily student demand** leading to food waste when over-prepared, or lost sales when under-prepared.*  
> 2. *Second, **tedious and prone-to-error manual record-keeping** for DepEd monthly financial statements, operating expenses, and fund allocations.*  
> 3. *And third, **lack of real-time inventory visibility** to monitor remaining food portions before afternoon dismissal.*
> 
> **Presenter 2 (System Overview):**  
> *To address these exact challenges, we developed MEALS. The system provides an end-to-end digital workflow: it tracks daily cooked food inventory with perishable waste reconciliation, provides an offline-capable POS counter checkout, automates DepEd-compliant monthly financial statements, and leverages an **XGBoost machine learning prediction engine** that factors in weekday demand, weather conditions, and school events to guide morning food preparation.*
> 
> *Today, we will present a complete live demonstration of our actual, fully implemented system — from morning login, inventory preparation, and POS sales, to afternoon perishable food waste reconciliation, financial reporting, and AI demand forecasting. We will now begin our walkthrough."*

---

## 4. Login and Authentication Walkthrough

### Step 4.1: Accessing the Login Portal
* **ACTION:** Open the web browser and navigate to the application URL (`/login`).
* **EXPLANATION:** Show the branded Bay Central Elementary School MEALS authentication portal. Explain the clean interface, clear security indicators, and accessibility options.
* **EXPECTED RESULT:** The login screen appears with Username and Password fields, "Remember Me" checkbox, "Sign In" button, and links for "Forgot Password?" and "Lost Authenticator Device?".
* **DEFENSE LINE:**  
  > *"We begin at the MEALS authentication portal. The interface is clean, responsive, and secure, ensuring only authorized canteen personnel can access school operations."*

### Step 4.2: Negative Test — Invalid Password Handling
* **ACTION:** Enter username `admin` and type an incorrect password `wrongpassword`, then click **Sign In**.
* **EXPLANATION:** Explain to the panel how the system prevents unauthorized entry and protects against brute-force attacks by verifying passwords against salted bcrypt hashes.
* **EXPECTED RESULT:** An immediate red alert toast/banner appears stating: `"Invalid username or password"`. The system does not crash or expose server stack traces.
* **DEFENSE LINE:**  
  > *"As shown on screen, entering an incorrect credential immediately triggers a security warning without revealing whether the username or password was the cause, preventing account enumeration attacks."*

### Step 4.3: Valid Authentication & Two-Factor Verification (2FA)
* **ACTION:** Enter the correct credentials for the Administrator account and click **Sign In**. On the prompt, enter the 6-digit TOTP code from Google Authenticator (or use a valid recovery code).
* **EXPLANATION:** Explain that for administrative accounts holding sensitive financial data, two-factor authentication (TOTP) is enforced to comply with school security standards.
* **EXPECTED RESULT:** The two-factor challenge verifies the time-based token, generates a secure JWT session, and automatically redirects the administrator to the Admin Financial Dashboard (`/admin/dashboard`).
* **DEFENSE LINE:**  
  > *"Upon entering valid credentials and confirming the 6-digit authenticator code, the system validates the session and directs the Administrator straight to the financial control center."*

---

## 5. Dashboard Walkthrough

### Step 5.1: Administrator Financial Dashboard Elements
* **ACTION:** Focus on the main Dashboard view at `/admin/dashboard`. Point cursor to the header selectors, metric cards, and charts.
* **EXPLANATION:** Break down each live dashboard element:
  * **School Year & Month Selectors:** Dynamically loads active academic years and individual monthly financial periods.
  * **Monthly Sales KPI Card:** Displays gross canteen sales for the selected month calculated directly from recorded daily transactions, featuring a comparison percentage against the preceding month.
  * **Operating Expenses KPI Card:** Sums operational costs across transportation, gas, supplies, helpers, and repairs.
  * **Net Profit KPI Card:** Displays net profit along with the operational profit margin percentage.
  * **Current Balance KPI Card:** Reflects available cash reserves and revolving funds.
  * **Monthly Sales & Profit Trend (Bar Chart):** Renders school-year performance month-by-month using Chart.js.
  * **Operating Expense Breakdown (Donut Chart):** Visualizes the proportion of expenses spent per category.
  * **Monthly Comparison Table:** Shows line-by-line differences with visual "Up", "Down", or "Even" status badges.
* **EXPECTED RESULT:** All cards and charts populate accurately from the underlying SQLite database with formatted Philippine Peso (`PHP`) currency values.
* **DEFENSE LINE:**  
  > *"The Admin Dashboard provides the canteen manager with an executive overview. Every peso shown here is tied directly to verified operational data, eliminating guesswork in school canteen finances."*

---

## 6. School Year Walkthrough

### Step 6.1: DepEd 12-Month Academic Structure
* **ACTION:** Click **School Years** in the sidebar navigation (or open `/school-years`).
* **EXPLANATION:** Explain to the panel how DepEd elementary canteens track finances on an academic year basis (running from June of the starting year to May of the ending year, comprising 12 monthly financial reports).
* **EXPECTED RESULT:** The page displays configured school years (e.g., S.Y. 2024–2025, S.Y. 2025–2026), highlighting the currently active school year with an "Active" badge.
* **DEFENSE LINE:**  
  > *"Under DepEd canteen guidelines, financial records must not mix across different academic years. MEALS organizes all reports into a 12-month June-to-May structure. When a new school year is activated, past years remain archived and read-only for audit integrity."*

---

## 7. Product Setup

### Step 7.1: Opening Product Management
* **ACTION:** Click **Inventory** in the sidebar and ensure the **Products & Stock** tab is active. Click the green `+ Add Product` button.
* **EXPLANATION:** Show the product setup modal and explain the actual fields:
  * **Product Name:** (e.g., *Arroz Caldo with Egg*)
  * **Category Dropdown:** *Staple (Rice/Noodles), Viand (Main Dish), Soup, Snacks, Bread/Pastries, Drinks/Beverages, Dessert, General*.
  * **Perishable Food Checkbox:** Specifically flags items prepared daily that cannot be held over indefinitely.
  * **How is this item counted? (Unit Type):** Pieces (`PCS`) or Bulk (`kg`, `g`, `L`, `mL`).
  * **Selling Price (PHP) & Cost Price (PHP):** Establishes profit margin per unit.
  * **Current Stock on Hand & Low Stock Warning Level:** Determines automated alerts.
* **EXPECTED RESULT:** The modal validates inputs in real time, preventing negative prices or empty names.
* **DEFENSE LINE:**  
  > *"When setting up a product, staff can flag the item as 'Perishable Food'. This tells MEALS that this product is prepared fresh daily and must undergo afternoon waste reconciliation."*

---

## 8. Perishable Inventory Walkthrough

### Step 8.1: Morning Preparation & Stock Setup
* **ACTION:** In the Inventory table, locate a cooked perishable item (e.g., *Arroz Caldo with Egg* with 0 stock). Click **Replenish Stock** (or prepare batch). Enter Quantity: `30` pieces, Date: Today, Remarks: *"Morning kitchen batch prep"*. Click **Confirm Replenishment**.
* **EXPLANATION:** Explain that at 6:30 AM before school starts, the canteen kitchen prepares 30 bowls of hot Arroz Caldo. The staff records this batch in MEALS, setting the available inventory for morning recess and lunch.
* **EXPECTED RESULT:** The item's stock increases from `0` to `30`. The badge updates from "Out of Stock" to a green "In Stock" badge. A new record is added to Stock History.
* **DEFENSE LINE:**  
  > *"In the morning, the kitchen prepares 30 servings of Arroz Caldo. By logging this batch, the stock on hand is immediately updated to 30 units, ready to be sold at the canteen counter."*

---

## 9. Sales Walkthrough

### Step 9.1: Counter Checkout via POS
* **ACTION:** Navigate to **POS / Cashier** (`/pos`). Search for or click on *Arroz Caldo with Egg*. Set quantity to `5` bowls.
* **EXPLANATION:** Simulate students purchasing 5 bowls during recess. Show the cart breakdown: unit price PHP 25.00 × 5 = PHP 125.00. Enter Amount Received: `PHP 200.00`.
* **EXPECTED RESULT:** The POS computes Change: `PHP 75.00`. The "Complete Cash Sale" button activates.
* **DEFENSE LINE:**  
  > *"At recess, a cashier processes an order of 5 bowls. The POS calculates the subtotal and change instantly with zero mental math required from the cashier."*

### Step 9.2: Completing Transaction & Receipt Generation
* **ACTION:** Click **Complete Cash Sale** (or press Enter).
* **EXPLANATION:** Show the generated electronic receipt modal containing transaction ID, timestamp, cashier name, itemized products, and cash tendered. Click Print to demonstrate receipt printer formatting, or Close to proceed.
* **EXPECTED RESULT:** The sale is recorded into the database, audit logs record `TRANSACTION_CREATED`, and the transaction appears in Transaction History.
* **DEFENSE LINE:**  
  > *"Completing the sale generates an official transaction receipt, updates the cashier ledger, and records the sale in the daily cash tally."*

---

## 10. Sales and Inventory Connection

### Step 10.1: Explaining Actual System Architecture & Closing Reconciliation
* **ACTION:** Open **Inventory** (`/inventory`) and highlight the stock count and then open **Closing Reconciliation** (`🍲 End-of-Day Perishable Food Reset`).
* **EXPLANATION:**  
  > *"Members of the panel, let us clarify how MEALS specifically handles the relationship between counter sales and perishable cooked inventory.  
  > In a retail grocery, barcode scanners deduct rigid packages instantly. But in a busy elementary school canteen during a 20-minute recess rush, canteen staff serve varying portion sizes, combo plates, and student meal packages.  
  > Therefore, MEALS incorporates an end-of-day **Closing Reconciliation Protocol**. At the end of the day, staff perform a physical count of unsold bowls and reconcile prepared units against sold units."*
* **ACTION:** Open the **🍲 End-of-Day Perishable Food Reset** modal.
* **EXPLANATION:** Explain that of the 30 prepared bowls, 26 were sold during the day, leaving 4 unsold bowls in the warmer. Because Arroz Caldo contains rice and egg, it cannot be safely held over to tomorrow.
* **ACTION:** In the modal, review the 4 unsold units. Select disposition: `"Spoiled / Food Waste"` (or `"Staff Meal Consumed"`). Enter remarks: *"Unsold after lunch dismissal"*, then click **Confirm Reset**.
* **EXPECTED RESULT:**  
  1. The stock of Arroz Caldo resets cleanly to `0`.  
  2. The system writes an adjustment entry to `inventory_logs` with movement type `"adjustment"` and quantity `-4.00`.  
  3. The reason is explicitly recorded as `"Daily Food Waste: Spoiled / Food Waste"`.  
  4. The food waste cost is calculated and archived to train future AI demand predictions.
* **DEFENSE LINE:**  
  > *"By clearing unsold perishable food to zero at closing, MEALS ensures tomorrow morning's staff starts with a clean slate, while simultaneously capturing exact food waste data."*

---

## 11. Actual Inventory Monitoring

### Step 11.1: Stock Alerts & Minimum Stock Thresholds
* **ACTION:** In **Inventory**, switch to **Tab 2: Alerts** (or click the header notification bell).
* **EXPLANATION:** Demonstrate how MEALS flags inventory that is critically low or exhausted:
  * **Out of Stock Section:** Items with `stock <= 0` requiring kitchen batch cooking.
  * **Low Stock Warning Section:** Items whose stock is below their configured `min_stock` threshold.
* **EXPECTED RESULT:** The alerts table cleanly highlights affected products with colored status tags and provides direct "Replenish" action buttons.
* **DEFENSE LINE:**  
  > *"Canteen staff do not need to guess what ingredients are running out. The Alerts module flags items falling below safety levels so supplies can be bought before stockouts occur."*

---

## 12. Actual AI / Sales Prediction Feature

### Step 12.1: Demonstrating the Demand Forecast View
* **ACTION:** Navigate to **Demand Forecast** (`/predictions`).
* **EXPLANATION:** Walk the panel through the AI forecasting module:
  1. **Where It Is Found:** Located at `/predictions`, accessible by the Administrator.
  2. **Prediction Engine:** Powered by **XGBoost (Extreme Gradient Boosting)** integrated in `backend/ml_predictor.py`.
  3. **Input Features:**
     * Historical daily sales lags and rolling moving averages.
     * Day-of-the-week pattern (Monday through Friday school day weights).
     * Daily weather forecast conditions (Clear, Cloudy, Rainy, Stormy, Typhoon).
     * School calendar event types (Regular Day, Intramurals, Exams, Half Day, Holiday).
  4. **Outputs Displayed:**
     * **Recommended Prep Quantity:** Exact portions the kitchen should cook tomorrow.
     * **Stock Gap:** Anticipated shortage based on currently available inventory.
     * **Risk Classification:** `Low`, `Medium`, or `High` risk of over-preparation or stockout.
     * **Actionable Badges:** `Restock`, `Use First / Reduce Waste`, `Enough Stock`, `Prep Light`.
* **ACTION:** Switch the simulation scenario from *"Regular Day / Clear"* to *"Rainy Day"*.
* **EXPLANATION:** Point out how the forecast for hot soup increases while cold beverages decrease based on trained category weather coefficients.
* **EXPECTED RESULT:** The interactive table and Chart.js forecast curves update dynamically to reflect the simulated environmental condition.
* **DEFENSE LINE:**  
  > *"MEALS does not use arbitrary guesses. The XGBoost model examines past sales together with weather and school events to recommend exact cooking batches, directly cutting down food waste."*

---

## 13. Actual Expense Workflow

### Step 13.1: Recording an Operating Expense with Receipt Upload
* **ACTION:** Navigate to **Financial Management** (`/financial-management`) and click the **Expenses** tab. Click **Record Expense**.
* **EXPLANATION:** Demonstrate recording a real canteen operational expense:
  * **Expense Type:** Daily Expense
  * **Category:** *Gas* (LPG cooking fuel)
  * **Amount:** `PHP 1,100.00`
  * **Supplier:** *Bay Central Gas Center*
  * **Description:** *Refill of 11kg cooking gas tank for kitchen burner*
  * **Receipt Attachment:** Click choose file and upload a receipt image (`sample_receipt.png`).
* **ACTION:** Click **Save Expense**.
* **EXPECTED RESULT:** The expense is saved into the database, tied to the current monthly report, and rendered in the expense table.
* **ACTION:** Click the small thumbnail / eye icon next to the expense.
* **EXPECTED RESULT:** The **Receipt Preview Modal** opens, displaying the sanitized receipt image with zoom and download capabilities.
* **DEFENSE LINE:**  
  > *"Every operational disbursement is categorized under standard DepEd expense titles with digital receipt image attachments, providing a completely auditable paper trail."*

---

## 14. Actual Financial Workflow

### Step 14.1: Monthly Financial Statement & Automatic Calculations
* **ACTION:** In **Financial Management**, select the **Overview** tab.
* **EXPLANATION:** Show the panel the automated monthly financial summary:
  * **Gross Sales:** Derived automatically from recorded daily transactions.
  * **Cost of Sales / Purchases:** Beginning inventory plus purchases minus ending inventory.
  * **Gross Profit:** Gross Sales minus Cost of Sales.
  * **Total Operating Expenses:** Automatically summed from the Expenses ledger.
  * **Net Profit:** Gross Profit minus Operating Expenses.
  * **Ending Cash on Hand:** Beginning cash + Net profit.
* **ACTION:** Switch to the **Fund Allocation** tab.
* **EXPLANATION:** Show how the system allocates net profit across DepEd prescribed funds (e.g., School Operations Fund, Revolving Fund). Show how ending balances from the previous month automatically carry forward as the opening balance of the next month.
* **EXPECTED RESULT:** All calculations reflect mathematically verified accounting equations without manual calculator entry.
* **DEFENSE LINE:**  
  > *"MEALS eliminates manual computation errors by automatically cascading daily sales and expenses directly into the DepEd monthly financial statement and fund monitoring tables."*

---

## 15. Actual Reports

### Report Identification Matrix

| Report Type | What It Contains | DepEd / School Purpose | Primary User |
| :--- | :--- | :--- | :--- |
| **Monthly Report** | Complete statement of monthly sales, cost of goods, categorized expenses, and net profit. | Mandatory monthly submission to the School Principal and Division Office. | Administrator |
| **Quarterly Report** | Consolidated 3-month financial summary of revenues, disbursements, and fund balances. | Periodic financial review and DepEd fiscal quarter auditing. | Administrator |
| **Annual Report** | Full-year operational summary covering all operating months. | Year-end school liquidation and financial audit reporting. | Administrator |
| **School Year Report** | 12-month June-to-May comprehensive financial balance sheet. | Formal turnover report between school years. | Administrator |
| **Sales Report** | Itemized breakdown of daily and monthly counter revenue. | Evaluates student purchasing trends and best-selling menu items. | Administrator |
| **Expense Report** | Itemized ledger of all operating disbursements across the 7 categories. | Monitors operational overhead (gas, transport, repairs). | Administrator |
| **Cash Flow Report** | Cash inflows, outflows, starting reserves, and ending balances. | Ensures liquidity for daily market purchases. | Administrator |
| **Profit Report** | Gross margin, operating expense ratio, and net surplus tracking. | Assesses financial sustainability of canteen operations. | Administrator |

### Step 15.1: Live Demonstration of Report Generation
* **ACTION:** Click **Reports** in the sidebar (`/reports`). Select **Monthly Report**, choose the active School Year and Month, and click **Preview**.
* **EXPLANATION:** Show the on-screen rendered statement formatted according to Bay Central Elementary School standards, complete with signature lines for the Canteen Manager and School Principal.
* **ACTION:** Click **Export to Excel (`.xlsx`)**.
* **EXPECTED RESULT:** The browser immediately downloads a formatted spreadsheet file (`.xlsx`) containing the structured accounting data.
* **ACTION:** Click **Print / Official PDF**.
* **EXPECTED RESULT:** The system generates a clean, printable DepEd report layout and opens the print dialog with zero UI clutter.
* **DEFENSE LINE:**  
  > *"With a single click, the canteen manager can preview, export to Excel, or print official DepEd financial statements ready for signature and submission to the Principal."*

---

## 16. Actual User Management

### Step 16.1: Creating and Managing Accounts
* **ACTION:** Navigate to **User Management** (`/accounts`). Click **+ Add User**.
* **EXPLANATION:** Show account creation: enter username `cashier2`, full name `Maria Santos`, select role `Cashier`, enter initial password, and click **Create Account**.
* **EXPECTED RESULT:** The new account appears in the accounts list with a blue "Cashier" badge and active status.
* **ACTION:** Point to the **Password Reset Requests** and **Recovery Requests** tabs.
* **EXPLANATION:** Explain that if staff forget credentials, requests appear here for administrative approval or decline, preventing unauthorized account overrides.
* **DEFENSE LINE:**  
  > *"User management is fully centralized. Administrators can create accounts, assign roles, de-escalate privileges, and review password reset requests securely."*

---

## 17. Complete End-to-End Demonstration Scenario

*(Follow this seamless live sequence during the defense to show real canteen operations)*

```text
  [6:30 AM: Admin/Staff Login & Dashboard Check]
                    │
                    ▼
  [7:00 AM: Check Inventory & Cook Morning Batch]
                    │
                    ▼
  [7:30 AM - 1:00 PM: POS Counter Sales & Recess Checkout]
                    │
                    ▼
  [2:30 PM: Check Remaining Unsold Perishable Food]
                    │
                    ▼
  [3:00 PM: Closing Reconciliation & Food Waste Reset]
                    │
                    ▼
  [3:30 PM: Record Daily Operating Expenses & Fuel]
                    │
                    ▼
  [4:00 PM: Review Financial Overview & Export Reports]
                    │
                    ▼
  [4:30 PM: Check XGBoost Demand Forecast for Tomorrow]
```

### Scripted Sequence:
1. **6:30 AM (Start of Day):** Log in as Admin. Review the Operational Dashboard for out-of-stock notices.
2. **7:00 AM (Morning Kitchen Batch):** Navigate to **Inventory**. Record 30 bowls of prepared Arroz Caldo under Stock Replenishment. Stock becomes 30.
3. **9:30 AM (Morning Recess Sales):** Log in as Cashier (or switch to `/pos`). Process 2 student transactions totaling 5 bowls of Arroz Caldo. Cash is tendered, change computed, and receipts printed.
4. **2:30 PM (Afternoon Closing):** Return to **Inventory**. 4 bowls remain unsold at the end of the school day.
5. **3:00 PM (Closing Reconciliation):** Open **🍲 End-of-Day Perishable Food Reset**. Mark the 4 remaining bowls as `"waste_spoiled"` with remarks *"Unsold after lunch"*. Stock resets to 0, and waste is logged.
6. **3:30 PM (Daily Expense):** In **Financial Management**, record an expense of PHP 200.00 for cooking ingredients under Supplies with a receipt attached.
7. **4:00 PM (Financial Summary):** View the **Financial Overview** tab. Verify that sales and expenses automatically updated the day's net profit.
8. **4:30 PM (AI Tomorrow Prep):** Open **Demand Forecast** (`/predictions`). View the XGBoost recommended prep count for tomorrow so the kitchen knows exactly how many bowls to cook.

---

## 18. System Testing Plan

| Category | Modules Tested | Objective | Test Technique |
| :--- | :--- | :--- | :--- |
| **A. Authentication** | `/login`, `/admin/setup-2fa` | Verify session creation, bcrypt hashing, TOTP validation, and lockout. | Black-box & Boundary Testing |
| **B. RBAC & Security** | Routes, API Endpoints | Ensure users cannot access views or API endpoints outside their role. | Negative Route Traversal Testing |
| **C. Product & Inventory**| `/inventory` | Verify product creation, unit types, replenish, adjust, and stock limits. | Equivalence Partitioning |
| **D. Perishable Food** | `/inventory`, Reset Modal | Verify end-of-day zeroing, waste logging, and cost attribution. | Operational Lifecycle Testing |
| **E. POS & Transactions** | `/pos`, `/transactions` | Verify cart math, discount handling, cash change, and receipt data. | Calculation & Transaction Testing |
| **F. Financial Records** | `/financial-management` | Validate accounting formulas: Gross, Expenses, Net, and Carry-forward. | Mathematical Verification |
| **G. AI Prediction** | `/predictions`, `ml_predictor.py` | Verify XGBoost inference, fallback heuristic, and weather/event multipliers. | Model Robustness & Fallback Testing |
| **H. Reporting & Exports**| `/reports` | Verify data consistency across screen, Excel workbook, and printed PDF. | Output Fidelity Testing |

---

## 19. Detailed Test Cases

### Positive Test Cases

#### Test Case TC-AUTH-01: Valid Administrator Login with TOTP 2FA
* **Feature:** Authentication
* **Purpose:** Verify successful login for administrative accounts using password and 6-digit TOTP code.
* **Precondition:** Admin account exists with 2FA enabled.
* **Steps:**
  1. Open `/login`.
  2. Input valid admin username and password. Click **Sign In**.
  3. Enter the current 6-digit code from Google Authenticator. Click **Verify Code**.
* **Expected Result:** Token is generated, user session is initialized, and browser redirects to `/admin/dashboard`.
* **Actual Result:** PASS.
* **Defense Explanation:** Proves multi-factor security protecting administrative privileges.

#### Test Case TC-INV-01: Perishable Batch Replenishment
* **Feature:** Inventory Replenishment
* **Purpose:** Verify morning stock setup increases available inventory and records an audit log.
* **Precondition:** Perishable product exists with current stock of 0.
* **Steps:**
  1. Open `/inventory`. Click **Replenish Stock**.
  2. Select *Arroz Caldo with Egg*.
  3. Input Quantity = `30`, Remarks = *"Morning Batch"*. Click **Confirm**.
* **Expected Result:** Product stock updates to `30.0`. Stock status changes to "In Stock". Log entry created in `inventory_logs`.
* **Actual Result:** PASS.
* **Defense Explanation:** Demonstrates that kitchen batch cooking is immediately tracked in the system.

#### Test Case TC-POS-01: POS Cash Transaction and Change Computation
* **Feature:** Point of Sale
* **Purpose:** Verify cart item addition, subtotal calculation, and exact change calculation.
* **Precondition:** Products are in stock.
* **Steps:**
  1. Open `/pos`. Add 2 units of item priced at PHP 25.00 to cart.
  2. Verify subtotal equals PHP 50.00.
  3. Enter Amount Received = `100.00`.
  4. Click **Complete Cash Sale**.
* **Expected Result:** Change is computed as `PHP 50.00`. Sale is persisted, receipt modal appears, and transaction is logged.
* **Actual Result:** PASS.
* **Defense Explanation:** Proves accuracy in counter transactions with automatic mathematical calculations.

#### Test Case TC-PERISH-01: End-of-Day Perishable Food Reset
* **Feature:** Food Waste Management
* **Purpose:** Verify unsold perishable stock is zeroed out and food waste reasons are logged.
* **Precondition:** Perishable item has 4 unsold units remaining at closing.
* **Steps:**
  1. Open `/inventory`. Click **🍲 End-of-Day Perishable Food Reset**.
  2. Locate item with 4 unsold units. Select disposition `"Spoiled / Food Waste"`.
  3. Click **Confirm Reset**.
* **Expected Result:** Stock updates to `0.0`. An adjustment record with quantity `-4.0` is saved with reason `"Daily Food Waste: Spoiled / Food Waste"`.
* **Actual Result:** PASS.
* **Defense Explanation:** Shows how the system prevents stale stock from carrying over to the next day while tracking waste cost.

#### Test Case TC-REP-01: Monthly DepEd Report Excel Export
* **Feature:** Reports & Exports
* **Purpose:** Verify that recorded sales and expenses export directly into an Excel `.xlsx` file.
* **Precondition:** Financial data exists for the selected month.
* **Steps:**
  1. Open `/reports`. Select **Monthly Report** for the active School Year.
  2. Click **Export to Excel (`.xlsx`)**.
* **Expected Result:** Browser triggers immediate download of `.xlsx` spreadsheet matching DepEd table columns.
* **Actual Result:** PASS.
* **Defense Explanation:** Shows elimination of manual re-typing of financial reports.

---

### Negative Test Cases

#### Test Case TC-NEG-01: Unauthorized Route Access (RBAC Enforcement)
* **Feature:** Role-Based Access Control
* **Purpose:** Verify a Cashier cannot access Financial Management or User Accounts.
* **Precondition:** Logged in as a user with the `cashier` role.
* **Steps:**
  1. Attempt to navigate directly in the browser address bar to `http://localhost:5173/financial-management` or `/accounts`.
* **Expected Result:** Route guard intercepts navigation and redirects cashier back to `/pos` or `/dashboard`.
* **Actual Result:** PASS.
* **Defense Explanation:** Proves strict security boundaries preventing unauthorized viewing of school finances.

#### Test Case TC-NEG-02: POS Checkout with Insufficient Cash
* **Feature:** Point of Sale Validation
* **Purpose:** Verify cashier cannot submit a sale when cash tendered is less than total amount due.
* **Precondition:** POS cart total is PHP 100.00.
* **Steps:**
  1. Open `/pos`. Cart total = PHP 100.00.
  2. Input Amount Received = `50.00`.
* **Expected Result:** System disables the "Complete Cash Sale" button and displays a warning indicating insufficient cash.
* **Actual Result:** PASS.
* **Defense Explanation:** Prevents cash shortages and negative transaction records.

#### Test Case TC-NEG-03: Submitting Negative Product Stock
* **Feature:** Product Management
* **Purpose:** Verify system rejects negative inventory values.
* **Precondition:** Add/Edit product modal open.
* **Steps:**
  1. Input Stock = `-10` or Selling Price = `-5`.
  2. Attempt to click **Add Product**.
* **Expected Result:** HTML5 and schema validations block submission, displaying `"Must be greater than or equal to 0"`.
* **Actual Result:** PASS.
* **Defense Explanation:** Ensures inventory integrity by preventing corrupted negative quantities.

---

## 20. Live Testing Script for Defense

*(Use this concise script when the panel asks for immediate proof of system functionality)*

> **Presenter:**  
> *"Honorable panel members, to prove the stability and integrity of MEALS, we will now execute three live representative test cases: an inventory stock replenishment, a point-of-sale cash transaction, and an end-of-day perishable food waste reset."*

### Test 1: Morning Stock Replenishment
* **ACTION:** Navigate to `/inventory`. Click `+ Replenish Stock`. Select *Pancit Canton*, enter `20` pieces, and click **Confirm**.
* **EXPECTED RESULT:** The stock count updates instantly to 20, and the status changes to green "In Stock".
* **WHAT TO SAY:**  
  > *"As seen on screen, the morning replenishment of 20 pieces was successfully committed to the database and reflected on the inventory dashboard."*

### Test 2: Counter Checkout & Change Calculation
* **ACTION:** Open `/pos`. Add 2 portions of *Pancit Canton* (PHP 40.00). Enter `PHP 100.00` cash received. Click **Complete Cash Sale**.
* **EXPECTED RESULT:** Change displays as `PHP 60.00`. The receipt modal appears.
* **WHAT TO SAY:**  
  > *"The counter checkout processed the order, computed the exact change of PHP 60.00, and logged the transaction into the sales audit register."*

### Test 3: Closing Food Waste Reconciliation
* **ACTION:** Return to `/inventory`. Click `🍲 End-of-Day Perishable Food Reset`. For remaining unsold items, select `"Spoiled / Food Waste"` and click **Confirm**.
* **EXPECTED RESULT:** Stock resets to 0. A food waste record is appended to Stock History.
* **WHAT TO SAY:**  
  > *"In our closing test, the unsold perishable items are safely cleared to zero, and the waste is logged with full accountability for afternoon audit."*

---

## 21. Possible Panel Questions and Answers

#### Q1: "Why do you need a specialized canteen system when ordinary retail POS systems already exist?"
> **Answer:**  
> *"Ordinary retail POS systems are designed for non-perishable barcoded items like canned goods or soap that sit on shelves for months. School canteens prepare fresh cooked meals like arroz caldo or pancit that spoil if unsold by afternoon dismissal. MEALS is specifically customized for school canteen operations: it includes daily batch prep tracking, end-of-day perishable food waste reconciliation, and built-in DepEd monthly financial and fund allocation reporting."*

#### Q2: "How exactly does your AI prediction work, and what happens if there is no historical data yet?"
> **Answer:**  
> *"Our AI uses an **XGBoost (Extreme Gradient Boosting)** regression model. It takes historical daily sales and analyzes weekday demand patterns, temperature, weather conditions, and school events like exam weeks or intramurals. If the system is newly installed and historical data is limited, MEALS automatically falls back to an intelligent heuristic baseline using moving averages and day-of-week multipliers until enough training data is accumulated."*

#### Q3: "What prevents a cashier from manipulating or viewing sensitive school financial records?"
> **Answer:**  
> *"MEALS enforces strict Role-Based Access Control both on the React frontend and via FastAPI token dependencies in the backend. When a Cashier logs in, the navigation sidebar only displays the POS checkout and recent transaction history. If a cashier attempts to access `/financial-management` or `/accounts` directly via URL manipulation, the system immediately blocks access and redirects them to their designated workstation."*

#### Q4: "How does the system ensure data security and accountability for financial adjustments?"
> **Answer:**  
> *"All administrative actions, login attempts, inventory stock adjustments, and expense entries are automatically captured in our immutable **Audit Log** (`/audit`). The audit record logs the exact user ID, role, action type, IP address, and timestamp. Furthermore, administrative accounts require Two-Factor Authentication (TOTP), preventing unauthorized access even if a password is compromised."*

#### Q5: "What happens if the internet connection or school network goes down during recess?"
> **Answer:**  
> *"The POS module is equipped with an offline transaction cache (`offlineStore.js`). If the network disconnects, the cashier can continue ringing up cash sales without interruption. Transactions are stored locally in the browser and automatically synchronize with the server database as soon as the connection is restored."*

#### Q6: "Why doesn't the POS automatically deduct cooked food portion stock in real time during the recess rush?"
> **Answer:**  
> *"In a fast-paced school canteen recess where hundreds of students order within 15 minutes, cooked food is served in varying ladle portion sizes, combo plates, and student meal packages. Requiring strict real-time itemized deductions often creates stock discrepancies. Instead, MEALS uses the standard canteen operating procedure: morning batch logging followed by an afternoon physical closing reconciliation where unsold portions are counted, cleared, and logged as food waste."*

---

## 22. Actual Limitations

To ensure honesty and academic defensibility, the following current system boundaries are acknowledged:

1. **Cash-Centric Counter Transactions:** The system currently processes physical cash payments with change computation. It does not integrate online digital payment gateways (such as GCash or Maya) due to elementary student cash-handling realities.
2. **Barcode Scanner Decoupling:** While barcode fields exist in the database for packaged retail snacks, daily cooked foods (viands, soups) rely on quick-tap touchscreen buttons rather than barcode stickers.
3. **Local Network / Self-Hosted Deployment:** The system is currently designed for on-premise local area network (LAN) canteen operation or standard web hosting, rather than a multi-tenant cloud SaaS spanning multiple school districts.
4. **Offline Mode Scope:** The offline transaction queue supports POS cash sales; administrative operations (financial report generation and user account creation) require an active database connection.

---

## 23. Future Enhancements

The following proposed extensions represent planned future developments:

1. **Automated DepEd Form 8 Prescribed Template Sync:** Integrating direct export into the exact DepEd Form 8 Excel layout with pre-filled district header metadata.
2. **RFID / Student Meal Card Tap Integration:** Introducing student NFC/RFID canteen cards linked to parental daily allowances to speed up recess queues.
3. **Kitchen Ingredient Recipe Breakdown (BOM):** Automatically calculating ingredient deduction (e.g., kilograms of rice and chicken) based on cooked meal batch quantities.
4. **Automated Weather API Synchronization:** Expanding the Open-Meteo integration to fetch real-time local weather forecasts automatically every morning at 5:00 AM without manual selection.

---

## 24. Final Defense Closing

*(To be delivered by the capstone team at the conclusion of the presentation)*

> *"Honorable members of the panel, MEALS was built to address the real, day-to-day realities of Bay Central Elementary School's canteen.  
> 
> By bridging the gap between morning food preparation, fast counter sales, and afternoon perishable food waste reconciliation, the system provides school canteen personnel with tools tailored to their unique operational needs. At the same time, it automates tedious monthly DepEd financial statements, protects administrative security through two-factor authentication, and leverages machine learning to make morning food preparation smarter and less wasteful.  
> 
> The system you witnessed today is fully operational, thoroughly tested, and ready to serve the school community.  
> 
> Thank you very much, and we are now ready for your questions and critiques."*
