# POOLSE-96 · Nadadores-salvadores: the week as a grid, dates in words

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** UX · **Area:** Safety / Lifeguard roster · **Priority:** Medium · **Depends on** [POOLSE-70](./POOLSE-70-incident-log-and-duty-roster.md) (roster, gaps, licensing; unchanged)

### PO — why this exists

Rui, 22-10-2026:

- *"Week roster should be displayed as grid, remember I want the user to scroll as little as possible."*
- *"The week days and month should be 'por extenso' for better readability (ex: from 16th of November 2026 to 22nd November 2026)."*

Today `facilities/lifeguards/page.tsx` renders the week as a vertical list: one `<li>` per day, with its duties, gaps and an *AddDuty* form under each day. That makes seven stacked blocks per pool, and the dates read `16-11-2026`.

**Not in scope:** the roster rules themselves (gaps, unlicensed warnings, periods), and printing.

### BA — rules

1. **The grid:** days as **columns** (seg … dom), the pool's opening hours as **rows** (hourly bands, or the facility's slot grid if it's shorter). Each duty is a block spanning its hours, showing the name, plus ⚠ if unlicensed.
   - A **gap** (open hours with nobody on duty) is a hatched, warning-coloured block with text: *"Sem nadador-salvador 14:00–15:00"*.
   - A closed day is a greyed column marked *Fechado*.
   - Today's column is highlighted.
2. **Adding a duty:** click an empty cell or gap to open the existing *AddDuty* form in a popover, pre-filled with that day and hour. Remove it from under every day. A *+ Turno* button in the header covers the keyboard path.
3. **Removing a duty:** from the block's popover (the existing *RemoveDuty*).
4. **Several pools:** one grid per pool, stacked, or a pool selector if the site has more than two.
5. **Dates in words**, in the week heading and in day headers:
   - pt-PT: *"16 a 22 de novembro de 2026"*. If the month or year differs: *"30 de novembro a 6 de dezembro de 2026"*.
   - en: *"16–22 November 2026"*; *"30 November – 6 December 2026"*.
   - Day headers: *"seg., 16 nov."* / *"Mon 16 Nov"*.
6. **Phone:** the grid scrolls sideways inside its card, with the hour column pinned. On a narrow phone, it falls back to one day at a time with ‹ › (the POOLSE-88 pattern used for Turmas).

### Dev notes

- Add a `formatDateLong` and a `formatDateRange(from, to, locale)` helper to `lib/date-format.ts` using `Intl.DateTimeFormat#formatRange`, which collapses the shared month and year correctly in both locales. Don't build the string by concatenation (CONVENTIONS i18n).
  - The project's standard is `dd-mm-yyyy` (`formatDate`). This is a deliberate exception for headings. Note it in `decisions.md` so it doesn't spread unasked.
- The grid layout can borrow from `calendar-grid.tsx` (positioning by minutes), but read-only plus click-to-add. No drag needed.
- No API change: duties, gaps and opening hours are already on the page.

### QA — scenarios

1. **Given** a week with duties, **then** they appear as blocks in a 7-column grid, and the page needs no vertical scrolling on a 1080p screen for a single pool.
2. **Given** an uncovered hour, **then** it shows as a gap block with the text.
3. **When** I click an empty cell, **then** *AddDuty* opens with that day and hour. Saving puts a block there.
4. **Given** the week 16–22 Nov 2026, **then** the heading reads *16 a 22 de novembro de 2026* in pt-PT and *16–22 November 2026* in en.
5. **Given** a week across months or years, **then** both endpoints carry the month (and the year if different).
6. On a phone: one day at a time, with the hour column visible.

### Acceptance criteria

1. The week is a grid. Adding and removing work from it, and gaps and licence warnings are kept.
2. Dates in headings are written out via `Intl` in both languages.
3. Light and dark, contrast check, phone spec updated.

### Open questions

1. Row granularity: hourly, or 30 min? Recommended: hourly, with blocks positioned to the minute.
