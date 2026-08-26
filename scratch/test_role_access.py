from fastapi.testclient import TestClient
from backend.main import app
import backend.auth as auth

client = TestClient(app)

# Generate mock tokens
admin_token = auth.create_access_token({"sub": "admin"})
staff_token = auth.create_access_token({"sub": "staff_user"})

# Test endpoints
headers_admin = {"Authorization": f"Bearer {admin_token}"}
headers_staff = {"Authorization": f"Bearer {staff_token}"}

print("Testing Staff vs Admin API Access:")

# 1. Financial School Years (Admin only)
res_staff = client.get("/api/financial-reports/school-years", headers=headers_staff)
print("Staff GET /api/financial-reports/school-years -> status:", res_staff.status_code)
assert res_staff.status_code == 403, f"Expected 403 for staff, got {res_staff.status_code}"

# 2. Financial Report detail (Admin only)
res_staff_detail = client.get("/api/financial-reports/school-years/1", headers=headers_staff)
print("Staff GET /api/financial-reports/school-years/1 -> status:", res_staff_detail.status_code)
assert res_staff_detail.status_code == 403, f"Expected 403 for staff, got {res_staff_detail.status_code}"

print("All backend role security tests PASSED!")
