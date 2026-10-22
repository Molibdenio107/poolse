# POOLSE-107 · Calendar: the week written out, and today's column in view

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** UX · **Area:** Calendar · **Priority:** Low · **Depends on** [POOLSE-96](./POOLSE-96-lifeguard-week-as-a-grid.md) (`formatDateRange`, `formatDayMonth`)

### PO — why this exists

Rui, 22-10-2026: *"Calendar screen: the week days and month should be written out (ex: from 16th of November 2026 to 22nd November 2026)."* And: *"The calendar grid is incredible and working flawlessly, please don't break it, but if possible, when the current day is Thursday or Friday, try to centre the calendar on the current day, or highlight it. If it might break it, leave it as is."*

**Not in scope:** anything in `calendar-grid.tsx`'s dragging, conflict or layout logic.

### BA — rules

1. **The week heading** (`calendar.range`) uses `formatDateRange` from POOLSE-96: *16 a 22 de novembro de 2026* / *16–22 November 2026*. Day column headers use `formatDayMonth` plus the weekday: *seg., 16 de novembro*; shorter on a phone (*seg. 16 nov.*).
2. **Today in view, without moving the grid:**
   - On desktop the seven columns already fit, so nothing scrolls. Today's column (already marked, round 5) gets a **stronger header**: the day name in the primary colour with a small *Hoje* pill, and a faint tinted column background, both in addition to whatever marks it now. Colour never alone: the pill carries the word.
   - On a phone the calendar is already a day agenda (POOLSE-88) that opens on today, so nothing to do.
   - **No auto-scroll and no re-centring of columns.** Centring would change column order or widths, which is the risk Rui asked to avoid.

### Dev notes

- Heading and headers: `calendar/page.tsx` only. Grid untouched except a class on today's header cell and column, both already identifiable by `todayWeekday`.
- `check-contrast` on the tinted column in both themes.
- The existing calendar Playwright spec must pass unchanged; add one assertion for the *Hoje* pill.

### QA — scenarios

1. The week heading reads *16 a 22 de novembro de 2026* in pt-PT and *16–22 November 2026* in en; weeks across months and years carry both.
2. On the current week, today's column has the *Hoje* pill and tint; on other weeks, no column is marked.
3. Dragging a class, the conflict rules and the lane grid behave exactly as before (existing specs green).

### Acceptance criteria

1. Dates written out on heading and day headers.
2. Today visibly marked, with no change to grid behaviour.

### Open questions

- None.
