# Retention and anonymisation

Roadmap 7b.8 (POOLSE-77), decided by Rui on 16 October 2026. **Not legal advice.**

## What happens

A student **leaves** on the day they are archived, or, if they are not archived, on the end
of their last enrolment once none is active or waiting. A student who never had an enrolment
left on the day they were created. `student_left_on()` is the one definition.

| When | What goes | What stays |
|---|---|---|
| **1 year after leaving** (`retention_health_period()`) | Medical and mobility notes (`student_sensitive`), every consent, the emergency contact, register notes, medical-leave reason and justification reference | The student, their attendance, fees and invoices |
| **5 years after leaving** (`retention_identity_period()`) | Name (becomes *Aluno anonimizado*), birth date, contacts, NIF, notes, gender, photo, sócio number, swim-record notes; the words of their incidents (`incident_detail`, addenda); their names in message snapshots and in the audit trail; their converted lead; a guardian or person record that existed only for them | Attendance, counts, the incident's facts (when, where, emergency, lifeguard), every figure |
| **5 years after archiving** an unconverted lead | The child's and guardian's details on the lead | The lead row and its status |

**Invoices are not touched.** A fatura keeps its own snapshot of the payer's name and NIF for
the ten years tax law asks. Clearing those after ten years is not built.

**A guardian is anonymised only when nothing else needs them**: no login (Clerk owns a login's
name), no role but guardian or student, and no link to a student who is kept. Their role is
archived first, because a live guardian must have a NIF or an e-mail.

## How

`RetentionService` runs at 03:30 (Lisbon) every night, for every club, archived and suspended
included. It calls `apply_retention()` inside each club's context. That function is
`SECURITY DEFINER`, because consents, incident details, message snapshots and the audit trail
are tables the app may not rewrite. It takes no arguments, acts only on
`current_organization_id()` and refuses to run without one, and only touches rows past their
date, so a second run does nothing. Each erasure and anonymisation writes an audit entry with
no actor: `retention.health_erased`, `retention.anonymised`.

**The student's page says it.** A student who has left but is not archived shows when they
left, when their health data goes and when their identity does, or that the health data
already went. A new enrolment before then stops the count, because the student has not left.

## Not covered yet

Staff records, incident reports about visitors or staff, the words of a message body, files in
storage (student photos are not switched on), and invoices past ten years.
