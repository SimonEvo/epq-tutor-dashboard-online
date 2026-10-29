"""调休加班

「算加班」的子选项：勾上后整场都算加班，不扣工作时间窗内的部分。
学生课、试听、日程事件、小组课四类都能勾。

- sessions / trials / schedule_events / group_classes.comp_time_overtime

Revision ID: 0008_comp_time_overtime
Revises: 0007_hr_sync
Create Date: 2026-10-29

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0008_comp_time_overtime"
down_revision: Union[str, None] = "0007_hr_sync"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLES = ("sessions", "trials", "schedule_events", "group_classes")


def _has_column(table: str, column: str) -> bool:
    return column in {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    # 幂等：调休加班先在 main 上线（main.py 的裸 ALTER 加列），之后本分支合入时
    # 生产库里这些列可能已经存在。
    for table in TABLES:
        if not _has_column(table, "comp_time_overtime"):
            with op.batch_alter_table(table) as b:
                b.add_column(
                    sa.Column("comp_time_overtime", sa.Boolean(), nullable=False, server_default=sa.false())
                )


def downgrade() -> None:
    for table in TABLES:
        with op.batch_alter_table(table) as b:
            b.drop_column("comp_time_overtime")
