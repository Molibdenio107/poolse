# POOLSE-14 · Remove classes from the Calendar

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Calendar · **Priority:** High

### PO — why this exists

An instructor is ill, a lane is out of service, a turma stops running in March — today there is no way to take a class off the calendar, so staff work around it by cancelling verbally and the calendar stops matching reality. Removing a class needs a scope choice, because "today only" and "from now on" are different intentions and guessing wrong destroys or preserves the wrong thing. High priority: it is the calendar's most obviously missing verb.

**Not in scope:** notifying students or encarregados de educação (recommended as no notification in v1 — see the open point), moving or rescheduling a class rather than removing it, and closure-driven cancellation, which is POOLSE-31 and behaves differently.

### BA — rules and data

- A class occurrence in the calendar exposes a Remove action from the context menu and/or the detail panel (AC1).
- Scope choice is mandatory and explicit: **this occurrence only**, or **this and all future occurrences** (AC2). There is no "all occurrences including past" option.
- Removal is a soft delete: attendance and history for past occurrences are never destroyed (AC3), and past occurrences are untouched by a "this and all future" removal (AC4).
- Removed occurrences disappear from the calendar and from class counts for the affected dates (AC6) — counts must recompute, not just hide the block.
- **Open (from the source doc):** may an Instructor remove a class, or Owner/Admin only? The assumption on record is Owner, Admin and the Instructor **assigned to that class**; this must be confirmed before build, because it changes the shape of the permission check from a role test to a role-plus-assignment test.
- Permissions resolve against the union of the actor's roles (POOLSE-17); an Instructor who is also an Admin removes as an Admin.
- Every removal is audit-logged (AC8) with actor, scope chosen, class, occurrence date and timestamp — the scope is the part that matters later.
- Edge case: two users remove overlapping scopes concurrently (one removes today, the other removes today-and-future). The result must be deterministic and must not resurrect an occurrence.
- Edge case: an occurrence with recorded attendance is removed. It vanishes from the calendar but its attendance survives per AC3 — so an attendance report may legitimately contain a date the calendar no longer shows, and reports must not treat that as corruption.
- Conflict to note: POOLSE-31 also removes classes from the calendar, but with different semantics (no charge, no reposição credit) and must remain distinguishable in history from removals made here (POOLSE-31 AC9).

### Dev — implementation notes

- Schema: recurring classes need per-occurrence records or an exception table. If occurrences are currently generated on the fly from a recurrence rule, this ticket forces the decision — materialise occurrences, or store removal exceptions plus a series end date. Pick one and apply it consistently; a hybrid is where the bugs live.
- "This and all future" is best expressed as setting the series' effective end immediately before the chosen date, plus an exception for that date if needed — not as a bulk delete of generated rows, which cannot be reasoned about later.
- Soft delete columns: `removed_at`, `removed_by`, `removal_scope`, `removal_kind` (manual removal vs closure cancellation, so POOLSE-31 stays distinguishable). Tenant key on every row, every query scoped.
- API surface: one endpoint taking class id, occurrence date and scope; the server, not the client, expands the scope. A client that sends a list of dates to delete is the wrong design.
- Permission enforcement server-side in a shared `canRemoveClassOccurrence(actor, class)` helper that covers both the role test and, if confirmed, the assigned-instructor test. The UI hides the action using the same helper's result, never its own copy of the rule.
- Class counts, occupancy figures and any calendar aggregate must exclude removed occurrences at query level, not by post-filtering in the client.
- i18n: the scope dialog's two options, the confirmation copy and the audit-visible strings in pt-PT and en. The scope wording must be unambiguous in both languages — "esta e todas as futuras" beats anything shorter.
- Concurrency: apply removals under a transaction with the series row locked, so overlapping scopes serialise rather than interleave.
- Most likely to get wrong: letting "this and all future" reach backwards through generated occurrences and take attendance history with it. AC3 and AC4 both exist because that is the natural failure of a naive recurrence delete.

### QA — test scenarios

14.1 Given a weekly turma with occurrences in the past and future / When an Admin removes a single future occurrence / Then only that date disappears and every other occurrence remains.
14.2 Given the same turma / When an Admin removes "this and all future" from a mid-series date / Then that date and all later ones disappear and every earlier occurrence, including its attendance, is untouched.
14.3 Given a past occurrence with recorded attendance / When "this and all future" is applied from a later date / Then the past attendance record is still readable in reports.
14.4 Given a Student user / When they call the removal endpoint directly for any occurrence / Then 403 is returned and nothing is removed.
14.5 Given an Instructor not assigned to the class / When they attempt removal via the API / Then the result matches the confirmed permission decision — and the test is updated once the open point is closed.
14.6 Given an Instructor assigned to the class / When they remove an occurrence / Then the audit log records them as the actor with the scope chosen.
14.7 Given an occurrence is removed / When the calendar and any class-count figure for that date are read / Then the count excludes it, rather than showing the class as still scheduled.
14.8 Given two Admins acting at once / When one removes a single occurrence and the other removes "this and all future" covering it / Then the final state is consistently removed and no occurrence reappears.
14.9 Given a removed occurrence / When history is inspected / Then it is distinguishable from an occurrence cancelled by a closure (POOLSE-31) and from a *falta*.
14.10 Given locale pt-PT then en / When the scope dialog opens / Then both options and the confirmation read correctly and unambiguously in the active language.
14.11 Given dark mode then light mode / When the removal dialog and the calendar's post-removal state render / Then both are legible and the removed slot is not signalled by colour alone.
14.12 Given a class whose entire remaining series is removed / When the turma is opened / Then it shows no future occurrences without erroring, and its enrolments are not silently deleted.
14.13 Given a removal request with a scope value not in the allowed set / When submitted / Then the API rejects it rather than defaulting to the wider scope.

**Open point:** should removing a class notify enrolled students / encarregados de educação (in-app or email)? Recommend: no notification in v1, add later with the parent-communication module.

### Acceptance criteria

1. A class in the calendar exposes a "Remove" action (context menu and/or detail panel).
2. Dialog offers: **this occurrence only** or **this and all future occurrences**.
3. Removal is a soft delete — attendance and history for past occurrences are never destroyed.
4. Past occurrences are not affected by a "this and all future" removal.
5. Enrolled students/EE are handled per the notification rules (see below).
6. Removed occurrences disappear from the calendar and from class counts for the affected dates.
7. Permission: which roles may remove — **assumed Owner, Admin and the Instructor assigned to that class**. Confirm if Instructor should be excluded.
8. Action is audit-logged.
