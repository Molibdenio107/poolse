# POOLSE-168 · Níveis get a colour set of their own, drawn from Poolse's palette, and the calendar follows it

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature / Design · **Area:** Students / Calendar / Design · **Priority:** Medium (pilot) · **Depends on** [POOLSE-138], [POOLSE-139] · **Unblocks** —

### PO — why this exists
Rui, 04-11-2026: "Student levels should not have the same colour scheme as the classes; the colour selection should be different and more according to the colour palette of the Poolse app." Decided the same day: one new palette-aligned set for levels, and the calendar's blocks (tinted by level) follow it — one level colour everywhere, never two systems.

**Not in scope:** the partnership block colour (`inkFor`), role colours, attendance colours.

### BA — rules
1. `--level-1…8` are redefined from the brand hues (teal, soft orange, green, and their deepened/lightened steps) so that solid swatches stay ≥ ΔE 20 apart and the 16 % wash plus the 3 px bar still distinguish neighbours on a calendar.
2. Both themes solved separately, as today; every text-on-fill pair in `contrast:check`'s `PAIRS` updated and green.
3. The Níveis page's legend, the turma cards, the calendar chips and the student record's level chip all read the same tokens — no component gains a literal.
4. The four existing colour systems (CONVENTIONS) stay visually distinct from the new set; the role badges in particular.

### Dev notes
- `globals.css` tokens; `chipClass()` / `tintClass()` unchanged. Run `contrast:check` and the calendar Playwright snapshots; update the snapshots deliberately.
- `dataviz` skill's palette validator can measure ΔE between the eight solids.

### QA
1. Given the calendar with eight levels side by side, in light and dark, then each neighbour pair is distinguishable by bar colour and the text is AA.
2. `contrast:check` passes with the new pairs.
3. Níveis legend and a turma card show the same colour for the same level.

### Acceptance criteria
- [ ] New tokens in both themes, measured.
- [ ] Calendar, cards, chips all follow; snapshots updated.
- [ ] decisions.md line.
