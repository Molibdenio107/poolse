# POOLSE-100 · Staff record: date of birth and Cartão de Cidadão number, for the owner, the admin and the person

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Staff / Personal data · **Priority:** Medium · **Depends on** [POOLSE-17](./POOLSE-17-one-person-many-roles.md) (one Person), [POOLSE-39](./POOLSE-39-editable-staff-record-immutable-email.md) · **Related** [POOLSE-11](./POOLSE-11-student-photo-cartao-de-cidadao-upload.md) (the student's CC)

### PO — why this exists

Rui, 22-10-2026: *"Staff General section should have date of birth and ID (Cartão de Cidadão number), but only visible for owner and admin, and its own user."*

The staff form (`staff/[membershipId]/staff-form.tsx`) has name, email, phone, role and notes. The membership table already has `birth_date` (used for the birthday flag on lists) but the staff form doesn't show or edit it. There is no ID-number column for anyone.

**Not in scope:** the CC scan as a file (Rui, 22-10-2026: the number is enough), NIF, and the payroll side (POOLSE-58).

### BA — rules

1. **Date of birth** on the General section of the staff record. Read and edited by Owner and Admin, and by the person on their own record. Other staff don't see it. Lists keep the birthday flag they already have.
2. **Cartão de Cidadão number** on the same section, as *Documento de identificação*, with a type (Cartão de Cidadão, passaporte, título de residência, outro) and the number. Validated for the CC format (8 digits + check digit + 2 letters + 1 digit) when the type is CC.
3. **Visibility:** Owner and Admin, and the person themself. The API refuses everyone else, and the field is absent from the list endpoint, the export and the staff import.
4. **Purpose and retention shown at the field** (the note in POOLSE-11 applies here too): one line saying why the club records it and that it is deleted when the membership has been archived for more than **12 months** (Rui, 22-10-2026). A tenant setting, defaulting to 12.
5. **Audit:** every read of the ID number by someone other than the person is logged (actor, subject, when), as sensitive reads are elsewhere.

### Dev notes

- Migration (use the `write-migration` skill): `id_document_type` and `id_document_number` on `person`, **encrypted at rest** the way the incident attachments plan to be, with a column-level grant that only the API's sensitive path reads. `birth_date` already exists on membership; decide whether it moves to `person` (one person, many roles) in the same migration. Recommended: move it, since a date of birth belongs to the person.
- API: a `GET/PATCH /staff/:id/identity` endpoint, separate from the staff record, with `requireRole(owner, admin)` or self. Role-probe lines for both.
- Web: a small *Identificação* card on the General section, rendered only when the API answered. The form reuses `TextField` and a `<select>` for the type.

### QA — scenarios

1. **Given** an owner, **when** I open a coach's record, **then** I see and can edit date of birth and the ID document.
2. **Given** a coach, **when** I open a colleague's record, **then** neither field is shown, and the API returns 403 for the identity endpoint.
3. **Given** a coach, **when** I open my own record, **then** I see and can edit both.
4. **Given** a wrong CC check digit, **then** the save is refused with a clear message.
5. **Given** a staff export, **then** neither field is in it.
6. An owner reading the ID number is in the audit log.

### Acceptance criteria

1. Both fields on the General section, visible to Owner, Admin and self, enforced in the API.
2. Encrypted at rest, audited reads, a stated retention rule.
3. Both languages, light and dark, role probe, `docs/features/staff.md` and `security.md` updated.

### Open questions

- None. Number only, 12 months retention after archiving (Rui, 22-10-2026).
