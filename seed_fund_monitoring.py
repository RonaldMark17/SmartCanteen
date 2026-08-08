import sys
import os

root_dir = r"c:\Users\ronal\OneDrive\Desktop\New folder (11)"
if root_dir not in sys.path:
    sys.path.insert(0, root_dir)

from backend.database import SessionLocal
from backend import models

db = SessionLocal()
try:
    sy_26_27 = (
        db.query(models.SchoolYear)
        .filter(models.SchoolYear.name == "2026-2027")
        .first()
    )
    if not sy_26_27:
        print("School Year 2026-2027 not found!")
        sys.exit(1)

    print(f"Found School Year: {sy_26_27.name} (ID: {sy_26_27.id})")

    # Data map for June (0), July (1), August (2)
    fund_data_by_month = {
        0: { # June 2026
            "supplementary_feeding": {"interest": 0.0, "expenses": 1200.0, "others": 0.0, "cash_on_bank": 2350.75},
            "school_clinic": {"interest": 0.0, "expenses": 200.0, "others": 0.0, "cash_on_bank": 307.25},
            "faculty_student_development": {"interest": 0.0, "expenses": 500.0, "others": 0.0, "cash_on_bank": 1021.75},
            "school_operating_fund": {"interest": 0.0, "expenses": 1000.0, "others": 0.0, "cash_on_bank": 1536.25},
            "he_instructional_fund": {"interest": 0.0, "expenses": 300.0, "others": 0.0, "cash_on_bank": 714.50},
            "revolving_capital_fund": {"interest": 0.0, "expenses": 0.0, "others": 0.0, "cash_on_bank": 1014.50},
        },
        1: { # July 2026
            "supplementary_feeding": {"interest": 0.0, "expenses": 2500.0, "others": 0.0, "cash_on_bank": 5380.75},
            "school_clinic": {"interest": 0.0, "expenses": 300.0, "others": 0.0, "cash_on_bank": 797.25},
            "faculty_student_development": {"interest": 0.0, "expenses": 1200.0, "others": 0.0, "cash_on_bank": 2191.75},
            "school_operating_fund": {"interest": 0.0, "expenses": 2000.0, "others": 0.0, "cash_on_bank": 3486.25},
            "he_instructional_fund": {"interest": 0.0, "expenses": 800.0, "others": 0.0, "cash_on_bank": 1494.50},
            "revolving_capital_fund": {"interest": 0.0, "expenses": 500.0, "others": 0.0, "cash_on_bank": 2094.50},
        },
        2: { # August 2026
            "supplementary_feeding": {"interest": 0.0, "expenses": 3200.0, "others": 0.0, "cash_on_bank": 8568.25},
            "school_clinic": {"interest": 0.0, "expenses": 450.0, "others": 0.0, "cash_on_bank": 1259.75},
            "faculty_student_development": {"interest": 0.0, "expenses": 1500.0, "others": 0.0, "cash_on_bank": 3429.25},
            "school_operating_fund": {"interest": 0.0, "expenses": 2800.0, "others": 0.0, "cash_on_bank": 5248.75},
            "he_instructional_fund": {"interest": 0.0, "expenses": 1000.0, "others": 0.0, "cash_on_bank": 2319.50},
            "revolving_capital_fund": {"interest": 0.0, "expenses": 800.0, "others": 0.0, "cash_on_bank": 3119.50},
        },
    }

    reports = (
        db.query(models.MonthlyReport)
        .filter(models.MonthlyReport.school_year_id == sy_26_27.id)
        .order_by(models.MonthlyReport.month_index)
        .all()
    )

    for r in reports:
        if r.month_index in fund_data_by_month:
            print(f"\nSeeding Fund Allocation Monitoring for {r.month_name} {r.calendar_year} (Report ID: {r.id})...")
            # Clear existing fund monitoring entries for this report
            db.query(models.FundMonitoringEntry).filter(models.FundMonitoringEntry.report_id == r.id).delete()
            db.flush()

            entries_map = fund_data_by_month[r.month_index]
            for cat_key, values in entries_map.items():
                entry = models.FundMonitoringEntry(
                    report_id=r.id,
                    category_key=cat_key,
                    interest=values["interest"],
                    expenses=values["expenses"],
                    others=values["others"],
                    cash_on_bank=values["cash_on_bank"],
                )
                db.add(entry)
                print(f"  Added {cat_key}: expenses={values['expenses']}, interest={values['interest']}, cash_on_bank={values['cash_on_bank']}")

    db.commit()
    print("\nSuccessfully seeded Fund Allocation Monitoring for SY 2026-2027 (June, July, August)!")

finally:
    db.close()
