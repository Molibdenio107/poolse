# POOLSE-155 · A student reports a lost item from the app, and it lands on Perdidos e achados as a *pedido*

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Mobile app / Maintenance · **Priority:** Low (post go-live) · **Depends on** [POOLSE-154], [POOLSE-90] · **Unblocks** —

### PO — why this exists
Rui, 04-11-2026: "Students can have a field on the mobile app to report they lost something, and then display on this screen as 'request lost something' — how can we do it?"

The answer: a lost item already has a `student_id` and a status; a report is the same row in a third state, written by the family.

**Not in scope:** photos of the item; matching a report to a found item automatically; notifications beyond the existing `student_notified_at` stamp.

### BA — rules
1. `lost_and_found_status` gains `reported`. A reported row has `student_id` set, `found_on` null, a description and the day it was lost (`lost_on`, new, date).
2. Who may report: `family_may_answer()` for the student — a live guardian, or the student from 12 / adult path.
3. The app's *Perfil* (or the child's screen) has *Perdi algo*: description (required, ≤ 300 chars), where (optional), day. One per submit; a family may have several open.
4. Staff see reported rows on Perdidos e achados under a *Pedidos* pill, newest first; *Encontrado* moves it to `found` (sets `found_on`), *Devolvido* to `returned`; the family reads the state on the app.
5. A report is archived, never edited, by the office; the family may withdraw its own (archive) while `reported`.

### Dev notes
- Migration: enum value + `lost_on date` + CHECK (`status = 'reported'` ⇒ `student_id IS NOT NULL AND found_on IS NULL`). RLS unchanged.
- API: `POST /app/lost-items` (family path, `requireActsForStudent`), `GET /app/lost-items` (own); staff transitions on the existing controller. Role-probe lines for both.
- Prompt-injection surface: description is free text shown to staff — render as text, never markdown.
- Trap: the existing `student_notified_at` stamp still means "told it was found"; do not reuse it for the report.

### QA
1. Given a guardian of student A, when they report, then a `reported` row with `student_id = A`.
2. Given a guardian of A, when they report for B, then 404.
3. Given a student aged 10, when they report, then 403; aged 13, 201.
4. Given staff, when *Encontrado* is pressed, then status `found`, `found_on` = today, family's app shows *Encontrado*.
5. Given the family, when withdrawing a `found` item, then 409.
6. Cross-tenant: another club's report never listed.
7. Phone app view in both themes, description as plain text.

### Acceptance criteria
- [ ] `reported` state with its CHECK and `lost_on`.
- [ ] App form for families, gated by `family_may_answer()`.
- [ ] Staff *Pedidos* pill with the two transitions.
- [ ] Role-probe and cross-tenant tests.
