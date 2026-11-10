# POOLSE-213 · Alunos filters who has something to review, and *Fez 18 anos* moves onto the student

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Students / Attention · **Priority:** High (pre go-live) · **Depends on** POOLSE-190 (review circle), POOLSE-207 (Fez 18 anos), POOLSE-212 (bell)

### PO — why this exists

Rui, 10-11-2026: *"on 'students'. There should be a filter or, when a student has something to review, the notification system should show that or those students with something to review. 2. Then the sub menu 'Fez 18 anos' dont need to be there. Move it to each student page as a submenu from 'Geral' and only display it if that student reached 18 yo."* And: *"'Fez 18 anos' can display as a sub menu from 'geral' from students detail page, so besides 'medical' notes."*

The dots said *which* students; nothing listed only them. And *Fez 18 anos* was a menu entry for a list that is, case by case, a fact about one student.

**Decided (Rui, 10-11-2026):** a *Por rever* filter, which the bell's line opens. *Fez 18 anos* is a button on the student's *Geral*, beside *Notas médicas e consentimentos*, shown for a student of age who has, or had, a parent's link: pending, it offers the three actions; answered, it shows the decision. The old page redirects to *Alunos › Por rever*.

**Not in scope:** changing what counts as "to review" (POOLSE-190 and 207 define it); the actions themselves (POOLSE-207's, unchanged).

### BA — rules

1. *Por rever* (`?review=1`) lists exactly the students `studentsToReview` names, the dots' own verdict. It is the office's; a teacher's asking is no filter.
2. The bell's *N alunos com algo a rever* opens it; so do the *Alunos* banner and Ctrl+K (*Por rever*, with *fez 18 anos*, *maioridade* as synonyms).
3. *Fez 18 anos* shows on a student's *Geral* when the student is of age and has a live parent's link or a recorded decision. It breathes while unanswered.
4. Its screen (`/dashboard/students/:id/fez-18`): pending, the date, the parents, what changed and *Confirmar* / *É acompanhante* / *Convidar para a app*; answered, each decision in words with who and when.
5. The menu entry goes; `/dashboard/students/fez-18` redirects to `/dashboard/students?review=1`.

### Dev notes

- API: `review` on `GET /students` (`reviewIds` → `s.id = ANY($13)`); `GET /students/:studentId/majority` (`studentMajority`, reusing `majority_pending()` through `listTurnedOfAgeIn`). Owner and admin.
- Web: the checkbox-link on *Alunos*; `ActionButton` gains `attention`; `EntityIcon` `majority` (Cake).

### QA

1. Given a student who turned 18 with a parent's link, when the owner ticks *Por rever*, then only students with something to review are listed, that one included.
2. Given that student, then *Fez 18 anos* shows on their *Geral* with a breathing dot; given a minor, it does not.
3. When the owner answers *É acompanhante*, then the dot clears and the screen shows the decision.
4. Given an instructor, `GET /students/:id/majority` is 403.

### Acceptance criteria

- [x] *Por rever* filter, server-side, the dots' definition.
- [x] Bell, banner and Ctrl+K open it.
- [x] *Fez 18 anos* on the student, pending and answered states; the menu entry gone and its page redirecting.
- [x] Integration test for rules 1, 3, 4; pt-PT and en.
