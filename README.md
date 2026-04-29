# EPQ Tutor Dashboard (Online)

EPQ 学生辅导进度管理系统，单人家教使用，最多 30 名学生。支持课时记录、SA 小时追踪、EPQ 里程碑管理、AI 周报、日历订阅等功能。

## 项目结构

```
epq-tutor-dashboard-online/
├── tutoring-system/      # React 前端
└── epq-tutor-backend/    # FastAPI 后端
```

---

## 系统架构

```
浏览器 (React)
    ↕ HTTP + JWT
Nginx (端口 80)
    ├── /          → 静态文件 /opt/epq-tutor/dist/
    ├── /api/*     → FastAPI (端口 8001)
    └── /auth/*    → FastAPI (端口 8001)
                        ↕ SQLAlchemy ORM
                   MySQL (epq_tutor 数据库)
```

### 认证流程

1. 用户输入账号密码 → `POST /auth/login`
2. 后端查 `tutors` 表，bcrypt 验证密码
3. 验证通过 → 生成 JWT token（有效期 7 天）
4. 前端存入 `localStorage`（key: `epq_tutor_jwt`）
5. 之后所有请求自动带 `Authorization: Bearer <token>`
6. 后端每个接口验证 token，所有查询带 `tutor_id` 过滤

### 数据读写流程

**读取学生列表（Dashboard）**
```
GET /api/students
→ 查 students 表 WHERE tutor_id = ?
→ 关联查 sessions / milestones / tags
→ 返回 StudentSummarySchema[]（轻量，不含 session 全文）
```

**读取学生详情**
```
GET /api/students/{id}
→ 查 students 表 + 所有关联表
→ 返回完整 StudentSchema（含 sessions 全文内容）
```

**保存学生**
```
PUT /api/students/{id}
→ 更新 students 表
→ 全量替换 sessions / milestones / personal_entries / mind_maps
→ 更新 student_tags 关联表
→ 前端触发重新生成 ICS 日历
```

### 数据库表结构

| 表名 | 说明 |
|------|------|
| `tutors` | 教师账户，存 bcrypt 密码哈希 |
| `students` | 学生信息，外键关联 tutor |
| `sessions` | 课程记录（SA/TA/Theory），含 summary、homework、transcript |
| `student_milestones` | 里程碑进度（student_id + milestone_id 联合主键） |
| `tags` + `student_tags` | 标签多对多关联 |
| `supervisors` | 督导信息 |
| `personal_entries` | 个人日志 |
| `mind_maps` | 思维导图（Markdown 格式） |
| `weekly_reports` | AI 周报历史 |
| `rounds` | 班期列表 |

### 代码文件对照

```
前端 (tutoring-system/src/)
  lib/dataService.ts      所有 API 调用入口
  lib/githubClient.ts     apiFetch（自动带 JWT）
  stores/studentStore.ts  全局状态 + 保存逻辑
  stores/authStore.ts     登录/登出/token 管理

后端 (epq-tutor-backend/app/)
  main.py                 FastAPI 入口，注册路由
  auth.py                 JWT 生成/验证，密码哈希
  models.py               数据库表定义（SQLAlchemy）
  schemas.py              请求/响应格式（Pydantic）
  routers/students.py     学生 CRUD
  routers/supervisors.py  督导 CRUD
  routers/config.py       tags / rounds
  routers/reports.py      周报
  routers/calendar.py     ICS 日历
```

### 接入其他系统

| 需求 | 方式 |
|------|------|
| 外部系统读取学生数据 | 调 `GET /api/students`（需 JWT），或直接查 MySQL |
| 外部系统写入 session | `PUT /api/students/{id}`，附完整学生对象 |
| 新增 API 端点 | 在 `app/routers/` 下新建文件，在 `main.py` 注册 |
| 去掉登录限制（内网） | 移除路由中的 `Depends(get_current_tutor)` |
| 对接通知（微信/钉钉） | 在 `_upsert_student` 后加 webhook 调用 |
| 定时任务 | APScheduler 或服务器 cron 调后端脚本 |

---

## 部署

### 环境要求

- 服务器：Ubuntu 20.04+，1 核 2G 以上
- 软件：Python 3.12、MySQL 8、Nginx、Node.js 18+

### 首次部署

```bash
# 1. 服务器初始化（MySQL + Nginx + 后端 venv）
cd epq-tutor-backend
bash deploy/setup.sh

# 2. 配置环境变量
cp epq-tutor-backend/.env.example epq-tutor-backend/.env
# 编辑 .env：DATABASE_URL、SECRET_KEY、TUTOR_USERNAME、TUTOR_PASSWORD

# 3. 建表 + 创建账户
cd epq-tutor-backend
.venv/bin/python create_tables.py
.venv/bin/python init_tutor.py

# 4. 部署前端
cd tutoring-system
npm install
npm run deploy
```

### 日常更新

```bash
# 根目录一键部署前后端
./deploy.sh

# 或分别部署
cd epq-tutor-backend && ./deploy.sh     # 只更新后端
cd tutoring-system && npm run deploy    # 只更新前端
```

### 从 GitHub 数据仓库迁移历史数据

```bash
cd epq-tutor-backend
GITHUB_PAT=ghp_xxx .venv/bin/python migrate_from_github.py
```

---

## 技术栈

**前端：** React 18 + Vite + TypeScript + Tailwind CSS + shadcn/ui + Zustand + React Router v6

**后端：** FastAPI + SQLAlchemy + Alembic + MySQL + python-jose（JWT）+ passlib（bcrypt）

**部署：** Nginx + systemd + 阿里云 ECS
