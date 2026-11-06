# POOLSE-186 · A date of birth a person gave reaches the club's record, and the office confirms it

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Bug · **Area:** Students / Mobile app · **Priority:** High (pilot) · **Depends on** [POOLSE-177](./POOLSE-177-app-profile-edits-never-reach-the-student-record.md), [POOLSE-179](./POOLSE-179-documentos-in-the-family-app.md)

### As built (05-11-2026)

- **Migration `1794653300000_student-birth-date-declared`.** `student.birth_date_declared_at`, `birth_date_verified_at`, `birth_date_verified_by`; `test/student-birth-date.sql` has 5 tests. A date already blank with a login date behind it was backfilled by the migration.
- **The fill** is three triggers, one for each way the two rows meet: linking a student, a login joining a person, saving a profile. A guardian on the record, or a date the club holds, stops it.
- **Required on the desktop form only**, in the form and its server action. `POST /students` stays lenient because imports, invitations and lead conversion share it.
- **Leads are not marked declared:** an office person reads the date when converting one, and marking it would refuse an adult's self-signed consent there.
- **`*Por confirmar*` shows only for a declared date,** so the records the office typed stay quiet. Accepting a family's ID always asks for the date, and confirms it.
- **The office changing the date clears both states by trigger.** A correction on confirming also writes the login, as the record's own edit does.
- **With no date anywhere,** a student's own login is told to add it in Perfil rather than that a guardian answers (`needsBirthDate`).

**Known limit:** an unguarded child with a login and a blank record could type an adult date. It reaches answering and sending, never consent, until the office confirms it.

### PO — why this exists

Rui, 05-11-2026: *"My student account is born on 1990 however it still says that a guardian will answer for this student, that doesn't make sense"*, and then *"When a student is created, either on desktop app or by form on mobile take into consideration that DoB. Then it can be verified by the upload id document."*

The date sat on `app_user`, `student.birth_date` was blank, the screen read through and every rule did not. The person had no guardian, so nobody could answer.

**Not in scope:** making the date required on imports or invitations; reading the date off the ID automatically.

### BA — rules

1. A blank club date takes the login's date, once, and never overwrites the club's. A student with a live guardian is left alone.
2. Such a date is declared. It counts for answering and sending; it does not count for the adult path, so it never decides who signs consent.
3. A new student on the desktop form needs a date of birth.
4. The office confirms a date by accepting an ID document with it, or with *Confirmar a data* on the record. Who and when are stored, the audit entry holds no value, and a warning blocks nothing.

### QA

1. Given a login with a date and a blank record, when linked, joined or saved, then the record holds the date, declared. SQL tests 1 and 5.
2. Given a live guardian, then the record stays blank. SQL test 2.
3. Given a declared date, then the person may answer and the adult path is false; confirmed, it is true. SQL test 3, API test.
4. Given an ID accepted with a corrected date, then the record holds it, verified, and the log holds no date. API test.
5. Given no date to confirm, then 409; given an instructor or a family, then 403 in the role probe.

### Acceptance criteria
- [x] The student from Rui's report answers in the app.
- [x] Consent stays on a confirmed date.
- [x] QA 1–5 green.
