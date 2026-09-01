# Build order and working method

## The rule that matters

**Schema-shaping tickets first.** Four tickets change what a Person, a level or a skill *is*. Every
week they wait, they get more expensive, because more code is written against the old shape. Nothing
else on this list has that property.

---

## Order

### Wave 0 — decide, don't build (one sitting, no code)

Settle the eight conflicts in [CONFLICTS.md](./CONFLICTS.md) and the open questions inside
POOLSE-17, 21, 22 and 28. Nothing in Wave 1 can be built correctly without C1, C3 and C4 answered.

### Wave 1 — the shape of things

| Order | Ticket | Why first |
|---|---|---|
| 1 | **POOLSE-17** · One Person, many roles | Everything about people depends on it. Includes the merge migration. |
| 2 | **POOLSE-22** · Age of majority as a tenant setting | One column. Do it before POOLSE-04 hardcodes 18. |
| 3 | **POOLSE-06 + POOLSE-16** · Age in months, ceiling 100 | One migration, per C1. Never separately. |
| 4 | **POOLSE-20** · Four-state skill progress | Changes what a skill is. POOLSE-19 is unbuildable without it. |

### Wave 1b — the shell, before more pages exist

**POOLSE-41** (one page shell). Every page built after this one inherits consistent layout for free;
every page built before it has to be migrated. It is not urgent by value, but it is the cheapest it
will ever be, and the migration list only grows.

### Wave 2 — the people surfaces

**POOLSE-35 + POOLSE-38 together** (the staff/students split, and Staff renamed and nested under
Instalações) → POOLSE-39 (editable staff record) → POOLSE-04 (guardian block) → POOLSE-18 (role
badges) → POOLSE-32 (name display) → POOLSE-01 (invite matrix) → POOLSE-03 (archive permissions).

35 and 38 are one evening: 38 renames and moves what 35 defines, and shipping them apart means
touching the same navigation config, routes and i18n keys twice. POOLSE-36 is **superseded** by 38 —
do not build it.

39 comes straight after, because a staff section you cannot edit is the complaint that produced it.

### Wave 3 — the cheap wins

POOLSE-09, 10 (two bugs — do them any evening you have forty minutes), then 29, 30 (pagination and
live search, both global and both mechanical), then 02, 05, 08, 12, 34, 37, 40.

These are the tickets to reach for when the evening is short. None of them blocks anything.

POOLSE-37 (landing page per role) is best done *after* Wave 2, so the roles it routes on are settled.
POOLSE-40 (levels and skills expanded view) wants POOLSE-05 and POOLSE-41 in place first, or you will
lay it out twice.

### Wave 4 — classes and the calendar

POOLSE-13 (attendance colours) → POOLSE-21 (reposição credits, depends on 13's *falta justificada*)
→ POOLSE-14 (remove classes) → POOLSE-31 (Encerramentos) → POOLSE-15 (hover card) → POOLSE-07
(reset season).

### Wave 5 — the differentiator

POOLSE-19 (automatic level advancement) → POOLSE-23 (adult and senior path).

19 is the feature no competitor has. It needs 17, 20 and 05 in place, which is why it sits here and
not earlier — but it is the reason the product is worth building, so do not let it slide behind
Wave 6.

### Wave 6 — money

POOLSE-24 (instalment plan visible at the price) and POOLSE-25 (self-cure for failed débito direto)
ship together when collections go live. From the family's side they are one story: here is what you
will pay, and here is what happens when a payment fails.

### Wave 7 — the other modules

POOLSE-11 (ID uploads, with the GDPR retention decision first), 26 and 27 with the maintenance
module, 28 with the energy module, 33 whenever.

---

## Ocupação por pista + Parcerias — POOLSE-43 … 55

Thirteen tickets, added after round 6. They are one feature, and the order inside them is not
negotiable: each wave is unbuildable until the one above it exists.

Four calls were taken up front and are **not** to be re-opened while building:

1. **`class_schedule` is extended, not replaced.** A new `booking` table would mean rewriting session
   generation, attendance, reposições, closures and the fees engine before anything new became
   visible.
2. **`season` stays per-organization** and gains a `draft` status. Per-facility seasons would cost a
   migration of `class_group`, the seasons screen and the reset flow to buy a case nobody has asked
   for. Per-facility variation lives in the slot grid, which already carries `facility_id`.
3. **Parceria bookings generate dated sessions, and take no register.** Closures must visibly cancel
   them and occupancy must be actual rather than theoretical; attendance against them is refused by
   the API.
4. **Slots are the grid; the booking's own time is the truth.** A booking matching no slot renders in
   a "fora da grelha" row rather than being migrated onto a slot or disappearing.

| Wave | Tickets | Why in this order |
|---|---|---|
| **A — the model** | 43 lanes → 44 slots → 45 draft seasons → 46 bookings | 46 needs all three. Nothing is visible to an operator until wave C, which is the cost of getting the shape right once instead of three times. |
| **B — parcerias** | 47 partners → 48 import | 46 references `partner_group`, so build 47 before it or alongside it and add the foreign key last. 48 is its own evening and can slip without blocking anything. |
| **C — the grid** | 49 render → 50 drag → 51 conflicts | 49 is the big one, and it is where the model gets proved wrong if it is wrong. 51 carries a spike — see below. |
| **D — the payoff** | 52 occupancy → 53 alerts → 54 export → 55 seed | 53 is the club's stated pain point and is small; do it before 54. 55 is the acceptance of the whole feature and is allowed to send you back to wave A. |

**The risky unknowns, worth spiking before committing to the wave that needs them:**

- **POOLSE-51** — whether an exclusion constraint can express "same instructor, *different* pool,
  overlapping time". If `btree_gist` will not supply the inequality operator there, it is a trigger
  instead. Half an hour in `psql` answers it and it changes nothing else in the ticket.
- **POOLSE-46** — moving the lane exclusion onto `class_session_lane`, with times copied from the
  session and kept honest by a trigger. This is the highest-risk piece of the whole feature: the
  guarantee it replaces is the only thing standing between two groups and the same lane.
- **POOLSE-49** — whether the weekend block fits beside the weekday grid at 1280px. Decide it from a
  real render, not in the abstract; stacked with a heading is the fallback, not a toggle.

---

## How one evening runs

You have two or three hours after a full day. The scarce resource is momentum, not skill.

1. **Pick one ticket.** Open its file and `CONVENTIONS.md`. Nothing else.
2. **Build a vertical slice** — migration → API → UI → check. A slice that ends working beats three
   layers that end half-built. If the ticket is too big for one evening, split it at a layer boundary
   and write down where you stopped, in the ticket file.
3. **The QA section is your test list.** It is already written. Do the permission and negative ones —
   they are the ones that would otherwise ship broken.
4. **Close with two lines** in the commit: what now works, and the next slice. That is where the next
   session starts.

## What not to do

- Don't start an evening by re-reading the whole backlog. That is an hour gone and nothing built.
- Don't build POOLSE-19 before 17 and 20. It will work and then need rewriting.
- Don't leave a migration half-applied between staging and local. Poolse's tenant isolation lives in
  the schema, so a drifted schema is a broken isolation guarantee, not just an inconvenience.
