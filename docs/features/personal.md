# A personal pool

One person tracking their own pool — slice 4.5. A personal tenant is an ordinary
organization with `kind = 'personal'` (`docs/data-model.md`, decision 1); everything below
is what that kind changes, and it is deliberately short.

## Signing up

The create-organization form — shown to anybody who belongs to no organization yet — asks
one question first: **a club or a facility**, or **my own pool**. The second answer:

- asks for one name only, the pool's; the site is named the same and the facility field
  is not shown;
- provisions the organization, the owner membership, one facility and **one pool** named
  like the site, `outdoor`, in one transaction (`provision_organization`, `p_kind`);
- opens **no season** — a season is what turmas live in, and there are none.

The API is `POST /organizations` with `kind: 'business' | 'personal'`; absent means a club.
Any other value is a 400. The response carries `poolId` for a personal tenant and `null`
for a club.

## What a personal user sees

`/me` carries `organizationKind` on each membership. The web app reads it in two places:

- **Navigation** — Painel and Instalações (with Inventário). Turmas, Calendário, Alunos,
  Faturação and Staff are absent. This is a shape, not a permission: the personal owner is
  an owner and the API answers those routes; they are absent because they are about things
  that do not exist in a personal tenant.
- **Dashboard** — one card per pool in place of occupancy: the latest value of each
  metric, judged against *this pool's* bands (in range / out of range with the bound
  crossed / no range set), when the sample was taken, and a button to the pool's page.
  "As minhas tarefas" appears as it does for anybody, when there is something in it.

Everything else is the club's own screens, unchanged: the pool page with its readings,
trend, ranges, alerts, photos and archive; the site page with its spaces, kit and
maintenance tasks.

## Rules

- Nothing enforces a personal tenant's size beyond `max_facilities` (1 by default). A
  second pool or a second member is allowed.
- Alerts, bands and the 48-hour window behave exactly as for a club; the recipients are the
  owner, which is the one person.
- A person already in a club who wants a personal tenant too cannot create one yet: the
  dashboard shows `memberships[0]` and there is no organization switcher. That is the
  switcher's gap, not this slice's.

## Not built

The mobile app the product spec names for this audience. 4.5 is the web app shaped for one
person; the mobile surface is phase 3's, shared with the student app.
