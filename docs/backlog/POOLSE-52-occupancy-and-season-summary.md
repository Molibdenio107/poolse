# POOLSE-52 · Occupancy and the season summary

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Scheduling / Reporting · **Priority:** Medium

### PO — why this exists
Once the grid holds both turmas and parcerias, the club can finally answer the question it actually
has: how much of the water is sold, when is it empty, and how much of it is families versus
organisations. The reference club's mornings are almost entirely partnerships and its evenings
almost entirely turmas — a split that is invisible today because half of it cannot be recorded.

**Not in scope:** the dashboards module. This exposes the numbers through the API and shows one
summary on the facility page. Charts, trends over seasons and revenue reporting are later and
elsewhere.

### BA — rules and data
- **Expected headcount per booking**, in this order: the booking's `headcount_override` if set;
  otherwise, for a turma, its active enrolments; otherwise, for a parceria, the partner group's
  `participant_count`. A booking with none of those is zero and says so — a blank would read as
  "unknown" and be silently excluded from a percentage.
- **Occupancy is against capacity, and capacity can be absent.** `lane.default_capacity` is nullable
  by design (POOLSE-43). A lane with no capacity contributes to lane-hours but **not** to an
  occupancy percentage, and the percentage says how many lanes it could not account for. A figure
  that quietly treats unknown capacity as zero, or as infinite, is worse than one that admits its
  own coverage.
- **Lane-hours** is the honest unit and the one the club sells in: a booking over three lanes for 45
  minutes is 2.25 lane-hours. Available lane-hours come from the slot grid × lanes × open days, so
  "37% occupancy" means something a manager can act on.
- Figures are computed for: a booking, a slot, a lane, a pool, a facility, and the season.
- **Season summary on the facility page**: lane-hours sold, occupancy by day, occupancy by time band
  (manhã / tarde / noite), and the turmas-versus-parcerias split of both.
- Occupancy is computed over the **published** season's dated sessions, not the weekly pattern, so
  closures reduce it. A grid that says 80% while the pool was shut for two weeks is a grid nobody
  trusts twice.
- **Revenue is exposed, not displayed.** The API returns contracted partnership value alongside the
  occupancy figures so the dashboards module can split turmas from parcerias later. Nothing in this
  ticket renders money. Per POOLSE-47's open question, partnership billing is a separate flow from
  mensalidades and this ticket does not merge them.
- Time bands are `manhã` (before 12:00), `tarde` (12:00–18:00), `noite` (18:00 and after). Fixed
  rather than configurable: three bands nobody has asked to change, and a setting would be a screen
  to build and a value to translate.

### Dev — implementation notes
- **Every number is computed by Postgres.** The same rule POOLSE-42 established for money: a total
  arriving from the API is the total, and the web app formats it for the locale rather than working
  it out again. Two implementations of "lane-hours" is two answers.
- Lane-hours over a session: `duration_minutes / 60.0 * lane_count`. `numeric`, not float — it is a
  quantity that gets multiplied by a price.
- **Most likely to be got wrong:** double-counting a multi-lane booking's headcount. Thirty swimmers
  on a three-lane hidroginástica booking is thirty people and 2.25 lane-hours, not ninety people.
  Join through `class_session_lane` for lane-hours and **not** for headcount.
- Second: the denominator. Available lane-hours must exclude days the facility is closed and days
  disabled in its hours, or every club looks under-booked. Derive it from the same dated sessions
  view, not from `slots × lanes × 7`.
- Third: coverage. Report `lanesWithoutCapacity` alongside the percentage and render it, or the
  percentage is a number with a hidden asterisk.
- One endpoint, `GET /facilities/:id/occupancy?seasonId=`, returning the whole shape. Several small
  endpoints would each re-derive the denominator.
- The summary is a fixed window — one season, one facility — so it is exempt from pagination. Record
  it in CONVENTIONS.

### QA — test scenarios
- **52.1** Given a turma booking with 14 active enrolments and no override / When occupancy is read / Then its expected headcount is 14.
- **52.2** Given the same booking with an override of 10 / When read / Then it is 10.
- **52.3** Given a parceria booking whose group has 24 participants / When read / Then it is 24.
- **52.4** Given a booking with no enrolments, no group and no override / When read / Then it is 0 and is reported as such rather than omitted.
- **52.5** Given a booking over three lanes for 45 minutes / When lane-hours are read / Then they are 2.25.
- **52.6** Given that booking with 30 participants / When headcount is aggregated for the slot / Then it is 30, not 90.
- **52.7** Given a lane with no capacity / When facility occupancy is read / Then it contributes lane-hours, is excluded from the percentage, and is counted in `lanesWithoutCapacity`.
- **52.8** Given a two-week closure / When season occupancy is read / Then the sold lane-hours fall and the available ones fall with them.
- **52.9** Given a weekday disabled in facility hours / When available lane-hours are read / Then that day contributes none.
- **52.10** Given a season with both turmas and parcerias / When the summary is read / Then the split is reported for lane-hours and for headcount, and the two halves sum to the total.
- **52.11** Given a booking at 11:45 / When banded / Then it is `manhã`. Given one at 12:00 / Then `tarde`. Given one at 18:00 / Then `noite`.
- **52.12** Given a draft season / When occupancy is requested for it / Then it is computed from its bookings but clearly labelled as a draft, or refused — decide and record which.
- **52.13** Given the same figures / When computed by the API twice / Then they are identical, and the web app performs no arithmetic on them.
- **52.14** Given an instructor / When they read occupancy / Then it is allowed; given they read contracted partnership value / Then it is refused.
- **52.15** Given tenant A's occupancy / When tenant B requests it / Then nothing is returned.
- **52.16** Given pt-PT and en / When the summary renders / Then every label, the three time bands and the percentage formatting follow the locale.

### Acceptance criteria

1. Expected headcount resolves override → enrolments → participant count → zero, and zero is reported rather than omitted.
2. Lane-hours are the unit; a multi-lane booking multiplies lane-hours and never multiplies headcount.
3. A lane with no capacity contributes lane-hours, is excluded from any percentage, and is counted and shown as uncovered.
4. Available lane-hours exclude closures and disabled weekdays.
5. Occupancy is available per booking, slot, lane, pool, facility and season.
6. The facility page shows a season summary: lane-hours sold, occupancy by day, occupancy by time band, each split turmas versus parcerias.
7. Occupancy is computed over the published season's dated sessions, so closures reduce it.
8. Every figure is computed in Postgres; the web app formats and does not calculate.
9. Contracted partnership value is exposed through the API for the later dashboards module and is rendered nowhere in this ticket.
10. Reading contracted value is owner/admin; reading occupancy is not restricted.
11. The summary's pagination exemption is recorded in CONVENTIONS.
