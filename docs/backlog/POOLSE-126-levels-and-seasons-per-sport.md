# POOLSE-126 · Levels belong to a sport; a season is shared unless the site says otherwise

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Students / Classes / Facilities · **Priority:** Medium (schema before go-live, screens after) · **Depends on** [POOLSE-122](./POOLSE-122-recintos-typed-playing-areas.md), [POOLSE-124](./POOLSE-124-sport-modules-and-billing.md)

### PO — why this exists

A swimming level ladder (automatic advancement, skills, age ranges, mínimos) has nothing to do with a tennis ladder. Decided 12: **levels are per sport.** Decided 13: **the season is shared** — one *época* for the club — **with a per-sport toggle in the facility configuration** so a club whose padel runs on a calendar year can give it its own season.

**Not in scope:** sport-specific skills catalogues (a tennis club types its own), tennis advancement rules.

### BA — rules

1. `level.sport_id` NOT NULL, backfilled to `pool`. Level ordering, colours (round 6), age ranges and the advancement engine (POOLSE-19, 112, 113) stay as they are and filter by sport.
2. A turma's level must share the turma's recinto's sport (CHECK via trigger, since it crosses tables).
3. Facility configuration gains, per enabled sport, *Época própria* (off by default). Off: the sport's turmas use the club's published season. On: `season.sport_id` is set and `unique (organization_id) where status = 'published'` becomes `unique (organization_id, coalesce(sport_id, uuid_nil))`, one published season per sport-with-its-own-season plus the shared one.
4. *Gerar a época* and *Reset season* act within the season's sport scope; the shared season reaches every sport without its own.
5. The student's page groups enrolments by sport, then turma; one person, one record (the existing `membership`), as decided for the app.

### Dev notes

- `level.sport_id` with composite FK; the levels page takes `?sport=` like POOLSE-125's lists.
- Season: nullable `sport_id`, the rebuilt partial unique, and `season_scope()` used by the generator, the reset and the advancement nightly pass — one function, three callers, as `which_season()` already is.
- The facility configuration tab (round 4) gains the toggle under a *Desportos* heading that only renders with two or more enabled sports (Decided 11 applies).

### QA

1. Given a pool-only club, then every level has `sport = pool` and the levels page is unchanged.
2. Given a tennis level on a pool turma, then the write is refused.
3. Given *Época própria* on for tennis and a published tennis season, then publishing a second tennis season is refused and the shared season's publish is unaffected.
4. Given the toggle off, then the tennis turmas generate sessions from the shared season.
5. Advancement nightly pass touches only pool levels for pool students.

### Acceptance criteria

- [ ] `level.sport_id`, trigger on turma/level sport match.
- [ ] Season per sport behind the toggle; `season_scope()` used by all three callers.
- [ ] No visible change for a pool-only club.

**Schema half built 29-10-2026** (migration `levels-and-seasons-per-sport`, test `levels-per-sport.sql`): criterion 1, the season columns and `season_scope()`. Left for the screens half: the levels page's `?sport=`, the *Época própria* control and *Desportos* heading, rule 5's grouping by sport, and `sport_id IS NULL` on the API's published-season lookups. The toggle is stored on `organization`, since a season is club-wide (`docs/decisions.md`).
