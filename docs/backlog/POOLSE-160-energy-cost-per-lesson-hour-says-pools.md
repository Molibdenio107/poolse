# POOLSE-160 · Energy's *cost per lesson hour* and *per swimmer* say they are the pools', and a court's energy is its own line

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Energy / Multi-sport · **Priority:** Low (post go-live) · **Depends on** [POOLSE-106], [POOLSE-128] · **Unblocks** —

### PO — why this exists
Rui, 04-11-2026: "'Energy' running costs 'costs per lesson hour' and cost per swimmer should detail that it is related with the pools, not all the facilities. Remember, a tennis court or football field can also cost energy for lights, irrigation etc."

POOLSE-128 owns the allocation rule; this ticket is the honest label and the meter's recinto.

**Not in scope:** allocating a site meter across recintos (128); per-sport cost reports.

### BA — rules
1. The two tiles read *Custo por hora de aula (piscinas)* and *Custo por nadador (piscinas)*, with the hint that only meters naming a tank count (POOLSE-28 rule).
2. `energy_meter.playing_area_id` already exists (POOLSE-122); the meter form offers any recinto, not only pools. A meter on a court shows under the court's name in the meter list and in the summary's *por recinto* breakdown; it contributes to no per-lesson figure.
3. In a pool-only club nothing changes but the two labels.

### Dev notes
- `energy/summary` already groups by `pool_id`; add a `recintos` group keyed on `playing_area_id` with the sport. `CONSUMED` unchanged.
- i18n keys only for the labels; `dataviz` skill for the breakdown chart.

### QA
1. Given a pool-only club, then the tiles carry the new wording and the same figures (snapshot).
2. Given a meter on a court, when the summary renders, then it appears under the court and the per-lesson figures are unchanged.
3. Maintenance reads the breakdown with euros withheld (existing rule).

### Acceptance criteria
- [ ] Labels say pools.
- [ ] Meter on any recinto, listed per recinto.
- [ ] Per-lesson figures unaffected by non-pool meters.
