# Navigation

## The home route

`/dashboard` is where signing in lands and where the logo goes. Every role lands there —
there is no per-role landing page.

The page shows the club's occupancy for its first site. Both of its requests are
best-effort: a role that may not read occupancy gets a muted "not available" note rather
than a permission error, which is what keeps one destination safe for everybody.

Somebody who belongs to no organization yet gets the "create your organization" form on the
same page.

## The menu

Defined once, in `apps/web/src/app/(app)/app-sidebar.tsx`. The mobile and collapsed views
read the same array, so structure, labels and permissions cannot drift between them.

Order: **Dashboard**, Instalações, Turmas, Calendário, Alunos.

| Item | Visible to |
|---|---|
| Dashboard | everybody |
| Instalações | everybody |
| — Inventário | everybody |
| — Staff | owner, admin |
| — — Férias | owner, admin |
| Turmas, Calendário, Alunos | everybody |

**A hidden menu item is never the permission.** Every restricted section's API refuses the
request as well; the menu is a convenience, and a URL somebody types has to be refused on
its own. Permissions are not inherited from a parent item — Instalações and Staff have
different audiences, and Staff disappears for somebody who may see the site but not its
people.

## The page shell

Every page under `(app)` renders through `PageShell`. `pnpm layout:check` fails the build if
one stops doing so or sets its own outer padding.

The "Voltar" control sits in a sticky strip beneath the app bar. It has **no rule beneath
it** — content passes under an opaque background while scrolling, without a dividing line.
Three pages render a `BackLink` in their body rather than through the shell's prop; those
never had one either.


## Invitations

An invitation is a bearer credential: whoever holds the link joins the club with the roles
it names. So only its **SHA-256 hash is stored**, and it is good for **24 hours** from
issue.

| Action | Roles |
|---|---|
| See the staff list and its pending invitations | owner, admin |
| Invite somebody | whoever may invite that role — POOLSE-01 |
| Resend | as above, and only an invitation the caller could have sent |
| Revoke | as above |

A lapsed invitation shows as **"Invitation expired"** in the muted, informational style —
not as an error. A 24-hour window makes expiry the ordinary Monday-morning outcome rather
than something that went wrong, and red rows people see every week are red rows people stop
reading. **Resend** beside it issues a new token and a fresh day, and revokes the old one in
the same transaction.

Reissuing is bounded by `requireOwnKind`: a person can only resend an invitation they could
have sent themselves, so an instructor cannot reissue an invitation to an admin — and a
missing invitation and somebody else's give the same answer, so neither can be discovered by
trying.


## Turmas — the class groups screen

A turma needs a **tank and a lane count**; both are refused server-side, naming the field.
A turma with no water cannot be placed on the grid, counted against a tank's ceiling, or
used to tell an instructor where to stand.

An **instructor is not required**. A club fills a timetable in September and staffs it in
October, so an unstaffed turma saves and says "No instructor assigned yet" on its card
instead.

The **weekly timetable shows only the weekdays the site opens**, plus any closed day that
still carries a class — drawn and flagged `closed`, never hidden. A class you cannot see is
a class you cannot move or cancel.

**Partnerships are collapsed by default**, with the number of groups on the closed header.
Hovering or focusing a partnership shows which lanes of its tank are busy at that hour —
counted across everything sharing the water, so "All lanes taken" can be true when a turma
holds the other half. The sentence is visible text as well as a tooltip: a tooltip may
clarify, and may never be the only place a piece of information appears.
