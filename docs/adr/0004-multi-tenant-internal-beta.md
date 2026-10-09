# ADR 0004: Multi-Tenant on a Tutor Boundary, Independent Accounts, MySQL

**Status:** Accepted
**Date:** 2026-09-21

## Context

本系统建成时是**单人自用**（见根 `CLAUDE.md`）。现在要开放给部门内其他老师内测，收集反馈后再考虑接入生产端的教务系统（`../hr-management`，MySQL，角色 admin/teacher/marketing，`Project` = 学生，`ProjectMember` = 老师分配）。

代码审计发现：`tutors` 表和 `tutor_id` 外键**早已存在**，但真正按 tutor 过滤的只有 `students`（及其级联子表）和 `gantt_projects`。以下九张表是全局共享的：

```
supervisors  trials  schedule_events  tags  rounds
weekly_reports  manual_logs  action_logs  workflow_analyses
```

即：第二个账号一登录，立刻看见第一个账号的全部督导、试听、日程、AI 周报和操作日志。

最严重的一处是备份：`backup.py` 的 `_build_snapshot(db)` 不带租户过滤，导出全库；`POST /api/backup/restore/{date}` 同样全局写回。**多账号上线后，任一内测老师点一次"恢复备份"，会用他看到的快照覆盖所有人的数据。**

同时暴露的基建问题：schema 演进靠 `create_all` + `main.py` lifespan 里一串裸 `ALTER TABLE`（异常吞掉），SQLite 单文件不适合多人并发写。

## Decision

**1. 租户边界 = Tutor。**
每一行业务数据恰好属于一个 tutor。不引入独立的 `Organization` / `Workspace` 概念——内测规模（≤30 老师）下多一层只是负担，且真正的"机构"语义将来由教务系统提供。

**2. 账号体系与教务系统保持独立。**
教务系统正在生产环境跑，内测期不碰它。本系统自己发号。对齐身份靠将来在 `students` 上加 `external_project_id`（对 `projects.student_code`），而不是共享用户表。内测结束再评估 SSO 合并。

**3. 九张表中，八张变成租户私有，`rounds` 保持全局。**

| 表 | 归属 | 理由 |
|---|---|---|
| `supervisors` | 租户私有 | 记录里含 `notes` 等导师私人评价。现实中督导确实跨老师共享，但共享目录的正确来源是教务的 `SAInfo`，不是这里自建——内测期先各存各的，对接时再收敛为机构主数据。 |
| `trials` `schedule_events` `tags` `weekly_reports` `manual_logs` `action_logs` `workflow_analyses` | 租户私有 | 全部是导师个人工作流产物。 |
| `rounds` | **全局，仅 admin 可写** | 提交轮次（`25秋` / `26春`）是全机构统一的学期批次。若每人自建一份，同名不同行，且将来对不上教务的 `academic_term`。tutor 仍可读、可给学生选，但不能增删。 |

**4. 两级角色 `admin` / `tutor`，admin 是 tutor 的超集。**
Simon 既要管账号也要带自己的学生，所以 admin 账号同时拥有完整的 tutor 数据空间。

**5. admin 能管账号，不能看内容。**
管理面只暴露元数据：用户名、状态、创建时间、最后登录、学生数、AI 调用次数。不提供任何读取他人学生、纪要、私密笔记的接口，也不提供"以某用户身份登录"。这是内测老师肯把真实学生信息录进来的前提，故写成架构约束而非产品选项。破例需新开 ADR。

**6. 隔离靠显式 `scoped()` helper + 一个越权回归测试兜底。**
不使用 SQLAlchemy 全局查询过滤器（隐式、难调试、遇到 join 和原生 SQL 就失效）。改为每个 router 显式过滤，外加一个测试：建 A、B 两个 tutor，各写一份数据，遍历全部 GET 端点断言 B 看不到 A 的任何行。漏改一处 router 由测试抓。

**7. 留在 SQLite，只补 Alembic 与 WAL。不迁 MySQL。**
生产 ECS 总内存 882 MB、可用约 335 MB、无 swap。MySQL 本来就装在这台机器上，是 2026-05 被主动 `disable` 掉的（仓库里 `migrate_to_sqlite.py` 即当时的单向迁移脚本，`database.py` 的 `pool_size=2, max_overflow=0` 是同一压力的残留），当时的 commit 未记录原因。

本决策先前的版本是"迁 MySQL"，在未核实服务器规格的情况下做出，**已推翻**。

真正解决痛点的是迁移框架而非引擎：schema 演进目前靠 `main.py` lifespan 里一串吞异常的裸 `ALTER TABLE`，这一条在 SQLite 上同样能用 Alembic（`batch_alter_table`，教务系统自己的迁移文件即如此写）解决。按实际负载估算——30 老师 × 30 学生、以读为主、写入是"保存一个学生"这种每人每天几次的量级——SQLite 开 WAL 后读写不互斥，足以支撑内测。当前库 1.7 MB。

引擎切换推迟到两个触发条件之一出现时再做：ECS 升配，或对接教务系统时一并处理。届时 `database.py` 已写好的非 SQLite 分支仍然可用，切换成本不会因为推迟而上升。

**8. 密码与会话：引入 `token_version`。**
抄教务系统 `users.token_version` 的做法——admin 停用账号或重置密码时自增，使该用户已签发的 JWT 立即失效。内测期一定会遇到发错号、老师离职的情况，没有这个只能等 7 天 token 自然过期。

## Alternatives Considered

**共享教务系统的 `users` 表做 SSO** — 身份天然对齐，省掉将来的合并工作。否决：教务在生产跑，为一个内测功能改它的认证链路，风险和协调成本都不对等。独立发号的代价（将来一次性对齐）是可控的、且被推迟到了信息更充分的时候。

**迁 MySQL** — 与教务系统引擎一致，并发写无锁竞争。否决：见决策 7，生产机内存装不下。"迁移窗口现在最便宜"成立，但便宜的是*迁移框架*的窗口，不是*引擎*的窗口——前者本次就做，后者推迟不会变贵。

**当前机器上调瘦 MySQL（`innodb_buffer_pool_size=64M`、关 `performance_schema`）+ 加 swap** — 不花钱且不改计划。否决：335 MB 余量下与 nginx、后端进程抢内存，OOM kill 后端是实打实的风险，为一个内测阶段用不上的能力去换不值。

**`rounds` 也做成租户私有** — 隔离规则统一，不用为一张表破例。否决：轮次是机构事实而非个人偏好；每人一份会在对接教务 `academic_term` 时产生 N 份同名轮次需要人工合并。

**admin 可代登录 / 可读他人数据** — 排障方便。否决：见决策 5。

**SQLAlchemy 全局查询过滤器实现隔离** — 一处生效，不会漏改。否决：见决策 6。

## Consequences

- 现有全部数据在迁移中归属到 Simon 的 tutor id。
- Alembic 在 SQLite 上必须用 `batch_alter_table` 做列变更（SQLite 不支持 `ALTER COLUMN` / 加约束），`env.py` 需开 `render_as_batch=True`。
- `tags` 的唯一约束从 `(name)` 改为 `(tutor_id, name)`。
- `students.supervisor_id` 写入时必须校验该督导属于同一 tutor，否则成为跨租户读取的旁路。
- 备份目录按 tutor 分子目录；restore 强制限定在调用者自己的租户内。
- 企微催促 webhook 从全局环境变量改为按 tutor 存库，否则所有人的提醒推进同一个群。
- Zoom 凭据和 AI apiKey 目前由前端每次请求携带（存在各自浏览器的 localStorage），天然按人隔离，**本次不动**；但内测老师多半没有自己的 AI key，供给方式是一个待决问题，见任务书 §7。
