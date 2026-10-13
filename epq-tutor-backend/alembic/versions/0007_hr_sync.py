"""教务同步：tutors.hr_user_id、students.hr_student_code、hr_projects 镜像表

本系统侧消费教务现有集成接口（ADR 0008）。教务一行不改。

  tutors.hr_user_id        —— 管理员手工关联到教务真实账号 id（不按姓名猜）
  students.hr_student_code —— 教务 student_code；唯一约束是 (tutor_id, code)，
                              因为两位导师带同一名学生时各有一份独立记录
  hr_projects              —— 教务项目详情的本地镜像，全局增量拉取

增量位点存在 system_config（键 hr_cursor），不调教务的 ack 端点——
那个端点把 consumer 写死成了在线表单系统，调了会挪动别人的位点。

Revision ID: 0007_hr_sync
Revises: 0006_resit
Create Date: 2026-10-10

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0007_hr_sync"
down_revision: Union[str, None] = "0006_resit"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("tutors") as b:
        b.add_column(sa.Column("hr_user_id", sa.Integer(), nullable=True))
        b.create_unique_constraint("uq_tutors_hr_user_id", ["hr_user_id"])

    with op.batch_alter_table("students") as b:
        b.add_column(sa.Column("hr_student_code", sa.String(20), nullable=True))
        b.create_index("ix_students_hr_student_code", ["hr_student_code"])
        b.create_unique_constraint("uq_student_tutor_hr_code", ["tutor_id", "hr_student_code"])

    op.create_table(
        "hr_projects",
        sa.Column("student_code", sa.String(20), primary_key=True),
        sa.Column("hr_project_id", sa.Integer(), nullable=True),
        sa.Column("data_version", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("fetched_at", sa.DateTime(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("hr_projects")
    with op.batch_alter_table("students") as b:
        b.drop_constraint("uq_student_tutor_hr_code", type_="unique")
        b.drop_index("ix_students_hr_student_code")
        b.drop_column("hr_student_code")
    with op.batch_alter_table("tutors") as b:
        b.drop_constraint("uq_tutors_hr_user_id", type_="unique")
        b.drop_column("hr_user_id")
