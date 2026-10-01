# MEALS: Management of Expenses, Assets, and Logistics System
## Capstone Defense Walkthrough & Live Testing Script
**Focus Area:** Canteen Inventory Management & DepEd Financial Accounting  
**Institution:** Bay Central Elementary School  
**System Name:** MEALS (*Management of Expenses, Assets, and Logistics System*)  
**Document Purpose:** Official Capstone Defense Script, Live Demonstration Guide, and Verification Test Matrix

---

## 1. System Profile & Core Academic Scope

### 1.1 Context and Problem Statement
Public elementary school canteens operate under strict Department of Education (DepEd) operational and financial governance (**DepEd Order No. 8, s. 2007** — *Revised Implementing Guidelines on the Management and Operation of Public School Canteens*). Unlike standard commercial retail stores that stock pre-packaged barcoded merchandise, an elementary school canteen faces two interrelated core operational challenges:

1. **Daily Perishable Inventory & Food Waste Control:** The canteen prepares, cooks, and serves hot morning meals and snacks (e.g., *Arroz Caldo with Egg, Pancit Bihon, Champorado, Ginataang Halo-halo*). These perishable items are cooked fresh every morning and cannot be held over to the following school day. Manual systems struggle with stock tracking and closing reconciliation, leading to untracked food spoilage waste and lost school funds.
2. **DepEd-Mandated Financial Accounting & Statutory Fund Monitoring:** Canteen financial tracking is structured on a strict **12-month academic school year cycle (June to May)**. Canteen administrators are legally required to prepare monthly financial statements categorizing expenses across seven standardized operational classifications, compute Cost of Goods Sold (COGS), derive Net Operational Surplus, and distribute profits across statutory school funds (Supplementary Feeding 35%, School Operating Fund 25%, Faculty/Student Development 15%, H.E. Instructional Fund 10%, Revolving Capital Fund 10%, and School Clinic 5%).

### 1.2 Delimitation: Focus on Inventory & Financial Management
The primary academic and engineering focus of this capstone defense is strictly centered on **Inventory Optimization and DepEd Financial Management**.

The demonstration emphasizes:
- Raw ingredient and cooked meal inventory tracking (Pieces vs. Bulk `kg/g/L/mL`).
- Morning kitchen preparation batch replenishment and real-time safety reorder thresholds.
- Afternoon perishable food waste reconciliation and waste cost attribution.
- Categorized DepEd operating expense disbursements with digital receipt validation.
- Automated monthly statement generation (Beginning Cash + Sales - Cost of Sales - Expenses = Net Surplus).
- Statutory fund allocation with automatic month-to-month balance carry-forward.
- Official multi-format exports (`.xlsx` Excel spreadsheets and signed official DepEd PDF reports).

---

## 2. Actual Implemented Features Matrix

Based on direct inspection of the live source code (`smartcanteen/src/views/Inventory.jsx`, `smartcanteen/src/views/FinancialReports.jsx`, and backend modules `backend/financial_reports.py` and `backend/inventory.py`), every capability below is verified and fully functional:

| Module / Subsystem | Where It Is Located | What It Does in the System | User Who Can Access It | Implementation Status |
| :--- | :--- | :--- | :--- | :--- |
| **DepEd School Year Manager** | `/school-years` or `/financial-management` | Configures 12-month June-to-May academic periods, activates the active school year, archives past years as read-only, and sets opening cash-on-hand balances. | Administrator | **IMPLEMENTED** |
| **Product & Material Catalog** | `/inventory` (Tab 1: Products & Stock) | Manages food items and raw materials. Configures Unit Types (`PCS` vs Bulk `kg`, `g`, `L`, `mL`), Cost Price, Selling Price, Low Stock Safety Threshold (`min_stock`), and Perishable classification. | Administrator, Canteen Staff | **IMPLEMENTED** |
| **Kitchen Batch Replenishment** | `/inventory` (`+ Replenish Stock`) | Logs incoming supplier shipments and morning cooking batches. Increases stock on hand and writes an immutable audit record to `inventory_logs`. | Administrator, Canteen Staff | **IMPLEMENTED** |
| **Stock Manual Adjustment** | `/inventory` (`Adjust Stock`) | Records stock corrections with specific audit justifications: *Damaged, Spoilage, Shrinkage, Audit Recount, Kitchen Prep Spill*. | Administrator, Canteen Staff | **IMPLEMENTED** |
| **Perishable Food Waste Reset** | `/inventory` (`🍲 End-of-Day Perishable Food Reset`) | Identifies unsold perishable items at closing, clears stock to zero, and records waste dispositions (*Spoiled / Food Waste*, *Staff Meal Consumed*, *Donated*) with calculated waste loss costs. | Administrator, Canteen Staff | **IMPLEMENTED** |
| **Stock Alerts & Safety Levels** | `/inventory` (Tab 2: Alerts) & Header Bell | Real-time monitoring of Out-of-Stock and Low-Stock items below safety thresholds, offering 1-click replenishment shortcuts. | Administrator, Canteen Staff | **IMPLEMENTED** |
| **Inventory Movement Audit Log** | `/inventory` (Tab 3: Stock History) | Chronological audit ledger recording every inventory modification, movement type (`replenishment`, `adjustment`, `sale`, `correction`), quantity delta, before/after values, and user attribution. | Administrator, Canteen Staff | **IMPLEMENTED** |
| **7-Category Operating Expenses**| `/financial-management` (Tab: Expenses) | Logs operational disbursements categorized into the 7 official DepEd classifications (*Transportation/Freight, Gas, Supplies, Helpers, Repair, Looses of Tools, Other Expenses*) with vendor details and remarks. | Administrator | **IMPLEMENTED** |
| **Receipt Upload & Sanitizer** | `/financial-management` (Expense Modal) | Uploads digital receipt images/PDFs. Validates MIME type, sanitizes filenames, stores in local storage/backend, and displays zoomable modal preview. | Administrator | **IMPLEMENTED** |
| **Monthly Financial Statement** | `/financial-management` (Tab: Overview) | Computes complete monthly DepEd accounting statement: Beginning Cash, Gross Sales, Cost of Sales, Gross Income, Operating Expenses, Net Profit, and Current Balance. | Administrator | **IMPLEMENTED** |
| **DepEd Statutory Fund Allocation**| `/financial-management` (Tab: Fund Allocation) | Distributes monthly net profit into DepEd statutory funds (Feeding 35%, Operating 25%, Dev 15%, HE 10%, Capital 10%, Clinic 5%) with automated month-to-month forward-balance rolling. | Administrator | **IMPLEMENTED** |
| **DepEd Multi-Format Reporting** | `/reports` | Generates 8 distinct financial reports (Monthly, Quarterly, Annual, School Year, Sales, Expense, Cash Flow, Profit). Direct export to `.xlsx` Excel spreadsheets and signed official PDF format. | Administrator | **IMPLEMENTED** |
| **Security & Two-Factor Auth** | `/login`, `/admin/setup-2fa`, `/audit` | Protects financial ledgers with bcrypt password hashing, mandatory TOTP 2FA for Admin, session timeout, and immutable security audit logs with IP addresses. | Administrator | **IMPLEMENTED** |

---

## 3. User Roles and Access Control (RBAC)

The system enforces strict role-based separation between financial governance and kitchen stock custody:

```text
               ┌────────────────────────────────────────────────────────┐
               │              Canteen Administrator (Admin)             │
               │   • Full Financial Authority & DepEd Fund Allocations │
               │   • Product Catalog, Costing & Inventory Auditing      │
               │   • 12-Month Academic School Year & Reporting          │
               │   • Security & User Access Control                     │
               └───────────────────────────┬────────────────────────────┘
                                           │
                                           ▼
               ┌────────────────────────────────────────────────────────┐
               │                  Canteen Staff (Kitchen)               │
               │   • Morning Batch Replenishment & Inward Receiving     │
               │   • Stock Adjustment (Damage, Kitchen Prep Spills)     │
               │   • Afternoon Perishable Food Waste Reconciliation     │
               │   • Stock Alert & Low Inventory Monitoring             │
               │   • NO ACCESS to Financial Statements or Allocations   │
               └────────────────────────────────────────────────────────┘
```

### Role-Permission Matrix

| Functional Area / Route | Administrator (`admin`) | Canteen Staff (`staff`) | Reason for Permission Boundary |
| :--- | :---: | :---: | :--- |
| **Default Landing Route** | `/admin/dashboard` | `/inventory` | Staff is routed immediately to kitchen inventory; Admin to financial control. |
| **Admin Financial Dashboard** | Full Access | No Access | Confidential school financial reserves must not be visible to kitchen staff. |
| **Product Catalog & Costing** | Full Access | Full Access | Both need to view/edit portion sizes, unit types, and reorder levels. |
| **Stock Replenishment & Adjust** | Full Access | Full Access | Kitchen staff record morning cooking batches and physical spoilage counts. |
| **End-of-Day Perishable Reset**| Full Access | Full Access | Canteen kitchen staff physically verify and zero out unsold cooked portions. |
| **Operating Expenses & Receipts**| Full Access | No Access | Disbursing school canteen funds and uploading expense vouchers is restricted to Admin. |
| **School Year Configuration** | Full Access | No Access | Academic year boundaries and opening bank balances require administrative sign-off. |
| **DepEd Financial Reports** | Full Access | No Access | Official statements submitted to the Principal and Division Office require Admin role. |

---

## 4. Opening Defense Presentation Script

*(To be delivered with authority and clarity by the capstone group leader and members)*

> **Group Leader:**  
> *"Good morning, esteemed members of the panel, our research adviser, and academic colleagues. We are proud to present our capstone project: **MEALS — Management of Expenses, Assets, and Logistics System**, designed and implemented specifically for **Bay Central Elementary School**.*
> 
> *Public elementary school canteens occupy a unique and challenging operational position. Unlike typical commercial businesses, elementary school canteens prepare and serve **freshly cooked perishable meals** — such as arroz caldo, sopas, pancit, and fresh snacks. These items have a shelf life of only a single school day.*
> 
> *In our initial baseline study at Bay Central Elementary School, we discovered two major administrative bottlenecks:*  
> 1. *First, **untracked daily food preparation and perishable spoilage**, where kitchen staff lacked a structured mechanism to record morning cooking batches, monitor remaining portions, and reconcile unsold food at dismissal, resulting in undocumented waste.*  
> 2. *Second, **onerous, paper-based DepEd financial accounting**. Under DepEd Order No. 8, s. 2007, the canteen manager must manually calculate Cost of Sales, categorize operating expenses across seven line items, and distribute net income into six statutory school funds across a 12-month June-to-May school year. A single arithmetic error in September cascaded throughout the entire school year's balance sheet.*
> 
> **Co-Presenter:**  
> *MEALS resolves both problems by integrating a responsive **Inventory Control System** with an automated **DepEd-Compliant Financial Management Platform**.*  
> 
> *Our system tracks stock from raw ingredients to cooked batches, enforces an afternoon perishable waste reconciliation protocol, automates all DepEd accounting formulas, guarantees forward-balance continuity across statutory funds, and provides real-time auditability across all stock movements and financial disbursements.*
> 
> *We will now walk you through the live system, demonstrating how inventory operations flow directly into verified DepEd financial statements."*

---

## 5. Walkthrough Phase 1: Security & Financial Data Governance

### Step 5.1: Accessing the Admin Authentication Portal
* **NAVIGATE TO:** `/login`
* **PROCEDURE:** Enter the Administrator username and password. Click **Sign In**.
* **SECURITY CHALLENGE:** The system prompts for a 6-digit Time-Based One-Time Password (TOTP) from Google Authenticator. Enter the active TOTP code.
* **VERIFICATION:** Session token is issued, and the user is redirected to the Financial Control Center at `/admin/dashboard`.
* **DEFENSE EXPLANATION:**  
  > *"Because MEALS manages legal school funds and audited DepEd allocations, administrative accounts require mandatory Two-Factor Authentication. Even if a password is compromised, school financial statements and opening bank balances remain strictly protected."*

---

## 6. Walkthrough Phase 2: DepEd 12-Month Academic Structure

### Step 6.1: School Year Setup & Opening Balance Initialization
* **NAVIGATE TO:** `/school-years` or `/financial-management` (Mode: `school-years`)
* **DEMONSTRATE:**
  1. Show the configured active school year: **S.Y. 2024–2025 (June to May)**.
  2. Point out that the system automatically structures the academic year into 12 individual monthly financial periods starting in June and concluding in May.
  3. Show the **Opening Beginning Cash on Hand** configuration (e.g., `PHP 11,834.59`).
  4. Point out the **Add Historical Year** button and the **Archive School Year** safeguard.
* **DEFENSE EXPLANATION:**  
  > *"Under DepEd canteen guidelines, financial accountability follows the June-to-May academic calendar rather than the January-to-December fiscal calendar. MEALS isolates records by school year so that past years remain locked and immutable for auditor inspection, while opening balances seamlessly carry over."*

---

## 7. Walkthrough Phase 3: Product Catalog & Unit Configuration

### Step 7.1: Managing Food Items and Safety Thresholds
* **NAVIGATE TO:** `/inventory` (Tab 1: **Products & Stock**)
* **DEMONSTRATE:** Click `+ Add Product` (or inspect an existing item, e.g., *Arroz Caldo with Egg*):
  * **Product Name:** `Arroz Caldo with Egg`
  * **Category:** `Staple (Rice/Noodles)` or `Soup`
  * **Unit Type:** Demonstrate the difference between **Pieces (`PCS`)** for cooked meal portions and **Bulk (`kg`, `g`, `L`, `mL`)** for kitchen raw ingredients (e.g., Rice, Cooking Oil, Sugar).
  * **Perishable Food Toggle:** Check the `Perishable Food` checkbox.
  * **Cost Price vs. Selling Price:** Cost Price = `PHP 15.00`, Selling Price = `PHP 25.00` (establishing a gross profit margin of PHP 10.00 per unit).
  * **Low Stock Warning Level (`min_stock`):** Set to `10` units.
* **DEFENSE EXPLANATION:**  
  > *"Our inventory module explicitly distinguishes between non-perishable packaged items and daily cooked perishables. Marking an item as 'Perishable Food' signals the system that any remaining portions at closing must be reconciled as food waste rather than carried over on the shelf."*

---

## 8. Walkthrough Phase 4: Morning Kitchen Batch Replenishment

### Step 8.1: Inward Stock Replenishment
* **NAVIGATE TO:** `/inventory`
* **PROCEDURE:**
  1. Identify *Arroz Caldo with Egg* with current stock at `0.00`.
  2. Click the green `+ Replenish Stock` button.
  3. Select *Arroz Caldo with Egg*.
  4. Input Quantity: `30` portions.
  5. Date: Select today's date.
  6. Remarks: *"Morning kitchen cooking batch — 30 bowls"*.
  7. Click **Confirm Replenishment**.
* **VERIFICATION:**
  * The product's stock immediately increases from `0` to `30`.
  * The status badge updates from a red **Out of Stock** badge to a green **In Stock** badge.
  * Switch to **Tab 3: Stock History** and point out the new log entry: Movement Type = `replenishment`, Quantity = `+30.00`, User = `Admin`, Remarks recorded.
* **DEFENSE EXPLANATION:**  
  > *"Every morning at 6:30 AM, canteen kitchen staff record the number of cooked meal portions prepared for the day. This provides full accountability: we know exactly how many portions entered the kitchen before the recess bell rings."*

---

## 9. Walkthrough Phase 5: Stock Alerts & Manual Adjustments

### Step 9.1: Live Safety Reorder Alerts
* **NAVIGATE TO:** `/inventory` (Tab 2: **Alerts**)
* **DEMONSTRATE:**
  * Show the two dedicated alert panels: **Out of Stock Items** and **Low Stock Warning Items**.
  * Point out how items with stock below their configured `min_stock` threshold are prominently flagged with amber badges.
  * Click the `Replenish` shortcut directly from the alert card.

### Step 9.2: Stock Adjustment with Cause Tracking
* **PROCEDURE:**
  1. Click **Adjust Stock** on an inventory item (e.g., *Bottled Calamansi Juice* or *Eggs*).
  2. Select Adjustment Type: `Deduct`.
  3. Enter Quantity: `2`.
  4. Select Reason: Show the dropdown options — `Damaged`, `Spoilage`, `Shrinkage`, `Kitchen Prep Spill`, `Audit Recount`.
  5. Select `Kitchen Prep Spill` and enter Remarks: *"Accidentally dropped during morning prep"*.
  6. Click **Confirm Adjustment**.
* **VERIFICATION:** Stock decreases by 2. The event is permanently etched into the audit ledger with the exact reason.
* **DEFENSE EXPLANATION:**  
  > *"In kitchen environments, accidental spills and cracked eggs are inevitable. Instead of fudging numbers at month-end, staff log the exact reason for the adjustment, creating transparency for school canteen audits."*

---

## 10. Walkthrough Phase 6: Closing Perishable Food Waste Reconciliation

### Step 10.1: Executing the End-of-Day Perishable Reset
* **NAVIGATE TO:** `/inventory`
* **PROCEDURE:**
  1. Click the button: `🍲 End-of-Day Perishable Food Reset`.
  2. The system scans all active products flagged as `is_perishable` that still hold remaining stock.
  3. Show *Arroz Caldo with Egg*: of the 30 bowls cooked in the morning, 26 were consumed during the day, leaving **4 unsold bowls** in the food warmer.
  4. For the 4 unsold bowls, select the Disposition:
     * `waste_spoiled` (*Spoiled / Food Waste*)
     * `staff_meal` (*Staff Meal Consumed*)
     * `donated` (*Donated*)
  5. Select `waste_spoiled` and enter Remarks: *"Unsold portions remaining at 3:30 PM dismissal"*.
  6. Click **Confirm Reset**.
* **VERIFICATION:**
  * Stock of *Arroz Caldo with Egg* resets cleanly to `0.00`.
  * In **Stock History**, an immutable entry is logged: Movement Type = `adjustment`, Quantity = `-4.00`, Reason = `"Daily Food Waste: Spoiled / Food Waste"`.
  * The financial food waste loss (4 portions × PHP 15.00 cost price = PHP 60.00) is archived in the inventory waste log for administrative review, waste cost auditing, and operational optimization.
* **DEFENSE EXPLANATION:**  
  > *"This is a key innovation in MEALS. Standard inventory systems let perishable food sit in digital inventory indefinitely. MEALS enforces an end-of-day closing reconciliation protocol that resets perishable inventory to zero, captures exact food waste metrics, and calculates the true financial cost of unsold cooked meals."*

---

## 11. Walkthrough Phase 7: 7-Category DepEd Operating Expenses & Receipt Audit

### Step 11.1: Recording an Operational Disbursement with Receipt Verification
* **NAVIGATE TO:** `/financial-management` (Select Tab: **Expenses**)
* **PROCEDURE:**
  1. Click **+ Add Expense** (or use the inline Record Expense form).
  2. Review the seven official DepEd operational expense categories:
     * `Transportation/Freight`
     * `Gas` (LPG cooking fuel)
     * `Supplies` (Detergent, paper plates, food wrap)
     * `Helpers` (Canteen utility labor)
     * `Repair` (Stove, refrigerator maintenance)
     * `Purchase from the looses of tools` (Replacement of ladles, knives, plates)
     * `Other expenses`
  3. Enter the test expense:
     * **Expense Type:** `Daily Expense`
     * **Category:** `Gas`
     * **Amount:** `PHP 1,100.00`
     * **Supplier:** `Bay Central LPG Gas Trading`
     * **Description:** `11kg LPG cooking gas tank refill for kitchen burner`
     * **Date:** Today's date
  4. **Receipt Upload:** Click Choose File and attach a sample invoice/receipt image (`sample_receipt.png`). Show that the system sanitizes the file name, verifies the image, and uploads it.
  5. Click **Add Daily Expense**.
* **VERIFICATION:**
  * The expense is recorded into the database and appears at the top of the paginated expense ledger.
  * Click the **View Receipt / Eye Icon**: The **Receipt Preview Modal** opens, rendering the uploaded image with zoom and download capabilities.
  * The monthly Operating Expenses total on the dashboard and overview increases by exactly `PHP 1,100.00`.
* **DEFENSE EXPLANATION:**  
  > *"DepEd auditors require physical proof for every operational disbursement. MEALS digitizes this paper trail: expenses are categorized into the 7 DepEd budget lines, linked to supplier vouchers, and accompanied by digital receipt images that can be reviewed in seconds."*

---

## 12. Walkthrough Phase 8: DepEd Monthly Statement & Accounting Math

### Step 12.1: Automated Financial Statement Calculations
* **NAVIGATE TO:** `/financial-management` (Select Tab: **Overview**)
* **EXPLANATION OF FORMULAS:** Show the panel how MEALS computes the complete DepEd financial equation without human manual intervention:

$$\text{Gross Income} = \text{Current Sales} - \text{Cost of Sales}$$
$$\text{Total Operating Expenses} = \sum_{i=1}^{7} \text{Category Expenses}_i$$
$$\text{Over All Net Profit} = \text{Gross Income} - \text{Total Operating Expenses}$$
$$\text{Current Balance} = \text{Beginning Cash on Hand} + \text{Net Profit}$$

* **LIVE CALCULATION VERIFICATION:**
  * Beginning Cash on Hand: `PHP 11,834.59`
  * Current Sales: `PHP 39,840.00`
  * Cost of Sales: `PHP 31,872.00`
  * **Gross Income:** $39,840.00 - 31,872.00 = \mathbf{PHP\ 7,968.00}$
  * Total Operating Expenses: Sum of recorded 7 expense lines = $\mathbf{PHP\ 2,450.00}$
  * **Over All Net Profit:** $7,968.00 - 2,450.00 = \mathbf{PHP\ 5,518.00}$
  * **Ending Current Balance:** $11,834.59 + 5,518.00 = \mathbf{PHP\ 17,352.59}$
* **DEFENSE EXPLANATION:**  
  > *"In a manual logbook, computing Gross Margin, Cost of Goods Sold, and Net Operating Surplus across multiple ledgers frequently produces transposition errors. MEALS performs these calculations automatically in real time using verified accounting logic."*

---

## 13. Walkthrough Phase 9: DepEd Prescribed Statutory Fund Allocations

### Step 13.1: 6-Fund Allocation & Forward-Balance Carryover
* **NAVIGATE TO:** `/financial-management` (Select Tab: **Fund Allocation**)
* **DEMONSTRATE:**
  1. Show the 6 statutory funds mandated by DepEd Order No. 8, s. 2007:
     * **Supplementary Feeding:** $35.0\%$ of Net Profit
     * **School Operating Fund:** $25.0\%$ of Net Profit
     * **Faculty/Student Development:** $15.0\%$ of Net Profit
     * **H.E. Instructional Fund:** $10.0\%$ of Net Profit
     * **Revolving Capital Fund:** $10.0\%$ of Net Profit
     * **School Clinic:** $5.0\%$ of Net Profit
     * **Total Allocation Check:** Exactly $100.0\%$.
  2. Point out the **Balance in Previous Month** column:
     * For the initial month of the school year (June), administrators can set the opening fund balances.
     * For all subsequent months (July through May), the **field is locked with a padlock icon**, automatically pulling the ending Current Balance of the preceding month.
  3. Show the dynamic monthly columns: *Balance in previous month + Net Income Share + Interest - Expenses - Others = Current Balance*.
  4. Toggle between **Table View** and **Grid Card View**.
* **DEFENSE EXPLANATION:**  
  > *"DepEd policy requires canteen profits to be strictly earmarked for student nutrition and school improvement. MEALS automatically calculates the exact peso share for feeding programs and clinic supplies, and enforces an automatic forward-balance carryover rule so funds cannot be lost or misallocated between months."*

---

## 14. Walkthrough Phase 10: Official Reports & Multi-Format Exports

### Step 14.1: Generating and Exporting Official DepEd Statements
* **NAVIGATE TO:** `/reports`
* **DEMONSTRATE THE 8 REPORT TYPES:**
  1. **Monthly Report:** Detailed statement of sales, COGS, categorized expenses, and net profit.
  2. **Quarterly Report:** 3-month consolidated financial audit statement.
  3. **Annual Report:** Full calendar year fiscal summary.
  4. **School Year Report:** 12-month June-to-May comprehensive balance sheet.
  5. **Sales Report:** Itemized monthly revenue summary.
  6. **Expense Report:** Categorized ledger across all 7 operational expense lines.
  7. **Cash Flow Report:** Liquidity tracking (Beginning Cash, Inflows, Outflows, Ending Cash).
  8. **Profit Report:** Operating margins, expense ratios, and net surplus tracking.
* **STEP-BY-STEP EXPORT ACTIONS:**
  1. Select **Monthly Report** for the active School Year.
  2. Click **Export Excel (`.xlsx`)**: Browser immediately downloads an `.xlsx` workbook formatted with standard DepEd headers, formulas, and cells.
  3. Click **Export PDF / Print Report**: Opens the official printable layout complete with Bay Central Elementary School signature blocks:
     * **Prepared by:** *John Dieric V. Isleta (Administrative Officer II)*
     * **Checked by:** *Maricar A. Afuang (School Head)*
     * **Audited by:** *Kathleen B. Hernandez (School Canteen Auditor)*
* **DEFENSE EXPLANATION:**  
  > *"At the end of every month, the canteen manager does not need to re-encode figures into Microsoft Excel. With one click, MEALS exports verified, print-ready DepEd financial statements containing the required signatures for immediate submission to the Division Office."*

---

## 15. Complete End-to-End Operational Defense Scenario

During the defense, execute this chronological storyline representing a real day at Bay Central Elementary School:

```text
 ┌────────────────────────────────────────────────────────────────────────┐
 │                      6:30 AM: KITCHEN PREPARATION                      │
 │ • Admin/Staff log in; inspect Alerts tab for low ingredients.          │
 │ • Cook 30 portions of Arroz Caldo.                                     │
 │ • Log +30.00 batch under Inventory Replenishment. Stock becomes 30.00. │
 └───────────────────────────────────┬────────────────────────────────────┘
                                     │
                                     ▼
 ┌────────────────────────────────────────────────────────────────────────┐
 │                  10:30 AM: REAL-TIME STOCK MONITORING                  │
 │ • Review Alerts tab for items reaching safety threshold (min_stock).   │
 │ • Log manual adjustment if minor kitchen spill occurs.                 │
 └───────────────────────────────────┬────────────────────────────────────┘
                                     │
                                     ▼
 ┌────────────────────────────────────────────────────────────────────────┐
 │                    1:30 PM: OPERATIONAL EXPENSE RECORD                 │
 │ • Canteen buys LPG gas refill (PHP 1,100.00) from Bay Central Gas.     │
 │ • Record under Expenses tab: Category 'Gas', attach receipt image.     │
 └───────────────────────────────────┬────────────────────────────────────┘
                                     │
                                     ▼
 ┌────────────────────────────────────────────────────────────────────────┐
 │              3:30 PM: CLOSING PERISHABLE FOOD WASTE RESET              │
 │ • 4 portions of Arroz Caldo remain unsold at dismissal.                │
 │ • Open 'End-of-Day Perishable Food Reset' modal.                       │
 │ • Mark 4 portions as 'waste_spoiled'. Stock resets cleanly to 0.00.    │
 │ • Food waste quantity and cost archived into audit ledger.             │
 └───────────────────────────────────┬────────────────────────────────────┘
                                     │
                                     ▼
 ┌────────────────────────────────────────────────────────────────────────┐
 │                 4:00 PM: FINANCIAL STATEMENT & ALLOCATION              │
 │ • Open Overview tab: Current Sales, COGS, Expenses, Net Profit verified│
 │ • Fund Allocation tab updates Supplementary Feeding (35%) & funds.     │
 │ • Ending balance rolls forward to next month's opening balance.        │
 └───────────────────────────────────┬────────────────────────────────────┘
                                     │
                                     ▼
 ┌────────────────────────────────────────────────────────────────────────┐
 │                  4:30 PM: OFFICIAL REPORTS & AUDIT EXPORT              │
 │ • Open Reports view (/reports).                                        │
 │ • Export official Excel workbook (.xlsx) and signed DepEd PDF.         │
 └────────────────────────────────────────────────────────────────────────┘
```

---

## 16. System Testing Plan (Inventory & Finance)

| Test Category | Target Modules | Verification Objective | Testing Technique |
| :--- | :--- | :--- | :--- |
| **A. Product & Material Catalog** | `/inventory` (Tab: Products) | Verify item creation, Unit Types (`PCS` vs Bulk), cost/selling prices, and `min_stock` limits. | Boundary & Input Validation |
| **B. Stock Replenishment** | `/inventory` (Replenish Modal) | Verify inward batch cooking updates stock on hand and writes an immutable audit record. | Data Persistence & State Verification |
| **C. Stock Adjustment** | `/inventory` (Adjust Modal) | Verify stock corrections with designated audit justifications (*Damage, Spill, Spoilage, Recount*). | Audit Log Verification |
| **D. Perishable Food Waste** | `/inventory` (Reset Modal) | Verify closing stock zeroing, waste disposition tracking, and financial waste cost attribution. | State Lifecycle Testing |
| **E. Stock Alerts** | `/inventory` (Tab: Alerts) | Verify triggered alerts when inventory drops below `min_stock` or reaches zero. | Threshold Boundary Testing |
| **F. Operating Expenses** | `/financial-management` (Expenses)| Verify 7-category classification, total expense calculation, and receipt image upload/preview. | File Validation & Aggregation |
| **G. Financial Accounting Math** | `/financial-management` (Overview)| Verify formula accuracy: Gross Income, Cost of Sales, Net Profit, and Ending Cash. | Mathematical Precision Testing |
| **H. DepEd Fund Allocations** | `/financial-management` (Funds) | Verify 6-fund percentage splits (35%, 25%, 15%, 10%, 10%, 5%) and locked forward-balance carryover. | Relational State Continuity |
| **I. Report Generation & Export** | `/reports` | Verify data fidelity between screen preview, exported Excel (`.xlsx`), and signed PDF. | Output Consistency Verification |

---

## 17. Detailed Test Cases

### Positive Test Cases

#### Test Case TC-INV-01: Morning Batch Replenishment
* **Feature:** Inventory Stock Inward Movement
* **Objective:** Verify morning cooked batch increases available stock and creates an immutable audit record.
* **Precondition:** Product *Arroz Caldo with Egg* has `0.00` current stock.
* **Steps:**
  1. Open `/inventory`.
  2. Click **Replenish Stock**.
  3. Select *Arroz Caldo with Egg*, enter Quantity = `30`, Remarks = *"Morning Batch"*.
  4. Click **Confirm Replenishment**.
* **Expected Result:** Stock updates to `30.00`. Status badge changes to green "In Stock". Log entry appears in Stock History.
* **Actual Result:** **PASS**.

#### Test Case TC-PERISH-01: End-of-Day Perishable Food Waste Reset
* **Feature:** Food Waste & Perishable Lifecycle Control
* **Objective:** Verify unsold cooked meals reset to zero and waste reasons are cataloged for audit.
* **Precondition:** Perishable item has 4 unsold portions at afternoon dismissal.
* **Steps:**
  1. Open `/inventory`.
  2. Click **🍲 End-of-Day Perishable Food Reset**.
  3. Locate item with 4 unsold units.
  4. Select Disposition: `"waste_spoiled"`, enter Remarks: *"Dismissal remaining"*.
  5. Click **Confirm Reset**.
* **Expected Result:** Stock resets to `0.00`. An adjustment record of `-4.00` is recorded in `inventory_logs` with reason `"Daily Food Waste: Spoiled / Food Waste"`.
* **Actual Result:** **PASS**.

#### Test Case TC-FIN-01: DepEd 7-Category Operating Expense with Receipt Upload
* **Feature:** Operating Expense Accounting & Digital Voucher Audit
* **Objective:** Verify recording an expense under DepEd categories with an attached receipt image.
* **Precondition:** Admin is logged in; active school year selected.
* **Steps:**
  1. Open `/financial-management` -> Tab **Expenses**.
  2. Select Category: `Gas`, Amount: `1100.00`, Supplier: `Bay Central Gas`, Description: `LPG refill`.
  3. Attach valid image `sample_receipt.png`.
  4. Click **Add Daily Expense**.
* **Expected Result:** Expense appears in the ledger; thumbnail allows opening the Receipt Preview Modal; Monthly Operating Expenses increases by PHP 1,100.00.
* **Actual Result:** **PASS**.

#### Test Case TC-FIN-02: Automated Monthly Financial Statement Math
* **Feature:** Financial Overview Computation
* **Objective:** Verify system computes Gross Income, Net Profit, and Ending Cash according to DepEd accounting formulas.
* **Precondition:** Month has Sales = `PHP 39,840.00`, Cost of Sales = `PHP 31,872.00`, Expenses = `PHP 2,450.00`, Beginning Cash = `PHP 11,834.59`.
* **Steps:**
  1. Open `/financial-management` -> Tab **Overview**.
  2. Inspect calculated metrics.
* **Expected Result:**
  * Gross Income = $39,840.00 - 31,872.00 = \mathbf{PHP\ 7,968.00}$.
  * Net Profit = $7,968.00 - 2,450.00 = \mathbf{PHP\ 5,518.00}$.
  * Ending Balance = $11,834.59 + 5,518.00 = \mathbf{PHP\ 17,352.59}$.
* **Actual Result:** **PASS**.

#### Test Case TC-FIN-03: Statutory Fund Allocation & Locked Carry-Forward Rule
* **Feature:** DepEd Fund Allocation & Balance Continuity
* **Objective:** Verify statutory percentage allocations and enforce locked carryover for non-initial months.
* **Precondition:** Net Profit is `PHP 5,518.00`.
* **Steps:**
  1. Open `/financial-management` -> Tab **Fund Allocation**.
  2. Inspect Supplementary Feeding share ($35\%$): $5,518.00 \times 0.35 = \mathbf{PHP\ 1,931.30}$.
  3. Inspect School Operating Fund share ($25\%$): $5,518.00 \times 0.25 = \mathbf{PHP\ 1,379.50}$.
  4. Inspect month 2 (July): Verify that the "Balance in previous month" input is **locked (read-only with padlock icon)**, exactly matching June's ending Current Balance.
* **Expected Result:** Percentages match statutory splits; carry-forward balance is locked to prevent tampering.
* **Actual Result:** **PASS**.

---

### Negative Test Cases

#### Test Case TC-NEG-01: Future School Year Financial Entry Lock
* **Feature:** School Year Financial Integrity
* **Objective:** Verify the system blocks creating or editing financial reports for unreached academic years.
* **Steps:** Attempt to add a financial report for a future school year.
* **Expected Result:** Operation blocked with message: `"You cannot add a financial report for a future school year."`
* **Actual Result:** **PASS**.

#### Test Case TC-NEG-02: Negative Financial & Inventory Value Rejection
* **Feature:** Data Validation
* **Objective:** Verify the system rejects negative prices, negative stock, and negative expense entries.
* **Steps:** Enter `-500.00` in the Expense Amount field or Product Stock field.
* **Expected Result:** Form validation blocks submission with alert: `"Must be greater than or equal to 0"`.
* **Actual Result:** **PASS**.

#### Test Case TC-NEG-03: Role-Based Route Protection (RBAC)
* **Feature:** Security Access Control
* **Objective:** Verify non-administrative users cannot access financial statements or user accounts.
* **Steps:** Log in as `staff` and attempt to navigate directly to `http://localhost:5173/financial-management` or `/accounts`.
* **Expected Result:** Route guard intercepts request and redirects user back to `/inventory`.
* **Actual Result:** **PASS**.

---

## 18. Live 3-Minute Defense Demonstration Script

*(Use this streamlined script when the panel requests immediate live execution)*

> **Presenter:**  
> *"Honorable panel members, to demonstrate the integrity of MEALS in real time, we will now execute three live representative tests: a kitchen batch replenishment, an operational expense with digital receipt verification, and our end-of-day perishable food waste reconciliation."*

### Test 1: Kitchen Batch Replenishment
* **ACTION:** Go to `/inventory`. Click `+ Replenish Stock`. Select *Pancit Canton*, enter `20` portions, remarks: *"Recess batch prep"*. Click **Confirm**.
* **RESULT:** Stock increases to 20; status updates to green "In Stock"; audit log created.
* **SAY TO PANEL:**  
  > *"As shown on screen, the morning replenishment was committed to the database and immediately reflected on the operational dashboard."*

### Test 2: Operating Expense with Digital Receipt Attachment
* **ACTION:** Go to `/financial-management` -> Tab **Expenses**. Add Daily Expense: Category `Gas`, Amount `PHP 1,100.00`, attach `sample_receipt.png`, click **Add Daily Expense**. Then click the eye icon to show the **Receipt Preview Modal**.
* **RESULT:** Expense is saved; receipt image previews instantly; monthly operating expenses adjust automatically.
* **SAY TO PANEL:**  
  > *"Every disbursement is cataloged under DepEd categories with an auditable digital receipt attached for division inspection."*

### Test 3: Closing Perishable Food Waste Reset & Financial Carry-Forward
* **ACTION:** Go to `/inventory`. Click `🍲 End-of-Day Perishable Food Reset`. For remaining unsold items, select Disposition `"Spoiled / Food Waste"` and confirm. Then switch to `/financial-management` -> Tab **Fund Allocation**.
* **RESULT:** Stock zeroes out cleanly; waste costs are archived; Fund Allocation table reflects Net Surplus with locked balance carryovers.
* **SAY TO PANEL:**  
  > *"Unsold perishable food is cleared to prevent spoilage carryover, and the resulting financial surplus is automatically allocated into DepEd statutory funds."*

---

## 19. Defense Panel Questions and Expert Answers

#### Q1: "Why did you prioritize Inventory and Financial Management instead of standard commercial features?"
> **Answer:**  
> *"Elementary school canteens have unique operational priorities governed by DepEd Order No. 8, s. 2007. Generic store software cannot handle daily perishable meal waste reconciliation, cannot track raw ingredient bulk units versus cooked portions, and completely lacks the 12-month June-to-May DepEd financial structure with statutory 6-fund allocations. Our research directly solves the school's actual administrative pain points: food waste in the kitchen and arithmetic errors in DepEd financial reports."*

#### Q2: "How does your system handle the difference between raw ingredients and cooked meal portions?"
> **Answer:**  
> *"In MEALS, the product catalog supports distinct Unit Types: Bulk units (`kg`, `g`, `L`, `mL`) for kitchen raw supplies like rice, cooking oil, and sugar, and Piece units (`PCS`) for prepared meals like bowls of arroz caldo or sandwiches. Furthermore, cooked items are flagged with the `is_perishable` attribute, ensuring they undergo our end-of-day waste reconciliation protocol at school dismissal."*

#### Q3: "How does MEALS ensure that DepEd fund allocations remain mathematically accurate from month to month?"
> **Answer:**  
> *"MEALS enforces an automated forward-balance carryover rule. For the initial month of a school year, the administrator enters verified opening balances. For every subsequent month (July through May), the system automatically locks the 'Balance in previous month' field and calculates it directly from the preceding month's ending Current Balance: Opening Balance + Net Income Share + Interest - Expenses = Ending Balance. This eliminates manual calculation errors and prevents unauthorized balance manipulation."*

#### Q4: "How does recorded perishable food waste impact the monthly financial statement and Cost of Sales?"
> **Answer:**  
> *"When perishable food spoils or remains unsold at closing, the system logs the exact unit cost in `inventory_logs`. In the DepEd accounting statement, this waste forms part of the Cost of Sales ($Beginning\ Inventory + Purchases - Ending\ Inventory$). By capturing the exact financial waste loss rather than ignoring it, MEALS provides the Canteen Manager and School Head with full visibility into how much revenue was lost to over-preparation, allowing them to adjust ingredient procurement for subsequent months."*

#### Q5: "What happens if a canteen staff member makes a mistake during stock replenishment or adjustment?"
> **Answer:**  
> *"All inventory actions write immutable records to `inventory_logs`. Staff cannot quietly overwrite stock counts. Any correction requires creating a dedicated 'Adjustment' entry with a mandatory reason (*Damaged, Spoilage, Shrinkage, Audit Recount, Kitchen Prep Spill*) and explanatory remarks. The complete history is displayed in the Stock History tab, ensuring full audit accountability."*

#### Q6: "How do you guarantee that exported reports comply with DepEd Division Office standards?"
> **Answer:**  
> *"MEALS exports reports directly into standard `.xlsx` Excel spreadsheets and official printable PDFs that mirror DepEd reporting formats. Furthermore, each report includes the required institutional signature blocks: Prepared by the Administrative Officer II (John Dieric V. Isleta), Checked by the School Head (Maricar A. Afuang), and Audited by the School Canteen Auditor (Kathleen B. Hernandez)."*

---

## 20. System Boundaries & Academic Limitations

To maintain academic honesty and defensibility, the following system boundaries are acknowledged:

1. **Standalone Canteen Deployment:** MEALS is engineered specifically for single-institution elementary school canteen operations (Bay Central Elementary School), rather than a multi-tenant cloud platform managing an entire school division.
2. **Kitchen Recipe Breakdown (Bill of Materials):** Current batch replenishment tracks the number of cooked meal portions prepared (e.g., 30 bowls of arroz caldo). Direct automated deduction of raw ingredients (e.g., deducting 2 kg of raw chicken and 3 kg of rice per batch) is planned as a future recipe management module.
3. **Cash-Based Canteen Accounting:** In accordance with public elementary school realities, transactions and revenue entries are recorded in Philippine Pesos (cash accounting) rather than through student digital credit cards or bank integrations.

---

## 21. Future Enhancements

1. **Recipe Bill of Materials (BOM) Kitchen Engine:** Automatically deduct raw bulk inventory (`kg` of rice, meat, condiments) whenever a morning cooked batch is logged.
2. **Automated Barcode & QR Code Scanning for Packaged Pantry Ingredients:** Enabling barcode scanner integration for commercial raw ingredients (canned milk, cooking oil, flour) while maintaining touchscreen batch entry for daily cooked perishables.
3. **DepEd Form 8 Official Template Auto-Fill:** Direct mapping of monthly financial outputs into the exact digital DepEd Form 8 macro-enabled workbook.

---

## 22. Final Defense Closing Statement

*(To be delivered with confidence by the group leader)*

> *"Honorable members of the panel, our research adviser, and guests:  
> 
> MEALS was designed, engineered, and tested to address the real-world operational challenges of Bay Central Elementary School.  
> 
> By bridging the gap between morning kitchen batch preparation, afternoon perishable food waste reconciliation, and automated DepEd monthly financial accounting, MEALS transforms a tedious, error-prone manual process into a transparent, auditable, and data-driven management system.  
> 
> Our system provides school canteen personnel with tools specifically built for their environment: eliminating food waste through daily closing reconciliation protocols, categorizing operational disbursements with digital receipt verification, and guaranteeing that every peso allocated for student nutrition is accurately tracked and protected.  
> 
> The system you witnessed today is fully implemented, rigorously tested, and ready to serve the school community.  
> 
> Thank you very much, and we welcome your questions and critiques."*
