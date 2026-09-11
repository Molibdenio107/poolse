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

**The whole module is owner, admin and maintenance** — the menu entry, the site-page panel
and every route. Those three read and record; owner and admin define meters and retire
them. An instructor has no Energia at all: what running the site costs is not their
question, and the API refuses the routes to everybody else besides.

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

## Faturas — the bill as a record (5.3, first half)

An electricity bill is filed on the meter it bills. Three tables, read off two real EDP
documents: `energy_invoice` (the header), `energy_invoice_register` (what the dial said)
and `energy_invoice_line` (what was charged). `energy_meter` gained `cpe` and `serial`.

**What a bill is here.** One PDF bundles several faturas — electricity, Contribuição
Audiovisual, a services pack, débitos — so the record carries the *electricity* fatura
(number, ATCUD, subtotal, VAT, total) and the *document* (reference, `other_charges_cents`,
`document_total_cents`), with CHECKs that `total = subtotal + VAT` and
`document total = total + other charges`. The subtotal is every billed line before VAT,
taxes such as DGEG and IEC included; VAT is VAT alone. Registers are the dial — vazio,
ponta, cheias, super vazio, total — with previous/current index and kWh, and a register
may not run backwards (CHECK). Lines are every billed row, typed `energy | power |
discount | tax | other`, with the printed description, tariff period, date range,
quantity and unit, unit price (`numeric(12,6)`), amount, discount, total before VAT, and
VAT rate. Money is integer cents. Billed kWh is the sum of the energy lines, never a column.

**Two ways in, one pipeline.** *Registar fatura* on the meter page opens a form; *Importar a
fatura* on the same page reads a PDF or a photo with the parser and fills **that same form**,
every field editable. *Verificar* sends the form to `POST /energy/meters/:id/invoices`
without `commit` and shows the answer: field refusals (beside their box) and warnings —
lines that do not sum to the subtotal, registers that do not match the billed kWh, a CPE or
serial that is not this meter's, a period overlapping a filed bill. *Registar fatura* sends
the same body with `commit: true`; the API refuses (422, same field keys) anything the
preview called an error and writes whole, in one transaction. A bill for a meter with no CPE
stamps the bill's CPE and serial onto the meter — said on the preview first. The same
supplier + number twice is refused; archived, the number is free again.

**The parser** (`lib/energy-invoice.ts` + `lib/energy-invoice-agent.ts`) is off by default:
`ENERGY_INVOICE_AI_ENABLED=true` and `ANTHROPIC_API_KEY`. Its prompt describes the
*concepts* — the electricity fatura inside the document, the delivery point, the registers,
the billed lines with their VAT — never a supplier's layout, so Galp or Iberdrola read the
same way EDP does. Only the document is sent, and a bill carries the holder's name and NIF;
the form says so. Numbers are copied as printed ("15,41 €") and become cents in one place,
`draftToBody`, for the model's answer and a typed figure alike.

**Where.** The **Energia screen opens with the bill**: a PDF dropped anywhere on the page
(or chosen) is read, and the form unfolds with the meter carrying the bill's CPE already
selected — across every site in the club. A CPE no meter carries yet proposes *Criar um
contador a partir desta fatura*: on filing, a "Geral" dial with that CPE and serial is created
at the chosen site (one site means no question) and the bill lands on it, so the very first
bill of a new club has somewhere to go. *Preencher à mão* opens the same form empty. The
meter page has a *Faturas* section — period, number, kWh, €, €/kWh — each bill openable to
its registers and lines, and *Registar fatura* for that meter. A bill is not edited; it is
removed and filed again. Same roles as readings.

**The dashboard says what it cost.** `GET /energy/costs` sums the live bills by the month
each billing period ended in — twelve months, every month present, an empty one null — and
names the latest bill; the dashboard draws the euros as bars (same component as the kWh
chart, `money`), the year's total, kWh and bill count, and the latest bill's €/kWh. Absent
until the first bill is filed; owner, admin and maintenance only.

**Real samples.** Two real EDP PDFs live at `apps/web/test-fixtures/energy/private/`,
gitignored (names, NIFs, CPEs inside). The committed fixture in `energy-invoice.test.ts` is
the first sample's structure with an invented identity.

## Not built

- Tariffs and cost for meters without a bill, comparison and correlation with temperature
  (5.4). Cost for billed meters is a fact from the bill, above.
- Seeding a new club's history from the twelve months of consumption printed on its first
  bill — page 4 of an EDP document has them.
