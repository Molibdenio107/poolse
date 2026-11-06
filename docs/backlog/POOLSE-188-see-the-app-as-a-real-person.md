# POOLSE-188 · An owner, an admin or Poolse support picks a view on the app, and sees it exactly as a real person of the club sees it, read-only

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature / Security · **Area:** Mobile app / Support · **Priority:** Medium (pilot) · **Depends on** [POOLSE-90](./POOLSE-90-the-app-agenda-per-role.md), [POOLSE-79](./POOLSE-79-support-access.md), [POOLSE-136](./POOLSE-136-the-app-phone-shell.md)

**Security review before building.** Run `/poolse-security-review` on the design, then on the diff. This is the first path where one login reads through another person's eyes.

### PO — why this exists

Rui, 06-11-2026: *"when a owner enters a mobile app, an option to select which type of view the owner/admin should use when entering the app for the first time. The same rule should be apply for myself when giving support to the app."*

`/app` sends an owner or an admin straight to the backoffice, and the server refuses them the family, instructor and maintenance reads, so an owner cannot see what their families see. A picker of the roles a person already holds would give a typical owner nothing to pick. Rui chose *see as a real person*: pick a view, pick a person, and see that person's app.

**Not in scope:**
- Writing anything as that person. Read-only, always.
- Backoffice impersonation: this is app mode only.
- Previewing with invented data.
- Clerk impersonation: the reader's own login stays the login.

### BA — rules

1. **First entry.** An owner or admin opening `/app` for the first time, and a support operator inside a live grant, gets one screen: *Backoffice*, *Família*, *Professor*, *Manutenção*. The choice is remembered per person and per device, and *Perfil* changes it.
2. **Backoffice** behaves as today. Any other view asks for one person of the club holding that role: a student or guardian, an instructor, a maintenance person.
3. **The person's app, exactly.** Every read answers as that person answers it: their children, their lessons, their fees.
4. **Read-only, by the server.** Every write under a view is refused (403 `viewing_as`), whatever the screen shows. Hiding a button is not the control.
5. **Always visible.** A banner on every screen says who is being viewed, with *Sair*. Colour never carries it alone.
6. **Recorded.** Starting and leaving a view writes the audit log: who viewed whom, when, with a reason for support. Each read in a view is logged as a read of that person, as `file.read` already is for a sealed file.
7. **Who may be viewed.** Inside the reader's own club only. An owner may view anybody except where a reader may not read today. An Admin may not view the Owner. Support needs a live grant, and a view ends the moment the grant does.
8. **Health and identity stay refused.** A sealed file, a medical note, an ID document and a staff member's pay are never opened through a view, even by a role that could open them in the backoffice.
9. **Open:** whether the person viewed is told. Default: not notified, and it shows in the club's Atividade, which the Owner reads.

### Dev notes

- A view is server state, never a client flag: a short-lived `app_view` row or a signed cookie checked in `TenantMiddleware`, where `tenant_suspended` already lives. The cookie alone is the trap: it would make the acting person a client's claim.
- `currentTenant()` keeps the real actor and gains `viewing: { membershipId, roles } | null`, so `requireRole` and the family reads answer as the viewed person while `recordAudit` still names the real one. `asSystem` is the nearest pattern, and POOLSE-79's `currentTenant().support` is the shape.
- Refuse writes centrally, in the middleware that already refuses a read-only club, rather than route by route. A list is a list somebody forgets to add to.
- `/app`'s routing is `appHome` in `lib/app-hats.ts`, one definition; the choice joins it.
- Trap: `/me` puts the active club first, and `memberships[0]` is always the club being acted in. Do not add a second notion of the current person there.
- Migration: use the `write-migration` skill.

### QA

1. Given an owner on first entry, then the four options show; choosing *Família* and a student shows that student's *Início*, with the banner.
2. Given a view, when any POST is tried, then 403 `viewing_as`, and nothing is written.
3. Given a view of a guardian with a sealed atestado, then its file is refused.
4. Given an Admin, when the Owner is chosen, then refused.
5. Given a person of another club, then 404.
6. Given a support operator, when the grant expires mid-view, then the next request ends the view.
7. Given a view, then Atividade names the real actor and the person viewed.
8. Given an instructor or a family login, when a view is asked for, then 403.
9. Both themes, on a phone.

### Acceptance criteria
- [ ] The picker on first entry, remembered, changeable on *Perfil*.
- [ ] Read-only enforced by the server, with the banner on every screen.
- [ ] Audited, and bounded by the support grant.
- [ ] Rule 9 answered.
- [ ] A security review of the design and of the diff.
- [ ] QA 1–9 green, with a role-probe line.
