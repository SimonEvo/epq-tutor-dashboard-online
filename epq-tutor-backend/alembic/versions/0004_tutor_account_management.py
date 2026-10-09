"""账号管理：tutors 加 status / display_name / token_version / last_login_at

开放内测要能停用发错的号、能重置密码。光改密码不够 —— 已签发的 JWT 有效期
7 天，不作废就等于停用了个寂寞。token_version 进 JWT payload，改密码或停用时
自增，令牌当场失效。做法抄教务系统 users.token_version
（../hr-management/backend/app/api/deps.py:_authenticate_token）。

role 列在 0002 就加了（rounds 的写权限闸门依赖它），这里不重复。

Revision ID: 0004_tutor_account_management
Revises: 0003_registration_round
Create Date: 2026-09-21

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0004_tutor_account_management"
down_revision: Union[str, None] = "0003_registration_round"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("tutors") as b:
        b.add_column(sa.Column("status", sa.String(16), nullable=False, server_default="active"))
        b.add_column(sa.Column("display_name", sa.String(128), nullable=True))
        b.add_column(sa.Column("token_version", sa.Integer(), nullable=False, server_default=sa.text("1")))
        b.add_column(sa.Column("last_login_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("tutors") as b:
        b.drop_column("last_login_at")
        b.drop_column("token_version")
        b.drop_column("display_name")
        b.drop_column("status")
