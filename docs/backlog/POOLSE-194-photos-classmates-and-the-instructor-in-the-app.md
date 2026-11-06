# POOLSE-194 · A student's photo shows wherever they appear, and the app shows who is in the class and who teaches it

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Mobile app / Students / Interface · **Priority:** Medium (pilot) · **Depends on** [POOLSE-174](./POOLSE-174-inicio-is-the-next-lesson.md) · **Build after** POOLSE-193 (Rui, 06-11-2026)

### As built so far (06-11-2026)

- **Built:** the classmates list and the instructor on *Início* and each lesson (`GET /app/lessons/:id/classmates`), the family's own child's photo, tap to zoom (`components/app/photo-zoom.tsx`, shared with the logo), and the two widened photo rules in `files.repository.ts`.
- **The hidden students are one line** (*Mais 13 alunos · 4 vão*), not a row each: thirteen *Um aluno* rows pushed the rest of *Início* off the phone. It says *Um aluno* for one.
- **Listed by name:** the reader's own and adults, each *Vou* or *Inscrito*. Rule 9 asked for who answered *Vou*; Rui's first message also asked for who is *inscrito*.
- **On *Início*, past four people the rest fold behind *Ver todos*** (Rui, 06-11-2026).
- **The backoffice sweep:** the guardians list and the advancement cards were the two screens naming a student with no avatar. A text mention, such as a message's recipient or a dropdown option, stays text.
- **Not built:** the privacy notice, which is a go-live item in `docs/deploy.md`.

### PO — why this exists

Rui, 06-11-2026: *"when a student has a photo it should display as a small avatar everywhere the student is throughout the app and the mobile app also."* And: *"on the mobile app, 'inicio' a student should be able to see who's going or not (other students) - basically who's 'inscrito' and also who confirmed the 'Vou' 'não vou'. Every student should be able to visualize each other photos by clicking on them and see a zoomed picture. Also, the instructor of the respective class is not visible to the student. please fix. This should be applied to also all the next classes that a student can see on the mobile app that is enrolled of course."*

On minors, answering the privacy question: *"If minors are present on the class, dont show name or photo, just display like 'a student' or similar"*.

**This partly reverses a decision.** POOLSE-174 (05-11-2026) said *who's going is a count, not a roll*, and `docs/features/app.md` says *no other child's name reaches a family*. That sentence stays true: minors never appear. Adults now do. Rui decided this on 06-11-2026.

**Not in scope:** messaging between students; a student's profile page; any detail about a classmate beyond the name, photo and answer; a list across turmas; another turma's lessons.

### BA — rules

**Photos everywhere**

1. Every screen that names a student, in the backoffice and the app, draws `PersonAvatar` with their photo where one is allowed. Each screen is listed in the build's commit.
2. The consent rule is unchanged: a student's photo needs a live photo consent, and with none the initials show.
3. Who may read a photo stays as it is, plus rules 8 and 11.

**The classmates list**

4. It shows on *Início*'s next lesson and on every upcoming lesson a student is enrolled in, for that lesson's own turma.
5. Only a family or student with an active enrolment in that turma sees it. Another turma's lesson is a 404.
6. **A minor shows as *Um aluno*, with no name and no photo** (Rui). The reader's own child shows normally.
7. **Minor means not proved adult:** anyone `student_is_adult_path()` does not accept counts as a minor, so a missing or only declared date of birth hides the person, and so does a live guardian.
8. An adult shows as *Maria S.* and their photo, if photo consent is live, and a tap zooms the photo as the club's logo does (Rui). Adults cannot opt out (Rui). Their photo becomes readable by classmates of the same turma while both are actively enrolled.
9. **Vou by name, Não vou as a count** (Rui). The list shows who answered *Vou*, adults by name and minors as *Um aluno*, then *N inscritos*, and *N não vão* as a number. No reason is ever shown, and nobody is named under *Não vou*.
10. Everything is said in words, with no colour alone. Numbers are the same definition as today's (`ENROLLED_IN_SESSION`, `NOT_COMING_TO_SESSION`).

**The instructor**

11. The instructor's first name and photo show on the *Início* card and every upcoming lesson, with a tap to zoom. A stand-in shows as today's stand-in wording. With no photo, the initials show.

### Dev notes

- **Sweep first:** list every screen that names a student, then fix them. The ones with `PersonAvatar` today: register, turma page, student list and page, `NextLessonHero`, app Perfil. A list's API must start carrying `photoFileId`, gated as `PHOTO_KEY` gates it. Read `FROM student_person s`.
- **The hero** calls `PersonAvatar` with no `photoUrl` today, so a family's own child shows initials. Fix that with the sweep.
- **The list** is its own read, never added to `GET /app/lessons/:id` as names: the docs and `agenda.repository.ts` say that route carries numbers only. A new `GET /app/lessons/:id/classmates`, with the first line refusing by role and the family check of the lesson route. **Build the list in SQL**, returning no minor's name, id or file id to the client at all: a blank name is not enough if the id still travels.
- **Reading a photo:** `openFile` in `files/files.repository.ts` allows staff and the child's own family. Add the classmate rule in that query with a test, and a staff photo for a family with a live enrolment under that instructor. Check `IdPhoto`'s three homes, because an instructor's own photo is Clerk's.
- **Zoom:** extract the logo's `.logo-lightbox` into a shared `PhotoZoom` component rather than a second copy. It is a proposal the same size as the change, so do it here and name it in the commit.
- **Privacy:** update the privacy notice text so adults are told classmates see their name and photo. It goes on the go-live checklist in `docs/deploy.md`.
- **Update:** `docs/features/app.md`, `docs/conventions/` and the `CLAUDE.md` line on `IdPhoto`, in the commit.
- Run `/poolse-security-review`: a new read of other people's data, and a wider photo rule.
- **Trap:** a page of a list reading one photo per row. Keep it one query.

### QA

1. Given a student with consent and a photo, then every listed screen shows the photo; with consent withdrawn, initials.
2. Given a mixed turma, when a guardian opens the lesson, then their own child shows by name, other minors as *Um aluno*, adults as *Maria S.* with a photo.
3. Given the JSON of that read, then no minor's name, id or file id appears in it.
4. Given a student with no birth date or only a declared one, then they show as *Um aluno*.
5. Given an adult without photo consent, then their name shows with initials.
6. Given a *Não vou*, then the count rises and nobody is named under it.
7. Given a reader from another turma, then 404; another club, 404 (cross-tenant); an instructor or maintenance, refused where the route is not theirs (permission denial).
8. Given a classmate's photo URL, when an enrolled classmate reads an adult's, then it opens; when someone left the turma or reads a minor's, then it is refused.
9. Given a stand-in, then the app shows the stand-in, by name and photo.
10. Given a tap on a photo, then it zooms, and closes with a tap, Escape, and instantly with reduced motion.
11. Both themes and a phone width.

### Acceptance criteria

- [ ] A student's allowed photo shows on every listed screen, in the backoffice and the app.
- [ ] Every upcoming enrolled lesson and *Início* show the list and the instructor.
- [ ] No minor's name, id or photo reaches another family, proved by a test on the read.
- [ ] The wider photo rule is proved in both directions.
- [ ] *Não vou* is a number only.
- [ ] pt-PT and `en`; docs, the privacy notice item and `/poolse-security-review` done.
