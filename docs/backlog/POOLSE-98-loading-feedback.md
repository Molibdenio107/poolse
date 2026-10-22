# POOLSE-98 · Something is happening: subtle loading feedback, bottom right

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** UX / Global · **Area:** Global / Layout · **Priority:** Medium · **Depends on** —

### PO — why this exists

Rui, 22-10-2026: *"if some pages take longer to perform actions/logic, we can add a subtle 'loading' feedback on the bottom right corner. This can be for all types of things."*

**What exists today:**
- There is **no `loading.tsx`** anywhere under `app/`. A slow server page shows the old page, frozen, until the new one arrives.
- About 90 forms use `useSavedAction`, which exposes `pending`. Some buttons use it, but nothing global does.
- Navigation, server actions and file exports all happen without any shared signal.

So on a slow request, the person gets no sign the click registered and clicks again.

**Not in scope:**
- Skeleton screens per page. Maybe later, for the two or three slowest pages.
- Making the slow things faster. That's a separate profiling task, but this ticket should *log* which ones are slow (see Dev notes).

### BA — rules

1. **One indicator, bottom-right**, fixed and small: a spinner with a short label (*A carregar…* / *A guardar…* / *A exportar…*). It never blocks the page and never covers a toast. Toasts sit above it, or it moves up.
2. **Shown only when it's slow:** it appears after **400 ms** (no flicker on fast actions) and stays at least 300 ms once shown.
3. **What triggers it:**
   - page navigations, including `?tab=` and `?section=` switches that refetch on the server;
   - server actions and form submits (`useSavedAction` pending);
   - downloads and exports started from the app;
   - long client fetches.
4. **On a phone** it sits above the bottom navigation and safe area.
5. **Accessibility:** an `aria-live="polite"` region announces the label once. It respects `prefers-reduced-motion` (no spin, a pulsing dot instead).
6. **The submit button itself** still shows its own pending state where it already does. The corner indicator adds to it.

### Dev notes

- One client `<ActivityIndicator/>` in the `(app)` layout, plus a tiny store, `useActivity()` with `begin(label)` and `end(id)`, so several concurrent things count correctly.
- **Navigation:** the App Router has no route-change events. Hook `useTransition` via a wrapped `Link` / `router.push`, or add `loading.tsx` at the `(app)/dashboard` level that renders the existing page plus the indicator. Evaluate both; recommended: a top-level `loading.tsx` for navigations plus the store for actions.
- **Actions:** call `begin`/`end` inside `useSavedAction`, so all ~90 forms get it in one change.
- **Exports:** links like the salaries export become `fetch`-and-download, or set a short-lived cookie the route clears, so the end is known.
- **Measure:** in development, log any activity over 1.5 s with its label and route, as the list of candidates to speed up.

### QA — scenarios

1. **Given** a throttled network (Slow 3G), **when** I switch tabs on a site's configuration page, **then** the corner indicator appears and goes away when the tab renders.
2. **Given** a fast action under 400 ms, **then** no indicator flashes.
3. **Given** I save a form on a slow network, **then** the indicator says *A guardar…*, and the toast appears above it when done.
4. **Given** an export, **then** the indicator shows until the file starts downloading.
5. **Given** reduced motion, **then** there is no spinning.
6. Phone: the indicator clears the bottom nav and the home indicator.

### Acceptance criteria

1. One global indicator, delayed 400 ms, covering navigation, actions and exports.
2. `useSavedAction` feeds it, with no per-form changes.
3. Both languages, light and dark, reduced motion, phone layout.

### Open questions

1. Is a corner spinner enough, or do you also want a thin progress bar at the top for page navigations (the usual pattern)? Recommended: corner only, as you asked, to keep it subtle.
