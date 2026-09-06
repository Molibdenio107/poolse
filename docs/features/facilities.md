# Facilities — sites, tanks and lanes

Schema in `docs/data-model.md`.

## Who can do what

| Action | Roles |
|---|---|
| Read a site, its tanks and its lanes | everybody |
| Create, edit or archive a site or a tank | owner, admin |
| Read the inventory | everybody |
| Change the inventory | owner, admin |

Knowing whether there are enough pranchas for a class is not privileged. Changing anything
is.

A subscription covers one site; `organization.max_facilities` defaults to 1 and a trigger
enforces it. A club with two sites buys a plan with two.

## Espaços

The non-pool parts of a site — balneários, sala de máquinas, arrecadação, receção, exterior —
appear below that site's tanks in two places: inside each card on Instalações, and on the
site's own page. Each has a cleaning log and a list of open issues. They have their own page:
[spaces.md](spaces.md).

An inventory item's location is now a space rather than free text; the old `location` column is
still present until it is dropped separately.

## A tank

Name, kind (indoor or outdoor), and optionally its measurements: length, width, **min
depth**, **max depth**, volume in litres.

Volume is offered from the four measurements — `length × width × (min + max) / 2 × 1000` —
and stays overridable, because not every pool is a box.

Lanes are rows, not a count. A tank always has at least one; a tank with no lane markings
has exactly one, named after the tank.

## Max capacity

**How many swimmers are allowed in the water at once, across every turma.**

- Left empty means no ceiling is set, and **nothing is enforced**. The tank card says so in
  words rather than showing a dash.
- When set, the turmas sharing that tank at overlapping times may not, between them, promise
  more places than it holds. Enforced by a database trigger, so it holds against two people
  saving at the same moment.
- Refused as a 409 naming the figures: *"the tank holds 40 and this slot already has 32, so
  this class can take 8."*
- Both ways into a slot are covered — the turma form and dragging a class onto the calendar.
- A turma with no capacity recorded neither counts nor blocks. Partnership bookings count as
  zero, because they carry no headcount.

This is one of three capacity rules and they compose rather than override:

| Rule | Question |
|---|---|
| `class_group.capacity` | How many places does this turma promise? |
| `lane_level_capacity` | How many of this level fit in one lane? |
| `pool.max_capacity` | How many bodies are in the water at once? |


## Water quality

Readings live on the tank's own page: `/dashboard/facilities/pools/<id>`.

| Action | Roles |
|---|---|
| Read the analyses and the trend | everybody |
| Record one analysis by hand | owner, admin |
| Import a water log or an analysis report | owner, admin |
| Archive an analysis | owner, admin |

Nine metrics — pH, temperature, free and combined chlorine, total alkalinity,
calcium hardness, cyanuric acid, turbidity, salt. The **unit is the server's**, from
`METRIC_UNITS`: a file cannot talk a club into recording pH in ppm.

Five of them have a published band a Portuguese municipal pool is inspected against; the
other four get no invented one. A reading outside its band raises the "shut the pool?"
notice, which offers and never acts.

### Importing a log or a report

**Import an analysis report** sits in the Water quality card, directly under *Record an
analysis* and always visible — the two are alternatives to each other, so neither is buried
inside the other. A file dragged anywhere on the pool's page opens the same flow.

Two kinds of file are accepted, and **the file type decides which reader sees it**:

- **A spreadsheet** (`.xlsx`, `.csv`) — the club's own log. Upload → map the columns →
  check → commit, the same four steps as the register, the store room and the wall
  timetable.
- **A report** (PDF, or a photograph as `.png` / `.jpg` / `.webp` / `.gif`) — a laboratory's
  document, which has no columns to map. It goes to an import agent that extracts the date,
  the tank and the readings, and lands on the same preview two steps later.

The two are ways *in*, not two pipelines: what the operator is shown and what gets written
come from one path either way.

#### Report parsing is off unless it is switched on

Two switches. `WATER_REPORT_AI_ENABLED=true` says the club wants it, `ANTHROPIC_API_KEY`
says it can work. With either missing, dropping a PDF says **"Report parsing is not enabled
yet"** — a sentence, not an error — and points at the spreadsheet import and the manual form.

- **Only the document is sent.** No club name, no tanks, no previous readings.
- **Nothing extracted is written.** Every value goes through the same validation a
  spreadsheet's does and appears on the same preview, where a person ticks the rows.
- **A decimal comma is preserved** as written; the API is the only place that turns text
  into a number.
- **The original file is not kept.** The ticket asked for it; file storage is still a
  deferred decision, and this would be its fourth caller alongside the three photo controls.

The parser sits behind `AnalysisReportParser` so the Excel mapping can share it later.

- **The file is read on the Next server and never leaves it.** What crosses to the API is
  rows in Poolse's own field names.
- **Headers are matched by synonyms, pt and en.** No model call. "Cloro combinado" and
  "Cloro livre" are told apart, and a lone "Cloro" is read as the free one.
- **A row is one analysis**, with a column per metric; the wide row becomes several values.
- **Dates** are read as ISO, `dd/mm/yyyy`, or an Excel serial. **Readings** accept the
  Portuguese comma: `7,4` is 7.4. A thousands separator is refused rather than guessed,
  because `1.234` means two different numbers in the two locales.
- **An out-of-range reading imports.** It is the reason the log exists. Only a value that
  is not a number, a date that is not a date, or a row with no readings is refused.
- **A row naming another tank is refused**, so a club's all-tanks export cannot be imported
  into whichever tank happened to be open.
- **A repeated moment is a warning, not a refusal** — a re-uploaded month that overlaps the
  last one is ordinary, and being told is enough.
- Nothing is written until the operator commits; a preview writes nothing at all.


## Inventory

`/dashboard/facilities/inventory`. An item belongs to a **site** and says which tanks it
serves; it is not a property of any one pool.

Each item carries a name, a count, an optional unit, and a **location** — free text saying
where it belongs, suggested from what this site already uses. Deliberately not a rooms
entity: a club knows "balneário masculino" as a word, and a rooms table would mean creating
one before you can add a mop.

The importer reads a `Localização` column into that field. Before round 5 those words
belonged to the tank matcher, which claimed the column and then failed to resolve room
names as tanks — mapped, refused, and reading as a broken importer.

The suggestion list is every place name this site already uses, drawn from the store room
and the lost-property box together, sorted with accents folded so "armário" and
"Arrecadação" sit where a person expects them.

## Lost and found

The same screen, in a card that is **collapsed by default** — the store room is what
somebody opens this page for. The header carries the count of items still waiting, so the
reason to open it is visible while it is shut.

| Action | Roles |
|---|---|
| Read the list | everybody |
| Record something found | owner, admin |
| Mark as returned | owner, admin |
| Remove an item | owner, admin |

An item is a description, where it was found, the date, notes, and optionally **whose it
is**. Naming a student stamps `student_notified_at` — the record the mobile app will read
when the notifications subsystem lands in phase 3.0. That stamp outlives the item being
returned, because "we told them" and "they collected it" are different facts.

The schema keeps two pairs honest rather than trusting a code path: a returned item always
has a returned date and vice versa, and nobody can be marked as notified about an item with
no owner.

There is no photo control. File storage is deferred, and the three existing photo controls
are the ones that get one when it lands.
