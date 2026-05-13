#!/usr/bin/env python3
"""
Migrate data from MySQL → SQLite.

Run once on the server while MySQL is still up:
  cd /opt/epq-tutor-backend
  .venv/bin/python migrate_to_sqlite.py

After success, update .env and restart the service.
"""

import json
import os
import sys
from pathlib import Path
from dotenv import load_dotenv
from sqlalchemy import create_engine, text

load_dotenv()

MYSQL_URL = os.getenv("DATABASE_URL", "")
if not MYSQL_URL or "sqlite" in MYSQL_URL:
    print("ERROR: DATABASE_URL in .env must be a MySQL URL to run this migration.")
    sys.exit(1)

SQLITE_PATH = Path("/opt/epq-tutor-backend/data/epq_tutor.db")
SQLITE_PATH.parent.mkdir(parents=True, exist_ok=True)
SQLITE_URL = f"sqlite:///{SQLITE_PATH}"

print(f"Source : {MYSQL_URL}")
print(f"Target : {SQLITE_URL}")
print()

from app.models import Base  # noqa: E402 — needs env loaded first

mysql_engine = create_engine(MYSQL_URL, pool_pre_ping=True)
sqlite_engine = create_engine(SQLITE_URL, connect_args={"check_same_thread": False})

# Create all tables in SQLite from model definitions
print("Creating SQLite schema...")
Base.metadata.create_all(sqlite_engine)

# Columns that need explicit JSON serialization when copying
JSON_COLUMNS: dict[str, set[str]] = {
    "weekly_reports": {"student_cache"},
}

# Copy in FK-safe order
TABLE_ORDER = [
    "tutors",
    "supervisors",
    "students",
    "tags",
    "sessions",
    "student_milestones",
    "student_tags",
    "personal_entries",
    "mind_maps",
    "weekly_reports",
    "rounds",
]

total = 0
with mysql_engine.connect() as src, sqlite_engine.begin() as dst:
    for table in TABLE_ORDER:
        result = src.execute(text(f"SELECT * FROM `{table}`"))
        cols = list(result.keys())
        rows = result.fetchall()
        print(f"  {table}: {len(rows)} rows")
        if not rows:
            continue

        json_cols = JSON_COLUMNS.get(table, set())
        col_str = ", ".join(cols)
        ph_str = ", ".join(f":{c}" for c in cols)

        for row in rows:
            row_dict = dict(zip(cols, row))
            for jc in json_cols:
                if jc in row_dict and not isinstance(row_dict[jc], str):
                    row_dict[jc] = json.dumps(row_dict[jc], ensure_ascii=False)
            dst.execute(
                text(f"INSERT INTO {table} ({col_str}) VALUES ({ph_str})"),
                row_dict,
            )
        total += len(rows)

print()
print(f"Done — {total} rows migrated.")
print(f"SQLite file: {SQLITE_PATH} ({SQLITE_PATH.stat().st_size // 1024} KB)")
print()
print("Next steps:")
print("  1. Edit /opt/epq-tutor-backend/.env")
print("     Change DATABASE_URL to:")
print(f"     DATABASE_URL=sqlite:///{SQLITE_PATH}")
print("  2. systemctl restart epq-tutor")
print("  3. Verify the app works, then:")
print("     systemctl stop mysql && systemctl disable mysql")
