"""One-time script to create all tables directly."""
from dotenv import load_dotenv
load_dotenv()

from app.database import engine
import app.models  # registers all models

from app.database import Base

Base.metadata.create_all(bind=engine)
print("All tables created.")
