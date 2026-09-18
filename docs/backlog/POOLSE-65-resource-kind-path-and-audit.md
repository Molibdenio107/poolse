# POOLSE-65 · The resource-kind path, and the audit that prices it

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Decision / Audit · **Area:** Installations / Data model · **Priority:** Low — no product value until a tenant asks · **Depends on:** — · **Touches:** `docs/` only

### PO — why this exists

Poolse is pool management. That was decided, reversed towards "generic facilities" once,
and decided again — `product.md` says so and this ticket does not reopen it.

But the buyer is almost never *a pool*. It is a clube, a câmara municipal or a complexo
desportivo, and the tank sits next to a pavilhão, a court or a campo. The first paying tenant
will ask "e o pavilhão?" within a month of go-live, and the answer today would be a guess.

This ticket builds **nothing** a user can see. It does two things: writes down the path
Poolse would take if that question ever comes with a signature attached, and measures what
the path costs, file by file, so the answer is a number rather than a rewrite. Both are
cheap now and expensive to reconstruct later, when the person answering is tired and the
client is waiting.

**Not in scope:** any new resource kind, any booking of an espaço, any change to a form, a
label, a migration or an i18n key, any rename. If the audit finds a refactor worth doing, it
is proposed in one line and waits for Rui's OK — never done inside this ticket.

### BA — what the model already gives, and the path

**Already true, and the reason this ticket is small.**

- `pool` *is* the bookable resource. Bookings (`class_schedule`, POOLSE-46) reach it through
  `booking_lane`; the grid, the conflict rules, occupancy and the exports all hang off it.
- Every water-specific column on `pool` is nullable — `volume_litres`, the four dimensions,
  `max_capacity`. Water analysis, metric ranges, alerts and materials are child tables. A
  `pool` row with none of them is a valid row today.
- POOLSE-43: a pool without lanes still has exactly one lane row. A court is, to the
  scheduling stack, a pool with one lane and `lanes_enabled = false`. Nothing there needs
  a null branch.
- `space` already carries `space_type` and is deliberately **not** bookable. It stays that
  way.
- `pool.kind` is `indoor | outdoor`. That is a setting, not a sport, and it keeps its
  meaning.

**The path, recorded and not built.** When a tenant asks, a court, campo or pavilhão is a
**row in `pool`** carrying a new discriminator — working name `resource_kind`, enum,
default `'pool'`, backfilled to `'pool'` — and the water-quality, volume, materials and
heating-cost surfaces are gated on it. "Piscinas" becomes a per-kind label. The lane
editor stays available for every kind: a pavilhão split into two half-courts is the same
shape as a tank split into lanes.

**The rejected path, so nobody re-argues it at 23:00.** Making `space` bookable would give
the scheduling stack a second parent — `booking_lane`, the exclusion constraint, the conflict
rules, the grid, occupancy, PDF and Excel export, the timetable importer — every one of which
would need to learn a second table. That is the rewrite this ticket exists to avoid.

**When to revisit.** A paying tenant asks for it in writing. Not a prospect, not a demo
question, not a good idea in the shower.

**Open:** whether `pool` is renamed at that point. Recommended answer: **no** — keep the
table name, add a comment saying it holds every bookable resource. A rename touches every
migration, test and query in the repo for zero product value; a comment costs one line.

### Dev — the audit

No code changes. The deliverable is `docs/resource-kind-audit.md`, alongside
`page-shell-audit.md`, listing every place that assumes a `pool` row is a body of water
beyond what the data says. Walk, at minimum:

- **API** — pool DTOs and validators (anything that *requires* a water field), the capacity
  rule and its message wording, the water-analysis and metric-range endpoints, the energy
  heating-cost calculation (POOLSE-28), the pool importer/exporter mapping.
- **Web** — the pool form on Instalações, the "Piscinas" section and its counts, the
  water-quality card, the materials card, the calendar's pool selector, the occupancy
  summary, the grid exports' headers, the i18n keys whose *name* says pool where the
  concept is generic (booking, slot, grid, training plan).
- **`@poolse/rules`** — anything that reads a water field to decide a scheduling outcome.
- **Seed and demo data** — the reference schedule (POOLSE-55) and the personal-organization
  seed.

For every finding: `file:line`, what a court would break or show wrongly, size of the fix
(S / M / L), and **one line** proposing the change — gated on Rui's OK. End with a totals
line: how many S, M and L, and one sentence saying whether the path is an evening, a
weekend or a month.

**Most likely to be got wrong:** turning the audit into the refactor. The point of a list is
that it can be read in five minutes; a diff cannot. Second most likely: leaving out the
Excel import/export mapping, which the parity convention says is part of every field — a
court imported from a spreadsheet with a `volume_litres` column is the first bug a real
tenant would hit.

### QA — test scenarios

1. **Given** the ticket is done, **when** `packages/db/migrations` is listed, **then** no
   migration was added.
2. **Given** `git diff`, **then** only files under `docs/` changed.
3. **Given** `docs/decisions.md`, **then** the entry below is present, dated, and names
   both the chosen path and the rejected one.
4. **Given** `docs/roadmap.md`, **then** multi-sport facilities appear in the section the
   roadmap uses for deferred items, pointing at this ticket, with the revisit condition.
5. **Given** `docs/resource-kind-audit.md`, **then** every entry carries `file:line`, an
   S/M/L and a one-line proposal, and the totals line exists.
6. **Given** the audit, **then** the pool import/export mapping is among the entries.
7. **Given** `docs/backlog/README.md`, **then** POOLSE-65 has its row in the index and the
   ticket count is 65.
8. **Given** `docs/features/facilities.md`, **then** one paragraph says a `pool` row is the
   bookable resource and points at the audit — nothing else in that file changes.

### Acceptance criteria

1. No migration, no code change, no i18n change. `docs/` only.
2. `docs/decisions.md` gains this entry, dated:
   > Multi-sport facilities (courts, campos, pavilhões) deferred until a paying tenant asks
   > in writing. Chosen path when they do: a row in `pool` with a `resource_kind`
   > discriminator defaulting to `pool`, water/energy surfaces gated on it, table name kept.
   > Rejected: bookable `space` — a second parent for the whole scheduling stack. Cost
   > measured in `docs/resource-kind-audit.md`. — POOLSE-65
3. `docs/roadmap.md` lists it as deferred, with the revisit condition.
4. `docs/resource-kind-audit.md` exists with the coverage in the Dev section, S/M/L per
   entry, one-line proposals, and a totals line with a one-sentence verdict.
5. Every proposal in the audit is a proposal. None is applied.
6. `docs/backlog/README.md` indexes POOLSE-65.
7. `docs/features/facilities.md` gains the one paragraph in QA 8.
8. The `**Open:**` rename question is answered in the ticket or explicitly deferred with a
   note.
