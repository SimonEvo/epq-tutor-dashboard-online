"""教务同步端点（ADR 0008）。

导师侧：
  GET  /api/hr-sync/status   我能不能同步（教务是否已配置、我是否已关联教务账号）
  POST /api/hr-sync/preview  先增量刷新镜像（有冷却），再给出我的逐行预览
  POST /api/hr-sync/apply    落库我勾选的那几行

管理侧（在 admin.py）：连接配置、强制刷新、教务老师名单、导师↔教务账号关联。
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app import hr_sync, models
from app.auth import get_current_tutor
from app.database import get_db
from app.hr_client import HrClientError

router = APIRouter(prefix="/api/hr-sync", tags=["hr-sync"])


def get_hr_session():
    """调教务用的 HTTP session。None = requests 默认。测试里覆盖成 TestClient(hr_mock)。"""
    return None


class Decision(BaseModel):
    code: str
    action: str                     # create | update | link | skip
    studentId: str | None = None


class ApplyRequest(BaseModel):
    decisions: list[Decision]


@router.get("/status")
def status(db: Session = Depends(get_db), tutor: models.Tutor = Depends(get_current_tutor)):
    view = hr_sync.config_view(db)
    return {
        "configured": view["configured"],
        "linked": bool(tutor.hr_user_id),
        "lastRefreshAt": view["lastRefreshAt"],
    }


@router.post("/preview")
def preview(
    db: Session = Depends(get_db),
    tutor: models.Tutor = Depends(get_current_tutor),
    session=Depends(get_hr_session),
):
    if not tutor.hr_user_id:
        raise HTTPException(status_code=409, detail="你的账号还没有关联教务账号，请联系管理员")

    # 先增量刷新。教务暂时连不上时不报错——用现有镜像出预览，并把问题告诉导师
    warning = ""
    try:
        hr_sync.refresh_mirror(db, hr_sync.client_from_config(db, session=session))
    except HrClientError as e:
        db.rollback()
        warning = f"{e}。以下是上次同步时的数据。"

    result = hr_sync.preview_for(db, tutor)
    result["warning"] = warning
    result["lastRefreshAt"] = hr_sync.config_view(db)["lastRefreshAt"]
    return result


@router.post("/apply")
def apply(
    body: ApplyRequest,
    db: Session = Depends(get_db),
    tutor: models.Tutor = Depends(get_current_tutor),
):
    if not tutor.hr_user_id:
        raise HTTPException(status_code=409, detail="你的账号还没有关联教务账号")
    try:
        return hr_sync.apply_for(db, tutor, [d.model_dump() for d in body.decisions])
    except PermissionError as e:
        db.rollback()
        raise HTTPException(status_code=403, detail=str(e))
    except LookupError as e:
        db.rollback()
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(e))
