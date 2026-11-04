# POOLSE-161 · Receção sells per sport: a single entry for the pool, a court hour for a pair, a pitch for a group

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Reception / Multi-sport · **Priority:** Low (post go-live) · **Depends on** [POOLSE-68], [POOLSE-123], [POOLSE-124] · **Unblocks** —

### PO — why this exists
Rui, 04-11-2026: "'Reception' should also take into consideration the different sports a facility can have. Single entry is only for pools now, but can be for a pair of people to just play a match of tennis or a group to play one football match."

Decided 04-11-2026 (Rui): Low, after go-live, and after POOLSE-123 — a court hour is a unit booking. Written now so the shape is on record. **Re-confirm before starting.**

**Not in scope:** online booking by the public; pricing per hour band; turnstiles.

### BA — rules
1. A pass product (`pass`) names a sport; the pool's existing products are `pool`. Reception opens on a sport chooser in a multi-sport club.
2. A non-pool sale is a *reserva de recinto*: a unit (POOLSE-123) for a window, a head count, one invoice line as today (`invoice_line.pass_id`), *Consumidor final* allowed.
3. Occupancy for a court is the booking's head count; `pool_occupancy()` stays the pool's.
4. A sale on a window a turma or booking holds is refused by the unit exclusion (123), with the clash named.
5. Fallback if 123 slips: sell a per-sport pass with no window and no unit — a counter only — and say so on the screen.

### Dev notes
- `pass.sport_id` (FK `sport`), default `pool`; sale path reuses `createPassSale`; the booking is a `booking` on units (123's table) carrying `pass_sale_id`.
- Owner/admin only, as reception is.
- Trap: a free-swim block is water held for the public, not a class — the court equivalent must be left out of the dashboard's classes the same way.

### QA
1. Pool-only club: Receção unchanged (snapshot).
2. Two-sport club: chooser first; a tennis sale writes an invoice line and a unit booking for the hour.
3. Overlapping court hour → 409 naming the holder.
4. Cross-tenant unit id → 404; instructor → 403.

### Acceptance criteria
- [ ] Sport on the product; chooser when multi-sport.
- [ ] Court sale = invoice line + unit booking, or the written fallback.
- [ ] Pool path untouched.
