# Costs — the ledger (POOLSE-182)

One place every euro the club spends can be read from. There is no screen yet (POOLSE-183). The schema is in `docs/data-model.md`, *The cost ledger*.

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
