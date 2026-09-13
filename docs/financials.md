# Financial rules

Applies to **every module that touches money**: student fees, staff salaries, energy,
maintenance, supplies, subscriptions, and anything added later.

Read this before writing a migration, an endpoint or a screen that stores, sums or
displays a monetary value. If a ticket conflicts with this document, stop and ask —
do not silently pick one.

---

## 1. Why this exists

Poolse will eventually estimate costs and earnings per day, month and year, for both
losses and gains, and will expose an agent that reasons over those numbers. Most of the
inputs are **optional** — an owner is never forced to enter every cost.

That means the hard problem is not the maths. It is knowing, for any figure on screen,
**where it came from and how much of the picture is missing**. Fix that in the data
model now and the forecasting layer is a reader over it later. Get it wrong and every
module has to be migrated.

**Deliberate non-goal for now:** no probabilistic simulation until there is real
history to draw ranges from. See §7.

---

## 2. Provenance — the core rule

Every stored monetary value carries a provenance:

| Value | Meaning | Example |
|---|---|---|
| `actual` | Happened. Invoiced, paid, metered. | An EDP bill for March |
| `contracted` | Known rate, not yet incurred. | A monthly salary, the rent |
| `estimated` | Derived by a documented model from other data. | Energy cost from last year's kWh |
| `assumed` | A guess — by the owner, by a default, or by the agent. | "Chemicals, about €200/month" |

Shared enum, created once, reused everywhere:

```sql
CREATE TYPE money_provenance AS ENUM ('actual', 'contracted', 'estimated', 'assumed');
```

**Never sum across provenances into one unlabelled figure.** A total that mixes actuals
and guesses must either be broken down, or labelled with its weakest component. This is
the rule most likely to be broken by accident — check it in review.

---

## 3. Three-point values

Any `estimated` or `assumed` entry may carry a range alongside its point value:

- `amount_cents` — the expected value, always present
- `amount_low_cents`, `amount_high_cents` — optional, nullable

Store the range from day one even where nothing reads it yet. It is the
optimistic / likely / pessimistic input any future simulation needs, and adding it
later means touching every money table.

Constraint wherever both are present:
`amount_low_cents <= amount_cents <= amount_high_cents`.

---

## 4. Money conventions

Non-negotiable, every table:

- `*_cents integer`. Never a float, never `money`.
- `currency char(3) NOT NULL DEFAULT 'EUR'`.
- `organization_id` on the row, composite FKs, RLS with `USING` **and** `WITH CHECK`.
- Effective-dated where the value changes over time (`effective_from` / `effective_to`
  plus a `gist` exclusion constraint against overlaps).
- `archived_at` soft delete. Financial history is never hard-deleted.
- `created_by` on every row. "Who changed this number" is always answerable.

`staff_compensation` (POOLSE-58) is the reference implementation.

---

## 5. The projection surface

Modules do **not** get read directly by dashboards, forecasts or the agent. Each one
feeds a single normalised projection:

```
financial_entry
  organization_id
  source_module        -- 'salaries' | 'fees' | 'energy' | 'maintenance' | ...
  source_id            -- row in that module
  direction            -- 'inflow' | 'outflow'
  amount_cents, currency
  amount_low_cents, amount_high_cents
  provenance
  period_start, period_end
  recurrence           -- one-off | monthly | yearly | per-class | ...
  category
```

One reader, one set of rules, one place to fix a bug. A new cost module ships by
feeding this view — not by adding a branch to the dashboard.

---

## 6. Missing data is normal, and must be visible

Nothing is mandatory. That is a product decision, not a gap.

- A missing value falls back to a **documented default**, tagged `assumed`.
- Every aggregate reports its **coverage**: "based on 4 of 7 cost categories",
  "11 of 14 staff have a rate set".
- Never render a confident total over partial data. An unqualified "€6.340/month" that
  quietly excludes three cost categories is worse than showing nothing.
- Unset categories are listed, not hidden, so the owner can see what improving the
  estimate would take.

---

## 7. Forecasting — staged deliberately

**Stage 1 (now).** Provenance, ranges, the projection surface, coverage reporting.
No forecast engine.

**Stage 2.** Deterministic scenarios: pessimistic / expected / optimistic, computed
from the three-point values already stored. Cheap, explainable, and an owner can act
on it.

**Stage 3.** Probabilistic simulation (Monte Carlo) over the same assumption objects,
**once there is enough real history to derive ranges from** — target at least one full
season of actuals per category.

The reason for the order: a simulation over invented ranges produces a precise-looking
answer with nothing behind it, and precision is exactly what makes people trust a
number. Garbage ranges in, confident garbage out. Stage 2 is honest about being three
guesses; a percentile fan chart is not.

Whenever a saved forecast exists it stores its **assumption set, seed and engine
version**, so any figure shown to an owner three months ago can be reproduced and
explained.

---

## 8. The agent

When the financial agent ships, it obeys these on top of everything above:

- It **reads** the projection surface. It does not query module tables directly.
- It **never invents a figure**. Every number it states traces to an entry, and it says
  which one.
- It states provenance in words: "this is a guess", "this is contracted", "this is from
  your bills".
- It states coverage before drawing a conclusion.
- Anything it writes lands as `assumed`, attributed to the agent, and requires explicit
  confirmation before it counts.
- It never presents a simulated figure in the same visual treatment as an actual one.
- It refuses to give tax, accounting or legal advice, and says so plainly.

---

## 9. Display rules

- Estimates and assumptions render visually distinct from actuals — muted, with a
  tooltip stating what they were derived from. The derived hourly rate on the salaries
  page is the pattern.
- Currency formatted by locale, pt and en.
- Never `0` where the answer is "not set". Use `—`.
- No monetary amount in a URL, a query string, a log line or a toast.
- Salary and cost data is Owner/Admin only unless a ticket says otherwise, enforced at
  route, endpoint and query level — not by hiding a menu item.

---

## 10. What already exists, and what does not — 13 September 2026

Stage 1 is **partly** built, and the gap is worth stating so nobody assumes otherwise.

| Piece | State |
|---|---|
| `money_provenance` enum | Built, in `1788991200000_money-provenance.sql` |
| Provenance + three-point range on `staff_compensation` | Built — the reference implementation |
| Coverage reporting on an aggregate | Built, on the salaries roll-up |
| Provenance on **every other** money table | **Not built.** `fee_plan`, `invoice_line`, `energy_invoice_line`, `student_fee` and the rest carry amounts with no provenance column |
| `financial_entry`, the projection surface | **Not built.** Nothing feeds it because it does not exist |
| Any forecast | Not built, and deliberately not — §7 |

The order matters. Retrofitting provenance onto the other money tables is a migration
per module and a decision per module about what each amount *is* — an `invoice_line` is
`actual`, a `fee_plan` is `contracted`, an energy estimate is `estimated` — and doing
that before `financial_entry` exists would be work with no reader. Doing it after means
the projection has to be written twice. **The next money slice builds `financial_entry`
and backfills provenance behind it**, with salaries as the first feeder because it is
already shaped for it.
