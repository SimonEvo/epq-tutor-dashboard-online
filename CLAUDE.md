# CLAUDE.md

## 项目概述
EPQ 学生辅导进度管理系统，单人家教自用，最多 30 名学生。用于课时记录、SA 小时追踪、EPQ 里程碑管理、AI 报告生成。

## 仓库结构
```
epq-tutor-dashboard-online/
├── tutoring-system/      # React 前端
├── epq-tutor-backend/    # FastAPI 后端
├── deploy.sh             # 一键部署前后端
└── CLAUDE.md
```

## 技术栈
**前端：** React 18 + Vite + TypeScript + Tailwind CSS + shadcn/ui + Zustand + React Router v6

**后端：** FastAPI + SQLAlchemy + MySQL + python-jose（JWT）+ passlib（bcrypt）

**部署：** Nginx + systemd + 阿里云 ECS（121.43.194.213）

## 常用命令
```bash
# 一键部署前后端（在根目录运行）
./deploy.sh

# 前端单独开发
cd tutoring-system && npm run dev   # localhost:5173（需后端在 8001 运行）

# 后端单独启动
cd epq-tutor-backend && .venv/bin/uvicorn app.main:app --reload --port 8001

# 数据迁移（服务器上运行）
cd /opt/epq-tutor-backend && .venv/bin/python migrate_from_local.py --data-dir /opt/epq-tutor-data
```

**每次修改后运行 `./deploy.sh` 并在浏览器强刷（Cmd+Shift+R）验证。**

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
- （开始新任务前填这里）

### Next Up
- Dashboard 多视图（看板 / 时间线 / 统计等）
