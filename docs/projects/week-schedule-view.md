# 项目任务书：日程周视角（Week Schedule View）

> 面向维护此功能的 AI agent / 开发者。本文档记录设计决策与理由，力求自包含。术语沿用根 `CLAUDE.md`。功能已实现（见 §7），本文既是设计定稿也是存档。

## 1. 目标与背景

单人 EPQ 家教系统（详见根 `CLAUDE.md`）。导师在各个地方（微信、钉钉、企业微信、口头）约的会，都会**手动收敛到本网站**记录——这里是事实上的主时间表。原有甘特图按"天"为格、看不到**具体时间**，且一屏只覆盖一小段，不适合"今天/本周具体几点上什么"。

本功能提供一个**日历周视角**：竖时间轴 × 周一~周日列，把带时间的安排一屏看全，并能一眼分辨哪些课在工作时间内外（用于判断申请居家 / 加班）。

**唯一用户是导师本人。**

## 2. 非目标（明确排除 / 延后）

- **不做外部日历同步的平台专用集成**（企业微信 / 钉钉 OAuth+API）。这两个平台一般不给个人 ICS 订阅 URL，需企业应用+审批+token，是整个功能里最大且卡在平台权限上的一块。**延后**。
- **通用"订阅外部 ICS URL"通道**（粘贴任意 ICS → 后端定时拉 → 只读合并）：认可方向，**延后到手动录入稳定之后**，不承诺微信/钉钉能接。
- **日程事件不进 ICS 导出**（MVP 不做，手机日历暂看不到这些手动事件）。以后再说。
- **不做周期/重复事件**。所有事件当一次性。
- **不做整月视图**。只周视角 + 翻页。

## 3. 核心决策（含理由）

| # | 决策 | 理由 |
|---|---|---|
| D1 | 三类块来源：学生 `session`（SA/TA/理论）+ `trial`（试听）+ **新建轻量 `schedule_events` 表** | session/trial 已带时间；非上课的会（和督导对接、家长沟通等）需要一个不污染课时统计的独立表。曾考虑"都当 session 建"，会污染 SA 课时计算，否决。 |
| D2 | 固定**周一到周日**列 + 左右翻页，默认当周 | 与现有"加班申请"按周一~周日算周（`getWeekRange`）对齐：网格里非工作时间区的会 ≈ 加班申请弹窗里这一周的条目。曾选"滚动 7 天"，但会横跨两个加班周，破坏该对应关系；翻页解决周末看不到下周的缺点。 |
| D3 | 竖时间轴范围**动态**（默认 8:00–21:00，按当周事件早晚自动撑开）| 导师要"很短"的轴又不能裁掉早/晚的会。 |
| D4 | **工作时间高亮**用淡中性灰蓝（非绿）；周一~五 `09:00–12:30` & `13:30–18:00` 两条带，周末不高亮 | 复用加班规则常量语义（`WEEKDAY_OT_WINDOWS`）。导师本想要浅绿，但理论课块本身是绿（`#22c55e`），绿底+绿块会糊；改中性色，绿留给理论课，两套颜色不打架。 |
| D5 | 撞车（同天时间重叠）**并排 split 成子列** | 单人不可能同时上两节课，重叠=手滑重录或会撞课，正是要第一时间抓到的冲突（还影响加班/居家判断）。 |
| D6 | 点击分流：session→复用 `QuickSessionEditPopover`（粘纪要生成报告）；trial→跳 `/trials/:id`；事件→新做的精简 `QuickEventEditPopover` | 导师"上完课方便输入"的诉求只对 session 成立（有报告流程）；后两种低频，不过度投入。 |
| D7 | 点**空白格**→ 半小时吸附、预填日期+时间建**事件**；学生课仍从学生页/甘特建 | 收敛会议是最高频动作，空格秒建最顺手；建课需要学生上下文，原有入口已够。 |
| D8 | 顶部"未定时"窄带兜**历史遗留**无时间块 | 起始时间已全线必填（见 §4），以后不再产生无时间块；老数据点开填时间即掉进轴里，自然清零。 |
| D9 | "日程"作为 Dashboard 视图切换器的**新模式**（排第一），切进去隐藏学生筛选、显示**全部**（忽略 round/tag/角色） | 贴"首页视角"说法，不改路由；日历与学生筛选气质不合，隐藏回避。 |

## 4. 关联的 bug 修复：起始时间必填

设计中发现漏洞：原先 session 可以不填起始时间创建，导致无法在时间轴定位。已全线堵死——**任何 session 无起始时间不能创建/保存**，前端红字报错 + `required`：

- 创建：`AddSessionModal`（概览+甘特共用）、`NewSessionPage`（学生详情页）
- 编辑：`QuickSessionEditPopover`（"仅保存"和"生成报告"两路）、`EditSessionPage`
- 新建 session / 事件**时长默认 60 分钟**；日历渲染时长为 0/空按 60 兜底显示。
- `schedule_events` 后端 CRUD 同样强制时间必填（空则 422）。

## 5. 数据模型（新增表）

### 表 `schedule_events`
每行 = 一个非上课日程事件。参照 `models.py` 现有 `Trial` 风格（扁平、无 tutor_id）。
| 列 | 类型 | 说明 |
|---|---|---|
| `id` | PK String(64) | |
| `title` | String(256) | 事件标题，必填 |
| `date` | String(16) | YYYY-MM-DD |
| `time` | String(8) | HH:MM，**必填**（无起始时间不允许） |
| `duration_minutes` | Integer | 默认 60 |
| `note` | Text | 可选备注 |
| `link` | String(512) | 可选会议链接 |
| `created_at` / `updated_at` | datetime | |

`create_all` 自动建表，无需 ALTER / 手动迁移。schema `ScheduleEventSchema`（驼峰）。

## 6. API

`/api/schedule-events`（`routers/schedule_events.py`，JWT 保护，仿 trials）：
- `GET ""` 列出全部（按 date, time 排序）
- `POST ""` 创建（时间必填，否则 422）
- `PUT "/{id}"` 更新（时间必填）
- `DELETE "/{id}"`

前端经 `dataService.ts`：`listScheduleEvents / createScheduleEvent / updateScheduleEvent / deleteScheduleEvent`。

## 7. 实现清单（已完成）

**后端**：`models.ScheduleEvent`、`schemas.ScheduleEventSchema`、`routers/schedule_events.py`、`main.py` 注册路由。

**前端**：
- `components/views/WeekScheduleView.tsx` — 核心周网格（翻页 / 动态轴 / 工作高亮 / 每分钟刷新红线 / split / 未定时带 / 点空格建事件 / 三类块点击分流）
- `components/QuickEventEditPopover.tsx` — 事件建/编/删弹窗
- `pages/DashboardPage.tsx` — 视图切换器加"日程"、schedule 模式隐藏筛选、渲染全部学生
- `lib/dataService.ts` + `types/index.ts` — CRUD + `ScheduleEvent` 类型
- bug 修复见 §4（4 个 session 入口）

**配色**：SA `#FA8072` / TA `#3b82f6` / 理论 `#22c55e` / 中方SA `#9575CD`（与甘特一致）；试听 `#f59e0b` 琥珀；事件 `#64748b` 石板灰；工作时间底 `rgba(100,116,139,0.09)`。

## 8. 状态

- 已实现并本地 `tsc -b` 通过、新文件 lint 清、后端模块导入 + 路由注册通过。
- **待办：`python deploy.py` 上线 + 线上强刷验证**（切"日程"实测：建事件、点课改时间/生成报告、翻页、撞车 split、工作时间高亮、红线）。
- 延后项见 §2（通用 ICS 订阅通道 / 事件进 ICS / 微信钉钉同步）。
