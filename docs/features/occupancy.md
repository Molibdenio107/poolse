# Ocupação

A site's season in figures, on the **Ocupação** tab of its page (owner and admin).
The figures are POOLSE-52's, computed by Postgres in `occupancy.repository.ts`; the layout is
POOLSE-93's option B (Rui, 22-10-2026): three numbered questions, top to bottom.

0. **The season** and its period, in words ("Época 2026/2027 · 1 de setembro de 2026 a 31 de
   agosto de 2027").
1. **Quão cheia está a instalação?** Two gauges, each with a sentence saying what it is a share of.
   - **Água ocupada** — of the lane-hours the pool is open, the share with a turma, a parceria or
     another booking in a lane (`laneHourOccupancy`), with the lane-hours under it.
   - **Lugares ocupados** — swimmers over places, on the booked lanes that have a capacity
     (`seatOccupancy`). Lanes with no capacity are said here (*Parcial: N pistas sem
     capacidade*, with *Definir*); with none at all, the gauge is replaced by *Nenhuma pista tem
     lotação definida*.
   - With no slot grid, *Água ocupada* says so and sections 2 and 3 say there is no data yet.
2. **Onde há espaço para vender?** The five day × part-of-day cells with the most free lane-hours
   a week (`mostFree`, ranked by the server), each with its hours and % free. A cell the site
   never opens is never listed. *Abrir na grelha de pistas* opens the calendar's lane grid. With
   nothing free: *Não há horas livres esta época.*
3. **Quem usa a água, e quando?** One bar a weekday: turmas (`--chart-1`), parcerias (`--chart-2`)
   and other uses (a lane held for maintenance, which POOLSE-52 counts as occupied), with the
   day's percentage at the end; a closed day reads *Fechado*. The legend gives each one's share
   of the season and names *Livre*.

On a desk, 2 and 3 sit side by side; on a phone everything stacks in order.

## The endpoint

`GET /facilities/:id/occupancy` returns, beside POOLSE-52's figures:

- `seasonStartsOn`, `seasonEndsOn` — for the header line.
- `byDayBand` — all 21 cells (7 weekdays × manhã, tarde, noite). Each has available and sold
  lane-hours over the season, `openDays` (the days the cell was really open: its weekday, with
  slots in that part of the day, not shut by a closure or the site's hours, with a tank open),
  `freeLaneHoursPerWeek` (available − sold, floored at zero, ÷ `openDays`), `freePercent`, and
  the slots' `opensAt`/`closesAt`. A fixed window, so it is exempt from paging (CONVENTIONS).
- `mostFree` — up to five of those cells, most free a week first; closed cells and cells with
  nothing free never.

A cell's part of the day is read from a slot's start for what was available and from a
session's start for what was sold, as POOLSE-52 does; free is floored at zero so the difference
never reads as a negative.

## Known issue — *Lugares ocupados* over a season

`seatOccupancy` divides the swimmers of **every session of the season** by the places of each
booked lane counted **once**, so over more than a session or two it climbs past 100 % (the E2E
club reads about 3 000 %). POOLSE-93 was asked to keep the figures identical, so it is shown
as computed; the formula needs its own ticket.
