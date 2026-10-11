# POOLSE-70 · Bather incident log and lifeguard on duty

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Safety / Compliance · **Priority:** High once 7b.2 exists · **Depends on** POOLSE-27 / 7b.2 (qualifications with expiry), slice 1.3 (sensitive fields) · **Roadmap** 7.4

### PO — why this exists

A child slips on the deck on Saturday. On Monday the insurer asks what happened, who gave first
aid, who was the lifeguard on duty and whether their licence was valid. Today the answer is a
notebook, if it is anything. This ticket makes it a dated record an insurer will accept.

**This stores the most sensitive thing in the product after medical notes**, and must not be
built as an ordinary table with a notes column.

**Not in scope:** insurer integration, automatic claim submission, a shift-planning tool for all
staff (the roster is lifeguards per open hour, nothing more), and reporting to authorities.

### BA — rules and data

**An incident** records: when, which tank or space, who was involved (a person the club knows, or
a free-text visitor name), what happened, first aid given, whether emergency services were called,
who was the lifeguard on duty, who wrote it, and a link to the facility's apólice (7b.5 holds the
policy; until then a free-text policy reference).

**Written once.** A correction is an **addendum** row with its own author and time; the original
is never edited. Same reasoning as `invoice`: a record that can be edited is not a record.

**Health and injury detail goes through the sensitive-fields path of slice 1.3** — encrypted
before it reaches the database, every read logged with actor and time. The non-health facts
(when, where, who was on duty) are ordinary columns, so lists and the roster check do not need
to decrypt anything.

**The duty roster** says who is lifeguard on duty per tank per open hour. Two **warnings, never
gates** (CLAUDE.md: a warning about a person never gates what a club does with them): the person
on duty has no valid qualification under 7b.2, and an open hour has nobody rostered. An incident
pre-fills the lifeguard from the roster and lets the writer correct it.

**Export one incident as PDF** for the insurer: the record, its addenda, the lifeguard's
qualification state *at the time of the incident*.

**Open:** who may read the health detail — Owner/Admin only, or also the staff member who wrote
it? *Recommend:* Owner/Admin plus the author, every read logged.

### Dev — schema, API, where it goes

New `incident` (insert-only for `poolse_app` bar archiving, by REVOKE as on `invoice`),
`incident_addendum` (insert-only), `lifeguard_duty` (tenant-scoped, a time range per tank,
exclusion so one tank has one lifeguard per instant unless the club wants two — decide in the
build). Health fields go into the existing sensitive store, keyed to the incident, not into
columns on it.

The qualification state "at the time" is derived from 7b.2's dated records, never copied — but
the PDF snapshots it on export.

**What will be got wrong:** a plaintext `description` column that ends up holding the injury
detail anyway (split the form so the sensitive part is visibly separate); an UPDATE grant left
by default privileges; the roster warning becoming a refusal.

### QA — test scenarios

1. **Given** an incident, **when** anyone tries to UPDATE its facts, **then** the grant refuses;
   **when** an addendum is added, **then** both are shown in order.
2. **Given** health detail, **then** the database holds ciphertext and each read writes an access
   log row.
3. **Given** an Instructor who did not write the incident, **when** they read the health detail,
   **then** 403 (if the Open item is answered as recommended).
4. **Given** a rostered lifeguard whose ISN lapsed last week, **then** the roster and the incident
   show a warning, and the incident is still saved.
5. **Given** an open hour with nobody rostered, **then** the roster says so in words.
6. **Given** Club B's incident id, **when** Club A reads it, **then** nothing — cross-tenant.
7. **Given** an incident, **when** exported, **then** the PDF carries the addenda and the
   qualification state on that date.

### Acceptance criteria

1. Incidents are recorded with the fields above and are never edited; corrections are addenda.
2. Health detail is encrypted and every read is logged.
3. A lifeguard roster per tank per open hour exists, with the two warnings, neither a gate.
4. One incident exports as PDF for an insurer.
5. Built after 7b.2; the Open item is answered and logged before the build starts.
