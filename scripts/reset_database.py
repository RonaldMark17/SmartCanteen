#!/usr/bin/env python3
"""
reset_database.py
Safely erase all operational/transactional/inventory/report data from canteen.db,
preserving only user credentials and authentication records.
"""

import os
import sys
import sqlite3
import datetime
from pathlib import Path

# Paths
BASE_DIR = Path(__file__).resolve().parent.parent
DB_PATH = BASE_DIR / "canteen.db"

# Tables to preserve
PRESERVED_TABLES = {
    "users",
    "user_recovery_codes",
}


def backup_database(source_path: Path) -> Path:
    """Create a verified timestamped backup using SQLite online backup API."""
    timestamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_path = source_path.with_name(f"{source_path.name}.backup-{timestamp}-pre-reset")
    
    print(f"[1/5] Backing up database to:\n      {backup_path}")
    source_con = sqlite3.connect(str(source_path))
    backup_con = sqlite3.connect(str(backup_path))
    
    try:
        source_con.backup(backup_con)
    finally:
        backup_con.close()
        source_con.close()
        
    if not backup_path.exists() or backup_path.stat().st_size == 0:
        raise RuntimeError(f"Backup failed! {backup_path} is missing or 0 bytes.")
        
    print(f"      Backup successfully created ({backup_path.stat().st_size:,} bytes).")
    return backup_path


def reset_database(db_path: Path):
    if not db_path.exists():
        print(f"Error: Database not found at {db_path}")
        sys.exit(1)

    print("=" * 65)
    print("      SMARTCANTEEN DATABASE RESET / FORMAT UTILITY")
    print("=" * 65)
    print(f"Target Database: {db_path} ({db_path.stat().st_size:,} bytes)")
    
    # 1. Create safety backup
    backup_database(db_path)
    
    con = sqlite3.connect(str(db_path))
    cur = con.cursor()
    
    # Get all tables
    cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    all_tables = [row[0] for row in cur.fetchall()]
    
    print(f"\n[2/5] Inspecting current table row counts:")
    initial_counts = {}
    for table in all_tables:
        count = cur.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]
        initial_counts[table] = count
        flag = " [PRESERVED]" if table in PRESERVED_TABLES else " [WILL ERASE]"
        print(f"      - {table:32} : {count:>7,} rows {flag}")

    tables_to_clear = [t for t in all_tables if t not in PRESERVED_TABLES]
    
    # 2. Perform deletion in an atomic transaction
    print(f"\n[3/5] Erasing data from {len(tables_to_clear)} operational tables...")
    cur.execute("PRAGMA foreign_keys = OFF;")
    
    try:
        cur.execute("BEGIN TRANSACTION;")
        for table in tables_to_clear:
            cur.execute(f'DELETE FROM "{table}";')
            
        # Reset sqlite_sequence if it exists
        cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='sqlite_sequence';")
        if cur.fetchone():
            for table in tables_to_clear:
                cur.execute('DELETE FROM sqlite_sequence WHERE name = ?;', (table,))
                
        cur.execute("COMMIT;")
        print("      Data erasure committed successfully.")
    except Exception as exc:
        cur.execute("ROLLBACK;")
        raise RuntimeError(f"Failed during deletion, rolled back! Error: {exc}")
    finally:
        cur.execute("PRAGMA foreign_keys = ON;")

    # Check foreign keys
    fk_errors = cur.execute("PRAGMA foreign_key_check;").fetchall()
    if fk_errors:
        print(f"      [WARNING] Foreign key violations found: {fk_errors}")
    else:
        print("      Foreign key consistency check: PASSED (0 errors).")

    # 3. Vacuum database
    print(f"\n[4/5] Running VACUUM to reclaim disk space and defragment...")
    con.close()
    
    # Run VACUUM in fresh connection with autocommit
    con = sqlite3.connect(str(db_path), isolation_level=None)
    con.execute("VACUUM;")
    con.close()
    
    new_size = db_path.stat().st_size
    print(f"      Database compacted to {new_size:,} bytes.")

    # 4. Final Verification
    print(f"\n[5/5] Post-reset verification:")
    con = sqlite3.connect(str(db_path))
    cur = con.cursor()
    
    integrity = cur.execute("PRAGMA integrity_check;").fetchall()
    print(f"      Integrity check: {integrity[0][0]}")

    print("\nTable row counts after reset:")
    for table in all_tables:
        count = cur.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]
        status = "OK" if (table in PRESERVED_TABLES and count > 0) or (table not in PRESERVED_TABLES and count == 0) else "CHECK"
        print(f"      - {table:32} : {count:>7,} rows [{status}]")

    print("\nPreserved Users:")
    cur.execute("SELECT id, username, full_name, role, is_active, authenticator_enabled FROM users")
    for u in cur.fetchall():
        mfa_status = "Enabled" if u[5] else "Disabled"
        active_status = "Active" if u[4] else "Inactive"
        print(f"      User #{u[0]}: {u[1]} ({u[2] or 'No Name'}) - Role: {u[3]} | Status: {active_status} | MFA: {mfa_status}")

    con.close()
    print("\n" + "=" * 65)
    print("      DATABASE RESET COMPLETED SUCCESSFULLY")
    print("=" * 65)


if __name__ == "__main__":
    reset_database(DB_PATH)
