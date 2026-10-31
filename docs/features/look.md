# The look — POOLSE-138 (31 October 2026)

The first layer of the Claude Design handoff (`docs/design/`): tokens and primitives on every
page, no layout moved. The per-sport top bar, sidebar, icon set and calendar styling are later
tickets (POOLSE-125/127, 136).

## Type

- **Backoffice and public pages:** headings Poppins 600, body Montserrat 400–700.
  **App mode** (`[data-surface='app']`): Quicksand 500–700 for everything.
- Loaded by `next/font/google` in `lib/fonts.ts`, self-hosted at build time: no browser asks
  Google for a font. The variables sit on `<body>` in every root layout (never `<html>`, whose
  class has one owner), and `body` sets `font-sans` itself because the variables do not exist
  on `<html>`.
- `font-heading` is applied **by element** (`h1`–`h3` in `globals.css`), never by weight.
- Montserrat is wider than the system font: a control whose words may wrap on a phone takes
  `min-h-control` (the students filter toggles needed it).

## Shape

- `--radius` 4 px for cards (`rounded`, `rounded-lg`); `--radius-control` 2 px for every
  control (`rounded-sm`, carried by everything with `h-control` / `min-h-control` and by
  `CONTROL_BASE` in `field.tsx`); `--radius-chip` 6 px for a lesson block on the calendar and
  its phone agenda (`rounded-chip`). Pill tabs (`rounded-full`) stay round.
- **A card has no border in light mode**: `bg-surface shadow-card` (`--shadow-card`). In dark
  the shadow is invisible on the ground, so `.dark .shadow-card` is a 7 % hairline instead.
  Lists (`divide-y`) and table wrappers keep their borders, and so do muted inset panels,
  popovers, dashed drop zones, fieldsets and buttons.

## Colour

- The backoffice palette is unchanged.
- **App mode's primary is the handoff's `#4FA3C7`** with ink text on it (6.4:1), replacing a
  deeper teal with white text. It is a fill only: app links and labels keep the teal
  (`--app-primary-ink`), and so does the focus ring (`--ring`). On white the fill is 2.8:1, a
  known exception in `contrast:check` like the backoffice brand fill's.
- **Sport washes** (`--sport-*`, `--wash-a`, `[data-sport]`, `.sport-shell`) are in
  `globals.css` from `docs/design/tokens.css` and inert: nothing sets `data-sport` yet, so a
  pool club renders exactly as before. Atmosphere only, never a button, text or primary.

## The frame — POOLSE-139 (31 October 2026)

- **Top bar** (`(app)/dashboard/layout.tsx`): full width, above the sidebar, 56 px with the
  notch, card background and a bottom hairline (`shadow-hairline-b`). Left: Poolse's
  `LogoMark` and name (from `sm`; a phone keeps the room for the club's name), a divider, then
  the club's logo and name at their own size. Right: palette, language and theme, avatar. The
  middle is empty for a pool-only club; it is where POOLSE-125's sport tabs go.
- **Sidebar** (`app-sidebar.tsx`): 240 px under the bar, sticky at `top-app-bar`, right
  hairline; rows 38 px (44 under a finger), 2 px corners, 13 px text, 19 px icons; the current
  page on the muted fill at 600. The phone menu draws the same rows.
- **Page header** (`PageShell`): title 22 px on a phone, 30 px on a desk, Poppins 600;
  subtitle 13 px. *Voltar* is unchanged; no breadcrumb for a single-sport club.
- **Buttons:** secondary is `bg-surface shadow-card`, no border; primary 600. Height and text
  size stay `h-control` / `text-control`.
- **Calendar blocks:** the handoff's chip — the level tint at 16 % over the card, ink text,
  and a 3 px solid bar in the tint (`.lesson-chip`). Classes only: nothing about the grid's
  geometry, dragging or the markup changed (Rui asked for looks only). The handoff's 8 px dot
  and 13 px title were dropped because a lane column is too narrow for the name with them; the
  toolbar's grouping and the 64 px time column were left as they were.
