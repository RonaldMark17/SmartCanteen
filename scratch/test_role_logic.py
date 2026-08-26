import sys
import os
sys.path.insert(0, os.path.abspath('.'))

import backend.financial_reports as financial_reports
import backend.models as models
from fastapi import HTTPException

# Test 1: Check FINANCIAL_REPORT_ROLES
print("FINANCIAL_REPORT_ROLES:", financial_reports.FINANCIAL_REPORT_ROLES)
assert "staff" not in financial_reports.FINANCIAL_REPORT_ROLES, "staff should not be in FINANCIAL_REPORT_ROLES"
assert "admin" in financial_reports.FINANCIAL_REPORT_ROLES, "admin should be in FINANCIAL_REPORT_ROLES"

# Test 2: Test require_financial_report_user with staff user
staff_user = models.User(id=2, username="staff1", role="staff")
admin_user = models.User(id=1, username="admin1", role="admin")

try:
    financial_reports.require_financial_report_user(staff_user)
    print("FAILED: Staff user was allowed access")
    exit(1)
except HTTPException as e:
    print(f"PASSED: Staff access blocked with {e.status_code} - {e.detail}")
    assert e.status_code == 403

# Test 3: Test require_financial_report_user with admin user
res = financial_reports.require_financial_report_user(admin_user)
assert res.id == admin_user.id
print("PASSED: Admin user was allowed access successfully")

print("ALL DIRECT AUTH & ROLE SECURITY TESTS PASSED!")
