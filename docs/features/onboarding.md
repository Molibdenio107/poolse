# Onboarding and Início: creating the club, the welcome, and the home

The first two screens a new account sees, the second of which stays as the Owner's and Admin's
home, *Início* (Rui, 10-11-2026).

## Creating the club

A login with no membership ends up on `/dashboard`, which shows the creation card in place of
the dashboard. The card is headed *Bem-vindo ao Poolse, {nome}*, with no subtitle, and holds a
water banner, then one form in three numbered steps.

1. **O que vai gerir?** A club or site (`business`) or one's own pool (`personal`), as two
   cards. The chosen card shows a border, a tint and a tick, so colour is never the only sign.
2. **O clube / A piscina.** The name, plus for a club the first site's name (blank means
   "same as the club").
3. **Contactos** (clubs only). The reply email (prefilled with the creator's address) and
   the optional club phone (POOLSE-209, -210).

Choosing *A minha própria piscina* folds step 3 and the site field away with `Reveal`. It is
still one screen and one submit, never a wizard. Nothing is asked here that cannot be changed
later, and the page says so.

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

- a tick that draws itself inside two ripples, over the water banner;
- the club's name, and for a club the trial's last day as visible text (`dd-MM-yyyy`);
- *Por onde começar*: for a club, four links (Instalações, Turmas, the student importer, the
  staff page); for a personal pool, one link to the dashboard for the first reading;
- *Ir para o painel*.

The creator is always the Owner, and none of the links depends on a module a club can
switch off. The page scrolls the window to the top on mount: the redirect is a soft
navigation, and Next would otherwise leave the title under the sticky app bar.

## Motion

The motion is CSS in `globals.css` (`.onboard-*`): waves that drift, cards that rise in turn
(`--i` sets the order), the tick and the ripples. All of it sits inside
`prefers-reduced-motion: no-preference`, so with reduced motion on, nothing moves and
everything is visible from the first frame. `WaterBanner`
(`app/(app)/dashboard/water-banner.tsx`) is decoration only and `aria-hidden`.

## Joining by invitation

*Já faz parte de {clube}* (`app/(app)/join/joined.tsx`) uses the same water banner, tick and ripples as Início (`WaterBanner`, `CheckPulse`), then the sentence and an *Entrar* button to `/app`. It shows right after accepting and when a used link is opened again. The accept is `quiet`, so no *Guardado.* pulse plays over it.
