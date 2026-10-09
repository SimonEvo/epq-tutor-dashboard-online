"""system_config 表：机构共享的 AI 凭据

P3 方案 B：内测老师多半没有自己的 DeepSeek / 通义 key，而 AI 报告是本系统的
核心卖点之一 —— 不给 key 等于收不到有效反馈。改为后端存一份机构共享凭据，
admin 在管理面配置，前端不再持有也不再传 key。

顺带解决用量统计：原先 claudeService / workflowAnalysisService 是浏览器直连
provider 的，那种调用永远数不到。全部改走后端后才有可能按人记次数。

Revision ID: 0005_system_config
Revises: 0004_tutor_account_management
Create Date: 2026-09-22

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0005_system_config"
down_revision: Union[str, None] = "0004_tutor_account_management"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "system_config",
        sa.Column("key", sa.String(64), primary_key=True),
        sa.Column("value", sa.Text(), nullable=False, server_default=""),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("system_config")
