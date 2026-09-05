# Decisions

Product decisions taken in conversation, one line each, newest last. They live here
because the reasoning otherwise survives only in a chat log nobody reads again — and
several of these reverse an earlier decision, which is exactly the kind of thing that gets
quietly re-reversed six months later by somebody reading the older comment.

Schema decisions live in `docs/data-model.md`; standing conventions live in `CLAUDE.md`.
This file is for the calls themselves.

## Round 5 — September 2026

- **2026-09-05** — Round 5 branches from `refinements-round-4`, not `main`. `main` is 86 commits behind and lacks the calendar, partnerships, fees and inventory screens every round-5 ticket edits.
- **2026-09-05** — The dashboard is the home route and the first menu item. Reverses POOLSE-37 and POOLSE-38, which put Instalações first on the argument that the dashboard was about *you*; round 4 moved every account question to "O meu perfil" and put occupancy there instead, so it is now about the operation.
- **2026-09-05** — POOLSE-37's per-role landing chain is deleted rather than kept. There is nothing to resolve once every role lands on the same page, and a caller-less resolver is how the old behaviour returns by accident.
- **2026-09-05** — The periodicity discount is applied on **display only**. Prices stay stored gross, and `student_fee` goes on snapshotting the amount and the discount when a family agrees a price.
- **2026-09-05** — The three capacity rules compose rather than override: an enrolment must fit its turma, the turmas sharing a slot must fit the tank, and `lane_level_capacity` goes on meaning what it meant.
- **2026-09-05** — A tank with no `max_capacity` is unlimited and enforces nothing. Null is "not measured", never zero.
- **2026-09-05** — Partnership bookings count as zero against a tank ceiling, because they carry no headcount. Revisit if partner groups ever gain one.
- **2026-09-05** — The per-session restore endpoint is reinstated, owner/admin only, so ticket 9.6's Undo can work. This reverses backlog round 3, story 5, which removed the operator-facing restore deliberately — reversed on request, not by drift.
- **2026-09-05** — Lost and found records that a student was told with a `student_notified_at` stamp on the item, not a new `student_notification` table. The notifications subsystem is phase 3.0 and is meant to be built once; a second store would be something for it to migrate away from.
