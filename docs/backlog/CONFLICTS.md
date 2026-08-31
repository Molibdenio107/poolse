# Conflict register

Contradictions between tickets, found while writing the PO/BA/Dev/QA views. Each has a recommended
resolution. **None is settled until Rui decides** — update the Status column as they are.

| # | Conflict | Status |
|---|---|---|
| C1 | POOLSE-06 vs POOLSE-16 — same field, two migrations | Open |
| C2 | POOLSE-08 vs POOLSE-32 — two sort orders | **Resolved 28 Aug** |
| C3 | POOLSE-04 vs POOLSE-22 — hardcoded 18 vs tenant setting | Open |
| C4 | POOLSE-17 vs POOLSE-01 — union of roles vs strongest role | Open |
| C5 | POOLSE-21 AC3 vs AC4 — mutually exclusive on a full turma | Open |
| C6 | POOLSE-22 vs POOLSE-33 — tenant maioridade vs fixed bracket boundary | Open |
| C7 | POOLSE-28 vs POOLSE-21 AC8 — do reposição guests count? | Open |
| C8 | POOLSE-29 vs POOLSE-15 — unbounded list vs full hover list | Open |

---

### C1 · POOLSE-06 and POOLSE-16 fight over the same field

06 migrates minimum/maximum age to months; 16 raises the maximum ceiling from 30 to 100. Shipped
separately, the second migration contradicts the first's stored unit.

**Recommended:** ship as one migration. 06 owns the unit change, 16 owns the ceiling and the senior
seed data, and neither merges alone.

### C2 · POOLSE-08 sorts alphabetically, POOLSE-32 sorts by surname

The same students appear in a different order depending on the screen.

**Recommended:** one sort rule everywhere — surname, then first name. Amend POOLSE-08 AC5.

**Resolved 28 Aug, as recommended.** There is one rule and it is `name_sort_key()` in the
database: first surname, particles stripped, given names as the tiebreak, ordered under the
`pt_pt` collation. POOLSE-08 AC5's "alphabetically" means that. Every list of people now
orders by it — the register, turma rosters, the waiting list, the skills grid, the hover
card, the staff list, encarregados and the vacation requests — so the same children come
back in the same order whichever screen asks.

### C3 · POOLSE-04 hardcodes 18, POOLSE-22 makes it a tenant setting

**Recommended:** POOLSE-22 explicitly amends POOLSE-04 AC1. If 22 ships first, 04 is written against
the setting and the conflict never exists.

### C4 · Union of roles vs strongest role held

POOLSE-17 AC5 resolves permissions as the union of a Person's roles; POOLSE-01 reads the invite
matrix from the strongest role held.

**Recommended:** keep both, and document it. General permissions resolve to the **union**; the invite
matrix resolves to the **strongest role**. A union reading would let an Instructor+Admin invite
through two paths that answer differently.

### C5 · POOLSE-21 AC3 and AC4 are mutually exclusive on a full turma

AC3 requires an open seat; AC4 restricts redemption to slots where someone is already absent. On a
full turma both cannot hold.

**Recommended:** AC4 is a tenant toggle that **replaces** AC3's open-seat test when enabled, rather
than adding to it.

### C6 · Tenant maioridade vs the fixed 12–17 / 18–59 bracket boundary

**Recommended:** leave POOLSE-33 fixed. Age-bracket icons are a display taxonomy, not a legal
threshold — they should not move when a tenant changes its age of majority.

### C7 · Do reposição guests count?

POOLSE-28 counts bathers; POOLSE-21 AC8 excludes reposição guests from enrolled counts.

**Recommended:** both are right, and both should be stated. **Per-bather uses attendance** (guests
included — they consume heat). **Occupancy uses enrolment** (guests excluded).

### C8 · "No list renders unbounded" vs the full hover list

**Recommended:** the hover card is not a list view. Keep it complete, capped by a scrollable max
height — which POOLSE-15 AC3 already specifies.

### C9 · Where prices live — POOLSE-24's `payment_plan` vs POOLSE-42's facility price list

POOLSE-24 assumes a `payment_plan` hanging off season or turma pricing. POOLSE-42 makes the
**facility** the source of prices and periodicities, on the reasoning that a club's agreement with a
family is an agreement with the site: the same turma name at two pools can cost different money, and
a price attached to a season has to be copied forward every September by somebody who remembers.

**Resolved, and built:** **this ticket stores, POOLSE-24 renders.** There is one price model —
`fee_plan`, `fee_period` and `student_fee`, keyed to the facility. POOLSE-24's instalment schedule is
generated from a student's fee lines, not from a second price model beside them.

Two things POOLSE-24 can rely on rather than re-deriving:

- `fee_total_cents(amount_cents, months, discount_percent)` is the single definition of a period
  total, rounded once at the period. `fee_payable_cents` wraps it for a line's manual discount.
  Nothing outside SQL computes either.
- A line's `amount_cents` and `discount_percent` are a **snapshot** taken when the fee was agreed.
  A schedule must read the line, never the plan — reading the plan would re-price a family
  retroactively the moment somebody corrected a typo in the price list.

