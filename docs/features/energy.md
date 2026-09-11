# Energy

Meters and what they read — slices 5.1 and 5.2. **Energia** is its own entry in the
navigation: one screen with every site and its meters, so the month's readings are one job
across the whole club rather than a visit to each site page. The same panel also sits on
each site's page, for a technician who is already looking at the site. Each meter has its
own page with the consumption chart, the reading form and the record; Voltar returns to
whichever of the two the meter was opened from.

## Meters

A meter belongs to a site and optionally serves one tank. It has a name (unique per site
among live meters), what it feeds (`total`, `pump`, `heating`, `lighting`, `other`), a
unit (free text, default `kWh`), and **what a value means** — `reads`:

- `cumulative_index` — the number on the dial, ever increasing. Consumption is the
  difference between two readings. An optional **starting index** is what the first delta
  is measured from; with none, the first reading yields no consumption and the screen says
  "first reading" rather than showing a zero.
- `interval_consumption` — each value is already a consumption (a monthly bill). Nothing
  is subtracted. Such a meter may not carry a starting index (CHECK).

`reads` is chosen when the meter is created and **cannot be edited**: changing it under a
year of readings would make every one of them wrong at once. A meter set up wrong is
retired and made again.

**Replacing a dial**: create the new meter with `replacedMeterId` set. The old meter is
retired in the same transaction (its readings and page stay; its form is gone), which is
what frees its name for the replacement. The new page says which meter it replaced.

Owner and admin define meters and retire them; every management login (owner, admin,
instructor, maintenance) records and removes readings; any member reads.

## Readings

One figure per meter per instant — the key is `(organization_id, meter_id, taken_at)`,
with no surrogate id (hypertable-shaped; see `docs/data-model.md`). `taken_at` is required
and defaults to now on the form; the month it lands in is the point of the figure.

**A dial does not run backwards.** A trigger refuses a cumulative reading below the
previous live reading (or the starting index) or above the next one, and carries the
neighbouring figure in its DETAIL (`energy_index_backwards|<previous>|<value>`,
`energy_index_ahead|<next>|<value>`). The API turns that into a 409 with
`energyIndex: { neighbour, value }`, and the form says "below the previous reading, which
was 41 235". An interval meter is not judged.

A reading is **removed by archiving** (`archived_at`), never edited: it is a claim about a
moment. An archived reading leaves the series, so the corrected figure typed against the
same instant revives the row and is judged against its new neighbours. A live reading at
the same instant is a 409 (`reading_duplicate`), not an overwrite.

## Consumption

Derived in SQL, once, in `energy.repository.ts` (`CONSUMED`): the value itself for an
interval meter; `value − lag(value)` over live rows, falling back to the starting index,
for a dial. **Attributed to the reading that closes the interval** — a dial read on
1 August and 1 September yields one figure, filed under September, because a reading on
the 15th spans two months and the database cannot know the split. The chart's caption says
so.

The meter page shows the last twelve calendar months in the **site's timezone**, every
month present; a month with no closing reading is null and drawn as a labelled gap, not a
zero-height bar. The figures are always in a table under the chart.

## Not built

- Tariffs and cost (5.3), comparison and correlation with temperature (5.4).
- TimescaleDB conversion — deferred until automated feeds exist; see the data model.
- Import of readings from a spreadsheet; the `source` column (`manual | import | feed`)
  is reserved for it.
