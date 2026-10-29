# POOLSE-123 · Units: a lane is one kind of area unit, and a booking sits on units

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Architecture · **Area:** Calendar / Schema · **Priority:** High (before first go-live, *one full session*; re-confirm with Rui before starting) · **Depends on** [POOLSE-122](./POOLSE-122-recintos-typed-playing-areas.md)

### PO — why this exists

A turma books lanes of a pool. A tennis class books a court, a football match books both halves of a pitch. The conflict rule — nothing sits on the same unit at the same time — is the same in every sport, and `lane` is where it lives today (`booking_lane`, `class_session_lane`, the GiST exclusion, the grid, `lane_level_capacity`).

Rui, 28-10-2026, option (a) — generalise now rather than retrofit when the second sport arrives: *"Default a seems ok, but ask again when developing."* **Ask again.** This is the one ticket of the set that is not an evening; if the go-live date moves closer, fall back to option (b) below and keep this ticket as the retrofit plan.

**Option (b), the fallback:** leave `lane` as the pool's unit; add `area_unit` only with the first non-pool sport; `booking_lane` and `class_session_lane` gain a nullable `unit_id` then, with a CHECK that exactly one of `lane_id`/`unit_id` is set. Bounded, but it is a retrofit touching the exclusion constraints — write it down now so it is not re-discovered.

**Not in scope:** the grid learning to draw courts (POOLSE-125), court-specific pricing per slot (reception/POOLSE-68 later), equipment rental.

### BA — rules

1. `area_unit` replaces `lane`: one row per bookable unit of a recinto — a pista, a court, a half-pitch. A recinto whose sport has `has_units = false` (gym) has no units and is booked as a whole.
2. **Whole-area booking** (Decided 5): a booking on every live unit of the recinto, not a special unit. The conflict logic stays one rule.
3. **Shareable units** (Decided 6): `sport.units_shareable` — `true` for `pool` (two small turmas may share a lane, as today), `false` for courts and pitches. For a non-shareable sport the exclusion is strict; for a shareable one the capacity rules of POOLSE-52 go on applying.
4. The grid's slot lattice (`facility_time_slot`, POOLSE-44) is per site today. A court's natural step (60 or 90 minutes) differs from a pool's; `sport.default_slot_minutes` seeds a recinto's slots when none exist, and a site may keep different lattices per recinto. **Open:** per site or per recinto — default per recinto, falling back to the site's.
5. `lane_level_capacity` becomes `unit_level_capacity`; it only ever has rows for sport `pool`.
6. Every reader of "pista" on screen reads `sport.unit_label_*`.

### Dev notes

- Rename in place, not copy-and-migrate: `alter table lane rename to area_unit`, `pool_id → playing_area_id` (backfilled through `pool.playing_area_id`), then rename the dependent columns `lane_id → unit_id` on `class_group`, `booking_lane` (→ `booking_unit`), `class_session_lane` (→ `class_session_unit`), `lane_level_capacity`. Postgres keeps constraints and indexes through a rename; re-create the GiST exclusion only if its expression names the column.
- `syncBookingLanes`, the generator, `@poolse/rules` conflict module (POOLSE-51), occupancy (POOLSE-52) and the lane grid read model (POOLSE-49) all need the new names; grep for `lane` and expect ~10 migrations' worth of tests to rename with them.
- `strict` vs shareable: one exclusion constraint with `WHERE` on a copied `shareable` flag, synced like `cancelled` is — the same pattern as `class_session_lane_sync`.
- Keep a compatibility view `lane` for one release so the Excel importer and any script still works; drop it in the sweep after go-live.
- i18n: `pista` becomes a sport-driven label everywhere; `pnpm i18n:check` will not catch a hard-coded one, read the diff.

### QA

1. Given the full `bookings.sql`, `sessions.sql`, `conflicts.sql`, `occupancy.sql` suites, when run after the rename, then every test passes with the renamed tables (no test deleted).
2. Given a padel court (non-shareable) and two bookings at 10:00, then the second is refused by the exclusion.
3. Given a lane (shareable) and two small turmas at 10:00, then both are accepted and POOLSE-52's tank ceiling still applies.
4. Given a football pitch with two halves and a match booking "whole area", then two unit rows are written and a third booking on either half is refused.
5. Given a gym recinto, then it has no units, the grid shows it as one row, and a booking on it writes no unit rows.
6. The lane grid, the calendar, the turma form and the Excel import of pistas render and behave as before for a pool-only club.

### Acceptance criteria

- [ ] `area_unit` holds every former lane with the same ids; no booking lost a unit.
- [ ] Shareable and strict exclusion both proven in SQL tests.
- [ ] Whole-area booking proven.
- [ ] No visible change for a pool-only club.
- [ ] If option (b) is taken instead, this file is rewritten as the retrofit plan and dated.
