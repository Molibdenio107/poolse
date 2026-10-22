# POOLSE-102 · Cost per use shows real figures in the demo club

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Seed data · **Area:** Energy / Demo · **Priority:** Low · **Depends on** [POOLSE-28](./POOLSE-28-heating-cost-per-lesson-hour.md), [POOLSE-55](./POOLSE-55-reference-schedule-seed.md) (the seed)

### PO — why this exists

Rui, 22-10-2026: *"'Cost per use': add dummy but real data to see details on this screen."*

The tab (`pools/[poolId]/cost-per-use-panel.tsx`) renders a sentence saying why each figure is unavailable, because the demo club has no bills and no meter readings. It's the strongest sales argument for the four-module product (POOLSE-28) and nobody can see it work.

### BA — what the seed adds

1. **For the demo club's main site:** one electricity meter and one gas meter (CPE/CUI in the Portuguese format), with **12 months of bills** at plausible Portuguese tariffs (electricity ≈ 0.16–0.20 €/kWh plus fixed terms; gas ≈ 0.09 €/kWh), monthly consumption that follows the season (higher in winter for heating), and readings at each bill date.
2. **Water:** 12 monthly readings on the water meter, if the model has one; else skip.
3. **Lesson hours** already come from the reference schedule seed (POOLSE-55), so cost per lesson-hour and per swimmer resolve on their own.
4. The figures must be **labelled as demo** on the seed, never on the screen.

### Dev notes

- Extend the existing seed script, not a new one. Idempotent: running it twice doesn't double the bills.
- Amounts are deterministic (no `Math.random()`), so screenshots and tests are stable.
- Add one integration test asserting the demo tank's cost per lesson-hour is a number, not null.

### QA — scenarios

1. **Given** a fresh database with the seed, **when** I open the demo tank's Cost per use, **then** every figure shows a value, and the trend covers 12 months.
2. Running the seed again changes nothing.

### Acceptance criteria

1. Cost per use is fully populated for the demo club.
2. The seed is idempotent and tested.

### Open questions

- None.
