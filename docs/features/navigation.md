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

## Detail pages are tabs

A record's page — a site, a tank, a student, a turma — renders through `DetailPage`
(`components/detail-page.tsx`): a sticky block of back link, title and a pill tab strip, then
the active tab's content. One former card is one tab; the first is always **General**. Where
cards are one conversation they share a tab, and the page's header comment says which.

- **The tab is in the URL** as `?tab=<slug>`. Refresh, a shared link and the back button land
  on it. A missing, unknown or hidden slug shows the first visible tab. Switching tab drops
  `page` and keeps every other parameter, `from` included.
- **Only the active tab is fetched.** A list whose refusal decides whether its tab exists, or
  which feeds a badge, runs with the page; everything else runs when its tab opens. Coming
  back to a tab fetches it again.
- **A tab a role may not use is absent** from the strip and from the URL. It reuses the
  page's existing answer — a `can*` flag, or a list that came back null.
- **Each card still saves itself.** Typing into a form on a tab marks it unsaved; the save's
  fresh payload marks it clean. "Cancelar alterações" appears under the tab while it is
  unsaved and puts every field back. Leaving the tab, following a link or closing the window
  while unsaved asks first. **The browser's own back button does not ask** — the App Router
  cannot intercept it.
- **Badges** are a count or a dot, only from data the page already loads.
- On a narrow screen the strip scrolls sideways and keeps the active tab in view.

| Page | Tabs |
|---|---|
| Site — `/dashboard/facilities/[id]` | Geral (pessoas, meteorologia, localização, horário) · Preços (tabela, categorias, seguro) · Parcerias · Piscinas · Espaços · Manutenção · Energia · Fotografias |
| Tank — `/dashboard/facilities/pools/[id]` | Geral (detalhes, arquivar) · Qualidade da água (ponto quando a última análise está fora dos limites) · Custo por utilização (owner, admin; carregado ao abrir) · Fotografias |
| Student — `/dashboard/students/[id]` | Geral (progresso e ficha médica, identificação) · Mensalidades (se as pode ver) · Documento (owner, admin) · Turmas (contagem; só se inscrito) · Semana (carregada ao abrir) · Reposições (contagem; só se houver) |
| Turma — `/dashboard/classes/[id]` | Geral (formulário, arquivar) · Horário (contagem) · Alunos (contagem de inscritos; custo da água carregado ao abrir) |
| Espaço — `/dashboard/facilities/spaces/[id]` | Geral (estado e "Marcar como limpo"; ponto quando em atraso) · Histórico de limpezas (a paginação mantém o separador) · Ocorrências (contagem das abertas) |
| Staff member — `/dashboard/facilities/staff/[id]` | Geral (ficha) · Funções (owner, admin) · Acesso (mudança de endereço; owner; ponto quando pendente) |
| Maintenance task — `/dashboard/facilities/tasks/[id]` | Geral (factos e registo; ponto quando por fazer) · Histórico (carregado ao abrir; a paginação mantém o separador) · Plano (owner, admin) |


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
