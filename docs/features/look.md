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
