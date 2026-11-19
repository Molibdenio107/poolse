# Onboarding and Início: creating the club, the welcome, and the home

The first two screens a new account sees, the second of which stays as the Owner's and Admin's
home, *Início* (Rui, 10-11-2026).

## Creating the club

A login with no membership ends up on `/dashboard`, which shows the creation card in place of
the dashboard. The card is headed *Bem-vindo ao Poolse, {nome}*, with no subtitle, and holds a
water banner, then one form in three numbered steps.

1. **O clube.** The name, plus the first site's name (blank means "same as the club").
2. **Contactos.** The reply email (prefilled with the creator's address) and the optional club
   phone (POOLSE-209, -210).

**The form no longer offers *A minha própria piscina*** (Rui, 19-11-2026, POOLSE-227). Slice
4.5's personal tenant stays whole — the `personal` kind, the API, `provision_organization`'s
branch and every personal screen — and an existing one keeps working. `OFFER_PERSONAL` in
`create-organization-form.tsx` brings back the first question (two cards, *Um clube* / *A minha
própria piscina*, folding the club-only fields away with `Reveal`). A hand-posted
`kind=personal` still creates a personal tenant: the action and the API are unchanged.

It is still one screen and one submit. Nothing is asked here that cannot be changed later, and
the page says so. What comes after it for a new club's Owner is POOLSE-228's setup.

On success `createOrganizationAction` redirects to `/dashboard/welcome?new=1`. It does not
`revalidatePath` first, because re-rendering the dashboard would unmount the form before
the redirect ran. A refused trial (POOLSE-62) or a bad field stays on the form, as before.

## Início (`/dashboard/welcome`)

**The Owner's and Admin's home.** Sign-in and sign-up land here (Clerk's `fallbackRedirectUrl`;
a `redirect_url` from a followed link still wins), and it is the first menu entry, *Início*,
above *Painel*, for `owner` and `admin` only. Its heading is *Tudo pronto* with *{clube} já está no
Poolse.* on the `?new=1` visit right after creation, and *Início* on every other visit.

Every other reader (no membership, or any other role) is sent on to `/dashboard` by `LandOn`
with a **full page load**, never a server `redirect()` or `router.replace`. Clerk's navigation
after sign-in lands here, and the next in-app navigation after it never commits: the address
stays and the page is blank (walk, 10-11-2026). `/dashboard` then sends a family or a teacher's
phone on, as before.

It shows:

- the Poolse mark locking in (`LogoLockIn`), over the water banner;
- the club's name, and for a club the trial's last day as visible text (`dd-MM-yyyy`);
- for a club, *Configurar o clube* (Rui, 17-11-2026): a button straight to the site's own page
  (opening hours, pools, lanes and the club's details under Geral), or to the Instalações list
  when the club has several sites or none yet;
- *Por onde começar*: for a club, four links (Instalações, Turmas, the student importer, the
  staff page); for a personal pool, one link to the dashboard for the first reading;
- *Ir para o painel*.

The creator is always the Owner, and none of the links depends on a module a club can
switch off. The page scrolls the window to the top on mount: the redirect is a soft
navigation, and Next would otherwise leave the title under the sticky app bar.

## The setup after creating (POOLSE-228)

A business club made from now on opens on `/dashboard/setup`: **one wizard of five steps**, the
Owner's own details first (Rui, 19-11-2026, which replaced *Confirmar os seus dados* as a screen
before the setup). This **partly reverses** "one screen, never a
wizard" (Rui, 19-11-2026): the creation form stays one screen, and the guide comes after it.

0. **Os seus dados.** The details form (`ConfirmDetailsForm`) with an optional *Data de
   nascimento*, saved through `PUT /me/profile`, the same date *O meu perfil* holds. It is the
   web's own step (`WIZARD_STEPS`; the API's pointer starts at `club`): a setup that has not
   moved opens on it, and while a required detail is missing it is the only step. The layout does
   not draw the separate details screen for an Owner mid-setup (`guided`). Its *Seguinte* saves
   and opens *Clube*; *Voltar* from *Clube* is a link back.
1. **Clube.** The NIPC (`TaxPanel`), the site's morada (`SiteDetailsForm`), the contacts
   (`ClubContactsPanel`) and the logo (`LogoPanel`). The name was asked at creation.
2. **Recintos e horário.** The first site's pools, each with *Abrir* to its own page, and
   *Adicionar tanque* in the step itself: folded until opened, then Instalações' own `PoolForm`
   with every measurement (`stay`, through `addSetupPoolAction`). Saving lists the new tank at
   once, folds the panel and empties the form, never leaving the setup (Rui, 19-11-2026). Then
   the opening hours (`HoursPanel`).
3. **Convidar equipa.** The Staff page's `InviteForm`, with admin, instructor and maintenance only.
4. **Já tem alunos ou horários numa folha?** The students importer and the calendar (which
   holds the timetable import), each stamped with this step as their way back. *Não, começar
   do zero* finishes.

No season step (Rui, 19-11-2026): the season provisioning opens stands, and *Épocas* changes it.

- **The page has the creation screen's look** (Rui, 19-11-2026): a highlighted head with the water
  banner and the step's picture, the five steps as numbered circles on a line (ticked behind,
  filled and ringed now, muted ahead, each a link), then the step's cards.
- **One way to leave for later.** *Seguinte* moves on, *Voltar* reopens the one before, and
  *Terminar mais tarde* goes to Início with the pointer kept. *Configurar mais tarde* was removed
  the same day. A step left blank still shows on *Vamos começar*, which for a club that had the
  setup lists the four setup lines and ticks them by data.
- **The menus wait for the setup** (Rui, 19-11-2026). While an Owner's setup is under way, the
  backoffice hides the sidebar, the phone's menu button and the club/sport tabs; the top bar
  keeps the club's name, search, the bell, language and the account. `GET /me` says so
  (`guidedSetup`, from `onboarding_progress`). *Ir para o painel* on Início
  (`PUT /onboarding/menus`, Owner, own row) brings them back on the account, for every
  device (`menus_shown_at`), and so does finishing the setup. Nobody else is ever guided.
  Each panel keeps its own *Guardar*: the wizard holds no setting, so nothing it saves can
  disagree with the page that owns it.
- **The pointer is `onboarding_progress`** (`GET /onboarding`, `PUT /onboarding/step`, Owner
  only, the session's own row). `wizard_started_at` is written only by `POST /organizations`
  for a business club, so the pilot and every older club never see the wizard; a failure there
  costs the guide, never the club.
- **Resumable.** While it is under way, Início's *Configurar o clube* becomes *Continuar a
  configuração*, to the saved step. Finishing lands on *Tudo pronto* (`/dashboard/welcome?new=1`).
- `/dashboard/setup` for anybody without a wizard (an Admin, a finished one, an older club) is
  handed on to Início.

## Início's two pages (Rui, 19-11-2026)

*Vamos começar* and *Por onde começar* on one page did not combine, so Início has two pages
behind pills (`?section=setup|start`):

- **Configurar o clube** (`setup-panel.tsx`) is highlighted with a ring, the water banner and a
  cog. While the Owner's setup steps are under way it shows only them: the four steps (done,
  left for later, current, to come) and *Começar a configuração* / *Continuar a configuração*.
  Once they are finished, or for a club that never had them, it holds *Vamos começar*.
- **Por onde começar** is the page Início always was: the Poolse mark, the club, the trial's
  end, *Configurar o clube*, the four cards and *Ir para o painel*.
- The setup page exists while there is something to set up, and Início opens on it until then.
  Its pill carries the attention dot. With nothing left, Início is the second page alone.
- **While the Owner's setup steps are under way, Início is the setup page alone** (Rui,
  19-11-2026): titled *Vamos começar*, no pills, no *Por onde começar*, with *Ir para o painel* at
  its foot. *Por onde começar* joins once the steps are done.

## Vamos começar (POOLSE-229)

**Nothing locks once done** (Rui, 19-11-2026). A done line keeps its link, and the tour's line offers
*Rever visita guiada*. A finished setup opens again from *Rever os passos da configuração*,
every step ticked, its buttons only moving between steps (*Voltar ao Início* at the end).
*Dispensar* sits under the page, centred and small, like *Terminar mais tarde*.

On Início's setup page, for a club's Owner and Admins: what the club still needs, each line ticked by
the API from the club's own data (`readChecklist`, one statement) and linked to its screen.

| Line | Shown | Done when |
|---|---|---|
| Dados do clube | setup step *Clube* skipped | the NIPC and a live site's morada are set |
| Recintos e horário | step skipped | a live pool, and a day's hours changed from the seeded 00:00–24:00 |
| Equipa | step skipped | an invitation sent, or a second working person |
| Alunos | step skipped | a live student |
| Criar as primeiras turmas | always | a live turma in the published shared season |
| Definir preços | always | a live `fee_plan` |
| Abrir a pré-inscrição | always | `public_registration_open` |
| Fazer a visita guiada | always | the reader's tour finished or closed — the one stored tick |

- **Live, never stored**: archive the only turma and its line opens again.
- Open lines first. A done line shows a tick **and** *Feito*.
- The card disappears when all are done or the Owner dismisses it (*Dispensar*, which asks
  first). It comes back from *O meu perfil* → *Ajuda para começar*.
- **An Admin reads it and cannot dismiss it** (Rui's default, 19-11-2026). The public form's
  line says *Só o titular pode abrir o formulário* instead of linking to a switch that would
  refuse them.
- An older club, the pilot included, sees the four standing lines. A dismissal makes a progress
  row with no `wizard_started_at`, so it never opens the setup wizard.

## The guided tour (POOLSE-230)

Small in-house coach marks (`components/tour/guided-tour.tsx`, steps in `lib/tours.ts`), no
dependency. **It never starts on its own.** The ways in are *Fazer a visita guiada* on *Vamos
começar*, *Rever visita guiada* on *O meu perfil* (desk) and on Perfil → Definições (`/app`),
and Ctrl+K.

- **One step per real area, each with what it is for and two or three tips** (made deeper the
  same day: "it needs more details tips"). Steps point at the real menu entry or on-page control
  by selector, and a step whose target is not on screen is skipped, so modules, roles and sports
  need no second list.
  - **Backoffice (13):** Início, Painel, Procurar, Notificações, Instalações (Staff is here),
    Energia, Receção, Faturação, Alunos, the sport's tab, then Calendário, Turmas and Piscinas.
    The last three carry `via`: the tour opens the sport's section and waits for the entry.
    *Anterior* back past it returns to the starting page, and *Concluir* goes back there too.
  - **Family (up to 7):** Início, the children filter (two or more children), Pagamentos (when
    there is a card), *Pedir inscrição*, Aulas (or *Modalidades*), Progressos, Perfil.
  - **Teacher (6):** Início, the next lesson's card, Notificações, Aulas, Alunos, Perfil.
  - **Maintenance (4):** Hoje, Notificações, Registar, Perfil.
- The tips promise only what a club has without a flag: no PDF or photo reading, which are the
  AI readers, off by default.
- **Below `md` in the backoffice** the sidebar is behind the menu, so the step rings the menu
  button (`data-tour="menu"`) and says the entry is in the menu. The sport tab is drawn only
  once the menu opens, so its step is `inMenu`.
- **The app's tabs are `[data-tour="tabs"]`.** A selector on `nav a[href]` alone ringed the
  family's *Todos* filter, a link to the same address.
- Definições has no tab bar, so its button opens the home with `?tour=1`. The tour starts there
  and takes the flag off the address. A tap still started it.
- **Keyboard:** focus moves to the card's main button once the card is drawn, Tab stays inside,
  the arrows move between steps, Escape closes, and focus goes back to the button that started
  it. These keys are handled on the window while the tour is open. The card is a labelled
  `role="dialog"`. Nothing glides under reduced motion. The dim is the dialog's (black at 40%),
  and the ring is the primary token.
- `PUT /onboarding/tour` (`finished` | `dismissed`) answers any member, for the session's own
  row. The first of each is kept, so a replay changes nothing. Under *Ver como* the write is
  refused and the tour plays anyway.

## Confirmar os seus dados (POOLSE-227)

Before the first screen, everybody confirms the details their club needs from them, once, and
only if something is missing. `requiredDetails(roles, …)` in `@poolse/rules` is who needs what:

| Role | Required |
|---|---|
| owner, admin | first and last name; the mobile is offered, never required (Rui, 19-11-2026) |
| guardian, a student on the adult path | first and last name, mobile |
| instructor, maintenance | the above, plus NIF and morada (address, código postal, localidade) |

A minor student with a login is not asked. Several roles ask for the union.

- **Decided by the data, never by a "seen" flag.** `GET /me` returns `detailsMissing` for the
  active club (`identity/details-gate.ts`): the name from Clerk's cache, the mobile from the
  login, the NIF and morada from the person's own `membership`. Clear one later and the gate
  comes back.
- **Rendered, not redirected.** The `(app)` layouts (`dashboard/layout.tsx`, `app/layout.tsx`)
  draw `ConfirmDetails` (`components/confirm-details/`) in place of the page whenever the list
  is not empty, after a suspension or an ended support window. A server redirect after Clerk's
  sign-in leaves a blank page (`docs/conventions/interface.md`), so do not turn this into one.
- **Never under a borrowed identity.** Under *Ver como* (POOLSE-188) or a Poolse support
  membership (POOLSE-79) the list is empty; `/admin`, `/join` and the create form have no gate.
- **No new write path.** `confirmDetailsAction` re-reads `/me`, refuses blanks in the required
  fields, then saves through `PUT /me/profile` (name to Clerk, mobile to `app_user`) and, for
  staff, `PATCH /staff/:id/details` on the session's own membership. Two calls are not one
  transaction; a failure in the second leaves the first saved and the gate asks for the rest.
- **Prefilled, so nothing is typed twice.** A NIF the office already typed is shown read-only:
  changing it is the Owner's (POOLSE-149); a blank one the person fills (`docs/features/staff.md`).
- **A guardian sees their children read-only** (`GET /family`, name and relationship), with
  *Avisar a secretaria*: the club's reply email with the child named in the subject, and its
  published phone (`GET /app/club-contact`). No queue of its own.
- **It looks like the screen that created the club** (Rui, 19-11-2026): the water banner and the
  Poolse mark, then the fields in headed groups (*Como o contactamos*, *Para os salários*). For an
  Owner whose club was made a moment ago (setup not yet moved), it is that creation's step 2. It
  shows *O clube* ✓ → *Os seus dados* → *Configurar o clube* and the button says *Continuar*.
- **On the phone** it is a full screen on the app palette with no tab bar; **on the desk** the
  same card, centred. *Terminar sessão* is the one way out other than the form.
- **E2E.** `auth.setup.ts` fills only the blanks of every E2E login (*every E2E login has its
  details*), or every spec would stop on the gate; `phone-gate.spec.ts` blanks the guardian's
  mobile and walks through it.

## Motion

The motion is CSS in `globals.css` (`.onboard-*`): waves that drift, cards that rise in turn
(`--i` sets the order), the tick and the ripples. All of it sits inside
`prefers-reduced-motion: no-preference`, so with reduced motion on, nothing moves and
everything is visible from the first frame. `WaterBanner`
(`app/(app)/dashboard/water-banner.tsx`) is decoration only and `aria-hidden`.

## Joining by invitation

*Já faz parte de {clube}* (`app/(app)/join/joined.tsx`) uses the same water banner and Poolse mark as Início (`WaterBanner`, `LogoLockIn`; the tick it had until 17-11-2026 was replaced at Rui's request), then the sentence and an *Entrar* button to `/app`. It shows right after accepting and when a used link is opened again. The accept is `quiet`, so no *Guardado.* pulse plays over it.
