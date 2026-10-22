# POOLSE-109 · Saúde e consentimentos: pick the emergency contact by name, and attach the atestado

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** UX + Feature · **Area:** Students / Sensitive data · **Priority:** Medium · **Depends on** stored files (`1790157600000_stored-files.sql`), [POOLSE-21](./POOLSE-21-aula-de-reposicao-as-a-credit-object.md) (medical leave credits), the incident-form `PersonPicker`

### PO — why this exists

Rui, 22-10-2026:
- *"'Health and consent' → 'emergency contact': 'someone in the club' should not be a dropdown, but a fill-in name search, similar to what we already have in some places."*
- *"'Medical leave' should enable the import/export functionality if no costs are associated now."*

**What exists.**
- The emergency contact (`sensitive-forms.tsx` ≈ l.301) is a `<select>` of every person in the club, which is unusable at 300 people. A search-as-you-type `PersonPicker` already exists (`facilities/incidents/person-picker.tsx`, also used by lifeguard duties and the guardian block).
- The medical leave form (`medical-leave.tsx` ≈ l.248) shows an *Atestado* upload that is **present, styled and switched off**, with a comment saying file storage was deferred. Storage has since been decided (R2, 12-10-2026), and the `file_purpose` enum has no value for it yet. There is no cost in enabling it beyond storage, which the club already pays for; it is health data, so it goes with encryption, as incident attachments are planned to.

**Not in scope:** reading dates out of the atestado.

### BA — rules

1. **Emergency contact in the club:** replace the `<select>` with the `PersonPicker` (search by name, shows role badge, picks one). *Alguém fora do clube* keeps the free name + phone fields. Clearing the picked person switches back to free fields.
2. **Atestado on a medical leave:** one file per leave, PDF or image, 10 MB. Uploaded by Owner, Admin, reception, or the guardian/adult student from the app. Read by the same, plus the coach of the student's turma (they need to know the leave is real, not its content: the coach sees *"atestado anexado"* and the dates, **not** the file).
3. **Encrypted at rest**, served only through `GET /files/:id` after the sensitive read rule, and every download is audited (actor, student, when).
4. **Retention:** deleted when the leave is archived for more than 24 months, or when the student is erased (GDPR path). Said on the upload control.
5. **Export:** the student's data export (the GDPR one, if built) includes the file; the Excel student export does not.

### Dev notes

- Migration (`write-migration` skill): `medical_certificate` added to `file_purpose`; `medical_leave.document_file_id`; a trigger like `qualification_document_once` is **not** wanted here (a replaced atestado is normal), so keep a history link instead.
- Encryption: the same envelope approach planned for `incident_attachment`. If that isn't built yet, this ticket builds it, since both need it, and POOLSE-70's attachments then reuse it.
- Web: `medical-leave.tsx` drops the `disabled` placeholder and uses `AttachedDocument` with the purpose. The picker swap is form-only.
- Role probe for the upload and read paths, with the coach case (metadata yes, file no).

### QA — scenarios

1. **Given** a club with 200 people, **when** I type "Mar" in the emergency contact, **then** I get matching people with their roles and can pick one; the saved record shows the person's name and phone.
2. **Given** a leave, **when** reception uploads a PDF atestado, **then** it downloads for reception and the owner; the coach sees *atestado anexado* and gets 403 on the file.
3. **Given** a guardian in the app, **then** they can upload for their own child and nobody else's.
4. Downloads are in the audit log.

### Acceptance criteria

1. Emergency contact picked by name search.
2. Atestado attachable per leave, encrypted, audited, role-gated, with a stated retention rule.
3. Both languages, role probe, `docs/security.md` and `features/students.md` updated.

### Open questions

- None.
