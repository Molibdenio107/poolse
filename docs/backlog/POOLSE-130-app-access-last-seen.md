# POOLSE-130 · App access shows when each person last used Poolse

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Students / Invitations · **Priority:** Medium (pilot) · **Depends on** [POOLSE-129](./POOLSE-129-families-invited-from-the-student.md)

### PO — why this exists

Rui, 30-10-2026: *"on student detail page 'App access' add a log for record, for last logged in at."*

*Usa a app* says somebody joined once. It does not say whether a family still opens the app, which is the question the office has when a parent says they never saw a cancellation.

**Not in scope:**
- A history of every session.
- Read receipts on messages.
- Anything on Pessoas (staff) — a later ticket if asked.

### BA — rules

1. **What is recorded.** Each login stores `last_seen_at`: the last time it opened Poolse (web or app), in any club.
2. **Recorded on the way in.** The time is written by the authenticated `/me` read, at most once per 15 minutes per login, so a busy afternoon is not a write per request.
3. **What the row says.** In *Acesso à app* (and the record's *Convidar para a app* panel), a person with a login reads *Usa a app · último acesso há 3 dias* (`timeAgo`), with the date in `dd-MM-yyyy` on hover-free visible text when over 30 days.
4. **Never used since joining.** A login that accepted but never came back reads *Entrou a dd-MM-yyyy, sem acessos depois*.
5. **Who sees it.** The same people who see the row (owner, admin, the instructor of the student's turma). The value is per login, not per club, so it says nothing about what they did in another club.

**Open:** whether 15 minutes is the right granularity. Default: 15 minutes.

### Dev notes

- **Schema.** `app_user.last_seen_at timestamptz` is Poolse's own column, not a Clerk cache, so it is written directly. It needs a `GRANT UPDATE (last_seen_at)` with the matching REVOKE (column-grant rule) and a SQL test. Use `write-migration`.
- **Write path.** One `UPDATE … WHERE last_seen_at IS NULL OR last_seen_at < now() - interval '15 minutes'` in the `/me` handler, after the response is built. It must never fail the read.
- **Read path.** `listInvitees` returns `lastSeenAt` and `joinedAt` (the accepted invitation's `accepted_at`).
- **Retention.** The value is identity-adjacent; it is cleared with the login, so nothing new is needed.

### QA

1. **Recorded on use.** Given a guardian who opens `/app`, then their row reads *último acesso há instantes*.
2. **Throttled.** Given two `/me` calls 1 minute apart, then one write.
3. **Joined, never back.** Given a login that accepted and never came back, then the row reads *Entrou a …, sem acessos depois*.
4. **Who sees it.** Maintenance calling `GET /students/:id/invitations` gets 403 (unchanged).
5. **UI checks.** Both themes; pt-PT and en.

### Acceptance criteria

- [ ] `app_user.last_seen_at`, written by `/me` at most every 15 minutes, by column grant.
- [ ] The *Acesso à app* row shows the last access in words.
- [ ] QA 1–5 pass.
