# POOLSE-236 · A flexible plan sells N lessons a week or a month, booked into any turma that accepts it

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Students / Fees / Calendar / Family app · **Priority:** Low (post go-live) · **Status:** backlog, build not decided (Rui, 19-11-2026) · **Depends on** [POOLSE-21](./POOLSE-21-aula-de-reposicao-as-a-credit-object.md) (the credit engine), [POOLSE-42](./POOLSE-42-mensalidade-quota-and-billing-periods.md) (the fee engine), [POOLSE-144](./POOLSE-144-enrolment-refuses-a-time-clash.md) (the time-clash rule)

### PO — why this exists

Rui, 19-11-2026, in a brainstorm: some clubs sell *"N aulas"* instead of a fixed turma. Today a fee covers a turma's full weekly schedule, and a reposição only replaces a *falta justificada* (POOLSE-21). A club that sells "8 aulas por mês, quando quiser" has no way to say so. It tracks the count on paper and books the lessons as if they were reposições.

The engine for "a lesson owed, booked into a free seat, expiring on a date" already exists: `reposicao_credit` and `reposicao_booking`. This ticket mints those credits from a paid plan instead of from an absence. It does not build a second booking system beside them.

**Not in scope:**
- A level check on booking. Any holder books any turma that accepts the plan (Rui, 19-11-2026).
- Paying in the app. The plan is a fee line, owed and settled the way every fee is today.
- A waiting list for a full session.
- Rolling unused lessons into the next period.
- Free swim. Passes stay POOLSE-68's.
- Any change to how a reposição is minted, capped or cancelled today.

### BA — rules

1. **A club creates flexible plans in its price list**, beside mensalidades and quotas. Each plan has a price, a number of lessons (1 to 50) and a **unit**: *por semana* or *por mês*. (Rui, 19-11-2026)
2. **Unused lessons expire at the end of their unit.** A weekly plan's lessons expire on the Sunday of their week, a monthly plan's on the last day of the month, in the club's calendar (the facility's timezone). Nothing rolls over. A booked lesson in a later unit is not allowed: a week's lesson is booked into that week.
3. **A turma opts in** with *Aceita plano flexível* on its form (default off). The form says in visible text, never a tooltip: *"O nível dos alunos não é verificado: qualquer aluno com plano flexível pode marcar esta turma."* (Rui, 19-11-2026)
4. **Any holder may book any opted-in turma of the plan's site.** No level check (Rui).
5. **Who books** follows the club's existing `reposicao_mode`:
   - `self_service`: the family in `/app` (for a linked child or themselves on the adult path), or the office in the backoffice, books directly.
   - `request`: a family's booking is a *pedido* that the office confirms, holding the seat for `reposicao_hold_hours` exactly as a reposição request does.
   - The office books directly in either mode.
6. **A booking takes a free seat** as counted by `session_free_seats()`. Enrolled students keep priority: a flex booking never takes a seat an enrolment needs, and an enrolment is never refused because of a flex booking already made. A full session is not offered.
7. **Cancelling.** Up to the club's *cancelar até __ horas antes* (a new club setting, default 2) the credit returns to *available* with its original expiry. Later than that the credit is *used*, whether or not the student comes. A closure that cancels the session returns the credit if its unit has not ended.
8. **The register.** A flex booking appears on the session's register as a guest row, as a reposição guest does today, labelled *Plano flexível*. Attendance and lesson feedback are marked on it as for a reposição guest. The student keeps their own level on their record. Booking a turma of another level changes nothing about it.
9. **Counts.** A confirmed flex booking counts in *Quem vem*, in free seats and in occupancy exactly like a confirmed reposição guest. If a count leaves reposição guests out today, it leaves flex guests out too, and the fix is one fix for both (see Dev notes).
10. **Billing.** The plan is billed through the existing fee engine: a `student_fee` line on the plan, `amount_cents`, the club's `fee_period`s. A plan in arrears still books (Rui): the office is warned on the student's record and on the register's guest row (*Em dívida*). A family is never told on the register.
11. **Time clash applies** (Rui, 19-11-2026). POOLSE-144's rule (one student, one place at a time, whatever the sport) refuses a flex booking that overlaps the student's enrolled turma or another of their bookings.
12. **A plan and a fixed turma together are allowed** (Rui, 19-11-2026), as a club selling "1 turma fixa + 4 aulas livres" needs. Rule 11 stops the two from overlapping.

### Dev notes

**Use the `write-migration` skill for every statement.** The new table and columns go in `TENANT_TABLES` and `tenant-isolation.sql` in the same commit.

This is three evenings. Build them as three slices, in this order:
- **A, invisible:** schema and minting.
- **B:** the office books and the register shows it.
- **C:** the family books in `/app`.

**Re-confirm with Rui before starting slice A.** It changes `reposicao_credit`, which every reposição already relies on. The fallback, if the engine change proves too invasive, is a parallel `flex_credit` table. That costs a second definition of free seats and holds, so it is the worse option.

**Schema (slice A):**
- **The plan.** `fee_kind` gains `flexible`. On `fee_plan`, `lessons_per_week` stays the mensalidade's. Two new columns, `flexible_lessons smallint` and `flexible_unit flexible_unit` (enum `week | month`), are required for kind `flexible` and null otherwise. Add the shape to the existing kind CHECK. A flexible plan has no level (`level_id` null), as a quota has none.
- **The enum trap.** Adding a value to `fee_kind` and using it in a CHECK in the same transaction fails in Postgres. The 8 September migration hit exactly this and made a new type; read it first. Two migrations is fine here.
- **The turma opt-in.** `class_group.accepts_flexible boolean NOT NULL DEFAULT false`. It sits on the turma, beside `reposicao_enabled`, which is a different switch.
- **The cancel window.** `facility.flexible_cancel_hours smallint NOT NULL DEFAULT 2`, with a 0 to 72 CHECK.
- **The credit.** `reposicao_credit` gains:
  - `source reposicao_credit_source NOT NULL DEFAULT 'excused_absence'` (enum `excused_absence | flexible_plan`);
  - `student_fee_id` (composite FK) and `period_start date`.
  - `attendance_id` and `class_session_id` become nullable, with a CHECK: set exactly when `source = 'excused_absence'`. `student_fee_id` and `period_start` are set exactly when `source = 'flexible_plan'`.
  - Add a partial unique index on `(organization_id, student_fee_id, period_start, seq)`, with `seq smallint` 1..N, so a second mint run makes nothing.
  - The snapshot rule holds. `source_window_days` and `source_capped_at_season_end` do not apply to a flex credit (make them nullable under the same CHECK). The unit and count are snapshotted as `source_unit` and `source_lessons`, so a club editing the plan mid-month changes nothing already minted.
  - The season cap (`reposicao_cap_per_season`) counts `excused_absence` credits only.
- **Minting is a function, called from two places.** `mint_flexible_credits(org, day)` is idempotent and takes a *day*, never `now()`, for the same reason as `expire_reposicao_credits`. For every live `flexible` `student_fee` line whose unit contains `day`, it inserts the missing `seq`s.
  - **It cannot be a trigger alone:** time passing fires nothing, and a new week needs credits with no row written.
  - **It cannot be the job alone:** a family that signs up on a Tuesday would wait until the next run.
  - So the nightly job calls it for every club, beside `expire_reposicao_credits`, and the fee-line insert path calls it for the new line's student.
  - The line's `starts_on` and `ends_on` bound which units mint. **Open:** does a plan starting mid-week or mid-month get the full N for that first unit, or a pro-rata share? A money rule, so ask before slice A. **Default if unanswered: the full N**, as the fee for that period is charged in full.
- **Expiry.** It is the unit's last day, computed in SQL from `period_start` and `source_unit`. It is never stored twice.

**Booking (slices B and C):**
- **Reuse the existing paths.** Book through `bookCredit` / `redemption.repository.ts` and the same `reposicao_booking` row, locks and re-validation. Add these checks:
  - the session's turma `accepts_flexible`;
  - the credit is `source = 'flexible_plan'`;
  - the session lies inside the credit's unit;
  - the clash rule (rule 11). Reuse POOLSE-144's clash check, never a second definition.
- **Credit order.** The oldest expiry is spent first, as today. A student holding both kinds spends a reposição credit only when booking their own turma's level, and a flex credit otherwise. Name the choice in the function and test it.
- **Cancelling** reads `flexible_cancel_hours` for a flex credit. A reposição credit keeps today's rule (cancellable until the class starts). The rule is one function with the two branches side by side, and it is not changed for reposições.
- **Permissions.** The `/app` booking route refuses a child not linked to the guardian with 404, never 403. Copy the reposição route's `guardian_link` check, never a new one. `requireRole` is the first line of every handler. Add the role-probe lines.
- **Occupancy.** Check whether `pool_occupancy()` counts confirmed reposição guests today. Its turma branch counts active enrolments. If it does not, that is a pre-existing gap: propose it as its own fix and do not hide it inside this ticket. Rule 9 then covers both kinds at once.
- **Register.** The guest row's label comes from `credit.source` (`attendance.guestKind.reposicao` / `.flexible`).
- **Arrears flag.** Use `olderUnpaid` and the line's own state, never a second "in debt" definition.

**Security:** run `poolse-security-review` for the new booking route and for the minting function, if it is a `SECURITY DEFINER` (it should not need to be; it runs per club under the job's tenant context).

### QA

1. Given a monthly plan of 8 with no bookings in November, when the job runs on 1 December, then November's 8 credits read *expired* and December has 8 *available*. A second run on the same day mints nothing.
2. Given a weekly plan of 2, when the family books Monday and Wednesday, then a third booking that week is refused (no credit). The next Monday has 2 again.
3. Given a turma without *Aceita plano flexível*, when a holder tries to book it from `/app` or through the API, then it is not offered and the API refuses it.
4. Given an opted-in turma of a higher level, when a level-1 holder books it, then it is booked. The student's level is unchanged, and the turma form shows the visible no-level-check sentence.
5. Given a session with 1 free seat and a flex booking in it, when the office enrols a new student in that turma, then the enrolment succeeds. The flex booking is not silently dropped: the office sees the session is over, as with a reposição guest today.
6. Given a cancel window of 2 hours, when the family cancels 3 hours before, then the credit is *available* with its original expiry. At 1 hour before, cancelling is refused and the credit is *used* after the class.
7. Given a closure on a booked session, when the closure is applied, then the credit returns if its week or month has not ended.
8. Given `reposicao_mode = request`, when a family books, then the booking is *pending* and the seat is held until `holds_until`. The office confirms it in the existing queue.
9. Given a plan in arrears, when the family books, then it succeeds and the register's guest row reads *Em dívida* for the office only.
10. **(Rule 11)** Given a student enrolled Tuesday 18:00, when a flex booking is made for Tuesday 18:00 at another site of the club, then it is refused with the clash message.
11. **Permission:** a guardian booking for a child they are not linked to gets 404. Maintenance calling the office booking route gets 403. The role-probe has a line for each.
12. **Cross-tenant:** club B's credit or session id, used from club A, returns 404. `tenant-isolation.sql` covers the new columns' composite keys.
13. **Unchanged for reposições:** an excused absence still mints with its window and season cap, and cancels until the class starts. The existing POOLSE-21 tests pass untouched.
14. Phone width (390 px) and dark mode: the `/app` booking list and the turma form's sentence are readable, with contrast-checked text.

### Acceptance criteria

- [ ] Flexible plans created in the price list with count and unit; the shape is enforced by CHECK.
- [ ] Credits minted per unit by `mint_flexible_credits(org, day)`, idempotent, from the nightly job and the fee-line insert. They expire at the unit's end.
- [ ] Turma opt-in with the visible no-level-check sentence.
- [ ] Booking by the office (both modes) and by the family per `reposicao_mode`, through the existing booking path and free-seat count.
- [ ] Club cancel window; late cancel = used; a closure returns the credit.
- [ ] Guest row *Plano flexível* on the register; attendance and feedback work; counts match reposição guests.
- [ ] Arrears warn the office and do not block.
- [ ] Reposição behaviour unchanged (QA 13).
- [ ] Role-probe, cross-tenant and `tenant-isolation.sql` lines; `poolse-security-review` run.
- [ ] `docs/data-model.md`, `docs/features/` (students and fees), and the user guide updated; the new page added to the Ctrl+K palette.
- [ ] pt-PT and en strings; `i18n:check`, `pt:check`, `contrast:check` green.
