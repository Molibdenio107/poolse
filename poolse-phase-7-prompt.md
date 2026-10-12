# Poolse — Phase 7: write the tickets, then build POOLSE-67

Read `CLAUDE.md`, `docs/backlog/CONVENTIONS.md` and the **Phase 7** section of `docs/roadmap.md`
(added 10-10-2026). Do not load the rest of the backlog folder.

Phase 7 holds four gaps a pilot club meets in its first month. This session has two parts.

## Part 1 — four ticket files (docs only, no code)

Create `docs/backlog/POOLSE-67…70`, each in the house format: **PO** (why it exists, what is
explicitly out of scope), **BA** (rules, data, edge cases, with real `**Open:**` markers), **Dev**
(schema/migration impact, API surface, where the logic goes, the thing most likely to be got
wrong), **QA** (numbered Given/When/Then, including permission-denial and cross-tenant cases),
then numbered **Acceptance criteria**. Add all four to the index in `docs/backlog/README.md` and
update the ticket count.

### POOLSE-67 · Messages to a turma, a level or the whole club
- Owner/Admin compose; an Instructor may message only the turmas they are assigned to (reuse
  `tenant/assignment.ts`; a row permission, not `requireRole`).
- Audience: one turma, one level, one facility, or everyone. Recipients resolved **at send time**:
  a minor → their live guardians; the adult path → the student (`student_is_adult_path`);
  deduplicated on address, so a parent of two siblings gets one email. People with no address are
  counted and named on the confirmation, never silently dropped.
- Sent by transactional email through `apps/api/src/notifications/notifier.ts`. The message row
  is written in the transaction; sending happens **after commit** (the 4.2 alert pattern).
  Addresses snapshotted on the row; `delivered_at` per recipient, null = recorded and not sent,
  said in words.
- History page: who sent what, to whom, when. Soft-deleted, never destroyed.
- Optional shortcut: offer "message the families" from the cancel-class confirmation.
- Out of scope: push, SMS, replies/inbox, scheduling, attachments, per-person preferences (all
  phase 3.0).
- **Open:** rate ceiling per tenant per day (recommend a constant, e.g. 20 messages / 2,000
  recipients, so a mistake cannot burn the email provider's free tier).

### POOLSE-68 · Free swim, entry passes and reception check-in
- Products on the facility: single entry, pack of N entries, time-boxed pass (monthly etc.).
  Prices follow `docs/financials.md` (gross, `vat_rate`, `vat_exempt`, provenance); a sale is a
  document line through 2.2's invoicing, never a parallel money table.
- A pass belongs to a Person (may be someone who is not a student — reuse `membership`, no new
  person table). Check-in decrements a pack or validates a pass; expiry derived in SQL.
- Live occupancy per tank against `pool.max_capacity` (capacity rules compose — free swim and
  concurrent turmas share the tank). Refusals carry their numbers as structure.
- Out of scope: turnstile hardware, QR card printing, online sale of passes.
- **Open:** may a free-swim slot be defined as a booking on the lane grid, or is it whole-tank
  only in v1? (Recommend: a booking with subject type `free_swim`, so the grid stays the one
  picture of the pool.)

### POOLSE-69 · Online pre-registration and trial lessons
- A public, no-login form per club (`/[club-slug]/inscricao`, both locales) that creates a
  pending lead: child or adult, guardian contact, preferred level/days, consent text.
- Staff see leads in a queue and either add them to the existing waiting list, book an
  *aula experimental* into a session with room, or convert to an enrolment in one action
  (duplicate check on NIF-else-email, as POOLSE-17).
- First public write path after signup: rate-limited, honeypot plus a server-side check, no
  tenant data in the response, RGPD consent recorded with timestamp. Leads not converted are
  soft-deleted after a retention window.
- Out of scope: online payment, picking a specific session from the public page.
- **Open:** retention window for unconverted leads (recommend 12 months).

### POOLSE-70 · Bather incident log and lifeguard on duty
- An incident: when, which tank/space, who (a Person, or a free-text visitor), what happened,
  first aid given, who was the lifeguard on duty, whether emergency services were called, link to
  the facility's apólice. Written once; a correction is an addendum row (audit-grade record).
- Health and injury detail goes through the sensitive-fields path of slice 1.3 — encrypted
  before the database, every read logged. Not an ordinary notes column.
- Duty roster: who is lifeguard on duty per open hour, per tank; a warning (never a gate, per
  CLAUDE.md) when the person on duty has no valid certification under POOLSE-27, and when an
  open hour has nobody rostered.
- Export of one incident as PDF for the insurer.
- Out of scope: insurer integration, automatic claim submission.
- **Open:** who may read incident health detail — Owner/Admin only, or also the reporting staff
  member? (Recommend Owner/Admin plus the author.)

## Part 2 — build POOLSE-67

1. **Before any code**, show me POOLSE-67's acceptance criteria and the answer you propose for its
   `**Open:**` item, and wait for my OK.
2. Then build it as one vertical slice: migration (use the `write-migration` rules: tenant key,
   composite FKs, RLS, table in `TENANT_TABLES`) → API with integration tests (including denial
   and cross-tenant) → UI (`DetailPage`/`PageShell`, controlled fields, `useSavedAction`,
   `Dialog` for the send confirmation) → QA pass.
3. Do not start 68–70.

## Housekeeping (every prompt)
- Docs follow behaviour in the same commit: `docs/data-model.md` for schema,
  `docs/features/messages.md` (new) for behaviour.
- New conventions or shared components earn one line in `CLAUDE.md`.
- Refactors are proposed in one line in the session summary and never done inline.
- Append to `docs/decisions.md`: "10-10-2026 — Phase 7 added (POOLSE-67…70): club messaging by
  email ahead of phase 3, free swim and passes, public pre-registration, incident log and duty
  roster", plus a line for every Open item I answer.
- i18n pt-PT (European, not Brazilian) + en as written; dates via `formatDate`; light/dark.
- Close with two lines: what now works, and the single next slice.
