# POOLSE-218 · A child's access is the guardian's: *Convidar aluno* asks who will use the app, and a login that turns out to be a parent's can be handed to them

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Bug + Feature · **Area:** Students / Families / Invitations · **Priority:** High (pre go-live) · **Depends on** [POOLSE-129], [POOLSE-186], [POOLSE-206] · **Unblocks** the TEST-PLAN family checks

### PO — why this exists

Rui, 10-11-2026, walking the go-live test: *"i invite a student as guardian e-mail so that guardian can register its 2 yo son (whom is the actual student). Then the guardian register the birthday of their son. Then owner/admin confirms the date on backoffice. The app seems to treat that student as a normal adult one, it should require the guardian contacts and details, right? How can we make this work?"*

What happened: *Convidar aluno* (POOLSE-129, Rui 30-10-2026) invites **the student themselves** and waives the 12-year rule because the new record has no birth date. The parent's email went into it, so the parent's login became the child's own login. Then the parent entered the child's date of birth in their own profile, and POOLSE-186 copied it from the login onto the record as declared. Finally the office confirmed it. The result is a two-year-old who signs in as himself: no `guardian_link`, no guardian contacts, and the family app greets the parent as the student.

Nothing in the product stops this. It is the obvious thing to try, because the office has a parent's email and a child's name. The right path exists: *Novo aluno* → add the encarregado → *Acesso à app* → invite the guardian's row. But nothing leads the office there.

The fix has two parts. **The door:** *Convidar aluno* asks who will use the app. **The safety net:** a record already wired this way can be turned round in one action.

**Not in scope:** changing the 12-year rule (`self_answer_min_age()`); a family adding a second child from the app (POOLSE-69's *Inscrever* already does that); merging two guardians; the adult and acompanhante paths (POOLSE-206/207), which this ticket does not touch.

### BA — rules

1. **The door.** *Convidar aluno* opens on one question, *Quem vai usar a app?*, with two cards:
   - *O próprio aluno* — today's form, unchanged (name, surname, phone and/or email). The hint under the card says *Para alunos a partir dos 12 anos.*
   - *Um encarregado de educação* — the child's first name, surname and **date of birth (required)**; then the guardian's first name, surname, email and/or phone, and *Tipo de ligação* preset to *encarregado de educação*.
   One submit, one transaction (Decided: Rui, 10-11-2026).
2. **The guardian option** creates the student (the ordinary insert, with the date as the office's, not declared), the guardian person (a membership with no login, carrying the guardian's name and contacts, as the record's guardian form makes it), a `guardian_link` (`parental`, `is_primary`), and an invitation naming **the guardian's membership** (`roles = {guardian}`). It emails when there is an address and returns the link for *Partilhar*, like today.
3. **A date under 12 on the student option is refused** with 422 `child_needs_guardian`, which names the guardian option. This applies whenever a date is given. With no date, today's waiver stays (an adult signing up their own place).
4. **The safety net.** The record shows a warning on *Geral* and on *Acesso à app* when all three hold:
   - a student's own membership has a login (`student.membership_id` → `membership.app_user_id`);
   - the record's date of birth is confirmed (not `birth_date_declared_at`);
   - the age is under `self_answer_min_age()`.

   The warning reads *Este acesso é do próprio aluno, mas o aluno tem {idade} anos.* Its action is **O acesso é do encarregado** (owner, admin). It is a warning, never a gate (CLAUDE.md: a warning about a person never gates what a club does with them).
5. **O acesso é do encarregado** asks first (*A pessoa que entra na app passa a ser o encarregado de educação de {nome}*). Then, in one transaction:
   - the membership loses `student` and gains `guardian`;
   - `student.membership_id` becomes null;
   - a `guardian_link` (`parental`, `is_primary` when the record has no primary) joins the student to that membership;
   - **the login's own `app_user.birth_date` is cleared when it equals the student's date**, because it is the child's date typed into the parent's account (POOLSE-186 put it there);
   - each consent recorded as signed by the student themself is marked as needing the guardian's signature (**Decided** (Rui, 12-11-2026): archive them, so the guardian is asked again on their next visit).

   The login keeps its email, name and sessions. Only what it is to the club changes. Atividade records it, with who acted.
6. **After the turn,** the record's *Contactos* show the guardian, read through from the login (`person_phone`, `person_email`). The guardian block's missing details are asked the way the guardian path already asks them. The family app opens on *Os meus educandos* at the next request.
7. **Who may.** Owner and admin, for both parts. An instructor is refused (403); a support session is refused, as it is for every invitation.

### Dev notes

- **Read first:** POOLSE-129 (`docs/features/students.md`, *Acesso à app*), POOLSE-186 (declared date, `student.birth_date_declared_at`), POOLSE-206 (`guardian_link.kind`), and `docs/conventions/students-and-families.md` (an adult is the absence of the edge, never a flag).
- **API.**
  - The door: `POST /family-invitations/new-student` gains `for: 'self' | 'guardian'` and the guardian's fields. Keep one endpoint, because the 409 `email_taken` and no-student-left-behind rules are already right there.
  - The safety net: `POST /students/:id/access/hand-to-guardian`. `requireRole('owner','admin')` on its first line, then `refuseSupport()`.
- **The predicate in rule 4 is SQL**, one function (`student_login_too_young(student_id)` or a column on the record's read). It is derived once, on the server; the screen never computes an age.
- **Migration** (`write-migration`): only if the predicate is a function. No new table. If consents need a status rather than archiving, that is the only schema change; take the archive default unless Rui says otherwise.
- **The trap:** `membership` CHECK `app_user_id is null or (first_name, last_name, email are all null)`. The turned membership keeps its login, so do not write a name onto it. The guardian's name reads from `app_user`.
- **Second trap:** `student_person` reads an adult-path student's name and email from the login. After the turn the student has no `membership_id`, so it reads the record's own columns. Make sure the record's own `first_name`/`last_name` hold the child's name before you null the link: *Convidar aluno* wrote them, but check.
- `TENANT_TABLES` is unchanged (no new tenant table). Docs: `docs/features/students.md` (both parts), `docs/data-model.md` only if a function is added, `docs/decisions.md` (one line).
- **Test record in the dev DB:** *Rui Aluno*, student `7a7b98e7-5e9e-4705-90cd-908a4029e10b`, whose own login is `rui.fonseca.107+guardian@gmail.com`, born 07-11-2024, date confirmed. It is kept on purpose (Rui, 10-11-2026) to try the safety net on.

### QA

1. **Given** the owner on *Convidar aluno*, **when** they choose *Um encarregado de educação*, enter a child born 07-11-2024 and a guardian with an email, and submit, **then** one student, one guardian membership, one parental primary link and one `{guardian}` invitation exist, the student has no login, and the link is shown.
2. **Given** that invitation, **when** the guardian accepts it, **then** the family app opens on *Os meus educandos* with the child, and the record's *Contactos* list the guardian first.
3. **Given** the student option with a date under 12, **when** submitted, **then** 422 `child_needs_guardian` names the guardian option, and no student is left behind.
4. **Given** the student option with no date, **then** it behaves exactly as today (adult signing up their own place).
5. **Given** *Rui Aluno* (own login, confirmed age 2), **then** *Geral* and *Acesso à app* show the warning with *O acesso é do encarregado*.
6. **Given** that warning, **when** the owner confirms *O acesso é do encarregado*, **then**:
   - the login holds `guardian`, not `student`, and `student.membership_id` is null;
   - a parental primary link exists, and `app_user.birth_date` (07-11-2024) is cleared;
   - Atividade has the entry;
   - the warning is gone;
   - the parent's next visit opens *Os meus educandos*.
7. **Given** a student with an own login aged 12 or more, or a declared (unconfirmed) date under 12, **then** no warning shows.
8. **Permission:** an instructor's `POST /students/:id/access/hand-to-guardian` is 403. A support session's is refused. The control is absent for both.
9. **Cross-tenant:** the same POST with another club's student id answers 404, and nothing changes.
10. **Both themes, desktop and phone:** the two *Convidar aluno* cards and the warning read correctly; the chosen card shows a border, a tint and a tick, so colour is not the only sign.

### Acceptance criteria

- [x] *Convidar aluno* asks *Quem vai usar a app?*; the guardian option creates student, guardian, parental link and guardian invitation in one transaction (QA 1–2).
- [x] A date under 12 on the student option is refused with `child_needs_guardian` (QA 3); no date behaves as today (QA 4).
- [x] The warning shows exactly when a student's own login has a confirmed age under `self_answer_min_age()` (QA 5, 7).
- [x] *O acesso é do encarregado* turns the login into the guardian, links them, clears the copied birth date, and is recorded (QA 6).
- [x] Owner and admin only, refused server-side, support refused; cross-tenant 404 (QA 8–9).
- [x] pt-PT and en strings, both themes, phone width (QA 10); docs and `decisions.md` updated in the same commit; the palette offers nothing new (no new page).
