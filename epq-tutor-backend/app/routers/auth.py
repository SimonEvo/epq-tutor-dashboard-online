import os
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from app.database import get_db
from app import models
from app.auth import verify_password, token_for, get_current_tutor
from app.schemas import LoginRequest, TokenResponse, MeResponse

router = APIRouter(prefix="/auth", tags=["auth"])

SSO_COOKIE_NAME = "epq_sso_token"
SSO_COOKIE_MAX_AGE = 60 * 60 * 24 * 7  # 7 days
SSO_COOKIE_DOMAIN = os.getenv("SSO_COOKIE_DOMAIN", ".simonevo.top")


@router.post("/login", response_model=TokenResponse)
def login(req: LoginRequest, db: Session = Depends(get_db)):
    tutor = db.query(models.Tutor).filter(models.Tutor.username == req.username).first()
    if not tutor or not verify_password(req.password, tutor.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="用户名或密码错误")
    if tutor.status != "active":
        # 和密码错误分开提示：账号被停用时，反复试密码是没意义的
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="账号已停用，请联系管理员")

    tutor.last_login_at = datetime.now(timezone.utc)
    db.commit()

    token = token_for(tutor)
    response = JSONResponse(content={
        "access_token": token,
        "token_type": "bearer",
        "role": tutor.role,
        "username": tutor.username,
        "displayName": tutor.display_name or "",
    })
    response.set_cookie(
        key=SSO_COOKIE_NAME,
        value=token,
        max_age=SSO_COOKIE_MAX_AGE,
        domain=SSO_COOKIE_DOMAIN,
        path="/",
        secure=True,
        httponly=False,  # gantt-pro needs JS access
        samesite="lax",
    )
    return response


@router.post("/logout", status_code=204)
def logout():
    response = JSONResponse(content=None, status_code=204)
    response.delete_cookie(key=SSO_COOKIE_NAME, domain=SSO_COOKIE_DOMAIN, path="/")
    return response


@router.get("/me", response_model=MeResponse)
def me(tutor: models.Tutor = Depends(get_current_tutor)):
    """前端启动时确认身份和角色。

    角色只用来决定界面显示什么；每个需要管理员的端点都各自校验 require_admin，
    不依赖前端自觉。
    """
    return MeResponse(
        id=tutor.id,
        username=tutor.username,
        displayName=tutor.display_name or "",
        role=tutor.role,
    )
