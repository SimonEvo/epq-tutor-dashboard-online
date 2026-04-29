"""Run once after `alembic upgrade head` to create the tutor account."""
import os
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
    exit(1)

db = SessionLocal()
existing = db.query(models.Tutor).filter(models.Tutor.username == username).first()
if existing:
    print(f"Tutor '{username}' already exists, skipping.")
else:
    tutor = models.Tutor(id=str(uuid.uuid4()), username=username, password_hash=hash_password(password))
    db.add(tutor)
    db.commit()
    print(f"Created tutor '{username}' (id={tutor.id})")
db.close()
