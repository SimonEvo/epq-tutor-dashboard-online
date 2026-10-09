# ADR 0006: 机构共享的 AI 凭据，全部 AI 流量经服务端

**Status:** Accepted
**Date:** 2026-09-22

## Context

AI 报告是本系统的核心卖点之一。原先凭据（key / model / baseUrl）是**每个导师自己的前端设置**，存 localStorage。单人自用时这没问题。

开放内测后就不成立了：内测老师多半没有 DeepSeek / 通义的 key，也不会为了试用一个内部工具去申请一个。不给 key，AI 报告和知识库对话直接不可用，等于**收不到关于核心功能的反馈**——那内测就白做了。

审计时还发现 AI 流量实际走**两条路**：

- `weeklyReportService`、知识库 → 经后端 `/api/ai/proxy`（后端要在这里做姓名匿名化）
- `claudeService`（单节课报告、进度报告、AI 别名）、`workflowAnalysisService` → **浏览器直连 provider**

后一条意味着：用量永远数不到（后端看不见那些请求），且每个导师必须自备 key。

## Decision

**1. 凭据是机构级的一份，存服务端 `system_config` 表，admin 在设置页维护。**
不用环境变量：admin 要能改完即生效，不必登服务器也不必重启。不挂在 `tutors` 上：它不属于任何一个导师。

**2. key 的明文永不下发给任何客户端。**
读接口只回 `configured` 布尔值和末四位遮罩（`••••KEY7`）——足够确认"换对了没"，又不泄漏。回显明文就等于把 key 重新散回浏览器，那正是本决策要消除的状态。

**3. `/api/ai/*` 忽略请求体里的 apiKey / model / baseUrl。**
接收就等于允许绕过用量统计。老客户端传了也不认（pydantic 默认忽略多余字段）。

**4. 全部 AI 流量改经后端。**
`claudeService` 和 `workflowAnalysisService` 不再直连 provider。这不只是"把 key 搬走"的副作用——它是用量统计成立的前提，也让姓名匿名化有机会覆盖更多路径。

**5. model 和 baseUrl 也收到机构级，导师不可选。**
额外好处：避免某个导师选了推理模型（`deepseek-reasoner` 那类）把 `max_tokens` 全烧在思维链上。那个坑 `ai.py:_extract_content` 已经踩过并写了专门的报错。

**6. 只观测，不限额。**
每次 provider 调用按人记一笔 `action_logs`，在管理面按人展示次数。不做配额闸门——内测阶段先摸清真实用量，再谈要不要拦。

## Alternatives Considered

**方案 A：各自申请自己的 key** — 零改动，用量天然隔离。否决：见 Context，多半没人会去办，等于放弃对核心功能的反馈。

**方案 C：admin 给每人单独下发一个 key** — 用量和成本天然按人隔离，不需要记账逻辑。否决：管理成本按人数线性增长，而供应商侧本来就能看到聚合用量；为一个内测规模（≤30 人）的场景引入一套密钥分发流程不值。

**保留「导师可自带 key 覆盖机构 key」** — 有自己 key 的人不占共享额度。否决为**范围外**：多一条凭据解析分支、一处设置界面，而内测阶段没人有这个需求。将来真需要时再加，解析函数 `ai_config.resolved()` 是唯一改动点。

**在服务端加密存储 key** — 库文件泄漏时多一层保护。否决：解密密钥必须和应用放在一起，在单机部署下提供的是心理安慰而非实际防护。真正的边界是 SQLite 文件的系统权限。

## Consequences

- **所有导师共用一份额度**，一个人跑批量报告会影响其他人的速率限制。这是接受的代价；用量统计正是为了在它发生时能看见。
- 前端 `AppSettings` 移除 `aiApiKey` / `aiModel` / `aiBaseUrl`。localStorage 里的旧值被忽略，不做迁移——凭据本来就该重新配一次。
- 设置页原先"攒着一起保存"的表单没有字段了，Save 按钮随之移除；其余分区都是即时保存。
- **用量计数的口径要小心**：`ai.py` 在每次调 provider 时记 `entity_type='ai_call'`，而 `students.py` / `reports.py` 在报告落库时另记一笔 `action='ai_generate'`。管理面只数前者，否则一次生成会数成两次（`test_report_save_does_not_double_count` 钉住这条）。
- 首次上线后 admin 必须去设置页填一次 key，否则所有人的 AI 功能报 503（报错文案直接指向"联系管理员"）。
