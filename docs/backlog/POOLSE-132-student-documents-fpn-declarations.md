# POOLSE-132 · *Documentos* on the student's record: the ID document and the FPN declarations, printed filled-in and filed signed

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Students / Competition · **Priority:** Medium (pilot) · **Depends on** [POOLSE-131](./POOLSE-131-student-identity-and-address.md) · Re-confirm the forms before starting

### PO — why this exists

Rui, 30-10-2026: *"on 'identification documents' simply change the menu name to 'Documents' and add sub menus: 'Declaração FPN', 'Declaração FPN - Menores' (if applicable)."*

A swimmer's federation licence needs the FPN's declaration, signed by the swimmer, or for a minor by a guardian. Clubs fill these by hand from the same data Poolse already holds.

**Decided (Rui, 30-10-2026):** Poolse prints the form already filled from the record. The family signs it, and the club files the signed scan here, which shows whether each one is on file.

**Not in scope:**
- Sending anything to the FPN.
- Electronic signatures.
- Other federations.
- The *Boletim de sócio* (POOLSE-134).

### BA — rules

1. **Rename.** The tab *Documento de identificação* becomes *Documentos*.
2. **Sections.** Inside the tab, `SectionPills` show three sections:
   - **Identificação:** today's ID upload, unchanged.
   - **Declaração FPN:** offered for every student.
   - **Declaração FPN – Menores:** offered only when the student is a minor by the club's `age_of_majority`. With no birth date it is shown with *data de nascimento em falta*, never guessed.
3. **Each declaration section has two parts:**
   - ***Imprimir preenchida*** opens a print route (A4, black on white, `PrintButton`) filled from the record: name, birth date, NIF, nationality, address, filiação, licence number, the club. A minor's form adds the guardian, taken from the primary `guardian_link`.
   - ***Documento assinado*** uploads the signed scan (PDF or photo, 10 MB, `stored_file` purpose `fpn_declaration`), with its date. The section then says *Assinada, arquivada a dd-MM-yyyy*, else *Por arquivar*.
4. **Versions.** A new signed copy replaces the current one and keeps the old in the history (the POOLSE-105 shape). Nothing is deleted.
5. **Missing data never blocks the print.** A field the record lacks prints as a blank line to write in by hand, and the screen lists what is missing first.
6. **Competition warning.** A student in a `competitive` level with no signed declaration gets a warning on the record (warning, never a gate), beside the licence warning.

**Open:**
- **The exact wording and layout of both FPN forms.** Rui supplies the current official PDFs before this is built. Default if not: Poolse prints the data block and signature lines only, titled as the FPN's form.
- **Expiry.** Whether a declaration expires each season. Default: one per season, shown as *da época 2026/27*.

### Dev notes

- **Print route.** `/dashboard/students/[id]/documentos/fpn?minor=1`, its own components, and an entry in `check-layout.mjs`. This is the print-document rule (POOLSE-54, -115).
- **Storage.** `student_document` (organization_id, student_id, kind enum `fpn_declaration | fpn_declaration_minor`, season_id, file_id, filed_at, archived_at), insert-only bar archiving, plus a `RESTORABLE` line if archivable.
- **Files.** A new `stored_file` purpose with its `RULES` line in `files.repository.ts`: readable by owner, admin, and the family for their own child. Not sealed (not health data).
- **Tests.** A `role-probe` line for each new route. Use `write-migration`.

### QA

1. **Rename.** Given the record, then the tab reads *Documentos*, with *Identificação* working as before.
2. **Filled print.** Given a student with POOLSE-131's fields, when *Imprimir preenchida* is pressed, then the A4 page carries them and the print dialog opens only on `?print=1`.
3. **Minors only.** Given an adult, then *Declaração FPN – Menores* is not offered. For a 15-year-old it is, naming the primary guardian.
4. **Filed.** Given a signed scan uploaded, then the section reads *Assinada, arquivada a dd-MM-yyyy*. A second upload keeps the first in the history.
5. **Competition warning.** Given a competitive-level student with nothing filed, then the warning shows and the register is unaffected.
6. **Permissions and cross-tenant.** An instructor cannot upload (403). A guardian reads only their own child's files. Another club's student id gets 404.
7. **UI checks.** Both themes, phone width, pt-PT and en.

### Acceptance criteria

- [ ] The tab is *Documentos*, with three sections, the minors' section only where it applies.
- [ ] Both declarations print filled from the record, and their signed copies are filed with history.
- [ ] The competition warning is shown.
- [ ] QA 1–7 pass. The docs are updated.
