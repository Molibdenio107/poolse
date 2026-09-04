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

---

## Verification record — 2026-09-04

This is the acceptance of POOLSE-43 to 54, so it says what was actually run and
what it found, including the things it could not do.

### The seed loads, and the rules accept the real week

`packages/db/src/seed-reference.ts`, run through `pnpm db:seed`. It builds a
facility of its own — **Piscina Municipal de Santo Tirso** — rather than filling
the club already in a developer's database, because forty seeded bookings landing
on top of hand-typed data is unrecoverable without a reset.

Measured against a real Postgres after running:

| | asked for | got |
|---|---|---|
| Main tank | 6 lanes | 6 |
| Laneless pool | 1 implicit lane | 1 |
| Weekday slots | 15, with the midday hole | 15; `11:45` then `14:45`, nothing between |
| Weekend slots | 6 | 6 |
| Bookings | ~40 | **45** — 32 turma, 12 parceria, 1 manutenção |
| Partners | 4 | 4, across four different `partner_type` values |
| Partner groups | the awkward names | `6A`, `6B`, `10G 11B`, `11H/I`, `12 F/I`, `Hidroterapia`, `Sala dos 4 anos`, `Sala dos 5 anos`, `Sub-16` |
| `uncovered` | at least 3 | 4 |
| `to_define` | at least 2 | 10 |
| Dated sessions | some | 186 over four weeks (132 turma, 54 other) |

- **55.2, idempotent.** Second run added 0 bookings and there is one facility.
- **55.4**, hidroginástica occupies all six lanes as one booking; so do the
  school's two three-lane blocks side by side, and the handball club's Friday.
- **55.5 / criterion 7, the Sandra case is accepted.** One instructor, three
  groups, three adjacent lanes, one slot — twice a week. It loads, and the
  session generator accepts it.
- **55.10**, the awkward names round-trip through the database exactly.

### What the seed found — three real defects

**1. `class_session_instructor_free` is org-wide and crosses facilities.** The
first version of the seed borrowed the organization's existing instructors and
was refused. The constraint asks whether one person is in two *pools* at
overlapping times, and two facilities are two sets of pools — so a club with its
own Monday 06:30 class cannot lend that instructor to a second site at the same
hour. **The rule is right and the seed was wrong**: nobody is in two buildings at
once, and a person's time is a resource the whole organization shares. The
reference site now brings its own staff. Recorded because it is a property of the
model that is easy to mistake for a bug when a seed or an import hits it.

**2. Two of the seven category colours were invisible.** `category_colour` is a
seven-value enum; `CATEGORY_TINT` in `schedule-board.tsx` had five. `teal` had no
entry and fell through to `DEFAULT_TINT`, which is blue, and `violet` pointed at
`--accent` — the same near-grey as `slate`'s `--surface-muted`. **Seven
categories rendered as four**, and a club colour-coding Competição and
Hidroginástica saw one colour. Nothing failed; the fallback hid it. Fixed:
`--category-teal` and `--category-violet` are real tokens in both themes now, and
the map covers every enum value.

**3. The main seed leaked Sunday onto the reference grid.** `seed.ts` applies its
own `SLOT_GRID` to every facility, so the second run added three Sunday rows to a
site whose reference document has no Sunday. Fixed by excluding the reference
facility — it owns its own grid.

### Criterion 9 — category contrast on the compact grid, measured

Computed from the tokens in `globals.css`, both themes. The cell is `bg-<token>/10`
with a `border-<token>/40`; the group name is `text-foreground`, the instructor
line `text-foreground-muted`.

*Measured at the 10% fill this section was written against. The fill was raised
to 15% on the strength of it — see the note below the table for the numbers that
ship.*

| tint | light: name / instructor | dark: name / instructor |
|---|---|---|
| slate | 16.09 / 5.22 | 13.19 / 6.01 |
| blue | 16.43 / 5.33 | 12.20 / 5.56 |
| teal | 15.67 / 5.09 | 12.25 / 5.58 |
| green | 16.15 / 5.24 | 12.32 / 5.61 |
| amber | 16.34 / 5.30 | 12.20 / 5.56 |
| red | 15.61 / 5.07 | 12.91 / 5.88 |
| violet | 15.47 / 5.02 | 12.49 / 5.69 |

**Every value passes AA**, including the smallest — the instructor line at
compact density never drops below 5.02:1.

**But a finding worth a decision.** The *fills* are barely distinguishable from
one another: at 10% opacity the closest pair is 4.1 RGB units apart in light and
3.7 in dark, which is invisible. The colour signal actually lives in the `/40`
borders, where the closest pair is 23.5 (light) and 14.6 (dark) — blue against
teal being the tightest.

This is not an accessibility failure: every cell prints its group name and the
legend names each category in words, so colour never carries meaning alone. It
is a *usability* one — category colour is supposed to make a full grid scannable
and at 10% it hardly does.

**Closed 2026-09-04 — Rui chose to raise the fill to 15%.** The separation
roughly doubles (8.0 in light, 5.5 in dark, from 4.1 and 3.7) and every ratio
stays above AA; the worst pairing is now the instructor line on the palest tint
at 4.65:1 light and 4.99:1 dark.

**That is the ceiling.** Going darker takes `--foreground-muted` under 4.5:1, so
any further increase has to move the text token first rather than the fill.

### Criterion 8 — tenant isolation, done

Two new blocks in `packages/db/test/tenant-isolation.sql`, tests 9 and 10, both
passing. Test 9 asserts that org A sees none of org B's `lane`,
`facility_time_slot`, `partner`, `partner_contact`, `partner_agreement`,
`partner_group` or `booking_category` rows — the agreement most of all, since a
competitor reading another club's lane-hour rate is the worst single row in this
feature. Test 10 asserts the other half, which RLS does not cover: the composite
keys refuse a lane in another tenant's pool, a slot on another tenant's season, a
booking on another tenant's partner group, a `booking_lane` pointing at another
tenant's lane, and a `slot_id` borrowed from the neighbour's grid.

### Criterion 10 — i18n, clean

`pnpm i18n:check`: 1692 literal and 100 computed keys resolve across both
locales. `pnpm pt:check`: 1704 keys, no Brazilian forms, nothing left in English.

### Not done

- **Criterion 6 — the side-by-side PDF comparison.** The original Santo Tirso
  document is not in the repository and this environment has no browser, so the
  A3 export has not been laid beside it. This is the same gap POOLSE-54's
  criterion 2 records, and closing one closes most of the other.
  `packages/db/seeds/REFERENCE.md` says how to repeat the comparison and what to
  compare.
- **Criterion 11 — the reference document itself.** `REFERENCE.md` is the pointer,
  and it is honest that the PDF is missing: it names real instructors and real
  school classes, which is a GDPR decision rather than a storage one. Ask Rui.
- **Criterion 4 — expressiveness.** Everything the ticket's own BA section
  describes is expressible, and the seed proves it. Whether the *whole* sheet is
  cannot be claimed without the sheet. Nothing was fudged to make the seed load:
  the one refusal it hit is written up above as finding 1, and the rule was kept.
