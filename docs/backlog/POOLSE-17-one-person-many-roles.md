# POOLSE-17 · One Person, many roles

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Architecture / Feature · **Area:** People / Data model · **Priority:** High — blocks POOLSE-04

### PO — why this exists

A senior student can also be the encarregado de educação of a grandchild, and today that is two unrelated records for one human: two phone numbers to keep in sync, two ID documents, two addresses that drift apart the moment one is edited. Modelling a single Person with roles attached fixes the duplication at its root and is the precondition for the guardian block (POOLSE-04), the adult path (POOLSE-23), the Pessoas/Alunos split (POOLSE-35) and the multi-badge display (POOLSE-18). It is High and it blocks: every week it waits, more code is written against the wrong shape.

**Not in scope:** deciding whether adult students get app logins in v1 (left open below), the invitation matrix itself (POOLSE-01), and the navigation split between Pessoas and Alunos (POOLSE-35).

### BA — rules and data

- A Person holds identity and contact data exactly once: name parts, date of birth, phone, email, NIF, address, photo, ID document. No role-specific copy of any of these exists.
- Roles — Owner, Admin, Instructor, Student, Encarregado de Educação, Maintenance — are assignments on the Person, and one Person may hold several at once. Removing one role removes neither the Person nor their other roles.
- Guardianship is a relation between two Persons carrying the relationship type (mãe, pai, avó, tutor legal, outro) and a primary-contact flag; per POOLSE-04 AC4 the relationship lives on the link, because the same person can be a grandmother to one student and a legal guardian to another. Per POOLSE-35 AC5 the relation is one guardian to many students.
- Permissions resolve to the **union** of the Person's roles (AC5). The same criterion then says the invite matrix (POOLSE-01) uses the **strongest role held** — for invitation rights these give the same answer, since the matrix is a strict hierarchy, but the two phrasings must be reconciled in one written rule rather than implemented twice. **Answered (27 Aug):** yes — "strongest" is that seniority order, Owner → Admin → Instructor → Maintenance → EE → Student, and it is written once. `MEMBER_ROLES` in `apps/api/src/tenant/roles.ts` *is* the order; `strongestRole()` reads it and so does the badge sort in `apps/web/src/lib/roles.ts`. The API's list previously put Student before EE and has been corrected.
- The deduplication key is **NIF, else email** (AC8). Creating or importing a Person whose NIF or email already exists warns and offers to add the role to the existing Person instead of creating a second record (AC9).
- A Person with neither NIF nor email cannot be deduplicated automatically. **Answered (27 Aug):** a **guardian** must carry a NIF or an email; a student need not. Most seven-year-olds have neither and requiring one would block ordinary enrolment, while a guardian is an adult who has one — and guardians are where duplicates actually come from. Enforced by the `guardian_needs_a_key` trigger rather than a CHECK, because the key is on `membership` and the role is on `membership_role`, so the rule spans two tables and is checked from both directions.
- The migration merges existing duplicate student/guardian pairs matched by NIF or email, and produces a report of what was merged (AC10). Merging is a one-way operation on live tenant data and must be reviewable before and after.
- The People list shows every Person once with all their role badges — never the same human twice (AC4); a Person's Student view and Encarregado view are sections of one profile, not separate pages (AC6).
- Edge case: two existing records share an email but have different NIFs. They are **not** the same person — NIF wins over email whenever both are present and disagree.
- Edge case: two existing records share a NIF but differ in every other field. They are the same person by the stated key; the merge must decide field by field which value survives rather than picking a record wholesale.
- **Deferred (27 Aug), explicitly:** nobody gets a login in v1. The mobile app is not built and file storage is deferred, so an account would do nothing yet. `membership.app_user_id` stays nullable, so one Person gains a login later without any change of shape — the question is reopened when the app lands, not before.

### Dev — implementation notes

- Schema: `person` (tenant key, name parts, date of birth, phone, email, NIF, address, photo ref, ID document ref), `person_role` (person, role, granted_at, granted_by — unique on person + role), `guardianship` (guardian person, student person, relationship type, is_primary_contact, unique on the pair). Tenant key on every table, every query scoped, no exceptions.
- Enforce the dedup key in the database, not only in application code: a partial unique index on (tenant, NIF) where NIF is not null, and on (tenant, lower(email)) where email is not null. Application-level checks lose the race; the index does not.
- **The merge migration is the risky part and deserves its own phased build.** Phase 1: a read-only pass that groups candidate duplicates by NIF, then by email among the NIF-less, and writes the report — actor-visible, per tenant, listing every pair it intends to merge and every field where the two records disagree. Phase 2: the merge itself, executed only after the report is reviewed. Phase 3: the constraint that prevents new duplicates.
- Merge mechanics: choose a surviving person id (oldest created, deterministic), repoint every foreign key — enrolments, attendance, guardianship edges on both sides, documents, invitations, audit rows — then soft-delete the absorbed record with a `merged_into` pointer rather than deleting it. Keeping the pointer is what makes an incorrect merge recoverable and keeps old audit references resolvable.
- Field-level merge rules must be explicit and written down: non-null wins over null; on a genuine conflict, the record with the more recent update wins and the discarded value goes into the report. Do not silently drop a phone number or an address — every discarded value is reported.
- Merging must be idempotent and re-runnable per tenant, and must run inside a transaction per merge group so a failure on one pair does not leave a half-repointed graph. Run it against a restored copy of production data before it runs on production.
- Permission resolution is one server-side function returning the union of the Person's role grants, plus a `strongestRole()` derived from the single seniority order, used by the invite matrix. Every authorisation check in the codebase goes through it — the old "user has role X" single-role assumption must be hunted down and removed, because it will silently deny an Instructor who is also a parent, or grant on the wrong role.
- API surface: person CRUD, role grant/revoke, guardianship create/remove, a dedup-check endpoint called by both the create form and the Excel import, and a merge endpoint for the manual "add the role to the existing Person instead" path (AC9).
- Import: the Excel importer calls the same dedup helper as the UI — one implementation, or the two will diverge and the importer will be the one creating duplicates.
- i18n: role names, relationship types, the duplicate warning and the merge report copy in pt-PT and en. Theming: role badges follow POOLSE-18's tokens; the profile's role sections must read in both modes.
- Performance: the People list joins roles per Person — aggregate the badges in one query rather than N+1 per row, and index `person_role` on person. The list is paginated at 15 (POOLSE-29), so the badge aggregation must respect the page, not the whole set.
- Most likely to get wrong: leaving a single-role assumption behind somewhere in the authorisation path — a `person.role` accessor, a JWT claim carrying one role, a UI guard reading the first badge. The union is only true if nothing anywhere still asks for "the" role.

### QA — test scenarios

17.1 Given a Person holding Student and Encarregado de Educação / When the People list is opened / Then they appear exactly once, with both role badges.
17.2 Given that Person / When their profile is opened / Then their student enrolments and their guardianship appear as sections of one profile, not as two pages.
17.3 Given a Person holding Instructor and Student / When they attempt an action permitted to Instructors / Then it succeeds — the union grants it, the Student role does not block it.
17.4 Given a Person holding Admin and Student / When they open the invite dialog / Then the role list is the Admin list per POOLSE-01, and an attempt to invite an Owner returns 403 from the API.
17.5 Given a Person with Instructor and Student / When the Instructor role is revoked / Then the Person, their Student role and all their data survive.
17.6 Given an existing Person with NIF 123456789 / When a new Person with the same NIF is created in the UI / Then a duplicate warning appears offering to add the role to the existing Person, and no second record is created.
17.7 Given the same NIF submitted twice concurrently via the API / When both requests are processed / Then the unique index rejects the second — the check does not depend on timing.
17.8 Given an Excel import containing a guardian who already exists as a student / When it is imported / Then the existing Person gains the EE role and no duplicate is created (AC8).
17.9 Given two records sharing an email but with different NIFs / When the dedup check runs / Then they are treated as different people and neither is merged.
17.10 Given two records sharing a NIF with different phone numbers / When the merge migration runs / Then one Person survives, the discarded phone number appears in the merge report, and no contact data vanishes unreported.
17.11 Given a tenant with duplicate student/guardian pairs / When the migration runs / Then every enrolment, attendance row, guardianship edge and document from both records points at the surviving Person, and the absorbed record carries a `merged_into` pointer.
17.12 Given the migration has run / When it is run again on the same tenant / Then nothing further is merged and no error occurs.
17.13 Given tenant A and tenant B each containing a Person with the same NIF / When the migration runs / Then nothing is merged across tenants and tenant isolation holds.
17.14 Given a guardian responsible for three students / When their profile is opened / Then all three are listed, and each student's record links back to the one guardian Person.
17.15 Given locale pt-PT then en / When role badges, relationship types and the duplicate warning render / Then all are translated with no key leakage.
17.16 Given light and dark mode / When a Person with four role badges is displayed / Then every badge is legible, contrast-checked, and carries its role name as text.
17.17 Given a Person record with neither NIF nor email / When creation is attempted / Then the behaviour matches the documented decision on the open question rather than silently creating an undedupable record.

**Knock-on effects to check:** POOLSE-04 (guardian block), POOLSE-11 (one ID document per Person, not per role), POOLSE-01 (invite matrix reads the union of roles), POOLSE-18 (a Person can show several role badges).

### Acceptance criteria

1. A Person holds identity and contact data once: name, date of birth, phone, email, NIF, address, photo, ID document.
2. Roles (Owner, Admin, Instructor, Student, Encarregado de Educação, Maintenance) are **assignments on the Person**, not separate record types. One Person may hold several simultaneously.
3. Guardianship is a relation between two Persons, carrying the relationship type and a primary-contact flag (see POOLSE-04).
4. The People list shows every Person once, with all their role badges — never the same human twice.
5. Permissions resolve to the **union** of the Person's roles; the invite matrix (POOLSE-01) uses the strongest role held.
6. A person's Student view and their Encarregado view are tabs/sections of one profile, not separate pages.
7. Removing one role does not delete the Person or their other roles.
8. Excel import matches on a stable key (NIF, else email) so importing a guardian who is already a student does not create a duplicate.
9. Deduplication check: importing or creating a Person whose NIF/email already exists warns and offers to add the role to the existing Person instead.
10. Migration merges any existing duplicate student/guardian pairs, matched by NIF or email, with a report of what was merged.
