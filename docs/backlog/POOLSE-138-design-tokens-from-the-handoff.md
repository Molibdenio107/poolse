# POOLSE-138 · The look from the Claude Design handoff lands as tokens on every page: fonts, radii, borderless cards, sport washes

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Global / Design · **Priority:** High (pre go-live) · **Depends on** `docs/design/` (the handoff, 30-10-2026) · **Related** [POOLSE-136](./POOLSE-136-the-app-phone-shell.md) (the app's shell wears these), [POOLSE-125](./POOLSE-125-navigation-per-sport.md) (the top bar and per-section sidebar — not this ticket)

### PO — why this exists

Rui, 30-10-2026: *"i also want the design for the desktop app as well"* — for the 9 November target.

The design made in Claude Design (`docs/design/README.md`, `tokens.css`, the `.dc.html` boards) has two layers. The **look** — fonts, radii, shadows instead of borders, the sport washes — is tokens and primitives, and lands on all 86 pages in one evening with no layout moving. The **layouts** — the per-sport top bar and sidebar, the calendar grid styling, the Material icon set — are per-screen work that the handoff itself says a single-sport club never sees, and they wait for after the pilot. This ticket is the first layer only.

**What the handoff does not change:** the palette. Both backoffice themes and the app palette in `tokens.css` are the values already in `globals.css`; the dark ink on primary buttons has been in since 28-10. Nothing to do there.

**Not in scope:**
- The backoffice top bar with *Instalação* + sport tabs and the per-section sidebar — POOLSE-125. Single-sport is pixel-identical by the handoff's own rule.
- Material Symbols Sharp. The app uses Lucide in 166 files; swapping icon sets is a sweep for after the pilot. The padel SVG waits with it.
- The calendar grid look (handoff section 03) beyond what the tokens give the event chip.
- The app tab bar, the Modalidades sheet, Início and the sport screen — POOLSE-136.
- Any per-screen layout change. If a screen looks wrong after the tokens land, it gets its own line in a later round, not a fix here.

### BA — rules

1. **Fonts.** Backoffice: headings Poppins 600, body Montserrat 400/500/600/700. App mode (`[data-surface='app']`): Quicksand 500/600/700 for everything. Loaded with `next/font/google` (self-hosted at build, no runtime call to Google), `display: swap`, Latin subset. Headings are `h1`–`h3` and the page-shell title; nothing else goes Poppins.
2. **Radii.** Cards 4 px, controls (buttons, inputs, selects, segmented) 2 px, turma chips 6 px; app-mode phone-level buttons 4 px. One `--radius` for cards; a `--radius-control` for controls; the chip keeps its own class.
3. **Cards have no border in light mode.** A card is card-colour on the tinted background with `0 1px 3px rgb(0 0 0 / .08)`. **In dark mode the shadow is invisible on `13 18 21`, so a card keeps a hairline** at `rgb(var(--foreground) / .07)` — the handoff's own hairline value — so sections still separate. (Decided here as the cheaper-to-reverse reading; the handoff is silent on dark cards.)
4. **Lists keep their hairlines.** `divide-y divide-border` rows and table header rules are unchanged; only the outer card border goes.
5. **Buttons.** Primary = `--primary` fill, `--primary-foreground` ink, 600 13 px, padding 10/16. Secondary = card fill + card shadow. App light `--app-primary-foreground` becomes `17 24 28` (ink), as the handoff says; today it is white.
6. **Sport washes exist and are unused.** The eight `--sport-*` triples per theme, `--wash-a`, `[data-sport]` scopes and `.sport-shell` from `tokens.css` go into `globals.css` verbatim. No page sets `data-sport` in this ticket; a single-sport club renders without any wash. POOLSE-125/127 turn them on.
7. **Green `179 212 157` is a wash, never text** — already the rule; restated so the token is not reused as an accent.
8. **Both themes, every page, no layout moves.** The visual sweep is the test: every page in light and dark at desktop and the two phone projects, with the existing snapshot suite updated in one commit and read, not blindly accepted.

### Dev notes

- **Fonts.** `(app)/layout.tsx`: three `next/font/google` instances exposed as CSS variables (`--font-heading`, `--font-body`, `--font-app`); `tailwind.config` `fontFamily.sans` → body, `fontFamily.heading` → heading; `[data-surface='app']` sets `--font-sans: var(--font-app)`. The `(marketing)` layouts opt in to the same fonts in a line each or keep the system font — Rui's call, default: same fonts.
- **Radii.** `--radius: 4px` (cards); add `--radius-control: 2px` and map `rounded-sm` to it in `tailwind.config` `borderRadius`, then `field.tsx` and the button classes use `rounded-sm`. The 1,196 bare `rounded` usages follow `--radius` automatically.
- **Cards.** The outer-card class string is consistent: `rounded border border-border bg-surface p-5` (87 exact + ~200 variants with `flex flex-col gap-N` prefixes). One scripted replace of `border border-border bg-surface` → `bg-surface shadow-card` across `src/**/*.tsx`, then **read the diff**: the 17 `divide-y divide-border rounded border border-border` lists keep their border (rule 4), and any match inside a table or a `<fieldset>` is reverted by hand. `shadow-card` is a Tailwind `boxShadow` token reading `--shadow-card`; in dark mode the same utility adds the hairline via `[data-theme='dark'] .shadow-card { box-shadow: inset 0 0 0 1px rgb(var(--foreground) / .07) }` — one rule, no second class.
- **Tokens.** Paste the sport block from `docs/design/tokens.css` into `globals.css` under the existing light/dark blocks; name the file in a comment so the next person knows where the values came from.
- **Snapshots.** `phone-app.spec.ts` and the page-shell snapshots will all change; regenerate in one commit titled as such, and look at the diff images for the dark-mode cards and the app's buttons (ink on blue) before accepting.
- **Most likely to be got wrong:** the sed catching a bordered element that is not a card (a `<fieldset>`, a table wrapper, a dropzone) and leaving it floating with no edge. Second: Poppins on every `font-semibold` instead of on headings only — the heading font is set by element, not by weight.

### QA — scenarios

1. **Given** any backoffice page in light, **then** cards are borderless with the soft shadow, headings Poppins, body Montserrat, 4 px corners, 2 px controls.
2. **Given** the same page in dark, **then** cards carry the hairline and remain separable from the background.
3. **Given** a list card (students, staff), **then** row hairlines remain.
4. **Given** the app in light, **then** Quicksand throughout and the primary button reads ink on blue (AA ≥ 4.5:1, checked).
5. **Given** a club with `enabled_sports = {pool}`, **then** no wash anywhere (snapshot).
6. **Given** a page with a dropzone or a fieldset, **then** its edge is still visible.
7. Every snapshot diff read; the backoffice renders with no layout shift (same element positions ±1 px on the dashboard, a student record, the calendar).

### Acceptance criteria

- [ ] Fonts loaded through `next/font`, headings vs body vs app as the handoff says; no runtime font request.
- [ ] `--radius` 4 px, `--radius-control` 2 px, chips 6 px; controls use the control radius.
- [ ] Outer cards: shadow, no border in light; hairline in dark; lists and tables keep their rules.
- [ ] App light primary-foreground is ink; contrast checked.
- [ ] Sport tokens, scopes and `.sport-shell` present and inert for a single-sport club.
- [ ] Snapshots regenerated in their own commit and reviewed; both themes, desktop and both phone projects.
