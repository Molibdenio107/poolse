# POOLSE-235 · Ctrl+K finds people, turmas and the reader's own clubs, by role, and never shows what it matched on

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Navigation / Search / Students · **Priority:** Medium (pilot) · **Depends on** [POOLSE-118](./POOLSE-118-command-palette.md)

### PO — why this exists

Rui, 19-11-2026: the palette (POOLSE-118) finds pages and actions, but the thing an office looks up all day is a person: *"a mãe da Inês ligou"*. Typing a name, a phone or a NIF and landing on the record is the shortest path in the product. It touches minors' data, so the rules below are as much about what it never shows as about what it finds.

**Not in scope:**
- An `/admin` tenant search. Clubs here are only the clubs the reader belongs to.
- Searching messages, invoices, incidents or files.
- The family app (`/app` has no palette).
- Full-text ranking or typo tolerance.

### As built (19-11-2026)

- **There was no general club switcher**, only support's, so *Clubes* got its own server action, `switchClubAction`. It re-reads `/me`, accepts only a club the reader belongs to, refuses under *Ver como*, sets the existing `poolse_org` cookie and opens Início. The API re-checks membership on every request.
- **A guardian found by the office opens their child's record**, which is the record page that exists. The context line names the child.
- **An instructor's staff results show the name and role without a link**: the staff pages answer the office only.
- **A result is `{id, name}` plus one fact** (level, child, role, or level and instructor), and the web translates it. The API returns no context string of its own.
- The cost per group wasn't measured with `countStatements`. Each group is one statement with its `LIMIT`.
- Security review run: no S1–S3. One S4 is recorded and accepted (instructors see staff names and roles, by Rui's rule 1).

### BA — rules

1. **Groups and who sees them** (Rui):
   | Group | Owner / Admin | Instructor | Maintenance, guardian, student |
   |---|---|---|---|
   | Alunos e famílias (students, guardians) | all | **only students of their own turmas**, inside their sports (`sportScope`, POOLSE-145); no guardians | none |
   | Equipa (staff names) | all | all (names only) | none |
   | Turmas (name, level, instructor) | all | only their own turmas | none |
   | Clubes (switch club) | the reader's own memberships | same | same |
   Maintenance and families keep the palette as today: pages and actions only.
2. **Matching.** At least 2 characters (`MIN_SEARCH_LENGTH`). A name matches case- and accent-insensitively as a substring, through the existing `searchPredicate` (`common/search.ts`, `strpos` on folded text). That rules out `ILIKE`, so `%` and `_` are literal by construction and need no escaping. **This corrects the brief's "escape % and _ in ILIKE".** A **NIF** matches only exactly (9 digits). A **phone** matches only on its last 9 digits (`findPersonByContact`'s rule), never as a substring of a longer number.
3. **At most 5 results per group**, decided in each group's `LIMIT` in the same statement as the role scope (POOLSE-30: never filter after the window).
4. **A result shows a name and one context line, and never what it matched on.** No NIF, phone, birth date, email or anything medical. The context lines:
   - a student: their level, or *Encarregado de {aluno}* for a guardian;
   - a staff member: their role;
   - a turma: its level and instructor.
   A search by NIF that finds Inês shows *Inês Silva · Nível 3*. The reader learns the NIF belongs to Inês, which they could already see on her record (owner and admin only). For an instructor, a NIF or phone search **never matches**. Rule 1 scopes them to names: they may not read those fields today.
5. **Results open the existing record page** (`/dashboard/students/:id`, `/dashboard/facilities/staff/:id`, `/dashboard/classes/:id`). A club result switches club through the existing switcher (POOLSE-79, `poolse_org`) and lands on its Início.
6. **The Clubes group needs no request.** The palette already has the reader's memberships from `/me`, filtered on the client as pages are today.
7. **Recent searches keep page ids only, as today.** A data result is never written to `localStorage`, and neither is the typed term.
8. **Rate:** the client debounces (250 ms) and drops stale answers. The endpoint has its own per-user throttle (60 a minute), below the global 300.

### Dev notes

- **One endpoint**: `GET /search?q=` → `{ students: […], guardians: […], staff: […], turmas: […] }`, each item `{ id, name, context, href }`. `requireRole('owner', 'admin', 'instructor')` is its **first line**, so maintenance and families get 403 and the client doesn't ask them. Tenancy comes from RLS under `withOrg(currentTenant())`, and every term is a bind parameter.
  - A read that shows a student selects `FROM student_person s` (POOLSE-177).
  - A person's phone is `person_phone()`.
  - The instructor's students come through the same scope `/app/teaching/students` uses (`myTurmaIds` + `sportScope`), never a second definition.
  - One statement per group, run in parallel. Measure the cost with `countStatements` in the test.
- Web: `components/command-palette.tsx` gains the data groups below the page results, only for the three roles. Each row is a `FromLink`. Keys go under `palette.search.*`. The groups' headings are visible text, and the context line is muted ink.
- Add the route to `role-probe.integration.test.ts` (guardian, student, maintenance → 403) and a cross-tenant test.
- **Security review required** (`poolse-security-review`): a new endpoint over minors' data.
- One line in `docs/features/navigation.md` (*Ctrl+K*) and a decision line.

### QA

1. Owner types *ines*: *Inês Silva* (accent folded) in Alunos e famílias, at most 5 rows, and Enter opens her record.
2. Owner types a guardian's full NIF: the guardian shows with *Encarregado de Inês Silva* and no NIF on screen. Typing 5 digits of that NIF finds nothing.
3. Owner types the last 9 digits of a phone with or without +351: found. Typing 4 digits of it: nothing.
4. **Instructor** types a name of a student in another instructor's turma: not found. A student of theirs is found. A NIF of their own student is not found (rule 4). Staff names and their own turmas are found.
5. **Maintenance / guardian / student**: `GET /search` → 403, and the palette shows pages only (role probe).
6. **Cross-tenant:** a name that exists only in club B never appears for club A (integration test with two clubs).
7. Input `%`, `_`, `'`, `;--`, a 300-character string, and *ç ã é*: no error, literal matching, and the long string is capped server-side (refused past 100 with a 400).
8. 1 character: no request is sent and only page results show.
9. Clubes: a reader in two clubs types the other's name, and choosing it switches club and lands on Início.
10. After a data search, `localStorage`'s recent list holds no name, id or term.
11. Phone width (backoffice under `md`): the palette's groups stack and are readable. Both themes are checked.

### Acceptance criteria
- [x] `GET /search` with role check first, RLS tenancy, `searchPredicate`, exact NIF, last-9 phone, ≤5 per group, throttle 60/min.
- [x] Results show name and context only; instructor scoped to own turmas and sports.
- [x] Palette groups; Clubes from `/me`; nothing personal in `localStorage`.
- [x] Role probe, cross-tenant and input tests green; `poolse-security-review` run.
