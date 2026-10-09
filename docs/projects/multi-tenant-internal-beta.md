# 项目任务书：多租户化与内测开放（Multi-Tenant Internal Beta）

> 面向维护此功能的 AI agent / 开发者。术语沿用根 `CLAUDE.md`。架构决策与否决理由见 `docs/adr/0004-multi-tenant-internal-beta.md`，本文只讲**怎么做**。

## 1. 目标

把单人自用系统变成多人系统，开放给部门内若干老师内测，收集反馈。教务系统（`../hr-management`）对接**不在本期范围**，但本期的数据模型要为它留好口子。

## 2. 非目标（明确排除 / 延后）

- **不接教务系统**。教务在生产跑，内测期不碰。对接方案见 §8（存档，不实施）。
- **不做自助注册**。账号一律由 admin 手工建，内测名单可控。
- **不做组织 / 工作区层级**。租户边界就是 tutor 本人。
- **不做 admin 代登录、不做 admin 读他人数据**（ADR 决策 5，硬约束）。
- **不动 Zoom / AI 凭据的现有传递方式**（前端每次请求携带）。
- **不做计费、配额硬限制**。只记用量，不拦。

## 3. 现状盘点（审计结论）

已按 `tutor_id` 隔离：`students` 及其级联（`sessions` / `student_milestones` / `personal_entries` / `mind_maps` / `homework_entries` / `student_living_summaries` / `student_knowledge_entries`）、`gantt_projects`。

**未隔离，多账号上线即互相可见：**

| 表 | 涉及 router |
|---|---|
| `supervisors` | `supervisors.py` |
| `trials` | `trials.py` |
| `schedule_events` | `schedule_events.py` |
| `tags` | `config.py` |
| `rounds` | `config.py` |
| `weekly_reports` | `reports.py` |
| `manual_logs` `action_logs` `workflow_analyses` | `workflow.py` |

**最高危：** `backup.py` — `_build_snapshot(db)` 导全库，`POST /restore/{date}` 全局写回，跨租户互相覆盖。**必须在开出第一个内测账号之前修掉。**

其它缺口：无 `role` 字段、无建号 API（靠手跑 `init_tutor.py`）、企微 webhook 是全局 env、schema 演进靠 `main.py` lifespan 里一串吞异常的裸 `ALTER TABLE`。

## 4. 实施路线

四个阶段。**P1 必须整块完成后才能开第一个内测账号**——半隔离状态比单人状态更危险，因为老师会以为自己的数据是私密的。

### P0 — 基建：Alembic + WAL（留在 SQLite）✅ 已实现

> 引擎不换，理由见 ADR 决策 7（生产 ECS 882 MB 内存，MySQL 当初就是被这个逼退的）。本阶段只解决"schema 演进没有框架"这一个问题。

实际落地：

1. `requirements.txt` 加 `alembic==1.20.0`。（`alembic/` 目录和 `alembic.ini` 是迁 SQLite 时留下的壳子，`alembic/versions/` 已空，`env.py` 复用。）
2. `env.py` 两处 `context.configure` 均加 `render_as_batch=True` —— SQLite 不支持 `ALTER COLUMN` 和后加约束，列变更必须走临时表重建。同时把 url 解析改成"环境变量优先、为空时沿用调用方预置值"，让 `app.main` 能以编程方式驱动迁移。
3. **Baseline 迁移** `alembic/versions/0001_baseline.py`，由 `models.py` autogenerate。
4. **`app/main.py` 的 `run_migrations()` 在启动时跑迁移**，取代原先那 35 条吞异常的裸 ALTER 和一次性轮次改名数据修正。迁移失败直接让服务起不来，不再悄悄跳过。
5. **自动 stamp**：判据"有 `tutors` 表但无 `alembic_version`"即认定为前-Alembic 旧库（生产库、各开发机上的旧 SQLite 文件），先 `stamp 0001_baseline` 再 `upgrade`。这样"先部署、后 stamp"的顺序陷阱不存在，也不需要在服务器上手工执行一次性命令。
6. WAL：`database.py` 里挂 SQLite `connect` 事件，设 `journal_mode=WAL` / `synchronous=NORMAL` / `busy_timeout=5000`。
7. `deploy.py` 在 restart 之前加一步 `pip install -q -r requirements.txt`（服务器 venv 已有 alembic 1.14，会升到 1.20）。

**未做，有意为之：** 不开 `PRAGMA foreign_keys=ON`。SQLite 默认关闭，存量数据从未经外键约束校验，贸然打开可能让原本成功的写入开始失败。要开需先跑一次孤儿行体检，另行处理。

**验收结果（本地，用生产库副本）：**

- baseline 与生产 schema 逐表逐列比对：21 张表、**零未知差异**（唯一已知项见下）
- `upgrade` → `downgrade base` → `upgrade` 往返正常
- 对已迁移库跑 `autogenerate` 得到空迁移，无漂移
- 三条入口路径均验证：全新空库建 21 表 / 前-Alembic 旧库自动 stamp 且 19 名学生数据完好 / 已 stamp 库重复启动为 no-op
- 服务实际启动，`/api/students`、`/api/config/rounds`、`/api/supervisors`、`/api/trials`、`/api/schedule-events`、`/api/group-classes` 全部 200
- WAL 生效（`journal_mode=wal`）；既有测试 7 passed

**已知残留：** 生产 `trials` 表多一列 `duration_category`（已废弃的时长区间字段，代码零引用，被 `duration_minutes` 取代）。baseline 不创建它，也不删生产上的它 —— 8 行中有 1 行（王泽霖 2026-05-16，值 `61-75`）仅存于该列，删掉即丢失该数据点。代价是 `autogenerate` 会持续提示删除此列，属已知噪音。待定。

**备注：** 生产 swap 为 0（本次未加，用户决定）。后端进程遇内存尖峰会被 OOM kill，与本阶段无关但需记在册。

### P1 — 租户隔离（整块交付，不可分批上线）✅ 已实现

**迁移 `0002_tenant_scoping`**：九张表加 `tutor_id`（NOT NULL + 索引 + 外键），存量行回填到最早创建的那个 tutor；`tags` 唯一约束 `UNIQUE(name)` → `UNIQUE(tutor_id, name)`；`tutors` 加 `role` / `nag_webhook_url` / `ics_token`，最早的账号置 `admin`。

> SQLite 细节：加 NOT NULL 列必须"可空加列 → 回填 → 收紧"三步走；`tags` 的旧约束是匿名的，没法按名 drop，用 `batch_alter_table(copy_from=...)` 照目标定义重建。`copy_from` 是"照这份定义重建"，索引和外键没写进定义就会在重建中丢失——第一版正是这么错的，被 autogenerate 漂移检查抓出来。

**`app/scoping.py`**：`scoped()` / `owned()` / `load_student()` / `require_admin()`。`scoped()` 对没有 `tutor_id` 的模型**直接抛错**而非静默返回全表——新加表忘了加 `tutor_id` 会在第一次调用就炸，而不是上线后才发现数据串了。

**改造的 router**：supervisors / trials / schedule_events / group_classes / config(tags) / reports / workflow / students / backup / calendar / nag / notify / checklist。`log_action()` 签名加必填 `tutor` 参数（27 处调用点）。

#### 改造中发现的既有漏洞

1. **`save_student` 更新路径不带 tutor 过滤** —— 用别人的学生 id 发 `PUT /api/students/{id}` 可直接覆写别人的记录。这是 P1 之前就存在的写入级越权。修复后补了一层：id 存在但不属于本租户时回 404（否则会走到"新建"分支撞主键炸成 500）。
2. **`/api/calendar.ics` 全局无鉴权** —— 单份全局内存副本，任何人可匿名拉取全文（含学生姓名和课表）。改为按 tutor 存 + `/api/calendar/{token}.ics`（token 存 `tutors.ics_token`）。旧地址保留但只服务 admin，避免系统所有者手机上的订阅静默失效；待其换用新地址后删除。
3. **`nag` / `notify` 全局扫表** —— `notify.run_digest(db, tutor)` 虽按 tutor 读 webhook 配置，但 `items_on()` 捞的是全库当天安排，B 的机器人会收到 A 的课表。已按 tutor 过滤；去重键加上 `tutor.id`。
4. **`nag` webhook 是全局 env** —— 所有人的催促推进同一个群。改存 `tutors.nag_webhook_url`；env 仅作 admin 的回退（系统所有者原先靠 env 配置且尚无设置页入口，不回退会静默失效），内测导师不会继承。
5. **备份/恢复全局** —— `_build_snapshot` 导全库、`restore` 全局写回，任一内测老师点一次"恢复备份"就覆盖所有人。改为 `BACKUP_DIR/{tutor_id}/{date}/`，list / restore / download 全部限定在自己的租户内。
6. **跨租户外键旁路** —— `students.supervisor_id` 和 `trials.linked_student_id` 写入时不校验归属。把别人的 `supervisor_id` 写进自己的学生，详情页就会渲染出别人的督导档案（含 `notes` 私人评价）。已补校验，不匹配回 422 / 404。
7. **后台任务假定单租户** —— `_notify_loop` 用 `db.query(models.Tutor).first()`；`maybe_create_pending_analysis(db)` 共用一条时间线；`_backup_loop` 备全库。三处均改为遍历 tutor。

#### 越权回归测试 `tests/test_tenant_isolation.py`

不挑端点，**自动枚举**：全部无路径参数的 GET 端点扫一遍，断言 A 的任何 id 都不出现在 B 的响应里；全部以 `student_id` 为唯一路径参数的端点自动参数化，拿 A 的学生 id 去打，断言 403/404。以后新增 `/api/students/{student_id}/xxx` 会自动纳入覆盖，不需要有人记得回来补测试。另有两个"防空转"断言，避免因为端点全部 4xx 而假通过。

覆盖面：列表泄漏扫描 / 按 id 越权读写 / 覆写他人学生 / 跨租户挂接督导 / 备份快照与列表 / 全局配置写入仅 admin / 日历 token 分租户 / `scoped()` 守卫。

**验收结果：** 40 passed。测试在第一次运行时就抓到两处漏改（`routers/notify.py` 旧签名调用、跨租户 PUT 回 500 而非 404）。前端 `typecheck` 和 `build` 通过；`lint` 的 24 个错误在 `origin/main` 上即已存在，与本次改动无关（stash 后重跑数字不变）。

**已知限制：** 日历 ICS 仍是进程内存存储，重启后为空直到前端下次发布——这是改造前就有的行为，本次只做隔离。

### P2 — 角色与管理员后台 ✅ 已实现

**迁移 `0004_tutor_account_management`**：`tutors` 加 `status` / `display_name` / `token_version` / `last_login_at`。（`role` 在 0002 就加了，rounds 的写权限闸门依赖它。）

#### 会话失效是这一阶段的核心

光改库里的密码没用 —— 令牌有效期 7 天，不作废旧令牌，"停用账号"和"重置密码"都只是摆设。做法抄教务系统的 `users.token_version`：

- `auth.token_for(tutor)` 把 `ver` 写进 JWT payload，**所有签发点都走它**（`create_access_token` 不再直接调用）
- `get_current_tutor` 校验三件事：账号存在、`status == active`、`token_version` 与令牌里的 `ver` 一致
- 停用和重置密码都自增 `token_version`

两个测试专门钉住这条：`test_disabling_invalidates_existing_token`、`test_reset_password_invalidates_old_token`。断言里写明了为什么 —— "停用后旧令牌仍然可用 = 等于没停用"。

#### 账号管理 API（`app/routers/admin.py`）

`GET/POST /api/admin/tutors`、`PATCH /api/admin/tutors/{id}`、`POST /api/admin/tutors/{id}/reset-password`，全部 `require_admin`。

**只暴露元数据**：用户名、显示名、角色、状态、创建/最后登录时间、学生数、AI 调用次数。没有任何读取他人业务数据的端点，也没有代登录（ADR 0004 决策 5）。两个测试守着这条：一个断言返回字段集合与白名单**完全相等**（多一个字段就红），一个扫全部路由确认不存在 `impersonate` / `login-as` 之类的端点，防止日后有人顺手加一个。

**没有删除账号。** 停用可逆且足以挡住登录；删账号会把他名下的学生、纪要、知识库变成孤儿数据，那是一次数据销毁，不该藏在管理面的一个按钮后面。

**自锁防护**：admin 不能取消自己的管理员权限、不能停用自己 —— 两者都会把最后一个管理员锁在门外且无恢复入口。

#### 前端

- `authStore` 持有 `role` / `username` / `displayName`。角色缓存在 localStorage **只为首屏不闪**，不是权限依据（每个端点各自 `require_admin`，前端改这个值什么也拿不到）。
- `ProtectedRoute` 挂载时调一次 `/auth/me` 向服务端确认角色，这样管理员权限被撤销后不用等重新登录才生效。
- `/admin` 页面 + 侧栏「账号管理」入口，仅 admin 可见；`AdminOnly` 守卫把非管理员弹回首页。
- **登录失败区分原因**：账号停用（403）和密码错（401）提示不同，否则对方会一直重试密码。
- **轮次控件按角色隐藏**：学生表单里的「Add round」和设置页的整个轮次管理区块对普通导师隐藏，代之以一行说明。整块隐藏而不是禁用 —— 里面每个按钮都会吃 403，留着只会让人困惑。

#### 验收结果

后端 **91 passed**（新增 `test_admin.py` 15 个）。浏览器端到端（真实登录表单，非注入令牌）：

| 步骤 | 结果 |
|---|---|
| admin 登录 → 侧栏出现「账号管理」 | ✅ `/auth/me` 拿到角色 |
| 管理面创建内测账号 | ✅ 列表即时出现，学生数 0 |
| 用该账号真实登录 | ✅ 角色 tutor，侧栏无管理入口 |
| 该账号看到的学生数 | ✅ 0（admin 有 19） |
| 直接敲 `#/admin` | ✅ 弹回首页 |
| 直接调 `/api/admin/tutors` | ✅ 403 |
| 设置页轮次管理 | ✅ 整块隐藏，只剩说明文字 |
| admin 停用该账号 → 对方刷新页面 | ✅ 令牌被清、跳登录页 |
| 停用后再登录 | ✅ 提示「账号已停用，请联系管理员」 |

前端 `typecheck` / `build` 通过；lint 24 个错误与 `origin/main` 基线一致，零新增。

### P3 — 内测运营配套 ✅ 已实现

采用**方案 B**（见 §7 与 `docs/adr/0006-org-shared-ai-credentials.md`）。

#### AI 凭据收到服务端

**迁移 `0005_system_config`**：新表 `system_config`（键值），存 `ai_api_key` / `ai_base_url` / `ai_model`。

- `app/ai_config.py` 统一取用；`public_view()` 只回 `configured` + 末四位遮罩，**明文永不下发**
- `GET/PUT /api/admin/ai-config`（`require_admin`），`GET /api/ai/status`（任何导师，只回 configured + model）
- `/api/ai/*` 与知识库的 AI 端点**忽略请求体里的 apiKey**——接收就等于允许绕过用量统计

#### 真正的工作量在「把直连改成经后端」

审计发现 AI 流量原本走两条路，其中 `claudeService`（单节课报告、进度报告、AI 别名）和 `workflowAnalysisService` 是**浏览器直连 provider** 的。那种调用后端看不见，用量永远数不到，而且每人必须自备 key。两者都改为经 `/api/ai/proxy`。

前端 `AppSettings` 移除 `aiApiKey` / `aiModel` / `aiBaseUrl`；设置页 AI 区块换成 `AiConfigSection`——admin 看到机构编辑器（含 provider 预设、替换/清空 key），普通导师只看到「已由管理员配置，当前模型 x」。

#### 用量统计

每次 provider 调用记一笔 `action_logs`（`action='ai_generate'`, `entity_type='ai_call'`, metadata 带 kind），管理面按人展示。**只观测不限额。**

> 口径有个坑：`students.py` / `reports.py` 在报告落库时也记 `action='ai_generate'`。两者都算，一次生成会被数成两次（实测 178 → 180）。管理面只数 `entity_type='ai_call'`，`test_report_save_does_not_double_count` 钉住这条。

#### 新账号首屏引导

`components/FirstRunGuide.tsx`：零学生时取代原来那行 `No students yet`。两条起步路径（Excel 导入 / 手动新建）+ 一块「关于你的数据」，里面写明**管理员看不到你的学生数据、系统不提供以某人身份登录**——ADR 0004 决策 5 的那条硬约束，内测老师需要看见它。

#### 验收结果

后端 **103 passed**（新增 `test_ai_config.py` 12 个）。浏览器端到端（起了一个本地桩 provider，不联网）：

| 步骤 | 结果 |
|---|---|
| admin 设置页 → AI 区块 | ✅ 显示「尚未配置 Key —— 所有老师的 AI 功能都不可用」 |
| 填入 key + 指向桩服务 | ✅ 状态变「当前 Key ••••KEY7，已生效」，页面无明文 |
| 点「重新生成」出一份单节课报告 | ✅ 桩内容返回；**网络日志里只有 `POST /api/ai/proxy`，浏览器没有任何一条直连 provider 的请求** |
| 用量 | ✅ `action_logs` 新增一条 `ai_call` / kind=proxy |
| 内测账号登录 | ✅ 首屏是引导卡片 + 隐私说明 |
| 内测账号看 AI 设置 | ✅ 只读「已由管理员统一配置，当前模型 stub-model」，无编辑控件、无明文 |
| 未配置时调 AI | ✅ 503，文案指向「联系管理员」 |

前端 `typecheck` / `build` 通过；lint 24 个错误与 `origin/main` 基线一致，零新增。

#### 未做

- **反馈入口**不在系统内做（企微群 / 文档即可）。
- **导师自带 key 覆盖机构 key**：范围外，ADR 0006 记了理由和唯一改动点。
- **配额闸门**：先摸清真实用量再谈。

## 5. 数据模型变更汇总

```
tutors          + role VARCHAR(16) NOT NULL DEFAULT 'tutor'
                + status VARCHAR(16) NOT NULL DEFAULT 'active'
                + display_name VARCHAR(128)
                + token_version INT NOT NULL DEFAULT 1
                + last_login_at DATETIME
                + wecom_webhook_url VARCHAR(512)

supervisors     + tutor_id (FK, NOT NULL, index)
trials          + tutor_id
schedule_events + tutor_id
tags            + tutor_id ；UNIQUE(name) -> UNIQUE(tutor_id, name)
weekly_reports  + tutor_id
manual_logs     + tutor_id
action_logs     + tutor_id
workflow_analyses + tutor_id

rounds          不变（全局，仅 admin 可写）
students 等已有 tutor_id 的表  不变
```

## 6. 风险

| 风险 | 缓解 |
|---|---|
| 漏改某个 router → 数据泄漏 | §4 P1.10 的越权回归测试遍历全部端点 |
| `stamp` 前 schema 有漂移，后续迁移基于错误前提 | P0 步骤 4 强制先比对线上实际 schema 与 `models.py` |
| 生产 SQLite 文件损坏 | 每次 schema 变更前 `download` 一份完整 JSON 快照留底；已有每日自动备份 |
| 半隔离状态下开号 | P1 整块交付，中途不上线 |
| 内测老师不信任数据私密性 | ADR 决策 5 写成硬约束 + 内测须知明示 |
| 存量 `rounds` 里有 Simon 个人自建的轮次 | 迁移前人工过一遍，非机构轮次的删掉 |

## 7. 待拍板

**AI key 怎么供给内测老师？** 现状：apiKey 由前端每次请求携带，存各自浏览器 localStorage。内测老师多半没有 DeepSeek / 通义的 key，而 AI 报告是本系统的核心卖点之一，不给 key 等于内测收不到有效反馈。

- 方案 A：各自申请自己的 key。零改动，但多半没人会去办，反馈质量受损。
- 方案 B：**（倾向）** 后端存一个机构共享 key，admin 在管理面配置，前端不再传 key；靠 `action_logs` 记录每人调用次数，只观测不硬限。改动集中在 `ai.py` 和前端设置页。
- 方案 C：admin 给每人单独下发 key。管理成本高，没必要。

## 8. 教务对接（存档，本期不实施）

`../hr-management` 已有成熟的对外集成范式：`backend/app/api/routes/online_form_integration.py` —— `X-Service-Token` 头鉴权 + `project-changes` 变更序列 feed（`source_version` 单调递增）+ `online_form_sync_acknowledgements` 记录消费位点。

将来打通照抄这套，加一个 `epq-tutor` consumer：

- 教务侧新增 feed，暴露 `ProjectMember`（老师-学生分配，`project_role` ∈ SA/TA/Process）与课程安排。
- 本系统 `students` 加 `external_project_id`（对 `projects.student_code`），定时拉变更，按 `ProjectMember.user_id` 把学生自动落到对应 tutor 名下。
- 先单向（教务 → 本系统），只读镜像字段与本地字段分开存，避免被覆盖。双向写回另行评估。
- 届时 `supervisors` 应收敛为教务 `SAInfo` 的镜像，不再各租户自建（ADR 决策 3）。
