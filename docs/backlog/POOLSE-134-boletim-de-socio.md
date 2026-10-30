# POOLSE-134 · Boletim de sócio: printed filled from the record, filed signed, and the club's sócios imported or exported

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Students / Fees · **Priority:** Medium (pilot) · **Depends on** [POOLSE-131](./POOLSE-131-student-identity-and-address.md), [POOLSE-132](./POOLSE-132-student-documents-fpn-declarations.md) (the print-and-file shape)

### PO — why this exists

Rui, 30-10-2026: *"on 'Fees' → 'Membership' add these or reuse some input fields to create a 'Boletim de sócio'. This should also be possible to import/export."*

A sócio already exists on the record (`is_socio`, `socio_number`, `socio_since`, POOLSE-42). The club's membership form asks for the identity POOLSE-131 adds. One record should feed the form and the sócios list.

**Decided (Rui, 30-10-2026):**
- Printed filled from the record, signed, and the scan filed (the POOLSE-132 shape).
- The import and export carry every sócio and their details. This is also how a club brings its existing sócios list into Poolse.

**Not in scope:**
- Quota pricing (it exists).
- Paying the quota.
- A public sócio sign-up form.

### BA — rules

1. **Where it lives.** On the record's Mensalidades tab, the sócio block gains *Boletim de sócio*:
   - ***Imprimir preenchido***, an A4 route filled from the record: nº de sócio, sócio desde, name, birth date, NIF, nº de utente not printed, address, filiação, estado civil, profissão, habilitações, nacionalidade, naturalidade, contacts and, for a minor, the primary guardian.
   - ***Boletim assinado***, which uploads the signed scan with history and reads *Arquivado a dd-MM-yyyy* / *Por arquivar*.
2. **Reuse, never a second copy.** Every field is the record's (POOLSE-131) or the existing sócio columns. The form holds nothing of its own.
3. **Export.** *Exportar sócios* on Alunos writes one row per live sócio, in the student importer's own headers plus the sócio columns.
4. **Import.**
   - *Importar sócios* is the student importer with the sócio fields (`MatchSpec`), not a new pipeline.
   - It matches an existing student by NIF, else name plus birth date, proposed and confirmed. An unmatched row creates a student, as the student import does.
   - It sets `is_socio`, number and since.
   - Preview and commit run on one path; a round trip changes nothing.
5. **Unique numbers.** A sócio number is unique per club among live sócios (it already is). A clash is refused per row in the preview, never resolved by guessing.

**Open:**
- **Layout.** The club's own boletim layout. Default: Poolse's clean A4 with the club's name and logo. A club's own design is a later ticket.
- **Without a payment.** Whether *Boletim por arquivar* should warn. Default: shown on the record only, no warning elsewhere.

### Dev notes

- **Print route.** `/dashboard/students/[id]/boletim`, its own print components, and a `check-layout.mjs` entry.
- **Filed copy.** The signed copy is `student_document` kind `socio_form` (POOLSE-132's table).
- **Importer.** The student importer's field list gains the sócio fields behind a mode, `lib/student-sheet.ts` (`socios` mode). The round-trip test is extended to sócios.
- **Who.** The routes are owner and admin, plus a role-probe line each.

### QA

1. **Filled print.** Given a sócio with POOLSE-131's fields, then the print carries every one, and nº de utente is absent.
2. **Filed.** Given a signed scan uploaded, then *Arquivado a …*. A second upload keeps the history.
3. **Export.** Given 40 sócios, then the export has 40 rows in the importer's headers.
4. **Import.** Given that file with 3 new numbers and 1 clash, then the preview shows 3 updates, 1 refusal and no guesses.
5. **Round trip.** Given an export imported back, then nothing changes.
6. **Permissions.** An instructor gets 403 on the import, the export and the print. A guardian prints nothing.
7. **UI checks.** Both themes, phone width, pt-PT and en.

### Acceptance criteria

- [ ] The *Boletim de sócio* prints filled from the record, and its signed copy is filed with history.
- [ ] Sócios are exported and imported through the student importer, and the round trip is green.
- [ ] QA 1–7 pass. The docs are updated.
