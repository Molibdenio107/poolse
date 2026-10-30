# POOLSE-133 · Exame médico: each student's current exam, filed as a document and imported or exported for the whole club

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Students / Health · **Priority:** Medium (pilot) · **Depends on** [POOLSE-109](./POOLSE-109-emergency-contact-picker-and-atestado-upload.md) (sealed health files)

### PO — why this exists

Rui, 30-10-2026: *"on 'Health and consent' add a section to import/export functionality that we already use but for exame medico."*

A swimmer, a competitor most of all, needs a valid medical exam (*exame médico-desportivo*). Today a club keeps the dates in a spreadsheet and the certificates in a drawer.

**Decided (Rui, 30-10-2026):** both. A spreadsheet for many students (the importer shape the club already uses), and the certificate file per student.

**Not in scope:**
- Booking exams.
- Reading the date out of the certificate with AI (a later flag-gated parser, if asked).
- Blocking anybody.

### BA — rules

1. **One exam is one row:** date, result (*apto* / *apto condicionalmente* / *não apto*), valid until, an optional note, and an optional certificate file. A student's standing is their latest live row.
2. **Three states, in words.** On the record's *Saúde e consentimentos* page, a new *Exame médico* section reads:
   - *Válido até dd-MM-yyyy*;
   - *Expirou a dd-MM-yyyy*;
   - *Sem exame registado*.
   
   Each state has an icon, never colour alone.
3. **A warning, never a gate.**
   - On the record and the register, as the seguro does.
   - A competitive-level student with no valid exam is also flagged in Competição.
4. **The certificate is health data:**
   - It is sealed (`SEALED_PURPOSES`, a new `medical_exam_certificate` purpose).
   - Every read is audited.
   - It is erased by `apply_retention()` 1 year after the student leaves.
   - It is readable by owner, admin and the family for their own child, never an instructor.
   - An instructor sees the state and the date, not the file or the note.
5. **Spreadsheet import and export:**
   - It is a `MatchSpec` (`lib/exam-sheet.ts`), one row per student: name, NIF or birth date to match, exam date, result, valid until.
   - Preview and commit run on one route with a `commit` flag. Matching is by NIF, else name plus birth date, proposed and confirmed — never name alone, never a student created.
   - The export writes the latest exam per student in the importer's own headers.
   - A round trip changes nothing.
   - PDFs come in through `readSheet(file, { pdf: true })` when its flag is on.
6. **Corrections.** A row is archived, never edited; a correction is a new row.

**Open:** the default validity when a sheet gives a date but no valid-until. Default: one year from the exam date, stored as `assumed`, never as fact.

### Dev notes

- **Schema.** `medical_exam` (organization_id, student_id, examined_on date, result enum `medical_exam_result`, valid_until date, note, file_id null, recorded_by, archived_at). Partial index for the latest live row per student. `club_today()` for validity, never `current_date`.
- **Retention.** A line in `apply_retention()` and in `retention.integration.test.ts`. Use `write-migration`.
- **Importer.** `lib/exam-sheet.ts` with field and synonym lists; the export headers come from `students.exam.field.*`. `exam-sheet.test.ts` round-trips against the real catalogue.
- **Tests.** Role probe: an instructor gets 403 on the file and the import; the family reads its own child only.

### QA

1. **Recorded.** Given an exam typed with its certificate, then the section reads *Válido até …*. An instructor sees the state, not the file.
2. **Expired.** Given an exam whose validity ended yesterday, then *Expirou a …*, and a warning on the record and in the register, which still opens.
3. **Import.** Given a sheet of 30 rows (28 match by NIF, 2 by name plus birth date), when previewed, then 28 are ready and 2 await confirmation. The commit writes 30.
4. **Round trip.** Given an export imported back, then the preview proposes nothing and the commit writes nothing.
5. **Retention.** Given a student who left over a year ago, when `apply_retention()` runs, then the certificate's key is destroyed.
6. **Permission and cross-tenant.** An instructor importing gets 403. Another club's file id gets 404.
7. **UI checks.** Both themes, phone width, pt-PT and en.

### Acceptance criteria

- [ ] `medical_exam` with sealed certificates, retention and audit on reads.
- [ ] The *Exame médico* section on *Saúde e consentimentos*, in three states, plus the warnings.
- [ ] The spreadsheet import and export, with the round-trip test.
- [ ] QA 1–7 pass. The docs are updated.
