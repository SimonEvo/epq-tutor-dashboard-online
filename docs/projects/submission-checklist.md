# 项目任务书：提交前检查清单 + 提交截止时间 + 结项

> 面向维护此功能的 AI agent / 开发者。记录设计决策与理由，力求自包含。术语沿用根 `CONTEXT.md`（新增词条：Submission Checklist / Tii Check / Submission Deadline / 结项）。架构决策见 `docs/adr/0003-submission-checklist-and-deadline-model.md`。
> **本任务书是改动一。设置页重构是改动二，见 `docs/projects/settings-page-restructure.md`，分两次上线。**

## 1. 目标与背景

学期末，导师需要逐个学生核对一组"交付动作"：表格是否都过了一遍、Tii 的 AI 率与相似度报告是否备齐、答辩录屏是否转写整理、该生额外要交的材料是否齐。这些都不是 EPQ 规范里的学生产出，而是导师自己的运营流程。

需求是在一届学生**已经临近提交**时才发现的——这本身是设计输入：模板必须能后补，且后补的项要立刻覆盖在读学生。

同时暴露出 ddl 不是一届一个日期：每届有两个固定 ddl（都是周五 17:00，相隔一周），学生按是否申请延期落在其中一档，此外还能个案改动，且任何改动都要跟运营组确认。

**唯一用户是导师本人。**

## 2. 非目标（明确排除）

- **不做时间触发**。不在 ddl 前 N 天自动激活/弹提醒。视图由导师主动打开。
- **ddl 不画进甘特图**。甘特一格一天，小时精度看不出来；重要全局日期导师手动维护在甘特编辑器里。
- **结项不参与任何计算**。不改 SA 课时、周报、月会 AI。
- **不做清单项分组**。不到 10 项。
- **不复用 EPQ Milestone 承载清单**。见 ADR 0003。
- **不新建表**。全部走 JSON 列 + 既有表加列。

## 3. 核心决策（含理由）

| # | 决策 | 理由 |
|---|---|---|
| D1 | 清单独立于 EPQ Milestone | 主体不同（导师动作 vs 学生产出）、状态不同（二态 vs 四态）、寿命不同（提交前 vs 全程）、来源不同（自定义 vs 规范固定）。混用会污染 milestone 进度条。 |
| D2 | 模板是**活定义**，学生只存打钩状态 | 需求是"边用边补"，补的项必须立刻覆盖在读学生。快照方案会按届分叉出多份近似模板。 |
| D2b | 删模板项 = **归档**（`archived: true`），设置页可显式恢复；恢复带回原 id，打钩跟着回来；另有「永久删除」才真清学生的钩 | 「保留孤儿打钩数据」只有在重新加回的项 id 恰好一致时才救得了你，防误删变成碰运气。改成看得见的按钮。 |
| D3 | ddl = 两档 tier + 可空覆盖 | "延期仅限一次"由 enum 结构保证，不需校验逻辑；同时保留个案改动能力。纯布尔表达不了个案，纯日期字段要 30 次重复输入。 |
| D4 | 运营确认是**标记不是闸门**，且每次改动重置为 false | 现实中 ddl 先变、运营后回复；闸门会逼数据说谎。留旧钩比没钩更糟。 |
| D5 | 「表格检查完成」只做**一个**格子 | milestone 已逐张跟踪表 1/2/4/5/6/7/11，那是"学生填没填"；这个是"老师过没过"，两件事，但不该拆成 7 个格子重复维护。 |
| D6 | 「表13证据」= 两条**不可删的固定项**（论文/报告、PPT的PDF）+ 自由添加的其余项 | 前两条每个学生都要交，做成模板列又只属于表13这一组；固定项由服务端在读和写两条路径上补齐，老学生零迁移、删不掉。其余材料每人不同，成不了列，留一个自由桶（不是两个，否则每次犹豫往哪放）。 |
| D7 | Tii 检测存**记录列表**而非计数器，数字可空 | 有用的信号是趋势（35%→11%），计数器答不了；次数 = 列表长度。第 3 次起标红警示但**不阻断**，现实可能被迫检第 4 次。 |
| D8 | 结项是手动时间戳，仅影响呈现 | 清单全打钩 ≠ 学生真提交了。时间戳自带"何时确认"，布尔要补字段。一旦参与计算，以后每个统计都要回答"结项的算不算"。 |
| D9 | 打钩走**窄端点**，不走全量 `PUT /api/students/{id}` | 现有保存是全量替换关联表；30 行表格点几十次钩，每次全量写又慢又易冲掉并发编辑。 |
| D10 | D 视图数据挂 `StudentSummary`，不新开列表端点 | 新增字段每人约 200 字节，Dashboard 已加载 summary，复用即可。 |
| D11 | 延期到下学期 = 改 `submissionRound` | 该生本来就不本届提交。不加"延到下届"字段。导师仍继续带课，所以他应出现在下届视图里。 |

## 4. 数据模型

```python
# tutors
submission_checklist_template = Column(JSON)   # [{id, label, order, archived}]

# rounds
deadline_normal   = Column(String(20))   # "2026-08-14T17:00"，可空
deadline_extended = Column(String(20))   # "2026-08-21T17:00"，可空

# students
submission_checklist      = Column(JSON)      # {"ticked": {itemId: "2026-08-29T10:00"}, "customItems": [{id,label,done,doneAt,fixed}]}  # customItems = 表13证据
tii_checks                = Column(JSON)      # [{date, aiPercent|null, similarityPercent|null, note}]
deadline_tier             = Column(String(16), default="normal")   # normal | extended
deadline_override         = Column(String(20), nullable=True)
deadline_change_confirmed = Column(Boolean, default=False)
wrapped_up_at             = Column(DateTime, nullable=True)
defense_confirmed         = Column(Boolean, default=False)   # 最终答辩时间已跟学生确认
```

答辩时间本身**不新存**：取该生 `isFinalDefense` 的 session 日期 + 起始时间（多条取最晚），显示成「08.05 周三 14:30」。只有「确认」这个动作是新状态。

全部走 `create_all` + ALTER 自动迁移，不手工建表（沿用知识库那次的做法）。

**派生逻辑：**

```
有效 ddl      = deadlineOverride ?? round[deadlineTier]        // 都为空 → 待定
需要运营确认   = (deadlineTier === 'extended') || (deadlineOverride != null)
未确认警示     = 需要运营确认 && !deadlineChangeConfirmed
Tii 超限       = tiiChecks.length >= 3
```

**种子模板**（首次读取模板为空时写入）：

```json
[{"id":"forms_checked","label":"表格检查完成","order":0},
 {"id":"tii_report","label":"论文检测报告","order":1},
 {"id":"defense_recording","label":"答辩录屏+转录","order":2}]
```

表13证据不进模板：两条固定项写死在 `app/submission.py` 的 `T13_FIXED`（`t13_paper` / `t13_ppt`），其余走学生自己的 `customItems`。

## 5. API

```
GET    /api/checklist-template                  读模板（空则返回种子并落库）
PUT    /api/checklist-template                  存模板 [{id,label,order,archived}]
DELETE /api/checklist-template/{itemId}         永久删除（连带清各学生该项 ticked）

PATCH  /api/students/{id}/checklist             {itemId, checked} | {customItems:[...]}
PATCH  /api/students/{id}/deadline              {tier?, override?, confirmed?}
PATCH  /api/students/{id}/wrap-up               {wrappedUp: bool}
PATCH  /api/students/{id}/tii-checks            {tiiChecks: [...]}
PATCH  /api/students/{id}/defense-confirmed     {confirmed: bool}

PUT    /api/rounds/{name}/deadlines             {normal, extended}
```

- `PATCH /deadline`：**任何**对 `tier` / `override` 的改动，服务端强制把 `deadline_change_confirmed` 置 false；只传 `confirmed` 时不重置。
- 改 `submissionRound` 时（走既有学生保存路径）清空 `deadline_tier`→normal / `deadline_override`→null / `deadline_change_confirmed`→false。前端换届前弹确认（会丢数据，不静默）。
- `StudentSummarySchema` 新增：`submissionChecklist`、`tiiChecks`、`effectiveDeadline`、`deadlineTier`、`deadlineNeedsConfirm`、`wrappedUpAt`、`defenseConfirmed`。

## 6. 前端

### 6.1 「提交」视图（Dashboard 第 7 个视图）

`ViewMode` 加 `'submission'`，`VIEW_BUTTONS` 加 `{ mode: 'submission', label: '提交' }`。

```
26春 ▾                                        [7 人 · 2 已结项]

学生          ddl               答辩确认            表格检查完成 论文检测报告 答辩录屏+转录 表13证据  Tii         结项
张三          08.14 周五 17:00  ☑ 08.05 周三 14:30  ✓            ✓            ·             ·        2/3 AI 11%  [结项]
脑机接口      还剩 3天2h
李四 ⚠        08.21 周五 17:00  ☐ 未确认答辩时间     ✓            ·            ·             1/3 ✎    0/3         [结项]
碳中和政策    延期·运营未确认
王五          待定 ⚠            ☐ 未确认答辩时间     ·            ·            ·             ·        1/3         [结项]
──────────────────────────────────────────────
已结项 (2) ▸
```

- 列 = 答辩确认列 + 当前模板项（活定义，模板改了列跟着变）+ 额外项计数列 + Tii 列 + 结项列
- 学生列显示姓名 + 一句话选题（`overview`），与甘特图一致
- 列宽固定、表头与行共用常量；整表横向滚动，不靠 `ml-auto` 撑
- **排序**：有效 ddl 升序 → 同 ddl 按姓名 → ddl 待定排最后 → 结项沉底折叠。
  **刻意不按完成进度排**：打一个钩行就跳一次，正在操作的那行会跑掉
- 点格子直接切换打钩（乐观更新 + 失败回滚），不进详情页
- `⚠` = 运营未确认；Tii ≥3 次标红
- 表13证据列点开**快速编辑弹窗**（加 / 打钩 / 删）；固定两项显示「固定」二字代替删除按钮
- Tii 列点开**下拉面板**：列出全部记录 + 底部一行直接添加；`fixed` 定位，不被表格滚动区裁掉
- 结项学生不再显示倒计时/逾期，改显示「已结项」
- 顶部提示条：本届 ddl 未设置时显示「26春 尚未设置提交截止时间，去设置 →」

### 6.2 学生详情页「提交」卡片

批量扫描在 D 视图，**逐个操作在详情页**：

- 模板项打钩（同一份数据）
- 表13证据增删改（固定两项不给删除按钮）
- ddl 区：当前有效 ddl + 「延期一周」开关（切 tier，可撤销）+ 手动覆盖时间选择器 + 「运营组已确认」勾选框（改动后自动变回未勾）
- Tii 检测记录：加一条 `{日期, AI率, 相似度, 备注}`，AI 率/相似度**允许留空**；≥3 条标红
- 「结项」按钮：未打钩项 > 0 时弹「还有 N 项未完成，确认结项？」，**不拦**；已结项显示「取消结项」

### 6.3 甘特图折叠

`GanttView` 把 `wrappedUpAt != null` 的学生抽出，底部渲染一行「已结项 (n) ▸」可展开分组。**收起不是隐藏**——否则找不到人取消结项。

## 7. 验收

- [ ] 设置页改模板加一项 → 所有学生 D 视图立刻多一个未打钩列
- [ ] 模板删一项 → 列消失，进「已删除的项」折叠区；点恢复 → 列回来且原打钩状态还在
- [ ] 在折叠区点「永久删除」→ 学生身上的该项打钩数据被真正清除
- [ ] 切「延期一周」→ 有效 ddl 变成 `deadline_extended`，运营确认自动回未勾；撤销后回 normal
- [ ] 手动覆盖 ddl → 运营确认回未勾；勾上后 `⚠` 消失
- [ ] 改 `submissionRound` → 弹确认 → tier/override/confirmed 全清
- [ ] 目标 round 未设 ddl → 显示「待定」并排最后，顶部提示条出现
- [ ] Tii 记录填 3 条 → 标红；AI 率留空可保存
- [ ] 结项 → 甘特图折叠进「已结项」分组，D 视图沉底；SA 课时/周报数字不变
- [ ] D 视图点钩不触发全量学生保存（Network 面板确认只发 PATCH）
- [ ] `python deploy.py` 上线 + 强刷验证
