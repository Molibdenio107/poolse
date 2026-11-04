# POOLSE-152 · A pool or a playing area is created by the office only, and its forms line up

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Bug / Security · **Area:** Facilities / Recintos · **Priority:** High (pre go-live) · **Depends on** [POOLSE-122], [POOLSE-150] · **Unblocks** —

### PO — why this exists
Rui, 04-11-2026: "'Pool' details page – 'General' should have the inputs organized and lined up correctly, they are too spread apart"; "when pressing 'Add a pool' … if any error is submitted, only owner and admin can delete/archive; this button should also only be available for owner/admin to create"; "the same for 'playing areas' on other sports"; "when adding a playing area the input 'Name' is out of place, align all the input fields correctly".

A maintenance login can create a tank it cannot undo. The role is the control; a confirmation dialog on a create was offered and declined (Rui, 04-11-2026: owner/admin only, no confirm) — the archive and the bin remain the undo.

**Not in scope:** a confirmation dialog; changing who may *edit* a pool's readings or maintenance; the tank's other tabs.

### BA — rules
1. `POST /facilities/:id/pools` and `POST /facilities/:id/playing-areas` answer owner and admin only; anybody else is 403. (Rui, 04-11-2026)
2. The *Adicionar piscina* / *Adicionar recinto* buttons render only for owner/admin (`canManage`); the API refusal is the control.
3. The pool's *Geral* form and the playing-area form use the same two-column field grid as the student record (`md:grid-cols-2`, labels above, equal gutters); *Nome* is the first field, full width.
4. No field is added or removed; the import/export mapping is unchanged.

### Dev notes
- `facilities/pools.controller.ts` and `playing-areas` handler: `requireRole('owner','admin')` first line. Add both routes to `security/role-probe.integration.test.ts` as maintenance and instructor.
- Web: `pool-form.tsx`, `playing-area-form.tsx` — fields are `TextField`/`SelectField` already; the fix is the wrapper grid. Reuse the grid class from `student-form.tsx` rather than a new one.
- Trap: `pool_area_ensure` still makes the recinto for a pool — nothing about creation moves to the client.

### QA
1. Given maintenance, when `POST /facilities/:id/pools` is called, then 403 and no row.
2. Given maintenance, when `POST …/playing-areas` is called, then 403.
3. Given a user of another tenant, when either POST names this facility, then 404/403 and no row.
4. Given owner, when the page renders, then both buttons exist; given maintenance, neither.
5. Given the pool *Geral* form at 1280 px, when it renders, then fields sit in two aligned columns, *Nome* full width; at 390 px one column, no squeeze.
6. Both themes.

### Acceptance criteria
- [ ] Creation of pools and playing areas is owner/admin only, server-side, with role-probe lines.
- [ ] Buttons hidden for other roles.
- [ ] Both forms on the shared two-column grid; Nome first.
- [ ] Phone view and both themes checked.
