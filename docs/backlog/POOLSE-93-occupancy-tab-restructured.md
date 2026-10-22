# POOLSE-93 · Ocupação: a tab that says what it is telling you

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** UX redesign (layout settled: option B) · **Area:** Instalações / Reporting · **Priority:** Medium · **Depends on** [POOLSE-52](./POOLSE-52-occupancy-and-season-summary.md) (the endpoint and the figures, unchanged)

### PO — why this exists

Rui, 22-10-2026: *"the Occupancy page should be structured differently, it's a bit confusing what's happening in this page."*

The tab (`components/occupancy-panel.tsx`, `GET /facilities/:id/occupancy`) puts all of these on one surface:

- three figures with different units: *Vendido* in lane-hours, *Utilização* as a % of water, *Lotação* as a % of places;
- a hint about closures;
- a capacity warning;
- a turmas/parcerias table;
- a time-of-day split;
- a weekday chart.

Nothing says which figure answers which question. "Lane-hours" and the difference between *utilização* and *lotação* are never explained.

**The goal:** a reader who lands on the tab knows in five seconds how full the site is this season, where there is room, and what to do about it.

**Not in scope:**
- Changing how the figures are computed (POOLSE-52 stays the contract).
- Exports (POOLSE-54).
- Occupancy across several sites.

### BA — the layout (Rui chose option B, 22-10-2026)

Reference: Design artifact *Poolse · Ocupação mockups*, board **Opção B — Pergunta a pergunta**.

The tab reads top to bottom as three numbered questions. Each section's heading is the question it answers.

0. **Header line:** the season name and period (*Época 2026/27 · 15 set – 30 jun*), above everything.
1. **"Quão cheia está a instalação?"** Two figures side by side, each a ring gauge plus a plain sentence:
   - **Água ocupada** (today's *Utilização*): *"Das horas em que a piscina está aberta, 62 % têm uma turma ou parceria numa pista"*, with *1 840 de 2 960 horas-pista* under it.
   - **Lugares ocupados** (today's *Lotação*): *"Nas pistas marcadas, 71 % dos lugares têm um nadador."*
   - The capacity warning sits **inside** this figure, where it applies: *"Parcial: 2 pistas sem capacidade. Definir"*. It is no longer a separate block.
   - With no grid, or no capacity at all, the gauge is replaced by the existing *noGrid* / *noCapacity* text and its link.
2. **"Onde há espaço para vender?"** The **5 periods (day × manhã/tarde/noite) with the most free lane-hours per week**, ranked. Each row shows:
   - day and period (*Sexta, manhã*);
   - hours and % free (*07:00–13:00 · 59 % livre*);
   - free lane-hours per week (*21 h*).
   Closed periods are never listed. A link at the end: *Abrir na grelha de pistas →*, which goes to the lane grid (POOLSE-49) on that site's current week. With fewer than 5 periods that have free time, show what exists. With none: *"Não há horas livres esta época."*
3. **"Quem usa a água, e quando?"** One horizontal stacked bar per weekday (seg.–dom.): turmas, parcerias, and the free remainder, with the day's total % at the end.
   - A legend with the season totals: *Turmas (70 %) · Parcerias (30 %) · Livre*.
   - A closed day reads *Fechado* instead of a bar.
   - This replaces both *Por período* and the old *Por dia* chart (`occupancy-bars.tsx`).
4. **Footer:** the existing note about closures reducing both sides of the sum.

On desktop, sections 2 and 3 sit side by side. On a phone they stack in order 1, 2, 3.

**Removed:** the *Vendido* card (its number moves under Água ocupada), the turmas/parcerias table, and the three *Por período* cards.

### Dev notes

- **API: one addition.** Section 2 needs `byDayBand`: `{ weekday, band, availableLaneHours, soldLaneHours }[]`, the same query as `byDay` with `band` added to the `GROUP BY`. It's a fixed window (7 × 3), so it stays exempt from pagination; add it to the CONVENTIONS table row for `GET /facilities/:id/occupancy`. Ranking happens on the server: `free = available − sold`, top 5, excluding `available = 0`.
- **Per week:** the free lane-hours in section 2 are shown *per week* (season total ÷ number of weeks with that weekday open), because "21 h free on Friday mornings" is something a club can sell. Make sure the endpoint divides by the right count after closures.
- Section 3 uses the existing `byDay` (it already has turma/parceria split and `availableLaneHours`).
- Colours: turmas and parcerias keep `--chart-1` / `--chart-2`, as `occupancy-bars.tsx` uses today. The gauges use the primary-ink teal. All of it is checked with `check-contrast`, in both themes.
- Every gauge and bar gets an `aria-label` with its numbers. Colour never carries meaning alone: each bar ends with its %, and the legend names each colour.
- i18n: new keys for the three questions and sentences, in pt-PT and en. Remove the keys that are no longer used (`occupancy.sold`, `byBand`, `bandSplit`, `split`, `subject`, …).

### QA — scenarios

1. **Given** a site with a published season and bookings, **when** I open Ocupação, **then** I see the three numbered questions in order, with both gauges and their sentences.
2. **Given** 2 lanes without capacity, **then** *Lugares ocupados* shows *Parcial: 2 pistas sem capacidade* with a link to set it, and nothing else on the page repeats the warning.
3. **Given** the Friday morning band has the most free lane-hours, **then** it is first in *Onde há espaço*, with its hours, % free and free h/week.
4. **Given** Sunday afternoon is closed, **then** it never appears in the free list, and Sunday's bar in section 3 reflects only the open periods.
5. **Given** a fully booked season, **then** section 2 says there are no free hours.
6. **Given** no slot grid, **then** section 1 explains what's missing, sections 2 and 3 show the *unavailable* message, and nothing renders broken.
7. *Abrir na grelha de pistas* opens the lane grid for that site.
8. On a phone the sections stack, and nothing scrolls sideways. Light and dark both pass contrast.

### Acceptance criteria

1. The tab matches option B of the mockup (wording may be adjusted in review).
2. The same figures as before for the same data: a test compares `total`, `laneHourOccupancy` and `seatOccupancy` before and after.
3. `byDayBand` has an integration test, including closures and a closed band.
4. Both languages, light and dark, phone layout, contrast check, `docs/features/` occupancy page updated.

### Open questions

- None. Layout settled: option B (Rui, 22-10-2026).
