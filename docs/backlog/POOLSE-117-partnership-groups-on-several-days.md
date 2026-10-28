# POOLSE-117 · Parcerias: a group on several days — place them at once, see them as one, import them

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Partnerships / Calendar · **Priority:** Medium (pilot) · **Depends on** [POOLSE-46](./POOLSE-46-bookings-subject-types-and-lanes.md), [POOLSE-47](./POOLSE-47-parcerias-partners-agreements-groups.md), [POOLSE-57](./POOLSE-57-importing-the-wall-timetable.md) (its clash rules)

### PO — why this exists

Rui, 28-10-2026: *"Class groups partnerships can have more than one day to attend the pool."*

The data already allows it: each weekly slot is its own `class_schedule` row, unique per group, weekday and start time, so *6A* can swim Monday 10:00 and Thursday 14:00 with different lanes and even a different headcount. Three things make it clumsy:

1. **A partnership group cannot be placed on the calendar at all.** *Colocar aqui* offers turmas and free swim only; a parceria booking comes from duplicating another block or from the wall-timetable import. Found while scoping this ticket.
2. **The Turmas screen draws one card per booking**, so a group on three days is three unconnected cards.
3. **The partnerships sheet carries groups and headcounts but no days**, so every school's timetable is typed by hand after the import.

**Not in scope:** a headcount per day (the booking's existing `headcount_override` stays as it is); billing per day; lanes in the sheet; a partnership group on a turma's register (POOLSE-46: never).

### BA — rules (decided by Rui, 28-10-2026)

1. **Place a group, on one or several days.** *Colocar aqui* (a click on an empty lane at an hour) lists the site's partnership groups beside the turmas, each named with its partnership. Choosing one shows the day clicked, ticked, and the other open weekdays to tick, all at the **same hour, length and lane** as the click. The length is the club's slot at that hour, else 45 minutes, as for a turma.
2. **All or nothing on a clash.** If any chosen day collides (a lane taken, the tank full, the instructor elsewhere), **nothing is booked** and every clash is listed by day, lane and holder: *Quarta 10:00 · Pista 2 já tem Golfinhos*. The rules are `@poolse/rules`' `evaluate`, the ones the grid and the timetable import run, and the chosen days are judged against each other as well as the grid.
3. **One card per group** on Turmas → Parcerias: the group, its partnership, the participant count (the group's, one figure), then **one line per day** with its hour, length and lanes. Each line keeps today's editing (day, hour, lanes) and gains *Remover este dia*. The card gains *Adicionar dia* (day, hour, lanes, length), which is rule 1 with one day and rule 2's refusal. Removing the last day leaves the group with no timetable, and it reappears in *Colocar aqui*.
4. **The partnerships sheet carries days**: optional columns *Dias*, *Hora* and *Duração*. Both shapes are read:
   - one row per group with several days in one cell (*Seg, Qua*, *2ª e 4ª*, *segunda e quinta*, *Mon/Wed*), at one hour;
   - the same group on several rows, one day and hour each.

   A group repeated with **different** days or hours adds days; repeated with the **same** day and hour it is still refused as a duplicate line (today's rule).
5. **Imported days land in *Sem pista*** — booked at the day and hour, no lane — for the club to drag onto lanes. Nothing guesses a lane.
6. **Length**: the *Duração* cell, else the site's slot that **starts** at that hour; a row with neither is refused with its reason (*Às 10:20 não começa nenhum horário do site; indique a duração*).
7. **What a re-import does**: a day already booked at that hour is *igual*; a new day is *novo*. Nothing is removed by its absence from the file — a blank is silence, as the importer already treats every other column. The import stays **one transaction**.
8. **The export writes the days back** (*Dias*, *Hora*, *Duração*), so a club exports, corrects and re-imports with nothing mapped by hand and a round trip changes nothing (`partner-sheet.test.ts`).
9. **Season**: the published season, as everywhere a timetable is written; with none, placing and importing days are refused in words.
10. **Who**: owner and admin, as for every partnership write today. The API enforces it.

### Dev notes

- **One write path for a partnership group's days**: `POST /partner-groups/:id/bookings` `{ weekdays[], startTime, durationMinutes, laneIds[] }` → creates one `class_schedule` per weekday (+ `booking_lane`) in one transaction, after judging every day with `evaluate` against the grid *and* each other; any clash → 409 with the clashes as structured fields, nothing written. Rules 1, 3 (*Adicionar dia*) and 7 (the import's commit) all call it — the importer through its repository function, with `laneIds = []`.
- `class_session` generation follows as it does for every booking (`syncSeasonLessons`).
- *Remover este dia* reuses the existing booking removal (future, untaught sessions cancelled, never deleted).
- Partner sheet: three new `PARTNER_FIELDS` with synonyms; a day parser in `lib/partner-sheet.ts` (pt-PT and en day names, *2ª…6ª*, *sáb*, *dom*, ranges *Seg a Qua* refused with their reason, never guessed — the default, taken 28-10-2026 when Rui said go); rows grouped by (partnership, group) before the API.
- `PartnerClasses` groups bookings by `partnerGroupId`; one `PartnerCard` per group renders the day lines.

### QA — scenarios

1. **Given** a site with *6A* unplaced, **when** the owner clicks Monday 10:00 Pista 2, chooses *6A* and also ticks Wednesday, **then** two bookings exist, both 10:00 on Pista 2, and *6A* shows once on Turmas with two day lines.
2. **Given** Pista 2 taken on Wednesday at 10:00, **when** the same is attempted, **then** nothing is booked and the refusal names Wednesday, Pista 2 and the holder.
3. **Given** *6A* on Monday, **when** *Adicionar dia* adds Thursday 14:00 Pista 3, **then** the card shows both lines; *Remover este dia* on Monday leaves Thursday.
4. **Given** a sheet row *ES D. Dinis · 6A · 24 · Seg, Qua · 10:00*, **when** imported, **then** two bookings in *Sem pista* with the slot's length.
5. **Given** two rows for *6A*, *Seg 10:00* and *Qui 14:00*, **then** two days, not a duplicate refusal; **given** the same row twice, **then** the second is refused naming the first.
6. **Given** a row at 10:20 with no slot starting then and no duration, **then** that row is refused with its reason and nothing in the file is written.
7. **Given** an export of a club with days, **when** re-imported, **then** the preview says *igual* for every day and the commit writes nothing.
8. **Given** an instructor, **then** placing, adding, removing and importing days are refused by the API (403), and the role probe says so.

### Acceptance criteria

1. A partnership group can be placed from the calendar on one or several days in one action, all or nothing on a clash, with each clash named.
2. Turmas shows one card per group with its days, each editable and removable, and a way to add one.
3. The partnerships sheet imports and exports days, hours and lengths in both shapes, landing in *Sem pista*, and a round trip changes nothing.
4. Owner/admin only, enforced in the API; both languages; light and dark; tier-3 phone readability.
