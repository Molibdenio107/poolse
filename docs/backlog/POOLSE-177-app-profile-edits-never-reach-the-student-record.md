# POOLSE-177 · A profile edit in the app never reaches the student's record: the phone writes `app_user`, the backoffice reads `student` — decide the owner of each field and read through

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Bug · **Area:** Mobile app / Students / Data model · **Priority:** High (pre go-live) · **Depends on** [POOLSE-131](./POOLSE-131-student-identity-and-address.md), [POOLSE-129](./POOLSE-129-families-invited-from-the-student.md) · **Unblocks** [POOLSE-176](./POOLSE-176-perfil-reads-first-edits-second.md) (safe to ship first; this one decides what the form means)

### PO — why this exists

Rui, 05-11-2026: *"the details changed on mobile do not seem to change the student database view on the desktop app for my owner view — avisos and requests seem to work, but check if everything is well connected."*

Checked, 05-11-2026. It is connected exactly as designed, and the design is the bug. The app's *Perfil* is `ProfileForm`, which calls `PUT /me/profile`: the name goes to Clerk, `birth_date` and `contact_phone` go to **`app_user`** (`docs/data-model.md`, decision 3). The backoffice's student page reads **`student`** — its own `first_name`, `last_name`, `birth_date`, `contact_phone`, `contact_email`. Nothing joins the two: `student.app_user_id` links them, and no read, trigger or sync follows the link. Avisos and pedidos work because they are keyed by `student.id` and never touch a person's fields.

Two cases hide inside one form:

- **An adult student** (`student.app_user_id` set, their own login). Here there is one person and two records, and the owner's view is wrong the moment the student edits their phone on the phone.
- **A guardian.** The phone's *Perfil* is the **guardian's** profile. It is right that editing it does not change the child's record — but the owner expects to see the guardian's new phone on the child's *Contactos*, and today `guardian_link` reaches a `membership`, whose phone is `membership.phone` only where there is no login; with a login it is `app_user.contact_phone`. Whether the student page reads that through `person_*` helpers is to be verified (Dev notes).

**Not in scope:**
- Letting a guardian edit the **child's** fields from the app (name, birth date, NIF, address). Office only, as today; a family asks through a pedido. **(Rui to confirm; default: no.)**
- Changing what Clerk owns (name, email, photo).
- The student's identity fields (POOLSE-131) — read-only everywhere but the office.

### Decided before building (Rui, 05-11-2026) — wins over BA and Dev notes below

- **The link is `student.membership_id` → `membership.app_user_id`, not `student.app_user_id`**, which no code writes (0 of 540 dev rows). The CHECK, the backfill and `student_person` key on the real link.
- **Adult-path students only.** A minor with a login (from 12) keeps the club's record.
- **Backfill:** the office's value wins for birth date and phone and is written to `app_user`. Clerk wins for name and email, because a value written to the cached columns is overwritten at the next sync; the old value stays in the audit row.
- **Two evenings, schema first.** `first_name` / `last_name` are `NOT NULL`, two indexes (`student_search_idx`, `student_sort_name_idx`) cannot follow a join, 14 SQL functions read these fields, and the API has at least 77 direct uses in 20 files. List them all before starting.
- **Still to settle while building:** `app_user` is global, so BA 5's office edit reaches every club that person belongs to.

### As built (05-11-2026) — wins over everything below

- **No CHECK and nothing nulled, a consequence of adults-only.** The adult path is derived and a birthday writes nothing, so a CHECK cannot hold it, and a null birth date would take the student off the path. `student_person` reads through instead, and the columns stay as the record and the fallback.
- **Reads:** every query that shows a person selects from the view, by a swap of `FROM student s`; 24 reads use only ids and stay. Rules stay on `student.birth_date`, so an adult who changes their birth date in the app changes what the record shows and not their FPN age group.
- **The backfill leaves out a login with a membership in another club.** The old `app_user` values it replaced are not in the log, as with every withheld field; the audit row names the fields.
- **BA 5 stands as written:** the office's correction of a birth date or phone reaches every club that person belongs to, because it is one account. Not limited, since the app's login cannot see other clubs.
- **A record with no birth date reads through for the display** (Rui's own test account, 05-11-2026: nothing moved in either direction, because the view judged the adult path from the blank date). Needs no live guardian and an adult date on the login. `student_is_adult_path()` is untouched, so self-signed consent still needs the club's date.
- **An anonymised student never reads through.** The Alunos list loses its sort index: about 14 ms on 400 students.

### BA — rules

1. **A field has one owner** (restating decision 3): where `student.app_user_id` is set, the student's `first_name`, `last_name`, `birth_date` and `contact_phone` **are** the `app_user`'s, read through. The columns on `student` stay for the student with no login. A CHECK mirrors `membership`'s: `app_user_id is null or (first_name, last_name, birth_date, contact_phone, contact_email are all null)`.
2. **Backfill before the CHECK.** For every student with `app_user_id` set and own values, the student's values win where they differ from `app_user` (the office typed them on purpose) and are written to `app_user`, then nulled on `student`. The migration logs each overwrite to the audit log as a platform write. **Open:** whether to prefer `app_user` instead; default as stated.
3. **A guardian's contact reads through too.** The student's *Contactos* shows each guardian's phone and email via `person_phone(membership_id)` (new, beside `person_name` and `person_email`), so a guardian's edit on the phone is on the child's record on the next read.
4. **The app's *Perfil* says whose profile it is.** Under the name: *A sua conta* for an adult; for a guardian, *Encarregado de educação de Mariana e Tomás*. A guardian never sees a child's birth date on *Perfil*.
5. **The office's edit of a linked student's name is refused** with *Este aluno gere o seu nome na app* (409 `field_owned_by_app_user`), the same sentence the staff record uses for a linked membership. Birth date and phone: the office may edit them and they land on `app_user` (an office correction of an adult's phone is a real case). Every such write is audited against the student.
6. **The owner sees a change within one read.** No cache sits between `PUT /me/profile` and `GET /students/:id`.

### Dev notes

- Migration (`write-migration` skill): the CHECK on `student`, the backfill with audit rows, `person_phone()`. `student_search`'s name index and the Alunos table (POOLSE-164) read `first_name` directly — they must switch to the resolved name (grep for `s.first_name` in `apps/api/src/students/**` and in `student_search`). **This is the trap**: a half-switch leaves the list and the record disagreeing.
- `GET /students/:id` and the list use a `student_person` view (resolved name, birth date, phone, email) rather than each query repeating the COALESCE.
- `PUT /me/profile` is unchanged; the student record simply reads through.
- `PUT /students/:id`: refuse name fields when `app_user_id` is set; route birth date and phone to `app_user` inside the same transaction with an audit row on the student.
- Tenant isolation test: a student linked to an `app_user` in another tenant cannot exist (the composite FK on `membership` already prevents it — assert it for `student.app_user_id` too, which today is a plain FK; check `docs/data-model.md` line ~404).

### QA

1. Given an adult student with a login, when they change their phone in the app, then the owner's student page shows the new phone on the next load.
2. Given a guardian with a login, when they change their phone in the app, then the child's *Contactos* shows it; the child's own fields are unchanged.
3. Given the office edits a linked adult's name, then 409 with the sentence; given the office edits their birth date, then it is saved on `app_user`, the app's *Perfil* shows it, and the audit log names the student.
4. Given the backfill on a seed where `student` and `app_user` disagree, then `app_user` carries the student's value afterwards and an audit row per overwrite exists.
5. Given a student with no login, then nothing changes (snapshot of the record and the list).
6. Given the Alunos table (POOLSE-164) and the Ctrl+K search, then a linked student is found by their Clerk name.
7. Cross-tenant: `student.app_user_id` pointing at an `app_user` whose only membership is in another tenant is refused by the schema.

### Acceptance criteria
- [x] One owner per field; the student record reads through `app_user` where linked (adult path).
- [x] Guardian contacts read through; a guardian's app edit shows on the child's record.
- [x] Backfill audited; isolation test green. ~~CHECK in place~~: see *As built*.
- [x] Name, list and search agree for a linked student; QA 1–7 green.
