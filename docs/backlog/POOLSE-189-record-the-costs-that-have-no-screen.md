# POOLSE-189 · The office records water, fixed costs, maintenance services and premiums on a screen, so *Custos* is complete

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Finance / Maintenance · **Priority:** Medium (pilot) · **Depends on** [POOLSE-182](./POOLSE-182-cost-ledger-and-month-allocation.md), [POOLSE-183](./POOLSE-183-custos-per-year-and-per-season.md)

### PO — why this exists

POOLSE-182 built `POST /costs`, `POST /costs/maintenance-service`, `POST /costs/purchases` and `PUT /costs/premiums/:policyId` with no screen. *Custos* (POOLSE-183) therefore reads energy, salaries and any purchases only, and a total that leaves out water, rent and insurance looks exactly like a complete one.

**Not in scope:**
- Editing a recorded cost: a mistake is archived and recorded again.
- An importer. Add one if a pilot club has a list.
- Changing *Custos* itself, beyond its links.

### BA — rules

1. **Each cost is recorded where its work is**, as POOLSE-183 rule 8 expects: a premium on the insurance policy, a service on the avaria or the task done, a purchase on the inventory item, and water, fixed and other costs on a *Registar custo* action on *Custos*.
2. **Who:** owner and admin record all of them; maintenance records a service and a purchase, and is answered with no total.
3. A recurring cost (monthly or yearly) says so in words and can be stopped. An occurrence archived as *não pago* is never generated again.
4. A form states net and VAT as two figures, and every amount is typed through `parseCents`.
5. A removal asks first (`ConfirmButton`) and comes back through the bin only if the kind is in `RESTORABLE`; otherwise the sentence says it does not.
6. *Custos* links each kind to where it is recorded, so *Ver onde se regista* appears on all eight.

### Dev notes

- The API exists; this is forms, actions and links. `apps/api/src/costs/costs.controller.ts` is the surface.
- Trap: `docs/financials.md` applies. A typed cost is `contracted`, never `actual`, unless a document number says otherwise; check before writing a screen that says *faturado*.
- A new entry point earns a palette action in `lib/commands.ts`.

### QA

1. Given a water cost typed for March, then *Custos* shows it in March, invoiced, and its CSV agrees.
2. Given a monthly fixed cost from January, then each month to today shows it, and stopping it stops the next one.
3. Given a premium on a policy year, then it spreads by day.
4. Given maintenance, when a service is recorded, then the response carries no total, and `POST /costs` is refused.
5. Given an instructor, then every route is 403.
6. Given another club's policy id, then 404.
7. Both themes, desk and phone.

### Acceptance criteria
- [ ] All four costs have a screen, in the place their work is done.
- [ ] *Ver onde se regista* on every kind on *Custos*.
- [ ] QA 1–7 green.
