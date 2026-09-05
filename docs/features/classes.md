# Classes — turmas, parcerias and the lane grid

`/dashboard/classes`. What swims, when, and in which lane. Schema in `docs/data-model.md`.

## Who can do what

| Action | Roles |
|---|---|
| Read the screen, the grid and a turma's card | everybody |
| Create or edit a turma | owner, admin |
| Move a booking on the grid | owner, admin |
| Edit a partnership's day, hour, lanes or headcount | owner, admin |

An instructor sees the same figures read-only. Hiding a control is never the control: every
write above is refused by the API for anyone else.

## Partnerships on this screen

One card per **booking**, not per group. A school group that swims Monday and Wednesday is
two rows on the grid and two lines on an invoice, so editing "6A" as one thing would beg the
question of which hour had just moved.

### Lanes in use, on hover

Each card says how much of the tank is busy at that hour, counted across **everything**
sharing the water — a turma holding the other half makes "all lanes taken" true.

The sentence is visible on the card. Hovering (or focusing) it opens a breakdown listing
each busy lane with what is in it. The list is an ordered list whose markers are the lane's
own numbers — lanes 1, 3 and 4 read `1.` `3.` `4.`, not `1.` `2.` `3.`, because a marker
that counts the items would name the wrong lanes.

The numbers are the lanes' own positions at the tank, not positions within this booking.
