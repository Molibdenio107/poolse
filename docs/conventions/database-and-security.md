# Database, roles and security

The full text of the conventions for a migration, a role check, a public route, personal data or a file. `CLAUDE.md` holds one line each; read this file before changing that area.

**Clerk owns the name and the email; `app_user` holds a cache.** `cached_first_name`,
`cached_last_name`, `cached_email` and `cached_avatar_url` are a copy of Clerk's data,
refreshed by the webhook and stamped with `synced_at` so a late event cannot revert a
newer one. **Never write those columns to save a user's input.** It appears to work and is
silently overwritten the next time Clerk syncs — a bug that reproduces only sometimes.
The save path is: write to Clerk, then re-read from Clerk (`refreshFromClerk`). Locale,
theme, birth date and phone are Poolse's and are written directly. `docs/data-model.md`,
decision 2, and `packages/db/test/profile.sql`, test 6.

**A partial unique index cannot join, which is why a snapshot sometimes carries a foreign
row's column.** `student_fee.kind` is the case: "one inscrição per student per season" is only
sayable with the kind on that row. Where that happens, a BEFORE trigger fills the copy from
its source when a caller does not send it — every existing caller predates the column, as with
`class_session.occurs_on` — and a constraint trigger refuses one that disagrees. A copy with
neither is a copy that drifts.

**A workspace package the API imports is copied into `apps/api/Dockerfile`** (both the manifest and the source), or the production image fails on its imports; `packages/rules` was missing from it until 02-11-2026. The deploy is [`docs/go-live-runbook.md`](docs/go-live-runbook.md).

**A backup is proved by restoring it, and the key that opens one is never in GitHub.** POOLSE-89. `packages/db/scripts/`: `backup` (one snapshot for the dump and its manifest, age-encrypted, 30 days), `check-backups` (keyless, daily in GitHub), `restore-drill` (on Rui's machine, with the age key and `SENSITIVE_DATA_KEY`), `restore` + `verify-restore` (the runbook in `docs/deploy.md`). **A function used by an index or a constraint calls our other functions as `public.<name>()`**: `pg_restore` rebuilds them with an empty `search_path`, and `test/restorable.sql` fails the one that forgets. `pnpm --filter @poolse/db backup:test` is the full drill against Docker and S3Mock.

**A departed student's data expires, and `apply_retention()` is the only thing that expires it.** 7b.8, Rui 16-10-2026: health data 1 year after `student_left_on()`, identity 5 years after. The function is `SECURITY DEFINER` because the data sits in tables closed to the app, takes no arguments and acts on `current_organization_id()` only. A new table holding a student's health data or identity earns a line in it and in `retention.integration.test.ts` — or, as the FPN licence, the opt-out list and invoice reminders do, a trigger on the anonymisation (a `SECURITY DEFINER` helper that acts only on `current_organization_id()`, granted to the app, because a staff edit fires it too). Invoices keep their snapshot for the ten years tax law asks. `docs/features/retention.md`.

**Every handler refuses by role in its first line; there is no global role guard.** Security
review, 12 October 2026. A guardian or a student holds a full tenant context (owners, admins and
instructors can invite them), and 31 handlers answered them: the whole register, every parent's
and every staff member's contacts, NIFs and addresses, a colleague's medical leave, partner
prices, and two writes. Staff routes start with `requireRole(...)`, and `hasRole` computes a flag
but refuses nothing. A child's own pages (record, timetable, calendar, progression) use
`requireActsForStudent` (`students/student-access.ts`): staff pass, a family only for its own
child, and anyone else gets a 404. A picker that non-office staff need gets a names-only endpoint
(`incidents/people`) rather than reopening the register. `security/role-probe.integration.test.ts`
calls every route as an unlinked guardian and as a student. **A new endpoint is added there in
the same change.**

**An instructor reads only their sports' students** (POOLSE-145). `membership.sports` (owner and admin set it; `{pool}` for everybody until told) and `sportScope()` / `requireSport` in `tenant/sport-scope.ts` are the one decision: null (every sport) for owner, admin, non-instructors and an instructor who has every sport the club has on — so a pool-only club is unchanged; otherwise another sport is a 403 `sport_not_yours`, never an empty list, and a list filters by the scope. `requireActsForStudent` applies it to a child's own pages; a record leaves another sport's fields out. The web's mirror for the menu is `readableSports`. Competition (qualifying, meets, times) is swimming's: `requireCompetition()`. A qualification type names its sport (null is every sport) and `qualification_applies()` is the one test of whether it concerns somebody — *em falta*, the alert and the assignment block (POOLSE-146). A message to a whole sport is an audience (`message_recipients(…, p_sport_id)`), the office's only. A new sport-scoped handler calls `requireSport`.

**A menu entry is shown only to the roles its page's API answers, and maintenance outranks instructor.** 15 October 2026, Rui's call. `app-sidebar.tsx` gives each entry the roles of the route its page loads (`STAFF`, `TEACHING`, `OFFICE`); `unlessRoles` hides a shortcut from a role that reaches the page another way. A list page says *not allowed* on a 403 and *no organization* only for the `no_organization` code. `MEMBER_ROLES` is owner, admin, maintenance, instructor, guardian, student. Permissions stay the union; the order only decides which role leads (badges, `leadRank` in a dashboard band). Maintenance writes the inventory (`INVENTORY_EDITORS`) but archives nothing. `docs/features/navigation.md`.

**A permission about a *row* is a repository answer, not `requireRole`.** "The instructor
responsible for this turma" cannot be written as a role, so the repository resolves the row,
decides, and the controller turns a refusal into a 403 — while the read endpoint returns the
same answer as `canEdit` so the screen and the guard cannot disagree. See `lesson-plans.repository.ts`.

**A site's page configures the club; the Instalações list is everybody's.** 15 October 2026, Rui's call. `GET /facilities/:id` is `SITE_PAGE_ROLES` (owner, admin, maintenance; support is admin), and the page shows maintenance only Espaços, Manutenção and Energia. The list carries `canOpenSite` and `canOpenPools` so it never links to a page that will refuse. A new site-page tab is `visible: loaded.canManage` unless it is maintenance's daily work. `docs/features/facilities.md`.

**A person's photograph is `IdPhoto`, and it has three homes** (Rui, 28-10-2026). A family also reads an adult classmate's photo while both are in a turma, and the photo of whoever teaches their child, each proved in `openFile`; a minor's never reaches another family (POOLSE-194). Your own is Clerk's (`own-photo` → `PUT /me/photo`, re-read with `refreshFromClerk`). A staff member with no login is `membership.photo_file_id`, and one with a login sets their own. A student is `student.photo_file_id`, filed and read only with a live photo consent, checked in `PHOTO_KEY` and again in `openFile`. `docs/features/files.md`.

**A health-data file is sealed: its own key, wrapped, on its row, and the bucket holds ciphertext.** POOLSE-109. `sealFile` / `openSealedFile` in `sensitive/envelope.ts`; `SEALED_PURPOSES` in `files.repository.ts` and the `stored_file_sealed` CHECK name the purposes (`medical_certificate`, and `incident_attachment` ready for POOLSE-70). `storeFile` seals, and `openFile` audits `file.read` and opens. Retention destroys the wrapped key (crypto-shredding), never the object. A family uploads health files only through the record's own one-step route, never `POST /files`. The atestado is `medical_leave_certificate` + `student_medical_leave.document_file_id`. A coach gets `certificate.file === null`. `docs/features/students.md`.

**An incident's facts are columns and its words are ciphertext the database refuses to hold as
prose.** POOLSE-70. `incident` (when, where, who, emergency, lifeguard on duty) is read by any
staff member. `incident_detail` and `incident_addendum` hold text encrypted by
`sensitive/cipher.ts`, and a CHECK refuses anything that is not that shape. Reading the words is
Owner/Admin or the author, decided per row, and every read writes `incident_detail.read` to the
audit log in the same transaction. All three tables are insert-only by grant, bar archiving, and
a correction is an addendum. `docs/features/incidents.md`.

**A public page reads through one `SECURITY DEFINER` function keyed on a token, and nothing else.** POOLSE-71. `public_water_page()` takes the token and returns a fixed key list — never "look the tenant up, then `withOrg`", which is a second cross-tenant read path, and never a looser RLS policy. The API route sits in `PUBLIC_ROUTES` (`public/(.*)`), is throttled **per token** (`publicWaterTracker`: the Next server is one address for every visitor), builds its response field by field, and answers every kind of miss with the same 404. The web page lives in the `(public)` root layout, outside Clerk and the app shell, translated with `createTranslator` and `?lang=en`. The token is stored retrievable — it is printed on a wall — and revocation is immediate. `docs/features/maintenance.md`.

**Every public page carries the complaints book and the operating regulation in force.** POOLSE-73. Use `PublicNotices` (`components/public-notices.tsx`) on any new public page. A private operator's link is `LIVRO_RECLAMACOES_URL` (DL 156/2005 art. 5.º-B), and a public service gives its own (`organization.complaints_url`, DL 135/99). A regulation is versioned by publication and never edited (`facility_regulation_current`, Portaria 454/2023 art. 46.º). **A column-level GRANT needs the table-wide privilege revoked first**, because the default privileges hand `poolse_app` a table-wide UPDATE that a column grant does not narrow. Pair every `GRANT UPDATE (col)` with a `REVOKE UPDATE` and a SQL test that tries the other columns. `docs/features/public-notices.md`.

**A public write goes through one `SECURITY DEFINER` function keyed on the slug, and answers the same whatever happened.** POOLSE-69. `submit_lead()` and `public_lead_form()` are the pre-registration form's whole boundary, the `public_water_page()` pattern applied to a write. The POST answers 202 to a honeypot, a stale stamp (`form-stamp.ts`), a noisy origin, an unknown or closed club and a database failure alike. Only a malformed body gets a 400, and that is decided before any club is looked at. A club opens its form (`public_registration_open`, Owner only, off by default), and its address is `organization.slug`. **A slug a club has used stays that club's for ever** (`slug_claim`, 13-10-2026 sweep), because a printed poster must never reach another club. A forwarded visitor address (`x-poolse-client-ip`) is believed only beside `WEB_PROXY_SECRET` (`leads/visitor.ts`). An aula experimental is `lead.trial_session_id`, counted by `session_free_seats()`; a new kind of guest in a session goes there too. Converting a lead calls `parseStudent`, `insertStudent` and `insertEnrollment` in one transaction, never a second insert path. `docs/features/registration.md`.

**`class_session` has no `archived_at`; it has `status`.** A session ends as `cancelled`,
which is what attendance and invoicing rest on. `cs` means `class_schedule` in most of this
codebase and `class_schedule` *does* have the column — so a query that means the session and
copies the habit raises `42703` at runtime and nothing catches it: `typecheck` does not read
SQL and `sql:check` only looks for backticks. **A repository function with no integration test
is untested SQL** — the whole stand-in feature shipped dead this way, and the browser's
`.catch(() => null)` presented it as a dropdown greyed for ever.

**A column of a custom enum array is read `::text[]`, never bare.** node-postgres has a parser
for `text[]` and none for `pool_metric[]`, so a bare select hands JavaScript the string
`'{ph}'` — `.map()` over it iterates characters and `new Set(…)` of it matches no metric name.
It typechecks perfectly, because the row type is whatever the query was told to claim, and it
is invisible on a screen that only counts the rows. Slice 4.2's alert email was built from
exactly that set and would have gone out with an empty list; the integration test is what
found it, which is the same lesson as the paragraph above.

**`cs` means `class_schedule` in most of this codebase, and a join to `class_group` is the
place partnerships get silently dropped.** It has happened three times — `listSessions`,
`occurrenceOf` and the stand-in candidate list all inner-joined it, so every parceria session
simply was not there. Nothing errors: a query returns fewer rows and a screen renders less.
A partnership session carries no `class_group_id`; its group, its instructor and its title
come through `class_schedule`. Reach for `LEFT JOIN` and a `coalesce` of both sides.

**An invitation is read with no account, and accepted only with one.** 29-10-2026. `/join` and
`GET /join/preview` are public (per-token throttle, `find_invitation_by_token` and nothing else);
`POST /join` stays in `IDENTITY_ONLY_ROUTES`. Signed out, the accept control is *Criar conta* /
*Entrar* returning to the same link with the invited address seeded; the page has no Voltar, and
after accepting the way in is `/app`. `docs/features/staff.md`.

**A family is invited from the student, never from Pessoas** (POOLSE-129). The record's *Acesso à app* tab invites each guardian and the student from 12, by email or by a link shared from the club's phone (`invitation.email` null). The invitation names the existing guardian or student membership, never a placeholder. `POST /invitations` refuses family roles, and *Convidar membros* on Alunos is one preview/commit path, capped at 200 a day; *Convidar aluno* creates and invites somebody not yet registered. **An email or a mobile identifies a person** (Rui, 30-10-2026): the staff invite and *Convidar aluno* look the contact up (`findPersonByContact`, last nine digits) and invite the record the club has, never a second one; roles arrive with the login. `docs/features/staff.md`. `docs/features/students.md`.

**A person merge never takes the Owner, two logins or support.** `merge_memberships` refuses all three (409 from `POST /people/merge`), because absorbing the Owner's record handed an Admin the club, and it repoints only columns the app may update — the insert-only history keeps the absorbed id, which `merged_into` resolves. `people-merge.integration.test.ts` runs it as `poolse_app`; a SQL test run as the owner proves nothing about a function the app calls. **`merge_memberships` and `accept_invitation` were last changed in place** (1793872800000 rewrites their live text in a `DO` block), so no migration file holds their current body: a later change rewrites them the same way, and a body copied from the last file that spells one out silently reverts those fixes (POOLSE-149's first draft did; `invitations.sql` test 11 caught it).

**A staff member's ID document is encrypted, behind its own route, and read aloud to the audit log.** POOLSE-100.
- `GET/PATCH /staff/:id/identity` answers the Owner, an Admin or the person.
- A read by anybody else writes `membership.id_document_read`.
- The number is ciphertext by CHECK.
- A CC number is `isValidCcNumber` in `@poolse/rules`.
- `apply_retention()` erases the document 12 months after the person leaves.
- A login's date of birth is theirs (`birth_date_is_theirs`), like their name.
- **Personal details are a group of their own** (POOLSE-149): `GET/PATCH /staff/:id/details` (`staff/details.repository.ts`), same three readers. NIF and NISS (`isValidNiss`) are the club's to set; the person edits the rest. Morada and NIF are the person row's `address` / `tax_number`. The NISS and emergency contact are erased with the ID document.
- **The ID document's photograph is sealed and shredded when let go** (POOLSE-149 B): purpose `staff_id_document`, filed only by `POST /staff/:id/identity/photo/:side`; `membership_id_document_photo_shreds` destroys the key of a side that is replaced, removed or retained away. Shown as a link, never a thumbnail: a look by anybody else is an audited read.
- **A staff contract is the pay rule's** (POOLSE-149 C): `staff_contract` (facts, informative only, read by nothing else) + `staff_contract_version` (the `partner_contract_version` shape), `contract.repository.ts` through `visibleToViewer`. An Admin never reads the Owner's (404) nor writes their own (403 `own_contract`); the read returns `canEdit`.
- **A certificate can come first** (POOLSE-149 D): dropped on a person's Qualificações it is filed, read by the `qualification_certificate` reader when on (the club's own type, matched, never created), and attached on save through the existing `PUT qualifications/:id/document`.

**A login's name is the person's own, and the Owner may correct it.** `PATCH /staff/:id` refuses (`name_is_theirs`) a rename by anybody else: Clerk holds one name for them across every club, so the Owner's correction follows them and the screen says so (Rui, 07-11-2026). The date of birth and the photograph go the same way, by `ownerCorrects` and `login-photo`; the email never does. Support is an Admin here and stays refused.

**The Owner writes anything in the club; on somebody else's record an Admin reads the NIF, NISS, ID, contract, notes and staff roles and does not write them.** POOLSE-196. `requireOwnerOrSelf` and `refuseStaffRoleByNonOwner`. An Admin keeps phone, address, sports and family roles, so the office is not stuck. A new staff field that is sensitive joins that list. The side doors count: a merge with staff on either side, an invitation naming somebody the club already has, and a guardian form filling a NIF are the Owner's too. Poolse support changes no person's account (`support_no_account`). Removing `student` from a live student is refused: archive first. The routes that do not name the Owner are the personal homes (`/app/*` for a family, `/app/teaching`, `/app/maintenance`), where the role is what gives the answer meaning. A personal home is reached by holding the role.

**A read that shows a student selects `FROM student_person s`, never `student`** (POOLSE-177): same column names, and an adult-path student with a login reads name, email, birth date and phone through `app_user`. The link is `student.membership_id` → `membership.app_user_id`; `student.app_user_id` has no writer. A write, a lock and a rule stay on `student`: age bands, FPN age groups and the adult path read the club's `birth_date`, so nobody moves their own age group from a phone. A new `student` column is added to the view too. A person's phone is `person_phone()`, never `m.phone`.
