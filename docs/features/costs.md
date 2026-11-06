# Costs — the ledger (POOLSE-182)

One place every euro the club spends can be read from, on *Custos* under Faturação (POOLSE-183). The schema is in `docs/data-model.md`, *The cost ledger*.

## What it does

A cost is an amount with a period. `allocate_cost` spreads it by day into `cost_month`, with rounding carried forward so the shares sum exactly. A civil year and an época are two windows over the same rows, and a window that cuts a month splits it by days.

| Cost | Where it comes from |
|---|---|
| Electricity, gas, metered water | Each `energy_invoice`, on its header period. Editing or archiving a bill re-allocates it. |
| A month with no bill yet | A tariff estimate, only for a supply (a meter with its own CPE/CUI) in a month no bill of that meter covers. Sub-meters stay in the per-tank report, because they are a slice of the supply's bill. |
| Salaries | `salary_months()`, read on demand and never stored. Monthly pay is amount × pay periods / 12; hourly is amount × weekly hours × 52 / 12. A rate with no hours is left out and counted. |
| Water, fixed costs, other | `cost_entry`. A recurring one generates occurrences up to today; one archived as *não pago* is never generated again. |
| Maintenance services | `cost_entry`, naming the avaria or the task done. |
| Materials | `inventory_purchase`. The stock rises in the same transaction and `unit_cost_cents` becomes the last purchase's. |
| Insurance | The policy's premium, over the policy's dates. |

Invoices and estimates are distinct on every row and are never summed without naming both.

## Who can do what

| | Owner, admin | Maintenance | Instructor, family |
|---|---|---|---|
| `GET /costs/months`, `GET /costs/window` | Yes | 403 | 403 |
| `POST /costs`, `POST /costs/:id/archive`, `PUT /costs/premiums/:policyId` | Yes | 403 | 403 |
| `POST /costs/maintenance-service`, `POST /costs/purchases` | Yes | Yes, answered with an id, never a total | 403 |

An Admin's figures leave the Owner's pay out, as every pay read does.

## Custos — POOLSE-183

`/dashboard/faturacao/custos`, owner and admin, read off `GET /costs/overview?ruler=civil|season&window=&vat=1`; the CSV is `export/route.ts` on the same read.

- **Two rulers over the same rows.** A civil year (at most five back) or a shared published época. Solid lines mark a civil year on the chart and dashed lines an época's start and end. The chart is always the last 24 months, whole; the tiles and the table follow the chosen window.
- **A window stops at today**, so a running year counts no pay not yet earned, and a month cut by the window counts its days.
- **Eight groups for nine kinds**: `other` reads with `fixed` as *Fixos e outros*, because a chart carries eight hues at most.
- **Three numbers, never one**: Faturado, Estimado, and Total (faturado + estimado). Salaries are always estimated, so *inclui N meses estimados* counts only months with another estimate.
- **Averages name their denominator**: months, hours taught (POOLSE-28's, across every recinto), alunos-mês (each active enrolment's days in each month, over that month's days) and m³ (energy and water only). A missing denominator is a sentence, and a volume missing on any pool withholds the m³ figure.
- **Comparison**: the previous window, over complete months with figures on both sides, paired by position. Under six such months it says so and shows none.
- **Tax**: sem IVA by default; *Com IVA* for every club, because no setting says whether a club recovers VAT.
- **The table and the CSV carry rounding forward**, so they equal the tiles to the cent.
- A kind whose module is off stays out, and an Admin's figures leave the Owner's pay out, said in words.

Not built: a site filter (one site per licence for now).

**Recording (POOLSE-189).** *Registar custo* on *Custos* takes water, fixed, a service and other, once or recurring, and lists what was typed; archiving a recurring one stops the months to come and keeps the past. A purchase is recorded on an inventory row, a service on an avaria, a premium on its policy. A cost is never edited: a mistake is removed and recorded again.
