# Arquivados — undo and the bin

POOLSE-78. A club brings back what it archived by mistake, without asking Poolse.

**Built so far:** the API (slice 1) and the *Arquivados* page (slice 2). The toast's *Anular*
(slice 3) is not built yet.

## What can come back

Nine kinds, chosen by Rui on 12-10-2026: student, turma, site, tank, space, inventory item,
maintenance task, partner and fee line. The list is `RESTORABLE` in
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
covers a child restored separately, archived again, or edited.

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
