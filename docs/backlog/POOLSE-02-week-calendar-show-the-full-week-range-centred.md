# POOLSE-02 · Week calendar: show the full week range, centred

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Improvement · **Area:** Calendar · **Priority:** Medium

### PO — why this exists
In week view the header does not state which week is on screen, so staff scheduling a turma have to read the column dates to orient themselves, and screenshots sent to colleagues carry no date at all. Front-desk and instructors are the daily users of this view. Medium because it is cheap and constant friction rather than a blocker.
**Not in scope:** changing the first day of the week, day/month view headers, and the navigation controls themselves.

### BA — rules and data
- The header shows the full range of the displayed week, formatted from the active locale.
- pt-PT renders `24 de agosto de 2026 a 30 de agosto de 2026`; en renders `24 August 2026 to 30 August 2026`.
- The year is repeated on both ends even when both dates fall in the same year — AC1's example is the decided form.
- Cross-month (`31 de agosto de 2026 a 6 de setembro de 2026`) and cross-year (`28 de dezembro de 2026 a 3 de janeiro de 2027`) ranges render with each date fully qualified.
- Below a narrow breakpoint the header switches to the short month form (`24 ago 2026 a 30 ago 2026`) and truncates with an ellipsis; it never wraps to a second line, because the header height is fixed by the calendar grid.
- The text is centred against the header block, not against the space left between the prev/next controls, so unequal control widths do not shift it off centre.
- Purely presentational: no schema, no API and no permission surface.
- **Open:** is the week Monday-start for both pt-PT and en, or does the en locale start on Sunday? The rendered range depends on it and the source does not say.

### Dev — implementation notes
- Format via `Intl.DateTimeFormat` (or the date-fns locale) using the app locale; AC4 rules out concatenating day/month/year strings.
- The joining word (`a` / `to`) is an i18n key taking the two pre-formatted dates as parameters, so a locale can reorder or repunctuate the sentence.
- Build the header as a three-column grid (prev · title · next) with the title column centred, rather than a flex row with `justify-content: space-between` — the latter is where the off-centre bug comes from.
- Long/short month variants: prefer rendering both and toggling with a container query or Tailwind breakpoint over measuring in JS, which causes a layout flash on first paint.
- Derive the range from the calendar's local dates, not from a UTC instant — a Sunday 23:00 UTC boundary otherwise labels the wrong week for Lisbon in summer time. This is the thing most likely to be got wrong.
- No new colour token; confirm the existing muted-foreground token still passes contrast against the header surface in dark mode.

### QA — test scenarios
02.1 Given pt-PT and the week of 24 Aug 2026, When week view loads, Then the header reads `24 de agosto de 2026 a 30 de agosto de 2026`.
02.2 Given en and the same week, When week view loads, Then the header reads `24 August 2026 to 30 August 2026`.
02.3 Given any week, When the header is measured, Then its text is centred on the header block regardless of the widths of the prev/next controls.
02.4 Given the week of 31 Aug 2026, When week view loads, Then both months appear correctly across the boundary.
02.5 Given the week of 28 Dec 2026, When week view loads, Then both years appear correctly across the boundary.
02.6 Given a 360 px viewport, When week view loads, Then the short month form is used and the header stays on one line.
02.7 Given a 360 px viewport and a cross-month week, When week view loads, Then the text truncates with an ellipsis rather than wrapping.
02.8 Given the browser timezone set to Europe/Lisbon and the clock at Sunday 23:30 local during summer time, When week view loads, Then the header shows the week containing that local Sunday, not the next one.
02.9 Given dark mode in both locales, When week view loads, Then the header text passes contrast against the header surface.
02.10 Given the locale switched from pt-PT to en without a reload, When week view re-renders, Then the header re-formats to the en pattern.
02.11 Given the user navigates forward three weeks, When each week renders, Then the header updates to that week's range every time.
02.12 Given a locale-formatting failure (unsupported locale tag), When week view loads, Then it falls back to a valid formatted range rather than rendering `Invalid Date`.

### Acceptance criteria

1. Header reads e.g. `24 de agosto de 2026 a 30 de agosto de 2026` (pt-PT) / `24 August 2026 to 30 August 2026` (en).
2. Text is horizontally centred in the header block.
3. Cross-month and cross-year weeks render correctly (e.g. `31 de agosto de 2026 a 6 de setembro de 2026`).
4. Date formatting comes from the locale, not string concatenation.
5. Truncates gracefully on narrow/mobile widths (short month form) rather than wrapping into two lines.
