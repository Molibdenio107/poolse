# POOLSE-15 · Turma hover card with full student list

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Improvement · **Area:** Classes (Turmas) · **Priority:** Medium
**Depends on:** POOLSE-08 (names in the card, collapsed after 8)

### PO — why this exists

The compact turma card can only show so much before it stops being compact, so POOLSE-08 collapses the roster after eight names. Staff planning a week need the rest without leaving the view they are in — hovering a turma should show the whole thing. Medium priority: it makes an existing screen materially faster to work with, and it is where the truncated content from POOLSE-08 goes to live.

**Not in scope:** editing anything from the hover card, a mobile hover equivalent (touch opens the detail instead), and the compact card's own layout, which POOLSE-08 owns.

### BA — rules and data

- Hovering a turma card or a calendar block opens a floating panel after roughly 300 ms, with no flicker when the cursor merely passes over (AC1).
- Panel contents: turma name, level, instructor, day/time, pool/lane, occupancy (e.g. 9/12), and the complete bulleted student list with no truncation (AC2).
- The student list reflects enrolments for the currently selected season (inherited from POOLSE-08 AC5) and is ordered alphabetically — display follows POOLSE-32, first name plus last surname in this list context.
- The panel scrolls internally when the list exceeds its maximum height; it never grows past the viewport and is never clipped by a parent container (AC3) — this rules out rendering it inside an `overflow: hidden` ancestor.
- It flips side or above near a viewport edge (AC4), dismisses on mouse-out or `Esc`, and stays open while the cursor is inside it so names can be read and selected (AC5).
- Keyboard focus on the turma opens the same panel (AC6) — accessibility parity, not a lesser variant.
- Touch devices have no hover: a tap opens the turma detail and the panel is not used at all (AC7).
- Content is fetched once and cached per turma (AC8); moving the cursor must not fire a request per pixel.
- Access rule: the panel shows the same data the user is permitted to see. A role that may not see the roster does not get one through a hover — the endpoint enforces it.
- Edge case: a turma with a guest attending as a reposição (POOLSE-21) is counted for attendance but excluded from the enrolled list, so the panel's list and its occupancy figure can legitimately disagree by the number of guests. **Open:** whether the panel should show guests separately once POOLSE-21 lands — not decided.
- Edge case: an empty turma. The panel still opens and shows the POOLSE-08 empty state rather than an empty box.

### Dev — implementation notes

- Build on the shadcn/ui hover-card primitive rather than a bespoke floating element — it brings the open delay, dismissal and focus parity, and a positioning engine that already handles edge flipping.
- Render the panel in a portal at the document root so no ancestor's overflow can clip it (AC3).
- One API call per turma returning the panel payload; cache by turma id with a sensible stale time so repeated hovers in a session are free. The open delay must also debounce the fetch — start the request when the delay elapses, not on mouse-enter.
- Reuse the roster query the card already uses where possible, so the panel and the card cannot disagree about who is enrolled; the panel simply asks for the untruncated list.
- Permission check is server-side on that endpoint; the panel is not a back door to a roster the user cannot open normally.
- Touch detection by pointer capability, not by viewport width — a small window on a laptop still hovers, a large tablet does not (AC7).
- i18n: field labels, the occupancy format and the empty state in pt-PT and en; occupancy renders through the locale's number formatting.
- Theming: the panel needs its own elevated surface token with a border that reads against both light and dark backgrounds — a shadow alone disappears in dark mode.
- Most likely to get wrong: a fetch on every mouse-move or every re-render, which is invisible locally and obvious on a calendar with forty turmas. AC8 is the guard; test it by counting requests, not by feel.

### QA — test scenarios

15.1 Given a turma card with 20 enrolled students / When the cursor rests on it for ~300 ms / Then the panel opens showing all 20 names plus name, level, instructor, day/time, pool/lane and occupancy.
15.2 Given the cursor passes quickly across three turma cards / When it does not rest on any / Then no panel opens and no request is fired.
15.3 Given a panel is open / When the cursor moves into the panel / Then it stays open and the names can be selected with the mouse.
15.4 Given a panel is open / When `Esc` is pressed or the cursor leaves both card and panel / Then it dismisses.
15.5 Given a turma at the right edge of the viewport / When its panel opens / Then it flips to the other side and is fully visible; repeat near the bottom edge.
15.6 Given a turma inside a scrollable container with hidden overflow / When the panel opens / Then it is not clipped by the container.
15.7 Given a turma with 60 students / When the panel opens / Then the list scrolls inside the panel and the panel does not exceed the viewport height.
15.8 Given keyboard navigation / When the turma receives focus / Then the same panel opens and its contents are reachable by screen reader.
15.9 Given a touch device / When a turma is tapped / Then the turma detail opens and no hover panel appears.
15.10 Given the same turma is hovered five times in a session / When network requests are counted / Then only one panel fetch occurred.
15.11 Given an Instructor with no access to another instructor's turma roster / When they trigger the panel via the API endpoint directly / Then 403 and no roster data is returned.
15.12 Given locale pt-PT then en / When the panel opens / Then labels, occupancy and the empty state render in the active language.
15.13 Given dark mode then light mode / When the panel opens over a busy calendar / Then its surface and border are clearly separated from the content behind it.
15.14 Given a turma with no enrolments / When the panel opens / Then it shows "Sem alunos inscritos" / "No students enrolled" rather than an empty area.

### Acceptance criteria

1. Hovering a turma (card or calendar block) opens a floating panel after a short delay (~300 ms) — no flicker on cursor pass-through.
2. Panel shows: turma name, level, instructor, day/time, pool/lane, occupancy (e.g. 9/12), and the **full** bulleted student list with no truncation.
3. Panel is scrollable if the list exceeds its max height; it never grows past the viewport or gets clipped by the container.
4. It flips side/above automatically near a viewport edge.
5. Dismisses on mouse-out or `Esc`; stays open while the cursor is inside it, so names can be read and selected.
6. Keyboard-focusing the turma opens the same panel (accessibility parity with hover).
7. On touch devices there is no hover — tap opens the turma detail instead; the panel is not used.
8. Content is fetched once and cached per turma; hovering does not fire a request per pixel of movement.
