import os
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from app.database import get_db
from app import models
from app.auth import verify_password, create_access_token
from app.schemas import LoginRequest, TokenResponse

router = APIRouter(prefix="/auth", tags=["auth"])

SSO_COOKIE_NAME = "epq_sso_token"
SSO_COOKIE_MAX_AGE = 60 * 60 * 24 * 7  # 7 days
SSO_COOKIE_DOMAIN = os.getenv("SSO_COOKIE_DOMAIN", ".simonevo.top")


@router.post("/login", response_model=TokenResponse)
def login(req: LoginRequest, db: Session = Depends(get_db)):
    tutor = db.query(models.Tutor).filter(models.Tutor.username == req.username).first()
    if not tutor or not verify_password(req.password, tutor.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="用户名或密码错误")
    token = create_access_token({"sub": tutor.id})
    response = JSONResponse(content={"access_token": token})
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
