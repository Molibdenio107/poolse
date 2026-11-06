# Interface

The full text of the conventions for any screen: look, forms, dialogs, navigation, the phone, the app shell, the dashboard. `CLAUDE.md` holds one line each; read this file before changing that area.

**The dashboard is a union of role bands, and a widget is one declaration in a registry.**
POOLSE-66. `BANDS` in `dashboard/widget-registry.ts` is the order — management, operational,
personal — and it is **one array constant**; a band the reader holds no role in is *absent*,
not empty. Ordering between roles is `MEMBER_ROLES`, which already existed: the ticket's
numeric ranks are not written down a second time, and seniority orders, never permits.
**`widgetsFor` applies `roles` before any resolver runs**, so a widget the reader may not see
is absent from the payload — asserted on the raw JSON, because a blank-but-present widget
passes a shape assertion and fails the promise. `kinds` is spelled as `app-sidebar.tsx` spells
it, so a personal tenant needs no second architecture. **A resolver answers `null` for "nothing
here" (→ `empty`) and throws for "that went wrong" (→ `error`)**; resolvers run in parallel with
a 2s ceiling each and one failure costs one card, never the page — and the error card carries
no message, because a resolver's text names columns. **Every allowed widget is resolved, then
escalated, then capped at four per band**: "boost this when the water is out of range" is a
predicate on resolved data, and a cap decided in advance would cut the thing that was about to
become urgent. A `trailing` widget is one line after the cap, never cut and never ranked above the pool;
none is trailing since the subscription left the dashboard (28-10-2026). **A club with no sites gets the onboarding checklist and nothing else; a club
with sites never gets it** — one branch, both directions. **Aggregates are one grouped query
each, never a loop over facilities**, and `assertRegistryIsSound` refuses the five registry
mistakes that would otherwise render nothing at all rather than fail. **On the web a band is a
heading and a grid, and a card is `WidgetCard` plus one case in `widgets.tsx`** — adding a
widget is a registry declaration and that case, never a new fetch or a client-side role check.
**The `empty` sentence is the widget's own and the `error` sentence is the card's**: "ainda não
há faturas" and "nada em atraso" are different facts, while a failure can only honestly say it
did not load — the resolver's words name columns and go to the log, and the error card is muted
rather than danger, because it is not a refusal. **Every card links to its page in all three
states.** A panel that predates the registry is a card no role check governs, which is what
`mgmt.energy.costs` was before slice 2a; `me.pool` is the one left, carrying a comment naming the
widget that replaces it. **The instructor band (slice 3) is `scope: 'self'` on
`class_session.resolved_instructor_id`** — the stand-in sees the class, the regular instructor does
not — and the next class holds on to one whose register is still owed; a card that copies a plan
sends the session id and never the text. **The maintenance band (slice 4) reads
`ResolverContext.ownFacilityIds`** — every site the reader works at, before the selector narrows
it — so an operational card never follows the management control; the selector is `SELECTOR_ROLES`.
Maintenance may record one water analysis and nothing else on a pool. **Slice 2b's aggregates are one statement each whatever the number of
sites** (`management.repository.ts`, proved by `countStatements` in the test harness), the
selector is remembered on `membership.dashboard_facility_id`, and **the cap ranks a card with
something to say before an empty one**. **The summary band (multi-sport Slice 2) is first in `BANDS` and laid out, not ranked (`FIXED_BANDS`)**: `sum.insights` (an `InsightSource`, `NO_INSIGHTS` until the AI exists, drawing nothing when empty), `sum.today` (the *Hoje* card's own `readOccupancyToday`, extended), `sum.collected` (fee payments this month, pass sales out) and `sum.recintos` (`readPoolWater` judged by `excursions`). **Above it since POOLSE-169 is the `notes` band**: `staff.notes`, the staff board — any working role pins a post-it (`staff_note`, never edited, taken down by its author or the office), drawn only when a note is pinned so it is the first thing read, and written apart from it through `NewNoteButton` (`components/staff-board-forms.tsx`) in the page header's `actions`; `StaffBoard` in `components/staff-notes.tsx`, papers and ink from `.post-it` / `--note-*`. **The weather (`ops.weather`, POOLSE-170) is the same band's right-hand column** — board 65 %, weather 35 %, laid out in `bands.tsx`. **A registry widget may be `absentWhenEmpty`** (null drops it from the payload rather than drawing an empty card), and a card that is its own subject (the weather) passes `href={null}` to `WidgetCard`. The forecast is `weatherAt` (`weather/forecast-cache.ts`), never a second fetch. `docs/features/dashboard.md`.

**A save says so, and it says so once.** `useSavedAction` raises the toast — one place, every
form — so no screen has to remember to report an outcome and none of them can word it
differently. Where "Guardado" is the wrong word, an action returns `toastKey` (and `values`) — a
restore says "Restaurado: Piscina 1" through the same hook. Field errors still render beside their field, because a message at the top of the
page cannot say which of a dozen boxes it meant; the top-of-form banner and the inline
"Guardado" are the toast's job now. `components/ui/toast.tsx`: muted tones on the surface
colour, an icon per tone so colour never carries the meaning alone, 4s for a success and 8s
for a refusal, and `w-auto` up to `max-w-md` so the box hugs its words. A saturated fill was
offered and declined twice — these appear dozens of times an afternoon. **The calendar's move
refusals go here too**, rather than into a bar above a grid that is taller than the window.

**A section that opens and closes moves smoothly** (Rui, 28-10-2026). A native `<details>` is animated by `DetailsAnimator` (`components/details-animator.tsx`, mounted once per root layout; `data-instant` opts one out), because the CSS route moved only in Chromium; a hand-built toggle is `<Reveal open={…}>`, and both share `REVEAL_MS` / `REVEAL_EASING` (650 ms, eased at both ends — Rui, 29-10-2026; `--reveal-ms` in globals.css turns the summary chevrons in step) (`components/ui/reveal.tsx`) instead of `{open && …}` — closed still means unmounted, and a table edit row takes `<Reveal open appear>` inside its `<td>`. Its grid is `minmax(0,1fr)` with a `min-w-0` item, so a wide table inside scrolls in its own box instead of widening the page (sweep 31-10-2026). **A warning icon that needs attention carries `attention`** (globals.css): three gentle pulses as it appears, then still, and none under reduced motion. **A warning dot is `.attention-dot`, everywhere** (Rui, 28-10-2026, after first choosing three pulses). It is a 6 px ball in the primary colour that blinks gently for as long as it is there: one breath every 2.4 s, still and half-strong under reduced motion, never a number. Don't style a dot by hand.

**Something slow says so in the corner, and the signal comes from where the work starts.** POOLSE-98. `lib/busy.ts` is the store (`beginBusy`/`endBusy`, `useBusyWhile`, `trackBusy`) and `BusyIndicator` in the `(app)` layout is the one corner: past 400 ms, at least 300 ms. `useSavedAction` and `FromLink` (through `LinkBusy`) already report, so a new form or link needs nothing; **a save or a navigation also washes the page against a second click (POOLSE-159): each activity carries a scope, `read | write | navigate`, and only the last two wash**, so a new reporter that saves or navigates says so; a plain `Link` under `(app)` carries `<LinkBusy />`, a file the app serves is a `DownloadLink`, and a bar stuck to the bottom of the screen carries `data-bottom-bar`. `docs/features/loading.md`.

**The look is tokens, from the design handoff** (POOLSE-138, `docs/features/look.md`). **A state is a `Badge` (`ui/badge.tsx`, tones ok / pending / late / danger / muted), a sport is a `SportChip` (only where `isMultiSport`), recent lessons are an `AttendanceStrip`, an empty list is `PageEmpty` with an icon and its actions** (Slice 5, 01-11-2026; the page's or the tab's whole list, with a short title and the rest in `hint`, while a sub-list under a card's own heading keeps one muted sentence); a new screen uses these rather than a hand-made pill. Poppins headings by element, Montserrat body, Quicksand in app mode, all from `lib/fonts.ts` on `<body>`. A card is `rounded bg-surface shadow-card` — no border; dark mode draws its hairline from `.dark .shadow-card` — and a list, table wrapper, fieldset or drop zone keeps its border. A control is `rounded-sm` (2 px), a card `rounded` (4 px), a lesson block `rounded-chip` (6 px). Sport washes exist and stay off until a page sets `data-sport`. **The frame is the handoff's (POOLSE-139):** a full-width top bar that is the club's (its logo and name, a link to its Painel) above the sidebar, with Poolse's `LogoMark` and name at the sidebar's foot (Rui, 31-10-2026), hairlines (`shadow-hairline-b` / `-r`) instead of borders, 38 px sidebar rows, 30 px page titles; a secondary button is `bg-surface shadow-card` with no border, a primary one 600. Control height and text size are unchanged.

**Every button and every form control is one size: `h-control` (36px) and `text-control` (15px).** Rui's call, 11 October 2026 — inputs, selects, tab pills and every button, row actions included, `inline-flex h-control items-center justify-center px-4 text-control`; colour and border vary, size does not. Field labels stay `text-sm`. The only exceptions are icon-only buttons (a close X, the calendar block's ⋯), which are small squares because they sit inside tight spaces. A new button that invents `px-2 py-1 text-xs` is the drift this rule was written to undo.

**On a phone the same tokens take a second value, and the shell clears the notch.** POOLSE-88 slice 1. `h-control` / `text-control` read `--control-h` / `--control-text` (globals.css): 36px / 15px under a mouse, 44px / 16px under `@media (pointer: coarse)`, and a coarse-pointer floor keeps every text field at 16px so iOS never zooms on focus. **Coarse pointer is for sizing only; layout follows width (`md:`)**, because a touch laptop is wide. Insets are `--safe-top/right/bottom/left` (from `env(safe-area-inset-*)`, with `viewport-fit=cover`), read by the app bar (`h-app-bar` includes the notch, `pt-safe-top`), the content (`pb-safe-bottom`), dialogs and toasts — never `env()` in a component. **`dvh`, never `vh`**: iOS's moving toolbar makes `100vh` taller than the screen. Below `md` the sidebar is `MobileMenu`, a `Dialog` with `placement="start"` drawing the same `SidebarNav`, and a page's title and primary action stick under the app bar. Installable through `app/manifest.ts`, `public/icons/` and `appleWebApp` in the app root layout; no service worker. The `iphone` (WebKit) and `android` (Chromium) Playwright projects run `e2e/phone-*.spec.ts` against the sessions `auth.setup.ts` saves: the owner, and an instructor (`INSTRUCTOR_SESSION`). **A control that sits in one place on a desk and another on a phone is rendered once and moved by CSS** — `contents` below `md` plus `order-last` and `sticky bottom-0`, as the register's Save bar does — never rendered twice with one copy hidden. A bottom bar adds `var(--safe-bottom)` to its own padding. A control whose words may wrap on a phone takes `min-h-control` rather than `h-control`. A target that is not a control (a back link, a card's link) takes `coarse:-my-3 coarse:py-3`, so it is 44 px to a finger and moves nothing. **A lesson's page is the lesson on a phone** (POOLSE-88 slice 2): the register plus `SessionActions`, which mounts the calendar's own plan sheet, stand-in picker and cancel dialog, never copies of them. Cancel shows from the register read's `canCancel` (the cancel endpoint's own test), and `CancelSessionDialog`'s `management` decides the scope question and *Anular*. **Every screen has a phone tier** (`docs/features/navigation.md`, *Telemóvel*). Tier 1 is the poolside screens, which must be good one-handed; tier 2 must work plainly; tier 3 is the desk, readable only. A new tier-1 or tier-2 screen earns a line in `phone-poolside.spec.ts` or `phone-tier2.spec.ts`. A column beside a photo takes `basis-64`, so on a phone it wraps under the photo instead of shrinking to an unreadable strip. **A desk-shaped screen gets a phone view, never a squeezed desk view** (Rui, 21-10-2026). The calendar is `CalendarAgenda` below `md` and the grid from `md`. `WeekGrid` is one column below `md`. A wide table takes `.table-stack` plus a `data-label` per cell, and turns into cards below `md` with no second render. A row that scrolls sideways (`data-scroll-row`, a tab list) is wrapped in `ScrollArrows` (`components/scroll-arrows.tsx`): no scrollbar, a ‹ / › and a fade only on the side with more, desk and phone (Rui, 01-11-2026); it scrolls to its current item through `ScrollRows`, mounted once in the app layout (sweep 31-10-2026). **Every sub-menu is one look** (Rui, 01-11-2026): a record's tabs, `SectionPills`, a view, year or scope switch — `subMenuPillClass(current)` and `SUB_MENU_ROW` in `components/section-pills.tsx` (the tabs carry the same classes by `data-state`), the card's fill and lift with the current one in `bg-primary`, 6 px apart; never a border-and-tint variant of its own. A header control that must survive on a phone (Em dívida's select-all, POOLSE-104) un-clips its own `thead` cell with `max-md:!…` utilities and hides the column titles. Each phone view is proved both ways in `phone-views.spec.ts`, desk width included. **App mode is the second front door** (POOLSE-90). `/app` routes by role through `lib/app-hats.ts`, the one definition of who lands where. Owner and admin go to the backoffice; a family goes to `/app/familia`, and a family-only reader never lands on `/dashboard`. Its shell is `(app)/app/layout.tsx` and, since POOLSE-136, `app-frame.tsx`: a home's tab screens (`TABS` / `tabFor` in `app-hats.ts`) get a bottom tab bar below `md` and the same tabs as a row from `md`, a header with only the club's name, and the phone type scale (`data-shell="tabs"`); *Perfil* (`/app/perfil`, the diamond tab) reads first, with *Editar dados* opening `ProfileForm` in a sheet, then one row to *Definições* (`/app/perfil/definicoes`: language, theme, push, the club's email), then the switcher, *Abrir o backoffice* and *Terminar sessão*, and the header's corner is the club's logo or initials, not a link (POOLSE-176, Rui 05-11-2026, reversing the photo of 31-10-2026); a screen deeper in has no bar. The maintenance home wears the same shell since POOLSE-181 (*Hoje*, *Registar*, *Perfil*): the frame has two shapes, tabs and detail, and `isHat()` is what `?home=` is checked against. **The register on a phone is `compact` when opened from `?from=/app…`** (POOLSE-180): one name and one control per row, because the page lives under `/dashboard`, outside the app frame, and there is no `data-surface` to read. A new tab is a line in `TABS`; an app-mode dialog takes `placement="sheet"` (a bottom sheet below `md`). The mobile palette is `--app-*` tokens, mapped onto `--primary` and its kin under `data-surface="app"`. A new app-mode screen is tier 1 and earns a line in `phone-app.spec.ts`. `docs/features/app.md`. `docs/features/navigation.md`.

**Form fields are controlled, never `defaultValue`.** React 19 resets a form as soon
as a function `action` returns — *including when it returns a validation error*. An
uncontrolled input therefore wipes what somebody just typed at the exact moment they are
being asked to correct it, and an uncontrolled `<select>` reverts to its mount-time value
after a save that worked. Both shipped as separate-looking bugs (POOLSE-09, POOLSE-10) from
one cause. Use `TextField` / `SelectField` / `TextAreaField` from
`apps/web/src/components/ui/field.tsx`; they are controlled, re-seed only when the server's
value actually changes, and carry their own label, hint and field-level error. **A hand-built control (a price row, an inventory line) takes `useSeeded` from the same file** instead of `defaultValue`, and a create form that stays on screen passes `useSuccessKey(state)` so its fields clear after a save that worked and never after one that failed. `pnpm forms:check` refuses `defaultValue` and `defaultChecked` anywhere but `field.tsx` — the form-debt sweep of 15 October 2026 took the count from 62 to 0. **Controlled is not enough for a checkbox, a radio or a select**: React 19's reset after an action (a refusal included) puts them back to their value at mount without a redraw, so a refused save showed a box unticked and a named select *submitted* its first option next time. `FormResetGuard` (`components/form-reset-guard.tsx`, mounted once in the app and public root layouts) copies their current values into their defaults on the `reset` event; a new root layout with forms mounts it too. **A form says what is wrong** (Rui, 01-11-2026): a required field shows a `*`, an invalid one its own sentence under it (`common.validation.*`, from `ui/field.tsx`, else `FormValidation` for a hand-built control), and one toast names the fields by label; an action that refuses a value returns `fields` as well as `errorKey`, so the sentence lands under the field. `docs/features/forms.md`.

**A circle means something needs doing, and it clears when it is done** (POOLSE-120). `GET /attention` is the one read: `readAttention` is cached per request and shared by the layout and the page. It counts only for roles that can act, in modules that are on, and reuses the existing verdicts. A new kind of circle is a branch in `attention.repository.ts` plus a `badge` key or an `AttentionDot`, never a second definition. `studentsToReview` (POOLSE-190) is the office's: Alunos counts students, each sport's copy its own, and the dot sits beside the name without touching the list's order.

**The menu's entries live in `lib/nav-entries.ts`** (POOLSE-118). The sidebar, the phone's menu and the Ctrl+K palette all read it through one filter, so a new page is one entry there. An entry that belongs to each sport takes `perSport`: `true` moves it into each sport's group (Turmas, Calendário, Níveis, Avanços, Competição), and `'copy'` keeps it shared and adds a filtered copy (Alunos, Pedidos, POOLSE-143; the shared Pedidos sits under Receção, POOLSE-165, via `unlessModule` on the Alunos child) — a `'copy'` child of a shared section too, placed under the sport's places entry (Piscinas, Campos, Salas) in each sport's group (Nadadores-salvadores under Instalações, POOLSE-156; Rui 04-11-2026). `sports` limits it to some sports (Competição is `COMPETITION_SPORTS`), and `badgePerSport` splits its circle. A list's `?sport=` is `readSportFilter` (`students/sport-filter.ts`): a sport the club has on, or `none`, else a 400; it is never a permission until POOLSE-145. `groupBySport` gives it one copy per sport, inside that sport's group with `?sport=` (POOLSE-125) — **a pool-only business club included since POOLSE-150**, so swimming has its own *Natação* tab whatever the number of sports. **A recinto lives in its sport's section** (`/dashboard/recintos?sport=`, named per sport by `keyBySport`: Piscinas, Campos, Salas), listed first in its group while the tab still opens Calendário; the site page and Instalações' sport cards only link there; an entry's `also` claims addresses outside its path (a tank's page is *Natação → Piscinas*). The handoff's sections sit on top of those groups (POOLSE-141): the club's own tab (its logo and name) and a tab per sport, left in the top bar, the underline sliding at the click, the sidebar listing only the current section (`sectionOf`, derived from the address), and a sport's pages washed (`SportShell`). A palette action is one line in `ACTIONS` (`lib/commands.ts`), and its synonyms sit beside it, never in the catalogue.

**A document on paper is a route with print styles, and the one PDF library is for a club's forms on the phone** (POOLSE-54, -115, -193). The exception is `lib/form-pdf.ts` (`pdf-lib`): a print page gives a phone no file, and Chave Móvel Digital signs a PDF. It takes the same inputs as `BoletimSheet` (`boletimValue` through `lib/form-values.ts`, and the placements), so the two cannot disagree on what a form says. Everything else on paper: black on white, `@page` for A4 and its margin footer, `PrintButton` and `AutoPrint` from `components/`, its own components rather than the screen's with a print patch, and an entry in `check-layout.mjs`. A print page with options opens the dialog only on `?print=1`, so changing an option does not reopen it.

**A decision asks first** (Rui, 04-11-2026: "to not let the user do or undo things without asking first"). Approving, refusing, archiving, removing, restoring, reverting, revoking, cancelling, ending, marking paid or unpaid, granting or removing a role, an import's final commit, a bulk generation and an /admin switch each open a question before they run: `ConfirmButton` (`components/confirm-action.tsx`) drops in for an existing submit button or `onClick` (it submits its own form, `name`/`value` included, or calls `onConfirm`), and `ConfirmAction` is a trigger with its own form. The title names the thing, one sentence says what happens and whether the bin brings it back (only if the kind is in `RESTORABLE`), and `tone="danger"` marks what takes something away. Left one-tap on purpose: routine poolside logging (check-in/out, *Limpo*, a task done, app mode's one-tap, skill marks, *Vou / Não vou*), a typed form's save, selects that save on change, and the toast's *Anular*, which is the undo itself. A new decision button uses one of the two.

**A question asked in the middle of the page uses `components/ui/dialog.tsx`.** It portals
to the body, so no ancestor's `overflow`, `transform` or `z-index` can clip it; it closes on
Escape and on the backdrop, moves focus in and gives it back, and keeps Tab inside itself.
Never render a confirmation in place of its own trigger — round 5's did, which put a form
inside a calendar cell one seventh of a column wide. Never `window.confirm` either: two
confirmations in two visual languages make an operator wonder whether they are being asked
the same thing. `initialFocus` starts it on the primary answer where Enter should accept (a
dropped file's "read it"); the calendar's move-scope chooser is the one exception, a popover
anchored to the block it asks about. Dialogs stack: one opened from inside another owns Escape and Tab until it closes (02-11-2026).

**A refusal that needs numbers carries them as structure, never as prose.** A rule enforced
by a trigger raises with a machine-readable `DETAIL` (`pool_capacity|40|32|12`); the API
turns that into a 409 with the figures as fields, and `FormState.values` carries them to
`t(key, values)`. Do not re-derive the numbers in TypeScript to build the sentence — two
implementations of one sum agree until the day they do not. See `pool_capacity_respected`
and `poolCapacityRefusal`.

**Light and dark mode in every app**, from the first component. Colors come from tokens;
no literal hex in components. **The `dark` class on `<html>` has one owner** (POOLSE-99): the pre-paint `ThemeScript` on a load and `applyTheme` on a choice — never a root layout's `className`, which a stale render puts back. The header's theme control is a three-option menu (`theme-toggle.tsx`), and `setThemeAction` always revalidates. `docs/features/preferences.md`.

**Palette.** Backoffice and desktop web: primary `rgb(103, 166, 182)`, complementary
`rgb(179, 212, 157)`. Mobile apps run sportier — soft orange with pool blue. Mobile
palette is explicitly allowed to move during development; the desktop one is not. **Text reads an ink, fills read the token** (Rui, 15 October 2026; the light primary ink is `14 116 144` since 31-10-2026, because the first one read as body grey): `--primary-ink`, `--success-ink`, `--warning-ink` and `--danger-ink` are each fill's own hue darkened past 4.6:1 on white, and `theme.extend.textColor` maps `text-primary` and friends to them, so links and warnings are AA while every button, chip and border keeps the settled fill. **Text on the primary fill is the dark foreground ink** (`--primary-foreground`, 6.6:1; Rui, 28-10-2026), in both themes — white on it was 2.7:1. A new status colour gets its ink in the same change. **Chart series are Poolse's** (02-11-2026): `--chart-1/2/3` are the brand teal, the app's soft orange and the brand green, deepened to 3:1 — a chart never picks its own colours, and keeps its legend and table.

**Voltar goes back to where you came from, and every in-app link is a `FromLink`.** POOLSE-91 (Rui, 22-10-2026). `components/from-link.tsx` stamps the current path and query as `?from=` on a link to another page, and carries the page's own `from` on a link to itself (a tab, a page, a filter). A record or form page sets `back` with `backProp(backTarget(from, parent), t)`; a page the sidebar opens uses `originBack(from)` and has **no** Voltar when opened from the menu. A new destination earns a label in `LABELS` / `RECORDS` in `lib/back.ts`. A plain `Link` is left only where the link *is* a way back or a menu entry (`BackLink`, the sidebar, a wizard's closing button). `docs/features/navigation.md`.

**A record's page uses `DetailPage`; one card is one tab, and the first is General.** The tab
is `?tab=<slug>`; each tab's `content` is a function and only the active one is called, so a
tab nobody opens costs nothing — except a list whose null-on-refusal decides whether its tab
exists, which runs with the page. Hide a tab with `visible` from an existing `can*` flag or
refusal, never a new role list. Cards keep their own saves; `DetailTabs` notices typing in a
posting form and asks before it is lost. `docs/features/navigation.md`.

**A page or tab that stacks independent sections shows one at a time, behind `SectionPills`.**
Rui's standing call, 12 October 2026: the reader scrolls as little as possible. The pill row is
`components/section-pills.tsx` (`?section=`, a link per section, `pickSection` to fall back,
`sectionHref` to keep the other query params and drop `page`). A section the reader may not see
is not offered. One flow (a summary above the list it sums, a document, a form) stays whole, and
so does an overview meant to be read at a glance: the dashboard bands and the calendar are
deliberately not split. A page that already has a view switch (Faturação's `ViewTabs`) extends
it rather than adding a second row. **The pill row sticks under the page's header** (POOLSE-92): `StickyUnderHeader` measures whichever `PageShell` block is sticky (`data-page-sticky`) and parks beneath it, and below `md` the row is one scrolling line. A new sticky header block in `PageShell` carries `data-page-sticky` too.

**One content width, and the calendar is the single exception.** `PageShell` caps every page
at `max-w-page`; `width="wide"` exists for a screen whose content is a grid rather than prose,
and the calendar and Alunos (a table, POOLSE-164) are its only callers. Another caller is a decision to take out
loud, not a tidy-up — if a third appears, ask what those pages have in common instead of
widening them one at a time.

**A fetch that answers `null` for both "not yet" and "it failed" produces a control that is
disabled with no explanation.** Keep `loaded` as its own state, and say what went wrong with a
way to retry. `stand-in-picker.tsx` is the shape. **On a server page, a best-effort load returns `Outcome<T>`**
(`outcome()` in `lib/load-failure.ts`): `refused` (a 403) hides a tab, `failed` keeps it and shows
`PageError`, and a detail page 404s only on a refusal or a real 404 — never `.catch(() => null)`
driving `visible:`, which is how a 500 made an owner's tab vanish.

**A side sheet fits the window; the one growable thing inside it takes the slack.** Make the
panel a flex column and give the text box `flex-1 min-h-0` rather than a fixed `min-h-`. The
`min-h-0` is the half that is easy to miss — a flex item will not shrink below its content
without it, and the sheet scrolls anyway. A fixed floor pushes the buttons below the fold on a
laptop, which is how a Save nobody can see gets reported as a save that does not work.

**Eight level tints, measured in both themes, and always shown at full strength somewhere.** `--level-1…8` plus `--level-none` in
`globals.css`. **A level and a turma are two sets since POOLSE-168** (Rui, 04-11-2026): levels read `--level-*`, drawn from Poolse's palette (teal, green, sea green, sand, orange, coral, lilac, ocean blue — closest solids ΔE2000 19, washes 4.8); a turma's own colour reads `--class-*`, the eight levels used to share. The stored names are the same eight; `ColourSwatches` takes `set`, `classColourVar(colour, set)` and `levelTint` return which set, and the calendar's chip is `lesson-tint-level-N` / `lesson-tint-class-N`. A new reader of a stored colour says which set it means. Washed at 15% the eight hues sit ΔE 4.5 apart — about one just-noticeable
difference — so a wash alone does no work; solid they are ΔE 26.7 apart. **Since POOLSE-139
(Rui, 31-10-2026, reversing solid fills) a calendar block is the handoff's chip** — the tint at
16% over the card with ink text (`.lesson-chip` + `lesson-tint-N`, from `chipClass()`), and
the tint at full strength as a 3 px left bar, so levels side by side still differ. Legend
swatches stay solid (`tintClass`). A partnership's block keeps its own colour and `inkFor` text.
The dark set is solved against the dark card rather than being the light set at another opacity.
**`--person-1…6` is the same idea for the vacation team map** and was six hex literals until
23-09-2026, three of them carrying white text below AA — a hex literal in a component is the one
thing `contrast:check` cannot see, because it reads the tokens. **A new fill earns a line in that
script's `PAIRS`** in the same change; the finding there was never the three colours, it was that
nothing was looking.

**A page that fails unexpectedly lands in `dashboard/error.tsx`**, which keeps the sidebar and says so in the reader's language with *Tentar de novo*. It is the net, not the answer: a page that expects a failure still renders `PageError` itself.

**The family app is soft on a phone** (POOLSE-173): under a finger and below `md`, `body:has([data-surface='app'])` retunes `--radius`, `--radius-control`, `--radius-hero` and `--radius-sheet`, so a component restyles nothing by hand; a laptop and the backoffice stay sharp. The tab bar's shapes never change. Decoration is a pseudo-element with no text under its edge, and one colour block is `.app-hero`. `docs/features/app.md`.
