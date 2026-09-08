import os
import sys
import json
import urllib.request
import urllib.error

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE_DIR)

from backend.database import SessionLocal
from backend import models, auth

def make_req(method, url, headers=None, body=None):
    headers = headers or {}
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req) as resp:
            status = resp.status
            content = resp.read().decode("utf-8")
            return status, json.loads(content) if content else {}
    except urllib.error.HTTPError as e:
        content = e.read().decode("utf-8")
        return e.code, json.loads(content) if content else {}

def run_verification():
    db = SessionLocal()
    try:
        # 1. Find or verify an active admin user
        admin = db.query(models.User).filter(models.User.role == "admin", models.User.is_active == True).first()
        if not admin:
            print("ERROR: No active admin user found in database.")
            return False
        
        token = auth.create_access_token({"sub": admin.username})
        bg_token = auth.create_background_alert_token(admin.username)
        headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json"
        }
        bg_headers = {
            "X-SmartCanteen-Alert-Token": bg_token
        }
        base_url = "http://127.0.0.1:8000/api"

        print(f"Testing with admin: {admin.username} (ID: {admin.id})")

        # 2. Create a dedicated test product
        test_product_name = "Automated Lifecycle Test Item"
        existing = db.query(models.Product).filter(models.Product.name == test_product_name).first()
        if existing:
            db.delete(existing)
            db.commit()

        status, prod_data = make_req(
            "POST",
            f"{base_url}/products",
            headers=headers,
            body={
                "name": test_product_name,
                "category": "Test",
                "price": 50.0,
                "stock": 2.0,
                "min_stock": 5.0,
                "unit_type": "pcs",
                "is_active": True
            }
        )
        assert status == 200, f"Failed to create product: {status} {prod_data}"
        prod_id = prod_data["id"]
        sig = str(prod_id)
        print(f"Step 1: Created test product ID {prod_id}, initial stock 2.0, min_stock 5.0")

        # 3. Check /api/products/low-stock
        status, low_items = make_req("GET", f"{base_url}/products/low-stock", headers=headers)
        assert status == 200
        low_ids = [p["id"] for p in low_items]
        assert prod_id in low_ids, f"Product {prod_id} should be in low-stock list"
        print("Step 2: Verified product is present in /api/products/low-stock")

        # 4. Mark dismissed in /api/alert-state
        status, state_data = make_req(
            "POST",
            f"{base_url}/alert-state",
            headers=headers,
            body={
                "alert_type": "low_stock",
                "state": "dismissed",
                "signatures": [sig]
            }
        )
        assert status == 200
        assert sig in state_data["dismissed"]["low_stock"], "Signature should be in dismissed low_stock"
        print("Step 3: Marked alert as dismissed in /api/alert-state")

        # 5. Check background summary excludes it
        status, bg_data = make_req("GET", f"{base_url}/alerts/background-summary", headers=bg_headers)
        assert status == 200
        bg_items = [p["id"] for p in bg_data.get("low_stock", [])]
        assert prod_id not in bg_items, "Dismissed product should be excluded from background summary"
        print("Step 4: Verified dismissed product is excluded from background summary")

        # 6. Auto-Clear on Replenishment: Replenish stock to 10 (>= 5)
        status, rep_data = make_req(
            "POST",
            f"{base_url}/inventory/replenish",
            headers=headers,
            body={
                "product_id": prod_id,
                "quantity": 8.0,
                "remarks": "Auto-clear verification test"
            }
        )
        assert status == 200, f"Replenish failed: {status} {rep_data}"
        assert rep_data["product"]["stock"] == 10.0
        print("Step 5: Replenished stock to 10.0 (>= 5.0)")

        # 7. Verify /api/alert-state purged the dismissed state
        status, check_state = make_req("GET", f"{base_url}/alert-state", headers=headers)
        assert status == 200
        assert sig not in check_state["dismissed"]["low_stock"], (
            f"Stale dismissed state {sig} was not auto-cleared on replenishment!"
        )
        print("Step 6: Verified alert state was AUTO-CLEARED on replenishment!")

        # 8. Re-Trigger: Deduct stock back below threshold (adjust to 3.0 < 5.0)
        status, adj_data = make_req(
            "POST",
            f"{base_url}/inventory/adjust",
            headers=headers,
            body={
                "product_id": prod_id,
                "adjustment_type": "deduct",
                "quantity": 7.0,
                "reason": "Test Re-Trigger",
                "remarks": "Re-trigger verification test"
            }
        )
        assert status == 200, f"Adjust failed: {status} {adj_data}"
        assert adj_data["product"]["stock"] == 3.0
        print("Step 7: Adjusted stock back down to 3.0 (< 5.0)")

        # 9. Verify background summary has product active again (not excluded!)
        status, bg_data2 = make_req("GET", f"{base_url}/alerts/background-summary", headers=bg_headers)
        assert status == 200
        print("DEBUG bg_data2:", bg_data2)
        bg_items2 = [p["id"] for p in bg_data2.get("low_stock", [])]
        assert prod_id in bg_items2, f"Product {prod_id} should NOT be excluded; alert must RE-TRIGGER! Items: {bg_items2}"
        print("Step 8: Verified alert RE-TRIGGERED successfully in background summary!")

        # 10. Test DELETE /api/alert-state
        make_req(
            "POST",
            f"{base_url}/alert-state",
            headers=headers,
            body={
                "alert_type": "low_stock",
                "state": "dismissed",
                "signatures": [sig]
            }
        )
        status, del_data = make_req(
            "DELETE",
            f"{base_url}/alert-state",
            headers=headers,
            body={
                "alert_type": "low_stock",
                "state": "dismissed",
                "signatures": [sig]
            }
        )
        assert status == 200, f"DELETE /api/alert-state failed: {status} {del_data}"
        assert sig not in del_data["dismissed"]["low_stock"]
        print("Step 9: Verified DELETE /api/alert-state operates correctly")

        # 11. Test POST /api/alert-state with state='resolved'
        make_req(
            "POST",
            f"{base_url}/alert-state",
            headers=headers,
            body={
                "alert_type": "low_stock",
                "state": "dismissed",
                "signatures": [sig]
            }
        )
        status, clear_data = make_req(
            "POST",
            f"{base_url}/alert-state",
            headers=headers,
            body={
                "alert_type": "low_stock",
                "state": "resolved",
                "signatures": [sig]
            }
        )
        assert status == 200
        assert sig not in clear_data["dismissed"]["low_stock"]
        print("Step 10: Verified POST /api/alert-state with state='resolved' clears states")

        # 12. Test POS Transaction Transition
        # Set stock back to 10 (healthy)
        make_req(
            "POST",
            f"{base_url}/inventory/adjust",
            headers=headers,
            body={
                "product_id": prod_id,
                "adjustment_type": "set",
                "quantity": 10.0,
                "reason": "Prep for POS test"
            }
        )
        # Add stale dismissal
        make_req(
            "POST",
            f"{base_url}/alert-state",
            headers=headers,
            body={
                "alert_type": "low_stock",
                "state": "dismissed",
                "signatures": [sig]
            }
        )
        # POS checkout 6 units -> drops from 10 to 4 (< 5.0)
        status, pos_data = make_req(
            "POST",
            f"{base_url}/transactions",
            headers=headers,
            body={
                "items": [{
                    "product_id": prod_id,
                    "quantity": 6.0,
                    "sale_quantity": 6.0,
                    "unit_price": 50.0,
                    "sale_unit": "pcs"
                }],
                "payment_type": "cash"
            }
        )
        assert status == 200, f"POS transaction failed: {status} {pos_data}"
        # Stale dismissal must have been cleared by _persist_transaction
        status, check_state2 = make_req("GET", f"{base_url}/alert-state", headers=headers)
        assert sig not in check_state2["dismissed"]["low_stock"], "POS stock drop failed to clear stale alert dismissal"
        print("Step 11: Verified POS transaction drops below threshold and clears stale suppression!")

        # 13. Clean up test product
        status, del_prod_res = make_req("DELETE", f"{base_url}/products/{prod_id}", headers=headers)
        assert status == 200
        print("Step 12: Deactivated and cleaned up test product")

        print("\nALL VERIFICATION STEPS PASSED SUCCESSFULLY! [OK]")
        return True

    finally:
        db.close()

if __name__ == "__main__":
    success = run_verification()
    sys.exit(0 if success else 1)
