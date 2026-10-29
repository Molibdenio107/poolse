# POOLSE-122 · Recintos: a site holds typed playing areas, and a pool is one kind of them

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Architecture · **Area:** Facilities / Schema · **Priority:** High (before first go-live; invisible to the pilot) · **Depends on** nothing · **Unblocks** [POOLSE-123](./POOLSE-123-area-units-generalise-lanes.md), [POOLSE-124](./POOLSE-124-sport-modules-and-billing.md), [POOLSE-125](./POOLSE-125-navigation-per-sport.md), [POOLSE-126](./POOLSE-126-levels-and-seasons-per-sport.md), [POOLSE-128](./POOLSE-128-energy-roll-up-and-allocation-per-recinto.md)

### PO — why this exists

Rui, 28-10-2026: *"I want Poolse to become more general in the future... add a pool, add a tennis court, add a football field, a basketball court... each one has different metrics."* Then: *"we recycle the things we can from the pool side... a separate main menu section for tennis, padel, basketball, football... the owner pays this on the subscription."* And on energy: *"all the costs from the facility should be gathered all together so the user can see what goes where."*

This **reverses** the scope line in `CLAUDE.md` that narrowed Poolse back to pools. The reversal is deliberate and recorded in `docs/decisions.md` (2026-10-28). The rule that comes with it: **the pool is untouched for first go-live.** This ticket adds a parent above `pool`; it does not rename, move or re-key anything the 19 migrations that reference `pool` depend on.

The research in `claude/poolse-competitor-feature-gaps.md` and the 28-10 search found that Bond Sports, EZFacility, OpenCourt and SportFinder all run sports side by side with per-sport settings rolling up to one back office — and that none of them relate energy cost to a space. That roll-up is the edge; this ticket is its foundation.

**Not in scope:** any non-pool metric, any sport-specific screen, any change the pilot can see. Support rooms (locker rooms, toilets) stay in `space` (Espaços, round 6) — a recinto is where sport happens, a space is where it does not.

### BA — rules

1. A **recinto** (`playing_area`) belongs to one site and has one **sport** from the catalogue. pt-PT *Recinto*, en *Sports field*. The menu label for a pool-only club stays *Piscinas* (see POOLSE-125 rule 2).
2. A pool **is** a recinto of sport `pool`. Every existing pool gets a parent row; a pool cannot exist without one; a recinto of sport `pool` cannot exist without its `pool` child.
3. The sport catalogue is a **table**, not an enum (Rui: *"it gives margin to add more"*). Seeded: `pool`, `tennis`, `padel`, `basketball`, `football`, `handball`, `volleyball`, `gym`. Per sport: `unit_label_pt`, `unit_label_en` (pista / court / meia-campo…), `default_slot_minutes`, `has_units`, `has_metrics`, `has_inventory`, `units_shareable` (POOLSE-123 rule 3), `position`. A gym is `has_units = false, has_inventory = true`; padel is `has_units = true, has_metrics = false`. Platform-owned rows (no tenant key); a club cannot add a sport, Rui can.
4. Name is unique per site, case- and accent-insensitive, among live recintos — the same rule `pool` has today, lifted one level so a tennis court and a pool cannot share a name either.
5. `class_group`, `closure` and `energy_meter` gain `playing_area_id`, filled from their `pool_id` by migration and kept in step by trigger while both columns exist. Readers keep reading `pool_id` for now. Decided 15: `energy_meter.pool_id` becomes `playing_area_id` *now*; the allocation rule is POOLSE-128.
6. Archiving a recinto archives its pool child and vice versa — one soft delete, both directions, so neither can be found live without the other.
7. Excel import: the *Instalações* import maps a sheet's tank rows onto recintos of sport `pool`; a sport column is accepted and defaults to `pool`. Any other sport is refused with the reason until POOLSE-124 switches that sport on for the club.

### Dev notes

- `playing_area (id, organization_id, facility_id, sport_id, name, position, archived_at)`, composite FK `(organization_id, facility_id) → facility`, `unique (organization_id, id)` so children can reference the pair, partial unique on `(organization_id, facility_id, lower(strip_accents(name))) where archived_at is null`. RLS as every tenant table; `write-migration` skill applies.
- `pool` gains `playing_area_id` NOT NULL after backfill, `unique (organization_id, playing_area_id)`. Its own `name`, `facility_id` stay for the duration of go-live; a later ticket drops them once no reader is left. **Do not drop them here.**
- `provision_organization` creates the first recinto beside the first pool for a personal tenant. Add the assertion to `platform-admin.sql`.
- Backfill is one `INSERT … SELECT` from `pool`, then the triggers `pool_area_sync` (archive both ways) and `*_area_from_pool` on the three tables in rule 5. Name them so they sort where they must (see the `class_schedule_default_site` lesson in `docs/data-model.md`).
- `GET /facilities/:id` answers `playingAreas` beside `pools`, same rows, until POOLSE-125 switches the menu.
- Write the section *Recintos — POOLSE-122* in `docs/data-model.md` next to *Core*, and move the "briefly widened and narrowed back" paragraph out of `CLAUDE.md` into the new scope paragraph (done with this ticket's commit).

### QA

1. Given a club with two pools on one site, when the migration runs, then two recintos of sport `pool` exist with the pools' names and positions, each pool's `playing_area_id` set.
2. Given a recinto of sport `pool` with no `pool` child, when inserted, then the deferred constraint refuses the commit.
3. Given a pool archived from its page, then its recinto is archived in the same statement, and the reverse.
4. Given a new turma on a pool, then `class_group.playing_area_id` equals the pool's recinto without the API setting it.
5. Given a sheet with a `Desporto` column reading `Ténis`, when imported before POOLSE-124, then the row is refused naming the sport and the rest import.
6. Given a signup of a personal tenant, then `facility`, `playing_area` and `pool` are created in one transaction.
7. Cross-tenant: a recinto id from another club in any new endpoint is a 404.
8. Nothing the pilot sees changes: the *Instalações* page, the pool page, the calendar and the water tab render byte-for-byte as before (snapshot the three).

### Acceptance criteria

- [ ] `playing_area` and `sport` tables exist, seeded as rule 3, with RLS and tests.
- [ ] Every live pool has exactly one live recinto, enforced both ways.
- [ ] `class_group`, `closure`, `energy_meter` carry `playing_area_id`, backfilled and trigger-synced.
- [ ] `CLAUDE.md` scope paragraph and `docs/decisions.md` record the reversal.
- [ ] No visible change in the backoffice or the app for a club with only pools.
