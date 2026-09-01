# POOLSE-43 · Lanes as rows on a pool

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Data model · **Area:** Installations / Scheduling · **Priority:** High — blocks POOLSE-46, 49, 51

### PO — why this exists
A real club's schedule is written per lane, not per pool. In the reference sheet (Ginásio Clube de
Santo Tirso, 2025/2026) every time slot is split into `Pista 1..6` and four or five different groups
run at once in the same tank, each on its own lane with its own level and instructor. Poolse today
stores a lane as a bare `smallint` on the turma: no name, no capacity, nothing that stops somebody
typing lane 7 in a six-lane pool, and no way for two turmas to share a booking across lanes.

This ticket makes a lane a thing that exists. It changes nothing an operator sees except the
Instalações page — deliberately, so the grid work that follows lands on a model that is already
correct and already migrated.

**Not in scope:** bookings occupying more than one lane (POOLSE-46), the lane grid itself
(POOLSE-49), and lane-level occupancy figures (POOLSE-52).

### BA — rules and data
- A pool gains `lanes_enabled`. A pool with lanes has an ordered, named set of them; a pool without
  — a learner tank, a jacuzzi, a hidro room — still has **exactly one** lane row, named after the
  pool. See the Dev note: the implicit lane is what keeps the grid rectangular and every booking's
  lane reference non-null.
- A lane carries `name` (default `Pista 1`…`Pista N`, renameable), `position`, `length_m` (nullable)
  and `default_capacity` (nullable). Nullable because an operator who has not decided how many fit
  in a lane must not be blocked, and inventing a default would enforce a number nobody chose — the
  same rule `class_group.capacity` already follows.
- Lanes are reorderable. Position is what the grid reads, not the name: a club that renames `Pista 1`
  to `Pista do fundo` has not moved it.
- **Reducing the lane count is blocked while anything references the removed lanes**, and the refusal
  names them: "Pista 5 e Pista 6 têm turmas: Infantis A (3ª 18:30), Cadetes (5ª 19:15)." A count that
  silently dropped bookings would lose a season's planning.
- Lanes are soft-deleted like everything else, so their unique constraints are partial.
- Existing data migrates rather than being asked for again: a pool's `lane_count` becomes that many
  lane rows, and each turma's `class_group.lane` number becomes a reference to the lane at that
  position.
- A turma whose `lane` exceeds its pool's `lane_count` is real — nothing enforced it until now — and
  the migration **creates the missing lane** rather than dropping the reference. Losing where a class
  swims to tidy up a migration is not a trade this repo makes.
- **Answered (from the reference sheet):** a booking never spans two *pools*. Hidroginástica taking
  the whole tank is one booking over every lane of that tank; overflowing into the learner tank is
  two bookings. Keeping a booking inside one pool is what lets the lane exclusion constraint stay a
  single index.

### Dev — implementation notes
- New table, tenant-scoped with the composite key as everywhere:
  ```
  lane
    id, organization_id, pool_id,
    name text not null, position smallint not null,
    length_m numeric(5,2), default_capacity integer,
    created_at, updated_at, archived_at
    unique (organization_id, id)
    foreign key (organization_id, pool_id) references pool (organization_id, id)
    unique (organization_id, pool_id, position) where archived_at is null
    unique (organization_id, pool_id, lower(strip_accents(name))) where archived_at is null
  ```
  `pool` also needs `unique (organization_id, pool_id, id)`-style keying only if a child has to be
  proved to be in the same pool — `inventory_item_pool` already added
  `pool_org_facility_id_uq` for the facility case; check before adding a second.
- **The implicit lane is a real row, not a null.** The alternative — `lane_id` nullable, meaning
  "the whole pool" — puts a null branch in every join, every conflict check and every grid cell, and
  the branch is the bug. One row costs nothing and makes a pool without lanes just a pool with one.
- `class_group.lane smallint` becomes `class_group.lane_id uuid`, and `class_session.lane smallint`
  becomes `class_session.lane_id uuid`. `class_session` keeps copying it from the turma at generation
  time, for the reason already in that migration: an exclusion constraint cannot reach into another
  table.
- **Most likely to be got wrong:** the exclusion constraint. `class_session_lane_free` currently
  reads `lane WITH =` on a `smallint`. Moving it to `uuid` needs `btree_gist` to supply uuid equality
  inside a GiST index — the extension is already installed (`closures-and-sessions.sql`), but the
  constraint must be **dropped and recreated**, and the recreate is where a typo silently produces a
  constraint that matches nothing. Prove it with a test that tries to double-book one lane.
- Second most likely: the backfill joining `class_group.lane` to `lane.position` must run **after**
  the lane rows exist and must be scoped by pool, not by position alone — position 3 exists in every
  pool.
- The lane editor goes on the pool form on Instalações, beside the dimensions it already collects.
  Reordering reuses `components/reorderable.tsx`, the same control Níveis uses.
- API: lanes travel with the pool in `/facilities/pools/:poolId` — small, always shown, and a second
  round trip would put a spinner on a list of six rows.

### QA — test scenarios
- **43.1** Given a pool with `lanes_enabled` and 6 lanes / When the pool is read / Then six lanes come back in position order with their names.
- **43.2** Given a pool with `lanes_enabled` false / When the pool is read / Then exactly one lane comes back, named after the pool.
- **43.3** Given a lane renamed to `Pista do fundo` / When the grid reads lanes / Then its position is unchanged.
- **43.4** Given two lanes in one pool / When a third is added with the same name in different case or accents / Then it is refused.
- **43.5** Given the same name in a *different* pool / When added / Then it is accepted.
- **43.6** Given a lane holding a turma / When the operator reduces the lane count below it / Then the change is refused and the message names the lane and the turmas on it.
- **43.7** Given a lane that is archived / When a new lane is created with its name / Then it is accepted — the unique index is partial.
- **43.8** Given two sessions at the same time in the same lane / When the second is inserted / Then the exclusion constraint refuses it.
- **43.9** Given the first of those sessions is cancelled / When the second is inserted / Then it is accepted — a cancelled session releases its lane.
- **43.10** Given two sessions at the same time in *different* lanes of one pool / When both are inserted / Then both are accepted.
- **43.11** Given tenant A's lane / When tenant B queries lanes / Then nothing of A's is returned, and B cannot attach a booking to it.
- **43.12** Given the migration runs on a turma whose `lane` is 7 in a 6-lane pool / When it completes / Then a seventh lane exists and the turma still points at it.
- **43.13** Given the migration runs / When every turma is checked / Then no turma lost its lane and none points at a lane in another pool.
- **43.14** Given an instructor (read-only on facilities) / When they POST a lane / Then the API refuses it.

### Built — decisions taken while building

- **`pool.lane_count` was dropped**, which the ticket did not call for. Leaving it beside the
  lane rows would have been two answers to "how many lanes has this pool", and two answers
  drift. The API still exposes `laneCount` because the form asks for a number;
  `setLaneCount` in the facilities repository is the translation. Cost: nine test files and
  the pool write path.
- **The one-lane invariant is a trigger**, `pool_create_default_lanes`, not application code.
  An invariant that holds only where a writer remembers it is not an invariant, and this one
  is what removes the null case from every join downstream.
- **The uuid exclusion was spiked first**, in `psql`, before the migration was written.
  `btree_gist` does supply uuid equality, so no trigger fallback was needed.
- **The Down migration was exercised**, twice, as part of getting the shape right — so the
  rollback path is tested rather than merely written.
- AC4's refusal names lanes *and* turmas and shares a transaction with the rest of the pool
  edit, so a rejected shrink cannot leave a renamed pool behind. `lanes.integration.test.ts`.

### Acceptance criteria

1. `lane` exists as a tenant-scoped table with name, position, optional length and optional default capacity, keyed compositely to its pool.
2. A pool carries `lanes_enabled`; a pool without lanes still has exactly one lane row so the model has no "no lane" case.
3. Lanes are renameable and reorderable; position, not name, is what the grid orders by.
4. Reducing the lane set is refused while bookings reference the removed lanes, and the refusal names both the lanes and the turmas on them.
5. Unique constraints on lanes are partial on `archived_at`, so an archived lane does not hold its name or position hostage.
6. `class_group.lane` and `class_session.lane` become references to `lane`, backfilled with no turma losing its lane.
7. A turma whose old lane number exceeded the pool's lane count gains the lane it needs rather than losing the reference.
8. The lane exclusion constraint on `class_session` is recreated against `lane_id` and proven by a test that a lane cannot be double-booked, that a cancelled session releases it, and that adjacent lanes are unaffected.
9. Lane editing is owner/admin only, enforced in the API; the pool page shows lanes read-only to everyone else.
10. Lanes travel with the pool in its existing endpoint rather than behind a second request.
