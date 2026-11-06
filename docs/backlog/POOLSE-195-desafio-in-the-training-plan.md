# POOLSE-195 · The instructor sets a *Desafio* in the training plan, and the student says after class whether they did it

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Classes / Mobile app · **Priority:** Medium (pilot) · **Depends on** [POOLSE-116](./POOLSE-116-lesson-feedback-from-the-family-app.md) · **Build after** POOLSE-194 (Rui, 06-11-2026)

### As built (06-11-2026)

- **Its own table, `lesson_challenge`,** not a column on `lesson_plan`: the plan refuses a blank body and deletes its row when emptied, and a Desafio stands alone.
- **Rule 10 changed:** removing a Desafio does not ask first, because each answer keeps the words it answered and nothing is lost.
- `app.feedback` answers carry `challenge_text`, and a lesson with no Desafio stores no answer.

### PO — why this exists

Rui, 06-11-2026: *"on 'Classes' training plan, add a 'Desafio' section to challenge the students to do something, this is not mandatory but should also reflect on the mobile app. The student on the app can then after the class set if it was successful or not the 'desafio'. This is created by the instructor, similar to the training plan, but a shorter text box of course."*

Then: *"a student first sees it as like 'plano de aula' and then on the class feedback when rating and giving feedback the student can choose if 'consegui' 'yes' or 'no'. So on the training plan is merely informative as a 'challenge' to try to do."* It sits *"below the training plan, as a section, but highlighted with a different color to be 'fun'"*.

**Not in scope:** points, badges or a leaderboard; a Desafio across several lessons; a Desafio with no lesson; push about one.

### BA — rules

1. A lesson may have one *Desafio*: a short text beside its training plan, written by whoever may write the plan. It is optional.
2. It is stored for the lesson's date as the plan is, so it survives a regenerated session.
3. Maximum 200 characters, counted on the screen.
4. In the app, it shows below *Plano de aula* as its own section, in a colour of its own, with a heading in words. It is read only there (Rui).
5. A family or student reads it when they may read the plan (`familyMayReadPlan`), and it can show with no plan beside it.
6. **The answer belongs to the lesson feedback** (Rui): a *Consegui* / *Não consegui* question joins *Como correu a aula?* when the lesson has a Desafio. It is optional, and the mood stays the required answer.
7. Its window and its right to answer are the feedback's own: the lesson ended, the student was present, within 7 days, and whoever may give feedback.
8. **Classmates see the results** (Rui), in POOLSE-194's list and under its rules: adults by name, minors as *Um aluno*. Instructor and office see them per student on the lesson.
9. A result is the student's own word, never a grade or a mark in the register.
10. Removing a Desafio with answers asks first, and the answers stay, with the text they answered.

### Dev notes

- **Use the `write-migration` skill.** A column on `lesson_plan` for the text, and `lesson_feedback.challenge_done boolean` (null means not answered). `lesson_plan` today refuses a blank `body`, so a Desafio with no plan needs that CHECK relaxed: one of the two must be present. Read `lesson-plans.repository.ts` before choosing, because the API deletes a row when the body is empty, and a Desafio must survive that.
- **Rule 10:** snapshot the text on `lesson_feedback`, or refuse to delete it. Choose the first, cheaper to reverse. Update the feedback trigger only if it needs the column.
- **Enum words:** no new enum. `Consegui` is a boolean with i18n keys.
- **Backoffice:** the field in `lesson-plan-panel.tsx`, and the plan's other readers (`calendar-week.tsx`, `session-actions.tsx`, `schedule-board.tsx`). A partnership group's plan may take a Desafio only if it has a family reader, which it has not, so leave it out.
- **App:** `aulas/[sessionId]/page.tsx` and `feedback-form.tsx`. The family app says the least it can. The colour is a token, measured in both themes.
- **Retention:** `apply_retention()` reads `lesson_feedback`, so check whether the new column needs erasing with it.
- **Trap:** a student marked absent can read the Desafio but not answer, since the feedback trigger refuses.
- Add the role probe's line for any new route.

### QA

1. Given an instructor of the turma, when they save a Desafio, then the app shows it below the plan in its section.
2. Given a Desafio and no plan, then it saves and shows.
3. Given 201 characters, then it is refused with the reason.
4. Given an instructor of another turma, then 403; a family writing, 403 (permission denial); another club, 404 (cross-tenant).
5. Given the lesson ended and the student present, when feedback opens, then the question shows; with no Desafio, it does not.
6. Given feedback saved with no answer to it, then it saves.
7. Given an absent student, or after 7 days, then the feedback's own refusal holds.
8. Given an adult's *Consegui*, then classmates see it by name; a minor's, as *Um aluno*.
9. Given a regenerated season, then the Desafio stays on its date.
10. Given a Desafio with answers, when it is removed, then it asks first and the answers keep their text.
11. Both themes and a phone width; the section's contrast is measured.

### Acceptance criteria

- [ ] The instructor writes it beside the plan; it is optional and short.
- [ ] The app shows it below the plan, in its own colour.
- [ ] The answer is part of the feedback and follows its rules.
- [ ] Results reach classmates only under POOLSE-194's rules.
- [ ] pt-PT and `en`; `docs/data-model.md`, `docs/features/classes.md`, `docs/features/app.md`.
