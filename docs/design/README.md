# Handoff: Poolse — Visual direction + Multi-sport

## Overview
Poolse is a pool/sports-club management SaaS: a desktop **backoffice** (admins, staff) and a mobile **PWA** (parents/students). This handoff covers:
1. The current visual direction (fonts, radii, palette, shadows).
2. Multi-sport support: one club with several recintos (Piscina, Ténis, Padel, Basquetebol, Futebol, Andebol, Voleibol, Ginásio). Each enabled sport gets its own backoffice section and app view, identified by a translucent background **wash** + name + icon.

## About the design files
The `.dc.html` files in `designs/` are **design references built in HTML** — they show intended look and behaviour; they are not production code. Recreate them in the Poolse codebase using its existing stack, components and patterns. Open any file directly in a browser (keep `support.js` next to them) to inspect it; the main spec board is `Poolse Multi-sport Tints.dc.html`.

## Fidelity
**High-fidelity.** Colours, type, radii, spacing and states are final. Calendar grid (section 03) is a styling reference only — apply its look to the real calendar component.

## Global visual rules
- **Fonts:** desktop headings Poppins 600, body Montserrat 400/500/600/700. Mobile: Quicksand 500/600/700 for everything. Icons: Material Symbols Sharp (weight 300, fill 0). Padel has a custom SVG (in `designs/PoolseTopBar.dc.html`), since Material has no padel glyph.
- **Radii:** cards 4px, controls (buttons, inputs, segmented) 2px, class/turma chips 6px. Mobile phone-level buttons 4px.
- **No card borders.** White cards on tinted background + `0 1px 3px rgb(0 0 0 / .08)`.
- **Buttons:** primary = `--primary` fill, `--primary-foreground` (dark ink) text, 600 13px Montserrat, padding 10px 16px. Secondary = card fill + card shadow.
- **MB WAY:** `assets/mbway-logo.png`, no background fill, 1px border `#cfe2e8`.
- **Strings:** pt-PT. Mobile-first at 380px, 16px gutters, hit targets ≥ 44px.

## Design tokens
See **`tokens.css`** (drop-in). Summary:
- Backoffice light: primary `103 166 182`, primary-fg `17 24 28`, primary-ink `70 113 124`, bg `250 251 252`, card `255`, muted `240 243 245`, fg `17 24 28`, muted-fg `90 103 112`.
- Backoffice dark: primary `126 186 201`, bg `13 18 21`, card `20 27 31`, muted `28 36 42`, fg `230 236 239`, muted-fg `148 162 172`.
- App light: primary `#4FA3C7`, accent `#F5A25C`, fg `#1f3f48`, muted-fg `90 112 120`, bg `243 247 247`, primary-fg `17 24 28`. App primary blue is never used as small text on white (fails AA) — use for fills/shapes, label in ink.
- App dark: primary `56 189 248`, primary-fg `8 47 73`.
- Green `179 212 157`: wash only, never text.
- Sport washes: 8 light + 8 dark RGB triples; alpha `.14` light / `.12` dark. All fg and muted-fg text passes AA ≥ 4.5:1 on every washed bg (verified in spec section 01).

## Multi-sport rules (the important part)
- The wash is **atmosphere only**: applied as `background-image` over `--background` on sport pages and sport app screens (`.sport-shell` in tokens.css).
- **Never** on buttons, text, as primary colour, or on shared pages. See spec section 06 "Não fazer".
- **Shared (neutral) pages:** Dashboard, Alunos, Staff, Mensalidades, Faturação, Energia, Configuração.
- **Per-sport pages:** Calendário, Turmas, Recintos, Métricas.
- Colour is never the only signal — always sport name + icon.
- Turma colour chips are unchanged; keep sport colours distinct from attendance states, role badges, age brackets, certification status.
- **Single-sport club:** no wash, no sport labels, no top tabs — pixel-identical to today. Implement as a feature flag driven by the number of enabled sports.

## Screens / components

### Backoffice top bar (`PoolseTopBar.dc.html`)
- 56px high, card bg, bottom hairline `0 1px 0 rgb(fg / .07)`, padding 0 18px.
- Left: 26px logo square (radius 2, primary) + "Poolse" (Poppins 600 15px) + club name (11px muted).
- Tabs: "Instalação" (icon `domain`), a 1px × 20px separator, then one tab per enabled sport (icon 19px + name). Tab: padding 0 12px, 13px; inactive 500 muted-fg; active 600 fg.
- Active indicator: 3px bar at bottom, full tab width. Instalação → `--primary`. Sport tab → `--sport-wash` solid + tab bg `rgb(sport-wash / wash-a)`.
- Right: search + notifications (36px targets), 30px avatar, name/role (hidden when > 4 sports).
- Single-sport: no tabs.

### Backoffice sidebar (`PoolseSidebar.dc.html`)
- 240px, card bg, padding 16px 10px, right hairline.
- Shows only the section selected in the top bar:
  - Instalação → Dashboard + shared pages.
  - Sport → header (44px, 4px left border `--sport-wash`, bg wash, Poppins 600 14px, icon + name) then Calendário (`calendar_month`), Turmas (`groups`), Recintos (`stadium`), Métricas (`monitoring`).
  - Single-sport → everything in one list.
- Row: 38px, radius 2, 13px, icon 19px; active = muted bg, 600 weight.

### Backoffice shell (`PoolseBackoffice.dc.html`)
Grid: top bar row 56px spanning; 240px sidebar + content. Clicking a top tab swaps sidebar and opens its first page; content area gets `data-sport` + `.sport-shell` when in a sport section.

### Calendário (spec section 03)
Breadcrumb (icon + sport / page), H1 Poppins 600 30px, subtitle 13px muted. Actions: "Exportar Excel" (secondary), "+ Nova aula" (primary). Toolbar: ‹ Hoje ›, Dia/Semana/Mês segmented (muted track, active = card), filter chip "Modalidade: Ténis ✕", recinto dropdown. Grid: 64px time column + one column per court; header row on card; hour lines `fg / .08`. Event chip: radius 6, card bg overlaid with turma colour at .16, 8px dot, title 600 13px, time/coach and capacity 12px muted.

### App tab bar (`PoolseTabBar.dc.html`)
Card bg, radius 4, card shadow. Each tab: flex 1, icon 24px box + 11px label, min 44px.
- Shapes: Início **square**, Aulas **circle** (single-sport only), Modalidades **hexagon** (multi-sport, replaces Aulas), Pagamentos **triangle**, Perfil **diamond**.
- Colours: active = app-primary (hexagon active = fg), inactive = muted-fg; active label 700 fg.
- Hexagon logic:
  - 1 enrolled sport → label = sport name, tap opens that sport directly.
  - 2+ → label "Modalidades", tap opens bottom sheet.
  - While a sport is open → label = sport name, sport glyph inside the hexagon (in card colour), 3px top bar in `--sport-wash`.

### App: Modalidades bottom sheet (spec section 05)
Scrim `rgb(0 0 0 / .42)`; sheet card bg, top radius 4, padding 10px 16px 30px, 40×4 grabber. Title "Modalidades" 20px 700 + count "2 inscritas". Rows ≥ 64px, inset 4px left bar in sport colour, icon 24px, name 16px 700, sub 12px muted ("Mariana e Tomás · próxima hoje 18:00"); selected row = wash bg + `check`. Tap row → close sheet, open sport, set wash. Tap scrim → close.

### App: Início (neutral) and sport screen (spec section 04)
- Início: greeting, child cards (avatar 44px, name 17px 700, "13 anos · 2 modalidades", 6px segmented strip with one solid segment per sport, sport labels with icons, "Próxima: …"), "Esta semana" list. No wash.
- Sport screen (e.g. Padel): whole screen `.sport-shell`. Header icon 28px + name 28px 700, child/turma subtitle. "Próxima aula" card (date 17px, time 34px 700, place, coach, "Confirmar presença" primary + "Não posso ir" muted, both ≥ 48px). Assiduidade card (7 blocks, filled = present, outlined = absent). Turma card with chip dot.

## State
- Backoffice: `section` ('facility' | sportId), `page` key; `enabledSports[]` from club config. `isMultiSport = enabledSports.length > 1`.
- App: `enrolledSports[]` (union across children), `activeTab`, `currentSport`, `sheetOpen`. Persist `currentSport` per user.
- Sport metadata (id, pt-PT name, icon): pool/Piscina (app label "Natação")/`pool`, tennis/Ténis/`sports_tennis`, padel/Padel/custom SVG, basketball/Basquetebol/`sports_basketball`, football/Futebol/`sports_soccer`, handball/Andebol/`sports_handball`, volleyball/Voleibol/`sports_volleyball`, gym/Ginásio/`fitness_center`.

## Assets
- `assets/mbway-logo.png` — real MB WAY logo.
- Padel icon — inline SVG in the design files (circle r6 at 14.5,9.5 + handle line + 3 dots, stroke 1.6).
- Fonts and icons from Google Fonts.

## Files
- `designs/Poolse Multi-sport Tints.dc.html` — full spec board (tokens, nav, calendar, app, tab bar, don'ts), light + dark.
- `designs/PoolseBackoffice.dc.html` — clickable backoffice shell.
- `designs/PoolseTopBar.dc.html`, `PoolseSidebar.dc.html`, `PoolseTabBar.dc.html` — components with their logic.
- `designs/Poolse Visual Directions v2 Sharp.dc.html` — base visual direction.
- `tokens.css` — CSS variables ready to use.
