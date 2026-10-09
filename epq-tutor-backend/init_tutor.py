"""首次 bootstrap：创建系统所有者（admin）账号。

后续账号由 admin 通过管理接口创建（P2），不再跑这个脚本。
"""
import os
import secrets
import uuid

from dotenv import load_dotenv

from app.database import SessionLocal
from app import models
from app.auth import hash_password

load_dotenv()

username = os.getenv("TUTOR_USERNAME", "admin")
password = os.getenv("TUTOR_PASSWORD")

if not password:
    print("ERROR: Set TUTOR_PASSWORD in .env before running this script.")
    raise SystemExit(1)

db = SessionLocal()
existing = db.query(models.Tutor).filter(models.Tutor.username == username).first()
if existing:
    print(f"Tutor '{username}' already exists, skipping.")
else:
    # 第一个账号即系统所有者。已有 admin 时后续账号建为普通导师。
    has_admin = db.query(models.Tutor).filter(models.Tutor.role == "admin").first() is not None
    tutor = models.Tutor(
        id=str(uuid.uuid4()),
        username=username,
        password_hash=hash_password(password),
        role="tutor" if has_admin else "admin",
        ics_token=secrets.token_urlsafe(24),
    )
    db.add(tutor)
    db.commit()
    print(f"Created {tutor.role} '{username}' (id={tutor.id})")
db.close()
