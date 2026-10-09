# ADR 0007: Resit 建模为「新一次提交」，而不是延期的变体

**Status:** Accepted
**Date:** 2026-10-09

## Context

系统里已有两种「提交轮次 ≠ 报名轮次」的情况（ADR 0005）：一年期（报名轮 +1）和延期（直接改 `submissionRound`，同时清空 ddl 档位 / override / 运营确认）。

Resit 是第三种，而且性质不同：学生**已经交过一次**。第一次提交留下的 Tii 记录、检查清单、结项、里程碑、SA 用量都是真实发生过的，延期那种「改轮次 + 清空」会把它们抹掉、且之后看不出发生过什么。

业务口径（2026-10-09 与 Simon 确认）：
- 第一次的数据存档，resit 轮次从头来（Tii 次数重新计、清单全部未勾）
- SA 课时**分开计数**：resit 有自己的额度和已用
- 学生在**两个轮次都显示**
- 里程碑**全部重置**为未开始
- 不记成绩

## Decision

**1. 快照存在 `students.previous_attempts`（JSON 列表），不新建 attempts 表。**
被快照的字段（ddl 三件套、checklist、tii、结项、答辩确认、里程碑、SA 额度/已用）原本就散落在 `students` 上，且一半已经是 JSON 列。把它们全部迁到一张 `submission_attempts` 表要改动提交视图、窄端点、甘特图、冲刺视图的每一处读取，换来的只是「理论上更规范」。快照是只读的，JSON 足够。用列表而非单个对象，第二次 resit 不用改结构。

当前是第几次提交（`currentAttempt`）**不存**，由列表长度推出 —— 少一个会跟列表对不上的字段。

**2. `sessions.attempt` 标明每节课属于第几次提交。**
SA 额度按 attempt 过滤，而不是按「resit 开始日期之后」过滤：补录旧课、改课日期都不会让课在两次提交之间漂移。服务端收到不带 attempt 的课一律归到当前这一次 —— 五个建课入口一个都不用改。

**3. `sa_hours_used` 改由服务端在保存时重算，不再信任前端传值。**
前端各个建课入口原先都是「数全部 SA 课」写回去，resit 之后会把第一次的课算进来。与其改齐每一处，不如收口到服务端。（前端调用点也已改成按当前 attempt 计数，两边口径一致。）

**4. `previous_attempts` 只由 `/resit` 端点写，`save_student` 不碰。**
全量替换式的保存不能成为把快照冲掉的通道。

**5. 可撤销。** `DELETE /resit` 恢复快照，resit 期间排的课并回上一次提交；resit 期间新记的 Tii / 清单 / 里程碑丢弃（界面确认框写明）。

**6. 先在 main 上线，迁移走 main 的裸 ALTER。**
多租户 / Alembic 那批改动（`feat/alembic-baseline`）还没合入，resit 不等它。main 上在 `main.py` 的 ALTER 列表里加两列；alembic 分支的 `0006_resit` 写成幂等（列已存在就跳过），合入后对已上线 resit 的生产库是 no-op。alembic 版实现保存在 `wip/resit-on-alembic`，合并时当冲突解决的参考。

## Alternatives Considered

**按延期处理 + 手动备注** — 零开发。否决：第一次的数据会被清空，SA 也没法分开算，正是需求要解决的问题。

**新建 `submission_attempts` 表，把提交相关字段整体搬过去** — 结构最干净，每次提交平等。否决：见决策 1，改动面覆盖几乎全部提交相关代码，而现在只有一名学生大概率 resit。真到 resit 成为常态、需要跨 attempt 统计时再迁不迟 —— 快照 JSON 的字段名就是将来的列名。

**按日期切分 SA 课（resit 开始之后的课算新额度）** — 不用给 sessions 加列。否决：见决策 2。

## Consequences

- 学生在原轮次的提交视图 / 甘特图里归入「已结项」组，显示「已提交 · Resit 至 X」；课时统计选原轮次时只数第一次的课、不显示剩余（额度已是新课时包）。月会页面只按当前轮次取人。
- 原轮次被归档不影响 resit 学生（列表接口按当前 `submission_round` 过滤归档）。
- 已知缺口：归档管理里的学生名单和 JSON 导出（`routers/config.py`）按 `submission_round` 查，不含「在该轮已交、已转 resit」的学生。未归档轮次的名单（前端）已包含。
- 备份导出 / 恢复带上了 `attempt` 和 `previousAttempts`。
