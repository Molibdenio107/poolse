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
  `globals.css` from `docs/design/tokens.css`. Atmosphere only, never a button, text or
  primary. `SportShell` and the section tabs (POOLSE-141) set `data-sport`, and only for a
  multi-sport club, so a pool club renders exactly as before. `contrast:check` measures ink
  and muted text on every wash, over the page and over a card, in both themes.
- **Status colours are ours, not the handoff's.** Its `--ok`/`--warn` are `--success` /
  `--warning` and their inks (01-11-2026): its orange warn sat next to `--danger`.
  `--wash-green` is a wash only. `--radius-card` and `--shadow-chip` (`shadow-chip`) carry
  the handoff's names.

## Sports — the handoff's Slice 0 (1 November 2026)

- **`isMultiSport(sports)`** in `@poolse/rules` is the one switch behind every multi-sport
  surface: the section tabs, the sidebar per section, the wash, and sport chips and labels.
  A missing or empty list counts as `[pool]`, and so answers false.
- **A sport's metadata** is three facts, one place each: the id in `POOLSE_SPORTS`, the name
  at `sportNameKey(sport)` (`sport.name.*`, pt-PT and en, with the pool called *Natação*
  everywhere), and the icon in `SPORT_ICON` (`components/sport-icon.tsx`).
- **Every sport has its own glyph.** These are Lucide stand-ins until Material Symbols arrive
  after the pilot. Tennis, padel and basketball are drawn with `createLucideIcon`, because
  Lucide has none; padel is the handoff's own SVG. The icon always sits beside the name.

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

## Shared components — the handoff's Slice 5 (1 November 2026)

- **`Badge`** (`components/ui/badge.tsx`) is a state as a word on a tint: 11 px bold, 2 px radius, no border. It has
  five tones:
  - `ok` (done, fine) and `pending` (waiting on somebody);
  - `late` (behind, needs doing: *em atraso*) and `danger` (a failure);
  - `muted` (quiet).

  The tones are our green / primary / amber / red, each ink on its own wash, AA in both themes (`contrast:check`).
  The invoice status, the email delivery and the vacation request badges use it, so an overdue invoice is now amber
  rather than red. Roles, qualifications and lab grades keep their own chips.
- **`SportChip`** (`components/sport-chip.tsx`) shows a 4 × 14 px bar in the sport's colour, its icon and its name,
  on a card or a muted fill. It is shown only where `isMultiSport`. First use: the student's *Turmas* tab (each
  turma's sport comes from its recinto, `timetable.sport`).
- **`AttendanceStrip`** (`components/attendance-strip.tsx`) shows a student's last lessons in a turma as one
  14 × 6 px block each, oldest first: filled is present, muted absent, outlined excused, dashed not marked. A visible
  count (*5 / 8 presenças*) and one spoken summary go with it. It reads `GET /students/:id/attendance-recent` (the
  last 8 taught lessons per active turma since the student joined, cancelled ones left out, one statement), which
  staff and the child's own family may read. First use: the student's *Turmas* tab.
- **`PageEmpty`** is the handoff's empty state: a 32 px icon (an inbox by default), a title in the heading face, a
  muted line, and up to two actions (secondary, then primary). Its seven pages took it as they were; the ~40
  hand-written empty sentences change with the slices that redo their screens.

### Which empty states are `PageEmpty` (sweep 01-11-2026)

`PageEmpty` is for a page's or a tab's whole content being empty, and it uses that page's own
menu icon: Turmas, Épocas, Energia, Instalações, Inventário, *Os meus educandos*, Competição, the
mínimos import, and the weekly board with no time slots (which keeps its *Construir a grelha*
action). Its title is one short sentence, and anything after it goes in `hint`.

A list under a card's own heading (an invoice's payments, a meter's readings, *Em dívida* under
its card) keeps one muted sentence. A second card inside the first would be a box in a box.
App mode and the public pages keep their own empty lines.

## Chart colours are Poolse's (02-11-2026, Rui)

Every chart reads `--chart-1/2/3`: **teal** (the brand teal, deepened to 3.8:1 — electricity, turmas),
**soft orange** (the app's accent, 3.4:1 — gas, parcerias) and **green** (the brand green, 3.5:1 —
water). The dark theme uses the brand's own dark steps. They replace the generic blue/orange/aqua set of
19-10-2026; teal and green are closer for a colour-blind reader, so every chart keeps its legend in words
and its table. *Hoje, hora a hora* is one hue: past hours pale teal, this hour solid teal ink, the hours
to come the brand teal.
