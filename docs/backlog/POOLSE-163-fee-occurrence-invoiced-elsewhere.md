# POOLSE-163 · An occurrence the club invoiced elsewhere is marked so, and the monthly run leaves it out

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Invoicing · **Priority:** Medium (pilot) · **Depends on** [POOLSE-162] · **Unblocks** —

### PO — why this exists
The second half of Rui's 04-11-2026 ask (see POOLSE-162): a student pays at the desk, the desk's own program issues the fatura, and Poolse must neither bill it again nor show it owed.

**Not in scope:** importing the external program's data; undoing after a Poolse document already charged the occurrence (that is a credit note, existing path).

### BA — rules
1. `student_fee_external_charge` (new, insert-only bar archive): `organization_id`, `student_fee_id`, `occurrence_on`, `reference`, `recorded_by_membership_id`, `archived_at`. One live row per (fee, occurrence) by partial unique index.
2. `invoice_charged_on()` treats a live row as charged, so preview and run skip it — one definition, extended, never a second WHERE.
3. The fee read's `balance` treats it as settled for that occurrence; the student's page lists it as *Faturado externamente n.º …*.
4. Recording one on an occurrence already on a live Poolse document is refused (409 `already_charged`); archive it to reverse.
5. Owner/admin only.

### Dev notes
- `write-migration`; composite FK to `student_fee`; RLS; no DELETE; add to `TENANT_TABLES`.
- `billing/fee-balance.ts` reads it; the monthly run's preview shows a *faturado externamente* count.
- Trap: `student_fee` with null `fee_period_id` is charged once — `occurrence_on` is then `starts_on`.

### QA
1. Given a mensalidade and an external charge for November, when the run previews November, then the line is absent and counted as external.
2. Given the same, when the family reads the fee, then balance excludes November and the line names the reference.
3. Given November already on a Poolse document, when recording, then 409.
4. Archive the row → next preview offers November again.
5. Instructor 403; cross-tenant 404.

### Acceptance criteria
- [ ] Table, index, grants, harness line.
- [ ] `invoice_charged_on` and `balance` honour it.
- [ ] Screen wording in both languages.
