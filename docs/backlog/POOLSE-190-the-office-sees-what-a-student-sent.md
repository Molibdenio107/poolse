# POOLSE-190 · The office sees at a glance that a student sent something, and the labels name who sent it

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Students · **Priority:** High (pilot) · **Depends on** [POOLSE-120](./POOLSE-120-attention-circles.md), [POOLSE-179](./POOLSE-179-documentos-in-the-family-app.md), [POOLSE-186](./POOLSE-186-a-declared-date-of-birth.md)

### As built (06-11-2026)

- **No migration.** `studentsToReview` in `students.repository.ts` is the one read, with the register's own `STUDENT_SPORTS`, and `Attention` gained `students`.
- **The label** is `submittedByRole` from `listPending`: the student's own `membership_id` is `student`, anyone else who may send is `guardian`.
- **`birthDateState` gained `idDocument`** (`pending`, `on_file`, `none`). It reads rows and opens no sealed file, so it audits nothing.
- **No jump to an anchor.** Both places the button lands sit at the top of the tab, and the frozen header hid a scrolled heading.
- **The banner shows the date given**, beside the hint, so the check can be made without leaving it.
- Walked in a browser in both themes and at a phone's width. The sender's name there was the fixture's blank, so *sem nome registado* was seen and a real name is covered by the API test only.

### PO — why this exists

Rui, 06-11-2026: *"if a student uploads a document Id or medical information, a notification (blinking ball) should be raised on the 'Students' menu and on the student list, besides the student name, when filter, no need to re-order the list"*. On the labels: *"if a student is >18 yo, there are some labels that say 'Sent by family or them' this does not make sense"*. On the banner: *"I like the 'confirm the date' section when a document is uploaded. Just highlight it a little bit more and redirect to which type of document was uploaded"*.

Today a family's upload waits on the student's page, and nothing outside that page says so. The office finds it only by opening the right student.

The banner is not raised by an upload: it shows when a person typed their own date in the app (POOLSE-186), and the check is against the ID. So the document it opens is always the ID.

**Not in scope:** a new filter on the list; re-ordering it; reading the date off the ID; messages (POOLSE-191); any change to what accepting or rejecting does.

### BA — rules

1. A student **needs review** when they have a pending `family_submission` of any of the five kinds, or a declared date of birth not yet confirmed (Rui, 06-11-2026, both answers).
2. The Alunos menu entry shows the circle, counting students, not documents. A sport's copy of Alunos counts only that sport's students; a student with no sport counts on the shared entry alone.
3. Each such student shows an `AttentionDot` beside their name in the list, in every filter. The order never changes (Rui).
4. Accepting or rejecting the last pending submission, and confirming the date, clears the student's dot and the menu's count.
5. Only owner and admin see any of it, because only they can act (`requireRole('owner', 'admin')` on the submissions routes). An instructor's list and menu are unchanged.
6. The label names who actually sent it, by the submitter's relation to the student, never by age (Rui): a guardian is *Enviado pelo encarregado*, the student's own login is *Enviado pelo aluno*. An adult in Poolse is the absence of a guardian edge, so a 19-year-old with a guardian still linked can truly be a guardian's upload.
7. The section's title stops saying *família*. It reads *Por rever: # documentos*, and each line carries rule 6's label with the person's name and the moment. The fallback `someone` stops saying *um membro da família*.
8. The banner gets stronger: the `pending` tone across its border and background, not only a badge, in both themes, with its state in words.
9. Its button opens the ID, on the student's Documentos tab, scrolled to it, and the confirm sits beside the document (Rui). A pending ID opens the submission, whose *Aceitar* already asks for the date and confirms it. An ID on file opens that entry, whose confirm is the existing `confirmBirthDateAction`.
10. With no ID anywhere, the banner says so in visible text and the button confirms directly, asking first, as today.
11. Opening an ID stays audited as every read of it is.

### Dev notes

- **Attention:** one branch in `apps/api/src/attention/attention.repository.ts` (`readAttention`), a new `students: Record<string, number>` on `Attention`, and `NOTHING` updated. Scope `office`, as `leads`. Reuse the existing verdicts: pending is `family_submission` with `decision IS NULL`, and read `listPending`'s own predicate rather than writing a second. Declared is `birth_date_declared_at` with `birth_date_verified_at` null; check `birthDateState` for the existing definition first.
- **Menu:** `badge: 'students'` and `badgePerSport` on the entry at `lib/nav-entries.ts`, with `leads:<sport>` as the pattern for the per-sport key.
- **Per-sport membership:** take it from the same join `?sport=` uses (`readSportFilter`) so the circle and the filtered list cannot disagree.
- **List:** `attention.students[row.id]` beside the name; `listStudents` is unchanged. `readAttention` is cached per request, so this adds one query, not one per row.
- **Label:** `Submission.submittedByRole`, derived in `listPending` from `submitted_by`. A guardian edge means `guardian`, the student's own `membership_id` means `student`.
- **No migration.**
- **Trap:** `attention.students` holds counts for a page of a list while the query covers the club. Do not page it, and do not add a per-row call in the list.
- **Trap:** a student archived with a pending submission must not count forever. Read through live students only.

### QA

1. Given a student with a pending exam, when an admin opens Alunos, then the menu shows the circle and the row shows a dot, and the order equals the same list with no pending document.
2. Given two pending documents on one student, then the menu counts 1.
3. Given a pending document, when an admin accepts it, then the dot and the menu's count clear on the next read.
4. Given a rejected document, then the same.
5. Given a declared date and no submission, then the dot shows, and confirming clears it.
6. Given a filter on sport or turma that holds the student, then the dot still shows.
7. Given a second sport on, then a student of that sport counts on that sport's Alunos, not another's.
8. Given an instructor, when they read `GET /attention`, then `students` is empty; the same read from the family roles returns nothing.
9. Given two clubs, when club A reads attention, then no student of club B appears (cross-tenant).
10. Given an adult with no guardian who uploaded, then the line says *Enviado pelo aluno*, with no *família* on the page.
11. Given a 19-year-old whose linked guardian uploaded, then it says *Enviado pelo encarregado*.
12. Given a declared date and a pending ID, when the button is pressed, then the Documentos tab opens at that submission.
13. Given a declared date and an ID on file, then it opens that ID with the confirm beside it, and the read is audited.
14. Given a declared date and no ID, then the banner says so and the button asks first and confirms.
15. Both themes and a phone width: the banner's contrast, and the dot beside a long name.

### Acceptance criteria

- [ ] The circle shows on Alunos and its sport copies, and a dot on the list row, for the five kinds and a declared date.
- [ ] The list's order is untouched, in every filter.
- [ ] Each clears when the thing is done, with no second definition of pending.
- [ ] Owner and admin only, proved against the endpoint.
- [ ] No label on the student's page says *família* for someone who is not; the label comes from the sender.
- [ ] The banner is stronger in both themes and opens the ID, or says there is none.
- [ ] pt-PT and `en`; `pnpm i18n:check` and `pt:check` pass.
- [ ] `docs/features/students.md` and the `CLAUDE.md`/`interface.md` circle note updated if a key was added.
