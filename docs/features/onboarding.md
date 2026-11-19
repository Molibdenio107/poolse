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

## Confirmar os seus dados (POOLSE-227)

Before the first screen, everybody confirms the details their club needs from them, once, and
only if something is missing. `requiredDetails(roles, …)` in `@poolse/rules` is who needs what:

| Role | Required |
|---|---|
| owner, admin, guardian, a student on the adult path | first and last name, mobile |
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
- **On the phone** it is a full screen on the app palette with no tab bar; **on the desk** a
  `PageShell` card. *Terminar sessão* is the one way out other than the form.
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
