# POOLSE-44 · The facility's slot grid

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Installations / Scheduling · **Priority:** High — blocks POOLSE-46, 49

### PO — why this exists
A club's schedule has rows before it has classes. The reference sheet runs 06:30, 08:45, 09:30,
10:15, 11:00, 11:45, then nothing until 14:45, then 15:30, 16:15, 17:00, 17:45, 18:30, 19:15, 20:00,
21:00 — roughly a 45-minute pitch with holes in it, and a completely different set at the weekend
(07:30, 08:00, 09:30, 10:15, 11:00, 11:45). That grid is a property of the building. It is what the
club prints, and it is what somebody scheduling a class is choosing from.

Poolse has no such concept: a class carries a free `start_time` and the calendar draws a uniform
15-minute lattice. That lattice is fine for reading one week and useless for planning a season,
because it offers 96 rows where the club has fourteen.

**Not in scope:** drawing the grid (POOLSE-49) and what sits in it (POOLSE-46). This ticket is the
editor and the table behind it.

### BA — rules and data
- `facility_time_slot`: `facility_id`, `season_id`, `day_group`, `start_time`, `end_time`,
  `position`.
- **Two independent sets, three day groups.** `weekday` covers 2ª–6ª; `saturday` and `sunday` are
  separate because the reference club runs different hours on each and prints them as their own
  block. One `weekend` group was considered and rejected: a club that opens Saturday morning and not
  Sunday would have to encode that as an absence somewhere else.
- **Gaps are normal and are not modelled.** The hole between 11:45 and 14:45 is the absence of a
  slot, not a slot of type "closed". Nothing needs to know why the pool is quiet at lunchtime.
- Slots within one day group may not overlap. Abutting is normal — 09:30–10:15 then 10:15–11:00 —
  and must be allowed.
- **"Gerar grelha"** takes start, end, duration and interval and produces the rows; the operator then
  deletes and edits individual ones. That order matters: real grids are generated and then
  hand-corrected, and an editor that only generates would be abandoned at the first exception.
- Slots belong to a season (POOLSE-45), so next year's grid can be drafted without disturbing the one
  the club is running. Duplicating a season clones its slots.
- **Answered — Open question 5 (half-slot bookings).** The slot grid is the grid, not the truth. A
  booking keeps its own `start_time` and `duration_minutes` (POOLSE-46), and `slot_id` is set when
  those match a slot. A class that starts at 07:15 in a facility whose grid has no 07:15 still exists,
  still renders, and appears in a "fora da grelha" row rather than vanishing. Forcing every existing
  turma onto a slot would need a migration that either invents a slot per distinct start time or
  moves somebody's classes, and both are worse than one honest extra row.
- Editing slots is owner/admin. Everyone else sees the grid.
- Deleting a slot that bookings reference is refused, naming them — the same rule as lanes.

### Dev — implementation notes
- ```
  day_group enum ('weekday','saturday','sunday')

  facility_time_slot
    id, organization_id, facility_id, season_id,
    day_group day_group not null,
    start_time time not null, end_time time not null,
    position smallint not null,
    created_at, updated_at, archived_at
    unique (organization_id, id)
    foreign key (organization_id, facility_id) references facility (organization_id, id)
    foreign key (organization_id, season_id)   references season (organization_id, id)
    check (end_time > start_time)
  ```
- **Non-overlap is an `EXCLUDE`, not an application check.** Postgres has no built-in range type over
  `time`, so use minutes from midnight in an `int4range` — which is also how
  `class_schedule_within_facility_hours()` already reasons, and for the same reason: `time '23:30' +
  interval '60 minutes'` wraps to `00:30` and compares as earlier than every closing time.
  ```
  exclude using gist (
    organization_id with =, facility_id with =, season_id with =, day_group with =,
    int4range(
      extract(hour from start_time)::int * 60 + extract(minute from start_time)::int,
      extract(hour from end_time)::int   * 60 + extract(minute from end_time)::int
    ) with &&
  ) where (archived_at is null)
  ```
  `int4range` is half-open, so abutting slots do not collide — which is exactly the behaviour wanted.
  `btree_gist` is already installed.
- **Most likely to be got wrong:** `24:00`. It is a real `time` in Postgres, `facility_hours` already
  uses it for "to the end of the day", and `extract(hour from time '24:00')` is 24 — so the minute
  arithmetic gives 1440 and works. A slot ending at midnight written as `00:00` gives 0 and produces
  an empty range the exclusion silently ignores. Refuse `00:00` as an end time with a message that
  says to write `24:00`.
- Second most likely: forgetting `season_id` in the exclusion key, which would stop a club drafting
  next year's grid because it collided with this year's.
- The editor goes in the existing **Configuração** area of the facility page, beside
  `hours-panel.tsx` — weekdays, opening hours and closure dates already live there and a slot grid is
  the same kind of fact about the building.
- The generator is a client-side helper that posts the resulting rows; it is not a server endpoint.
  Generating is a convenience over the same POST an operator could do by hand, and a server-side
  generator would be a second way to create slots to keep in step.
- Slots are exempt from pagination — a day's grid is bounded by the day. See CONVENTIONS.

### QA — test scenarios
- **44.1** Given an empty facility / When "gerar grelha" runs with 09:00, 12:00, 45 min, 0 min interval / Then four slots exist: 09:00–09:45, 09:45–10:30, 10:30–11:15, 11:15–12:00.
- **44.2** Given those four / When the operator deletes the third and edits the first to 08:45 / Then the remaining three are as edited and positions stay contiguous.
- **44.3** Given a slot 09:30–10:15 / When 10:00–10:45 is added to the same day group / Then it is refused as overlapping.
- **44.4** Given the same slot / When 10:15–11:00 is added / Then it is accepted — abutting is not overlapping.
- **44.5** Given a weekday slot 09:30–10:15 / When a Saturday slot 09:30–10:15 is added / Then it is accepted — the sets are independent.
- **44.6** Given a published season's grid / When a draft season's grid is edited / Then the published one is unchanged.
- **44.7** Given a slot ending `24:00` / When saved / Then it is accepted and does not overlap a slot starting at `00:00` the same day.
- **44.8** Given a slot ending `00:00` / When saved / Then it is refused with a message naming `24:00`.
- **44.9** Given a slot with bookings on it / When it is deleted / Then the deletion is refused and the message names the bookings.
- **44.10** Given a facility with no slots / When the schedule grid is opened / Then it says the grid has not been set up and links to the editor, rather than rendering empty.
- **44.11** Given an instructor / When they POST a slot / Then the API refuses it.
- **44.12** Given tenant A's slots / When tenant B reads slots / Then none are returned, and B cannot attach one to its own facility.
- **44.13** Given pt-PT and en / When the editor renders / Then every label, including the three day-group names, exists in both.

### Built — decisions taken while building

- **No `position` column**, which the ticket asked for. Slots cannot overlap, so `start_time`
  already totally orders them, and a stored position would be a second answer that could
  disagree with the clock. Ordering is `ORDER BY start_time`.
- **`00:00` is refused twice**, and deliberately: the CHECK `end_time > start_time` catches it
  structurally, and the controller catches it first so the operator reads "write 24:00"
  rather than a constraint name.
- **One route creates one slot and forty.** "Gerar grelha" is the same POST with a longer
  list; the arithmetic runs in the browser so the operator sees the rows, and the ones that
  would collide are struck through and dropped rather than sent and refused. A separate
  generate endpoint would have been a second way to create a slot.
- **The batch is one transaction**, so a grid with one bad row writes none of it.
- **AC7 (deleting a slot bookings sit on) is not implemented yet**, and the repository says
  so in place of a check that cannot work: nothing references a slot until POOLSE-46 adds
  `class_schedule.slot_id`. `SlotInUseError` and its rendering are already in place, so that
  ticket adds a join and nothing else.
- `apiDelete` was added to the web client — a slot is the first thing whose removal reads as
  a delete to the person doing it. The repository still archives.

### Acceptance criteria

1. `facility_time_slot` exists, tenant-scoped and keyed compositely to both its facility and its season.
2. Three day groups — weekday, saturday, sunday — each with an independent set of slots.
3. Gaps between slots are ordinary; nothing models a gap as a row.
4. Overlapping slots within a day group are refused by a database exclusion constraint, while abutting slots are accepted.
5. `24:00` is accepted as an end time; `00:00` is refused with a message that says what to write instead.
6. "Gerar grelha" produces slots from start, end, duration and interval, and every generated row is then individually editable and deletable.
7. Deleting a slot that bookings reference is refused and the refusal names them.
8. Slot editing is owner/admin, enforced in the API.
9. The editor lives in the facility's Configuração area beside opening hours and closures.
10. A facility with no slots yet tells the operator so and links to the editor, rather than rendering an empty grid.
