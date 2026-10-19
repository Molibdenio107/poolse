# POOLSE-81 · The competition pathway, and meet results from a LENEX file

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Students / Competition · **Priority:** High — the pilot club asked for it · **Depends on** B6 (`student_record`, personal bests), POOLSE-19 (level advancement), POOLSE-20 (skills)

### PO — why this exists

The pilot club has a federated competition team, and it suggested this feature itself. Today a
swimmer's path from the swim school to the team happens outside Poolse. So do their meet results.

**How it works in Portugal**, from the FPN's own documents:

- Only swimmers registered with the FPN may compete. Each holds a **licence number**, and needs a
  valid sports medical exam recorded in the FPN's system (fpnsystem).
- Qualifying is by time. A championship publishes entry times per age group. Times from 25 m and
  50 m pools are kept apart and never converted.
- Clubs enter meets with **Splash Entry Editor / Team Manager**. They email the FPN a `.lxf` file,
  which is **LENEX**, the sport's open XML format. Results come back in the same format, from Meet
  Manager or from swimrankings.
- The FPN's *Portugal a Nadar* certification asks a tier-3 swim school to send swimmers to
  competition every year.

The pilot club's coach already runs entries in Splash. **Poolse does not replace that.** It covers
what Splash does not: the pathway from the school to the team, and a result that reaches the
swimmer's record, the progression chart and the family's view without anybody retyping it.

Poolse already stores times (`student_record`, integer milliseconds) and personal bests (B6). Two
things are missing: whether a time was swum in a 25 m or a 50 m pool, and whether it was swum at a
meet. Without the first, every personal best mixes two kinds of pool.

**Not in scope** (each is a follow-up ticket of its own):
- **Gap to qualify.** The FPN entry times per federation age group and season, compared with a
  swimmer's best valid time. This is the slice after this one, and it is what B6's note on
  `fastestStroke` was waiting for.
- **Exporting entries or athletes** to Splash as LENEX. Entries stay in Splash.
- **Convocatórias** to families with confirm/decline, meet logistics, and meet fees as a charge.
- **Sports medical exam expiry**, federation registration and insurance as `fee_kind`s.
- **A stopwatch** in the instructor app.
- **Training volume**, season planning, and wearable swim data.
- Relays, splits, reaction times, heats and lanes. Meet management stays Splash's.

### BA — rules and data

**The pathway is the existing ladder, not a second one.** Pré-competição and Competição are levels
in the club's ladder (`student_level`), ordered like the rest. POOLSE-19 already proposes the next
level when a swimmer's skills are attained, so a swim-school student is proposed for pré-competição
with no new mechanism. This follows the rule in `students.md`: senior levels sit in the same ladder,
not a parallel programme.

- A level gains **`competitive`**, a flag that is off by default. It marks the levels whose swimmers
  compete, and it drives two things in this ticket:
  - the missing-licence warning;
  - the *Equipa* filter on Provas.
- **"Escalão" means two things here, and they must not meet.** In Poolse it is the club's own level
  (`student_level`). In the FPN it is an age group fixed by birth year and season (Cadetes, Infantis,
  Juvenis, Juniores, Seniores, with girls a year earlier). This ticket uses neither of the FPN's.
  The follow-up adds the FPN's as their own table. It must never become a `student_level` row.

**A swimmer carries their FPN licence number.** It is optional, unique per club among live
students, and stored as text, because the FPN's format is not ours to validate.
- A student in a `competitive` level with no licence gets a warning on their page and on the
  Provas results. The warning blocks nothing.
- The licence number is part of the student form, so it goes into the student import/export mapping
  in this ticket (Excel parity).

**A time states its pool length.** `course` is `scm` (25 m) or `lcm` (50 m).
- Every existing row is null, which reads as *piscina não indicada*. Poolse never guesses it.
- A typed time asks for it, with the facility's own pool length pre-filled when the turma's pool has
  one.

**A meet is a record, and its results are times.** `swim_meet` holds:
- the meet's name and city;
- its course and its first and last day;
- `official`;
- which file it came from, and who imported it and when.

A result is an ordinary `student_record` that names its meet. So it shows up in the student's
history, the progression chart, the personal bests and the family's Progress tab, all of which
already exist.

**Personal bests are per stroke, distance and course.**
- The student page shows the best per course. A 50 m best and a 25 m best are two figures, never one.
- A meet result is marked as such. Where the two differ, the page shows both the best time overall
  and the best *at an official meet*, because the second is the one qualifying will read.

**Importing a results file** follows the same steps as every other importer: upload → preview →
commit, one route with a `commit` flag.

- **Accepted files:** `.lef` (XML), and `.lxf` (a zip holding one `.lef`). Up to 10 MB.
- **What is read:**
  - `MEET`: name, city, course;
  - `SESSION`: date (a session's course overrides the meet's);
  - `EVENT` → `SWIMSTYLE`: distance, stroke, relay count;
  - `CLUB`;
  - `ATHLETE`: names, birth date, gender, licence;
  - `RESULT`: event, swim time, status.
- **Which club is ours.** A results file holds every club at the meet. The preview lists them, and
  the operator picks this club. The choice is remembered as `organization.federation_club_code` and
  pre-selected next time. Only that club's swimmers are read.
- **Matching an athlete to a student:**
  1. Licence number equal to a live student's: matched.
  2. Otherwise, surname, first name (accent- and case-folded) and birth date all equal: proposed. The
     operator confirms it on the preview. A student who has no licence yet gets it written, which is
     ticked by default.
  3. Otherwise: unmatched. The athlete is listed on the preview and nothing is written for them.
     Creating a student from a results file is out of scope, because a results file is not a
     registration.
- **What is written:** one `student_record` per individual result with a time.
  - Strokes map as follows: FREE → freestyle, BACK → backstroke, BREAST → breaststroke,
    FLY → butterfly, MEDLEY → medley.
  - `swum_on` is the session's date.
- **What is skipped, and counted on the preview:**
  - relays (`relaycount` > 1);
  - DSQ, DNS, DNF, WDR, or a time of NT;
  - yards courses;
  - any stroke outside the enum.
- **Importing the same file twice changes nothing.** A meet is identified by its name and first day.
  A result is identified by meet, student, event number and round, because a heat and a final are
  two real results (B6 already allows that).
  - A second import of an unchanged file previews *nothing new*.
  - A changed time (the organisers corrected a result) previews as an update. The commit writes it
    through the record's own path, with an audit entry.
- **The preview marks a new personal best** on each row, derived on the server.
- **`official`** is ticked by default for an imported meet. A friendly meet can be unticked. A typed
  time is never official.

**Provas** is a list under Alunos.
- It shows the meets, newest first, and is paginated (it grows with the club).
- A meet's page shows the club's results with their PB marks and the swimmers left unmatched.

**Who may do this:** Owner, Admin and Instructor. That is the same set that writes `student_record`
today. A family sees its own child's results through the existing Progress tab and nothing else from
Provas.

**Answered (Rui, 19-10-2026):** every instructor imports, matching who may type a time today.

**Answered (Rui, 19-10-2026):** yes. The time form names a meet — an existing one or one named
there — and may mark it official with no results file. Official is the meet's.

### Dev — schema, API, where it goes

**Migration:**
- `swim_course` enum (`scm`, `lcm`).
- `student_record`: add `course swim_course` (nullable) and `meet_id` (nullable, with a composite FK).
  Add a nullable `lenex_event_number` and `lenex_round` for the re-import key, and a partial unique
  index on `(organization_id, meet_id, student_id, lenex_event_number, lenex_round)` where
  `meet_id IS NOT NULL AND archived_at IS NULL`.
- `swim_meet`:
  - tenant-scoped, with RLS and `archived_at`;
  - `name`, `city`, `course`, `starts_on`, `ends_on`, `official`, `source_file_name`,
    `imported_by_membership_id`, `imported_at`;
  - a partial unique index on `(organization_id, lower(name), starts_on)`.
- `student.federation_licence` (text), with a partial unique index per organization among live rows.
- `student_level.competitive` (boolean, not null, default false).
- `organization.federation_club_code` (text, nullable).
- `swim_meet` goes into `TENANT_TABLES`.
- `federation_licence` is identity. It earns a line in `apply_retention()` and in
  `retention.integration.test.ts`. In `ChangeSpec` it is `withheld`.

**Personal bests:**
- `records.repository.ts` groups bests by `course` as well.
- It returns the official best beside the overall best.
- The B6 indexes gain `course`.

**Parser** (`apps/web/src/lib/lenex.ts`):
- A pure function: bytes in, the same field names the API's preview takes out. It is deterministic,
  with no model call and so no feature flag.
- The file is read on the Next server and never leaves it.
- Times convert from `HH:MM:SS.hh` to integer ms in one function, tested at the edges (sub-minute,
  over an hour, `NT`).

**API:**
- `POST /meets/import` with `commit`. Preview and write are one path.
- The commit is one transaction per file: a half-imported meet is a set of personal bests nobody can
  trust.
- `GET /meets` (paginated), `GET /meets/:id`, `POST /meets/:id/archive`. Archiving a meet archives
  its results, writes `data.cascade`, and is restorable through the bin (`RESTORABLE`).
- Every handler's first line is `requireRole('owner', 'admin', 'instructor')`.
- New endpoints go into `role-probe.integration.test.ts`.

**Web:**
- *Provas* in the sidebar, `TEACHING` roles.
- Meet page and import dialog use the full-page dropzone.
- *Licença FPN* on the student form and its General tab.
- The course select on the time form.
- The level form's *Competição* switch.
- The PB table split by course.

**What will be got wrong:**
- **XML parsed with entity expansion on.** A LENEX file comes from outside the club. Turn off DTDs
  and external entities, cap the unzipped size (a zip bomb is a 10 MB upload), and accept exactly
  one `.lef` inside an `.lxf`.
- **One personal best across 25 m and 50 m.** Every bests query and the chart's series must split
  by course.
- **Reusing `student_level` for the FPN's age groups** because both are called escalões.
- **Writing results for every club in the file.**
- **Creating students from unmatched athletes.**
- **Matching on name alone.** Two Joões Silva at one meet is ordinary; birth date is part of the key.
- **Reading a DSQ's time as a result.**
- **A re-import that duplicates** because the key ignored the round, or that drops the final because
  the key ignored it the other way.
- **Assuming the course is on the meet.** A session may override it.

### QA — test scenarios

1. **Given** a results file with this club and two others, **when** previewed, **then** only the
   chosen club's athletes are read, and the choice is pre-selected on the next import.
2. **Given** an athlete whose licence matches a student, **then** they are matched. **Given** no
   licence but an equal surname, first name and birth date, **then** they are proposed, and on commit
   the student gains the licence.
3. **Given** an athlete with the same name as a student but a different birth date, **then**
   unmatched, and nothing is written for them.
4. **Given** a 100 free in 1:02.34 in a 50 m session, **then** one record of 62340 ms, `lcm`,
   freestyle, 100 m, dated the session day, naming the meet.
5. **Given** a relay, a DSQ, a DNS and an NT, **then** none is written and each is counted on the
   preview.
6. **Given** a heat and a final of the same event, **then** two records.
7. **Given** the same file imported twice, **then** the second preview shows nothing new and the
   commit writes no rows. **Given** a corrected time, **then** one update with an audit entry.
8. **Given** a 25 m best of 1:00.00 and a 50 m best of 1:02.00, **then** the student page shows two
   bests, never 1:00.00 as the only one.
9. **Given** an existing time with no course, **then** it shows *piscina não indicada* and is never
   counted as either course.
10. **Given** a result that beats the swimmer's best, **then** the preview marks it as a new personal
    best.
11. **Given** a student in a `competitive` level with no licence, **then** a warning shows on their
    page, and they are enrolled and marked as before.
12. **Given** an `.lxf` holding two `.lef` files, a DTD with an external entity, or an unzipped size
    over the cap, **then** it is refused with a sentence and nothing is written.
13. **Given** a guardian or a student, **when** they call any `/meets` endpoint, **then** 403. A
    family sees its own child's meet results in Progress. Club B's meet is not found from Club A.
14. **Given** a meet is archived, **then** its results leave the bests and the chart, and restoring
    it from the bin brings back exactly those results.
15. **Given** a student export, **then** it carries the licence number, and re-importing it changes
    nothing.

### Acceptance criteria

1. A level can be marked competitive, and the existing advancement proposes swimmers into it with no
   new mechanism.
2. A student holds an FPN licence number, unique per club, warned about (never required) in a
   competitive level, and carried by the student import and export.
3. Every time states its pool length or says it does not, and personal bests are per stroke,
   distance and course, with the official best shown where it differs.
4. A LENEX results file (`.lef` or `.lxf`) imports this club's individual results through
   preview → commit. Athletes are matched by licence, else by name and birth date with confirmation,
   and the unmatched are listed and never created.
5. Re-importing a file changes nothing, and a corrected time updates with an audit entry.
6. Provas lists the meets, and each shows the club's results with new personal bests marked.
7. Results reach the student's history, chart and the family's Progress tab with no extra work.
8. The parser refuses external entities, nested archives and oversized files.
9. Owner, Admin and Instructor only, enforced in the API and probed for families.
