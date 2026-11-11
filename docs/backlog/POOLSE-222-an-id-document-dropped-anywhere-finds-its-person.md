# POOLSE-222 · An ID document dropped anywhere is read for its name and number, and offered to that person's own sealed slot

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Students / Staff / Identification / AI readers · **Priority:** Low (post go-live) · **Depends on** POOLSE-219, POOLSE-221 (the match), POOLSE-149 and POOLSE-179 (the sealed ID document), `id_document_ai`

**Re-confirm before starting.** This is the risky one of the four: an identity document is the most sensitive file a club holds after health data. It is its own ticket so the other three can ship without it. **Fallback, already true after POOLSE-219:** the dialog asks *de quem é?*, the file goes to that person's *Identificação*, and the existing in-page reader proposes the number and dates there.

### PO — why this exists

Rui, 11-11-2026: *"Same for ID fotos, if a owner /admin drags it to the poolse, AI agent reads it and see to whom it belongs."* Then: *"for the ID document not do a facial recognition but simply read the name and number on the document uploaded."*

**Decided (Rui, 11-11-2026):** Poolse never recognises a face. A person is found by what is printed on the document, and only that. This is also written into `docs/decisions.md`, because matching faces is biometric processing of mostly minors and is not something a later session should rediscover as a nice idea.

The reader exists (`lib/id-document-agent.ts`, type, number and dates, proposed and confirmed). This ticket lets it also copy out the holder's name, so a document dropped away from a person's page can be offered to the right person.

**Not in scope:** any comparison of a photograph with a person; reading a photograph of a person at all (an `IdPhoto` is placed by the picker of POOLSE-219, never by a model); a second copy of the document anywhere; changing who may open a sealed document.

### BA — rules

1. Owner and Admin only. Anybody else is not offered *Documento de identificação* in the dialog.
2. It runs only with `id_document_ai` on, the club's tick, and after the person presses *Ler o documento*. Off, the fallback above applies.
3. The reader returns what it returns today plus the holder's full name and date of birth, as printed. It is told to ignore the photograph and describe nobody.
4. Matching is POOLSE-221's: the document number against the one on record, then name together with date of birth. Students and staff are both searched; a person who is both is offered once, and the dialog asks which record.
5. One match: *"Guardar no registo de {nome}?"*. Several or none: the person search. No match never creates a person.
6. Confirming opens that person's *Identificação* with the file held for the slot's own control. It is sealed there as today (`student_id_document` or `staff_id_document`), the read is audited, and the number and dates are proposed in the form for a person to save.
7. Between the drop and the confirm the file exists only in the browser and in the one request to the reader. It is never written to storage unsealed, and a cancelled dialog leaves nothing.
8. Each read by the model is audited with who asked and, once confirmed, for whom; never the number.
9. Support never runs it (`refuseSupport()`).

**Open:**
1. Whether the reader may run on staff documents at all, or students only, in its first version. Default: both, Owner only for staff.

**Settled (Rui, 11-11-2026):** this ships as a patch during the pilot without waiting for GDPR advice (*"it would be for an patch update for the pilot still, so i think it can go without that"*). What stays: the confirm step carries one visible line saying the club keeps this copy with the holder's agreement, because copying an identity card generally needs the holder's consent and that is the club's to obtain; and the reader stays off per club until Rui ticks it.

### Dev notes

- No new reader: `IdDocumentDraft` gains `holderName` and `birthDate`, and the system prompt gains its two lines. The in-page use ignores them.
- The match route is POOLSE-221's with a second input shape; it reads a stored ID number only to compare, inside the definer or repository path that already reads it, and returns candidates without the number.
- Sealing is the slot's own route and trigger (`student_document_id_sealed`, the staff equivalent). Do not add an upload path. `holdFile` carries the bytes across the navigation exactly as for any other destination.
- The trap: the browser preview. Do not render the dropped ID in the dialog as an object URL that outlives it; revoke it on close.
- Security read: role first; cross-tenant on the match; no number, name or image in logs, Sentry or `ai_read`; `private, no-store` on anything that returns a candidate; the audit lines exist and name nobody's number.

### QA

1. Given an Admin and the switch on, when a Cartão de Cidadão whose number is on a student's record is read, then that student is offered, and confirming seals the file on their *Identificação*.
2. Given an Instructor, then *Documento de identificação* is not offered, and the server action refuses a direct call.
3. Given the switch off, then the dialog asks *de quem é?* and no model is called.
4. Given a document of nobody in the club, then the search opens and no person is created.
5. Given a document whose number matches a person in club B only, then club A sees no match.
6. Given a cancelled dialog, then no `stored_file` row and no bucket object exist for the drop.
7. Given a confirmed read, then the audit log holds the read and the filing, and neither holds the number.
8. Given a support grant, then the reader refuses.
9. Given a person who is both staff and a student's encarregado, then they are offered once and the record is asked.
10. Given a photograph of a person (no document), then no reader is called and the picker of POOLSE-219 asks whose it is.

### Acceptance criteria

- [ ] No face is ever compared or described; a photograph of a person never reaches a model.
- [ ] Owner and Admin only, behind `id_document_ai`, the club's tick and an explicit press.
- [ ] Number first, then name with date of birth; no match creates nobody.
- [ ] The file is stored only sealed, only through the slot's own control; a cancel leaves nothing.
- [ ] Reads and filings audited without the number; support refused.
- [ ] The consent line on the confirm step; pt-PT and en strings; `docs/features/students.md`, `docs/features/files.md` and the conventions updated.
