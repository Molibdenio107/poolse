# The reference schedule

> POOLSE-55, criterion 11. This file exists so the comparison can be repeated by
> whoever next changes the model.

Everything from POOLSE-43 to POOLSE-54 — lanes as rows, the facility slot grid,
draft seasons, bookings that are not turmas, parcerias, the lane grid, dragging,
the conflict rules, occupancy, the "sem professor" alerts and the exports — was
designed against **one real document**: the *Ginásio Clube de Santo Tirso*
2025/2026 timetable.

`../src/seed-reference.ts` rebuilds that document inside Poolse. Running
`pnpm db:seed` creates a facility called **Piscina Municipal de Santo Tirso**
containing it, and leaves every other facility in the organization alone.

## Where the original lives

**The original PDF is not in this repository.** It is the club's own document and
nobody has decided whether it belongs in version control — it names real
instructors and real school classes, which is a GDPR question rather than a
storage one.

**Ask Rui for it before repeating the comparison**, and if it is committed later,
put it beside this file as `santo-tirso-2025-2026.pdf` and replace this section
with the filename.

Until then, the machine-readable statement of the reference is
`seed-reference.ts` itself plus the BA section of
`docs/backlog/POOLSE-55-reference-schedule-seed.md`, which lists the slot times,
the partner entities and the class names the sheet contains.

## How to repeat the comparison

```bash
pnpm db:up          # if it is not already running
pnpm db:migrate
pnpm db:seed        # idempotent; run it as often as you like
pnpm dev
```

Then open the lane grid for **Piscina Municipal de Santo Tirso** and, beside it,
`/dashboard/calendar/print?local=<facilityId>&papel=a3` — the A3 landscape sheet
from POOLSE-54. Compare against the original page by page: slot order, lane
order, the same groups in the same cells, the weekend block, the legend.

Anything the model cannot express goes in the **ticket**, not in the seed. A seed
that quietly works around the one case the model gets wrong removes the only
signal there was — which is the whole reason POOLSE-55 is the last ticket and is
allowed to fail.

## What the seed deliberately contains

| Feature it proves | Where |
|---|---|
| A 6-lane tank **and** a laneless pool | `Tanque Principal`, `Tanque de Aprendizagem` |
| The irregular weekday grid, including the 11:45→14:45 hole | `SLOTS.weekday` |
| A separate weekend grid | `SLOTS.saturday` |
| One booking across the whole tank | Hidroginástica, Mon/Wed 18:30 |
| One instructor, three adjacent lanes, one slot — the Sandra case | Tue/Thu 19:15 |
| A 90-minute class crossing two grid rows | Pré-Competição A, Mon/Wed 20:00 |
| `uncovered` and `to_define`, kept apart | the four unstaffed `Ref ·` turmas |
| A partner group that brings its own teacher | 6A, `Prof. Silva` |
| Class names with spaces, slashes and digits | `10G 11B`, `11H/I`, `12 F/I` |
| Four partner types out of the eight in the enum | escola, IPSS, jardim de infância, clube |

Do not tidy the awkward names away. They are what the partner import and the
partial unique indexes get judged on.
