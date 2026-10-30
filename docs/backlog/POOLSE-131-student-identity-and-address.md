# POOLSE-131 · A student's record holds their address and identity: morada, filiação, nacionalidade and the rest

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Students · **Priority:** High (pre go-live) · **Unblocks** [POOLSE-132](./POOLSE-132-student-documents-fpn-declarations.md), [POOLSE-134](./POOLSE-134-boletim-de-socio.md)

### PO — why this exists

Rui, 30-10-2026: *"on general details for student, add inputs for the address (morada, localidade, cod postal) … add input fields non mandatory: 'filho de', 'e de', 'estado civil', 'profession', 'telephone', 'naturalidade', 'nacionalidade', 'habilitações', nif, 'numero de utente', with a dropdown for nationality."*

The FPN declarations and the *Boletim de sócio* (POOLSE-132, 134) ask for exactly these facts. A club types them once, on the record, and every form fills from there.

**Decided (Rui, 30-10-2026):** about the **student only**, not the guardians. For a child, *profissão* and *estado civil* are simply left empty.

**Not in scope:**
- The same fields on guardians.
- Validating a *nº de utente* against the SNS.
- Printing anything (POOLSE-132, 134).

### BA — rules

1. **All optional.** Nothing here gates enrolment, the register or invoicing (the warning-never-gates rule).
2. **The fields, under a *Identificação e morada* group on the General tab's student form:**
   - **Address:** *Morada*, *Localidade*, *Código postal* (`NNNN-NNN`, refused otherwise with a field error).
   - **Filiação:** *Filho/a de* and *e de*, free text.
   - **Estado civil:** select — solteiro/a, casado/a, união de facto, divorciado/a, viúvo/a.
   - **Profissão** and **Habilitações literárias:** free text.
   - **Naturalidade:** free text, the place of birth.
   - **Nacionalidade:** a searchable dropdown of countries, Portugal first. Country names come from `Intl.DisplayNames` in the reader's language; ISO 3166 alpha-2 is stored.
   - **Nº de utente (SNS):** nine digits.
3. **Not new fields:**
   - *Telefone* is the existing `contact_phone`.
   - *NIF* is the existing `tax_number`, still checksum-validated by `isValidNif`.
4. **Sensitivity.**
   - **Identity:** every field here is identity. It is `withheld` in the change log (named, never valued), cleared by `apply_retention()` 5 years after leaving, and cleared on anonymisation.
   - **Nº de utente:** this is health-adjacent, so it is also hidden from an instructor (shown as *registado* / *não registado*) and read only by owner and admin.
5. **Import and export.** The student import and export carry the new columns, with headers from `students.field.*`. The round-trip test stays green.

**Open:** whether *habilitações* should be a fixed list (básico, secundário, licenciatura, …). Default: free text.

### Dev notes

- **Schema.** Columns on `student`: `address_line`, `locality`, `postal_code` (CHECK `^\d{4}-\d{3}$`), `parent_one_name`, `parent_two_name`, `marital_status` (enum `marital_status`, English snake_case values), `profession`, `education`, `birthplace`, `nationality` (CHECK `^[A-Z]{2}$`), `sns_number` (CHECK `^\d{9}$`).
- **Grants.** `poolse_app` needs `GRANT UPDATE` on the new columns, with the REVOKE pairing if `student` is column-granted. Check before writing; use `write-migration`.
- **Rules and API.** `parseStudent` reads them. `STUDENT_CHANGE` gets them as `withheld`. `apply_retention()` and the anonymisation trigger clear them, each with a line in `retention.integration.test.ts`.
- **Nationality.** The dropdown is a new shared `CountrySelect` (`components/country-select.tsx`) built on `Intl.DisplayNames`, so no list of 250 names is translated by hand.
- **Phone layout.** The grid on a phone takes `basis-64` columns; one line in `phone-tier2.spec.ts` for the General tab with the group filled.

### QA

1. **Saved and shown again.** Given an admin, when every field is filled and saved, then a reload shows them all, nationality reading *Portugal* in pt-PT and *Portugal* in en (and *Brasil* / *Brazil*).
2. **Postal code refused.** Given postal code `4000`, then a field error and nothing saved.
3. **Nº de utente hidden from an instructor.** Given an instructor, then the field reads *registado*, and `GET /students/:id` carries no value.
4. **Change log.** Given an edit to *filho de*, then the change log names the field without its value.
5. **Retention.** Given a student who left 5 years and a day ago, when `apply_retention()` runs, then every field is null.
6. **Round trip.** Given an export, when it is imported back, then nothing changes.
7. **Cross-tenant and permission denials.** Another club's student id gets 404; a guardian PATCHing their child's fields gets 403.
8. **UI checks.** Both themes, phone width, pt-PT and en.

### Acceptance criteria

- [ ] The eleven new fields on `student`, optional, with their CHECKs, retention and anonymisation.
- [ ] The General tab's form carries them, with the country dropdown.
- [ ] The import and export carry them, and the round trip is green.
- [ ] *Nº de utente* is owner/admin only.
- [ ] QA 1–8 pass. `docs/data-model.md` and `docs/features/students.md` are updated.
