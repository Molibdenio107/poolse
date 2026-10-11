# POOLSE-69 · Online pre-registration and trial lessons

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Students / Public · **Priority:** Medium — September is when it pays · **Depends on** the waiting list (built), POOLSE-17 duplicate check (built) · **Roadmap** 7.3

### PO — why this exists

Every September a club takes hundreds of sign-ups by phone, by email and on paper at the desk,
and reception retypes each one. A parent should be able to fill in a form from the club's own
page, and staff should turn it into a waiting-list entry, an *aula experimental* or an
enrolment without typing it again.

**This is the first public write path after signup**, and that is the part to get right.

**Not in scope:** online payment, the parent picking a specific session, a parent account or
login, and embedding the form in a third-party site beyond a link.

### BA — rules and data

**A public, no-login form per club** at `/[locale]/[club-slug]/inscricao`, both locales. It
creates a **lead**: the swimmer (child or adult, name, birth date), the guardian's contact for a
minor, preferred level and days, a free-text note, and the consent text the club shows — the
consent recorded with its timestamp and the text's version.

**Staff work a queue of leads.** Owner and Admin (and anyone they already let manage enrolments)
can, in one action each:

- add to the existing **waiting list** of a chosen turma;
- book an **aula experimental** into a session that has room — capacity rules compose as
  everywhere else, and a full session refuses with its numbers;
- **convert to an enrolment**, creating the student and guardian through the same path the
  student form uses, including the duplicate check on NIF-else-email (POOLSE-17) and the adult
  path decided by the server;
- **dismiss**, with a reason.

**Nothing in the response tells the public anything about the tenant** — no turma names, no
counts, no "this email already exists". The form says "recebemos o seu pedido" and nothing else.

**Abuse:** rate-limited per origin and per club, a honeypot field, and a server-side check that
the form was rendered recently. A club slug that does not exist answers like one that does.

**Unconverted leads are soft-deleted after a retention window.** **Open:** the window —
*recommend 12 months*, so last September's unconverted leads are still there to call this
September, and gone the year after.

**Open:** does a club need a public slug before 7b.1/7b.4's public pages exist, or does this
ticket introduce `organization.public_slug`? *Recommend:* this ticket introduces it, unique,
chosen by the Owner, and 7b's pages reuse it.

### Dev — schema, API, where it goes

New `lead` table (tenant-scoped, RLS, composite FKs to the facility and level chosen, status
`new | waitlisted | trial_booked | converted | dismissed`, `consent_text_version`,
`consented_at`, `archived_at`). The public endpoint resolves the slug to a tenant **without**
exposing whether it exists, runs inside that tenant's `withOrg`, and lives outside the Clerk
guard — the only tenant write that does. Add it to the public-routes list deliberately, with a
comment.

Conversion **calls the existing student and enrolment repositories** — never a second insert
path, or the duplicate guard and the adult-path consent check silently stop applying.

**What will be got wrong:** a 404 for an unknown slug (it enumerates clubs); trusting a
client-sent level id from another tenant (composite FK refuses it — test it); a trial lesson that
bypasses `class_group.capacity`; the retention job deleting rows instead of archiving them.

### QA — test scenarios

1. **Given** a valid slug, **when** a parent submits, **then** a lead exists with consent and time,
   and the response carries no tenant data.
2. **Given** an unknown slug, **then** the response is indistinguishable from a known one.
3. **Given** the honeypot filled, or 20 submits in a minute from one origin, **then** nothing is
   written and the response is the same.
4. **Given** a lead whose NIF matches an existing student, **when** converted, **then** it attaches
   to that person rather than creating a second.
5. **Given** a full session, **when** an aula experimental is booked into it, **then** 409 with the
   numbers.
6. **Given** an Instructor or a guardian, **when** they convert or dismiss a lead, **then** 403.
7. **Given** Club B's lead id, **when** Club A converts it, **then** refused — cross-tenant.
8. **Given** a lead older than the retention window and unconverted, **when** the job runs,
   **then** it is archived, not deleted.

### Acceptance criteria

1. A public form per club, in both locales, creates a lead with recorded consent.
2. The public path is rate-limited, honeypotted and leaks nothing about the tenant.
3. Staff can waitlist, book a trial lesson, convert or dismiss a lead in one action each.
4. Conversion reuses the student and enrolment write paths, including the duplicate check.
5. Unconverted leads are archived after the agreed window.
6. Both Open items are answered and logged before the build starts.
