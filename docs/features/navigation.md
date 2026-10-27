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

Order: **Dashboard**, Instalações, Energia, Turmas, Calendário, Receção, Faturação, Alunos,
then the family's own entry.

**An entry is shown only to the roles its page's API answers** (15 October 2026, Rui). A new
entry takes the roles of the route its page loads, and the role probe tests that route.

| Item | Visible to |
|---|---|
| Dashboard | everybody |
| Instalações | everybody |
| — Inventário | owner, admin, instructor, maintenance |
| — Ocorrências, Nadadores-salvadores | owner, admin, instructor, maintenance |
| — As minhas férias | instructor, maintenance (not owner or admin, who have Férias under Staff) |
| — Staff, and Férias, Salários, Qualificações under it | owner, admin |
| Energia | owner, admin, maintenance |
| Turmas (Épocas), Calendário (Encerramentos) | owner, admin, instructor, maintenance |
| — Aulas de reposição, under Turmas after Épocas (POOLSE-103) | owner, admin |
| Receção, Faturação | owner, admin |
| Alunos, Encarregados, Níveis, Avanço | owner, admin, instructor |
| — Mensagens | owner, admin, instructor |
| — Competição, and Provas, Mínimos, Escalões under it | owner, admin, instructor; competition module |
| — Pedidos de inscrição | owner, admin |
| Os meus educandos | guardian |
| O meu registo | student who is not also a guardian |

**An entry that belongs to a module carries `module`** (POOLSE-87), checked on every item,
children included, against `/me`'s `modules` (the enabled list): Inventário (maintenance),
Ocorrências and Nadadores-salvadores (incidents), Férias and As minhas férias (vacations),
Salários (salaries), Qualificações (qualifications), Energia (energy), Receção (reception),
Faturação (invoicing), Mensagens (messages), Competição and its three entries (competition). If `/me` fails the list is
empty, closed like the roles.

**A module's pages sit behind `ModuleGate`** (`components/module-gate.tsx`), mounted once in the
`layout.tsx` of each module route segment. Reached by URL with the module off, the page shows its
module's name and "Este módulo não está ativo para o seu clube." (`common.moduleDisabled`), which
`describeLoad` also gives a `module_disabled` 403. A tab on a core page that loads a module's
endpoint through `outcome()` hides by itself, because that 403 is a refusal; the pool page's
Leituras tab follows `waterQuality` from the pool read and its cost tab follows energy.

`unlessRoles` hides an entry from anybody holding one of the listed roles. It exists for a shortcut
to a page that a more senior role reaches another way.

A refusal on a list page reads *not allowed*. *You belong to no organization* is shown only for
the API's `no_organization` code.

**On a phone the menu is a sheet** (POOLSE-88). Below `md` the sidebar is not drawn; a menu
button at the start of the app bar (`MobileMenu`) opens the same `SidebarNav` from the left,
and the sheet closes on its own when a link is followed. The page's title and primary action
stick under the app bar; its subtitle stays in the page. The tiers that say which screens must be
good on a phone are slice 3's section here.

**Touch sizes.** A control reads `h-control`. A target that is not a control (*Voltar*, a card's link, a list's name) takes `coarse:-my-3 coarse:py-3`. The `coarse:` variant is `@media (pointer: coarse)`. The padding and the margin cancel, so the target reaches 44 px and nothing moves. A change to `tailwind.config.ts` reaches the dev server only after `.next` is cleared. Below `sm` a centred dialog is full-screen, with the safe areas inside it, and its × is a control-sized square.

The tier-1 screens are proved by `e2e/phone-*.spec.ts` as two users. One is the E2E owner. The
other is an instructor in the same club, `E2E_INSTRUCTOR_EMAIL` / `E2E_INSTRUCTOR_PASSWORD`, on
the dev Clerk instance only. `auth.setup.ts` signs both in. A spec that needs its own data writes
it through `DATABASE_URL` from a fixture under `e2e/`, never into the reference seed's classes.

**Within a section the most specific entry lights up** (20-10-2026). Competição's first child, Provas,
shares its parent's address, and Mínimos (`/provas/minimos`) and Escalões (`/provas/escaloes`) sit
inside it, so among siblings only the longest matching address is active, and the page is named
(`aria-current`) once, by the child. An old `?section=minimos` link redirects to its route.

**A hidden menu item is never the permission.** Every restricted section's API refuses the
request as well; the menu is a convenience, and a URL somebody types has to be refused on
its own. Permissions are not inherited from a parent item — Instalações and Staff have
different audiences, and Staff disappears for somebody who may see the site but not its
people.

## Telemóvel — what a phone is promised (POOLSE-88)

The same web app runs on iPhone (Safari, and installed to the home screen) and on Android (Chrome
and Samsung Internet, and installed). It must work from 360 px to 430 px wide, in portrait. Every
screen sits in one of three tiers, and each tier promises a different thing.

| Tier | Promise | Screens | Proved by |
|---|---|---|---|
| 1 — poolside | Good one-handed: every target 44 px, no sideways scroll, the right keypad | The week and the next lesson; the lesson's page (register, plan, stand-in, Cancelar aula); finding a student and ringing home; a fee paid; an incident; a water reading; a message to a turma | `phone-poolside.spec.ts`, `phone-shell.spec.ts` |
| 2 — plainly | Works: no sideways scroll, no field squeezed to unreadable | Student and turma pages, every tab; enrolling one student; closures; levels and skills; the dashboard's bands; *O meu perfil* | `phone-tier2.spec.ts` |
| 3 — desk | Readable, nothing broken; not optimised | The calendar's drag and series moves, importers, prices and site settings, `/admin`, meet imports, print views | by eye |

Both Playwright phone projects (`iphone`, WebKit; `android`, Chromium) run every
`e2e/phone-*.spec.ts` at 360 px, as the E2E owner and as the E2E instructor. Emulation cannot raise a real
keyboard, put a real notch on screen or install the app. So the ticket's real-device passes, one
iPhone and one Android, are recorded in the ticket and are not replaced by these specs.

**App mode is a second front door** (POOLSE-90). `/app` routes by role through `lib/app-hats.ts`: owner and admin go to `/dashboard`, a family goes to `/app/familia`, an instructor to `/app/aulas` (slice 2), maintenance to `/app/manutencao` (slice 3), and someone with several homes goes to the one last used on this device. A family-only reader who opens `/dashboard` is sent to `/app`. App mode has its own shell (`(app)/app/layout.tsx`): no sidebar, the mobile palette through `data-surface="app"`, a column at most a phone and a half wide, and *Abrir o backoffice* for staff. Every app-mode screen is tier 1. `docs/features/app.md`.

**Desk-shaped screens have a phone view** (Rui, 21-10-2026). The calendar is a day agenda below `md`. The Turmas weekly board (`WeekGrid`) is one column, a day at a time. Faturação's tables stack into cards through `.table-stack` (globals.css), which reads each cell's label from `data-label`. The lifeguard week (POOLSE-96) is one day at a time with ‹ ›, the hour column beside it. Each one is proved on both sides by `phone-views.spec.ts`: the phone view on a phone, and the unchanged desk screen at 1280 px. Inventário, Salários and the energy faturas still scroll sideways inside their box; they are desk tools and stay so until a club asks.

**Rules a new screen keeps on a phone.**
- Sizes come from `h-control`/`text-control` and the `coarse:` variant.
- Layout follows width (`md:`, `sm:`), never the pointer.
- Use `dvh`, never `vh`.
- A bar stuck to the bottom adds `var(--safe-bottom)`.
- A control that moves between a desk position and a phone position is rendered once and moved by CSS.
- A column beside a photo or a picture takes a `basis-64` so it wraps instead of shrinking.

## The page shell

Every page under `(app)` renders through `PageShell`. `pnpm layout:check` fails the build if
one stops doing so or sets its own outer padding.

The "Voltar" control sits in a sticky strip beneath the app bar. It has **no rule beneath
it** — content passes under an opaque background while scrolling, without a dividing line.
Three pages render a `BackLink` in their body rather than through the shell's prop; those
never had one either.

## Voltar goes back to where you came from

POOLSE-91 (Rui, 22-10-2026). Voltar returns to the screen and the state the person left: the
same tab, section, page of results and filters. A page opened from the main menu has **no**
Voltar.

- **Every in-app link is a `FromLink`** (`components/from-link.tsx`). It stamps the page it
  sits on, path and query, as `?from=` on any link to another page. A link to the *same* page
  (a tab, a page of results, a filter) instead carries this page's own `from` on, so paging
  through a list keeps its way back. `ActionButton`, `WidgetCard`, `Pagination` and
  `SectionPills` are `FromLink`s already.
- **A destination reads it through `lib/back.ts`.** A record or form page uses
  `backTarget(from, parent)`: the origin if it is valid, else its own parent. A page the
  sidebar opens uses `originBack(from)`: Voltar only when it was linked into. `backProp`
  turns either into the shell's `back`, with the label translated.
- **Chains work hop by hop**, because the origin keeps its own `from`: dashboard → site →
  task → Voltar → site, on its tab → Voltar → dashboard. Past 1,500 characters the oldest
  hops are dropped, so a loop between two pages cannot grow a URL without end.
- **`from` is untrusted.** `readFrom` accepts only a path inside `/dashboard`; anything else
  falls back to the parent and never leaves the app.
- **The label names the destination** for a screen reader ("Voltar às qualificações"),
  from the `LABELS` and `RECORDS` tables in `lib/back.ts`. A new section adds a line there.
- **Plain `Link`, on purpose:** `BackLink` itself, the menu (sidebar and user menu), the
  closing button of the student and mínimos import wizards, the invoice's "back to
  Faturação" link, and the crash page's way to the dashboard. Each of those *is* a way
  back or a menu entry, and a `from` on it would point Voltar at the page being left.
  Exports, downloads, print pages in a new tab, `mailto:`/`tel:` and external links take
  no `from` either.
- **After a form saves and redirects** (create, archive), the landing list has no `from`,
  so Voltar never returns to the form.

## Section pills stay in view

POOLSE-92 E. A `SectionPills` row sticks beneath the page's own sticky header (back link, title
and tab strip), so a long section keeps the way to the others on screen. `StickyUnderHeader`
measures whichever `PageShell` block is sticky at that width (`data-page-sticky`) rather than
assuming a height. Below `md` the row is one horizontally scrolling line, so the frozen part of a
phone stays a header (about a third of a 740 px screen on a site's Preços tab).

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
- **An eager page renders every tab with the page** and switches in the browser, without
  asking the server again. The medical record is one: each read of it is written to the audit
  log, and a read per tab click would fill that log with accidents.
- On a narrow screen the strip scrolls sideways and keeps the active tab in view.

| Page | Tabs |
|---|---|
| Site — `/dashboard/facilities/[id]` | Geral (pessoas, meteorologia, localização, horário, idade máxima das análises) · Preços (tabela, categorias, seguro) · Parcerias · Piscinas · Ocupação (a época, carregada ao abrir — POOLSE-66 2b) · Espaços · Manutenção · Fotografias |
| Tank — `/dashboard/facilities/pools/[id]` | Geral (detalhes, arquivar) · Qualidade da água (ponto quando a última análise está fora dos limites) · Custo por utilização (owner, admin; carregado ao abrir) · Fotografias |
| Student — `/dashboard/students/[id]` | Geral (progresso e ficha médica, identificação) · Mensalidades (se as pode ver) · Documento (owner, admin) · Turmas (contagem; só se inscrito) · Semana (carregada ao abrir) · Reposições (contagem; só se houver) |
| Turma — `/dashboard/classes/[id]` | Geral (formulário, arquivar) · Horário (contagem) · Alunos (contagem de inscritos; custo da água carregado ao abrir) |
| Espaço — `/dashboard/facilities/spaces/[id]` | Geral (estado e "Marcar como limpo"; ponto quando em atraso) · Histórico de limpezas (a paginação mantém o separador) · Ocorrências (contagem das abertas) |
| Staff member — `/dashboard/facilities/staff/[id]` | Geral (ficha) · Funções (owner, admin) · Acesso (mudança de endereço; owner; ponto quando pendente) |
| Maintenance task — `/dashboard/facilities/tasks/[id]` | Geral (factos e registo; ponto quando por fazer) · Histórico (carregado ao abrir; a paginação mantém o separador) · Plano (owner, admin) |
| Partnership — `/dashboard/facilities/partners/[id]` | Geral (identificação) · Contactos (contagem) · Acordo · Grupos (contagem) · Horário |
| Meter — `/dashboard/facilities/energy/[id]` | Geral (consumo, ano a ano, custo estimado) · Leituras (registo e histórico; contagem) · Faturas (carregadas ao abrir) · Tarifário · Detalhes (owner, admin) |
| Medical record — `/dashboard/students/[id]/sensitive` | Geral (notas) · Contacto de emergência · Consentimentos · Baixa médica (ponto quando ativa; continua dobrada) · Histórico (só se houver) — *eager*: uma leitura auditada, mudar de separador não regista outra |
| Progress — `/dashboard/students/[id]/progress` | Geral (mais rápido, favorito, gráfico) · Recordes · Histórico (contagem) — ambos só com registos · Registar (quem pode registar) |
| My profile — `/dashboard/profile` | Geral (perfil, subscrição para o owner, período experimental, organização e funções) · Organizações (só com mais de uma) · Sessões · Transferência (owner) |
| Tenant (platform) — `/admin/tenants/[id]` | Geral (período experimental reclamado) · Ações · Pagamentos (contagem; só se houver) · Pedidos e erros (ponto quando âmbar ou vermelho) — *eager*: cada leitura é auditada |


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

## One section at a time — 12 October 2026

Where a page or a record tab stacks independent sections, a row of pills (`SectionPills`,
`?section=`) shows one at a time, so the reader scrolls as little as possible. The pills keep the
page's other query parameters (tab, site, search, filters) and drop `page`. A section the reader
cannot see is not offered, and one pill alone is not drawn. Where:

| Screen | Pills |
|---|---|
| Site → General | Pessoas · Meteorologia · Localização · Horário · Água |
| Site → Preços | Mensalidades · Quota de sócio · Inscrição e seguro · Natação livre · Descontos · Pagamentos |
| Tank → Água | Última análise · Tendências · Histórico · Alertas · Registar · Limites (the unsafe-water warning stays above the pills) |
| Meter → General | Consumo · Ano a ano · Custo estimado |
| Inventário | Inventário · Achados e perdidos |
| Equipa | Membros · Convites |
| Qualificações | A tratar · Tipos |
| Aluno → Mensalidade | Mensalidades (with the period total) · Inscrição e seguro · Quota de sócio |
| Turmas | Semana · Sem horário · Parcerias |
| Épocas | Épocas · Planeamento · Iniciar nova época |
| Faturação | Este mês · Em dívida (the existing view switch; Configuração went to the site's *Dados do clube* tab, POOLSE-104) |
| `/admin` | Clientes · Faturação |

Not split, on purpose: the dashboard (an overview read at a glance), the calendar, documents
(an invoice, an energy bill) and a summary above the list it sums (Salários, where the import and
export are folded into a disclosure instead). On Instalações each site card shows its tanks only;
Espaços and Fotografias are links to the site's own tabs. A turma's roster puts *Inscrever aluno*
first, folded.

## PDF of a list — 12 October 2026

Every list export (alunos, inventário, salários, parcerias, análises da água) offers **PDF** beside
Excel and CSV. It opens the same rows as the file, filtered the same way, as an A4 page in a new
tab, and brings up the print dialog (*Guardar como PDF*). One layout, `lib/print-table.ts`, and
no PDF library. On paper a date reads dd-MM-yyyy and a value the file writes in a form meant for
re-import (inventory's `all`) is said in words.
