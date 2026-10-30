# POOLSE-129 · Families are invited from the student's record, by email or by a link shared from the phone; Pessoas invites staff only

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Students / Staff / Invitations · **Priority:** High (pre go-live) · **Depends on** [POOLSE-90](./POOLSE-90-the-app-agenda-per-role.md) (`/app`, `family_may_answer`), the 29-10-2026 invitation fixes (public `/join`, family placeholders bind)

### PO — why this exists

Rui, 30-10-2026: *"regarding mobile phone, i want the pilot to, access and enter the poolse, then invite users by email, or if possible by phone number by text and such, then, each student enters by its link. Also, the student invitation should not be in the staff screen. The student role should no be there to invite, it should be only on the students part."*

The pilot's owner will run the club from a phone. Today a family is invited from *Instalações → Staff*, by typing an address into a form that also offers Admin and Instrutor. The form knows nothing about the student, so the club types the guardian's email a second time, and nothing on the student's record says whether the family is in the app. A family belongs on the student's record. The office already knows who the guardians are there, and where to reach them.

Many families have a phone number on file and no email. Real SMS costs money per message and needs a registered sender (deferred in the stack). The phone already holds a free channel the families trust, though: the club's own WhatsApp or SMS. So the link goes out through the phone's share menu now, and an SMS sent by Poolse waits for a paying club.

**Decided (Rui, 30-10-2026):**
- **Share menu now, real SMS later.**
- **Login stays email** (or Google), even when the link came by WhatsApp. No phone-number login, which Clerk charges per SMS.
- **Invite from the student's page, plus a bulk invite on Alunos.**
- **The guardian always; the child from 12 or on the adult path.**
- **Owner, admin and instructor may invite**, an instructor only for their own turmas' students.
- **Pessoas becomes staff only**, families included in neither the form nor the list.

**Not in scope:**
- SMS sent by Poolse (a later ticket, once a paying club asks; it reuses rule 6's message text).
- Phone-number login.
- Inviting staff from a phone in any new way. The Pessoas form already works on a phone and keeps working.
- A native app.
- Changes to what a family sees once inside (POOLSE-90).

### BA — rules

1. **Pessoas invites staff only.** The invite form on *Instalações → Staff* offers owner-grantable staff roles (`admin`, `instructor`, `maintenance`) and never `guardian` or `student`. The API enforces it, not the form: `POST /invitations` refuses `guardian`/`student` with 422 `family_role_from_student`. The only way to send a family invitation is rule 3's endpoint.
2. **Pessoas lists staff only.** A membership whose only live roles are `guardian` and/or `student` is not listed, not counted in the team, and not offered in its pickers. A person with a staff role *and* a family role is listed as staff. Their family role still shows on their own page.
3. **A family is invited from the student's record.** The *Família* tab of `/dashboard/students/:id` shows one row per invitable person:
   - each live guardian (`guardian_link`);
   - the student themself, when `family_may_answer` would admit their own login: aged `self_answer_min_age()` (12) or more, or on the adult path. A missing birth date is never a guess, so no row.
   
   Each row shows the person's state in words: *Sem convite* / *Convite enviado em dd-MM-yyyy* / *Convite expirado* / *Usa a app*.
4. **The invitation targets the existing person, never a new one.** The guardian's membership (or the student's own) is the invitation's `membership_id`. Nothing creates a second placeholder. This is the one-NIF-one-person rule applied to logins: a second mother is exactly the bug.
5. **By email.** When the person has an email on file, *Enviar convite* sends the email exactly as today. When they have none, the row asks for one, saves it on the person through the record's ordinary save path, then sends. A guardian who already has a login is not invited. Their row says *Usa a app*.
6. **By a shared link.** Every pending invitation row offers *Partilhar link*.
   - On a device with `navigator.share` it opens the share menu with a short text, from the catalogue and in the club's locale: *"{club} convida-o para a app Poolse, para acompanhar {student}. Abra este link: {url}"*.
   - Without it, the button copies the text and says *Copiado*.
   - Creating a link-only invitation needs no email (rule 8). The link is the same token the email would carry.
7. **Joining is unchanged.**
   - `/join?token=…` is read signed out. The person creates a login with any email or Google and accepts.
   - Acceptance binds the login to the invitation's `membership_id`, keeping its `guardian_link` or `student.membership_id`. Then `/app` routes them to the family agenda.
   - An invitation sent to an email still asks first when the signed-in account differs (29-10-2026). A link-only invitation has no address to compare, so it accepts with the signed-in account.
8. **A link-only invitation has no email.** `invitation.email` becomes nullable, with a CHECK that a family invitation may omit it and a staff one may not. The one-live-invite-per-address index stays on email. A second index allows one live invitation per `membership_id`, so a guardian cannot hold two live links.
9. **Resend, renew, cancel.** A pending invitation can be shared again (same link), renewed (*Novo link*, the existing reissue, which kills the old token) or cancelled (the existing revoke). An expired one offers *Novo link* only.
10. **Bulk: *Convidar famílias* on Alunos.**
    - It previews first: "N famílias com e-mail recebem o convite; M só têm telefone e ficam na lista *Por convidar*; K já usam a app".
    - The commit sends the email invitations in one request and creates no link-only invitations. Sharing a link is one person at a time, from the phone.
    - The preview and the commit share one path with a `commit` flag, like every importer.
    - The bulk invite takes the list's current filters (turma, level, site), so "the 18:00 Tuesday turma" is one action.
11. **A filter *Por convidar* on Alunos** lists students with at least one invitable person who has neither a login nor a live invitation. *Convidar famílias* respects it.
12. **Who may invite.**
    - Owner and admin: any student.
    - Instructor: only students actively enrolled in a turma they teach (`myTurmaIds`). For anybody else the answer is 403 `not_your_student`, decided in the repository and echoed as `canInvite` on the read.
    - Maintenance, guardian and student: never.
    - A support session: never (`grantableRoles()` is empty).
13. **Invitations are account mail.** The family opt-out (POOLSE-86 3.0c) does not apply, and they are not counted in the 20-messages-a-day ceiling. Bulk has its own ceiling instead: **200 invitations per club per Lisbon day**. The preview says when a run would cross it, and the commit refuses with the figures (409 `invitation_ceiling|200|190|25`).
14. **Existing invitations stay valid.** Family invitations already sent from Pessoas keep working and appear on their student's row once matched by `membership_id`. Nothing is migrated or revoked.

**Open:** whether the shared text names the student (rule 6). Default: it does, by first name only, because a parent with two clubs or two children needs to know which one. Nothing else about the child goes in a message that leaves Poolse.

### Dev notes

- **Schema (use `write-migration`):**
  - `invitation.email` drops NOT NULL. Add a CHECK: `email IS NOT NULL OR roles <@ ARRAY['guardian','student']::member_role[]`.
  - Add a partial unique index `(organization_id, membership_id) WHERE accepted_at IS NULL AND revoked_at IS NULL`.
  - Check `find_invitation_by_token` and the join path for any `email` they assume non-null. The preview shows "convite para a família de {student}" when there is no address.
- **API:**
  - `POST /students/:id/invitations` takes `{ membershipId, email? }`. It validates that the membership is a live guardian of this student or the student's own membership with a self-answer age, writes the email to the person if one is given, then calls the existing invitation insert.
  - `GET /students/:id` grows `family: [{ membershipId, name, relationship, email, phone, state, invitationId, expiresAt, canInvite }]`.
  - `POST /students/invitations/bulk` takes `{ filters, commit }`.
  - Every new route gets `requireRole` in its first line **and a line in `role-probe.integration.test.ts`**.
- **Grant matrix:** `INVITATION_MATRIX` loses `guardian` and `student` for every role. The family path checks rule 12 itself. `canInvite()` (the Pessoas entry point) then hides the form from an instructor, which is correct: an instructor invites from the student.
- **Pessoas:** the list query adds "has a live staff role" beside the existing `support_grant_id IS NULL`. Read QA 5 of `support.integration.test.ts` for the shape, and add this list there.
- **Web:**
  - The rows live in `guardian-block.tsx`'s tab and reuse `InvitationLink`, `ReissueButton` and `RevokeButton` from `facilities/staff/`. Move them to `components/` if a second caller makes that cleaner (propose, don't reflex).
  - *Partilhar link* is a client component: `navigator.share` with a fallback to `navigator.clipboard`.
  - The student's Família tab is tier 2 on the phone, and the share button is the reason it is used there. It earns a line in `phone-tier2.spec.ts`.
- **The trap:** the 29-10 bug. A family invitation was impossible because the guardian rule refused the bare placeholder an invitation made. This ticket must never create a placeholder for a family (rule 4). If a test needs one, the design has gone wrong.

### QA

1. **Staff form.** Given an owner on Pessoas, then the invite form offers Admin, Instrutor and Manutenção, and no Encarregado or Aluno. When a raw `POST /invitations` with `roles: ['guardian']` is sent, then 422 `family_role_from_student`.
2. **Staff list.** Given a club with 3 staff and 40 guardians, then Pessoas lists 3. Given an instructor who is also a guardian, then they are listed once, as staff.
3. **Guardian invited by email.** Given a guardian with an email, when the admin presses *Enviar convite*, then the email is sent (console in dev). The row reads *Convite enviado em 30-10-2026*. Opening the link signed out and signing up with that address lands on `/app/familia` with the child on the agenda. No new membership row exists.
4. **Guardian with only a phone.** Given a guardian with a phone and no email, when the owner presses *Partilhar link* on a phone (WebKit and Chromium projects), then `navigator.share` receives the club's text and the `/join` URL. Accepting with any email binds to that guardian and the child appears.
5. **Copy fallback.** Given a desk browser without `navigator.share`, then the button copies the text and says *Copiado*.
6. **The child's row.**
   - A student aged 11 with a guardian has no row of their own.
   - At 12 they have one.
   - An adult-path student has one and no guardian rows.
   - A student with no birth date has guardian rows only.
7. **One live invitation per person.** Given a pending link for a guardian, when another is requested for the same guardian, then 409. *Novo link* replaces it, and the old token reads as revoked on `/join`.
8. **Bulk.** Given a turma filter with 10 students:
   - 6 guardians with email, 3 with phone only, 1 already in the app;
   - then the preview says 6 / 3 / 1;
   - the commit sends 6;
   - *Por convidar* then lists the 3.
   
   Running it again sends 0.
9. **Ceiling.** Given 190 invitations sent today, when a bulk run of 25 is committed, then 409 with the figures and nothing is sent.
10. **Instructor scope.** An instructor invites a guardian of a student in their turma (201). For a student outside their turmas, the API answers 403 `not_your_student` and the read carries `canInvite: false`.
11. **Permission denials.** Maintenance, a guardian and a student calling `POST /students/:id/invitations` get 403. A support session gets 403. Role-probe lines exist.
12. **Cross-tenant.** A `membershipId` from another club on this club's student gets 404, and nothing is written.
13. **Old invitations.** A family invitation created from Pessoas before this ticket still accepts, and shows on its student's row.
14. **The pilot's walk on a phone.** On the `iphone` project:
    - sign up as a new owner;
    - add a student with a guardian (phone only);
    - share the link;
    - open it in a second context, sign up and land on the family agenda.
15. **UI checks.** Both themes; the share and invite buttons are `h-control`; every string is in pt-PT and en with no Brazilian forms.

### Acceptance criteria

- [ ] Pessoas neither offers nor lists family-only people. The API refuses family roles on `POST /invitations`.
- [ ] The student's Família tab shows each invitable person with their state in words, and invites by email or a shared link.
- [ ] A family invitation never creates a membership. It binds to the guardian's or student's existing one.
- [ ] Link-only invitations exist (`email` nullable for family roles, one live invitation per membership), and `/join` reads them.
- [ ] *Convidar famílias* previews and commits on one path, honours the list's filters and the 200-a-day ceiling. *Por convidar* filters the list.
- [ ] Owner/admin for any student, instructor for their own turmas only, everyone else 403, with role-probe lines.
- [ ] QA 1–15 pass; QA 4 and 14 run on both phone projects.
- [ ] `docs/features/staff.md` and `docs/features/students.md` updated. One CLAUDE.md line: *"A family is invited from the student, never from Pessoas"*.
