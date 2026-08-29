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
**前端：** React 18 + Vite + TypeScript + Tailwind CSS + shadcn/ui + Zustand + React Router v6

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
### In Progress
- **学生知识库** — P1–P8 已实现并本地验证（分支 `feature/student-knowledge-base`）。**待办：`python deploy.py` 上线 + 线上强刷验证（P9）**。后端已加两表 + `tutors.kb_context_sources` 列，`create_all` / ALTER 自动迁移，无需手动建表。
- **日程周视角（Week Schedule View）** — 已实现，本地 `tsc` / lint 通过。Dashboard 新增"日程"视图：周一~周日日历网格 + 动态时间轴 + 工作时间高亮 + 当前时间红线 + 撞车 split。新表 `schedule_events`（`create_all` 自动建）。顺带修 bug：session 起始时间全线必填。任务书 `docs/projects/week-schedule-view.md`。**待办：`python deploy.py` 上线 + 线上强刷验证。**

- **提交前检查清单 + 提交截止时间 + 结项（改动一）** — 已实现，本地 `tsc` / lint 通过。后端加 tutors/students/rounds 列（`create_all` + ALTER 自动迁移）+ 窄端点 `PATCH /api/students/{id}/checklist|deadline|wrap-up|tii-checks`、`/api/checklist-template`、`PUT /api/rounds/{name}/deadlines`；前端新增 Dashboard「提交」视图、详情页「提交」卡片、设置页「提交清单模板 / 提交截止时间」两节、甘特图已结项折叠。任务书 `docs/projects/submission-checklist.md`，ADR 0003。**待办：`python deploy.py` 上线 + 线上强刷验证（走任务书 §7 验收清单）。**

- **设置页重构 + 学期管理（改动二）** — 已实现，`npm run typecheck` / lint 通过。设置页改成左侧 5 个分类目录（外观 / 教学 / 集成 / AI / 数据）+ 右侧只渲染当前分类，分类记 `localStorage['settings-category']`；新增「学期管理」节吃掉原「归档管理」（一行一届：两个 ddl + 学生数 + 归档开关 + 展开看学生/下载 JSON），改动一里的「提交截止时间」节并入其中。任务书 `docs/projects/settings-page-restructure.md`。**待办：与改动一一起 `python deploy.py` 上线 + 线上强刷验证。**

### Next Up
- **学生知识库（Student Knowledge Base）** — 单学生私有 AI 知识库，三层架构（自动结构化上下文 / 活总结 / 原料层）+ 消化流程。任务书 `docs/projects/student-knowledge-base.md`（**§12 实现路线已批准，P1–P8 完成**），决策 `docs/adr/0002-student-knowledge-base-architecture.md`，术语见 `CONTEXT.md`
- Dashboard 多视图（看板 / 时间线 / 统计等）

## Agent skills

### Issue tracker

Issues live in GitHub Issues (`SimonEvo/epq-tutor-dashboard-online`). See `docs/agents/issue-tracker.md`.

### Triage labels

Uses the default five-role label vocabulary. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context repo — one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
