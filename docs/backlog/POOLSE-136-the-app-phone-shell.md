# POOLSE-136 · The app gets a phone shell of its own: bottom tabs, one task per screen, a phone type scale

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Mobile app · **Priority:** High (pre go-live) · **Depends on** [POOLSE-90](./POOLSE-90-the-app-agenda-per-role.md), [POOLSE-88](./POOLSE-88-staff-on-the-phone.md) · **Unblocks** the design pass on `/app`, a later Capacitor spike (APK from the same code) · **Related** [POOLSE-116](./POOLSE-116-lesson-feedback-from-the-family-app.md), [POOLSE-127](./POOLSE-127-student-app-sport-tabs.md)

### PO — why this exists

Rui, 30-10-2026, after a week using the app on his phone: *"the feel of the app itself on the phone, it feels very crowded and feels as same app on phone than what it is on the desktop … I feel like a native phone app could be better."*

He was about to ditch the PWA for a native build. What was wrong is not the runtime, it is the frame: app mode (POOLSE-90) has its own routes and its own palette, but it still wears the desktop's shape — a header, a row of switcher links, stacked bordered cards in one column, dialogs in the middle of the screen. A native app built from the same screens would feel exactly the same. So, decided 30-10-2026: **the PWA stands for the pilot** (as decided 29-10), and the app gets what makes a phone app feel like one — a bottom tab bar, one task per screen, a phone type scale, sheets from the bottom. Whether native follows is decided after the pilot, from how this feels on a phone, with the design applied. An APK, if wanted in hand, comes from a Capacitor wrapper of this same code, not from a second codebase.

**Scope by role (Rui, 30-10-2026):** families/students and instructors. Maintenance keeps today's shell and gets its own phone view after the pilot (to check manual labour and fixes) — a later ticket, not this one.

**Not in scope:**
- Any new data or endpoint. Every tab regroups what the home already loads; nothing new is fetched.
- The design mockup's palette, type and components — the next ticket, applied to `/app` first, once this shell is in. This ticket uses the current tokens.
- The maintenance home (`/app/manutencao`): unchanged, snapshot.
- Owner/Admin: no app mode, as decided 21-10. The backoffice and its phone tiers (POOLSE-88) are untouched.
- A native or Expo app, and the Capacitor spike itself (one evening, after the design pass, only if Rui still wants an APK).
- Pull-to-refresh and page transitions. Written down as the two things to try after, if the shell alone does not close the gap.

### BA — rules

1. **A bottom tab bar on phones.** Under a coarse pointer and below the `md` breakpoint, each home shows a fixed bar at the bottom, padded by `--safe-bottom`, with 3–4 destinations, icon + short label, the current one marked (`aria-current="page"`, fill and label weight — never colour alone). Each tab is a link to its own address, so it works before hydration and the back button behaves, like the switcher today.
2. **Family home tabs:** *Agenda* (`/app/familia` — coming lessons, *Vou / Não vou*, closures), *Aulas* (past lessons: *Últimas aulas*, feedback, certificates), *Pagamentos* (the read-only fee status the agenda shows today — moved here, not new), *Perfil*. A guardian with several children keeps child-first (POOLSE-90, POOLSE-127): the child is chosen at the top of *Agenda* and *Aulas*, and the choice is kept across tabs on the device.
3. **Instructor home tabs:** *Hoje* (`/app/aulas` — today's lessons, registers owed), *Semana* (the week's lessons), *Perfil*. **Open:** whether *Semana* exists as a view today or is a filter on the same list. Default: a filter on the same page with its own address (`/app/aulas?semana`), no new query.
4. ***Perfil* is where the chrome goes.** The theme and language controls, the user menu, *Abrir backoffice* (staff who are also parents), the push switch (POOLSE-90) and the switcher between a person's homes all move into *Perfil*. The header keeps only the club's name and the screen's title. A person with one home sees no switcher anywhere, as now.
5. **One task per screen.** On a phone, a screen is one list or one thing. Secondary content that today sits as extra cards on the agenda (water temperature, fee status, certificates) lives in its own tab or behind a tap, never stacked under the list. No tab strips inside a screen in app mode on a phone; the desktop's tabbed-card layout (Oct 2026 decision) does not apply to `/app`.
6. **Lists are rows, not cards.** In app mode on a phone, a list is edge-to-edge rows separated by hairlines, each at least 44 px high, with the primary text at the phone body size and the secondary line muted; a tap opens the item. Nested bordered cards inside the page are not used.
7. **A phone type scale** under `[data-surface='app']` with a coarse pointer: body 17 px, secondary 15 px, screen title 22 px semibold, section labels 13 px uppercase muted; vertical rhythm of 12/16/24. On a laptop the current scale stays.
8. **Dialogs are sheets.** In app mode on a phone, a dialog (confirm *Não vou*, report, cancel) opens as a bottom sheet with a grab handle, dismissed by the sheet's button or a swipe down; on a laptop it stays a centred dialog. Same component, one prop.
9. **A laptop keeps the same app.** At `md` and above, the same tabs render as a top segmented row under the header, centred at `max-w-2xl` as today; no bottom bar, nothing hidden.
10. **Nothing else changes.** Every route, action and permission is the one that exists; the backoffice renders byte-identical (snapshot); the maintenance home renders as today (snapshot).

### Dev notes

- **Shell.** `(app)/app/layout.tsx` becomes thin: header (club name + `<h1>` from the page) and a `<AppTabs hats=… />` region. Tabs per home are a static map in `lib/app-hats.ts` next to `HOME_PATH` (`TABS[hat]: { href, labelKey, icon }[]`), so `hatsOf` already answers which bar to draw. `AppSwitcher` stops rendering in the header and is re-used inside *Perfil*.
- **New routes, no new reads:** `/app/familia/aulas` (index: the *Últimas aulas* strip + certificates, both components exist), `/app/familia/pagamentos` (the fee-status block lifted out of the agenda), `/app/perfil` (one page shared by every hat: `PreferenceControls`, `UserMenu`'s items inline, `PushCard`, the switcher, *Abrir backoffice*). The agenda page loses the blocks that moved and keeps its data loader; if the loader fetched the fee status only for the agenda, split the call rather than fetch it twice.
- **Phone vs laptop** is `@media (pointer: coarse) and (max-width: md)` in CSS plus the existing `phone-app.spec.ts` projects; no `userAgent` sniffing. The bottom bar is `position: fixed; bottom: 0; padding-bottom: var(--safe-bottom)`, and `<main>` gets matching bottom padding so the last row is never under it (the FeedbackForm's Save bar already uses `pb-safe-bottom` — keep it above the tab bar, not behind it).
- **Type scale** as four CSS variables under `[data-surface='app']` in the coarse-pointer media block that already sets `--control-h: 2.75rem` (globals.css ~l.406), read by `text-body/text-secondary/text-title` utilities; no component sets a pixel size.
- **Sheet.** The existing dialog component gains `presentation="sheet" | "dialog"` with the default resolved from the same media query; one implementation, Radix `Dialog` positioned bottom with a handle and `pb-safe-bottom`. Focus trap and `Escape` unchanged.
- **i18n.** Tab labels (`app.tabs.familia.agenda|aulas|pagamentos|perfil`, `app.tabs.aulas.hoje|semana|perfil`) and the *Perfil* title in both files.
- **Tests.** `phone-app.spec.ts`: a line per home proving the bar, the current tab, and that the last row is tappable above the bar; snapshots for the backoffice and the maintenance home; both themes; `iphone` and `android`. The role probe is untouched — nothing new on the API — but re-run it, since routes moved.
- **Most likely to be got wrong:** hiding chrome instead of moving it. If *Abrir backoffice* or the push switch vanish for a parent-instructor because *Perfil* was built for families first, the person is locked in app mode. Second: the fixed bar covering the Save bar of forms that already pin to the bottom — stack them, test on the `iphone` project with the keyboard open.

### QA — scenarios

1. **Given** a guardian on a phone, **when** they open the app, **then** *Agenda* is current in a bottom bar of four, the header shows only the club and *Agenda*, and the agenda is a list of lesson rows.
2. **Given** the same guardian, **when** they tap *Pagamentos*, **then** the fee status they used to see on the agenda, and the agenda no longer shows it.
3. **Given** an instructor on a phone, **then** a bar of three with *Hoje* current; the register is one tap from a row.
4. **Given** an instructor who is also a parent, **when** they open *Perfil*, **then** the switcher offers *Família*, and *Abrir backoffice* is there; the header has neither.
5. **Given** a maintenance login, **then** the home renders as before (snapshot).
6. **Given** the owner, **then** `/dashboard` renders byte-identical (snapshot); `/app` still redirects as today.
7. **Given** a guardian on a laptop, **then** the same four destinations as a top row, no bottom bar.
8. **Given** the feedback form open with the keyboard up on the `iphone` project, **then** the Save bar sits above the tab bar and is tappable.
9. **Given** *Não vou* on a phone, **then** the confirm opens as a bottom sheet and swipe-down dismisses it; on a laptop, a centred dialog.
10. Light and dark, pt-PT and en; the current tab is distinguishable with colour removed.
11. Cross-tenant and role probes unchanged and green.

### Acceptance criteria

- [ ] Bottom tab bar per home (family 4, instructor 3) on phones; top row on laptops; maintenance and backoffice unchanged with snapshots.
- [ ] Header carries club name and screen title only; preferences, user menu, push, switcher and *Abrir backoffice* live in *Perfil* for every hat that had them.
- [ ] Agenda is a list of rows; fee status on *Pagamentos*; past lessons and certificates on *Aulas*; no nested cards or tab strips in app mode on a phone.
- [ ] Phone type scale as tokens under `[data-surface='app']`; dialogs render as bottom sheets on phones.
- [ ] No new endpoint, no new query; i18n in both files; phone spec lines; role probe green.
