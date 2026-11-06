# POOLSE-192 · The office schedules a student's medical exam and reminds them of it, by message and in the app

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Students · **Priority:** High (pilot) · **Depends on** [POOLSE-191](./POOLSE-191-a-message-to-one-student.md), [POOLSE-133](./POOLSE-133-exame-medico.md)

### PO — why this exists

Rui, 06-11-2026: *"for 'medical exam' - from 'health and consent' add another section to schedule a medical exam with the necessary inputs, to when where etc and then a send message to that student as a reminder to do it. For that specific student it will display as an 'aviso' on the mobile app, but still receive the message or email."*

The exam record starts once an exam has happened. Nothing holds the step before it: an exam is due, and the student has been told. So it is chased by memory, and the swimmer turns up with an expired certificate.

**Not in scope:** automatic reminders; a ball on the menu for an overdue exam; a calendar entry; a booking with a clinic; a gate on enrolment or the register, because an exam is a warning, never a gate; the certificate's handling, which is unchanged.

### BA — rules

1. *Saúde e consentimento* gains *Agendar exame médico*, inside the exam's panel.
2. It is either **Marcado para** (the club booked it) or **Fazer até** (the student books it, by this date) (Rui). The date is required; time, place and note are optional. The date cannot be in the past.
3. A student has at most one open scheduled exam. Changing one means cancelling it and scheduling again; cancelling asks first and ends its aviso.
4. **Enviar lembrete** is pressed by a person (Rui). It uses POOLSE-191's send: recipients, email or WhatsApp, with the text prefilled from the fields and editable. Pressing it again resends, with no second aviso.
5. The first send always creates the aviso, with no tick (Rui). It runs from today to the day after the date, in club days.
6. The aviso ends when the exam is recorded, by either path (the office's form or accepting a family's), or the day after the date, whichever comes first (Rui). An exam recorded closes the open schedule.
7. After the date with no exam recorded, the panel says *Por registar*, in words, for the office. It stays until an exam is recorded or the schedule is cancelled.
8. Owner and admin schedule, cancel, read and send. An instructor reads nothing of a scheduled exam. They keep what POOLSE-133 gives them.
9. **It is health data** (default, 06-11-2026). The email and the aviso carry the date, the place and the words *exame médico*, and never a result. The note stays on the record and is not copied into the message unless the office writes it there. Neither appears on the student's tab for an instructor, nor in a general list.
10. `apply_retention()` erases a scheduled exam and the text of its messages with the student's other health data.
11. A family that has stopped general messages still receives it, as POOLSE-191 rule 10.

### Dev notes

- **Use the `write-migration` skill.** New table `medical_exam_schedule`, in `TENANT_TABLES` child-first in the same commit, RLS, and composite FKs for `student_id`, `recorded_exam_id` and `created_by`.
- Columns: `kind medical_exam_schedule_kind` (`appointment`, `deadline`), `due_on date`, `due_time time` (the facility's wall clock, a local time and not an instant), `place text`, `note text`, `recorded_exam_id uuid`, `aviso_message_id uuid`, `created_by`, `created_at`, `updated_at`, `archived_at`. Text columns checked not blank and bounded, as `medical_exam.note`.
- A partial unique index on `(organization_id, student_id)` `WHERE archived_at IS NULL AND recorded_exam_id IS NULL` gives rule 3.
- `message` gains `health boolean NOT NULL DEFAULT false`: every student message read for an instructor filters it out, and retention finds the text by it. The app role's UPDATE grant on `message` stays `archived_at` only; `apply_retention()` is the `SECURITY DEFINER` path.
- **`apply_retention()`:** a new migration redefines the latest body (`1794653000000_student-id-document-sealed.sql` at the time of writing, check for a later one). `test/` SQL coverage for it.
- **Closing on record:** in `insertExamIn` (shared by `POST` and `acceptSubmission`), in the same transaction, so both paths close it. End the aviso by `archived_at` on the message.
- **The aviso's window:** `shown_until = due_on + 1`. `message_app_window` requires it to be at or after `shown_from`, so rule 2's date check matters.
- **API:** beside the exam's routes, `requireRole('owner', 'admin')` in the first line. The read that fills the panel is only made on the sensitive page, and a read of it audits as the exam does.
- **Today** is `clubToday()`, never `new Date()`.
- **Trap:** the prefilled text is in the club's language (pt-PT by default), and a stored message keeps the words sent, never an i18n key.
- **Trap:** `sensitive/page.tsx`'s panel is client code, so do not import a server-only module through it (typecheck misses that; visit the page).

### QA

1. Given *Marcado para* with date, time and place, when an admin saves, then the panel shows them and the state in words.
2. Given *Fazer até* with a date only, then it saves.
3. Given a date in the past, then it is refused with the reason.
4. Given an open schedule, when a second is posted, then it is refused by the index.
5. Given a schedule, when the reminder is sent, then the recipients receive it and exactly one aviso exists from today to the day after the date.
6. Given a resend, then a second email leaves and the aviso count stays 1.
7. Given the office records the exam, then the schedule closes and the aviso is gone from the app the same day.
8. Given a family's exam accepted, then the same.
9. Given the day after the date has passed, then the aviso is gone, and the panel says *Por registar*.
10. Given a cancellation, then it asks first, the aviso ends, and a new one can be scheduled.
11. Given an instructor, when they call the schedule's read, then 403, and their student tab shows none of it (permission denial).
12. Given a family role against the endpoint, then 403.
13. Given two clubs, when club A reads a schedule of club B, then 404, and the FK refuses cross-tenant at the database (cross-tenant).
14. Given a student past the health retention period, when `apply_retention()` runs, then the schedule and its message text are erased.
15. Both themes and a phone width; the state is words, never colour alone.

### Acceptance criteria

- [ ] An exam can be scheduled either way, one open per student, enforced by the database.
- [ ] One press sends the reminder through POOLSE-191, and the aviso follows.
- [ ] Recording an exam by either path ends it.
- [ ] *Por registar* shows after the date, with nothing blocked anywhere.
- [ ] Office only, proved against the endpoint; no health text in a general list or to an instructor.
- [ ] Retention erases it, proved by a test.
- [ ] `TENANT_TABLES` updated in the migration's commit.
- [ ] pt-PT and `en`; `docs/features/students.md`, `docs/data-model.md`, `docs/features/retention.md`, and the `CLAUDE.md`/`students-and-families.md` line.
- [ ] `/poolse-security-review` run.
