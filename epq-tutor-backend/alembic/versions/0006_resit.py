"""Resit（二次提交）

学生交过一次之后在下一轮重新提交。跟延期不同：第一次提交真实发生过，
它的 Tii 记录、检查清单、结项、里程碑都要留档；SA 课时也要分开算。

- students.previous_attempts：之前各次提交的只读快照（JSON 列表）
- sessions.attempt：每节课属于第几次提交。存量课一律回填 1

设计见 docs/adr/0007-resit-as-new-attempt.md。

Revision ID: 0006_resit
Revises: 0005_system_config
Create Date: 2026-10-09

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0006_resit"
down_revision: Union[str, None] = "0005_system_config"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_column(table: str, column: str) -> bool:
    return column in {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    # 幂等：resit 先在 main 上线（main.py 的裸 ALTER 加列），之后本分支合入时
    # 生产库里这两列已经存在。
    if not _has_column("students", "previous_attempts"):
        with op.batch_alter_table("students") as b:
            b.add_column(sa.Column("previous_attempts", sa.JSON(), nullable=True))
    if not _has_column("sessions", "attempt"):
        with op.batch_alter_table("sessions") as b:
            b.add_column(
                sa.Column("attempt", sa.Integer(), nullable=False, server_default=sa.text("1"))
            )


def downgrade() -> None:
    with op.batch_alter_table("sessions") as b:
        b.drop_column("attempt")
    with op.batch_alter_table("students") as b:
        b.drop_column("previous_attempts")
