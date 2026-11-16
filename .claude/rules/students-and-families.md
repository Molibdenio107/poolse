---
paths:
  - "apps/api/src/{students,people,messages,notices,notifications,push,meets,qualifying,feedback,invitations,identity,archive,app,retention}/**"
  - "apps/web/src/app/**/{students,family,familia,alunos,app}/**"
  - "packages/rules/src/{identity,lenex,swim,family-documents,agenda-months,whatsapp}*.ts"
  - "apps/api/src/leads/**"
  - "apps/web/src/lib/{levels,skills,kinship,medical-exams,public-registration,public-invitation,fpn-forms}.ts"
  - "apps/web/src/components/{gap-table,qualification-status,skill-state,progress-chart,aged-out-flag}.tsx"
---

# Students, families and messages

Read [`docs/conventions/students-and-families.md`](docs/conventions/students-and-families.md) before touching a student record, levels, competition, what a family sees, messages or an archive.

- Every email is sent once after its commit, rendered from its row, and retried hourly if it did not leave.
- A club's email is `clubEmail(organizationId, ...)`: From the club's name at Poolse's address, Reply-To the club's `reply_email` (POOLSE-209).
- A club's phone (`organization.contact_phone`) is published, never sent from; `withClubPhone` closes every club email with it (POOLSE-210).
- A NIF is checksum-validated, and `isValidNif` in `@poolse/rules` is the one definition.
- A family asks for a place from the app, and it is a pedido in the same queue.
- An adult is the absence of an acompanhante's edge, never a flag: a `parental` link stops granting at majority, and a family read goes through `guardian_access`, never `guardian_link` (POOLSE-206).
- Who came of age with a parent's link is `majority_pending()`, and the office answers on the student's own *Fez 18 anos* button with a `majority_review` (POOLSE-207, -213); *Alunos › Por rever* is `studentsToReview`.
- At 18 a `majority_notice` tells parent and student once, and a parent's consent stays in force until the young adult answers it (`consent_awaits_self()`, POOLSE-208).
- A warning about a person never gates what a club does with them.
- A student holds one level per sport
- *Convidar aluno* asks who uses the app; a child is invited through their encarregado, and a child's own login is turned by *O acesso é do encarregado* (`student_login_child_age()`, POOLSE-218).
- A minor is never saved without an encarregado (`parseStudent`, Receção included); one who slipped in is `MINOR_WITHOUT_GUARDIAN`, flagged and in *Por rever*.
- An archive is undone through the bin, and an archive that takes children lists them.
- An edit records what it changed, and a revert goes through the edit's own path.
- A time states its pool, and a best is per stroke, distance and course.
- A meet's results come from a LENEX file read on a server by `@poolse/rules/lenex` (its own subpath: `node:zlib` stays out of client bundles), and only the chosen club's swimmers reach the API.
- A results file can also arrive by email, and the inbox is the import's door, never a second import.
- A gap to qualify is `qualifying_gaps()` in SQL, and an FPN age group is never a `student_level`.
- A child advances by skills or by age, through one queue, and a job that writes as the club runs `asSystem`.
- A family reads its own child's record through the staff page in `familyView`.
- A cancelled lesson tells its families, and push is a second channel on a recorded notice.
- Who answers for a child is `family_may_answer()`, and *Vou / Não vou* is a notice, never a mark.
- What a family says after a lesson is `lesson_feedback`, admitted by its trigger and read by who taught it.
- A qualification's colour is `qualification_status()` in SQL, read through `qualification_current`.
- A family may stop a club's general messages, and nothing else.
- An aviso is a `message` with `channel = 'app'` and a window, never mail
- A scheduled exam is `medical_exam_schedule`, office only, and `insertExamIn` closes it.
- A message to one student is `audience = 'student'`, and WhatsApp is a record of a link opened, never a send.
- A message to families is a record first and an email second.
- A student's identity, documents and exam are the student's own record
- What a family sends is a `family_submission`, and it changes nothing until the office accepts.
- A date a person gave is declared until the office confirms it.
- The family's calendar is `GET /app/agenda?from=&to=`, and its reach is `agendaWindowAllowed` in `@poolse/rules`
