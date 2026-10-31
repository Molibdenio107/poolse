# POOLSE-139 · The backoffice wears the handoff's frame: a full-width top bar, the handoff's sidebar, a larger page title, buttons and the calendar's look — for a pool-only club

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Global / Design · **Priority:** High (pre go-live) · **Depends on** [POOLSE-138](./POOLSE-138-design-tokens-from-the-handoff.md) (548242d) · **Spec** `docs/design/README.md` *Backoffice top bar*, *Backoffice sidebar*, *Backoffice shell*, *Calendário (spec section 03)*; `docs/design/designs/PoolseBackoffice.dc.html`, `PoolseTopBar.dc.html`, `PoolseSidebar.dc.html` · **Unblocks** [POOLSE-136](./POOLSE-136-the-app-phone-shell.md) (built after this, Rui 31-10-2026), [POOLSE-125](./POOLSE-125-navigation-per-sport.md)'s sport tabs (they sit in this top bar)

### PO — why this exists

> "you may go, but i havent seen any significant changes on the desing,, only some borders and font family, is there a slice missing?" — Rui, 31-10-2026

There was. POOLSE-138 landed the handoff's *ingredients* — fonts, radii, borderless cards — and said "layouts wait", pointing the shell at POOLSE-125. But 125 only adds sport groups to the menu, and a pool-only club sees nothing from it. So the parts of the handoff a person actually notices — the frame around every page and the calendar — had no ticket. Rui chose (31-10-2026) to build this before POOLSE-136, because it is what the pilot club sees all day.

**The pilot is single-sport**, and the handoff is explicit that a single-sport club gets "no wash, no sport labels, no top tabs". So this ticket builds the frame as a pool-only club sees it, and leaves the slot where 125's sport tabs will go.

**Not in scope:**
- Sport tabs in the top bar, the *Instalação* tab, the per-section sidebar, washes, `data-sport` — POOLSE-125/127, when a second sport is on.
- Material Symbols Sharp. The frame keeps Lucide icons at the handoff's sizes (19 px).
- New calendar views. The handoff's *Dia / Semana / Mês* segmented control is not built: the calendar has one view (the week, the agenda on a phone) and this ticket does not add two. The *Hoje* stepper and pool selector take the toolbar's look.
- The app (`/app`) — POOLSE-136, then its own design pass.
- Page layouts below the header. A page's own content is unchanged.

### BA — rules

1. **A full-width top bar.** 56 px (`h-app-bar`, safe area included), card background, a bottom hairline `0 1px 0 rgb(var(--foreground) / .07)` instead of a border, padding 0 18 px. It spans the whole window above the sidebar and the content (the handoff's shell grid: top row 56 px, then 240 px sidebar + content). Left: a 26 px logo square (radius 2, primary fill, the letter in ink) + "Poolse" (Poppins 600 15 px) + the club's name (11 px muted) beneath or beside it. Right, in order: the search / Ctrl K palette, the language and theme controls, the attention signal and the avatar, each a 36 px target. Middle: empty for a pool-only club; it is the slot POOLSE-125's tabs take.
2. **The sidebar as the handoff draws it.** 240 px, card background, padding 16 px 10 px, a right hairline (the same `.07`) instead of a border, starting under the top bar (the logo moves out of it). A row is 38 px, radius 2 (`rounded-sm`), 13 px text with a 19 px icon; the active row is the muted fill with 600 weight. Sub-entries, attention dots and `perSport` grouping keep working exactly as now (POOLSE-118, 120, 125).
3. **The page header.** The page title (`PageShell`'s `<h1>`) is Poppins 600 30 px on a desk (`md:`), 22 px on a phone; the subtitle 13 px muted. *Voltar* stays where it is (POOLSE-91) — the handoff's breadcrumb is sport / page, and a single-sport club has no sport to show, so there is no breadcrumb.
4. **Buttons.** Primary: `--primary` fill, `--primary-foreground` ink, **600**. Secondary: card fill + `shadow-card`, no border, ink text; in dark the hairline from `.dark .shadow-card`. Height and text size stay `h-control` / `text-control` (36 px / 15 px, Rui 11-10-2026, and 44/16 under a finger) — the handoff's 13 px is **not** taken, because the control size is a settled rule and 13 px under a finger is the iOS zoom trap POOLSE-88 closed. A destructive button keeps its danger fill.
5. **The calendar's toolbar.** The week stepper (‹ *Hoje* ›) is one control group: muted track, the buttons on it as secondary buttons; the pool selector beside it. The *Importar horário* action is a secondary button, a primary action (if any) primary. Above the grid: no bordered card around the toolbar; the grid's own wrapper keeps its border (it is a table).
6. **The calendar's lesson block.** Radius 6 (`rounded-chip`, from 138), an 8 px dot in the turma's tint, title 600 13 px, time / coach / capacity 12 px. **Decided (Rui, 31-10-2026): the default below.** The block's fill. The handoff draws the card colour with the turma tint at .16 over it and ink text; CLAUDE.md's settled rule (POOLSE-55's *Eight level tints, solid*) says washed tints at 15 % sit ΔE 4.5 apart and "the colour is doing no work", and chose solid fills with white text. **Default: the handoff's wash, with the colour carried by a solid 3 px left bar plus the solid dot**, so two levels side by side still differ at full strength — that keeps the rule's reason (colour that does work) while taking the look. This **reverses** POOLSE-55's solid-fill decision if taken, and `contrast:check` gains the ink-on-wash pairs.
7. **Hour lines** on the grid are `rgb(var(--foreground) / .08)`; the time column is 64 px; day / lane headers sit on the card colour.
8. **Phone tier unchanged in shape.** Below `md` the shell keeps POOLSE-88's app bar and `MobileMenu` (the sidebar drawn in a dialog): the bar takes rule 1's look (card bg, hairline, logo square) and the menu rule 2's rows. Coarse-pointer sizes (44 px) still win over the 38 px row.
9. **Both themes, every page, nothing moved below the header.** Light and dark from tokens; no hex in a component.

### Dev notes

- **Shell** is `(app)/dashboard/layout.tsx` (the `<header>` with `h-app-bar`, today to the right of the sidebar) and `(app)/app-sidebar.tsx` (the `<aside>` with `md:w-60`, which holds the logo today). The change is a grid: header first and full width (`col-span-2`), then aside + main. The aside's `md:top-0 md:h-dvh` sticky becomes `md:top-app-bar md:h-[calc(100dvh-theme(spacing.app-bar))]` or the equivalent; `PageShell`'s sticky blocks already measure the bar (`StickyUnderHeader`, `data-page-sticky`) — verify they still park under it.
- **Hairlines, not borders**: a utility pair `shadow-hairline-b` / `shadow-hairline-r` (`0 1px 0` / `1px 0 0` of `rgb(var(--foreground) / .07)`) in `tailwind.config.ts` beside `shadow-card`, so the bar and the aside do not invent a border colour.
- **Logo square** is a small component (`components/logo-mark.tsx`): 26 px, `rounded-sm`, `bg-primary`, a "P" in `text-primary-foreground` Poppins 600. Used by the bar and the phone menu.
- **Sidebar rows** are one class string in `app-sidebar.tsx` (`SidebarNav`, shared with `MobileMenu`), so rule 2 is one edit there plus the active-state branch. Keep `LinkBusy` and the attention dots.
- **Buttons**: the secondary class strings are many (138's sweep left them bordered on purpose). Collect them into `components/ui/button-classes.ts` (`PRIMARY`, `SECONDARY`, `DANGER`) **only where a file already defines its own `BUTTON`/`SECONDARY` constant** — about a dozen files — and replace `border border-border bg-surface` on `h-control` strings with `bg-surface shadow-card` by the same line-bounded script 138 used, dry run first, reading every element it lands on. A secondary button inside a `bg-surface-muted` panel still needs an edge: check those by eye.
- **Calendar**: the block is the string at `calendar-grid.tsx` ~l.1876 and `tintClass()`; the phone agenda's card is `calendar-agenda.tsx` ~l.174. If rule 6's default is taken, add `--level-n` washed backgrounds as `bg-level-n/15` over `bg-surface` and a `border-l-[3px] border-level-n`, and add each `foreground on level-n wash` pair to `scripts/check-contrast.mjs` `PAIRS`.
- **Most likely to be got wrong:** the sticky offsets. Moving the header above the sidebar changes what "top" means for the aside, `PageShell`'s sticky title, `SectionPills`, the register's Save bar and the calendar's day headers. Second: the phone app bar losing the notch padding (`pt-safe-top`) when its classes are rewritten.

### QA

1. **Given** a pool-only club on a desk in light, **then** the top bar spans the window with the logo square, *Poolse* and the club name on the left and search, language, theme and avatar on the right; nothing in the middle; the sidebar starts below it.
2. **Given** the same in dark, **then** the bar and the sidebar are separated from the content by the hairline, visible on the dark ground.
3. **Given** the sidebar, **then** rows are 38 px with 19 px icons, the active row muted and 600; sub-entries and attention dots render as before.
4. **Given** a page with a sticky title and section pills (a student record), **when** it scrolls, **then** the title and pills park directly under the top bar with no gap and no overlap.
5. **Given** the calendar, **then** the stepper is one grouped control, *Importar horário* is a secondary button with a shadow and no border, and the blocks have 6 px corners, a dot and the chosen fill (rule 6).
6. **Given** two adjacent turmas of different levels on the calendar, **then** their colours are told apart at a glance in both themes (the rule-6 bar and dot), and text on each block passes 4.5:1 (`contrast:check`).
7. **Given** a phone (`iphone`, `android`), **then** the app bar has the logo square, the notch is clear, and the menu's rows are the handoff's rows at 44 px.
8. **Given** a primary and a secondary button, **then** both are 36 px on a desk and 44 px under a finger, text 15 / 16 px.
9. **Given** an instructor (a role with a short menu), **then** the frame is the same and only the entries differ — the menu is still filtered by role server-side (nothing here changes a permission).
10. Before/after screenshots of the dashboard, a student record, the calendar, Faturação and a site page, light and dark, desk and phone (there is no snapshot suite; the 138 sweep's script is reused), read and compared; `phone-shell.spec.ts` and `phone-views.spec.ts` green.

### Acceptance criteria

- [ ] Full-width top bar with the logo square, the club name and the right-hand controls; sidebar below it with the handoff's rows; hairlines, not borders.
- [ ] Page titles 30 px on a desk, 22 px on a phone; *Voltar* unchanged; no breadcrumb for a single-sport club.
- [ ] Secondary buttons are card + shadow; primary 600; control height and text size unchanged.
- [ ] Calendar toolbar grouped; lesson blocks with 6 px corners, a dot and rule 6's fill, contrast-checked.
- [ ] Sticky title, section pills and Save bars park under the new bar on desk and phone.
- [ ] Phone shell keeps the notch and 44 px targets; light and dark; screenshot sweep read; phone specs green.
- [ ] `CLAUDE.md` gains a line on the frame; if rule 6's default is taken, the *Eight level tints, solid* paragraph is rewritten and `docs/decisions.md` records the reversal.
