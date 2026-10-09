# CLAUDE.md

Always respond in Chinese (Simplified).


## 项目概述
EPQ 学生辅导进度管理系统，单人家教自用，最多 30 名学生。用于课时记录、SA 小时追踪、EPQ 里程碑管理、AI 报告生成。

## 仓库结构
```
epq-tutor-dashboard-online/
├── tutoring-system/      # React 前端
├── epq-tutor-backend/    # FastAPI 后端
├── deploy.py             # 一键部署前后端（跨平台，mac/Win 通用）
└── CLAUDE.md
```

## 技术栈
**前端：** React 19 + Vite + TypeScript + Tailwind CSS v4 + Zustand + React Router v7

**后端：** FastAPI + SQLAlchemy + **SQLite**（`/opt/epq-tutor-backend/data/epq_tutor.db`）+ python-jose（JWT）+ passlib（bcrypt）

**部署：** Nginx + systemd + 阿里云 ECS（121.43.194.213）

## 常用命令
```bash
# 一键部署前后端（在根目录运行，mac/Win 通用）
python deploy.py

# 前端单独开发
cd tutoring-system && npm run dev   # localhost:5173（需后端在 8001 运行）

# 后端单独启动（Win 用 .venv/Scripts/）
cd epq-tutor-backend && .venv/bin/uvicorn app.main:app --reload --port 8001

# 灌本地假数据（仅 dev，别在服务器上跑）——压测/验证列表视图用
cd epq-tutor-backend && .venv/bin/python seed_local.py --students 30 --span-days 365

# 数据迁移（服务器上运行）
cd /opt/epq-tutor-backend && .venv/bin/python migrate_from_local.py --data-dir /opt/epq-tutor-data
```

**每次修改后运行 `python deploy.py` 并在浏览器强刷（Cmd+Shift+R）验证。**

## 架构要点
- 前端所有 API 调用经过 `tutoring-system/src/lib/dataService.ts`
- `apiFetch`（`githubClient.ts`）自动附带 JWT token（存 localStorage）
- Dashboard 使用轻量 `StudentSummarySchema`（含 sessions 列表但无全文）
- 学生详情页直接调 `GET /api/students/{id}` 获取完整数据
- 保存学生时全量替换关联表（sessions / milestones / entries / mindmaps）
- `privateNotes` 字段在导出时必须过滤，永远不出现在对外输出中

## 硬性约束
- `privateNotes` 不得出现在任何导出输出中
- JWT 不得 log 或出现在错误信息中
- 无服务端渲染，纯静态前端 + 独立后端

## 数据库表
`tutors` / `students` / `sessions` / `student_milestones` / `tags` / `student_tags` / `supervisors` / `personal_entries` / `mind_maps` / `weekly_reports` / `rounds`

详见 `epq-tutor-backend/app/models.py` 和 `epq-tutor-backend/app/schemas.py`

## 服务器信息
- IP：121.43.194.213
- 前端静态文件：`/opt/epq-tutor/dist/`
- 后端代码：`/opt/epq-tutor-backend/`
- 后端服务：`systemctl restart epq-tutor`
- Nginx 配置：`/etc/nginx/sites-enabled/epq-tutor`

## 已完成功能
认证（JWT）/ Dashboard 学生卡片、筛选排序、课时统计 / 新建&编辑学生、Brief Note 内联编辑、可用时间备注、标签系统 / Session 增删改查、三类 session、SA 课时自动计算 / 单节课 AI 报告、进度报告 / EPQ 里程碑追踪、N/A 支持 / 个人日志内联编辑 / 思维导图创建编辑、全屏、导出 SVG/PNG / 督导列表&详情页 / ICS 日历生成 / AI 指令中心、AI 周报 / 数据迁移脚本（migrate_from_local.py）

## 当前状态

> 以下工作都在分支 `feat/alembic-baseline` 上，**尚未提交、未部署**。

### 已完成（本分支）
- **P0 迁移框架** — Alembic + SQLite WAL。删掉 `main.py` 里 35 条吞异常的裸 ALTER，改为启动时跑迁移；前-Alembic 的旧库自动 stamp。**不迁 MySQL**（生产 ECS 882 MB 内存，MySQL 当初就是被这个逼退的）。
- **P1 租户隔离** — 九张全局表加 `tutor_id`，`app/scoping.py` 收口，13 个 router 改造，越权回归测试自动枚举端点。过程中修掉 7 个既有漏洞（含 `save_student` 跨租户覆写、`/api/calendar.ics` 公开无鉴权、nag/notify 全局扫表、备份互覆盖）。
- **学期拆分 + Excel 导入** — `registration_round` / `is_one_year`，一年期自动推导；Excel 表头自动识别 + diff 确认导入。
- **P2 角色与管理员后台** — `token_version` 让停用/改密当场作废旧令牌；`/api/admin/tutors` 只给元数据、无代登录；前端 `/admin` 页面 + 按角色隐藏轮次控件。
- **P3 内测运营配套** — AI 凭据收到服务端（机构共享一份，明文不下发），全部 AI 流量改经后端，按人记用量；新账号首屏引导 + 隐私说明。

任务书：`docs/projects/multi-tenant-internal-beta.md`、`docs/projects/term-split-and-student-import.md`
决策：`docs/adr/0004-multi-tenant-internal-beta.md`、`0005-registration-vs-submission-round.md`、`0006-org-shared-ai-credentials.md`

### Next Up
- **上线** — 四个阶段全部完成，仍在分支上未部署。首次部署前建议先给服务器 DB 做文件级快照；**上线后 admin 必须去设置页填一次 AI key**，否则所有人的 AI 功能报 503。
- **可选清理** — 生产 `trials` 表有一列废弃的 `duration_category`（8 行里 1 行有值），删与不删见 `docs/projects/multi-tenant-internal-beta.md` P0 章节。
- **教务系统对接** — 存档未实施，方案见 `docs/projects/multi-tenant-internal-beta.md` §8。
- Dashboard 多视图（看板 / 时间线 / 统计等）

## Agent skills

### Issue tracker

Issues live in GitHub Issues (`SimonEvo/epq-tutor-dashboard-online`). See `docs/agents/issue-tracker.md`.

### Triage labels

Uses the default five-role label vocabulary. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context repo — one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
