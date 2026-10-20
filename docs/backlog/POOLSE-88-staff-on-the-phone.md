# POOLSE-88 · Staff on the phone: installable app, the poolside flows, iPhone and Android

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Global / Mobile web · **Priority:** High — blocks the pilot preview · **Depends on** POOLSE-87 (the pilot's module set) · **Brainstormed** 20-10-2026

### PO — why this exists

The pilot club will do most of the day-to-day work on phones (Rui, 20-10-2026): instructors at the
poolside with a phone in one hand, the front desk between families. Today Poolse is a desktop web
app. It has no web manifest, no home-screen icon, and almost no layout for narrow screens beyond
the sidebar.

So this ticket makes **the same web app** good on a phone and installable as a PWA, on **iPhone and
Android** alike. It does **not** build a second front end. The native or Expo app is the student and
family app in phase 3, and nothing here pre-empts that choice.

"Works on mobile" is made testable by splitting the product into three tiers, below. A tier-1
flow is not done until it passes on both platforms.

**Not in scope:**

- Offline register-taking or a sync queue.
- Web push. iOS allows it only for installed PWAs, and it belongs to roadmap 3.0.
- A native app.
- Making desk-tier screens touch-optimised.
- The student/family app.

### BA — rules

**Platforms (both are the contract):**

- **iPhone:** Safari and the installed home-screen app, on the current and previous major iOS
  version.
- **Android:** Chrome and the installed app, plus Samsung Internet, on current versions.
- **Widths:** 360 px (a small Android) up to 430 px (a large iPhone), portrait. Landscape must not
  break, but is not optimised.

**Tier 1: must be good one-handed at the poolside.**

1. My classes today and this week (the instructor dashboard band, *Turmas*).
2. **Taking the register** on the session page.
3. Reading and editing the training plan, including *copiar da aula anterior*.
4. Cancelling a lesson, and choosing a stand-in.
5. Finding a student: guardian's phone (tap to call), level, the seguro warning.
6. Recording an incident.
7. Entering a water reading.
8. Sending a message to a turma.
9. Marking a fee paid.

**Tier 2: must work on a phone, plainly.** Student and turma detail pages, enrolling one
student, closures, levels and skills, the dashboard's other bands, *O meu perfil*.

**Tier 3: desk.** A phone gets a readable page and nothing broken, not an optimised one. Covers
calendar drag and series moves, every importer, the price list and site configuration, `/admin`,
meet imports, and print views.

**Touch sizing** (Rui, 20-10-2026). On a coarse pointer (`@media (pointer: coarse)`):

- Controls are **44 px** tall (`h-control`).
- Control text is **16 px** (`text-control`). iOS Safari zooms the whole page when an input under
  16 px takes focus, which reads as the app jumping.

Desktop keeps 36 px and 15 px exactly as settled on 11-10-2026. It is the same token with a second
value, so no component changes its classes.

### Dev — where it goes

**Installable app:**

- A `manifest.webmanifest` with name, short name *Poolse*, `display: standalone`, `start_url`
  `/dashboard`, and theme and background colours from the tokens (light; dark through `media`).
- Icons at 192 and 512 px plus a maskable variant.
- `apple-touch-icon` (180 px) and the `appleWebApp` metadata in the root layout, because iOS reads
  those and not the manifest's icons.
- `viewport-fit=cover`, and `env(safe-area-inset-*)` padding on the app shell, so the notch and
  the home bar never cover a button.
- No service worker in this ticket. Chrome installs without one, and a caching worker is the
  offline work this ticket excludes.

**Layout:**

- **App shell.** Below `md`, the sidebar is a sheet behind a menu button, and the page title and
  primary action sit in a sticky top bar.
- **Lists to cards.** Students, the register and fee lines become a stacked card per row below
  `md` (one component per list, same data). A table that scrolls sideways on a phone is a defect.
- **The register is the priority screen.** One row per student, with a large present/absent toggle
  (44 px minimum), the count kept visible in a sticky footer, and Save in the thumb zone.
- **`DetailTabs` and `SectionPills`** keep their existing horizontal-scroll strip. Verify that the
  active tab scrolls into view.
- **Dialogs and side sheets** go full-screen below `sm`, and respect the safe area and the on-screen
  keyboard. Use `dvh`, never `vh`, because iOS's moving toolbar makes `100vh` taller than the
  screen.
- **Hover never carries anything.** The calendar's tap-to-pin already covers its cards. Check that
  every other hover card in a tier-1 or tier-2 flow has a tap path.
- **Inputs.** Phone numbers are `tel:` links. Use `inputmode="decimal"` for readings and money and
  `inputmode="numeric"` for a NIF, so the right keyboard opens. Dates stay `dd-MM-yyyy` through
  `formatDate`, and the native date picker is acceptable on touch.

**What will be got wrong:**

- `100vh` on iOS.
- An input at 15 px on a phone, so the page zooms.
- Fixed bottom buttons under the iPhone home bar.
- A tier-1 screen tested only in Chrome's responsive mode, which is neither Safari nor a real
  touch screen.
- A hover-only control.
- `pointer: coarse` used for layout. It is for **sizing** only. Layout follows width, because a
  touch laptop is wide.

**Testing:**

- **Playwright:** add `iphone` (`devices['iPhone 14']`, WebKit) and `android`
  (`devices['Pixel 7']`, Chromium) projects to `playwright.config.ts`. Add
  `e2e/poolside.spec.ts`, running tier-1 flows 1–4 and 9 as an instructor and as an admin.
- **Test users.** This needs the signed-in half of the e2e suite (`E2E_EMAIL` / `E2E_PASSWORD`)
  and an instructor test user on the dev Clerk instance.
- **Install WebKit for Playwright** on the dev machine. The current config runs Chromium only.
- **Real devices.** One pass on a real iPhone and one on a real Android before the pilot preview,
  recorded in the ticket. Emulation does not prove the keyboard, the safe area or installing.

### Build plan

1. **Shell and installability.** Manifest, icons, Apple metadata, safe areas, the coarse-pointer
   token values, the sheet sidebar and sticky top bar, the Playwright projects. QA 1–4.
2. **Tier 1.** The register first, then classes, plan, cancel/stand-in, student lookup, fee paid,
   incident, water reading, message. QA 5–9.
3. **Tier 2 sweep and real devices.** Fix what the sweep finds, do the iPhone and Android passes,
   and update `docs/features/navigation.md` with a *Telemóvel* section listing the tiers. Add one
   CLAUDE.md paragraph (the tier rule, coarse-pointer sizing, `dvh`, cards below `md`).

### QA — test scenarios

1. **Given** an iPhone in Safari, **when** *Adicionar ao ecrã principal*, **then** Poolse opens full-screen with its own icon and no browser bar. **Given** Android Chrome, **then** *Instalar app* is offered and does the same.
2. **Given** a coarse pointer, **then** every control is 44 px and 16 px. **Given** a mouse, **then** 36 px and 15 px, unchanged.
3. **Given** an iPhone, **when** focusing any text input on a tier-1 screen, **then** the page does not zoom.
4. **Given** an iPhone with a home bar, **then** no button sits under it and no content is hidden by the notch, in light and dark.
5. **Given** an instructor on a 360 px Android, **when** they take a register of 15 students, **then** every toggle is reachable without sideways scrolling, the count stays visible, and Save works one-handed.
6. **Given** a refused register save (e.g. a closed session), **then** the marks stay as they were and the refusal shows as a toast. It is never reset (the `FormResetGuard` rule, on touch).
7. **Given** a student card on a phone, **when** the guardian's phone is tapped, **then** the dialer opens.
8. **Given** entering a water reading or a fee amount, **then** a decimal keyboard opens. **Given** a NIF, **then** a numeric one.
9. **Given** the `iphone` and `android` Playwright projects, **then** `poolside.spec.ts` passes on both.
10. **Given** a tier-3 screen (the calendar) on a phone, **then** it renders readable and nothing overlaps or breaks. Optimising it is not required.

### Acceptance criteria

1. Poolse installs to the home screen on iPhone and Android and opens standalone, with icon, theme colour and safe areas correct in both themes.
2. Coarse-pointer sizing is 44 px / 16 px through the existing tokens; desktop is unchanged.
3. Every tier-1 flow passes on both Playwright phone projects and on one real iPhone and one real Android.
4. No tier-1 or tier-2 screen scrolls sideways at 360 px.
5. pt-PT and en; light and dark; contrast-checked; `docs/features/navigation.md` and CLAUDE.md updated.
