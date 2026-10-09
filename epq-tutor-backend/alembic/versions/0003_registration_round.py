"""拆分报名轮次与提交轮次，支持一年期学制

原先 students 只有 submission_round，既当签约批次又当提交批次。一年期学生
（学制跨两个批次）和延期学生都表达不了 —— 延期后原始批次直接丢失。

回填规则同教务系统 20260915_0042：存量学生视为普通学制，
registration_round = submission_round。存量数据里没有一年期标记可供识别，
真有一年期学生需要人工在编辑页勾选。

Revision ID: 0003_registration_round
Revises: 0002_tenant_scoping
Create Date: 2026-09-21

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0003_registration_round"
down_revision: Union[str, None] = "0002_tenant_scoping"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("students") as b:
        b.add_column(sa.Column("registration_round", sa.String(64), nullable=True))
        b.add_column(
            sa.Column("is_one_year", sa.Boolean(), nullable=False, server_default=sa.text("0"))
        )

    op.get_bind().execute(sa.text(
        "UPDATE students SET registration_round = submission_round "
        "WHERE registration_round IS NULL"
    ))


def downgrade() -> None:
    with op.batch_alter_table("students") as b:
        b.drop_column("is_one_year")
        b.drop_column("registration_round")
