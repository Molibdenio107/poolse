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
