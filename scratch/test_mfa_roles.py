import sqlite3
import requests

BASE_URL = "http://127.0.0.1:8000"

def test_login():
    # 1. Test cashier login (cashier has authenticator_enabled = 0)
    print("Testing cashier login...")
    res = requests.post(f"{BASE_URL}/api/auth/login", json={"username": "cashier", "password": "cashier123"})
    print("Cashier status:", res.status_code)
    data = res.json()
    print("Cashier response keys:", list(data.keys()))
    if "access_token" in data:
        print("PASS: Cashier logged in directly without MFA prompt!")
    else:
        print("FAIL: Cashier was prompted for MFA:", data)

    # 2. Test staff login (let's check staff's current MFA or test resetting staff MFA)
    # Let's see what happens if staff has authenticator_enabled = 0 vs 1
    conn = sqlite3.connect("canteen.db")
    cur = conn.cursor()
    # Reset staff MFA to 0 for test
    cur.execute("UPDATE users SET authenticator_enabled = 0, authenticator_secret = NULL WHERE username = 'staff'")
    conn.commit()
    
    print("\nTesting staff login (MFA disabled)...")
    res = requests.post(f"{BASE_URL}/api/auth/login", json={"username": "staff", "password": "staff123"})
    print("Staff status:", res.status_code)
    data = res.json()
    print("Staff response keys:", list(data.keys()))
    if "access_token" in data:
        print("PASS: Staff logged in directly without MFA prompt!")
    else:
        print("FAIL: Staff was prompted for MFA:", data)

    # 3. Test admin1 login (admin without MFA)
    print("\nTesting admin1 login (admin without MFA)...")
    res = requests.post(f"{BASE_URL}/api/auth/login", json={"username": "admin1", "password": "admin123"})
    print("Admin1 status:", res.status_code)
    data = res.json()
    print("Admin1 response keys:", list(data.keys()))
    if data.get("mfa_required") and data.get("mfa_type") == "authenticator_setup":
        print("PASS: Admin is required to set up MFA!")
    else:
        print("FAIL: Admin was not required to set up MFA:", data)

if __name__ == "__main__":
    test_login()
