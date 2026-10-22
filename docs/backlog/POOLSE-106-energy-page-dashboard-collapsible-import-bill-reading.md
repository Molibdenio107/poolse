# POOLSE-106 · Energia: a small dashboard of running costs, a collapsible "Importar fatura", and bills read automatically

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Energy · **Priority:** Medium · **Depends on** slice 5.1–5.3 (meters, bills, the bill-reading agent), [POOLSE-28](./POOLSE-28-heating-cost-per-lesson-hour.md), [POOLSE-102](./POOLSE-102-cost-per-use-demo-data.md) (so the dashboard has something to show)

### PO — why this exists

Rui, 22-10-2026:
- *"'Energy' screen should display a small dashboard about the running energy costs of the facility (the whole club)."*
- *"Add a submenu 'import a bill' — this card should expand when the user wants to see what there is to register, and collapse when clicked again."*
- *"Enable the automatic bill reading (if there's no costs) along with the expected import functionality."*

**What exists.** `/dashboard/energy` lists every site with its meters, and puts the bill form **first, at the top**, with a PDF dropped anywhere read into it. Automatic reading of the bill is built (slice 5.3) behind two switches: `ENERGY_INVOICE_AI_ENABLED=true` and `ANTHROPIC_API_KEY`. Off, the page says so and the typed form works.

**On the cost (Rui's condition).** Automatic reading sends the PDF to the Anthropic API, so it costs **per bill read**, in the order of a few cents each at the default model, and nothing when nobody imports. There is no free mode of the current design. A free alternative is a text parser for the four or five Portuguese suppliers (EDP, Galp, Endesa, Iberdrola, Goldenergy), which is a few days of work and breaks whenever a supplier redesigns its bill. See open question 1.

**Not in scope:** tariff optimisation, or comparing suppliers.

### BA — rules

1. **The page opens on the dashboard**, the whole club, not one site:
   - **This month so far** and **last 12 months**: electricity, gas and water costs, each with the change against the same period last year.
   - **Cost per lesson-hour** and **per swimmer** for the club (POOLSE-28's figures, summed over sites), with the same ⓘ one-liners as Ocupação (POOLSE-93).
   - A 12-month bar chart of cost by month, stacked by energy kind; colour never alone, legend named.
   - **Missing bills:** a notice listing meters with no bill in the last 45 days, each linking to *Importar fatura*.
2. **Per site below the dashboard**, as today: meters, readings, bills.
3. **Importar fatura** is a `<details>`-style card in the page header area: collapsed by default with a summary line *"Importar fatura — PDF ou valores à mão"*. Click opens it; click again closes it. A PDF dropped anywhere on the page opens it. The open/closed state is remembered per browser (localStorage, wrapped in try/catch).
4. **Automatic reading is switched on** (Rui, 22-10-2026: accept the per-bill cost for the pilot). This ticket sets `ENERGY_INVOICE_AI_ENABLED=true` in the deploy configuration and the go-live checklist, keeps the form's note that the bill is sent as it is, and adds a monthly count of bills read to `/admin` so the cost stays visible. A free parser for Portuguese suppliers is a later ticket only if a club's volume justifies it.

### Dev notes

- The dashboard reads one new endpoint, `GET /energy/summary`, summing `energy_invoice` by month and kind across the club's sites, plus the POOLSE-28 figures. Fixed window (12 months × 3 kinds), exempt from pagination; add it to the CONVENTIONS table.
- Charts follow the `dataviz` guidance; the colours must stay distinct from the four reserved colour systems.
- The collapsible reuses the salary-file-panel pattern (12-10-2026) but stays *in the header*, because a bill is the page's first job.
- Role: Owner, Admin and maintenance see the dashboard; the money columns are withheld for maintenance, as the per-site cost tab does.

### QA — scenarios

1. **Given** the demo club (POOLSE-102), **when** I open Energia, **then** the dashboard shows this month, 12 months, cost per lesson-hour and per swimmer, and the chart.
2. **Given** a meter with no bill for 50 days, **then** it is listed as missing with a link that opens the import card.
3. **Given** the import card closed, **when** I click it, it opens; again, it closes; a reload remembers it.
4. **Given** a PDF dropped on the page, **then** the card opens with the preview.
5. **Given** `ENERGY_INVOICE_AI_ENABLED` off, **then** the form says so and typed entry works.
6. Maintenance role: dashboard without money figures.

### Acceptance criteria

1. The club-wide dashboard, the collapsible import card, and automatic reading switched on with its count on `/admin`.
2. Both languages, light and dark, contrast, phone layout.

### Open questions

- None. Automatic reading: switch on the existing AI reading (Rui, 22-10-2026).
