# POOLSE-159 · While a save or a navigation is pending the page is washed and not clickable, so a second click cannot break the state

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Global / Loading · **Priority:** Medium (pilot) · **Depends on** [POOLSE-98] · **Unblocks** —

### PO — why this exists
Rui, 04-11-2026: "'General' on all Poolse, if the page is 'loading' on the bottom right corner, create a smooth screen (efeito marca de água maybe) preventing the user to click everywhere in order to not break the app."

Decided 04-11-2026 (Rui): the block applies only while a **save or a navigation** is pending, never to a plain read — blocking on every busy signal would freeze each list fetch and hover card.

**Not in scope:** changing the corner indicator; a spinner per control; cancelling a pending action.

### BA — rules
1. `lib/busy.ts` gains a *kind*: `read | write | navigate`. `useSavedAction` reports `write`; `FromLink`/`LinkBusy` report `navigate`; everything else stays `read`.
2. When any `write` or `navigate` is pending past 400 ms, a full-viewport overlay appears: a translucent wash of the surface colour (watermark-light, ~40 %), `pointer-events: auto` capturing clicks, no spinner of its own (the corner indicator stays), fading in over `REVEAL_MS` and out at once when the work ends.
3. The overlay never captures keyboard focus and is `aria-hidden`; Escape does nothing. A dialog that opened the action stays above the overlay.
4. Reads never raise it.
5. Reduced motion: the wash appears without the fade.

### Dev notes
- `components/busy-indicator.tsx` renders the overlay from the same store; one subscriber.
- z-index: below `Dialog`'s portal layer, above the app shell (`--z-overlay` token, new, in globals.css).
- Trap: the calendar's drag writes through `moveOccurrence` — the overlay must not appear *during* a drag; it is raised on the request, after the drop.

### QA
1. Given a form save that takes 1 s, when submitted, then after 400 ms the wash appears and a click on the sidebar does nothing; on completion it vanishes and the toast shows.
2. Given a list page fetching for 2 s, then no wash (corner indicator only).
3. Given a `FromLink` click with a 1 s navigation, then the wash appears and the destination renders without it.
4. Given a dialog whose action is pending, then the dialog is still readable above the wash.
5. Given `prefers-reduced-motion`, then no fade.
6. Both themes; the wash contrast leaves the page readable (watermark, not a blackout).

### Acceptance criteria
- [ ] Busy kinds; overlay only on write/navigate.
- [ ] Clicks captured, keyboard untouched, dialogs above.
- [ ] `docs/features/loading.md` updated.
