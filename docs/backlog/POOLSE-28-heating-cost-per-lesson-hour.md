# POOLSE-28 · Heating cost per lesson hour

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Energy / Dashboards · **Priority:** Medium — the strongest argument for the four-module product
**Borrowed from:** nobody. Every product that tracks pool energy reports kWh and euros; none normalises against a pool-specific denominator, because none of them holds the class schedule.

### PO — why this exists

Every energy product tells a pool it used 14,000 kWh last month. None tells it that a Tuesday 07:00 turma with four bathers costs €38 an hour to heat while the Saturday morning turma costs €4 per bather. That second number decides which classes are worth running, and only Poolse can compute it because only Poolse holds both the meter and the schedule. Owners and Admins benefit; it is the demo moment for the whole product. Medium priority, shipping with the energy module.

**Not in scope:** recommending which turmas to cancel; forecasting; automated tariff imports from the utility; hardware or meter installation.

### BA — rules and data

- Three normalisations are required, all derived from the same joined dataset: **per turma hour** (cost ÷ scheduled turma hours in the window), **per bather** (cost ÷ recorded attendances), **per m³ of basin** (cost ÷ basin volume).
- The per-bather denominator uses **recorded attendance**, which includes reposição guests (POOLSE-21 AC 8) — they were in the water and heated by the same energy. This is a deliberate divergence from the enrolled-student count; state it on the report so the two figures are not mistaken for each other.
- Occurrences cancelled by a closure (POOLSE-31) contribute zero turma hours and zero bathers, but the basin may still have consumed energy. The report must not divide by zero or silently drop that consumption; it is attributed to the period as unallocated.
- Basin physical data required: volume in m³, surface area, and whether it is heated. A basin without volume cannot produce the per-m³ figure and must say so rather than showing a blank.
- **Tariff periods** (tarifa bi-horária / tri-horária) map time-of-day bands to a price per kWh, with effective-from dates. Cost is computed by allocating each consumption interval to its band; a naive average price produces a wrong number for early-morning classes, which is exactly the case the report exists for.
- Tariff bands shift with Portuguese summer/winter time changes and with the legal schedule. Model bands with effective date ranges and evaluate in the tenant's local time, not UTC.
- Figures are reported per basin, per turma, per instructor slot and per period, and must be comparable across periods — the same denominator definition in every period, or a comparison is meaningless.
- Where sub-metering does not isolate heating, the report states the derivation and names the meters it used. It must not present a derived figure with the same visual confidence as a measured one.
- Weather data is retained alongside consumption so a cold week is explicable. It is context, not a correction — no weather normalisation is applied to the headline figures.
- A turma's detail view shows its own energy cost beside its occupancy.
- **Open:** is sub-metering of the heating circuit realistic at the pilot pool, or does v1 derive heating from the main meter? This determines whether AC 5's "where sub-metering exists" branch is the primary path or the fallback, and whether the pilot's headline number is measured or estimated.

### Dev — implementation notes

- Storage: meter readings are a TimescaleDB hypertable partitioned on time, keyed (tenant_id, meter_id, ts). Every query is tenant-scoped, like every other table.
- Do not join raw readings to schedule occurrences at query time. Build **continuous aggregates** at a fixed bucket (15 minutes is the natural grain for tariff bands and lesson slots) carrying kWh and, where the tariff is resolvable at rollup time, cost. The dashboards read the aggregate, never the raw hypertable.
- The occurrence side must also be pre-shaped: a materialised table of (tenant, occurrence, basin, start, end, turma, instructor, attendance_count) refreshed as attendance is recorded. Joining the aggregate to a live view that itself joins enrolments, closures and attendance is where this report becomes unusable.
- The join is a **time-range overlap**, not an equality — a 15-minute bucket can straddle two occurrences. Allocate proportionally by overlap duration and be explicit about it, or the numbers will not sum to the period total.
- Tariff resolution is a shared function (band lookup by local timestamp and effective date range) used by the rollup and by any ad-hoc query. Two implementations will disagree on the DST boundary day.
- API: one reporting endpoint taking (scope, entity id, period, normalisation) and returning figures plus a provenance block naming the meters and whether heating was measured or derived. The provenance block is not optional — AC 5 depends on it.
- Permissions server-side: energy reporting is Owner/Admin. The turma detail view's cost panel is the same check — an Instructor viewing their own turma gets the occupancy but `403` on the cost endpoint unless the tenant decides otherwise, and that decision is enforced on the endpoint.
- i18n and theming: kWh, m³, currency and dates format by locale; per-bather and per-m³ labels are pt-PT and en keys. Charts must not carry meaning by colour alone — series need labels or patterns, and the tokens must be legible in light and dark against a chart background.
- Most likely to be got wrong: the DST changeover day. Twenty-three- and twenty-five-hour days break both the tariff band allocation and the per-hour denominator, and the error is small enough to look plausible.

### QA — test scenarios

28.1 Given a basin with meter data and a scheduled turma / When the per-turma-hour figure is requested / Then it equals the allocated cost divided by scheduled turma hours in the window, to the stated rounding.
28.2 Given a turma with 8 enrolled students, 6 present and 1 reposição guest / When the per-bather figure is computed / Then the denominator is 7 recorded attendances, and the report states that guests are included.
28.3 Given an occurrence cancelled by a closure (POOLSE-31) / When the period report runs / Then it contributes zero turma hours and zero bathers, the consumption is shown as unallocated, and no division by zero occurs.
28.4 Given a basin with no volume recorded / When the per-m³ figure is requested / Then the report says the figure is unavailable and why, rather than rendering blank or zero.
28.5 Given a tarifa bi-horária with a band change at 08:00 / When a 07:00–08:30 turma is costed / Then the two halves are priced at their respective band rates, not at an average.
28.6 Given the March DST change / When a 24-hour period report runs on that day / Then band allocation and the per-hour denominator use the 23-hour local day and the total reconciles with the metered kWh.
28.7 Given the October DST change / When the same report runs / Then the repeated local hour is counted once in the denominator and its consumption is not double-attributed.
28.8 Given a 15-minute bucket straddling the end of one turma and the start of the next / When consumption is allocated / Then it is split proportionally and the two turmas' figures sum to the bucket total.
28.9 Given a pool with no heating sub-meter / When the heating figure is shown / Then the provenance block names the meters used and states that the figure is derived, and the UI does not present it as measured.
28.10 Given an Instructor token / When it requests the energy cost endpoint for its own turma / Then the decided permission rule is enforced server-side, and a Student or EE token receives `403`.
28.11 Given a year of readings for a busy tenant / When the per-basin period report is requested / Then it is served from the continuous aggregate within the dashboard's performance budget, with no scan of the raw hypertable.
28.12 Given the pt-PT and en locales in light and dark mode / When the turma detail cost panel and the comparison chart render / Then units, currency and dates are localised, series are distinguishable without colour, and contrast passes in both themes.

### Acceptance criteria

1. Join the energy time-series to the class schedule and the basin's physical data.
2. Report cost and consumption normalised three ways: **per turma hour**, **per bather** (using attendance), and **per m³ of basin**.
3. Figures are available per basin, per turma, per instructor slot and per period, and are comparable across periods.
4. Tariff periods (tarifa bi-horária / tri-horária) are modelled so cost, not just kWh, is correct.
5. Heating is separable from other consumption where sub-metering exists; where it does not, the report says which meters it is derived from rather than implying precision it lacks.
6. A turma's detail view shows its own energy cost alongside its occupancy — the two numbers that decide whether a class is worth running.
7. Weather data is retained alongside consumption so cold-week spikes are explicable rather than alarming.

**Note:** this is the number no competitor can compute, because none of them holds both the meter reading and the lesson schedule. Worth treating as the demo moment for the whole product.
