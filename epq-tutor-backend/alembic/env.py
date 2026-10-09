from logging.config import fileConfig
from sqlalchemy import engine_from_config, pool
from alembic import context
from dotenv import load_dotenv
import os

load_dotenv()

config = context.config
# 环境变量优先；为空时沿用调用方（app.main 启动迁移）预置的值
config.set_main_option(
    "sqlalchemy.url",
    os.getenv("DATABASE_URL") or config.get_main_option("sqlalchemy.url", ""),
)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

from app.database import Base  # noqa: E402
import app.models  # noqa: F401, E402 — registers all models

target_metadata = Base.metadata


def run_migrations_offline():
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online():
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            # SQLite 不支持 ALTER COLUMN / 后加约束，列变更必须走临时表重建
            render_as_batch=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
