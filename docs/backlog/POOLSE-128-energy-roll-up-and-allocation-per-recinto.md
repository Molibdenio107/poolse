# POOLSE-128 · Energy: the site's costs roll up across every recinto, allocated by a rule the club sets

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Energy / Dashboards · **Priority:** Medium (post go-live; research first) · **Depends on** [POOLSE-122](./POOLSE-122-recintos-typed-playing-areas.md), [POOLSE-106](./POOLSE-106-energy-page-dashboard-collapsible-import-bill-reading.md), [POOLSE-102](./POOLSE-102-cost-per-use-demo-data.md)

### PO — why this exists

Rui, 28-10-2026: *"all the costs from the facility should be gathered all together so the user can see what goes where and where the expenses are happening."* The 28-10 search found no booking platform doing this; energy appears only in enterprise operations suites (Facilio) and there as asset maintenance, not cost per hour of use. The industry answer is submetering per cost centre, which most clubs do not have. **The edge is the allocation engine**: use a submeter where one exists, otherwise a rule.

POOLSE-122 already moved `energy_meter.pool_id` to `playing_area_id`. A meter with no recinto is the site's.

**Rui asked for a research dive on allocation before this is specified.** Do that first; this ticket holds the shape.

**Not in scope:** sensor ingestion, hypertable conversion (roadmap, Deferred), floodlight add-on pricing (reception).

### BA — rules (to be confirmed after the research)

1. Allocation rule per site, chosen in facility configuration: `submeter` (a meter bound to the recinto, measured), `area` (by m², which needs `playing_area.area_m2`), `hours` (by booked hours from the calendar), `share` (fixed percentages typed by the club). A recinto with its own meter is measured; the remainder of the site's bill is allocated among the rest by the rule.
2. Cost per use (POOLSE-102) is then **per recinto**: € per lesson hour for a pool, € per booked hour for a court, € per opening hour for a gym.
3. The Energia dashboard shows the site total, the split per recinto, and the unallocated remainder; the per-sport Energia entry (POOLSE-125) shows only its recintos.
4. The AI dashboards (phase 6) read the same figures; nothing is computed twice.

### Dev notes

- One SQL function `energy_allocation(site, period)` returning `(playing_area_id, kwh, cents, method)`, the single definition for the dashboard, the per-sport view and the AI module.
- `playing_area.area_m2` nullable; `share` rule rows in a small table with a CHECK that a site's shares sum to 100.

### QA

To be written after the research and Rui's answers on rule 1.

### Acceptance criteria

To be written after the research.
