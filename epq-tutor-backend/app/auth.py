from datetime import datetime, timedelta, timezone
from typing import Optional
from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from app.database import get_db
from app import models
import os

SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-change-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "10080"))

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
bearer_scheme = HTTPBearer()


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode["exp"] = expire
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def token_for(tutor: models.Tutor) -> str:
    """签发带 token_version 的令牌。

    payload 里带 ver，是为了让「停用账号」和「重置密码」能立刻生效 ——
    令牌有效期 7 天，光改库里的密码不作废旧令牌等于没停用。
    所有签发点都应走这里，不要直接调 create_access_token。
    """
    return create_access_token({"sub": tutor.id, "ver": tutor.token_version or 1})


def get_current_tutor(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> models.Tutor:
    token = credentials.credentials
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired token",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        tutor_id: str = payload.get("sub")
        if tutor_id is None:
            raise credentials_exception
        token_ver = int(payload.get("ver", 0))
    except (JWTError, TypeError, ValueError):
        raise credentials_exception

    tutor = db.query(models.Tutor).filter(models.Tutor.id == tutor_id).first()
    if tutor is None:
        raise credentials_exception
    if tutor.status != "active":
        raise credentials_exception
    if (tutor.token_version or 1) != token_ver:
        # 密码被重置 / 账号被停用过 —— 这张旧令牌作废
        raise credentials_exception
    return tutor
