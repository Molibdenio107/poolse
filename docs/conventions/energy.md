# Energy

The full text of the conventions for meters, bills, tariffs or their comparisons. `CLAUDE.md` holds one line each; read this file before changing that area.

**`energy_meter.reads` says what a value means, and consumption is derived from it once, in
SQL.** `cumulative_index` is the dial and consumption is `value − lag(value)` over *live*
rows (falling back to `initial_index`); `interval_consumption` is the value itself. The one
definition is `CONSUMED` in `energy.repository.ts`, read by the list and the monthly rollup;
never subtract in TypeScript. `reads` is never edited — a wrong meter is retired and made
again, and a swapped dial is a new meter with `replaced_meter_id`. `energy_reading` has **no
surrogate id** — its key is `(organization_id, meter_id, taken_at)`, hypertable-shaped for
the day feeds arrive, and deliberately not a hypertable until then (decisions, 2026-09-11).
A dial running backwards is a trigger refusal carrying the neighbour in DETAIL, like
`pool_capacity`. `docs/features/energy.md`.

**The Energia page opens on a folded *Importar fatura* card and the club's dashboard (`GET /energy/summary`), and a meter says what it measures.** POOLSE-106. `energy_meter.carrier` (electricity | gas | water) splits bills; *this month* is the month a billing period ends in; cost per lesson hour and per swimmer are POOLSE-28's per-tank reports summed, never re-derived, and never added to billed euros; maintenance gets the dashboard with every euro withheld by the API. A chart of a few series is `StackedMonthBars` (`--chart-1/2/3`, legend, tooltip on focus, table view). Every automatic bill read is a row in `energy_invoice_read`, counted per month on /admin. `docs/features/energy.md`.

**Outside air temperature is stored context, and it never corrects a figure.** Slice 5.4b,
which closes POOLSE-28 AC 7. `facility_climate_month` caches the monthly mean per *site* — air
and not the water in `pool_analysis`, which sits at a setpoint all year and would correlate
with nothing. It is shown as a column in the chart's record and a sentence in the comparison
panel; **nothing is weather-normalised**, because a normalised headline is a model with
opinions wearing the clothes of a measurement. `heating_degree_days` is stored beside the mean
**with the base it used** (15.5 °C), so changing that constant later cannot silently re-mean a
year of history — nothing reads it yet, and it is stored because backfilling would mean
refetching everything. **`WEATHER_HISTORY_ENABLED` gates every call and is off by default**:
Open-Meteo's free tier is non-commercial, the URLs and key are env vars so the commercial move
is configuration, and both are on `docs/deploy.md`'s go-live checklist. A **daily cron**, never
a fetch on page load, one request per site for the whole window, upserted — the archive revises
recent days and `days_counted` says when a month is short. **The sweep reads tenants from
`poolse_platform` and facilities inside each tenant's own policy**; putting `facility` on the
platform grant would have been one line and is the kind of widening taken out loud.
`docs/features/energy.md`.

**A comparison compares only the months that have both years, and consumption and cost are
never one sentence.** Slice 5.4a. `monthlyConsumption` queries twice its window and pairs each
month with the row exactly `months` earlier — by index, never by recomputing a date, so there
is one definition of "the same month last year". **`yearOnYear` is computed over months where
both years have a figure** (and, for cost, where both were *priced*): a club with eighteen
months of readings would otherwise be told it had halved its consumption, and a rate
introduced this year would compare euros against nothing and call it a rise. A month with no
counterpart draws nothing — a missing counterpart is not a saving. **Where the implied unit
price moved** — each period's euros over its own kWh — the screen names both rates, so a
higher bill on flat kWh reads as the tariff it is; no threshold, because either the rate moved
or it did not. `ConsumptionBars` takes an optional `previous` per column and draws it
**outlined behind the solid bar**, so the two series differ in shape and not only in colour.

**What a tank costs per hour taught in it is a month divided by a month, and the screen says
so.** POOLSE-28, narrowed on 20 September 2026 — the ticket's 15-minute buckets, tariff bands
and DST arithmetic all need interval readings, and a club types **one figure a meter a month**.
`poolCostReport` in `cost-report.repository.ts` gives cost per lesson hour, per bather and per
m³ over twelve months. **A tank's cost is the meters whose `pool_id` names it** — the site's
"Geral" dial is never apportioned, because its kWh light the car park too, and a tank nothing
meters says so rather than reporting a share. **Taught minutes exclude `cancelled`, and
`class_group` is LEFT joined** — a parceria's hour heated the same water, and an inner join is
how partnership hours have silently vanished three times here. **A bather is an `attendance`
row with status `present`**; `late` was dropped by POOLSE-13 and a first draft that named it
typechecked and failed at runtime. **A month with consumption and no lessons is `unallocated`**
— not divided by zero, not dropped, and not redistributed onto the turmas that did teach. **A
turma's share is pro rata by hours with the last share taking the rounding**, so the parts sum
exactly to the whole, and its page reads that row rather than recomputing it. Owner and admin
only: what the bomba cost is maintenance's business, whether a turma earns its heating is not.
`docs/features/energy.md`.

**A meter with no fatura is costed by a tariff, and what comes out is an estimate that never
touches a billed euro.** 5.3's second half. `energy_tariff` is a €/unit rate **on the meter**
— not a club-wide named rate, because a club on two contracts has two answers — effective-dated
with one live rate at a time by the same gist exclusion as `staff_compensation`, `effective_to`
being the last day *at* that rate. `unit_price` is `numeric(12,6)`: the tariff is the
documented exception to integer minor units, and €0.1548 in cents is a 3% error in the module
whose purpose is cost accuracy. **A tariff may never be `actual`, by CHECK** — a euro that
happened is a fatura — so the derived cost is `estimated`, or `assumed` when the rate was.
**It is gross with no `vat_rate` and no standing charge**: nothing is invoiced from this
figure, and a potência contratada billed once for the whole ponto de entrega would be counted
again on every sub-meter behind it. `liveTariffJoin` in `tariffs.repository.ts` is the one
definition of "the rate that applied that day" and the cost is derived in SQL beside
`CONSUMED`, never in TypeScript. **A month any reading went unpriced is null, not a partial
sum** — a short bar and an incomplete bar look identical — and every aggregate reports its
coverage. **The estimate stays out of `/energy/costs`**, which sums faturas and must go on
summing only faturas; the two have separate sections and separate totals. Reading a cost is
the whole module, as a fatura already is; *setting* a rate is owner and admin.
`docs/features/energy.md`.

**A bill is filed whole and never edited; its two ways in share one form and one check.**
`energy_invoice` + registers + typed lines (5.3). `draftToBody` in `lib/energy-invoice.ts` is
the one place a printed "15,41 €" becomes cents — the model's answer and a typed figure
both pass through it — and `checkInvoice` on the API is the one place a bill is judged, read
by preview and commit alike. The parser (`energy-invoice-agent.ts`) is flag-gated and
supplier-agnostic: its prompt names concepts, never a layout. **Real bills never enter the
repo** — `test-fixtures/**/private/` is gitignored. `docs/features/energy.md`.
