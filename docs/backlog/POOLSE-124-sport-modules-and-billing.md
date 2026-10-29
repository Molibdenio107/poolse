# POOLSE-124 · Sports as paid modules: pool on by default, each other sport switched on per club

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Platform / Billing · **Priority:** High (before first go-live, invisible to the pilot) · **Depends on** [POOLSE-122](./POOLSE-122-recintos-typed-playing-areas.md), [POOLSE-87](./POOLSE-87-modules-per-club.md)

### PO — why this exists

Rui, 28-10-2026: *"the user has a facility, it pays for that, and it also pays an extra for a second main menu, which is a pool... if the owner wants another field, tennis, there's a new separate main screen for tennis... you'll have to pay this on the subscription."*

POOLSE-87 already gives a club a list of modules switched on and off from `/admin`, with dependencies. Sports ride on it. Two differences: a sport is **opt-in** (`disabled_modules` is opt-out), and `pool` is **always on** for now (Decided 8; the pilot is a pool).

**Not in scope:** Stripe prices for sport add-ons (Rui's subscription pricing is flat per facility and he plans to bill the first clubs by hand); a per-area cap (Decided 9: flat per sport, cap later).

### BA — rules

1. `organization.enabled_sports sport_key[]`, default `{pool}`. Written by `poolse_platform` only, through the same `changeTenant` path and audit as `disabled_modules`; `poolse_app` cannot write it.
2. A recinto may be created only for a sport in `enabled_sports`. Switching a sport **off** with live recintos is refused naming them (the same shape as the module dependency toast); archive the recintos first.
3. `pool` cannot be switched off (CHECK: `'pool' = any(enabled_sports)`). Lift the check when a tennis-only club appears.
4. `/me` carries `sports` (the enabled list with labels) beside `modules`. The menu, the palette and `nav-entries.ts` read it (POOLSE-125).
5. Billing: each enabled sport beyond `pool` is one add-on line on the subscription page and on a manual invoice; amount is a platform setting per sport, null = not priced yet. Nothing is charged automatically in this ticket.
6. `/admin` tenant page gains a *Desportos* block, one click per sport, with the recinto count beside each.

### Dev notes

- Reuse POOLSE-87's endpoint shape: `POST /platform/tenants/:id/sports { enabled: [...] }`, audit `tenant.sports.set`, alert on change.
- `sport.key` is the join to `enabled_sports`; keep the array of keys, not ids, so `/me` is readable without a join and the rules module can test it.
- `@poolse/rules`: `enabledSports(org)` and `mayCreateRecinto(sport, org)`; the API refuses with 403 `sport_not_enabled`.
- The subscription page (owner only, since 28-10-2026 reached from *O meu perfil*) lists add-ons under the plan line.

### QA

1. Given a club with `{pool}`, when creating a tennis recinto, then 403 `sport_not_enabled`.
2. Given `/admin` switches tennis on, then the creation succeeds and the audit row carries before/after.
3. Given a live tennis recinto, when tennis is switched off, then refused naming the recinto.
4. Given any club, when `pool` is removed from the array, then the CHECK refuses.
5. Cross-tenant and `poolse_app` write attempts refused.
6. The pilot's `/me`, menu and subscription page are unchanged.

### Acceptance criteria

- [ ] `enabled_sports` with grant, CHECK, audit and tests.
- [ ] Recinto creation gated by it in the API.
- [ ] `/admin` block and `/me.sports`.
- [ ] Add-on lines on the subscription page, unpriced.
