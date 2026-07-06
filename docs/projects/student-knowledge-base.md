# 项目任务书：学生知识库（Student Knowledge Base）

> **面向实现该功能的 AI agent / 开发者。** 本文档力求自包含：只读本文 + 文中点名的现有文件即可实现，无需本项目对话上下文。术语定义见仓库根 `CONTEXT.md` 的 **Student Knowledge Base / Knowledge Entry** 段。架构决策理由见 `docs/adr/0002-student-knowledge-base-architecture.md`。

## 1. 目标与背景

单人 EPQ 家教系统（详见根 `CLAUDE.md`）。导师目前的真实工作流：把某个学生的背景资料手动复制粘贴进网页版 AI 聊天，用来规划下一步辅导。三个痛点（按导师排序）：

- **(a) 每次都要重新拼装上下文** —— 最痛。
- **(b) 上一次聊出来的判断，新开对话就丢了**。
- **(c) 学生信息散落在系统 / 微信 / 导师脑子里，凑不齐**。

本功能把这套流程搬进系统：每个学生一个**私有、随时间累积**的知识库，导师可随时对着它和 AI 多轮对话，规划辅导。

**唯一用户是导师本人。** 绝不面向学生 / 家长，绝不导出。

## 2. 非目标（明确排除 / 延后）

- **不做全局 / 跨学生助手**（"这周谁最该盯"）。每次对话锁定**单个学生**。全局助手是明确延后的二期，不在本任务范围。
- **不长期保存聊天线程**。对话是临时的，导师觉得乱了自己清空。只有"活总结"和"原料条目"持久化。
- **不迁移** 现有 `privateNotes` 字段数据。它基本弃用，其内容只是作为上下文来源被读入（见 §6）。

## 3. 架构：三层

一次对话喂给 AI 的完整上下文 = 下面三层拼接：

### 层1 · 自动拼装的结构化上下文（解 a）
每次开聊时从数据库**现拉、绝不缓存陈旧数据**。全量塞（用 1M 上下文的模型，空间足）。内容来源见 §5 的可配置清单。

### 层2 · 活总结 Living Summary（解 b + 压缩）
每个学生**一份**、不断进化的长文本，代表"当前对该学生的理解"。是每次对话的**主力地基**。由 AI 维护、导师可手动编辑。导师很少手改，主要靠"消化"动作更新（§7）。这一层对应导师现在手动做的"让 AI 生成总结 → 开新窗口"。

### 层3 · 原料层 Raw Layer（解 c + 低门槛捕获）
每个学生一个**追加式收件箱**，装**未消化的碎片**（导师随手记的观察、微信摘录、AI 每次聊完提议的新事实）。写入时**不触发任何 AI**、单向、门槛极低。在对话里充当"最新补丁"。每条 = 一个 **Knowledge Entry**（§4 表结构）。

### 层间流转：消化 Digest（层3 → 层2）
见 §7。

## 4. 数据模型（新增表）

参照 `epq-tutor-backend/app/models.py` 现有风格新增。字段名给的是意图，最终以现有命名习惯为准（snake_case 列、驼峰 schema）。

### 表 `student_living_summaries`
每个学生 0..1 行。
| 列 | 类型 | 说明 |
|---|---|---|
| `id` | PK | |
| `student_id` | FK → students | 唯一（一人一份） |
| `content` | TEXT | 活总结正文（Markdown） |
| `updated_at` | datetime | 每次消化 / 手改时刷新 |

### 表 `student_knowledge_entries`（原料层）
每个学生 0..N 行，追加式。
| 列 | 类型 | 说明 |
|---|---|---|
| `id` | PK | |
| `student_id` | FK → students | |
| `content` | TEXT | 碎片正文 |
| `source` | str | 枚举：`manual` / `wechat` / `ai`（AI 提议入库的洞见）。用于 UI 标注来源 |
| `created_at` | datetime | 时间戳，列表按此倒序 |
| `digested_at` | datetime nullable | 非空 = 已被消化。消化后**归档而非删除**（保留可追溯），列表默认只显示未消化的 |

> 建表后需在 `schemas.py` 加对应 Pydantic schema，并按现有模式在 `main.py` 注册路由 / 建表逻辑。SQLite，路径见 `CLAUDE.md`。

## 5. 层1 内容来源清单 + 全局开关

层1 拼装时，按**导师级全局开关**决定拉哪些源（不是每学生一套 —— 单人系统，习惯跨学生一致）。开关存 `tutors` 表（跟现有 `tutors.default_round` 同处，见 `epq-tutor-backend/app/routers/config.py`），例如一个 JSON 列 `kb_context_sources` 或若干布尔列。**默认全开**。设置页（前端 Settings）加一组勾选框控制。

候选来源（全部默认开）：

- Session 历史 + 每节 `summary`
- SA 课次：已用 / 总额（`saHoursTotal`）/ 剩余 + 累计时长（由 session 现算，勿缓存）
- **上次 SA / 下次 SA / 上次 TA / 下次 TA 日期**
- EPQ 里程碑状态（每步 `not_started/in_progress/completed/na`）
- Schedule Entry（考试 / 可用时间窗，取最新）
- 提交学期 `submissionRound`
- Overview / Topic / Brief Note
- `privateNotes` 内容（**允许**，见 §6 隐私）
- Homework 清单 + 完成状态（导师常不维护此项，是全局开关的典型关闭候选）
- Gantt Events（考试 / 假期 / 截止；见 gantt 相关表）

**构建期需核对：** deepseek-v4 的真实上下文窗口。若非 ~1M，给层1 加退路（老 session 截断或先摘要）。单学生数据量小，风险低；1M 假设主要为延后的全局助手服务。

## 6. 隐私（两条都是硬性、强制）

系统既有两条铁律（见根 `CLAUDE.md` / `CONTEXT.md`）：真名做 AI 匿名编码；`privateNotes` 绝不外发。知识库是全系统最大的"数据→AI"出口，两条都必须遵守：

### 6.1 真名匿名编码（复用 + 移植到服务端）
所有学生真名在发给 AI 前替换成固定别名（`students.ai_alias` / schema `aiAlias`），AI 回来的文本显示前解码回真名。

- 现有实现是**前端** TypeScript：`tutoring-system/src/lib/claudeService.ts` 里的 `generateAiAlias` / `buildNameMappings` / `encodeNames` / `decodeNames`（月会用法见该文件 ~460-496 行，可作参照）。编码规则：先全名替换，再"名"（`realName.slice(1)` → `alias.slice(1)`，仅当长度≥2），单字姓不编码防误伤；解码反向、长别名优先。
- **本功能决定把编码/解码移到服务端**（集中管理，编码 + privateNotes 处理只在一处）。需将上述逻辑**移植为 Python**，放在层1 拼装端点里：出站编码、入站（AI 回复）解码，前端只见真名。
- 规则必须与前端一致，避免月会 / 知识库两套行为漂移。理想情况前端那份长远也收敛到服务端，但不在本任务强制范围。

### 6.2 privateNotes —— 第二例外
`privateNotes` **允许**进入层1 上下文，因为知识库输出**纯导师私用、绝不到达家长**。这是"privateNotes 绝不导出"规则的**第二个明确例外**（第一个是月会 AI 草稿）。判定准则：**输出会不会到家长/学生手里？**
- 会（Session Report / Progress Report）→ 继续过滤 privateNotes，本功能**不改动**它们。
- 不会（月会草稿、本知识库对话）→ 允许。

> 在 §7 消化产生的活总结里同样可能含 privateNotes 派生内容 —— 活总结也是纯导师私用，同准则允许。**但活总结/知识库的任何内容都绝不可流入对外报告端点。**

## 7. AI 链路 + 消化流程

### 7.1 模型与多轮
- **模型：`deepseek-v4`**。现有代理 `epq-tutor-backend/app/routers/ai.py` 的 `POST /api/ai/proxy` 默认 `qwen-plus`；`baseUrl` 已是请求参数，指向 DeepSeek 属配置。apiKey 目前由前端传入请求体（沿用）。
- 现有代理是**单轮**（`messages:[{role:user,content:prompt}]`）。知识库对话需**多轮**：新增端点或扩展代理，接收 `messages` 数组。**对话不服务端持久化**，前端握住本轮完整 `messages`，每轮整包发。
- 前端参照 `claudeService.ts` 的 `callAI`（读 `aiModel`）接入。

### 7.2 一次对话的组装
开聊时：
1. 前端调层1 端点（如 `GET /api/students/{id}/kb-context`）→ 服务端拉数据、按全局开关筛、**做匿名编码**、拼出结构化块（已是别名）。
2. 前端把 `结构化块 + 活总结 + 未消化原料条目` 组成首条 system/context 消息，追加导师提问，调多轮代理。
3. AI 回复经服务端**解码**后显示（见 6.1）。

### 7.3 消化 Digest（层3 → 层2）
触发：导师在对话结束后或随时点「消化 / 更新活总结」按钮。

流程：
1. AI 读「本次对话 + 未消化原料」→ 提议一组**新增耐久事实**（几条）。
2. 导师看到提议，**逐条勾选 / 编辑 / 删除**（"经我允许再入库"）。
3. 批准内容由 AI **合并进活总结**（生成新版；应让导师看到改动再落地）。
4. 被纳入的原料条目标记 `digested_at`（归档，不删）。
5. 活总结 `updated_at` 刷新。

> 消化是导师"生成总结 → 开新窗口"的自动化版本，也复用系统既有的"AI 提议 → 导师批准 → 再写入"模式。

## 8. 前端 UI

### 8.1 学生详情页新增「知识库」Tab
挂在 `tutoring-system/src/pages/StudentDetailPage.tsx`（现有 Tab 结构旁）。含：
- **对话面板**（主区）：多轮聊天。
- **活总结**：可看可编辑（折叠区 / 侧栏）。
- **原料收件箱**：条目列表（按 `created_at` 倒序，默认只显未消化），带「+」快速加，条目显示 `source` 标注。
- **「消化 / 更新活总结」按钮**。

### 8.2 全局速记入口（低门槛捕获，解 c 的关键）
原料常在**课中 / 刚下课 / 刷微信**时产生，那时导师未必在该学生详情页。加一个**全局速记**入口（侧边栏或 Dashboard 一个按钮）：弹窗**选学生 + 打一句话**即存为 `manual` 原料。两步、随处可用。别只在详情页加，否则捕获门槛过高、c 没根治。

### 8.3 数据接入
前端所有 API 走 `tutoring-system/src/lib/dataService.ts`；JWT 由 `githubClient.ts` 的 `apiFetch` 自动附带（见 `CLAUDE.md` 架构要点）。新端点按此接。

## 9. 建议后端端点（示意，命名从现有习惯）
- `GET /api/students/{id}/kb-context` —— 层1：拉 + 编码 + 拼装结构化块。
- `GET/PUT /api/students/{id}/living-summary` —— 读 / 写活总结。
- `GET/POST/DELETE /api/students/{id}/knowledge-entries` —— 原料增删查（含全局速记的 POST）。
- `POST /api/students/{id}/kb-digest` —— 消化：出 AI 提议（不直接落地，返回给前端待批）。
- `POST /api/students/{id}/living-summary/merge` —— 批准后合并进活总结。
- 多轮对话：扩展 `POST /api/ai/proxy` 收 `messages`，或新增 `POST /api/ai/chat`。出站编码 / 入站解码在此处理。

## 10. 构建期待定项（本文档有意留空，实现时定）
- deepseek-v4 上下文窗口实测 + 超限退路（§5 末）。
- 全局开关的存储形态（JSON 列 vs 多布尔列）。
- 活总结编辑 UI 的具体形态；消化提议的展示交互。
- 是否需要"重新生成活总结"（全量重建）而非增量合并。

## 11. 现有代码指针速查
| 用途 | 位置 |
|---|---|
| AI 代理（单轮，待扩多轮 + 换模型） | `epq-tutor-backend/app/routers/ai.py` |
| 匿名编码逻辑（前端，待移植 Python） | `tutoring-system/src/lib/claudeService.ts`（encodeNames/decodeNames/generateAiAlias/buildNameMappings） |
| 匿名编码 + privateNotes 用法参照 | `MonthlyMeetingPage.tsx` / `claudeService.ts` ~460-496 |
| 前端 AI 调用封装 | `claudeService.ts` `callAI` |
| 学生详情页（挂 Tab） | `tutoring-system/src/pages/StudentDetailPage.tsx` |
| 数据服务层 / JWT | `tutoring-system/src/lib/dataService.ts` / `githubClient.ts` |
| tutor 配置（放全局开关，参照 default_round） | `epq-tutor-backend/app/routers/config.py` |
| 模型 / schema | `epq-tutor-backend/app/models.py` / `schemas.py` |
| privateNotes 字段 | `models.py` / `schemas.py`（`private_notes` / `privateNotes`） |
