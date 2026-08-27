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

### Wave 2 — the people surfaces

POOLSE-35 (Pessoas / Alunos split) → POOLSE-04 (guardian block) → POOLSE-18 (role badges) →
POOLSE-32 (name display) → POOLSE-01 (invite matrix) → POOLSE-03 (archive permissions).

POOLSE-35 first: once the two views exist, 04, 18 and 32 land inside a settled structure rather than
being rebuilt when it changes.

### Wave 3 — the cheap wins

POOLSE-09, 10 (two bugs — do them any evening you have forty minutes), then 29, 30 (pagination and
live search, both global and both mechanical), then 02, 05, 08, 12, 34, 36.

These are the tickets to reach for when the evening is short. None of them blocks anything.

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
