# POOLSE-149 · A staff record holds the person's details, their ID card, their contract and dropped certificates

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Staff / Personal data · **Priority:** Medium (pilot) · **Depends on** [POOLSE-100](./POOLSE-100-staff-record-birth-date-and-id-number.md), [POOLSE-27](./POOLSE-27-certification-expiry-with-amber-window.md) (7b.2), [POOLSE-97](./POOLSE-97-staff-files-salaries-and-certificates.md), [POOLSE-105](./POOLSE-105-partner-signed-contract-upload.md), [POOLSE-109](./POOLSE-109-emergency-contact-picker-and-atestado-upload.md), [POOLSE-137](./POOLSE-137-ai-readers-per-club.md)

### PO — why this exists

Rui, 02-11-2026: *"We need to add details to the 'staff' general page, like address, id number, similar to what we use for each student. Then add an 'identification' tab to see and upload the id card of that employee. Add another tab 'Contract' where the employee contract can be uploaded and exported (drag and drop on the screen similar to what we already have, pdf, docx might do). This can be useful information to the salary of each employee and vacation days etc, but do not relate that information for now, keep it just informative. The 'qualifications' also need a drag and drop import functionality to add qualifications and then reflected on the qualifications menu."*

A club keeps a staff member's file in a drawer today: the address for the contract, the NISS for Segurança Social, a copy of the Cartão de Cidadão, the signed contract, the certificates. The student record already holds the student's equivalent (POOLSE-131–134). This brings the staff record level with it, using the same parts: the identity group's fields, the sealed file (POOLSE-109), the versioned contract (POOLSE-105) and the ID reader (POOLSE-137).

**This reverses Rui's 22-10-2026 call in POOLSE-100** that "the number is enough" and the CC scan is not stored. The scan is now stored, sealed.

**Four slices, one evening each, in order:** A (Geral details), B (Identificação), C (Contrato), D (certificate drop).

**Not in scope:** linking the contract to salaries or vacation entitlement (Rui: "keep it just informative"); a contract template or e-signature; a spreadsheet import of the team's qualifications (a certificate drop per person was chosen); a qualification type per sport (POOLSE-146); an ID-card photo for a person with no record at the club.

### BA — rules

**Slice A — Geral details**

1. The staff record's *Geral* gains: morada, localidade, código postal, NIF, NISS, nacionalidade, naturalidade, and an emergency contact as three free-text fields (nome, telefone, relação). All optional. (Rui, 02-11-2026.)
2. NIF is the existing `membership.tax_number`: one person, one NIF, shared with a guardian's record. It is checksum-validated by `isValidNif`. An empty box clears it, and an unparseable value is refused.
3. NISS is eleven digits and checksum-validated (`isValidNiss` in `@poolse/rules`, the Segurança Social check digit).
4. NIF, NISS, address and emergency contact are read by owner, admin and the person; other staff get them absent from the response. In the change log they are *withheld* (named, never valued).
5. A person with a login edits their own address, nationality, birthplace and emergency contact on their own record. NIF and NISS are the club's, edited by owner and admin.

**Slice B — Identificação**

6. A new *Identificação* tab holds the POOLSE-100 card (birth date, document type, number), moved out of *Geral*, plus the document's photo: front and back, an image or a PDF.
7. The photo is a **sealed** file (purpose `staff_id_document`, in `SEALED_PURPOSES` and the `stored_file_sealed` CHECK), read through `openFile`, and every read by anybody but the person writes `membership.id_document_read`.
8. Owner, admin and the person may upload, view and replace it. Nobody else sees the tab.
9. Retention: `apply_retention()` destroys the wrapped key (crypto-shredding) at the same time it erases the number, `organization.id_document_retention_months` after the person leaves.
10. With the `id_document` reader on (switch + club tick + key), an uploaded photo pre-fills type, number and validity on the card. Nothing is saved until somebody presses *Guardar*. With it off, the photo is filed and the fields are typed.

**Slice C — Contrato**

11. A new *Contrato* tab holds one current contract: PDF or Word (`acceptFor('staff_contract')`), dropped or picked, downloaded through `DocumentLink`. Replacing it keeps the earlier one as a version, listed with its date and who filed it.
12. Beside the file, informative facts: tipo (`sem_termo | termo_certo | termo_incerto | prestacao_servicos | estagio`), data de início, data de fim (required for *termo certo*, refused for *sem termo*). Nothing reads them but this tab. (Rui, 02-11-2026.)
13. Read and write: owner and admin; the person reads their own. **An Admin never sees the Owner's contract** — absent, not blank, by the pay rule's predicate (`visibleToViewer` in `compensation.repository.ts`). An Admin may not write it either.
14. The contract file is an ordinary file (not sealed) with read rule `staff_contract` = owner, admin, the person, minus the Owner's for an Admin.

**Slice D — Certificate drop**

15. On a person's *Qualificações* tab, a drop zone takes a certificate (PDF or image). Dropping one opens the new-qualification form with the file attached.
16. With the new `qualification_certificate` reader on (switch + club tick + key), the form is pre-filled: the type (matched against the club's live types by name, else left empty, never created), issuing body, issued on and expires on. A person confirms. With it off, the same form opens empty around the file.
17. Saving creates an ordinary `qualification` row with `document_file_id`, so it appears on Staff → Qualificações, the dashboard card and the alert job exactly as a typed one does.

**Open:** whether the person may upload their own ID card and certificates from *O meu perfil*. Default: yes for the ID card (rule 8), no for certificates (recording a qualification stays owner and admin, as in POOLSE-27).

### Dev notes

- `write-migration` applies to slices A–C. Membership columns: `address_line`, `locality`, `postal_code`, `niss`, `nationality`, `birthplace`, `emergency_name`, `emergency_phone`, `emergency_relation`. Each needs `GRANT UPDATE (col)` paired with the table-wide `REVOKE` (POOLSE-73's rule). They are cleared on anonymisation, so add them to the retention path and to `retention.integration.test.ts`.
- Slice A reuses the shape of `students/identity.ts` (one group, one `SELECT` builder, one parser). It does not import the student's file: the field lists differ (no filiação, no SNS), and sharing would couple two lists that will drift on purpose.
- Slice B: `membership.id_document_front_file_id` / `_back_file_id`, attached by `POST /staff/:id/identity/photo/:side` (raw bytes, one step), which re-checks the purpose in its transaction. The `id-document-agent.ts` reader is reused as is, and its metering reader stays `id_document`.
- Slice C: `staff_contract` (current: kind, starts_on, ends_on, document_file_id) and `staff_contract_version` (insert-only bar closing), the `partner_contract_version` shape. `GET/PUT /staff/:id/contract`; the Owner predicate goes in SQL, never in the controller.
- Slice D: a new value `qualification_certificate` in `AI_READERS`, the `ai_reader` enum and `PLATFORM_SWITCHES`, and `lib/qualification-certificate-agent.ts` behind `guardAiCall` + `metered`. The prompt names concepts, never one issuer's layout.
- **The trap:** a tab whose visibility is decided by a `.catch(() => null)` vanishes on a 500. Use `outcome()`: `refused` hides, `failed` shows `PageError`.
- Every new route gets `requireRole` in its first line and a line in `role-probe.integration.test.ts`.

### QA

1. Given an Admin, when they save a staff member's address, NIF and NISS, then they are stored, and the Atividade entry names the fields without values.
2. Given an invalid NISS or NIF, then 400 with the field's own sentence under it, and nothing else typed is lost.
3. Given an instructor reading another staff member's record, then NIF, NISS, address and emergency contact are absent from the JSON.
4. Given an Admin uploading a CC front and back, then both are sealed (the bucket holds ciphertext) and each view writes `membership.id_document_read`.
5. Given the person themselves viewing their own ID photo, then no audit read is written.
6. Given a staff member who left more than 12 months ago, when `apply_retention()` runs, then the number is gone and both photos' keys are destroyed.
7. Given the `id_document` reader off, when a photo is uploaded, then it is filed and the card says the fields must be typed (`off`).
8. Given an Admin, when they open the Owner's *Contrato*, then the tab is absent and `GET /staff/:ownerId/contract` is 404. A `PUT` is refused the same way.
9. Given a contract replaced twice, then the tab shows the current one and two earlier versions, each downloadable.
10. Given *termo certo* with no end date, then 400 under *Data de fim*.
11. Given a certificate dropped with the reader on, then the form is pre-filled and nothing is saved until *Guardar*. After saving, the record shows on Staff → Qualificações with its certificate.
12. Given the reader off, then the same drop opens the empty form with the file attached.
13. Given a guardian or a student calling every new route, then 403 (role probe).
14. Given another tenant's Admin, then every new route is a 404 for our staff (cross-tenant).
15. Both themes for the new tabs, the drop zones and the facts; on a phone (tier 3) the tabs are readable.

### Acceptance criteria

- [x] A: the Geral fields stored, validated, withheld in the log, absent for other staff, cleared on anonymisation.
- [x] B: the Identificação tab, sealed photos, audited reads, retention shreds, reader pre-fill.
- [ ] C: the Contrato tab, versions, informative facts, the Owner hidden from an Admin.
- [ ] D: the certificate drop, the new reader behind its switch, records indistinguishable from typed ones.
- [ ] Role probe extended; `TENANT_TABLES` updated; i18n pt-PT + en; `docs/features/staff.md`, `docs/data-model.md`, `docs/decisions.md`, `CLAUDE.md` (the POOLSE-100 paragraph).
