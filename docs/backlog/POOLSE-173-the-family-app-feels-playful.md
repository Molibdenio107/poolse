# POOLSE-173 · The family app feels playful and kid-friendly — rounder cards, colour blocks, stickers for progress; the geometric tab bar stays as it is

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Mobile app / Design · **Priority:** Medium (pilot) · **Depends on** [POOLSE-136](./POOLSE-136-the-app-phone-shell.md), [POOLSE-138](./POOLSE-138-design-tokens-from-the-handoff.md), [POOLSE-140](./POOLSE-140-app-design-pass.md) · **Spec** `docs/design/README.md` *App: Início*, *App tab bar*; the student-app screens in `docs/design/designs/Poolse Visual Directions v2 Sharp.dc.html` (1d, 3a–3d) are the **starting point this ticket moves away from**, not the target

### PO — why this exists

Rui, 05-11-2026, looking at the app screens in the handoff next to the backoffice pages: *"The visual feel of the mobile app to the students should also be more playful, more kid friendly… but I want to keep the geometric forms for the menus."*

The app today wears the backoffice's sharp direction at phone size: 4 px cards, 2 px controls, mono numbers, muted greys. On a phone held by a nine-year-old — or by a parent showing it to one — that reads as a banking app. The backoffice is for staff and stays sharp; the family app is for children and their parents and may be soft, bold and a little fun. What must **not** change is the thing the family already recognises: the tab bar's four geometric shapes (square, circle or hexagon, triangle, diamond) and how they behave.

**Not in scope:**
- The backoffice, the public pages, the staff phone views (POOLSE-88) — none of them changes.
- New data. Stickers and stamps render what POOLSE-20 (skill states) and the attendance register already hold.
- Sound, confetti, gamified points or streaks. Playful is a visual register, not a reward system.
- Illustrations of characters or mascots. Shapes only.

### As built (05-11-2026) — wins over what follows

**Built:** the radii, the title and section-label type, bold buttons, the press, one soft circle on the *Início* hero, all under `[data-surface='app']` with a coarse pointer below `md`, on `body` so a portalled dialog reads them. The tab bar's shapes are untouched and only its container rounds. *Pagamentos* takes radii and type and nothing else.

**Not built, and why:**
- **`Selo` and `Stamp` (rules 8, 9): no screen to put them on.** No app-mode screen shows skills or attendance, and a family has no read of skills, which this ticket rules out ("No new API"). Unused components were not written. They are [POOLSE-185](./POOLSE-185-progresso-skills-as-stickers-attendance-as-stamps.md), after POOLSE-175 (Rui, 05-11-2026).
- **Material Symbols Rounded (rule 7): the app draws `lucide-react`,** which already has round caps. Moving means replacing every icon and loading a font, for little that a family would notice.
- **Greeting (rule 6) does not exist,** and rule 14 allows no new string, so the tab screens' title takes the 28 px.
- **34 px big numbers (rule 6):** the water and the fees are sentences, and splitting them needs new strings.
- **The design board (Open) was not drawn;** the rules are the spec, as the ticket allows.

**Applies to every app-mode home,** the instructor's and maintenance's too, as rule 1 says. The heading says family.

### BA — rules

1. **Scope is app mode on a phone.** Everything below applies under `[data-surface='app']` with a coarse pointer and below `md`. On a laptop the app keeps today's scale and radii; the backoffice reads none of these tokens.
2. **Rounder.** Cards 16 px, the hero card on *Início* 20 px, buttons and chips pill (`9999px`), inputs 12 px, bottom sheets top radius 20 px. Shadows stay the handoff's (`0 1px 3px rgb(0 0 0 / .08)`); no borders appear.
3. **No new hues.** Playfulness comes from shape, size and type, not from new colours. The app palette is still the handoff's: fill `#4FA3C7`, accent `#F5A25C`, ink `#1f3f48`, muted `90 112 120`, ground `243 247 247`, the lime wash `179 212 157` as a wash only. The four colour systems in CONVENTIONS.md and the sport washes (POOLSE-127) are untouched and stay distinct.
4. **Bigger colour blocks.** The *Início* hero ("Water right now" / next class) is a full-bleed block in the app fill with ink text; the sport screen's header is the sport's wash as now (POOLSE-127), never a solid sport colour. One block per screen at most; the rest of the screen is white cards on the tinted ground.
5. **Soft shapes as decoration, never as meaning.** Headers and the hero may carry one or two large circles at `app-fill / .12` (or `card / .18` on a fill) bleeding off the edge, and the hero's bottom edge may be a gentle wave. Decorative, `aria-hidden`, no text on top of a circle's edge, and never used to signal a state.
6. **Type.** Quicksand stays (POOLSE-138). Greeting 28 px 700 ("Boa tarde, Mariana"), big numbers (next fee, water temperature, "7/8") 34 px 700, buttons 16 px 700, section labels 13 px 700 sentence case (no longer uppercase). Body and secondary stay 17 / 15 px.
7. **Icons.** In app mode the icon font is Material Symbols **Rounded**, weight 400, `FILL 1`; the backoffice keeps Sharp 300 / `FILL 0`. The padel glyph stays the handoff's SVG, with rounded caps.
8. **Progress as stickers.** A skill (POOLSE-20's four states) renders as a round *selo*, 44 px: acquired = app fill with a `check` icon in ink; in progress = fill at `.22` with a dashed ink ring; not started = muted ground with a dotted ring; not applicable = hidden. The level ("L3") is one large badge, 64 px, in the lime wash with ink text. Every selo also carries its name beneath it — colour and ring never alone.
9. **Attendance as stamps.** The 30-day attendance strip becomes a row of 24 px round stamps: present = fill with `check`, absent = ground with a dotted ring, not yet marked = dashed ring; the mono count ("7/8") stays beside it.
10. **The tab bar does not change shape.** Square, circle (single-sport) or hexagon (multi-sport, POOLSE-127), triangle, diamond: same sizes, same active rule (app fill; hexagon active = ink), same labels, same hexagon logic and 3 px sport bar. The bar's container takes the card radius from rule 2 and nothing else. A snapshot of the bar before and after this ticket differs only in the container's corners.
11. **Payments stays calm.** *Pagamentos* is the parent's screen: it takes the radii, type and icons above and nothing else — no decorative shapes, no colour block beyond the "next payment" card as now, and the MB WAY button keeps the handoff's rule (real logo, no fill, 1 px `#cfe2e8` border).
12. **Motion, lightly.** Tap on a card or button scales to `.97` for 120 ms; a selo that becomes acquired pops once (scale 1 → 1.12 → 1, 240 ms). Both are off under `prefers-reduced-motion`. Nothing loops.
13. **Dark mode.** Every rule has its dark counterpart on the app dark palette (fill `56 189 248`, fill-fg `8 47 73`); decorative circles use `fill / .10`. Every text/ground pair is AA (4.5:1) and in `check-contrast.mjs` `PAIRS`.
14. **Copy stays as it is.** No new strings beyond section labels losing their uppercase; the friendlier register is visual. The guardian and the child see the same screens.

### Dev notes

- Tokens under `[data-surface='app']` + coarse pointer: `--app-radius-card: 16px`, `--app-radius-hero: 20px`, `--app-radius-control: 9999px`, `--app-radius-input: 12px`, `--app-radius-sheet: 20px`, pointed at by the generic `--radius-*` the components already read (the POOLSE-90 / 140 pattern), so nothing is restyled by hand. Default (laptop, backoffice) values unchanged.
- Icon font: a second `@font-face` for Material Symbols Rounded loaded only in app mode; `.ms` resolves to Rounded under `[data-surface='app']`. Check the bundle — load the subset the app uses, not the full family.
- `Selo` and `Stamp` are two small presentational components in `apps/web/src/components/app/`, each taking the state enum and a label; the skill list and the attendance strip map onto them. No new API.
- Decorative circles: pseudo-elements on `PhoneHero` and `SportHeader`, `overflow: hidden` on the parent, `pointer-events: none`.
- Most likely to be got wrong: (a) the tab bar picking up the pill radius on its tabs — only the container rounds; (b) a selo state read from colour alone in a test — assert on the icon and the label; (c) the Rounded font leaking into the backoffice when a staff member opens the app on the same device — scope is the attribute, not the viewport.
- Order: build after POOLSE-140 has landed so the screenshots are taken once on the tinted ground.

**Open:** a design board with the playful direction (two variants, Início + sport screen + Perfil, light and dark) in `docs/design/designs/` before build, so the rules above are seen rather than read — Rui to pick a variant; until it lands, the rules above are the spec.

### QA

1. **Given** app mode on a phone, **then** cards are 16 px, buttons pill, icons Rounded filled, greeting 28 px; **given** the same account on a laptop, **then** today's scale and radii.
2. **Given** the backoffice, **then** unchanged (screenshot sweep, light and dark).
3. **Given** the tab bar before and after, **then** the four shapes, sizes, labels and active colours are identical; only the container's corners differ. Hexagon logic (one sport opens directly, two or more open the sheet) unchanged.
4. **Given** a student with skills in all four states, **then** four distinct selos each with a name; a screen reader reads the state from the label, not the colour.
5. **Given** 30 days of attendance, **then** a row of stamps and the "x/y" count; present, absent and unmarked are told apart with the ring, not only the fill.
6. **Given** *Pagamentos*, **then** no decorative shapes; the MB WAY button as the handoff draws it.
7. **Given** `prefers-reduced-motion`, **then** no scale on tap and no pop.
8. **Given** dark mode, **then** every pair AA; `check-contrast.mjs` green.
9. `phone-app.spec.ts` green on both phones.

### Acceptance criteria

- [x] App-mode radius and type tokens from the rules, laptop and backoffice unchanged. ~~icon~~: see *As built*.
- [x] *Início* hero as a colour block with a decorative shape; *Perfil* follows; *Pagamentos* calm. No sport screen exists in app mode.
- [ ] `Selo` and `Stamp` components wired to skill states and attendance.
- [x] Tab bar shapes and behaviour unchanged; only the container's corners differ, asserted in `phone-app.spec.ts`.
- [ ] Light and dark AA; reduced motion respected; phone-app spec green.
