from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.database import get_db
from app import models
from app.auth import get_current_tutor
from app.schemas import WeeklyReportSchema

router = APIRouter(prefix="/api/weekly-report", tags=["reports"])


@router.get("", response_model=WeeklyReportSchema | None)
def get_weekly_report(
    db: Session = Depends(get_db),
    _tutor: models.Tutor = Depends(get_current_tutor),
):
    row = db.query(models.WeeklyReport).order_by(models.WeeklyReport.id.desc()).first()
    if row is None:
        return None
    return WeeklyReportSchema(
        generatedAt=row.generated_at,
        content=row.content,
        cache={"lastScanAt": row.last_scan_at, "students": row.student_cache},
    )


@router.put("", response_model=WeeklyReportSchema)
def save_weekly_report(
    data: WeeklyReportSchema,
    db: Session = Depends(get_db),
    _tutor: models.Tutor = Depends(get_current_tutor),
):
    row = models.WeeklyReport(
        generated_at=data.generatedAt,
        content=data.content,
        last_scan_at=data.cache.get("lastScanAt", data.generatedAt),
        student_cache=data.cache.get("students", {}),
    )
    db.add(row)
    db.commit()
    return data
