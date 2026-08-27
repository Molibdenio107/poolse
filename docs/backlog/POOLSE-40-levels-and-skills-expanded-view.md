# POOLSE-40 · Levels and skills — the expanded view

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Improvement · **Area:** Levels / Skills · **Priority:** Medium
**Depends on:** POOLSE-05 (drag-and-drop ordering), POOLSE-20 (four-state skill progress adds fields to display)

### PO — why this exists
Collapsed, the levels list reads fine. Expanded, the skills inside a level are stacked text with no
alignment, and the page becomes hard to scan exactly when the user is trying to compare skills. The
content is right; the presentation is not.
**Not in scope:** changing what a level or a skill *is*, or the instructor-side assessment grid (that is POOLSE-20).

### BA — rules and data
- A level stays a **card**. Expanding it reveals its skills as a **table with aligned columns**, not stacked paragraphs.
- Table columns: order, skill name, **dias mínimos**, **aulas mínimas**, and an indicator for whether a demonstration video is attached (POOLSE-20). Row actions (edit, remove) sit in a trailing column.
- Column headers are always visible while the table is open, so a long skill list stays readable.
- Expanding one level does not collapse the others; expansion state is per level.
- A level with no skills shows a purposeful empty state with the action to add the first one, not a blank table.
- Skill order inside a level is meaningful (it drives level completion in POOLSE-19) and is reorderable by the same drag-and-drop interaction as POOLSE-05 — one interaction pattern, two levels of the hierarchy.
- Numeric columns are right-aligned with tabular figures so values compare down the column.
- The expanded card must not change the width of the page or push siblings around — it grows downward only.
- **Open:** should expansion state persist between visits, or reset on each page load?

### Dev — implementation notes
- One shared table primitive for this and the other data tables in the app; the inconsistency is the actual complaint, so do not hand-roll a second table here.
- `font-variant-numeric: tabular-nums` on the numeric columns; right-align them, left-align text.
- The table needs its own `overflow-x: auto` container so a narrow viewport scrolls the table rather than the page (a standing rule, and this is where it will first bite).
- Reuse POOLSE-05's drag-and-drop implementation for skill rows rather than adding a second library or a second pattern.
- Expansion is layout state, not data — it belongs in component state or the URL, never in a write to the server.
- Animate height with `prefers-reduced-motion` respected; an expanding card that jumps is what makes the current version feel unfinished.
- Most likely to be got wrong: nesting a drag-and-drop list inside a drag-and-drop list. The level cards reorder, and the rows inside them reorder — make sure a row drag never grabs the card.

### QA — test scenarios
- **40.1** Given a level with several skills / When it is expanded / Then the skills render as a table with aligned columns and visible headers.
- **40.2** Given the expanded table / When numeric columns are compared / Then dias mínimos and aulas mínimas are right-aligned with tabular figures.
- **40.3** Given two levels / When both are expanded / Then both stay open independently.
- **40.4** Given a level with no skills / When it is expanded / Then a purposeful empty state offers to add the first skill.
- **40.5** Given a long skill list / When the user scrolls within the card / Then the column headers remain readable.
- **40.6** Given a narrow viewport / When a level is expanded / Then the table scrolls horizontally inside its own container and the page body does not scroll sideways.
- **40.7** Given a skill row / When it is dragged to a new position / Then the skill order changes and the level card itself does not move.
- **40.8** Given a level card / When it is dragged / Then the card reorders and no skill row is picked up.
- **40.9** Given `prefers-reduced-motion` / When a level is expanded / Then it opens without animation.
- **40.10** Given light and dark mode / When a level is expanded / Then the table borders, headers and row hover states are legible in both.
- **40.11** Given pt-PT and en / When the table renders / Then all column headers resolve from the translation layer and the widest label does not break the layout.
- **40.12** Given a skill with a demonstration video and one without / When the table renders / Then the indicator distinguishes them by icon and label, never colour alone.

### Acceptance criteria

1. Expanding a level shows its skills as a **table with aligned columns**, replacing the stacked text layout.
2. Columns: order, skill name, dias mínimos, aulas mínimas, video indicator, row actions.
3. Column headers stay visible while the table is open.
4. Numeric columns are right-aligned with tabular figures.
5. Levels expand independently; expanding one does not collapse another.
6. An empty level shows an empty state with the action to add a skill.
7. Skills reorder by drag and drop, using the same interaction as POOLSE-05, and a row drag never moves the level card.
8. The table scrolls inside its own container on narrow viewports; the page body never scrolls horizontally.
9. Expansion grows the card downward without changing page width or shifting sibling cards.
10. Motion respects `prefers-reduced-motion`; the layout is checked in light and dark mode.
