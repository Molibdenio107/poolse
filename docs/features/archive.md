# Arquivados — undo and the bin

POOLSE-78. A club brings back what it archived by mistake, without asking Poolse.

All three slices are built: the API, the *Arquivados* page and the toast's *Anular*.

## What can come back

Nine kinds, chosen by Rui on 12-10-2026: student, turma, site, tank, space, inventory item,
maintenance task, partner and fee line, then a meet (POOLSE-81) and a lesson feedback
(POOLSE-116). The list is `RESTORABLE` in
`apps/api/src/archive/restorable.ts`.

These are excluded:

- **Staff.** Bringing a person back touches seats, Clerk and invitations, so the answer there
  is to invite them again.
- **Seasons**, which have their own lifecycle.
- **Invoices**, which have no `archived_at` and are corrected by a credit note.

Nothing is ever deleted from here.

## Who

Owner and Admin, the same roles that may archive (`requireCanArchive`). An Admin may restore
what the Owner archived. Everyone else is refused by the API, not only by a hidden menu item.

## What the bin lists

The bin has one row per archive **action**, not one per row. Archiving a site and its tanks
is one row with "+ 3 tanques". Each row says:

- what was archived, in the club's own words, read from the row;
- who archived it, and when;
- how many children went with it;
- whether it is still archived.

It can be filtered by kind, by person and by period (Lisbon dates).

Only actions a person did are listed. An archive done by a job (the trial clock, a closure)
has no person behind it, and is not offered.

## Restoring

`POST /archive/:entryId/restore` is one transaction. It brings back the row and **exactly
the children archived in that same action**, then writes `<kind>.restored` to `audit_log`
naming the entry it undid. A tank archived on its own last month stays archived when its site
comes back.

Restoring a turma also undoes what archiving it did to the people in it:

- each enrolment returns to the status it had (active or waiting);
- the fee lines that closed with those enrolments run again;
- the turma's lessons from today on are generated again. The past is never touched.

A child that has its own history since the archive is left alone and counted as `kept`. That
covers a child restored separately, archived again, or edited. The toast then says how many
did not come back.

**Fee lines and time.** These rules keep a restore from billing what nobody taught:

- A turma's fee lines reopen only on the **day** they were closed. A turma restored later
  keeps them ended and counts them as kept, so the months it was gone are never billed; the
  office adds a line from today.
- A fee line restored after its enrolment ended takes the enrolment's end date, rather than
  coming back open-ended.

**Not offered:** an archive that was the consequence of another change, recorded with a
`reason` in its audit data. Today that is the quota line archived when sócio is switched off;
restoring it alone would bill a non-member.

## The page

*Arquivados* is at `/dashboard/arquivados`, in the user menu beside *O meu perfil*. Only an
Owner or Admin is offered the link.

- The first screen shows the last 90 days. *Último ano* and *Todo o histórico* widen it.
- It also filters by kind and by the person who archived.
- Each row has *Restaurar*. A row that is already back says so in words instead.
- A successful restore toasts "Restaurado: «name»". A refusal toasts its sentence, with its
  figures (`lib/archive-refusal.ts`).
- When the refusal is "its site is still archived", the row also offers *Restaurar primeiro
  «Sede»*.

## Anular

Every archive of the nine kinds raises a toast such as "Turma arquivada", with an *Anular*
button. The toast stays 8 s, as long as a refusal does, because there is a button to decide
on.

- *Anular* sends the archive's audit entry to the same `POST /archive/:id/restore` the bin
  uses, so there is one way back.
- The outcome is a second toast: "Restaurado: …", or the refusal as a sentence.
- Every archive endpoint of the nine kinds returns `archiveEntryId` for this.
- Archiving a turma used to `redirect()` on the server, which raised no toast at all. It now
  returns `redirectTo`, and the client navigates.

## Refusals

Each refusal is a 409 with a code and its figures as fields:

| Code | When | Carries |
|---|---|---|
| `already_restored` | The row is live again, or was archived again by a later action | — |
| `parent_archived` | Its site, tank, space, item or student is still archived | `parentKind`, `parentName`, `parentEntryId` (to offer restoring the parent) |
| `restore_conflict` | A live row has taken its name, NIF, sócio number, or the season's one inscrição/seguro | `entityType`, `field`, `value` |
| `licence_exceeded` | Bringing back a site would exceed `max_facilities` | `current`, `allowed` |
| `pool_full` | A turma's slots no longer fit the tank | `max`, `taken`, `asked` |
| `class_full` | A reopened enrolment no longer fits the turma | `taken`, `capacity` |

An unknown entry, another club's entry, or one a job wrote is a 404.

## Reverting an edit — POOLSE-80

The bin puts back what was archived; *Atividade* puts back what was changed.

**Where.** An *Atividade* tab on a student's page and on a turma's page, Owner and Admin
only (`GET /students/:id/activity`, `GET /class-groups/:id/activity`, paginated). It lists
the record's audit entries newest first: who, when, which fields, from what to what. A
student's tab includes their register marks; a turma's includes the marks in its sessions. Reads
are left out — opening the medical record is an access, logged in `audit_log`, not a change — and
every action has its own sentence (`LABELLED_ACTIONS` in `lib/activity.ts`, tested against both
catalogues); one that has none reads *Outra alteração*.

**What can be reverted** (Rui, 16 October 2026). A student's level; a turma's name, level,
tank, instructor, capacity, lane and colour; a register mark's status. A person's own data —
name, birth date, gender, phone, e-mail, NIF, notes, a mark's note — shows as *also changed*
with no values and no *Reverter*, because its values are never copied into the log. A turma's
fee category is shown and never reverted: money is corrected by its own history. Messages,
alerts and derived figures have no revert.

**How.** `POST /activity/:entryId/revert` calls the entity's own write path
(`setStudentLevelIn`, `updateClassGroupIn`, `saveRegisterIn`), so validation, triggers and the
tank and lane rules all run, and that path writes an ordinary entry carrying `revertOf`. A
revert is therefore revertible, and nothing in the history is edited.

| Code | When | Carries |
|---|---|---|
| `revert_conflict` | The field changed again since that edit | `conflicts`: per field, `before`, `after`, `current` (each a value and its name). Resend with `resolve: { field: 'before' \| 'current' }` |
| `revert_nothing` | The record is already as it was, or every conflict was answered "keep current" | — |
| `revert_not_revertible` | The entry has no `before` (written before POOLSE-80), or is not an edit | — |
| `revert_target_gone` | The old value names a level, tank or person since archived, or a lane the tank no longer has | `field`, `label` |
| `revert_required` | Putting the old value back would leave a turma with no tank or no lane, which the turma form refuses (round 5, 8.2) | `field` |
| `register_credited` | The mark was a *falta justificada* whose make-up credit exists, or was booked or used | — |

The entity's own refusals arrive as they would from its form: a full tank is `pool_full` with
its figures, an occupied lane `laneOccupied`. An entry from another club is a 404.

**There is no "already invoiced" refusal**, which the ticket expected: a mark never reaches an
invoice. The make-up credit is that rule's real counterpart, and the register already enforced
it.
