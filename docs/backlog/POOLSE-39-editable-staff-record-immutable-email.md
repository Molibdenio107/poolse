# POOLSE-39 · Editable staff record, immutable email

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Staff · **Priority:** High
**Depends on:** POOLSE-17 (one Person, many roles), POOLSE-01 (invite matrix governs role changes)

### PO — why this exists
A staff record can be created but not corrected. A misspelled name, a changed phone number or a
promotion all currently require a new invitation. Email is the exception: it is the login identity,
so it is read-only in the record and changed only by re-inviting.
**Not in scope:** editing student or encarregado de educação records (that is the Alunos section), and bulk staff editing.

### BA — rules and data
- Editable on a staff record: name parts, phone, photo, notes, and **role assignments**.
- **Email is read-only for everyone, including the Owner.** It is displayed with a short explanation of why, not merely disabled with no reason.
- To move a person to a new address, the Owner uses a **re-invite**: an invitation is issued to the new address and, on acceptance, the login moves to it while the **Person record, history, role assignments and audit trail stay attached**. No second record is created.
- Until the re-invite is accepted, the person keeps their existing login; a pending re-invite is visible on the record and can be cancelled.
- Role changes obey the **POOLSE-01 matrix**: you may only assign a role you could invite. An Admin cannot promote anyone to Owner, on this screen or any other.
- Removing a role never deletes the Person or their other roles (POOLSE-17 AC7).
- A Person who is also a student is editable from either section, and edits land on the same record — name changed in Staff shows immediately in Alunos.
- Every edit is audit-logged with actor, field, old value, new value and timestamp. Role changes especially.
- **Answered (27 Aug):** an Instructor may edit **their own name and phone**, and nothing else. A misspelled name needing an admin is the complaint that produced this ticket. Notes stay Owner/Admin, because they are frequently what a manager writes *about* somebody rather than what that person writes about themselves; another person’s record stays Owner/Admin too. The API enforces all three, not the form.
- **Deferred (27 Aug), explicitly:** no notification on cancellation. `EMAIL_PROVIDER=console` means nothing is delivered anywhere yet, and a "that invitation no longer works" message to an address that may not belong to anyone at the club is worth designing rather than adding as a side effect. Revisit alongside the notifications work.

### Dev — implementation notes
- Email lives with Clerk as the identity; the Person record should not carry an independently editable copy that can drift. Render it from the identity source, read-only.
- The re-invite is an operation on the identity provider plus a Person-preserving link — the risk is creating a fresh Person on acceptance. Write the acceptance path so it resolves to the existing Person by invitation token, never by email match.
- Role assignment changes go through the same server-side guard as invitations (POOLSE-01), not a separate endpoint with its own rules.
- Optimistic UI on simple fields is fine; role changes should confirm from the server before the badge updates, since they can be refused.
- Name parts feed POOLSE-32's display rules — store the parts, never a formatted string.
- Most likely to be got wrong: a re-invite that silently orphans the old Person and starts a new one, losing the audit trail and any turma assignments.

### QA — test scenarios
- **39.1** Given an Admin on a staff record / When they change the name and save / Then the change persists and appears in the list under the POOLSE-32 display rules.
- **39.2** Given any user / When they open a staff record / Then the email field is read-only, with a visible explanation.
- **39.3** Given an Owner / When they attempt to PATCH the email directly against the API / Then the request is rejected.
- **39.4** Given an Owner / When they re-invite a person to a new address and it is accepted / Then the login moves and the same Person keeps their history, roles and turma assignments.
- **39.5** Given a pending re-invite / When the record is viewed / Then the pending state is shown and can be cancelled.
- **39.6** Given a pending re-invite that has not been accepted / When the person signs in / Then their existing login still works.
- **39.7** Given an Admin / When they attempt to assign the Owner role / Then it is refused in the UI and at the API.
- **39.8** Given an Owner removing one role from a Person with two / When they save / Then the Person and the other role survive.
- **39.9** Given a Person who is both staff and an adult student / When their phone is edited in Staff / Then the new number shows in Alunos on the same record.
- **39.10** Given any edit / When it saves / Then an audit entry records actor, field, old and new value.
- **39.11** Given a validation failure on save / When it happens / Then entered values are preserved and the field-level error explains what to fix (same rule as POOLSE-09).
- **39.12** Given pt-PT and en / When the edit form renders / Then all labels, the email explanation and error messages resolve from the translation layer.

### Acceptance criteria

1. A staff record is editable: name, phone, photo, notes and role assignments.
2. **Email is read-only for every role**, shown with a brief explanation of why.
3. The Owner can issue a **re-invite** to a new address; on acceptance the login moves and the existing Person, history, roles and audit trail are preserved — no new record.
4. A pending re-invite is visible on the record and can be cancelled; the existing login keeps working until acceptance.
5. Role changes are governed by the POOLSE-01 invite matrix and enforced server-side.
6. Removing a role never deletes the Person or their other roles.
7. Editing a Person from Staff and from Alunos edits the same record.
8. Every edit is audit-logged with actor, field, old value, new value and timestamp.
9. Validation failures preserve entered values and explain the problem at field level.
