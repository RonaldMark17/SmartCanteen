import sqlite3

con = sqlite3.connect("canteen.db")
cur = con.cursor()
cur.execute("SELECT id, month_name, calendar_year, notes FROM monthly_reports WHERE notes IS NOT NULL AND notes != ''")
rows = cur.fetchall()
print(f"Found {len(rows)} monthly_reports with notes:")
for r in rows:
    print(f"Report ID {r[0]} ({r[1]} {r[2]}):")
    print(r[3])
    print("-" * 50)
