# POOLSE-49 · The lane grid

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Calendar / Scheduling · **Priority:** High

### PO — why this exists
The printed sheet is the artefact the club distributes and pins to the wall. It is dense on purpose:
fourteen slots down, five days across, six lanes inside each slot, and in every cell a group, an
instructor and a headcount. Poolse's current board draws one row per fifteen minutes and one cell per
day — which cannot show that Sandra is running Cadetes, Infantis and Absolutos simultaneously on
lanes 2, 3 and 4.

This ticket changes what the grid *is*: the drop target becomes `(day, slot, lane)`. It extends
`ScheduleBoard` rather than replacing it — the drag machinery, the closure locks, the keyboard
parity and the confirm dialog all already work and are not re-earned.

**Not in scope:** dragging (POOLSE-50), conflict feedback (POOLSE-51), export (POOLSE-54). This
ticket renders, filters and reads.

### BA — rules and data
- **Rows are slots; inside each slot, one row per lane** of the selected pool. Columns are weekdays
  2ª–6ª.
- The **weekend grid is its own block** beside or below the weekday one, because its slots are a
  different set (POOLSE-44). Decide adjacent-versus-stacked **from a real render at 1280px**, not in
  the abstract — the reference sheet puts it alongside, and if that does not fit, stacked with a
  heading is the fallback, not a toggle nobody finds.
- **Left rail: `Horário` and `Pista`, sticky on scroll.** Fourteen slots × six lanes is 84 rows; a
  grid whose row labels scroll away is unreadable by the third slot.
- Pool selector when the facility has several tanks, plus "todos os tanques", which stacks them with
  the pool named on each block.
- **Density toggle** — `compacta` (~18px rows, the reference sheet's density) and `confortável`
  (today's). Compact is what a planner uses; comfortable is what somebody checks one class in.
- **Empty lanes are visible by default**, with "esconder pistas vazias". A planner needs to see the
  hole; a reader does not.
- Each cell shows, in order: **group/level → instructor → headcount**. In compact density the
  headcount collapses to a badge. Colour comes from the booking's category, or the partner's colour
  where there is one — and never carries meaning alone: the group name is always text.
- A booking spanning lanes renders as **one block across those lane rows**, not three copies.
- **Filters:** pool, instructor, category, partner, level. **Legend** generated from the categories
  actually in view, not from every category that exists.
- The last density and filter choice persists per user. Browser storage is the right home — it is a
  per-viewer convenience, not shared state.
- A facility with no slot grid yet says so and links to the editor (POOLSE-44), rather than rendering
  84 empty rows.
- A booking whose time matches no slot renders in a **"fora da grelha"** block under the grid, named,
  with its time. The alternative is a class that has quietly disappeared from the screen.

### Dev — implementation notes
- Extend `apps/web/src/app/(app)/dashboard/classes/schedule-board.tsx`. What changes:
  - `rows` stops being `bounds.from … bounds.to` stepped by `STEP_MINUTES` and becomes the facility's
    slots for the day group being shown;
  - each slot renders `lanes.length` sub-rows;
  - the droppable id goes from `cell:${day}:${minutes}` to `cell:${day}:${slotId}:${laneId}`;
  - `Placed` gains `laneIds: string[]` and the chip's height comes from its lane span, not from
    `durationMinutes / STEP_MINUTES`.
- `STEP_MINUTES`, `GRID_EARLIEST`, `GRID_LATEST` and the `bounds` memo all go. They were the
  scaffolding for a lattice this replaces. The comment about a 06:30 class widening the grid goes
  with them — "fora da grelha" is the honest successor to that rule.
- **Most likely to be got wrong:** the multi-lane block. It must be positioned out of flow over its
  lane rows, the way the current chip already covers its duration rows — and the lane rows under it
  must stay droppable at their edges so a booking can be dragged *into* the gap beside it. Rendering
  the block inside the first lane's cell and letting it overflow is what breaks the drop targets.
- Second: "todos os tanques" multiplies the row count by the number of pools. Cap the default to the
  first pool and make the all-pools view an explicit choice, or a six-lane club with four tanks gets
  336 rows on first paint.
- Third: the sticky rail. Two sticky columns (`Horário` spanning a slot's lanes, `Pista` per row)
  inside a horizontally scrolling container is fiddly; `position: sticky` with `left` on both, and
  the slot label as a `rowSpan`-like absolutely positioned element rather than a real `rowspan`,
  because the grid is CSS grid and not a table.
- Persist density and filters in `localStorage`, wrapped in try/catch — it throws outright in some
  privacy modes.
- The grid is exempt from pagination: it is a fixed window, one week of one season. Record the
  exemption in CONVENTIONS alongside the turmas week grid.

### QA — test scenarios
- **49.1** Given a facility with 14 weekday slots and a 6-lane pool / When the grid renders / Then there are 14 slot groups each with 6 lane rows.
- **49.2** Given the weekend slots differ / When the grid renders / Then the weekend block shows its own slots and not the weekday ones.
- **49.3** Given a booking across lanes 2–4 / When it renders / Then it is one block spanning three lane rows, not three blocks.
- **49.4** Given that booking / When the cell on lane 5 is targeted / Then it is still a valid drop target.
- **49.5** Given a cell with a booking / When it renders / Then group, instructor and headcount are all visible text.
- **49.6** Given compact density / When it renders / Then the headcount is a badge and the row height is close to the reference sheet's.
- **49.7** Given "esconder pistas vazias" / When toggled / Then lanes with no booking in any slot disappear and the toggle's state persists across a reload.
- **49.8** Given a filter by instructor / When applied / Then only that instructor's bookings show and the legend lists only the categories still in view.
- **49.9** Given a facility with no slots / When the grid opens / Then it says so and links to the slot editor.
- **49.10** Given a booking at 07:15 in a facility whose grid has no 07:15 / When the grid renders / Then it appears in "fora da grelha" with its time, and is not lost.
- **49.11** Given a closed weekday / When the grid renders / Then that column is locked and names the closure, as the current board already does.
- **49.12** Given "todos os tanques" at a four-pool facility / When selected / Then each pool is a named block and the default view was a single pool.
- **49.13** Given light and dark mode / When category-coloured cells render / Then every category is distinguishable in both and contrast-checked.
- **49.14** Given a screen reader / When moving through the grid / Then each cell announces its day, slot, lane and what is in it.
- **49.15** Given pt-PT and en / When the grid, its filters and its legend render / Then every string exists in both.
- **49.16** Given tenant A's grid / When tenant B loads the same URL / Then nothing of A's is returned.

### Acceptance criteria

1. The grid's rows are the facility's slots, subdivided into one row per lane of the selected pool.
2. The weekend grid renders as its own block with its own slots, and the adjacent-versus-stacked choice is made from a real render at 1280px and recorded.
3. `Horário` and `Pista` are a sticky left rail that survives both vertical and horizontal scroll.
4. Every cell shows group/level, instructor and headcount as visible text; colour comes from the category or partner and never carries meaning alone.
5. A booking spanning lanes renders as one block, and the lanes beside it remain valid drop targets.
6. Density toggles between compacta and confortável, and the choice persists per viewer.
7. Empty lanes show by default with a toggle to hide them, which also persists.
8. Filters by pool, instructor, category, partner and level; the legend is generated from what is in view.
9. A pool selector appears when the facility has several tanks, with an explicit "todos os tanques"; the default view is one pool.
10. A facility with no slot grid says so and links to the editor rather than rendering an empty lattice.
11. A booking matching no slot renders under the grid in "fora da grelha", named and timed.
12. Closed days stay locked and named, as the existing board does.
13. The grid is contrast-checked in light and dark, and is fully navigable and announced by keyboard alone.
14. The grid's pagination exemption is recorded in CONVENTIONS.
