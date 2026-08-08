#!/usr/bin/env python3
"""
Production Database Initializer for MEALS FastAPI Backend
Sets up database tables, verifies migrations, and ensures default admin account exists.
"""

import sys
import os

# Add root project path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))

from backend.database import engine, Base, SessionLocal
from backend import models, auth

def initialize_database():
    print("[DB] Creating database tables if not exist...")
    Base.metadata.create_all(bind=engine)
    
    db = SessionLocal()
    try:
        # Check if default admin account exists
        admin_user = db.query(models.User).filter(models.User.role == "admin").first()
        if not admin_user:
            print("[DB] Creating initial default admin user ('admin')...")
            hashed_pwd = auth.get_password_hash("admin123")
            default_admin = models.User(
                username="admin",
                hashed_password=hashed_pwd,
                full_name="System Administrator",
                role="admin",
                is_active=True
            )
            db.add(default_admin)
            db.commit()
            print("[DB] Admin user created successfully (Username: admin, Password: admin123).")
            print("[IMPORTANT] Change default admin password immediately upon first login!")
        else:
            print(f"[DB] Found existing admin account: {admin_user.username}")

        # Check existing products / data state
        product_count = db.query(models.Product).count()
        print(f"[DB] Total products in database: {product_count}")

    except Exception as e:
        print(f"[DB Error] Database initialization failed: {e}")
        db.rollback()
        sys.exit(1)
    finally:
        db.close()

if __name__ == "__main__":
    initialize_database()
