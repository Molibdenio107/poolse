# POOLSE-188 · An owner, an admin or Poolse support picks a view on the app, and sees it exactly as a real person of the club sees it, read-only

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature / Security · **Area:** Mobile app / Support · **Priority:** Medium (pilot) · **Depends on** [POOLSE-90](./POOLSE-90-the-app-agenda-per-role.md), [POOLSE-79](./POOLSE-79-support-access.md), [POOLSE-136](./POOLSE-136-the-app-phone-shell.md)

**Security review before building.** Run `/poolse-security-review` on the design, then on the diff. This is the first path where one login reads through another person's eyes.

### Design agreed (06-11-2026)

A view is an `app_view` row (viewer, viewed, started, ended, expires, reason), and **the row alone decides** (corrected 07-11-2026): `TenantMiddleware` looks for a live row for the reader on every request, with no cookie and no header. A header can be forgotten, and `apiFetch` is not the only way out of the web app (uploads and file streams build their own requests), so a request without it would run as the real owner with every write open. An owner holding only `owner` has no family, teaching or maintenance home, so the picker must offer the people of the club, not the reader's own roles. Reads use an allowlist of routes (rule 10), refused in the middleware, so a new route is closed by default. The `(app)/dashboard` layout redirects to `/app` while a view is live, on any device, which is what rule 11 asks. `/me` tells the web app about the view, since it is the one thing that runs outside `TenantMiddleware`.

### Security review of the design (07-11-2026)

- **The row names the home chosen** (`hat`), and only that home's roles apply. A person who teaches and is also an Admin is viewed as an instructor, never with `admin`.
- **Everybody is re-checked on every request, in `resolve_memberships`.** The viewer still holds owner or admin (or is the same support session), the person viewed is still active and holds the home's role, and the person viewed is not the Owner unless the viewer is. A failed check means no view: the reader is simply themselves again.
- **The row records its support grant.** A support membership is reused from grant to grant, so a different grant means the view is over.
- **A support view leaves out personal avisos** (`audience = 'student'`), which is where an exam reminder lives.
- **`app_view.read` stays out of `/support-grants/activity`**, whose 100-row limit it would flood. A read is logged before it is answered, and a read that cannot be logged is refused.
- **`/me/profile` and `/me/photo` refuse under a view.** `/me/preferences` stays open: `PreferenceSync` sends it unprompted, and it is the reader's own setting.
- **The `/admin` list reads `audit_log`,** which the platform login already reads, so `poolse_platform` does not widen.

### Security review of the code (07-11-2026)

No S1 or S2. Fixed: the `medical_exam` row left the documents list under every view, because `expired` is also how an unfit result reads; *Sair* passes a read-only club; `/family` answers empty when the home is not *Família*; `guardAiCall` refuses under a view; a deleted login ends a view and is not offered. **Accepted:** rule 4's "every write" means the person's data and the club's: `POST /organizations`, `POST /join` and `POST /me/sessions/:id/revoke` stay open, because they run outside `TenantMiddleware` and only ever touch the reader's own account. A file's row facts still answer as the person, so a teacher's child's photo opens by id under *Professor* for an owner or admin, who can read it anyway. A reader demoted and re-promoted inside the hour gets the view back. **Open:** support's `reason` is free text and is not expired by `apply_retention`, as `support_grant.reason` is not either; the screen asks for no names or health details.

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
2a. **A home of the reader's own comes first** (Rui, 07-11-2026): *"the pilot will be one person testing the desktop app and at the same time managing students on the mobile app. So owner view for desktop and teacher view on mobile."* An owner or admin who also holds `instructor`, `maintenance`, `guardian` or `student` sees that home above the views, as *As minhas aulas* and so on. It is **not a view**: no `app_view` row, their own account, real saves, no hour, no banner, and their other devices stay as they were. It is remembered on that device. A view stays what it was, for looking at somebody else's app.
3. **The person's app, exactly.** Every read answers as that person answers it: their children, their lessons, their fees.
4. **Read-only, by the server.** Every write under a view is refused (403 `viewing_as`), whatever the screen shows. Hiding a button is not the control.
5. **Always visible.** A banner on every screen says who is being viewed, with *Sair*. Colour never carries it alone.
6. **Recorded.** Starting and leaving a view writes the audit log: who viewed whom, when, with a reason for support. Each read in a view is logged as a read of that person, as `file.read` already is for a sealed file.
7. **Who may be viewed.** Inside the reader's own club only. An owner may view anybody except where a reader may not read today. An Admin may not view the Owner. Support needs a live grant, and a view ends the moment the grant does.
8. **Health and identity stay refused.** A sealed file, a medical note, a medical leave, an ID document and a staff member's pay are never opened through a view, even by a role that could open them in the backoffice.
9. **The person viewed is not told** (Rui, 06-11-2026). Views are listed in *Vistas da app*: who viewed whom, when and for how long. **Only the club's Owner sees that list**, support views included, because the Owner opened that access; an Admin does not (Rui, 07-11-2026). **Rui sees the views made as support across all clubs on `/admin`** (Rui, 07-11-2026). A view of a student also shows on that student's Atividade tab for the Owner only, since Atividade exists only per student and per turma.
10. **What a view opens is a list, and everything else is refused** (Rui, 06-11-2026): the person's home, lessons, payments, documents list and progress, and the instructor's and maintenance person's homes. Medical certificates, stored files, filled forms and every other route answer 403 `viewing_as`, so a new route is closed until somebody adds it. The list is in *Dev notes*.
10a. **The logo and faces** (Rui, 07-11-2026). An owner's or admin's view shows the club logo and the photos that person can see, because a view with blank faces is not their app. A support view shows the logo and initials: no photo of a person, so no child's face reaches Poolse staff. Every other stored file stays refused for everyone.
10b. **Only people with a login can be picked** (Rui, 07-11-2026). If a role has nobody, the picker says so in one line. A student with no login is seen through their guardian, or not at all.
11. **A view ends after 1 hour.** While one is open, the backoffice sends the reader back to the app until they press *Sair* (Rui, 06-11-2026).

### Dev notes

- A view is server state, never a client flag: a short-lived `app_view` row or a signed cookie checked in `TenantMiddleware`, where `tenant_suspended` already lives. The cookie alone is the trap: it would make the acting person a client's claim.
- **Corrected 07-11-2026:** `currentTenant()` carries the *viewed* person in `membershipId`, `appUserId`, `roles` and `mySports`, and gains `actor: { membershipId, appUserId } | null` for the real one. The other way round, every one of the ~70 places that read `membershipId` on the family paths would have to remember the view, and the one that forgot would answer as the owner. `recordAudit` is the one reader that takes `actor` first. RLS is keyed on the organization only, so it needs no change. POOLSE-79's `currentTenant().support` is the shape.
- **Identity routes bypass the middleware.** `/me` and `/me/*` are outside it, so rule 4 does not reach them by itself: a write there under a live view needs its own refusal, and `/app/perfil` must draw the viewed person, not the `/me` reader. *Sair* is the single write a view allows.
- **Allowlist (GET only, in `tenant/app-view.ts`):** `/shell`, `/family`, `/app/agenda`, `/app/lessons/:id`, `/app/lessons/:id/classmates`, `/app/avisos`, `/app/fees`, `/app/documents`, `/app/progress` and `/app/progress/:id`, `/app/times`, `/app/enrolment-requests`, `/app/teaching`, `/app/maintenance`, `/sessions/:id/plan`, and `/files/:id` for the purposes in rule 10a. Check the `/family` answer field by field before listing it. **Left off on purpose:** `/app/medical-leave` (rule 8), `/app/documents/fpn` and `/students/:id/documents/fpn` (the full ID number), `/students/:id/boletim` (a filled form). Those screens show *Não disponível nesta vista*, never an error.
- Rule 6's per-read rows use an action ending `.read`, which Atividade's feed already leaves out. They are audit rows, not telemetry.
- Refuse writes centrally, in the middleware that already refuses a read-only club, rather than route by route. A list is a list somebody forgets to add to.
- `/app`'s routing is `appHome` in `lib/app-hats.ts`, one definition; the choice joins it.
- Trap: `/me` puts the active club first, and `memberships[0]` is always the club being acted in. Do not add a second notion of the current person there.
- Migration: use the `write-migration` skill.

### QA

1. Given an owner on first entry, then the four options show; choosing *Família* and a student shows that student's *Início*, with the banner.
2. Given a view, when any POST is tried, then 403 `viewing_as`, and nothing is written.
3. Given a view of a guardian with a sealed atestado, then its file is refused.
4. Given an Admin, when the Owner is chosen, then refused. Given an Admin, when *Vistas da app* is asked for, then 403.
5. Given a person of another club, then 404.
6. Given a support operator, when the grant expires mid-view, then the next request ends the view.
7. Given a view, then Atividade names the real actor and the person viewed.
8. Given an instructor or a family login, when a view is asked for, then 403.
9. Both themes, on a phone.
10. Given a live view, when a request arrives with no header and from another device, then it is still read-only and answers as the person viewed.
11. Given a live view, when `/me/photo` or `/me/profile` is written, then 403 `viewing_as`; `/me/preferences` and *Sair* succeed.
12. Given an owner's view, then the logo and permitted faces load; given a support view of the same person, then the logo loads and a person's photo answers 403 `viewing_as`.
13. Given a view, when `/app/medical-leave`, `/app/documents/fpn` or the boletim is asked for, then 403 `viewing_as`, and the screen says so without an error page.
14. Given a route added to the API and not to the list, then a test fails: the list is compared with the routes.
15. Given a person who is both Admin and instructor, when viewed as *Professor*, then `/students` answers 403.
16. Given a live view, when the viewer loses their role, or the person viewed leaves or loses that role, then the next request is the reader's own and not a view.
17. Given a support view, when the grant ends and a new one opens within the hour, then the old view does not come back.
18. Given a personal exam aviso, then an owner's view shows it and a support view does not.

### Acceptance criteria
- [ ] The picker on first entry, remembered, changeable on *Perfil*, with the reader's own homes above the views.
- [ ] Read-only enforced by the server, with the banner on every screen.
- [ ] Audited, and bounded by the support grant.
- [ ] Rules 9 to 11, 10a and 10b hold, with *Vistas da app* for the Owner and the support list on `/admin`.
- [ ] A security review of the design and of the diff.
- [ ] QA 1–9 green, with a role-probe line.
