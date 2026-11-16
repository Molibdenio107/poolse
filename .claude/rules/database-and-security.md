---
paths:
  - "packages/db/**"
  - "apps/api/src/**/*.ts"
  - "apps/web/src/lib/nav-entries.ts"
  - "apps/web/src/middleware.ts"
---

# Database, roles and security

Read [`docs/conventions/database-and-security.md`](docs/conventions/database-and-security.md) before touching a migration, a role check, a public route, personal data or a file.

- Clerk owns the name and the email; `app_user` holds a cache.
- A partial unique index cannot join, which is why a snapshot sometimes carries a foreign row's column.
- A workspace package the API imports is copied into `apps/api/Dockerfile`
- A backup is proved by restoring it, and the key that opens one is never in GitHub.
- A departed student's data expires, and `apply_retention()` is the only thing that expires it.
- Every handler refuses by role in its first line; there is no global role guard.
- An instructor reads only their sports' students
- A menu entry is shown only to the roles its page's API answers, and maintenance outranks instructor.
- A permission about a *row* is a repository answer, not `requireRole`.
- A site's page configures the club; the Instalações list is everybody's.
- A person's photograph is `IdPhoto`, and it has three homes
- A health-data file is sealed: its own key, wrapped, on its row, and the bucket holds ciphertext.
- An incident's facts are columns and its words are ciphertext the database refuses to hold as prose.
- A public page reads through one `SECURITY DEFINER` function keyed on a token, and nothing else.
- Every public page carries the complaints book and the operating regulation in force.
- A public write goes through one `SECURITY DEFINER` function keyed on the slug, and answers the same whatever happened.
- `class_session` has no `archived_at`; it has `status`.
- A column of a custom enum array is read `::text[]`, never bare.
- `cs` means `class_schedule` in most of this codebase, and a join to `class_group` is the place partnerships get silently dropped.
- An invitation is read with no account, and accepted only with one.
- A family is invited from the student, never from Pessoas
- A person merge never takes the Owner, two logins or support.
- A staff member's ID document is encrypted, behind its own route, and read aloud to the audit log.
- A login's name is the person's own, and the Owner may correct it.
- The Owner writes anything in the club; on somebody else's record an Admin reads the NIF, NISS, ID, contract, notes and staff roles and does not write them.
- A read that shows a student selects `FROM student_person s`, never `student`
