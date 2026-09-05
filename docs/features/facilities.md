# Facilities — sites, tanks and lanes

Schema in `docs/data-model.md`.

## Who can do what

| Action | Roles |
|---|---|
| Read a site, its tanks and its lanes | everybody |
| Create, edit or archive a site or a tank | owner, admin |
| Read the inventory | everybody |
| Change the inventory | owner, admin |

Knowing whether there are enough pranchas for a class is not privileged. Changing anything
is.

A subscription covers one site; `organization.max_facilities` defaults to 1 and a trigger
enforces it. A club with two sites buys a plan with two.

## A tank

Name, kind (indoor or outdoor), and optionally its measurements: length, width, **min
depth**, **max depth**, volume in litres.

Volume is offered from the four measurements — `length × width × (min + max) / 2 × 1000` —
and stays overridable, because not every pool is a box.

Lanes are rows, not a count. A tank always has at least one; a tank with no lane markings
has exactly one, named after the tank.

## Max capacity

**How many swimmers are allowed in the water at once, across every turma.**

- Left empty means no ceiling is set, and **nothing is enforced**. The tank card says so in
  words rather than showing a dash.
- When set, the turmas sharing that tank at overlapping times may not, between them, promise
  more places than it holds. Enforced by a database trigger, so it holds against two people
  saving at the same moment.
- Refused as a 409 naming the figures: *"the tank holds 40 and this slot already has 32, so
  this class can take 8."*
- Both ways into a slot are covered — the turma form and dragging a class onto the calendar.
- A turma with no capacity recorded neither counts nor blocks. Partnership bookings count as
  zero, because they carry no headcount.

This is one of three capacity rules and they compose rather than override:

| Rule | Question |
|---|---|
| `class_group.capacity` | How many places does this turma promise? |
| `lane_level_capacity` | How many of this level fit in one lane? |
| `pool.max_capacity` | How many bodies are in the water at once? |
