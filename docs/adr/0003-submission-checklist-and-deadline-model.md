# ADR 0003: Submission Checklist as Live Template, Deadlines as Two-Tier Round Constants

**Status:** Accepted
**Date:** 2026-08-29

## Context

Near the end of a cohort the tutor must, per student, verify a set of hand-off actions that the EPQ specification says nothing about: every form checked, the Turnitin AI-rate and similarity reports in hand, the defence recording transcribed and tidied, and whatever extra materials that particular student owes. The need surfaced late — while a cohort was already approaching its deadline — which is itself a design input: whatever is built must be able to absorb newly discovered requirements and have them reach students who are already in flight.

At the same time, deadlines turned out not to be a single per-cohort date. Each round has two fixed deadlines (both Friday 17:00, one week apart); a student is on one or the other depending on whether they applied for an extension; and on top of that a deadline can be moved case by case — with a requirement that any such deviation is confirmed with the operations team (运营组).

The existing [[epq-milestones]] machinery (19 fixed items, four states) was the obvious place to put the checklist, and a plain `submission_date` column was the obvious place to put the deadline. Both were rejected.

## Decision

**1. The checklist is a separate entity from EPQ Milestones.**
`SubmissionChecklist` items are tutor-side delivery actions, binary, short-lived (only meaningful near the deadline), and defined by the tutor's own operational routine. EPQ Milestones are student deliverables, four-state, tracked all term, and fixed by the EPQ specification.

**2. The template is a live definition, not a per-student snapshot.**
One template is edited by the tutor in Settings (`tutors.submission_checklist_template`). Each student stores only which item ids are ticked. Template edits propagate to every student immediately.

**3. Deadlines are a two-tier enum over round-level constants, plus an override.**

```
rounds.deadline_normal / rounds.deadline_extended       两个固定周五 17:00，相隔一周
students.deadline_tier          'normal' | 'extended'   延期一周 = 切 tier，可撤销
students.deadline_override      nullable datetime       个案改动
students.deadline_change_confirmed  BOOLEAN             运营组已确认（标记，非闸门）

有效 ddl = deadlineOverride ?? round[deadlineTier]
```

**4. 结项 (Wrapped Up) is presentation-only.**
A manual per-student timestamp that collapses the student in the Gantt View and sinks them in the Submission Sprint View. It feeds no calculation anywhere.

## Alternatives Considered

**Checklist as extra EPQ Milestones** — reuses an entire working subsystem (storage, UI, progress bars) at zero cost. Rejected: operational items would drag down the milestone progress bar that measures student output; three of the four milestone states are meaningless for a binary tick; and `EPQ_MILESTONES` is a frozen constant reflecting the specification, whereas this list is expected to churn.

**Per-student template snapshot at creation** — insulates in-flight students from template edits. Rejected precisely because insulation is the wrong property here: the tutor discovers requirements late, and a late discovery must reach students who are already close to submitting. Snapshots would also fork the template per cohort and leave the tutor maintaining several near-identical lists.

**A single `submission_deadline` datetime per student** — maximally flexible. Rejected: 30 students would each need the same date typed in, and "one extension only" would have to be enforced by validation logic that can be got wrong. With a two-value tier the constraint is structural — an enum over two dates cannot express "extended twice".

**A boolean `deadline_extended` with no override field** — was the first proposal, and would have made the constraint airtight. Rejected once the tutor confirmed that deadlines do also get moved case by case, which a boolean cannot express. The override field is real, not speculative.

**运营组确认 as a gate** (deadline change refused until ticked) — rejected. The deadline genuinely changes before operations replies; gating would force the recorded data to contradict reality for as long as the reply takes. It is a warning marker instead, and it resets to `false` on every deadline change, because a tick left over from a previous change is worse than no tick at all.

**Deadlines drawn on the Gantt View** — rejected. The Gantt grid is one column per day, so hour precision is invisible there, and the tutor already maintains important global dates by hand in the gantt editor. Deadlines surface in the Submission Sprint View countdown instead.

**Time-triggered surfacing** (checklist auto-activates N days before the deadline) — offered and declined. Would have required a deadline model before anything could be displayed at all, and the tutor prefers a view they open deliberately over one that starts shouting.

**A bare Turnitin counter** — rejected in favour of a list of `{date, aiPercent, similarityPercent}`; see [[tii-check]]. The count is derivable from the list, but the trend of the percentages is not derivable from a count.

## Consequences

- Removing a template item **archives** it rather than deleting it, and Settings offers an explicit restore (original id, ticks intact) plus a separate permanent delete. Simply retaining orphaned tick data was rejected: it only rescues a mis-delete if the re-added item happens to carry the same id, which makes recovery a coincidence rather than an affordance.
- Ticks are written through **narrow endpoints** (`PATCH /api/students/{id}/checklist|deadline|wrap-up`), not the existing full-replace `PUT /api/students/{id}`. Ticking boxes across a 30-row grid must not rewrite whole student aggregates.
- Deferring a student to the next cohort is done by changing `submissionRound`, which **clears** tier/override/confirmed. No deferral-specific field exists.
- A round with no deadlines set yet yields a **待定** effective deadline rather than a hidden student.
- 结项 must be kept out of every statistic added in future; the moment it feeds one, every subsequent metric inherits the question "do wrapped-up students count?".
