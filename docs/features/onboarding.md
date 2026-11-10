# Onboarding: creating the club, and the welcome

The first two screens a new account sees (Rui, 10-11-2026).

## Creating the club

A login with no membership lands on `/dashboard`, which shows the creation card in place of
the dashboard: a water banner, then one form in three numbered steps.

1. **O que vai gerir?** A club or site (`business`) or one's own pool (`personal`), as two
   cards. The chosen card shows a border, a tint and a tick, so colour is never the only sign.
2. **O clube / A piscina.** The name, plus for a club the first site's name (blank means
   "same as the club").
3. **Contactos** (clubs only). The reply email (prefilled with the creator's address) and
   the optional club phone (POOLSE-209, -210).

Choosing *A minha própria piscina* folds step 3 and the site field away with `Reveal`. It is
still one screen and one submit, never a wizard. Nothing is asked here that cannot be changed
later, and the page says so.

On success `createOrganizationAction` redirects to `/dashboard/welcome`. It does not
`revalidatePath` first, because re-rendering the dashboard would unmount the form before
the redirect ran. A refused trial (POOLSE-62) or a bad field stays on the form, as before.

## The welcome

`/dashboard/welcome` reads `/me`. With no membership it redirects to `/dashboard`, so it is
safe to bookmark or revisit. It shows:

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
