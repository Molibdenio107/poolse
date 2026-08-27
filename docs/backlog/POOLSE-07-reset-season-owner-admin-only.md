# POOLSE-07 · Reset season (Owner/Admin only)

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Seasons · **Priority:** Medium

### PO — why this exists
At the end of an época the only way to start clean is to hand-delete classes, enrolments and attendance, which is slow and destroys the history the school needs for the following year. One explicit action that archives what happened and opens an empty season replaces a week of careful deletion. Owners and Admins are the only users, once a year. Medium because it is seasonal — but the wrong shortcut taken in its absence is irreversible.
**Not in scope:** rolling enrolments or the timetable forward into the new season, end-of-season billing closure, and reporting across seasons beyond keeping archived ones selectable.

### BA — rules and data
- Reset archives the current season — kept read-only and fully consultable, including classes, enrolments, attendance and history — and creates a new empty season, set active.
- The new season starts with no classes, enrolments or attendance. Students, levels and pools are tenant-level data and are untouched.
- Owner and Admin only; the endpoint returns `403` for every other role, and the button is hidden accordingly.
- Confirmation is typed: the user enters the season name or `RESET`; the dialog states in plain language what is kept and what starts empty.
- Read-only is a server-enforced rule, not a UI state: writes against an archived season are rejected wherever they originate.
- Exactly one season is active per tenant at any time.
- Archived seasons remain selectable in reporting and filters.
- **Open:** does skill progress (POOLSE-20) belong to the season or to the Person? If season-scoped, a reset wipes every student's progression and POOLSE-19's advancement restarts from zero — this needs deciding before the first reset is run in anger.
- **Open:** what happens to reposição credits (POOLSE-21) that are still available when a season is reset — carried, expired, or blocked from reset? This is the same question as the source doc's open point 4.

### Dev — implementation notes
- Schema: `seasons(tenant, name, starts_on, ends_on, status)` with a partial unique index enforcing one `status = 'active'` row per tenant.
- API: `POST /seasons/reset` performs archive + create + activate in one transaction, taking a row lock on the tenant's active season so two concurrent resets cannot both succeed. Accept an idempotency key so a retried request after a timeout does not create two blank seasons.
- Nothing is copied or deleted: archiving flips a status column, so every historical row stays exactly where the reports already read it from.
- Write-blocking on archived seasons belongs in one guard resolving the target season from the payload, not in each service — otherwise the enrolment and attendance endpoints each need their own check and one will be missed.
- The typed confirmation compares trimmed, case-insensitively, and accent-insensitively when the user types a Portuguese season name; `RESET` is a literal and must not be translated.
- i18n: the dialog's kept/emptied explanation is prose, so give it its own keys per sentence rather than assembling it from fragments — pt-PT will not follow English word order.
- Audit-log the action with actor, timestamp, the archived season id and the new season id.
- Most likely to be got wrong: treating "read-only" as a UI concern — the archived season stays writable through the API and last year's attendance quietly changes.

### QA — test scenarios
07.1 Given an Owner, When the Seasons page loads, Then a "Reset season" action sits next to "Add season".
07.2 Given an Instructor, When the Seasons page loads, Then no reset action is shown.
07.3 Given an Instructor's token, When `POST /seasons/reset` is called directly, Then the API returns `403` and no season is created or archived.
07.4 Given the confirmation dialog, When the typed value does not match the season name or `RESET`, Then the confirm button stays disabled.
07.5 Given a confirmed reset, When it completes, Then the previous season is archived and a new empty season is active, with zero classes, enrolments and attendance.
07.6 Given a completed reset, When the archived season is opened, Then its classes, enrolments, attendance and history are all readable.
07.7 Given an archived season, When an attendance write is posted directly against one of its occurrences, Then the API rejects it and the stored record is unchanged.
07.8 Given a completed reset, When the Alunos, Levels and Pools lists are opened, Then all tenant-level data is intact.
07.9 Given a completed reset, When a report's season filter is opened, Then the archived season is selectable and its figures are unchanged.
07.10 Given the confirm button double-clicked, or the request retried after a timeout, When the calls complete, Then exactly one new season exists.
07.11 Given two Admins confirming a reset at the same moment, When both requests land, Then one succeeds, the other fails cleanly, and exactly one active season remains.
07.12 Given pt-PT and en, and light and dark mode, When the dialog renders, Then the kept/emptied explanation is translated and the destructive styling passes contrast without carrying the warning by colour alone.

### Acceptance criteria

1. Button visible only to Owner and Admin; endpoint returns `403` for anyone else.
2. On confirm: the current season is archived (kept read-only and fully consultable — classes, enrolments, attendance, history) and a new empty season is created and set active.
3. The new season starts with **no** classes, enrolments or attendance. Students, levels and pools remain as tenant-level data.
4. Confirmation dialog is explicit and typed-confirmation style (user types the season name or "RESET"), since the action is not undoable in one click.
5. The dialog states in plain language what is kept and what starts empty.
6. Action is audit-logged with actor and timestamp.
7. Archived seasons remain selectable in reporting/filters.

**Open question left as a default:** the new season's name/date range — default to the next period suggestion, editable in the dialog.
