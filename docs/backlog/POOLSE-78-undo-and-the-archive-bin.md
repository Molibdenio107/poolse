# POOLSE-78 · Undo, and a bin the owner can restore from

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

> **Built 12-10-2026** on `feat/archive-bin`: the API, *Arquivados* and the toast's *Anular*. Every
> acceptance criterion is met. Not yet seen in a browser.

**Type:** Feature · **Area:** Global / Data integrity · **Priority:** High — the first of three, and the one that makes the other two rare · **Depends on** — (`archived_at` and `audit_log` are already everywhere) · **Brainstormed** 11-10-2026

### PO — why this exists

Staff will archive the wrong thing. Today the row survives (history is soft-deleted, never
destroyed) but nobody in the club can bring it back. The only way back is to ask Rui, who
then needs access to the club's data. That access is POOLSE-79, and it should be the
exception. This ticket gives the club its own undo, so most "can you put this back?"
requests never leave the club.

Three layers, cheapest first:

1. **An Undo button on the toast** after every archive. The pattern already exists for
   cancelling a class occurrence (ticket 9.6); this extends it to every archive action.
2. **Arquivados**: one page listing what was archived, by whom and when, with *Restaurar* on
   each row.
3. **Restoring a cascade as one thing.** Archiving a site and its tanks together, then
   restoring the site, brings back those tanks. It does not bring back a tank somebody
   archived on its own last month.

**Not in scope:** reverting an *edit* (POOLSE-80), operator access (POOLSE-79), and
**permanent deletion**. Hard delete is a GDPR erasure question and belongs to retention and
anonymisation (POOLSE-77), never to a bin button. Invoices have no `archived_at` and are
corrected by a credit note, so they never appear here.

### BA — rules and data

**Who:** Owner and Admin restore, which matches "every remove/delete action is Owner/Admin
only". An Admin may restore something the Owner archived. The bin is hidden from every other
role, and the API refuses them.

**What is restorable** is a registry, not "every table with `archived_at`". **Open — 1**,
see below.

**The bin lists** one row per *archive action*, not per row: what it was (the club's own
name for it, e.g. "Piscina Interior"), its kind, who archived it, when (`formatStamp`), and
how many children came with it ("+ 3 tanques"). It has filters for kind, person and period,
and defaults to the last 90 days. Older entries stay listed and restorable; the default
period only keeps the first screen short.

**Restoring:**

- It clears `archived_at` on the row **and on every child archived in the same action**, in
  one transaction, and writes `<entity>.restored` to `audit_log` naming the archive entry it
  undid.
- **A unique clash is a sentence, not a 500.** Every unique index on these tables is partial
  on `archived_at is null`, so if a new "Piscina 1" exists, restoring the old one violates
  it. The response is 409 `restore_conflict` with the field and the clashing value as
  structure: "Já existe um tanque com o nome «Piscina 1». Mude o nome a um deles para
  restaurar."
- **A parent still archived refuses the child** (`parent_archived`, naming the parent) and
  offers to restore the parent instead. A tank cannot come back into a site that is gone.
- **The licence still applies.** Restoring a site over `max_facilities` is refused by the
  existing trigger, and the refusal says so with its numbers.
- **Restoring twice is a no-op with a message** (`already_restored`). So is restoring a row
  that was un-archived some other way.

**The toast:** "Aluno arquivado · Anular", shown for 8 s (the refusal duration, because it
carries an action). The button calls the same restore endpoint with the archive entry's
id, so there is no second code path. Archives done by a closure, by the trial clock or by
any job without a person behind it never get a toast and are not offered in the bin.

**Answered 12-10-2026 (Rui) — 1: the recommended list.** Student, turma (`class_group`), facility,
pool, space, inventory item, maintenance task, partner and fee line, the things an
Owner/Admin archives from a screen today. Membership (staff) is **excluded** in v1:
bringing a person back touches seats, Clerk and invitations, and "re-invite them" is
already the honest answer. Season is excluded because it has its own lifecycle.

### Dev — schema, API, where it goes

**No new column on every table.** The cascade is recorded in the audit entry the archive
already writes: `data = { "cascade": [{ "entityType": "pool", "id": "…" }, …] }`. Restore
reads that list. A per-table `archive_batch_id` across about 30 tables was considered and
rejected: it is a migration on every soft-deletable table for a fact `audit_log` can
already hold.

**`RESTORABLE` registry** in `apps/api/src/archive/restorable.ts`, one declaration per kind:
table, i18n label key, how to read the display name, its parent (`pool → facility`), and
its cascade children. `assertRestorableIsSound` (same idea as `assertRegistryIsSound`)
refuses a kind whose archive path does not record its cascade.

**API:**

- `GET /archive?kind=&actor=&from=&to=&page=&limit=`: the standard paginated envelope,
  built from `audit_log` entries whose action is `*.archived`, joined to whether the row is
  still archived.
- `POST /archive/:auditEntryId/restore`: one transaction; `recordAudit` inside it.
- Both `requireRole('owner','admin')`.

**Web:** *Arquivados* as a sidebar item for Owner/Admin (placement **answered 12-10-2026
(Rui) — 2**: under the user menu beside *O meu perfil*, not in the main nav). The undo button goes on
`toast.tsx` as an optional `action`, so every archive site gets it by passing the entry id
that `useSavedAction` already receives.

**What will be got wrong:**

- An archive path that cascades in SQL but does not list its children in the audit entry.
  The parent then restores alone and nothing reports it. Hence the registry assertion and a
  test per cascading kind.
- Restoring by "un-archive every child of this parent", which resurrects things archived
  separately.
- Treating a 23505 as a 500.
- A restore that skips `recordAudit`.

### Build plan (12-10-2026)

Found while reading the archive paths, and not in the text above:

- **Action names are not uniform.** `inventory.item.archived` and `maintenance.taskArchived`
  sit beside `student.archived`. So the bin reads each kind's own action from `RESTORABLE`,
  never a `*.archived` pattern. The old names stay, because rewriting history would break
  the audit log.
- **Archiving a turma also ends its enrolments** (`status = 'ended'`, `ended_on = today`) and
  archives its `class_schedule` rows. Restoring a turma must reopen exactly those enrolments
  and those rows, so the cascade records them too. Afterwards `syncSeasonLessons` tops up
  the lessons from today on, never the past.
- **Facility → pool and partner → contacts/groups already cascade in SQL**, but nothing
  lists the children. **Entries written before this ticket** have no `cascade`. Their
  children are found by the same `archived_at`, because `now()` is the transaction's start
  and so is identical across one archive. This fallback is for legacy entries only, and it
  is exact for them.

Three slices, each ending working:

1. **API.** `RESTORABLE` and its assertion. Every v1 archive path writes its `cascade`. Then
   `GET /archive` and `POST /archive/:id/restore` with the four 409s, the role-probe lines,
   and QA 1–10 as integration tests.
2. **Bin.** *Arquivados* under the user menu: list, filters, *Restaurar*, each refusal as a
   sentence. pt-PT and en.
3. **Undo.** An optional `action` on `toast.tsx`, passed through `useSavedAction` from
   every v1 archive site. `docs/features/archive.md` and the `data-model.md` note.

### QA — test scenarios

1. **Given** an Admin archives a student, **when** they press *Anular* on the toast, **then** the student is live and `audit_log` holds both `student.archived` and `student.restored`.
2. **Given** a site archived with 3 tanks, one of which had been archived alone a week earlier, **when** the site is restored, **then** the 2 tanks from the same action return and the third stays archived.
3. **Given** a live tank named "Piscina 1", **when** an archived "Piscina 1" in the same site is restored, **then** 409 `restore_conflict` names the field and the value.
4. **Given** an archived tank whose site is also archived, **when** the tank alone is restored, **then** 409 `parent_archived` names the site.
5. **Given** a club at `max_facilities`, **when** an archived site is restored, **then** it is refused with the licence figures.
6. **Given** an Instructor, **when** they call `GET /archive`, **then** 403; the menu item is absent.
7. **Given** club A's archive entry id, **when** club B's Owner restores it, **then** 404.
8. **Given** an entry already restored, **when** it is restored again, **then** `already_restored` and nothing is written.
9. **Given** an archive done by the trial clock, **then** it is not in the bin.
10. **Given** an invoice, **then** no archive or restore path exists for it.

### Acceptance criteria

1. Every archive action in v1's kinds raises a toast with *Anular* that restores it through the same endpoint as the bin.
2. *Arquivados* lists archive actions with what, who, when and child count, filterable, Owner/Admin only, refused server-side for everyone else.
3. Restoring brings back exactly the rows archived in that action, in one transaction, and records `*.restored`.
4. Unique clash, archived parent, licence ceiling and double restore are each a 409 with a code and its figures as structure, rendered as a sentence.
5. `RESTORABLE` is the one list; a cascading kind that does not record its children fails a test.
6. No hard delete anywhere on this screen.
7. pt-PT and en; `docs/features/archive.md` created, `docs/data-model.md` notes the `cascade` convention in `audit_log.data`.
