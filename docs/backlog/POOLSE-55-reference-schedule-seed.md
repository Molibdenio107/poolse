# POOLSE-55 · The reference schedule as seed, and the verification pass

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Verification · **Area:** Scheduling / Seed data · **Priority:** High — this is what says the model is right

### PO — why this exists
Every ticket in this set was designed against one real document: the Ginásio Clube de Santo Tirso
2025/2026 schedule. The only way to know the model is right is to rebuild that document *inside*
Poolse and put the two side by side.

This is not a test in the ordinary sense. It is the acceptance of the whole feature, and it is
deliberately the last ticket and deliberately allowed to fail: **if something in the reference sheet
cannot be expressed, say so and change the model.** Do not work around it in the seed. A seed that
quietly fudges the one case the model gets wrong is worse than no seed, because it removes the only
signal there was.

**Not in scope:** shipping this data to real customers. It is a demo facility and a fixture.

### BA — what the seed must contain
Rebuilt from the reference sheet:
- A demo facility with a **6-lane** main tank, plus at least one pool with `lanes_enabled` false, so
  the implicit-lane path is exercised.
- The **irregular weekday slots**: 06:30, 08:45, 09:30, 10:15, 11:00, 11:45, 14:45, 15:30, 16:15,
  17:00, 17:45, 18:30, 19:15, 20:00, 21:00 — including the gap between 11:45 and 14:45.
- The **separate weekend slots**: 07:30, 08:00, 09:30, 10:15, 11:00, 11:45.
- **~40 bookings**, including:
  - multi-lane blocks (a competition squad on 2–3 lanes; hidroginástica across the whole tank);
  - one instructor covering several adjacent lanes in one slot — the Sandra case;
  - at least three `uncovered` bookings and at least two `to_define`.
- **Four partner entities** drawn from the sheet — a secondary school booked per class with a `DE`
  tag, an IPSS/Misericórdia doing hidroterapia, a jardim de infância, and a sports club — with their
  groups and participant counts.
- Categories with colours: competition squads, hidroginástica, school groups, external partners,
  manutenção.

### The verification pass
1. **Expressiveness.** Every cell of the reference sheet is representable. Anything that is not is
   written down here, in this ticket, with what the model would need — not solved in the seed.
2. **Side-by-side render.** Export the seeded season to PDF (POOLSE-54) and compare against the
   original page by page: slots in the same order, lanes in the same order, the same groups in the
   same cells, the weekend block present, the legend complete.
3. **Tenant isolation.** The seeded partners, groups, agreements, lanes, slots and bookings are
   unreachable from a second tenant. A new block in `packages/db/test/tenant-isolation.sql` or the
   feature's own test file, per the migration skill's rule that a new isolation-relevant table gets
   an assertion.
4. **Conflict rules against real data.** The Sandra case must be *allowed* by the seeded data — if
   loading the seed trips a conflict rule, the rule is wrong, not the schedule.
5. **Light and dark on the compact grid.** Colour-coded cells at 18px rows are the highest-risk
   visual surface in the whole feature; check every category colour in both themes and record the
   contrast results.
6. **i18n.** No hardcoded strings anywhere in the feature; pt-PT and en complete. `pnpm i18n:check`
   and `pnpm pt:check` both clean.

### Dev — implementation notes
- The seed goes with the existing demo data (`packages/db` seed path), behind the same switch, and
  must be idempotent: running it twice does not produce two Santo Tirsos.
- **Most likely to be got wrong:** seeding straight into tables and bypassing the rules. Seed
  through the same repository functions the API uses wherever practical, because the point of this
  ticket is to find out whether the rules permit the real schedule. A seed written as raw `INSERT`s
  with constraints deferred proves nothing.
- Second: the seed must run against a **published** season, or no dated sessions are generated
  (POOLSE-45) and half the verification has nothing to look at.
- Third: the school's classes — `6A`, `10G 11B`, `11H/I`, `12 F/I` — are the awkward names on
  purpose. They contain spaces, slashes and digits, and they are what the partner import (POOLSE-48)
  and the unique indexes will be judged on.
- Keep the original PDF in the repo beside the seed, or a reference to where it lives, so the
  comparison can be repeated by whoever next changes the model.

### QA — test scenarios
- **55.1** Given the seed / When it runs on an empty database / Then a demo facility exists with 6 lanes, 15 weekday slots and 6 weekend slots.
- **55.2** Given the seed / When it runs twice / Then there is one demo facility, not two.
- **55.3** Given the seed / When the season is generated / Then dated sessions exist for both turma and parceria bookings.
- **55.4** Given the seeded hidroginástica booking / When read / Then it occupies every lane of its tank as one booking.
- **55.5** Given the seeded Sandra bookings / When the seed runs / Then all are accepted, and each shows the concurrency badge.
- **55.6** Given the seeded uncovered bookings / When the grid header renders / Then the counter reads at least 3.
- **55.7** Given the pool with `lanes_enabled` false / When the grid renders / Then it shows exactly one lane row named after the pool.
- **55.8** Given the gap between 11:45 and 14:45 / When the grid renders / Then there is no row for it.
- **55.9** Given the seeded season / When exported to A3 PDF / Then it matches the reference sheet's structure cell for cell, and any difference is recorded here.
- **55.10** Given a partner group named `10G 11B` / When created and re-read / Then the name round-trips exactly, spaces and all.
- **55.11** Given that name exported and re-imported / When compared / Then it matches.
- **55.12** Given a second tenant / When it queries lanes, slots, partners, groups, agreements and bookings / Then none of the seeded rows are returned and none can be referenced.
- **55.13** Given the compact grid with every seeded category / When rendered in light and dark / Then all pass contrast, and the results are recorded.
- **55.14** Given the whole feature / When `pnpm i18n:check` and `pnpm pt:check` run / Then both are clean.

### Acceptance criteria

1. A seed reproduces the reference schedule: 6-lane tank plus a laneless pool, the 15 irregular weekday slots including the midday gap, the 6 weekend slots, ~40 bookings, four partners with their groups, and the category colours.
2. The seed includes multi-lane bookings, the one-instructor-many-adjacent-lanes case, at least three uncovered and at least two to-define bookings.
3. The seed is idempotent and runs through the same rules the API enforces, not around them.
4. Anything in the reference sheet that **cannot** be expressed is written into this ticket with what the model would need, and the model is changed rather than the seed fudged.
5. The seeded season is published, so dated sessions exist.
6. The seeded season exports to A3 PDF and is compared side by side with the original; differences are recorded.
7. The one-instructor-many-lanes case loads without tripping a conflict rule.
8. Tenant isolation is asserted over every new table in this feature, in the SQL test suite.
9. Every category colour is contrast-checked on the compact grid in light and dark, and the results recorded.
10. `pnpm i18n:check` and `pnpm pt:check` are clean across the whole feature.
11. The reference document, or a pointer to it, lives beside the seed so the comparison can be repeated.
