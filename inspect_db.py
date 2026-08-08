import sys
import os

root_dir = r"c:\Users\ronal\OneDrive\Desktop\New folder (11)"
if root_dir not in sys.path:
    sys.path.insert(0, root_dir)

from backend.database import SessionLocal
from backend import models

db = SessionLocal()
try:
    school_years = db.query(models.SchoolYear).all()
    print("=== SCHOOL YEARS ===")
    for sy in school_years:
        print(f"\nID: {sy.id}, Name: {sy.name}, Active: {sy.is_active}, Start: {sy.start_year}, End: {sy.end_year}")
        allocs = db.query(models.Allocation).filter(models.Allocation.school_year_id == sy.id).all()
        for a in allocs:
            print(f"  Alloc: key={a.category_key}, label={a.label}, percentage={a.percentage}, opening_bal={a.opening_balance}")
        
        reports = db.query(models.MonthlyReport).filter(models.MonthlyReport.school_year_id == sy.id).order_by(models.MonthlyReport.month_index).all()
        for r in reports:
            entries = db.query(models.FundMonitoringEntry).filter(models.FundMonitoringEntry.report_id == r.id).all()
            exp_sum = sum(e.amount for e in (r.expenses or []))
            net_inc = (r.current_sales or 0) - (r.product_cost or 0) - exp_sum
            print(f"  Report ID: {r.id}, MonthIndex: {r.month_index}, Month: {r.month_name} {r.calendar_year}, Sales: {r.current_sales}, Cost: {r.product_cost}, Exp: {exp_sum}, NetInc: {net_inc}")
            for e in entries:
                print(f"    FundEntry: key={e.category_key}, interest={e.interest}, expenses={e.expenses}, others={e.others}, cash_on_bank={e.cash_on_bank}")
finally:
    db.close()
