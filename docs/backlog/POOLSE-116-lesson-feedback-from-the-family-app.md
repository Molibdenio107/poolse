# POOLSE-116 · The app: a student's feedback after a lesson

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Mobile app / Students · **Priority:** Medium (pilot) · **Depends on** [POOLSE-90](./POOLSE-90-the-app-agenda-per-role.md) slice 1, [POOLSE-13](./POOLSE-13-attendance-states.md) · **Related** [POOLSE-86](./POOLSE-86-email-delivery.md) (the nudge), [POOLSE-66](./POOLSE-66-dashboard-role-bands.md) (a later widget)

### PO — why this exists

Rui, 27-10-2026: *"for the app mobile, I want a place where a student can give training feedback after that training happened. Like a text box for that."*

Today the club hears about a lesson only when a parent corners the instructor at the gate. The app already shows the family its coming lessons (POOLSE-90); this ticket adds the other half — once a lesson has happened, the student (or the guardian) says in one tap and a few words how it went, and the instructor and the office read it where the lesson already is.

**Shape, agreed 27-10-2026:** a one-tap mood **plus** an optional text box, not text alone — a bare box yields *"ok"* and silence, and a row of faces is what most people will actually answer. Instructors see the feedback on **their own** lessons; management sees all. The window is **7 days** after the lesson.

**Not in scope:** an instructor's reply; photos or attachments; an aggregate mood widget on the dashboard (one registry declaration later, when there is data to show); the push nudge *"Como correu a aula?"* — written here as the thing that makes the feature earn its keep, built with the notifications provider; sharing feedback with parents as part of parent communication (the reverse direction, deferred with it); feedback on a parceria session (no register, no student).

### BA — rules

1. **Feedback hangs off the attendance row**, one per `(class_session, student)`. It can exist only for a lesson that **happened** — a session not `cancelled`, past its `ends_at` on the club's clock — **and** only where the student's mark is `present`. No mark, or `absent` / `excused`, means there is nothing to give feedback on, and the app says so in words (*A presença ainda não foi registada* vs *Faltou a esta aula*). The instructor's register is therefore the gate: a lesson whose register was never taken takes no feedback.
2. **Who answers** is POOLSE-90's rule for *Vou / Não vou*: a student aged **12 or more with their own login** answers for themselves; under 12, a **guardian** answers. Either way the row records the **membership that wrote it**, and the backoffice says *pelo aluno* or *pela encarregada de educação / pelo encarregado de educação* from that — derived from the author's relation to the student, never a flag the client sends.
3. **Mood** is required, **1 to 5**, drawn as five faces (or three on a narrow phone — same scale, the middle three collapse). **Text** is optional, **≤ 500 characters**, plain text. The prompt is a question, not an empty box: *Como correu a aula?*; on the first lesson of a new level, *Como correu a primeira aula no novo nível?*
4. **Window: from the session's end until 7 days later**, judged on the API against `club_today()`. Inside the window the author may edit (mood and text); after it the row is frozen and the app shows it read-only with *Já não pode ser alterado*. There is no delete — a family that regrets a comment edits it to something milder inside the window; after that it is a record. Archiving exists only for the office (rule 7).
5. **Not anonymous**, and the screen says so once, under the box: *O professor e a secretaria vão ler isto.* A per-student answer cannot be anonymous and pretending otherwise is the one thing that would make a parent angry later.
6. **Who reads.** Owner and admin: every feedback in the club. Instructor: feedback on sessions where they are `resolved_instructor_id` — the stand-in reads the lesson they taught, the regular instructor does not (the dashboard's `scope: 'self'` rule, POOLSE-66). Maintenance, guardians and students of *other* children: nothing. The family reads only its own child's. Enforced per row in the repository, 404 for a stranger (`requireActsForStudent` on the write; the read is scoped by the session's instructor or the role).
7. **The office may archive** a feedback (abuse, a comment about another child by name) — soft, audited, restorable through the bin (`RESTORABLE`, POOLSE-78). An archived row is absent from the instructor's view and from the family's, and the family's box reopens as if nothing had been written, inside the window.
8. **Retention**: feedback is the student's own words about their lesson, not health data — it goes with **identity** in `apply_retention()`: anonymised (author and text cleared, mood kept) 5 years after `student_left_on()`. A line in the function and in `retention.integration.test.ts`.
9. **Where it shows for the family.** The agenda gains an *Últimas aulas* strip (the last 7 days, attended lessons only, newest first), each with its mood when given or *Dar feedback* when not. The lesson page (`/app/familia/aulas/:sessionId`) **admits a past lesson inside the window** — today it 404s once the lesson is over — and carries the form under the plan. Outside the window the page is still a 404, as now.
10. **Where it shows for staff.** The lesson's page (the register, POOLSE-88 slice 2) gains a *Feedback* strip below the register: one row per student — face, text, *pelo aluno / pela encarregada*, when — muted when none. A student's record (`DetailPage`) gains the feedback list on the **Semana / Aulas** tab, newest first, paginated at 15 (it grows with the child's lessons). Nothing new in the sidebar.
11. **The nudge** (not in this slice, written so it is not re-decided): one push per attended lesson, about 60 minutes after `ends_at`, *Como correu a aula?*, deep-linked to the lesson page; never for an absent child, never twice, never after the window. A row in the same shape as `level_change_notice`, delivered after commit and retried like every email.

### Dev notes

- **Schema.** `lesson_feedback`: `id`, `organization_id`, `attendance_id` with the composite FK `(organization_id, attendance_id) → attendance`, `mood smallint CHECK 1..5`, `comment text CHECK (char_length(comment) <= 500)`, `author_membership_id` (composite FK to `membership`), `created_at`, `updated_at`, `archived_at`. Partial unique on `(attendance_id) WHERE archived_at IS NULL`. RLS on `current_organization_id()`, `TO poolse_app`. A constraint trigger refuses an insert whose attendance is not `present` or whose session is `cancelled` / not yet ended, with `DETAIL` carrying the code (`feedback_not_present|…`, `feedback_too_early|…`) so the API answers a 409 with the figures as fields. The 7-day window is checked **in the API** against `club_today()` (the trigger would need the club's today too — it has `club_today()`, so do it there as well, belt and braces, same DETAIL shape `feedback_window_closed|<closed_on>`). Add the table to `TENANT_TABLES` child-first (it hangs off `attendance`), and a line in `apply_retention()`.
- **API.** `PUT /app/lessons/:sessionId/feedback` — body `{ mood, comment? }`, `requireActsForStudent` resolved through the session's enrolment the way `familyMayReadPlan` does; upsert on the attendance row; returns the row. `GET /app/lessons/:sessionId` carries `feedback` (`null` when none, plus `feedbackWindow: { closesOn, open }`) and now answers a past lesson inside the window. `GET /app/agenda` carries `recent[]` (rule 9). `GET /sessions/:id/register` carries `feedback[]` for the staff reader, filtered in the repository by role or `resolved_instructor_id`. `GET /students/:id/feedback` paginated, staff only (instructor only for sessions they taught — the same predicate). `POST /feedback/:id/archive` owner/admin, through the archive path with its `archiveEntryId`. All five in `security/role-probe.integration.test.ts` in the same change.
- **Author relation** (rule 2): derive `pelo aluno` when `author_membership_id` is the student's own membership, else `guardian_link` from author to student — computed in the read SQL, shipped as `authoredBy: 'student' | 'guardian'`; never stored.
- **Web, family side.** `(app)/app/familia/aulas/[sessionId]`: a `FeedbackForm` client component — five `radio` inputs drawn as faces (labelled, so the screen reader says *Muito bem* not *4*), `TextAreaField`, `useSavedAction`, controlled, `FormResetGuard` already mounted. Tier 1: `h-control` 44 px under a coarse pointer, `pb-safe-bottom`, a line in `phone-app.spec.ts`. The faces use the attendance tokens' *distinct* system rule: a fifth colour system is not wanted — the faces are **outlined icons with the mood as text beside the selected one**, colour only on the selected state from `--primary`.
- **Web, staff side.** `FeedbackStrip` under the register; a tab list on the student's record using the existing pagination control. Dates through `formatDate` / `formatTime`; the elapsed time through `timeAgo`.
- **i18n** keys under `app.feedback.*` and `feedback.*` in both files; the two prompts, the five mood labels, the three states of rule 1, the author labels (both genders where Portuguese needs them: *pela encarregada / pelo encarregado*), the closed-window sentence.
- **Most likely to be got wrong:** opening the lesson page to a past lesson. Today "already over → 404" is one predicate shared with the plan read; widen it to *over and inside the feedback window* **for the family's own child only**, and keep the plan's own `familyMayReadPlan` untouched — a family must not gain the plan of a lesson it could not see before. Second: the instructor's read must use `resolved_instructor_id`, not `class_schedule.instructor_membership_id`, or the stand-in sees nothing and the absent regular sees everything.

### QA — scenarios

1. **Given** a guardian of a 9-year-old, a lesson that ended an hour ago with the child marked `present`, **when** they open the lesson from *Últimas aulas* and pick a face and write a line, **then** the row is saved, the agenda shows the face, and the register strip shows it as *pela encarregada de educação*.
2. **Given** a 14-year-old with their own login, **when** they answer, **then** `authoredBy` is `student` and the strip says *pelo aluno*.
3. **Given** the child marked `absent`, **then** the lesson page shows *Faltou a esta aula* and no form; `PUT` answers 409 `feedback_not_present`.
4. **Given** a lesson whose register was not taken, **then** *A presença ainda não foi registada*, no form, 409 on `PUT`.
5. **Given** a lesson still running, **then** `PUT` answers 409 `feedback_too_early`.
6. **Given** feedback given 6 days ago, **when** the author edits it, **then** saved; **given** 8 days ago, **then** read-only with *Já não pode ser alterado* and `PUT` answers 409 `feedback_window_closed` carrying the date.
7. **Given** a stand-in taught the lesson, **when** the stand-in opens the register, **then** the strip shows the feedback; **when** the regular instructor opens it, **then** not.
8. **Given** an admin archives a feedback, **then** it leaves the strip and the student's tab, the family's box reopens inside the window, and the bin restores it.
9. **Given** a guardian of another child, **when** they `PUT` or `GET` this session's feedback, **then** 404. Cross-tenant: 404. Maintenance: 403 on the student's feedback list.
10. **Given** a comment of 501 characters, **then** a field error beside the box, nothing saved.
11. **Given** a student who left 5 years ago, **when** `apply_retention()` runs, **then** the text and author are cleared and the mood remains.
12. Round trip on the phone projects (`iphone`, `android`): the form is reachable one-handed, the faces are 44 px, the keyboard does not hide the Save bar. pt-PT and en, light and dark.

### Acceptance criteria

1. One table, under RLS, hung off `attendance`; feedback exists only for an attended, finished, uncancelled lesson.
2. Mood 1–5 required, text ≤ 500 optional, one row per student per lesson, editable 7 days, then frozen.
3. The family writes and reads only its own child's; the instructor reads their own taught lessons; owner/admin read all and may archive; every other login gets 404/403, proved in the role probe.
4. *Últimas aulas* on the agenda; the form on the lesson page; the strip on the register; the list on the student's record.
5. Retention line, bin line, `TENANT_TABLES` line, i18n in both files, phone spec line.

### Open questions

1. Should the first-lesson-of-a-level prompt exist in this slice, or is one prompt enough? Default: one prompt now; the second is a key and a predicate later.
2. Three faces or five? Default: five stored, five drawn; collapse to three only if the narrow-phone row does not fit at 44 px each.
