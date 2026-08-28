# Domain Context

EPQ tutoring progress management system. Single tutor, up to 30 students. Tracks sessions, SA hours, EPQ milestones, and generates AI reports.

## Glossary

### Session
A one-on-one meeting between the tutor and a student. All sessions in this system are one-on-one. Three types:

- **SA_MEETING** — meeting where the tutor acts as Subject Advisor (SA). Counts toward the student's SA hour quota.
- **TA_MEETING** — meeting where the tutor acts as Teaching Assistant. Does not count toward SA hours.
- **THEORY** — EPQ-related theory teaching session. Not general subject tutoring.

### Teaching Assistant (TA)
The tutor — the sole user of this system. Always the TA. May also serve as Subject Advisor (SA) for some students.

### Subject Advisor (SA)
An EPQ Supervisor/Assessor: a specialist experienced in secondary education who supervises a student's EPQ project. In code: `Supervisor` entity.

Two kinds:
- **英方SA (British-side SA)** — an external person (not the tutor). SA meeting hours are tracked and billed separately.
- **中方SA (Chinese-side SA)** — the tutor themselves acting as SA. No separate billing; SA hour tracking excluded.

### SA Hours
Two independent SA signals per student:

1. **SA 课次** — session count. `saHoursTotal` is the contracted SA session quota (typical values: 9, 12, 15; default 12). `saHoursUsed` stores the count of past SA_MEETING sessions. Remaining = `saHoursTotal - count`. Used to track how many SA meetings are left in the contract.

2. **SA 时长** — cumulative time. Sum of `durationMinutes` across all past SA_MEETING sessions. Shown as h/min (e.g. "11h20min"). Used for billing reference and EPQ compliance (minimum hours).

Both signals are displayed independently wherever SA info appears. `saHoursUsed` stores the session count (integer); time is always re-derived from session records, never cached.

### Submission Round（学期）
The teaching cohort a student belongs to. Occurs twice a year. Named by **teaching start time** (not submission date):
- **XX春** — spring cohort: teaching starts ~February, submission in August of the same year. Example: "26春" = teaching started spring 2026, submits August 2026.
- **XX秋** — autumn cohort: teaching starts ~September, submission the following March. Example: "25秋" = teaching started autumn 2025, submits March 2026.

Stored as `submissionRound` on the student (a free-form string matching a name in the `rounds` table). Two cohorts may be active simultaneously during overlap periods.

**Default Round** — configured per tutor in Settings → 默认学期. Stored as `tutors.default_round`. Dashboard remembers last-selected round in `localStorage('dashboard-round')`; if no memory, falls back to the configured default.

**Archived Round** — a round marked `is_archived = true`. Archived rounds and their students are excluded from the dashboard entirely (including "全部" view). Managed in Settings → 归档管理: can view student list (read-only), download full JSON, or unarchive. Archiving auto-clears `default_round` if it matches.

### EPQ Milestones
A fixed set of deliverables defined by the EPQ specification. Tracked per student as `not_started | in_progress | completed | na`.

Three groups:
- **Essay chapters** — Intro, Literature Review (文综), Methodology (方法论), Results (结果), Discussion (讨论), Reflection (反思), Conclusion (结语), Bibliography (文献), Abstract (摘要)
- **EPQ official forms** — Tables 1, 2, 4, 5, 6, 7, 11 (official EPQ spec form numbers)
- **Process milestones** — Defense (答辩), Submission (提交)
- **Optional** — Questionnaire (问卷); marked `na` if not applicable

### Mind Map
Per-student concept map for the student's EPQ topic. Tutor-created. Low-priority, largely unused feature.

### Monthly Meeting（月会）
Monthly sync attended by all Chinese-side tutors, organized by YUSHEN/ASEEDER management. Each tutor presents their own student cohort independently. Output: a PPTX deck filled out by the tutor before the meeting, covering student progress and teaching discussion points.

The deck follows a fixed five-slide template:
- Slide 1: Title (tutor name + date)
- Slide 2: Monthly overview (total students + key teaching action keywords)
- Slides 3+: Student progress table (one row per student; up to 7 per slide)
- Last slide: Difficult cases and experience sharing (manual free text)

**Output mode:** The system generates AI-drafted text content for each section; the tutor fills the template manually. No PPTX file is generated — the value is in the AI summarization, not file generation.

**Data sources for AI:** Current month's session `summary` fields + student `privateNotes`. Private notes are permitted here because the output is tutor-only and never exported. This is an explicit exception to the "privateNotes never in exports" rule — scope: monthly meeting AI draft only.

**AI output format:** AI reports the factual situation per student. No 进度档位 classification — the tutor assigns the color label manually after reading the AI draft.

**AI Name Encoding（AI 匿名编码）:** Before sending data to the AI, all student names are replaced with fixed alias names (e.g. 章哲睿 → 王坤鹏). Both full name and given-name-only variants are encoded (e.g. 哲睿 → 坤鹏). AI output is decoded back to real names before display. This prevents real student identities from entering the AI provider's logs.

Each student has an `aiAlias` field. Auto-generated (random 3-char Chinese name) when not set; editable from the Edit Student page. Alias is permanent once set — changing it after monthly reports exist would break continuity but is allowed.

Encoding scope: full name (e.g. 章哲睿 → 王坤鹏) and given name only / 2-char suffix (哲睿 → 坤鹏). Single-char surname is NOT encoded to avoid false positives. Decoding reverses all replacements in AI output before display.

**Output structure (on-page):** Two blocks matching PPT layout:
1. Slide 2 block — AI-generated keyword list for 本月主要教学动作
2. Per-student block — one paragraph per student with factual situation summary; students with no sessions in the selected month are included with a "本月无课" note

**Caching:** AI output is cached in `localStorage`, keyed by `(month, round)`. Displayed immediately on return visits. "重新生成" button clears cache and re-runs.

**Month selection:** Defaults to current month; user can navigate to any past month. "Current round" is whichever round is active in the Dashboard at time of generation.

### Session Report
AI-generated post-session summary for a single session. Sent to parents (student, parent, marketing staff). Incorporates the latest Progress Report for continuity context.

### Progress Report
AI-generated full overview of a student's EPQ progress. Sent to parents less frequently than session reports. Serves as context for the next Session Report.

### Weekly Report
AI-generated summary across all students. For tutor's own reference only, not shared externally.

### Action Log
Append-only record of every data mutation in the system. One entry per create/update/delete on tracked entities (student, session, trial, supervisor, milestone, homework, personal entry, mind map) plus AI generation calls (session report / progress report / weekly report). Tags `tag` / `round` mutations, logins, and page views are NOT logged. Kept indefinitely. Read by [[workflow-analysis]] only; not user-facing as a list.

Each entry: `timestamp`, `action` (`create` / `update` / `delete` / `ai_generate`), `entity_type`, `entity_id`, optional `metadata` (e.g. session type for session creates).

### Manual Log Entry
Tutor-authored free-text record of work not captured by [[action-log]] — e.g. "spent 2h preparing materials", "phone call with parent". Editable and deletable. Contains `description` (text) and `occurredAt` (timestamp, defaults to now but editable for retroactive entry).

### Workflow Analysis
AI-generated bi-weekly report analysing tutor's own work patterns. Independent from [[weekly-report]] (which is about students; this is about the tutor). Server-scheduled — fires every 14 days regardless of user activity. Past reports are retained and browsable.

Report sections:
1. **操作频率分布** — counts by action/entity type over the period
2. **时间模式** — when actions cluster (days of week, times of day)
3. **效率洞察** — AI commentary on observed patterns
4. **自动化建议** — repetitive sequences AI thinks could be automated

Data sources: [[action-log]] + [[manual-log-entry]] entries within the 14-day window.

### Personal Entry
Tutor's private diary/log. Not linked to any student. Not student-facing. Markdown content.

### Student Knowledge Base
A per-student, tutor-only accumulating context used by the tutor to chat with an AI and plan the next tutoring steps. **Sole user: the tutor.** Never student- or parent-facing; never exported.

Distinct from [[session-report]]/[[progress-report]] (one-shot generators sent to parents) — the Knowledge Base is an ongoing, private planning surface. Replaces the tutor's current manual workflow of pasting context into a web AI chat.

**Scope:** one chat is locked to a single student ("chat with 张三's KB"); it pulls only that student's data, never all 30. A cross-student **global assistant** ("who needs attention this week?") is explicitly deferred to a later phase — recorded, not built now.

Architecture is **three layers**, solving three pains (ranked): (a) re-assembling context every time = worst; (b) insights lost across chats; (c) data scattered across system/WeChat/tutor's head.

1. **Auto-assembled structured context** (solves a): rebuilt from DB on each chat, never cached stale. Full dump (1M-context API, room is ample). Candidate sources: session history + each session `summary`; SA session count used/total/remaining + cumulative SA duration; last SA / next SA / last TA / next TA dates; EPQ milestone statuses; [[schedule-entry]] exam/availability windows; `submissionRound`; Overview / Topic / Brief Note; [[private-notes]] content; [[homework-entry|Homework]] + done state; [[gantt-event|Gantt Events]]. **Which sources are pulled is configurable** via checkboxes in Settings — one **global toggle set per tutor** (not per-student), default all on, stored on `tutors` (alongside `default_round`). Tutor turns off sources they don't maintain (e.g. homework).
2. **Living Summary** (solves b + compaction): a single, evolving, AI-maintained + tutor-editable text per student — the "current understanding". Loaded as the main backdrop of every chat. Mirrors the tutor's current manual habit (ask web AI to summarize → open a fresh chat). Rarely hand-edited; updated via the **digest** action.
3. **Raw layer** (solves c + capture): an append-style inbox of undigested scraps per student — see [[knowledge-entry]]. Low-friction, one-way capture; touches no AI on write. Acts as the "latest patch" in a chat.

**Digest action** (layer 3 → layer 2): after a chat (or on demand), AI proposes durable new facts from the conversation + undigested raw entries; tutor approves/edits/deletes; approved content is merged into the Living Summary (tutor sees the change before it lands); raw entries are then cleared/archived. This is the automated version of the tutor's summarize-then-restart workflow, and reuses the "propose then insert on approval" pattern.

**Chat persistence:** conversation threads are NOT kept long-term (tutor manually clears when a chat gets long/messy). Only the Living Summary + Knowledge Entries persist.

Existing [[private-notes]] is basically unused; its content is fed into the assembled context rather than migrated. Not deprecated formally, just superseded as an input source.

**Privacy (both settled, both mandatory):**
- **Name encoding — reused.** KB is the largest data-to-AI firehose in the system, so student real names MUST go through the existing AI Name Encoding (`aiAlias`): encode before sending, decode before display. Same mechanism as monthly-meeting AI. Real names never enter the AI provider's logs.
- **privateNotes — second exception.** privateNotes MAY be included in the assembled KB context, because KB output is tutor-only and never reaches parents. This is the **second** explicit exception to "privateNotes never in exports" (the first is [[monthly-meeting]] AI draft), scope-limited to KB chat only. The governing test: *does the output ever reach a parent/student?* Session Report + Progress Report = yes → still filter privateNotes, unchanged by this feature. Monthly-meeting draft + KB chat = no (tutor-only) → allowed.

**AI plumbing:**
- **Model:** `deepseek-v4` (replaces the `qwen-plus` default in [`/api/ai/proxy`](epq-tutor-backend/app/routers/ai.py); baseUrl is already a request param so pointing at DeepSeek is config, not code). **Caveat to verify at build time:** confirm deepseek-v4's real context window; if it is not actually ~1M, add a fallback (truncate/summarize old sessions). Low risk here because scope is single-student; the 1M assumption only becomes load-bearing for the deferred global assistant.
- **Multi-turn:** the current proxy is single-shot (`messages:[{role:user,...}]`). KB chat needs a multi-turn endpoint accepting a `messages` array. Since chat is not persisted server-side, the client holds the running message array and sends the whole thing each turn.
- **Assembly + encoding move server-side (approved).** A new backend endpoint (e.g. `GET /api/students/{id}/kb-context`) pulls the enabled sources, applies AI Name Encoding, includes privateNotes, and returns the assembled structured block. This shifts prompt-building for KB off the client (a deliberate change from the existing "frontend builds prompts" pattern) so encoding + privateNotes handling live in one server-side place. Living Summary and Knowledge Entries are new server-side tables.

**UI placement:** a new **「知识库」 tab** on the student detail page holds the whole feature — chat panel (main), Living Summary (viewable/editable), Raw inbox list with quick "+", and the digest button. Chosen because KB is single-student-scoped, so it belongs on the student page rather than a new top-level route.

**Global quick-capture:** because raw entries are typically jotted mid-/post-class or while reading WeChat — when the tutor is not on that student's detail page — there is ALSO a global quick-capture entry (e.g. sidebar/Dashboard "速记" button): a popup that picks a student + takes one line, two steps, anywhere. Keeps capture friction low (the core of pain c).

### Knowledge Entry
One append-style record in the Raw layer of a [[student-knowledge-base]]. Timestamped, growing, individually retrievable — NOT a single blob like [[private-notes]]. Intended fields (draft): `timestamp`, `content`, optional source label (manual / WeChat excerpt / AI-derived insight). Undigested until a [[student-knowledge-base|digest]] folds it into the Living Summary, after which it is cleared/archived. Chosen over reusing `privateNotes` because the Raw layer needs timestamped, per-item entries, not one text field.

### Homework Entry
A checklist of tasks assigned to a student after a session. Linked to its source session via `sourceLabel`. May have a deadline. Items are individually checkable (`done: boolean`).

### 学生电子扫盲 (Student Digital Literacy Guide)
Internal name. A **static, student-facing self-serve guide** covering the repetitive "book-keeping" operational questions the tutor keeps re-explaining — especially to younger students: how to fill each form/table, how to use online docs without losing data, basic computer operations.

**Why static, not an AI chatbot:** a student-facing live AZ (option B) was rejected on cost structure, not merit — the tutor does not control the company's form-filling backend, and per-query tokens + server scaling are unaffordable for a solo tutor. The 90% of questions are the same FAQ, so evergreen static content suffices; the tutor still handles the 10% novel/personal cases in person.

**Shape:** a standalone static HTML page served by Nginx — same pattern as `gantt-pro.html` (see ADR 0001). Text + screenshots + short GIFs/video. **No auth** (not tutor-only data; nothing sensitive), **no runtime AI, no per-query cost, no scaling.** Does NOT integrate with or touch the company form system — it only *explains how*.

**AI's role shifts to authoring only:** AI helps the tutor draft the guide content once (one-time, cheap — even a web AI chat works), never answers students live.

**Usage reality (design constraint):** students likely won't self-discover or bookmark it. Primary use is the tutor showing it **in-class**, students consulting later. Because many students can't reliably bookmark/re-find a URL, the access path must be dead-simple and re-shareable (open design item: short memorable URL and/or QR code shown in class). Distribution friction is a first-class problem, not an afterthought.

**Content is generic/shared** (same for all students), evergreen — NOT per-student and NOT per-round. Distinct from [[student-knowledge-base]] (tutor-private, per-student).

**Mobile-first (hard constraint):** students reach the page by scanning a QR with their phone, so the page must be designed mobile-first from day one — narrow-screen layout, large type/buttons, generous tap targets. Not a shrunk-down desktop page.

**Access path:** primary = **QR code** shown in-class (far lower friction than expecting students to bookmark a URL; also puns on 扫盲/扫码). Backing = a short memorable path (e.g. `<domain>/help`). QR can also be printed on handout materials for repeat exposure. Distribution friction is treated as a first-class problem.

**Content scope (all four kept):**
- **A. Form filling** — one section per form: EPQ tables 1/2/4/5/6/7/11 — how to fill each, common mistakes.
- **B. Online docs / data-loss prevention** — how to save, autosave, version history, why local-only storage loses work.
- **C. Basic computer operations** — copy/paste, screenshots, finding files, uploading attachments, etc.
- **D. EPQ process orientation** — what the EPQ project roughly is, its steps, and where the student currently is (light overlap with the parent-facing timeline idea; kept).

Specific FAQ wording is deferred to build time (the tutor will pick the most-repeated real questions then).

**Status: idea record only — NO ADR.** This is a lightweight, easily-reversible static page; the tutor chose to record it as a pure idea, not an architectural decision.

### Overview
Short phrase categorising a student's EPQ topic — shown on the dashboard row as a compact identifier (e.g. "脑机接口", "气候变化"). Optional; if absent, nothing is shown. Distinct from Topic (the full EPQ title) and Brief Note (a freeform quick-reference).

### Brief Note
One-liner shown on the student card in the dashboard. Tutor-facing quick reference.

### Schedule Entry
A timestamped note recording a student's exam or availability window, as told to the tutor. Stored as `scheduleEntries: ScheduleEntry[]` (newest first) on the student. Each entry has `recordedAt` (date logged), `content` (free text), and optional `startDate`/`endDate` (reserved for future calendar view). The UI shows only the latest entry inline. The weekly report AI reads the latest entry to determine which students are currently in an exam period vs. available for nudging.

### Tags
Freeform labels on a student. Currently unused; candidate for removal.

### Private Notes
Tutor-only notes on a student. Never included in any export or AI-generated output. Enforced at serialization layer.

### Trial (试听课)
A trial lesson conducted with a prospective student before any enrollment decision. The tutor is one participant in the enrollment pipeline (alongside a consultant). A Trial is a standalone top-level record — not linked to a Student until the outcome is known. Trials do not require a Prospect entity; each Trial is independent.

**Outcome states:**
- `pending` — outcome not yet decided
- `no_deal` — 未成单, prospect did not enroll
- `deal_mine` — 成单给我, prospect enrolled and became this tutor's Student (linked via `studentId`)
- `deal_other` — 成单给其他老师, prospect enrolled with a different teacher

**Core fields:** date, duration (minutes), student name, grade, intended major, target university, areas of interest, English level, trial topic.

**Ratings (0–10):** topic feasibility (选题可行性), student motivation (学生积极性), EPQ interest (对EPQ感兴趣程度), EPQ suitability (参加EPQ适合程度).

**Enrollment intention:** low / mid / high (低/中/高) — tutor's prediction at time of trial.

**Feedback for student** (反馈留底): copy of what the tutor submitted to the 金数据 form. Written for the student/parent; praise-focused. Not private.

**Feedback for consultant** (顾问反馈留底): copy of freeform notes submitted to the 金数据 form. Not private.

**Retrospective** (复盘): tutor-only private notes about the lesson itself. Never exported or shared. Analogous to [[private-notes]] on a Student.

**Trial page layout:** two tabs — 列表 (list) and 统计 (stats). Stats tab shows: overall conversion rate = (deal_mine + deal_other) / all non-pending trials, with time filtering via preset buttons (本月 / 近3月 / 今年 / 全部) plus a custom date range picker.

### Last-Touched
The most recent timestamp at which any data for a student was modified — including adding a session, changing milestone status, or editing any student field. Distinct from Last-Meeting (which only tracks SA/TA meeting dates). Both signals are shown independently on the dashboard. **Backend gap**: `sessions` table has no `updated_at`; `student_milestones` has no timestamps. Full Last-Touched requires backend schema changes.

### Trial Lesson
A one-off session with a prospective student (not yet enrolled). Tracked independently — not linked to any Student record. Fields: date, time (HH:MM), durationMinutes (filled after lesson ends), studentName, grade, intendedMajor, outcome. Outcome options: pending / no_deal / deal_mine / deal_other.

A trial is **confirmed** once `durationMinutes` is filled. Unconfirmed trials (no duration) are excluded from overtime calculations.

### Overtime (加班)
Teaching time outside normal work hours. Used for weekly overtime applications submitted to management.

**Normal work hours** (Mon–Fri): 09:00–12:30 and 13:30–18:00.

**Overtime windows:**
- Weekdays: before 09:00, 12:30–13:30 (lunch break), after 18:00
- Weekends (Sat/Sun): all day

Overtime duration for a session = exact overlap between the session's time range and the overtime windows. A session crossing a boundary (e.g. 12:00–13:00) contributes only the overlapping portion (30 min). Sessions without `durationMinutes` are excluded.

**Application format** (weekly, copied as text):
```
05.28 12:30-13:00 SA -- 高同学 30min
05.30 18:00-19:00 SA -- 高同学 60min
05.25 10:00-11:30 试听课 -- 张景涵 90min
加班总计：3小时0分
```
Time range always shows the **full session** (start to end). The `min` value shows only the **overtime portion** (overlap with overtime windows). Total is sum of overtime portions only.
Modal has two tabs: 上周 / 本周 (Mon–Sun).

### 结项 (Wrapped Up)
Tutor's manual confirmation that a student is done for the current [[submission-round|Round]] — everything handed in, nothing left to chase. Stored as `students.wrappedUpAt` (nullable timestamp; the timestamp doubles as the "when" record, so no separate boolean). Un-wrapping = set back to null.

**Always manual.** A fully ticked [[submission-checklist]] does not auto-wrap a student: the tutor may have every artefact in hand while the student still hasn't pressed submit. Wrapping up with unticked checklist items raises a confirm prompt ("还有 3 项未完成，确认结项？") but is never blocked.

**Presentation only — never a computation input.** 结项 affects visual placement and nothing else: wrapped-up students collapse into an expandable "已结项 (n)" group at the bottom of the [[gantt-view|Gantt View]] and sink to the bottom of the [[submission-sprint-view]]. SA hour totals, weekly reports, and monthly-meeting AI all ignore it. Letting it feed calculations would force every future statistic to answer "do wrapped-up students count?".

Collapsed, not hidden — the group can always be expanded, otherwise there is no way to find a student to un-wrap them.

Distinct from an [[submission-round|Archived Round]]: archiving retires a whole cohort; 结项 is per-student and only re-orders views.

### Submission Checklist（提交前检查清单）
The tutor's own pre-submission gate check for one student — tutor-side delivery actions, not student deliverables. Examples: 学生是否已上传全部材料、AI 率与相似度报告是否备齐、答辩录屏转写是否整理好.

Deliberately **not** part of [[epq-milestones]], which are fixed by the EPQ specification, track student output, carry four states, and run all term. Checklist items are the tutor's operational routine, binary (ticked / not), only meaningful near the deadline, and expected to change as the tutor learns what is actually required.

**Template is a live definition, not a snapshot.** The tutor edits one template in Settings; every student's checklist is rendered against the current template, storing only which item ids are ticked. Adding a template item makes it appear (unticked) for all students at once; renaming propagates; removing an item **archives** it (`archived: true`) rather than deleting it: it disappears from every student, and Settings shows a collapsed 「已删除的项 (n) ▸ 恢复」 group. Restoring brings the item back under its original id, so the ticks come back with it; a second, explicit 「永久删除」 inside that group is what actually discards the tick data. Recovery is a visible button, not a side effect of happening to reuse the same id. Snapshotting per student was rejected: it would fork the template per cohort, and the whole point of the editable template is that late discoveries must reach students already in flight.

**Per-student ad-hoc items（额外项）.** Besides the template items, each student can carry their own free-form items (add/remove freely). This is where per-student submission materials live — every student hands in a different set, so they cannot be template columns. A single free bucket, not two: separate "额外材料" and "其他" buckets would leave the tutor guessing which one a given item belongs in.

Flat list — no grouping. Under ~10 items, grouping is overhead.

**Seed template:**
1. 表格检查完成 — one tick meaning "the tutor has been through all the forms". Deliberately NOT split into the seven EPQ tables: [[epq-milestones]] already tracks those per table, and that tracks *whether the student filled them in*, which is a different question from *whether the tutor has checked them*.
2. 论文检测报告 — see [[tii-check]].
3. 答辩录屏+转录
（额外项 covers the rest.）

### Tii Check（论文检测记录）
One Turnitin run for a student, recorded as `{date, aiPercent, similarityPercent, note}` in `students.tiiChecks` (JSON list). Check count = list length; **in principle a student should not be checked more than 3 times**, and the third check onward is flagged red — a warning, never a block, because reality may force a fourth run and the system must not push the tutor into under-reporting.

Stored as a list rather than a bare counter because the useful signal is the trend of the numbers (35% → 11% is what shows the problem was actually fixed), not the count. `aiPercent` and `similarityPercent` are **optional** — a check can be logged with the numbers left blank.

The 论文检测报告 checklist tick stays manual and is NOT derived from the presence of Tii Checks: having run the check is not the same as having the report tidied up and handed in.

### Submission Deadline（提交截止时间）
The moment a student must submit their EPQ work. Precise to the hour (not just the date).

Each [[submission-round|Round]] defines **two fixed deadlines**, both Friday 17:00, one week apart:
- `deadline_normal` — the standard deadline for the cohort
- `deadline_extended` — the one-week-later deadline granted to students who applied for an extension

Every student sits in one of two tiers (`deadlineTier`: `normal` | `extended`, default `normal`). Switching to `extended` is the "延期一周" action; it is reversible (switch back to `normal`). Because the tier is an enum over two fixed round-level dates, a student structurally cannot be extended twice.

On top of the tier, a student may carry an arbitrary **override** (`deadlineOverride`, nullable datetime) for one-off arrangements.

```
有效 ddl = student.deadlineOverride ?? round[student.deadlineTier]
```

**运营组确认 (`deadlineChangeConfirmed`)** — a boolean flag on the student. Any deviation from the round's `normal` deadline (switching to `extended`, or setting an override) requires confirmation from the 运营组 (operations team). The flag is a **marker, not a gate**: the deadline change takes effect immediately and the flag merely raises an "运营未确认" warning in the [[submission-sprint-view]]. Gating would force the data to lie while waiting for ops to reply. **Every deadline change resets the flag to `false`** — a stale tick is worse than no tick.

**Deferral to the next round** — a student who defers submission to the following cohort is handled by changing their `submissionRound`, not by any deadline field. The tutor keeps teaching them; they simply leave the current round's views and appear in the next round's. Changing the round **clears** `deadlineTier` / `deadlineOverride` / `deadlineChangeConfirmed` (the previous round's arrangement no longer applies), with a confirmation prompt since it discards data.

If the target round has no deadlines set yet, the student's effective deadline is **待定** — shown as such rather than hidden, with a prompt to go set the round's deadlines.

Deadlines are **not** drawn in the [[gantt-view|Gantt View]] (its grid is one column per day, so hour precision is invisible there); important global dates are maintained by hand in the gantt editor. Hour precision surfaces in the [[submission-sprint-view]] countdown and tooltips.

## Dashboard Design Decisions

### Primary Tasks
1. Urgency scan — quickly identify which students need attention
2. Record / schedule sessions

### Target Density
10–15 students visible at once (medium density). Current card grid (~6–8) is too sparse.

### Key Signals Per Student (in priority order)
1. Last-meeting urgency (days since last SA/TA meeting) → drives urgency accent color
2. Last-Touched (days since any info update) → shown as separate indicator
3. SA hours remaining (critical when ≤ 2h)
4. Next SA date + Next TA date (for 中方SA students: next SA only)

### Layout
Sidebar replaces top horizontal nav. Structure:
- 主要: 学生 (Dashboard) / 督导
- 工具: AI 指令 / Zoom / 工作流分析
- 系统: 设置
- Bottom: user avatar + logout

View-switching (卡片/列表/批次/进度/里程碑) remains within the Dashboard page, not in sidebar. All 5 views retained.

### Default Dashboard View
New **概览行 (Overview Row)** view — denser than card grid, more visual than table. Each row:
- Left urgency accent strip (red/amber/green based on last-meeting days)
- Student name (Chinese) + English name + Overview label (e.g. "脑机接口"; omitted if empty)
- Last-meeting signal (●Xd) + Last-touched signal (○Xd)
- SA hours remaining bar + remaining hours count
- Next SA date + Next TA date (中方SA students: next SA only)
- Hover: reveals "+ Session" quick-action button
- Row height ~56–64px; click navigates to student detail

### Sidebar
Collapsible (expanded = icon + label; collapsed = icon only). Structure:
- 主要: 学生 / 试听课 / 督导
- 工具: AI 指令 / Zoom / 工作流分析
- 系统: 设置
- Bottom: user avatar + logout

### Last-Touched Backend Fix
`_upsert_student` already touches `students.updated_at` on every save (sessions/milestones are full-replaced each save, so any change triggers it). Gap: `StudentSummarySchema` doesn't expose `updatedAt`. Fix: add field to schema + `_to_summary` mapping.

### Gantt Project
A named collection of [[gantt-event|Gantt Events]] with an owner. Owner is either the tutor (`owner_type = tutor`) or a student (`owner_type = student`, `owner_id = studentId`). Stored in `gantt_projects` table. Corresponds 1:1 to the `state` object in `gantt-pro.html` (`{projectName, sections, tasks}`).

Each tutor or student has at most one Gantt Project. The tutor's own project tracks the tutor's personal schedule; student projects track that student's exam windows, holidays, and deadlines.

### Gantt Event
A single entry within a [[gantt-project|Gantt Project]]. Two visual forms:
- **Bar** — a date range (e.g. exam period, holiday). Has `startDate` and `endDate`.
- **Diamond** — a point-in-time marker (e.g. submission deadline, SA meeting). `startDate = endDate`. Called "milestone" in the gantt editor UI.

Gantt Events are independent from EPQ Milestones — they are manually entered and carry no status tracking.

### Gantt View
The Dashboard view that replaces the old List view. Renders a read-only horizontal strip showing the **next 14 days** across all active students. Each student occupies one row; bars and diamonds within the 14-day window are drawn inline. Clicking a row navigates to that student's detail page. Edit button opens the [[gantt-editor|Gantt Editor]].

### Gantt Editor
`gantt-pro.html` served as a standalone static page by Nginx (not a React route). Supports editing all Gantt Projects: tutor's own and all student projects. Authenticates by reading the JWT from `localStorage('token')` — same token as the React dashboard (same domain). Two entry points: global `/gantt-editor` (sidebar link), and per-student link from the student detail page.
