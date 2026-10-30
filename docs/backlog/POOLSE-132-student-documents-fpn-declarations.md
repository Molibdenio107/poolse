# POOLSE-132 · *Documentos* on the student's record: the ID document and the FPN's *Declaração de Consentimento Informado*, printed filled-in and filed signed

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Students / Competition · **Priority:** Medium (pilot) · **Depends on** [POOLSE-131](./POOLSE-131-student-identity-and-address.md), [POOLSE-100](./README.md) (encrypted ID document, staff) · **Unblocks** [POOLSE-134](./POOLSE-134-boletim-de-socio.md)

### PO — why this exists

Rui, 30-10-2026: *"on 'identification documents' simply change the menu name to 'Documents' and add sub menus: 'Declaração FPN', 'Declaração FPN - Menores' (if applicable)."*

Rui supplied the FPN's form the same day: **ANEXO 2 — DECLARAÇÃO DE CONSENTIMENTO INFORMADO**, for the *processo de filiações época 2026-2027*. Every swimmer the club affiliates signs one each season. Clubs fill it by hand from data Poolse holds, or will hold after this ticket.

**Decided (Rui, 30-10-2026):** Poolse prints the form already filled from the record. The swimmer (or, for a minor, a guardian) signs it, and the club files the signed scan here, which shows whether this season's is on file.

**Not in scope:**
- Sending anything to the FPN or to FPNSystem.
- Electronic signatures.
- Other federations.
- The *Boletim de sócio* (POOLSE-134).
- Reproducing the FPN's logos or its partners' strip: the print carries the FPN's title and text, not its branding.

### The form, field by field (Anexo 2, época 2026-2027)

| On the form | Filled from |
|---|---|
| *Eu, abaixo assinado(a)* | The signer's full name: the student, or for a minor the primary guardian (rule 3) |
| *residente em* | `student.address_line` (POOLSE-131) |
| *(localidade)* | `student.locality` |
| *(código-postal)* | `student.postal_code` |
| *Documento de Identificação … nº* | The ID document number (rule 4) |
| *emitido em* | The ID document's issue date, if known (the Cartão de Cidadão carries none; left blank) |
| *válido até* | The ID document's expiry date |
| *época 2026-2027* (twice in the text) | The season chosen in the section's *Época* list (rule 5) |
| *Assinalar em conformidade:* N. Pura · Águas Abertas · Polo-Aquático · N. Artística · N. Adaptada · Masters · Saltos | The student's own *Disciplinas FPN* checkboxes (rule 5) |
| *Associação* | The club's regional association, e.g. **ANNP** (rule 6) |
| *Clube* | The club's FPN abbreviation, e.g. **GCST** (rule 6) |
| *Individual* | Left empty for a club's swimmer |
| *Local/Data* | The club's locality and today, as `Santo Tirso, 30/10/2026` |
| *Assinatura (igual ao doc. de identificação)* | Left blank: signed by hand |

The body text (the consent to processing, the *Política de Privacidade* and the image-and-voice consent) is printed verbatim. Only the season is substituted.

### BA — rules

1. **Rename.** The tab *Documento de identificação* becomes *Documentos*.
2. **Sections.** Inside the tab, `SectionPills` show three sections:
   - **Identificação**: today's ID upload, plus rule 4's fields.
   - **Declaração FPN**: offered for every student.
   - **Declaração FPN – Menores**: offered only for a minor by the club's `age_of_majority`. With no birth date it is shown with *data de nascimento em falta*, never guessed.
3. **Who signs.** The adult form names the student. The minors' form names the primary guardian (`guardian_link.is_primary`) as signer, acting for the student.
4. **The ID document's details, on the student:**
   - type (Cartão de Cidadão / Bilhete de Identidade / Passaporte / Outro), number, issue date and expiry date;
   - the number is **encrypted** as the staff ID document is (POOLSE-100, `sensitive/cipher.ts`), its shape checked by `isValidCcNumber` for a Cartão de Cidadão;
   - it is readable by owner and admin, and every read writes `student.id_document_read` to the audit log;
   - it is erased by `apply_retention()` with the student's identity;
   - an instructor never sees it.
5. **Disciplines and season, kept in Poolse** (Rui, 30-10-2026):
   - **Disciplinas FPN.** Seven checkboxes in the *Declaração FPN* section: N. Pura, Águas Abertas, Polo-Aquático, N. Artística, N. Adaptada, Masters, Saltos. They are saved on the student and are what the print ticks. Nothing is pre-ticked by Poolse.
   - **Época.** A list of the club's seasons (`season`, published and draft, archived left out), with the published one chosen by default. It picks the season the print names and the signed copy is filed under.
   - A student may have a filed copy per season. The section lists each season with its state (*assinada, arquivada a dd-MM-yyyy* / *por arquivar*).
6. **Club settings, under the club's Faturação/Clube settings:**
   - *Associação regional* is a free short text, e.g. ANNP.
   - *Sigla FPN do clube* is a free short text, e.g. GCST.
   - The *Local* on the form is the club's first site's city.
   - An empty setting prints as a blank line.
7. **The signed copy.** *Documento assinado* uploads the signed scan (PDF or photo, 10 MB, purpose `fpn_declaration`) for the published season. The section then reads *Época 2026-2027: assinada, arquivada a dd-MM-yyyy*, else *Por arquivar*. A new copy keeps the old in the history (the POOLSE-105 shape); nothing is deleted.
8. **Missing data never blocks the print.**
   - A field the record lacks prints as the form's own blank line.
   - Before printing, the screen lists what is missing ("sem código postal", "sem nº de documento") with a link to the field.
9. **Competition warning.** A student in a `competitive` level with no signed declaration for the published season gets a warning beside the licence warning. It is a warning, never a gate.

**Open:**
- **The minors' form.** Rui to supply *Declaração FPN – Menores*, which is expected to be the same Anexo with a guardian block. Default until then: the adult text with the guardian as signer and the line *na qualidade de encarregado de educação de {student}*.
- **Next season's text.** The FPN's wording for 2027-2028. Default: the text is held per season in code (`lib/fpn-forms.ts`), and a new season with no text of its own prints the latest with its season substituted. Changing it is a one-line change, flagged at season publication.

### Dev notes

- **Schema (use `write-migration`):**
  - On `student`: `id_document_type` enum, `id_document_number_ciphertext` (CHECK the cipher shape), `id_document_issued_on`, `id_document_valid_until`, and `fpn_disciplines fpn_discipline[]` (enum `pura | open_water | water_polo | artistic | adapted | masters | diving`; English snake_case, the Portuguese is an i18n key). Read it `::text[]`, never bare (the custom-enum-array rule).
  - On `organization`: `fpn_association`, `fpn_club_code`, with a `GRANT UPDATE (col)` and the paired REVOKE plus a SQL test.
  - `student_document` (organization_id, student_id, kind enum `fpn_declaration | fpn_declaration_minor | socio_form`, season_id null, file_id, filed_at, archived_at): insert-only bar archiving.
- **Retention.** A line in `apply_retention()` and in `retention.integration.test.ts` for the ID fields.
- **Print route.** `/dashboard/students/[id]/documentos/fpn?minor=1&season=<id>`, reading the disciplines from the record: its own A4 components (black on white, `@page`, `PrintButton`), the dialog only on `?print=1`, and an entry in `check-layout.mjs`.
- **The form's text.** `lib/fpn-forms.ts` holds it as message keys with `{season}`. The pt-PT text is the FPN's; the `en` value is a faithful translation for a reader, marked as such, and the print is always in Portuguese.
- **Files.** A `stored_file` purpose with its `RULES` line: owner, admin, and the family for their own child. It is not sealed (it holds no health data).
- **Tests.** A `role-probe` line per route, and a family-view check that the ID number never leaves the API for an instructor or a guardian.

### QA

1. **Rename.** Given the record, then the tab reads *Documentos*, and *Identificação* still uploads as before.
2. **Filled print.** Given a student with address, ID document, *Masters* ticked and saved, and the club's ANNP/GCST set, when *Imprimir preenchida* is pressed with *Época 2026-2027* chosen, then the A4 page matches the form above field by field, with *época 2026-2027* in the text and only Masters ticked.
2b. **Seasons.** Given 2026-2027 filed and 2027-2028 chosen, then the section reads *por arquivar* for 2027-2028 and keeps 2026-2027's filed copy listed.
3. **Missing data.** Given no postal code, then the options step lists it, and the print shows the blank line.
4. **Minors only.** For an adult, *Declaração FPN – Menores* is not offered. For a 15-year-old it names the primary guardian as signer.
5. **ID number protected.** An instructor's `GET /students/:id` carries no ID number. An admin's read writes `student.id_document_read`. Retention erases it.
6. **Filed.** Given a signed scan uploaded, then the section reads *Época 2026-2027: assinada, arquivada a …*. A second upload keeps the first in the history.
7. **Competition warning.** Given a competitive student with nothing filed for the season, then the warning shows, and the register is unaffected.
8. **Permissions and cross-tenant.** An instructor uploading gets 403. A guardian reads only their own child's file. Another club's student id gets 404.
9. **UI checks.** Both themes, phone width, pt-PT and en (the print stays Portuguese).

### Acceptance criteria

- [ ] The tab is *Documentos*, with three sections, the minors' one only where it applies.
- [ ] The ID document's details are stored encrypted, audited on read and erased by retention.
- [ ] The club's Associação and Sigla FPN can be set.
- [ ] The FPN disciplines are a checkbox list saved on the student, and the season is picked from the club's seasons.
- [ ] The Anexo 2 prints filled per the table, from them.
- [ ] The signed copy is filed per season, with history, and the competition warning shows.
- [ ] QA 1–9 pass. The docs are updated.
