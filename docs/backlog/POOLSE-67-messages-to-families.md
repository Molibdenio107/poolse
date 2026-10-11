# POOLSE-67 · Messages to a turma, a level, a site or the whole club

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Communication · **Priority:** High — the pilot needs it on day one · **Depends on** nothing unbuilt; reuses `notifier.ts`, `tenant/assignment.ts` and `student_is_adult_path` · **Roadmap** 7.1

### PO — why this exists

Tomorrow's 18:00 class is cancelled. Today the club phones forty families, or posts in a
WhatsApp group that half of them muted, and afterwards nobody can say who was told. Poolse
already knows who is in the turma and who answers for each child — what is missing is a way to
write to them and a record that it happened.

Email already leaves the system for invitations, vacations and water alerts, so this is a
composer, a recipient query and a record. **It does not wait for phase 3.** Slice 3.0 later adds
preferences and push to the same record, exactly as it will for 4.2's alerts.

**Not in scope:** push, SMS, replies or an inbox, scheduling a send for later, attachments,
per-person preferences or unsubscribe (all phase 3.0), messages to staff, and templates. A
message is written, sent, and recorded — nothing else.

### BA — rules and data

**Who may send.** Owner and Admin, to any audience. An Instructor, **only to a turma they are
the assigned instructor of** — `isMyTurma` from `tenant/assignment.ts`, which already counts a
booking override. That is a question about a row, so it is a repository answer and a 403, never
`requireRole`. Maintenance, students and guardians send nothing.

**Audience — exactly one of four.** One turma, one level (club-wide), one facility, or the whole
club. The students it reaches are those with a **live `active` enrolment** in a live turma that
matches — `waiting` and `ended` are not in a turma, and an archived student is not a student.
A level means the turma's level, not `student.level_id`: a message about Nível 3's pool time
is for the people in Nível 3's turmas.

**Recipients are resolved at send time, one rule.** For each student:

1. every **live guardian** (`guardian_link.archived_at IS NULL`), at `person_email(guardian)`;
2. otherwise the student themselves, at `person_email(student.membership_id)` falling back to
   `student.contact_email`.

That is the same order the invoice payer uses, and for the same reason: the adult path *is*
"no live guardian", and a student nobody has given a guardian yet is better reached at the
address reception typed than not at all. `student_is_adult_path` is not re-derived here — the
absence of the edge already says it.

**Deduplicated on the address**, case-insensitively: a parent of two siblings in one turma gets
one email. **Nobody is silently dropped.** A student who resolves to no address at all is
counted and named on the confirmation before sending ("3 alunos sem contacto: …") and on the
record afterwards.

**The record.** A message row holds the audience, subject, body, who sent it and when. One
recipient row per *student × address* holds the name and address **as they were** — "who was
told" is not recoverable later from a guardian who has since been unlinked. `delivered_at` per
address; **null means recorded and not sent**, and the screens say so in words (no provider
configured, or the provider refused), as the water alert and the chase list do.

**Preview and send are one path with a flag.** The composer asks for a preview — counts,
duplicates folded, the unreachable named — and the confirmation dialog shows it. Send runs the
same resolution again inside the transaction; if the audience changed in between, the record
says what was actually sent, not what was previewed.

**A daily ceiling per club: 20 messages or 2,000 recipient addresses**, whichever is reached
first, counted over the club's calendar day in `APP_TIME_ZONE`. A constant, not a setting. A
send that would cross it is refused as a 409 carrying `{ limit, used, requested }` as fields,
never as prose. *Answered 11-10-2026 — see Open below.*

**History.** Owner and Admin see every message. An Instructor sees messages addressed to their
own turmas (including ones the office sent), so they know the families were told. Archiving a
message hides it from the list; nothing is destroyed, and the recipient rows are never edited
except to stamp delivery.

**Shortcut from Cancelar aula.** After a class is cancelled on the calendar, the confirmation
offers *Avisar as famílias*, opening the composer with the turma chosen and a subject naming
the date. A parceria session has no families and offers nothing.

**Open — answered 11-10-2026:** rate ceiling per tenant per day. **20 messages / 2,000
recipients, a constant**, so a mistake cannot burn the email provider's free tier
(`docs/decisions.md`).

### Dev — schema, API, where it goes

```
message_audience enum: class_group | level | facility | organization

message (
  id, organization_id NOT NULL,
  audience message_audience NOT NULL,
  class_group_id, level_id, facility_id   -- composite FKs; CHECK: exactly the one the audience names
  subject text NOT NULL (1..200), body text NOT NULL (1..10000),
  sent_by_membership_id NOT NULL,         -- composite FK to membership
  sent_at timestamptz NOT NULL DEFAULT now(),
  archived_at, created_at, updated_at
)

message_recipient (
  id, organization_id NOT NULL, message_id NOT NULL,
  student_id NOT NULL,                    -- whom the address was resolved for
  guardian_membership_id,                 -- null = the student themselves
  name text NOT NULL, email citext,       -- snapshots; null email = unreachable
  delivered_at timestamptz,
  CHECK (delivered_at IS NULL OR email IS NOT NULL)
)
```

`message_recipient` has **no DELETE and no `archived_at`** — the `pool_analysis_alert` shape:
the row says somebody was written to, and that either happened or it did not. UPDATE stays for
stamping `delivered_at` after commit. Both tables in `TENANT_TABLES`, child first.

**The ceiling is a BEFORE INSERT trigger on `message`**, under a per-tenant advisory
transaction lock so two sends at once cannot both fit, raising with a machine-readable DETAIL
(`message_quota|limit|used|requested`) that the API turns into a 409 — the
`pool_capacity_respected` shape. Recipient addresses are counted from the recipient rows of
the day's messages, so the trigger fires from a statement that inserts them first or is a
constraint trigger at commit; the build picks whichever keeps one definition.

**API** — `apps/api/src/messages/`:

- `POST /messages` `{ audience, classGroupId? | levelId? | facilityId?, subject, body, commit }`
  — `commit: false` is the preview, `true` writes and then sends.
- `GET /messages` — paginated (`PAGE_SIZE`), scoped by role as above.
- `GET /messages/:id` — the message, its recipients, delivered or not.
- `DELETE /messages/:id` — archives. Owner and Admin.

**Sending happens after the commit**, one email per distinct address, through `sendEmail`, which
never throws; each success stamps `delivered_at` on every row with that address. A slow mail
server can never roll back the record. The email is the club's own words — subject and body
verbatim, plain text escaped into the HTML — framed by one line naming the club, in the
club's locale.

**What will be got wrong:**

- An inner join to `class_group` from a session — not this ticket's problem directly, but the
  Cancelar aula shortcut must not offer itself for a parceria.
- Reading `guardian_link` without `archived_at IS NULL`, which writes to a parent who was
  unlinked last month.
- Deduplicating in TypeScript after counting in SQL, so the preview's count and the record's
  disagree. Resolve once, in one query, used by preview and send.
- An instructor's audience checked only on the composer's dropdown. The POST checks it.

### QA — test scenarios

1. **Given** a turma with five students, two of them siblings with the same guardian, **when** the
   Owner previews a message to it, **then** four addresses are counted and the siblings' guardian
   appears once.
2. **Given** a student with two live guardians, **then** both receive it; **given** one link is
   archived, **then** only the live one does.
3. **Given** an adult-path student with an address and no guardian, **then** the student receives
   it directly.
4. **Given** a student with no guardian and no address, **then** the preview names them as
   unreachable and the send still goes to everyone else, recording them with a null address.
5. **Given** a `waiting` and an `ended` enrolment in the turma, **then** neither student is a
   recipient.
6. **Given** a message to a level, **then** it reaches students actively enrolled in any live
   turma of that level at every site, and nobody whose `student.level_id` alone matches.
7. **Given** an Instructor assigned to Turma A, **when** they POST to Turma A, **then** it is
   sent; **when** they POST to Turma B, a level, a facility or the club, **then** 403.
8. **Given** Maintenance, a student or a guardian, **when** they POST, **then** 403.
9. **Given** an Instructor covering one booking of Turma C, **then** they may message Turma C.
10. **Given** a send, **when** the email provider is `console`, **then** the record exists, every
    `delivered_at` is null, and the message page says it was recorded and not sent.
11. **Given** 20 messages already sent today, **when** a 21st is sent, **then** 409 with
    `limit`, `used`, `requested` as fields; **given** 1,990 addresses today and a turma of 15,
    **then** refused the same way; **given** midnight in Lisbon has passed, **then** it goes.
12. **Given** two sends racing at the ceiling, **then** exactly one is written.
13. **Given** Club B's turma id, **when** Club A's Owner POSTs to it or GETs a Club B message,
    **then** the database refuses or answers nothing — cross-tenant.
14. **Given** a guardian later unlinked, **when** the message page is opened, **then** it still
    shows that guardian's name and address as written to.
15. **Given** an Instructor, **when** they list messages, **then** they see the ones addressed to
    their turmas, including the office's, and nothing else.
16. **Given** an archived message, **then** it leaves the list and its recipient rows are intact.
17. **Given** a cancelled turma session on the calendar, **then** the confirmation offers to message
    the families with the turma chosen; **given** a parceria session, **then** it does not.

### Acceptance criteria

1. Owner and Admin can write to one turma, one level, one facility or the whole club; an
   Instructor only to turmas they are assigned to, enforced at the API.
2. Recipients are resolved at send time — live guardians, else the student — deduplicated on the
   address, from one query shared by preview and send.
3. Students with no address are counted and named before sending and recorded afterwards.
4. The confirmation dialog shows the count before anything is sent.
5. The message and every recipient address are recorded in the transaction; email goes after
   commit; `delivered_at` null is said in words.
6. A daily ceiling of 20 messages / 2,000 addresses per club, enforced in the database and
   refused with its numbers as structure.
7. A history page lists messages (paginated), and each opens to its recipients and delivery
   state; an Instructor sees only their turmas'.
8. A message can be archived and is never destroyed; recipient rows have no DELETE.
9. Cancelar aula offers *Avisar as famílias* for a turma session.
10. pt-PT and en throughout; `docs/features/messages.md` and `docs/data-model.md` updated.
