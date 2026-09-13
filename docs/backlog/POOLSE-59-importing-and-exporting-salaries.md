# POOLSE-59 · Importing and exporting salaries

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Staff / Payroll / Import · **Priority:** Medium — built immediately after [POOLSE-58](./POOLSE-58-staff-salaries.md) · **Depends on** POOLSE-58 (the schema, the API and the visibility rule)

### PO — why this exists

A club arriving at Poolse has its pay list in a spreadsheet, and an annual raise is one column
recalculated for twenty people. Typing that into a web form twenty times is how a club decides to
keep the spreadsheet, which is how Poolse ends up holding a pay list that is quietly out of date.

This is the sixth importer and it is a `MatchSpec` like the other five — a field list, a synonym
list and `matchFields`, plus one route with a `commit` flag. No new pipeline.

**Not in scope:** importing staff. An unknown person is a rejected row with a reason, never a silent
create — a payroll file is exactly the wrong place to learn who works here.

### BA — rules and data

**A staff member is matched by email or by NIF, never by name.** Those are the two keys that are
unique per tenant in this schema — `membership_email_uq` and `membership_tax_number_uq` — and the
prompt's "external ID" does not exist on `membership`. Two people called Ana Silva is not an edge
case in a club with forty staff; matching them by name would put one of them on the other's salary.
The NIF is checksum-validated by `isValidNif` in `@poolse/rules` before it is used as a key: a number
that cannot exist must not silently match nothing.

**An import creates a new effective-dated row. It never edits and never archives.** The importer
uses the same `POST` path POOLSE-58 built, so the previous rate closes the day before and the history
is intact. A file re-imported by mistake does not destroy anything; it is caught by the preview,
below.

**The preview shows old → new, per row, before anything is written.** Rejected rows carry their
reason and the file is still importable without them — except where the failure makes the whole file
untrustworthy:

| Row | Outcome |
|---|---|
| Email and NIF both blank | Rejected — nothing to match on |
| Matched nobody | Rejected — *não é membro do staff* |
| Matched a student or guardian | Rejected — the same reason. A student has no salary |
| The Owner's row, imported by an Admin | Rejected with a stated reason, never silently skipped |
| Amount blank, negative or zero | Rejected |
| Amount with `€`, a thousands separator or a comma decimal | **Accepted** and normalised through the same helper the typed form uses |
| `effective_from` in the past or the future | Accepted. Backdating a raise is ordinary |
| `effective_from` overlapping a live rate | Rejected, carrying the dates, exactly as the form's 409 does |
| The same person twice in one file | **The file is refused.** Which row wins is not something to guess |

**A rate that is already what the file says is a row with nothing to do** — shown as unchanged, and
not written. This is what makes a round trip free.

**What the export writes, the import reads back.** The header row is `salaries.field.*` from the
translation catalogue, not prose invented for the file, so a club exports, corrects the column and
re-imports with nothing mapped by hand. Two consequences fall out of it, both of which have bitten
this repo before:

- **Any value that must survive the journey is written in a form that is the same in both
  languages** — `monthly` / `hourly` in the enum's own spelling, dates as ISO — because a file
  exported under `en` is re-imported under `pt-PT`.
- **A label chosen for the export must not be one the matcher hands to another field.** Check the
  new headers against the existing synonym lists before choosing them; `partners.field.contactName`
  is "Contacto" rather than "Nome" for exactly this reason.

**The Owner's row is absent from an Admin's export.** Same rule as the screen, same place it is
enforced — the repository — so the two cannot disagree. An Admin exporting, editing and re-importing
therefore never touches the Owner's pay, and the import rejects the row if they add it by hand.

### Dev — implementation notes

- `apps/web/src/lib/salary-sheet.ts`: the field list, the synonym list and `matchFields`, in the
  shape of `partner-sheet.ts`. `useImportWizard` from `lib/use-import-wizard.ts` drives
  upload → map → preview → commit. No LLM mapper, no model call, no feature flag — this file has
  columns, so it needs none.
- One API route, preview and commit distinguished by a `commit` flag. Never two: what the operator
  was shown and what is written must come from one code path.
- The file is read on the Next server and never leaves it.
- Both endpoints carry the POOLSE-58 guards. An instructor posting a payroll file gets 403 before
  the file is parsed.
- Export is `GET /staff/salaries/export`, honouring the same row visibility as the list and **not**
  the current page — an export of page 1 is a bug report waiting to happen.
- Amount parsing goes through the helper the typed form already uses, the way `draftToBody` is the
  one place a printed `15,41 €` becomes cents. A second parser here would accept a shape the form
  refuses.
- Full-page dropzone, as elsewhere — and check it does not swallow a drop meant for another surface,
  which is the bug the 5.3 fix closed on the site page.

### QA — test scenarios

1. **Given** an export of a club's salaries, **when** it is imported back unchanged, **then** the
   preview shows every row as unchanged, the commit writes no rows, and the history is byte-identical
   afterwards.
2. **Given** the real `messages/*.json` read from disk, **when** the export headers are matched,
   **then** every one resolves to its own field and none is claimed by another — a test in the shape
   of `partner-sheet.test.ts`.
3. **Given** a file exported under `en`, **when** it is imported under `pt-PT`, **then** every row
   matches and the types are read correctly.
4. **Given** a file with an unknown email, **then** that row is rejected with a reason, no membership
   is created, and the remaining rows still import.
5. **Given** a file naming a student, **then** rejected with the same reason.
6. **Given** an Admin and a file containing the Owner's email, **then** that row is rejected with a
   stated reason and the rest of the file imports.
7. **Given** a file with the same person twice, **then** the whole file is refused.
8. **Given** amounts written `1.234,56 €`, `1234.56` and `€1,234.56`, **then** all three import as
   `123456` cents.
9. **Given** a blank, a zero and a negative amount, **then** each is a rejected row with its own
   reason.
10. **Given** an `effective_from` that overlaps a live rate, **then** the row is rejected carrying
    both date ranges, and nothing partial is written.
11. **Given** a committed import, **when** the person's history is opened, **then** the previous rate
    is closed the day before and nothing was edited or archived.
12. **Given** an instructor's token, **when** it posts a file or requests an export, **then** 403.
13. **Given** pt-PT and en, light and dark, **when** the wizard is walked, **then** no untranslated
    string and no contrast failure.

### Acceptance criteria

1. Export and import share one field definition in `lib/salary-sheet.ts`; the importer is a
   `MatchSpec` driving `useImportWizard`, not a new pipeline.
2. One route serves preview and commit, distinguished by a flag.
3. Headers come from `salaries.field.*` in the catalogue, and a test reading `messages/*.json` from
   disk proves every header resolves to its own field.
4. A round trip — export, import, commit — writes no rows and reports every row as unchanged.
5. Matching is by email or checksum-valid NIF only. Name is never a key.
6. An unknown or non-staff person is a rejected row with a reason; no membership is ever created.
7. An Admin's export omits the Owner, and an Admin's import rejects an Owner row with a stated
   reason.
8. A duplicate person in one file refuses the file.
9. Amounts with currency symbols and either decimal convention parse through the same helper as the
   typed form.
10. An import creates new effective-dated rows only; nothing is edited, archived or deleted.
11. Overlap is refused with the dates carried as fields.
12. Both endpoints enforce the POOLSE-58 permission rules server-side, proven by a denial test each.
13. Every string through i18n in pt-PT and en; light and dark checked.
14. `docs/features/staff.md` updated in the same commit.
