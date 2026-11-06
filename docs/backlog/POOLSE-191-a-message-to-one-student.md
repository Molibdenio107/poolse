# POOLSE-191 · The office writes to one student from their page, by email or WhatsApp, and it stays on the record

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Students / Messages · **Priority:** High (pilot) · **Depends on** [POOLSE-67](./POOLSE-67-messages-to-families.md), [POOLSE-166](./POOLSE-166-avisos-in-app-notices-with-a-window.md) · **Unblocks** [POOLSE-192](./POOLSE-192-schedule-a-medical-exam.md)

### PO — why this exists

Rui, 06-11-2026: *"Each student on back office, desktop app, should have a send message section, so it will be a simple message system to send via email or mobile whatsapp to remind the student of a schedule medical exam or something else. What already exists, keep as it is."*

Messages reach a turma, a level, a site, a sport or the club. A reminder for one person has no home, so it leaves from somebody's own mail and no record stays.

**Not in scope:** the medical exam itself (POOLSE-192); a reply or a conversation; attachments; templates; automatic or scheduled sending; the WhatsApp Business API; SMS; any change to *Mensagens* or *Avisos* as they stand.

### BA — rules

1. A student's page has a *Mensagens* tab: a form on top, and below it what was sent to this student, newest first, with who sent it, when, and how.
2. **Who receives it** is the club's existing rule (Rui): live guardians, else the student themselves. The screen names them before sending. Nobody is dropped silently: no address is said in words.
3. **Email** is a `message` as today: a record first, sent after the commit, retried, one per address, counted by the daily ceiling.
4. **WhatsApp** opens WhatsApp with the text ready, from the phone or the computer the staff member is on, and they press send (Rui). Poolse records that it was **opened**, never that it was sent or delivered, and the screen says *Aberto no WhatsApp*.
5. With no phone on the recipient, the WhatsApp button is disabled and a visible line says why.
6. **Also show in the app** is a tick, off by default (Rui). Ticked, the message is also an aviso for that student, with a *até* date, default 7 days, today included. The form sends the email or opens WhatsApp as well; an aviso alone is not this form's job.
7. The aviso is seen only by that student's guardians and that student's own login, in the family app as any aviso.
8. **Who sends** (Rui): owner and admin to any student; an instructor to a student actively enrolled in one of their turmas. Refused otherwise with a 403.
9. **Who reads the tab:** owner and admin everything; an instructor only what they sent themselves, and the form.
10. **Opt-out does not apply**: stopping general messages does not stop a message addressed to one person (Rui, 06-11-2026, confirmed as a default). It carries no opt-out link. This extends POOLSE-86's list of what always goes; it does not change it for general messages.
11. A personal message stays out of the general *Mensagens* and *Avisos* lists, and it is archived, never edited, as every message is.

### Dev notes

- **Use the `write-migration` skill.** Two migrations: `ALTER TYPE` values cannot be used in the transaction that adds them.
- `message_audience` gains `student`, and `message` gains `student_id uuid`, with a composite FK `(organization_id, student_id)` to `student`, and a check that it is set exactly when `audience = 'student'`.
- `message_channel` gains `whatsapp`. The existing checks hold (`message_app_window`, `message_app_no_addresses`); a row has `address_count = 0`, so `deliverMessage` and the ceiling skip it. `message_app_audience` adds `student`.
- `message_recipients_all()` gains the student branch, and the wrapper reports `opted_out` false for it, as for `closure`. It stays the one definition.
- **Every existing reader of `message` that lists:** add `audience <> 'student'`. CLAUDE.md's *A new reader of `message` that means mail filters `channel = 'email'`* holds for the new channel too. `GET /app/avisos` adds the student branch.
- **API:** `GET` and `POST /students/:studentId/messages`, in `apps/api/src/messages/`. `requireRole` in the first line, and the instructor's reach is a repository answer (`myTurmaIds`), not a role. `POST` writes the email row and the aviso row in one transaction. `POST .../messages/whatsapp` writes the record and returns the link.
- **The link:** `https://wa.me/<digits>?text=<encoded>`. A helper in `@poolse/rules` normalises the number (Portuguese default, `+351`) with a test. Never put a name in the URL's path, and encode the text. Open it from the server action's answer so the row exists first.
- **UI:** one card is one tab, in `DetailPage`. Controlled fields. A save says so once. Sending to several people asks first.
- **Trap:** the send is one statement so the count confirmed and the rows written share a snapshot (POOLSE-67). Keep it.
- **Trap:** the message bodies a family reads come from staff: render as text, never as HTML, in the email and the app. Run `/poolse-security-review`, it is a new endpoint.

### QA

1. Given a minor with two guardians, when an admin sends by email, then two recipient rows are written and both are named before sending.
2. Given an adult with no guardian, then it goes to the student's own address.
3. Given no address anywhere, then the screen says so and nothing is sent.
4. Given a guardian who opted out of general messages, then this message still reaches them, with no opt-out link.
5. Given a sent message, then it shows on the student's tab and on neither general list.
6. Given WhatsApp pressed, then a row records *Aberto no WhatsApp* and the link holds the encoded text and the number.
7. Given no phone, then the button is disabled and a visible line says why.
8. Given the tick, then one email row and one aviso row exist, and the aviso shows only to that student's guardians and login.
9. Given another family in the same club, when they read `GET /app/avisos`, then the aviso is absent.
10. Given an instructor and a student not in their turmas, when they `POST`, then 403; the same for a family role against the endpoint.
11. Given an instructor, when they read the tab, then they see only what they sent.
12. Given two clubs, when club A posts to a student of club B, then 404, and the composite FK refuses it at the database (cross-tenant).
13. Given the daily ceiling reached, then the email is refused with its figures and a WhatsApp row is still allowed.
14. Given a body with HTML in it, then it reaches the email and the app as literal text.
15. Both themes and a phone width.

### Acceptance criteria

- [ ] A *Mensagens* tab on the student's page sends by email and opens WhatsApp with the text ready.
- [ ] The record says what happened, and WhatsApp is never claimed as delivered.
- [ ] The tick shows it in that student's app only.
- [ ] Recipients come from `message_recipients()`, with no second definition.
- [ ] *Mensagens* and *Avisos* behave exactly as they did.
- [ ] Roles enforced server-side, proved by the role probe; `TENANT_TABLES` needs no change, no new table.
- [ ] pt-PT and `en`; `docs/features/messages.md`, `docs/data-model.md`, the `CLAUDE.md`/`students-and-families.md` line, and the Ctrl+K palette if an entry is added.
- [ ] `/poolse-security-review` run.
