# POOLSE-188 · An owner, an admin or Poolse support picks a view on the app, and sees it exactly as a real person of the club sees it, read-only

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature / Security · **Area:** Mobile app / Support · **Priority:** Medium (pilot) · **Depends on** [POOLSE-90](./POOLSE-90-the-app-agenda-per-role.md), [POOLSE-79](./POOLSE-79-support-access.md), [POOLSE-136](./POOLSE-136-the-app-phone-shell.md)

**Security review before building.** Run `/poolse-security-review` on the design, then on the diff. This is the first path where one login reads through another person's eyes.

### Design agreed (06-11-2026)

A view is an `app_view` row (viewer, viewed, started, ended, expires, reason) and a cookie holding only its id, sent as a header and checked in `TenantMiddleware` against the row: the row decides, never the cookie. An owner holding only `owner` has no family, teaching or maintenance home, so the picker must offer the people of the club, not the reader's own roles. Reads use an allowlist of routes (rule 10), refused in the middleware, so a new route is closed by default. `apiFetch` sends the header, so the `(app)/dashboard` layout redirects to `/app` while a view is live.

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
9. **The person viewed is not told** (Rui, 06-11-2026). An owner's or admin's view shows in Atividade. **A support view is seen by the Owner only**, in Atividade, because the Owner opened that access.
10. **What a view opens is a list, and everything else is refused** (Rui, 06-11-2026): the person's home, lessons, payments, documents list and progress. Medical certificates, stored files, filled forms and every other route answer 403 `viewing_as`, so a new route is closed until somebody adds it.
11. **A view ends after 1 hour.** While one is open, the backoffice sends the reader back to the app until they press *Sair* (Rui, 06-11-2026).

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
- [ ] Rules 9 to 11 hold.
- [ ] A security review of the design and of the diff.
- [ ] QA 1–9 green, with a role-probe line.
