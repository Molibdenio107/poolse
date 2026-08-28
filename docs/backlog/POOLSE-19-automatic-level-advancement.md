# POOLSE-19 · Automatic level advancement

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Levels / Turmas · **Priority:** High — the differentiator
**Borrowed from:** nobody. iClassPro keeps skill levels and class levels as two unrelated systems and instructs staff to link them by hand; Jackrabbit's progression is advisory only.
**Depends on:** POOLSE-20 (skill states), POOLSE-05 (level ordering defines "next").

### PO — why this exists

Today a student can finish every skill in their level and sit there until a human notices. The instructor marks the last skill poolside, nothing happens, and the family waits until someone reviews the turma by hand — often a whole época. Admins and instructors get a queue instead of a memory exercise; students and encarregados de educação get told they are ready. It sits at High because it is the one mechanic no competitor has, and because it defines the shape of levels and skills while both are still cheap to change.

**Not in scope:** enrolling anyone without a human confirmation; waiting-list management for the "no seat" case; any change to the mensalidade schedule on transfer (POOLSE-24).

### BA — rules and data

- A level carries a set of required skills. A level is **complete** for a student when every skill flagged required on that level is at *Adquirido* (POOLSE-20). Skills not flagged required never gate completion.
- "Next level" is the next level in the tenant's level order index (POOLSE-05). Order is tenant-scoped; there is no global ladder.
- A **transfer proposal** is a record: student, from_level, to_level, generated_at, status (pending / confirmed / dismissed / invalidated / expired), ranked candidate turmas, confirming actor, effective date.
- Candidate turmas must satisfy all of: same tenant, active época, level = to_level, at least one open seat, and the student's age in months inside the turma level's min/max range (POOLSE-06 months, POOLSE-16 ceiling of 100).
- Ranking is strictly: (1) same weekday **and** same start time as the student's current turma, (2) same instructor, (3) any remaining eligible turma. Ties break on most open seats, then turma name.
- Zero candidates → the student is flagged **ready to advance — no seat** and appears on the demand report. The flag clears automatically the moment an eligible seat exists; it is not a manual to-do.
- Confirmation transfers the enrolment: the old enrolment ends on the chosen effective date, the new one begins on it. Attendance already recorded against the old turma stays on the old turma; nothing is re-parented.
- If a skill is downgraded from *Adquirido* after a proposal is generated (correction, override reversal), the pending proposal moves to **invalidated** and disappears from the queue. It is never silently re-graded to a different level.
- Interaction with POOLSE-21: credits belong to the student, not to the turma, so unused reposição credits survive a transfer. Redemption eligibility (matching level) then resolves against the **new** level from the effective date onward.
- Seat counting must exclude reposição guests, who are on the roster for attendance but not enrolled (POOLSE-21 AC8). Counting them consumes seats that do not exist.
- **Open, and deliberately unbuilt (28 Aug).** Nothing happens at the end of the ladder: no proposal is generated and **no new state was invented**. What a club owes a student who has finished the whole programme is core business behaviour still to be clarified — it may turn out to be the student's own choice, or to follow from their age. A guess in the schema is expensive to unpick, so this waits. Asserted as a tested behaviour (`advancement.sql` test 6) so "nothing happens" is deliberate rather than something a later reader mistakes for a bug.
- **Answered by the ticket's own Dev section (28 Aug): they see it and wait.** "Student and EE tokens get `403` on confirm regardless of what the mobile app renders", which settles AC 7's "a human" as staff. Built that way — `requireRole('owner', 'admin', 'instructor')` on confirm and dismiss.

### Dev — implementation notes

- Migration: `level_required_skill` (tenant_id, level_id, skill_id), `transfer_proposal`, `transfer_proposal_candidate`. Tenant key on every table, every query scoped, per the data-model rule.
- Completion evaluation lives in one shared service method called from the skill-progress write path — never from the instructor grid's UI code. The grid saves incrementally over a flaky poolside connection (POOLSE-20 AC5), so evaluation must be idempotent and deduplicate per (student, level) rather than firing per mark.
- API: `GET /transfer-proposals` (queue, server-side paginated at 15 per POOLSE-29), `POST /transfer-proposals/:id/confirm` `{turmaId, effectiveDate}`, `POST /transfer-proposals/:id/dismiss`, `GET /reports/ready-no-seat`.
- Confirmation runs in a transaction that takes a row lock on the target turma and re-checks the seat count inside it. Two admins confirming into the last seat from two stale queues is the realistic failure, not a theoretical one.
- Permission enforcement is server-side on the confirm endpoint: Owner, Admin, and the Instructor assigned to the source or target turma. Student and EE tokens get `403` on confirm regardless of what the mobile app renders.
- Seat availability, age-range eligibility and "next level" resolution are one shared helper reused by the proposal generator, the redemption filter (POOLSE-21) and the enrolment screens — three copies will drift.
- i18n: level names are renameable per tenant (POOLSE-20 AC8), so proposal copy interpolates the stored name and never a hardcoded label; the ranking explanation ("mesmo dia e hora") is a translated string in pt-PT and en. Queue status chips need their own tokens, checked in light and dark, and clear of the attendance (POOLSE-13) and role (POOLSE-18) palettes.
- Most likely to be got wrong: treating "next level" as the level's id order or creation order instead of the drag-and-drop order index, so reordering levels in Settings silently reroutes every future proposal.

### QA — test scenarios

19.1 Given a student one skill short of completing a level / When the instructor marks that skill *Adquirido* / Then a pending proposal appears in the queue within the same session.
19.2 Given a level with required and optional skills / When only the optional ones are outstanding / Then the level counts as complete and a proposal is generated.
19.3 Given a pending proposal / When an Instructor not assigned to either turma calls the confirm endpoint directly with a valid token / Then the API returns `403` and no enrolment changes.
19.4 Given a student authenticated on the mobile app / When they POST to the confirm endpoint / Then `403`, even though the proposal notification is visible to them.
19.5 Given a target turma with exactly one open seat / When two admins confirm into it concurrently / Then one succeeds and the other is rejected with a seat-unavailable error, never overbooking.
19.6 Given the tenant's levels reordered by drag and drop (POOLSE-05) / When a student completes a level / Then the proposal targets the newly adjacent level, not the previous one.
19.7 Given a student aged 61 completing an adult level / When candidates are ranked / Then *Hidroginástica Sénior* (60–100) is eligible and not filtered out by a stale age ceiling of 30.
19.8 Given a proposal is pending / When the instructor corrects the last skill back to *Avaliado* / Then the proposal moves to invalidated and leaves the queue without enrolling anyone.
19.9 Given no eligible turma exists / When the student completes their level / Then they appear on the ready-to-advance-no-seat report; and when a seat later opens, the flag clears and a proposal is generated without staff action.
19.10 Given a target turma whose roster includes two reposição guests / When seats are counted / Then the guests do not consume enrolled seats and the turma is still offered.
19.11 Given the pt-PT locale / When the queue and the mobile notification render / Then all copy including the tenant's custom level name is in pt-PT; switching to en changes the copy but not the level name.
19.12 Given dark mode / When the proposal queue renders status chips / Then contrast passes and the chips are distinguishable without colour, and are not confusable with attendance states.

### Acceptance criteria

1. A level defines which skills are required to complete it; completion is evaluated automatically as skills are marked attained.
2. On completion, the system generates a **transfer proposal**: next-level turmas that have open seats, are compatible with the student's current day/time slot, and whose age range fits.
3. Proposals are ranked — same weekday and time first, then same instructor, then any open seat.
4. Proposal is surfaced to the admin/instructor as a queue, and (mobile app) to the student or encarregado de educação as a notification.
5. Confirming a proposal performs the enrolment transfer: the student leaves the old turma at a chosen effective date and joins the new one, with attendance history preserved on both.
6. If no eligible turma exists, the student is flagged **ready to advance — no seat**, and appears on a report; this is a demand signal for scheduling the next season.
7. Advancement is never automatic without a human confirmation.
8. Class levels and skill levels are **the same objects** — not two parallel systems that need manual mapping.

---

## Built 28 Aug — the mechanic, the queue and the transfer

**Criteria 1, 2, 3, 4, 5, 6, 7 and 8.** Generation is a trigger on
`skill_progress`, for the reason minting a reposição is: the poolside grid is not
the only thing that will ever write a skill, and a rule living in one caller is a
rule the second caller forgets. It proposes when a level completes and
**invalidates** when a skill is corrected back down (19.8), and it is idempotent
under the grid's incremental saves — a partial unique index, not a check in the
trigger, because deduplicating in the trigger would be a race between two saves.

Three decisions worth keeping:

- **`skill.required`, not a `level_required_skill` join table.** The Dev section
  proposes the join table; it would be right if a skill could belong to several
  levels, and `skill.level_id` is already NOT NULL and singular. A join table
  would model a many-to-many that does not exist and would let a skill be
  required for a level it is not part of.
- **Candidates are computed when the queue is read, never stored.** A ranking made
  when the last skill was marked is wrong by the time anybody opens the queue,
  because seats fill. `transfer_candidates()` answers live, and confirmation
  re-checks the seat under a row lock regardless (19.5).
- **`next_level()` reads `sort_order`** — the ticket's named trap. Asserted by
  creating a ladder, dragging a level into the middle of it, and checking the
  proposal follows (19.6).

QA 19.10 is satisfied by construction rather than by care: a reposição guest has
no `enrollment` row, so `class_group_free_seats()` cannot see them.

**Not built:** narrowing confirmation to the *assigned* instructor (per-turma
assignment is slice 1.12's work; any instructor may confirm, and the controller
says so rather than implying a narrowing that does not exist), and the mobile
notification in criterion 4, which needs the notifications module.

`readyNoSeat` filters after its window rather than inside it — POOLSE-29 forbids
that for good reason, and this is the stated exception: "has no candidates" is a
per-row function call rather than a column, so it cannot be a WHERE clause
without evaluating the ranking for every proposal anyway. Bounded at 500 pending
proposals with a note that the fix beyond that is a materialised flag, not a
bigger number.
