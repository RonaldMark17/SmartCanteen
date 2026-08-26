import sys
import os
sys.path.insert(0, os.path.abspath('.'))

import urllib.request
import urllib.error
import json
import backend.auth as auth
from backend.database import SessionLocal
import backend.models as models

# Create/find staff and admin users in DB
db = SessionLocal()
admin_user = db.query(models.User).filter(models.User.role.in_(["admin", "administrator"])).first()
staff_user = db.query(models.User).filter(models.User.role == "staff").first()

if not admin_user:
    print("No admin user found")
    exit(1)

if not staff_user:
    staff_user = models.User(username="test_staff_role", full_name="Test Staff", role="staff", password_hash=auth.hash_password("staff123"), is_active=True)
    db.add(staff_user)
    db.commit()
    db.refresh(staff_user)

admin_token = auth.create_access_token({"sub": admin_user.username})
staff_token = auth.create_access_token({"sub": staff_user.username})

def test_endpoint(url, token, expected_status):
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req) as resp:
            status = resp.getcode()
    except urllib.error.HTTPError as e:
        status = e.code

    print(f"URL: {url} | Token User: {'admin' if token == admin_token else 'staff'} | Got: {status} (Expected: {expected_status})")
    assert status == expected_status, f"Expected {expected_status}, got {status}"

# Test 1: Staff accessing financial school years (Should be 403)
test_endpoint("http://127.0.0.1:8000/api/financial-reports/school-years", staff_token, 403)

# Test 2: Admin accessing financial school years (Should be 200)
test_endpoint("http://127.0.0.1:8000/api/financial-reports/school-years", admin_token, 200)

# Test 3: Staff accessing products (Should be 200)
test_endpoint("http://127.0.0.1:8000/api/products", staff_token, 200)

print("ALL LIVE ENDPOINT ROLE SECURITY TESTS PASSED SUCCESSFULLY!")
