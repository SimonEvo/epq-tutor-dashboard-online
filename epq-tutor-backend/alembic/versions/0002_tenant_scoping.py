"""多租户隔离：九张全局表加 tutor_id，tutors 加 role / nag_webhook_url / ics_token

此前只有 students 和 gantt_projects 按 tutor_id 隔离。其余业务表是全局共享的，
第二个账号一登录就能看见第一个账号的督导、试听、日程、团课、周报和操作日志。
本迁移补齐隔离所需的列，并把存量数据全部归属到最早的那个 tutor。

rounds 不在此列 —— 提交轮次是全机构统一的学期批次，保持全局，仅 admin 可写
（见 docs/adr/0004-multi-tenant-internal-beta.md 决策 3）。

Revision ID: 0002_tenant_scoping
Revises: 0001_baseline
Create Date: 2026-09-21

"""
import secrets
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0002_tenant_scoping"
down_revision: Union[str, None] = "0001_baseline"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# 加 tutor_id 的表。rounds / tutors 不在内。
SCOPED_TABLES = [
    "supervisors",
    "tags",
    "trials",
    "schedule_events",
    "group_classes",
    "weekly_reports",
    "manual_logs",
    "action_logs",
    "workflow_analyses",
]


def _tags_table(*, with_tutor_unique: bool) -> sa.Table:
    """tags 表的显式定义，供 batch copy_from 使用。

    反射拿到的匿名 UNIQUE(name) 在 SQLite 上无法按名 drop，这里给它一个名字，
    batch 重建时就能把它换掉。
    """
    uq = (
        sa.UniqueConstraint("tutor_id", "name", name="uq_tag_tutor_name")
        if with_tutor_unique
        else sa.UniqueConstraint("name", name="uq_tag_name_legacy")
    )
    return sa.Table(
        "tags",
        sa.MetaData(),
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(64), nullable=False),
        sa.Column(
            "tutor_id",
            sa.String(64),
            sa.ForeignKey("tutors.id", name="fk_tags_tutor_id"),
            nullable=False,
        ),
        uq,
        # copy_from 是"照这份定义重建"，没写进来的东西会在重建中丢失 ——
        # 上面循环刚建好的索引和外键必须在这里重复声明。
        sa.Index("ix_tags_tutor_id", "tutor_id"),
    )


def upgrade() -> None:
    conn = op.get_bind()

    # ── tutors 新列 ──────────────────────────────────────────────────────────
    with op.batch_alter_table("tutors") as b:
        b.add_column(sa.Column("role", sa.String(16), nullable=False, server_default="tutor"))
        b.add_column(sa.Column("nag_webhook_url", sa.String(512), nullable=True))
        b.add_column(sa.Column("ics_token", sa.String(64), nullable=True))
    op.create_index("ix_tutors_ics_token", "tutors", ["ics_token"], unique=True)

    # 存量账号：最早创建的那个是系统所有者，置为 admin；其余保持 tutor。
    owner_id = conn.execute(sa.text(
        "SELECT id FROM tutors ORDER BY created_at IS NULL, created_at, id LIMIT 1"
    )).scalar()
    if owner_id:
        conn.execute(sa.text("UPDATE tutors SET role = 'admin' WHERE id = :i"), {"i": owner_id})

    # 每个账号发一个日历订阅串（原先 /api/calendar.ics 是全局无鉴权的单份内存副本）
    for (tid,) in conn.execute(sa.text("SELECT id FROM tutors WHERE ics_token IS NULL")).fetchall():
        conn.execute(
            sa.text("UPDATE tutors SET ics_token = :t WHERE id = :i"),
            {"t": secrets.token_urlsafe(24), "i": tid},
        )

    # ── 九张表加 tutor_id ────────────────────────────────────────────────────
    # 三步走：先可空加列 → 回填 → 再收紧为 NOT NULL。
    # SQLite 不能直接给已有表加 NOT NULL 列（无默认值时），必须走这个顺序。
    for table in SCOPED_TABLES:
        with op.batch_alter_table(table) as b:
            b.add_column(sa.Column("tutor_id", sa.String(64), nullable=True))

        if owner_id:
            conn.execute(
                sa.text(f"UPDATE {table} SET tutor_id = :i WHERE tutor_id IS NULL"),
                {"i": owner_id},
            )
        else:
            # 全新库：表必然是空的，没有可回填的行。若非空则说明前提不成立，直接失败。
            leftover = conn.execute(sa.text(f"SELECT COUNT(*) FROM {table}")).scalar()
            if leftover:
                raise RuntimeError(
                    f"{table} 有 {leftover} 行数据但库里没有任何 tutor，无法确定归属。"
                )

        with op.batch_alter_table(table) as b:
            b.alter_column("tutor_id", existing_type=sa.String(64), nullable=False)
            b.create_index(f"ix_{table}_tutor_id", ["tutor_id"])
            b.create_foreign_key(f"fk_{table}_tutor_id", "tutors", ["tutor_id"], ["id"])

    # ── tags 唯一约束：全局 UNIQUE(name) → UNIQUE(tutor_id, name) ────────────
    # 原约束是匿名的，SQLite 下没法按名字 drop，反射重建也会把它原样带过来。
    # 用 copy_from 给出目标表定义，让 batch 照着它重建，而不是照着反射结果。
    with op.batch_alter_table("tags", copy_from=_tags_table(with_tutor_unique=False)) as b:
        b.drop_constraint("uq_tag_name_legacy", type_="unique")
        b.create_unique_constraint("uq_tag_tutor_name", ["tutor_id", "name"])


def downgrade() -> None:
    with op.batch_alter_table("tags", copy_from=_tags_table(with_tutor_unique=True)) as b:
        b.drop_constraint("uq_tag_tutor_name", type_="unique")
        b.create_unique_constraint("uq_tag_name_legacy", ["name"])

    for table in SCOPED_TABLES:
        with op.batch_alter_table(table) as b:
            b.drop_constraint(f"fk_{table}_tutor_id", type_="foreignkey")
            b.drop_index(f"ix_{table}_tutor_id")
            b.drop_column("tutor_id")

    op.drop_index("ix_tutors_ics_token", table_name="tutors")
    with op.batch_alter_table("tutors") as b:
        b.drop_column("ics_token")
        b.drop_column("nag_webhook_url")
        b.drop_column("role")
