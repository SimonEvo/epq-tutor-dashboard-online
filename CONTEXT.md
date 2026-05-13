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
The tracked duration of SA_MEETING sessions for a student. Only meaningful for students with a 英方SA. Used to monitor billing and ensure students meet EPQ quota requirements.

`saHoursTotal` = the student's contracted SA hour quota. Set by the tutor. Standard values: 9, 12, or 15 hours; 12 is the default (covers ~90% of cases). Edge cases exist.
`saHoursUsed` = auto-computed from SA_MEETING session records.

### Submission Round
The EPQ exam session in which a student submits their work. Occurs twice a year (e.g. "May 2025", "Jan 2026"). Groups students into cohorts. Stored as `submissionRound` on the student.

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

### Personal Entry
Tutor's private diary/log. Not linked to any student. Not student-facing. Markdown content.

### Homework Entry
A checklist of tasks assigned to a student after a session. Linked to its source session via `sourceLabel`. May have a deadline. Items are individually checkable (`done: boolean`).

### Brief Note
One-liner shown on the student card in the dashboard. Tutor-facing quick reference.

### Tags
Freeform labels on a student. Currently unused; candidate for removal.

### Private Notes
Tutor-only notes on a student. Never included in any export or AI-generated output. Enforced at serialization layer.
