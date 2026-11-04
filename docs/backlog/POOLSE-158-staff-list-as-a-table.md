# POOLSE-158 · Pessoas lists staff as a table: email, one column per sport, one per role, marked not edited

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Staff / Multi-sport · **Priority:** Medium (pilot) · **Depends on** [POOLSE-145], [POOLSE-157] · **Unblocks** —

### PO — why this exists
Rui, 04-11-2026: "'Staff' screen – list of staff should have a table with columns for each thing. Leave email as it is, but sports and roles should be 2 separated columns with a mark (not editable checkbox) saying what the person is. If there are multiple sports on the facility, a dropdown value for each sport should be displayed for the header of the table list."

**Not in scope:** editing roles or sports from the list (the record does that); support memberships (always excluded, POOLSE-79).

### BA — rules
1. Columns: Nome (link to the record), Email, Desportos, Funções, Acesso (last seen, POOLSE-130). Paginated at 10; the current search and filters stay.
2. *Desportos* and *Funções* are read-only marks (a check glyph with the word for screen readers), never a checkbox. In a pool-only club the *Desportos* column is absent.
3. In a multi-sport club the *Desportos* header carries a filter select (all / one sport) that narrows the rows to people holding that sport (`membership.sports`).
4. Below `md` the table is `.table-stack` with `data-label`s — no second render.
5. The invite control is unchanged (POOLSE-129: staff only here).

### Dev notes
- `staff/staff-list.tsx`; the data already carries roles and `sports` from `/staff`. The sport filter is a query param (`?sport=`) read by `readSportFilter`, so the API filters, not the client.
- Marks: a `Badge` tone `muted` with the icon is wrong here — use the check glyph + `sr-only` word; add the pair to `contrast:check` only if a new fill appears (it should not).
- Trap: `support_grant_id IS NULL` on the read (POOLSE-79 QA 5) — the table must not surface support.

### QA
1. Given 12 staff, when the list opens, then 10 rows, the columns above, names as links with `?from=`.
2. Given a pool-only club, then no Desportos column.
3. Given a two-sport club and `?sport=tennis`, then only people with tennis in `sports`.
4. Given a support session is live, then no row for it.
5. Given 390 px, then stacked cards, every cell labelled.
6. Both themes; screen reader reads "Instrutor: sim".

### Acceptance criteria
- [ ] Table with the five columns, marks read-only.
- [ ] Sport column and header filter only when multi-sport; server-side filter.
- [ ] Phone stack, both themes, support excluded.
