# POOLSE-166 · Avisos: a notice with a date window that a student or family sees on opening the app, dismissed for the session, ended only by the office

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Students / Messages / Mobile app · **Priority:** Medium (pilot) · **Depends on** [POOLSE-67], [POOLSE-90], [POOLSE-118] · **Unblocks** [POOLSE-169]

### PO — why this exists
Rui, 04-11-2026: "we need to create another submenu for 'students' called 'Avisos' so, if an aviso has a date period and class, a student that belongs to that class and period when logs in onto the mobile app, sees and reads that aviso, then I can dismiss the aviso." Clarified the same day: "Avisos are not to send by email, it's just a minor warning or piece of information that displays when a student logs into the app"; "each person can dismiss it when they see it, but every time they log onto the app while the aviso has its period on they cannot dismiss it forever — only the owner/admin can do it."

Decided (Rui, 04-11-2026): reuse `message` with `channel = app`; owner/admin write, an instructor for their own turmas; families and students see it.

**Not in scope:** email or push for an aviso; a read receipt per person; rich text.

### BA — rules
1. `message.channel` (`email | app`, default `email`). An `app` message carries `shown_from` and `shown_until` (dates, club day, `shown_from ≤ shown_until`, by CHECK) and is never handed to `deliverMessage`; `address_count` is the audience size at creation as today.
2. Audience: the existing rule — turma, nível, instalação, desporto or clube; `message_recipients()` decides who, so an aviso to a turma reaches its active enrolments' families and students.
3. The app shows every live aviso for the reader's own students (`shown_from ≤ today ≤ shown_until`, not archived) as a sheet on entering `/app` and on the *Início* screen as a card; *Fechar* hides the sheet for the session (`sessionStorage`, try/catch) and the card stays. Next session the sheet comes back.
4. Only owner/admin end it early (archive, through the bin, restorable); an instructor archives only their own. Archived or past-window avisos vanish everywhere.
5. Backoffice: *Alunos → Avisos* lists them (live / próximos / passados), composes one with the Mensagens form minus the send; the daily ceiling trigger does not count `app` messages. **Open:** does an instructor's aviso to their turma need the office's approval? Default: no.
6. Palette: entry *Avisos* with synonyms *aviso*, *notice*.

### Dev notes
- Migration (`write-migration`): `message_channel` enum, two date columns, CHECKs: `(channel='app') = (shown_from IS NOT NULL)`; the ceiling trigger gets `WHERE channel = 'email'`. Column grants: `message` is archived never edited — keep.
- API: `POST /messages` takes `channel`; `GET /app/avisos` (family path, filtered by `message_recipients()` ∩ reader's students); `deliverMessage` early-returns on `app`.
- Web: `nav-entries.ts` entry under Alunos (`perSport: 'copy'`); app sheet `placement="sheet"`; body rendered as plain text — it is staff-written, but still never HTML.
- Trap: `deliverMessage` is called by the retry job too — the guard must be inside the sender, not only at the request.

### QA
1. Given an aviso to turma T, 05-11 → 12-11, when a guardian of a T student opens the app on 06-11, then the sheet shows it; after *Fechar*, the card remains; a new session shows the sheet again.
2. Given 13-11, then nothing.
3. Given a guardian of a student not in T, then nothing.
4. Given the retry job runs, then no email for the aviso.
5. Given an instructor of T, when posting to T, then 201; to U, 403; archiving the office's aviso, 403.
6. Given a guardian, when `POST /messages`, then 403; cross-tenant read → empty.
7. Both themes, phone sheet, desk card.

### Acceptance criteria
- [ ] Channel and window on `message`; never emailed; ceiling excludes it.
- [ ] App sheet + card; session dismiss; office-only end.
- [ ] Backoffice list and compose; menu + palette entry.
- [ ] Tests above; `docs/features/messages.md`, `app.md` updated.
