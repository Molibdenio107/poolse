# POOLSE-221 · A boletim de sócio or an FPN declaration dropped anywhere is read for its name and number, and offered to that student's *Documentos*

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Students / Documents / AI readers · **Priority:** Low (post go-live) · **Depends on** POOLSE-219, POOLSE-220, POOLSE-134 (boletim), POOLSE-142 (the club's own forms), POOLSE-137

### PO — why this exists

Rui, 11-11-2026: *"if a club drags a 'boletim de socio' file, the agent reads it and allocates it to the 'boletim de socio section'."* And: *"simply read the name and number on the document uploaded. Then 'boletim de socio' or 'FPN declariation' would behave the same way. If no name written it would be consider as the facilities template document."*

A signed boletim or FPN declaration is filed today from the student's own *Documentos* tab, so the office first finds the student and then uploads. This ticket turns that round: the paper is dropped, the reader copies out who it names, **Poolse's own query** finds that person in the club, and the office confirms. The model never sees the member list and never chooses the person.

**Not in scope:** the ID document (POOLSE-222, sealed, its own switch); a medical paper (never read by a model); creating a student from a paper; reading handwriting reliably, which is not promised; several papers in one file; the family app, where a family already sends a paper for its own child.

### BA — rules

1. A new reader, `person_document`, with its own switch `person_document_ai` and club tick, off by default. Off, the dialog of POOLSE-219 asks *de quem é?* with the person search, and the paper is filed by hand as today.
2. It runs only after the kind is known to be `socio_form` or `fpn_declaration` (chosen by the person, or identified by POOLSE-220) and the person presses *Ler o documento*.
3. It copies out what is written: the kind, the person's full name, date of birth, NIF, the sócio number, the ID document number if the form carries one, the época on an FPN declaration, and whether a signature is present. A field it cannot read is empty. It never infers.
4. Matching is Poolse's, inside the club, in this order: a checksum-valid NIF (`isValidNif`), then the sócio number, then name together with date of birth. A name alone never matches by itself; it only ranks the search.
5. One match: *"Arquivar em {nome}?"* with the kind and the época, and the paper's own name beside the record's so a person can compare them. Several or none: the person search, prefilled with the name read.
6. Confirming opens the student's *Documentos* tab with the file held for that section's own control, which files the `student_document` (`socio_form`, or `fpn_declaration` / `fpn_declaration_minor` with its `season_id`) exactly as a manual upload does: older copies kept, the write audited. Minor or adult is decided by the student's record, never by the paper.
7. A filled-in paper never changes the student's data. What the paper says and the record says may differ; the dialog shows both and changes nothing.
8. No name on the paper: the dialog opens with *Modelo do clube* preselected and *É de uma pessoa…* beside it. *Modelo do clube* goes to the site's *Documentos* tab, to the form's own upload (POOLSE-142), Owner and Admin only.
9. An instructor may file a paper only for a student of their own sports; the search and the match both obey it.
10. Support (a support grant) never runs this reader: the route calls `refuseSupport()` after the role check.

**Settled (Rui, 11-11-2026):** Rui's first rule was *no name means the club's template*. Rule 8 makes that a preselection a person confirms, and he agreed, because a blurred scan or handwriting the reader cannot make out also has "no name" and would silently replace the club's form.

**Settled (Rui, 11-11-2026):** the pilot's boletim is not believed to hold health information (*"i dont think so"*), so `socio_form` goes to the reader. Look at the club's actual form once before ticking the reader for a club; if it does carry a declaration of fitness or conditions, that club's boletim is filed by hand.

### Dev notes

- `AI_READERS` gains `person_document` with its switch and enum values, as POOLSE-220 did (`write-migration`). No new table: the result lives in the dialog and is never stored.
- `lib/person-document-agent.ts`, shaped as `id-document-agent.ts`: `guardAiCall(AI_ROLES.personDocument)` (owner, admin, instructor), `metered`, structured output validated with Zod, every string capped in length, dates parsed to `YYYY-MM-DD` or dropped.
- Matching is one repository function on the API that takes the extracted fields and returns at most five candidates through `student_person` (never `student`), under RLS, with the instructor's sport filter. It is a `POST` with the fields in the body, so a NIF never rides a URL or a log line. Grep `docs/data-model.md` for the columns before naming any; do not invent one.
- The extracted values are user input like any other: parameterised queries only, no value interpolated into SQL or into a second prompt.
- The trap: an FPN declaration needs its época, and `season_id` is null only for `socio_form`. Read the época from the paper as a proposal and let the section's control choose from the organization's seasons; never create a season.
- Audit: `student.document_read_by_ai` with the kind and the student once confirmed, never the extracted values.
- Security read: role first on the server action and on the match route; cross-tenant test on the match; nothing of the paper in logs or Sentry; the reader has no tools; the file reaches storage only through the existing control.

### QA

1. Given a signed boletim with a valid NIF of one student, when it is read, then *Arquivar em {nome}?* shows, and confirming files a `socio_form` on that student with the earlier copy kept.
2. Given a paper whose NIF belongs to a student of club B, when club A reads it, then no match is returned.
3. Given a name shared by two students and no number, then both are listed and neither is preselected.
4. Given a blank club form, then *Modelo do clube* is preselected, an Instructor is not offered it, and nothing is replaced until a person saves on the site's *Documentos*.
5. Given an Instructor and a paper of a student outside their sports, then the student is not found.
6. Given a paper whose text carries instructions to the reader, then the result is still only the validated fields, and the match query runs parameterised (assert with a name containing `'; drop table`).
7. Given the switch off, then *de quem é?* asks with the search and no model is called (no `ai_read` row).
8. Given a paper whose date of birth differs from the record's, then both are shown and the record is unchanged after filing.
9. Given a support grant, then the reader refuses.
10. Given a guardian calling the match route, then 403.

### Acceptance criteria

- [ ] `person_document` reader, gated and metered, off by default.
- [ ] The reader extracts; Poolse's query matches; a person confirms; the existing control files.
- [ ] NIF, then sócio number, then name with date of birth; a name alone never matches.
- [ ] No name preselects *Modelo do clube* and replaces nothing by itself.
- [ ] The student's record is never changed by a paper.
- [ ] Role, tenant, support and injection tests; pt-PT and en strings; `docs/features/students.md` and the readers' list in the conventions.
