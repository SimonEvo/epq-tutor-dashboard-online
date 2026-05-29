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

### Homework Entry
A checklist of tasks assigned to a student after a session. Linked to its source session via `sourceLabel`. May have a deadline. Items are individually checkable (`done: boolean`).

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
