---
paths:
  - "apps/api/src/{energy,weather}/**"
  - "apps/web/src/app/**/energy/**"
  - "packages/rules/src/energy-*.ts"
  - "apps/web/src/**/energy*.ts"
  - "apps/web/src/components/{consumption-bars,stacked-month-bars}.tsx"
  - "apps/web/src/app/**/cost-per-use-panel.tsx"
---

# Energy

Read [`docs/conventions/energy.md`](docs/conventions/energy.md) before touching meters, bills, tariffs or their comparisons.

- `energy_meter.reads` says what a value means, and consumption is derived from it once, in SQL.
- The Energia page opens on a folded *Importar fatura* card and the club's dashboard (`GET /energy/summary`), and a meter says what it measures.
- Outside air temperature is stored context, and it never corrects a figure.
- A comparison compares only the months that have both years, and consumption and cost are never one sentence.
- What a tank costs per hour taught in it is a month divided by a month, and the screen says so.
- A meter with no fatura is costed by a tariff, and what comes out is an estimate that never touches a billed euro.
- A bill is filed whole and never edited; its two ways in share one form and one check.
