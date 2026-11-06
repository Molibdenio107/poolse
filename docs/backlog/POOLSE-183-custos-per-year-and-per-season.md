# POOLSE-183 · *Custos*: what the club spent, by kind, per civil year and per época on the same chart, with the averages that make a year and a ten-month season comparable

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Finance / Dashboards · **Priority:** Medium (pilot) · **Depends on** [POOLSE-182](./POOLSE-182-cost-ledger-and-month-allocation.md), [POOLSE-28](./POOLSE-28-heating-cost-per-lesson-hour.md), [POOLSE-66](./POOLSE-66-role-aware-dashboard.md) · **Unblocks** [POOLSE-184](./POOLSE-184-cost-suggestions-as-rules.md)

### As built (06-11-2026) — wins over what follows

`GET /costs/overview` replaces the ticket's two reads, so the page and its CSV cannot differ. `apps/api/src/costs/cost-overview.ts` is the arithmetic, tested on its own.

- **Eight groups:** the ledger has nine kinds, so `other` joins `fixed` as *Fixos e outros*.
- **Rule 3:** salaries are always estimated, so the sentence counts months with another estimate.
- **Rule 7:** *Com IVA* for every club (Rui). No VAT-recovery setting exists.
- **Rule 8:** energy, salaries and materials link to their pages. Water, fixed costs, maintenance services and premiums have no recording screen yet.
- **A running window stops at today**, and a comparison leaves out a running month.
- **Chart:** `StackedMonthBars` gained `rulers` and `showTable`, rather than adding Recharts. Colours `--chart-4…8`, run through the dataviz validator in stack order. Three settled brand colours sit under its chroma floor and were kept, with the legend, tooltips and table naming every kind.
- **Left out:** the site filter (dev note), since a licence covers one site.

### PO — why this exists

Rui, 05-11-2026: *"tell the owner the average costs of everything together but separated at the same time per civil year and per season."*

Energia shows kWh and one meter's euros; Salários shows a monthly figure; nothing shows the club what a year costs. The owner reads a season (the club's year) and the accountant reads a civil year; the screen has to give both from the same numbers, with the split by kind visible and the "together" figure labelled for what it is.

**Not in scope:**
- Revenue, margin, break-even per turma.
- Per-tank cost beyond POOLSE-28's existing report, which this screen links to.
- Suggestions (POOLSE-184).
- Export beyond CSV of the month table.

### BA — rules

1. **Where**: *Custos* under Faturação (owner and admin only; the page is absent from an instructor's or maintenance's menu, and the URL answers 403). Added to the Ctrl+K palette (standing AC).
2. **One chart, two rulers.** Stacked bars per month by kind (electricity, gas, water, maintenance service, materials, insurance, salaries, fixed), 24 months by default; civil-year boundaries as solid lines, época boundaries as dashed lines with the season's name. A toggle sets which ruler the totals below follow: *Ano civil* or *Época*.
3. **Totals under the chart**, per window: one tile per kind, a *Faturado* tile, an *Estimado* tile, and *Total (faturado + estimado)* — three numbers, never one. A window with any estimate says *inclui N meses estimados*.
4. **Averages**, per window, each with its denominator in words: *por mês* (total ÷ months in window, partial months counted by days); *por hora de aula* (total ÷ taught hours in the window, from POOLSE-28's denominator); *por aluno-mês* (total ÷ Σ active enrolments per month); *por m³* for the pool kinds only. A missing denominator shows a sentence, not a zero (the POOLSE-28 rule).
5. **Comparison**: the previous window of the same ruler beside each tile, as a difference and a percentage; absent when the previous window has fewer than 6 months of data, said in words.
6. **The month table** below: one row per month, one column per kind, basis marked (an estimated cell in italics with a tooltip that explains and a legend that informs), CSV export.
7. **Tax view**: amounts without VAT by default; a switch *com IVA* for every club (Rui, 06-11-2026). No VAT-recovery setting exists, and none is added.
8. **Nothing on this page is editable.** Each kind links to where it is recorded (Energia, Salários, the request, the policy).

### Dev notes

- `GET /costs/months?from&to&facility` → `{ months: [{ month, byKind: { kind: { invoiced, estimated } } }], windows: { civil: [...], season: [...] } }` from `cost_month`; `GET /costs/summary?ruler=civil|season&window=` for the tiles. Both owner/admin; the facility filter is the site switcher's.
- Denominators: taught hours from the POOLSE-28 repository (same function, wider window); aluno-mês from `enrollment` live days per month; m³ from the pool's volume (null → sentence).
- Charts: Recharts stacked bar, `dataviz` skill for the kind palette; the eight kinds need a categorical set that survives dark mode and colour-blindness — kind is also written in the legend and the table, never colour alone.
- Trap (energy 5.4a): the comparison with the previous year only counts months present in both; carry that rule.

### QA

1. Given 24 months of ledger with an época 15-09 → 31-07, when *Época* is chosen, then the tiles cover 15-09 → 31-07 and the chart draws the dashed lines at those dates; *Ano civil* moves the tiles to 01-01 → 31-12 with the same bars.
2. Given March is estimated on one sub-meter, then the window says *inclui 1 mês estimado* and the *Estimado* tile is non-zero.
3. Given no taught hours in August, then *por hora de aula* for a window of August alone is a sentence.
4. Given an admin, then the page opens; an instructor's token → 403 and no menu entry; maintenance → 403.
5. Given Ctrl+K, then *Custos* is found.
6. Both themes, snapshot of the chart and tiles; every kind readable in the legend without colour.
7. Given the CSV, then its totals equal the tiles to the cent.

### Acceptance criteria
- [x] *Custos* page with the two rulers, tiles per kind, faturado / estimado / total, four averages.
- [x] Previous-window comparison with the 6-month rule.
- [x] Owner/admin only; palette entry; CSV.
- [x] QA 1–7 green.
