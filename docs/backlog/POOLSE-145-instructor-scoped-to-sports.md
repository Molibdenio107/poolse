# POOLSE-145 · An instructor belongs to the sports the club assigns them, and reads only those sports' students

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Staff / Security · **Priority:** Low (post go-live — **re-confirm before starting**; invisible to a pool-only club) · **Depends on** [POOLSE-143](./POOLSE-143-alunos-and-its-children-per-sport.md), [POOLSE-125](./POOLSE-125-navigation-per-sport.md) · **Unblocks** [POOLSE-146](./POOLSE-146-messages-by-sport-and-qualifications-per-sport.md)

### PO — why this exists

Rui, 01-11-2026: *"It makes sense to be a sport-only instructor, so only admin and owner sees everything, the rest is filtered by sport."* And on how the sport is known: *"explicit. It can be changed later by the owner/admin if they want to change or assign more than one sport."*

This is the one item of the 01-11-2026 brainstorm that is an **authorisation change**, not a navigation one, which is why it is its own ticket and sits after go-live: with only swimming on there is nothing to observe, and a permission sweep across a dozen handlers the week before a launch is risk with no reward. The explicit list was chosen over "the sports of the turmas they teach" because a permission should be something a person set on purpose and can read on a screen — derived, a new instructor with no turma would see nobody and a stand-in would gain a sport for a week.

**Fallback if it slips:** nothing; POOLSE-143's rule 10 (the filter is a convenience) stands and every instructor keeps reading every student, as today.

**Not in scope:** maintenance staff (recintos are facility-level work; no sport scope); owner and admin (always everything); families (`requireActsForStudent` already decides); the app's instructor home (`/app/aulas` reads the reader's own sessions and is scoped already).

### BA — rules

1. `membership.sports` (`text[]`, `sport.id` keys) is the sports a staff member belongs to. Set by owner and admin on the Staff record; empty is refused for an instructor; `{pool}` for every existing membership, by the migration, in the same statement that adds the column. (Rui, 01-11-2026: explicit.)
2. Only a sport the club has on may be assigned (CHECK against `organization.enabled_sports`, the `organization_sports_known` pattern). Switching a sport off for the club (POOLSE-124) with instructors assigned to it is a 409 naming them, like `sport_in_use`.
3. An **instructor** reads students, levels, proposals, lesson feedback and the competition pages only for their sports. `?sport=` is validated against *their* sports: another sport is 403 `sport_not_yours`, never an empty list. A list with no `?sport=` is filtered to their sports.
4. A student in two sports, one of them the instructor's: the record opens, with identity, contacts and attendance as today, and the other sport's cards (level, progression, times, mensalidade line) **absent** — not blank, absent, the way an Admin's salary list leaves the Owner out.
5. A stand-in (POOLSE-53) teaching one lesson of another sport reads that lesson's register and nothing more; their sports are unchanged.
6. Owner and admin read everything; the sport groups are navigation only for them.
7. **Nobody loses access they had the day before.** A pool-only club is unchanged by construction (rule 1's backfill); the migration's test asserts it.
8. The staff list shows a `SportChip` per person (multi-sport only); the record's *Geral* gains the control; the change is audited (`membership.sports` before/after).

**Open:** whether the Owner may assign a sport to a *maintenance* member for future use. Default: the control is shown for instructors only.

### Dev notes

- `write-migration` applies: `membership.sports text[] NOT NULL DEFAULT '{pool}'`, backfilled in the `ADD COLUMN … DEFAULT` itself; CHECK against the club's sports by a BEFORE trigger (array ⊆ `enabled_sports`), because a CHECK cannot read another table. `poolse_app` gets `UPDATE (sports)` with the paired `REVOKE` (POOLSE-73's rule).
- `resolve_memberships` carries `m_sports`; `/me` answers `sports` per membership; `currentTenant().sports` is the reader's list.
- `requireSport(sport)` in `tenant/`: passes owner/admin always, an instructor only for their sports. Applied in `students`, `levels`, `advancement`, `qualifying`, `feedback` handlers — the list is the role-probe's to prove, not a comment's.
- `security/role-probe.integration.test.ts` gains a sport-only instructor (tennis) who calls every sport-scoped route for pool and must get 403 or an absence, never a row.
- The trap: a sport filter inside the SQL *and* a 403 on the param are two implementations of one rule. Decide in `requireSport`, then filter by the decided list.
- POOLSE-125's `?sport=` validation becomes "against the reader's sports", not the club's — update that ticket's Dev note when this one is built.

### QA

1. Given a tennis-only instructor, when `GET /students?sport=pool`, then 403 `sport_not_yours`.
2. Given the same, when `GET /students`, then only tennis students.
3. Given a student in pool and tennis, when the tennis instructor opens the record, then the pool cards are absent from the JSON, not empty.
4. Given the same instructor as stand-in for one pool lesson, then its register opens and `GET /students?sport=pool` is still 403.
5. Given an owner, then everything, both groups.
6. Given `{pool}` only, then every existing instructor has `sports = {pool}` and the role-probe answers as before the migration (rule 7).
7. Given the platform switches tennis off with an instructor assigned, then 409 naming them.
8. Given another tenant's instructor, then nothing of ours (cross-tenant).
9. Both themes for the chip and the control.

### Acceptance criteria

- [x] `membership.sports`, backfilled, CHECK by trigger, audited. (Slice a, 02-11-2026; `/me` answers it as `mySports`, since `sports` was already the club's.)
- [x] `requireSport` on every sport-scoped handler; role-probe extended with a sport-only instructor. (Slices b and c, 02-11-2026; feedback was already per instructor.)
- [x] Record cards absent, not blank, for another sport. (Slice b, 02-11-2026.)
- [x] Rule 7 proved by test (`sport-scope.integration.test.ts`, the pool-only club and the all-sports instructor).
- [x] `docs/features/staff.md`, `docs/features/students.md`, `CLAUDE.md` (beside *A menu entry is shown only to the roles…*).
