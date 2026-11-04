# POOLSE-156 · Nadadores-salvadores are planned per sport: a duty sits on a recinto, and the week asks the sport first

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature / Architecture · **Area:** Staff / Facilities / Multi-sport · **Priority:** Medium (pilot) · **Depends on** [POOLSE-70], [POOLSE-96], [POOLSE-122] · **Unblocks** —

### PO — why this exists
Rui, 04-11-2026: "'Lifeguards' can be added etc., but we should filter by sport. There's a distinction between 'pools' that should only happen after the sport is selected. Other sports can also have lifeguards if needed, this is not mandatory."

Decided 04-11-2026 (Rui): do it now — key the duty on the recinto, filter by sport.

**Not in scope:** a lifeguard *requirement* for non-pool sports (coverage gaps stay a pool question); ratios; the incident log.

### BA — rules
1. `lifeguard_duty.playing_area_id` is the duty's recinto; for a pool it equals the pool's recinto (`pool_area_ensure`), filled by trigger from `pool_id` as `*_area_from_pool` does. Exactly one of the two is the source; `pool_id` stays for every pool reader.
2. The Nadadores-salvadores week (POOLSE-96) opens on a sport chooser in a multi-sport club and lists the recintos of that sport; a single-sport club opens on its sport.
3. `lifeguard_gaps()` is computed for pools only — unchanged; a court shows duties and no gaps, and the screen says *sem cobertura obrigatória*.
4. The lifeguard qualification rule (`counts_as_lifeguard`) applies whatever the sport.
5. `/dashboard/staff/lifeguards?sport=` reads `readSportFilter`; the entry becomes `perSport: 'copy'` so it appears in each sport's group and the palette.

### Dev notes
- Migration (`write-migration`): add column + composite FK `(organization_id, playing_area_id)`; backfill from pools; re-create the same-person exclusion on `playing_area_id` (keep the pool one until readers move, then drop in a follow-up). Update `docs/data-model.md` §lifeguards.
- `lifeguard_valid_on` unchanged. `lifeguard_gaps` keeps reading `pool_id`.
- Trap: `incident.lifeguard_membership_id` joins the duty by pool — leave it.
- Nav: `nav-entries.ts` entry + `ACTIONS` synonyms (*nadador salvador*, *vigilância*).

### QA
1. Given a pool duty insert with only `pool_id`, when it commits, then `playing_area_id` equals the pool's recinto.
2. Given a court duty, when inserted, then no `pool_id` and the same-person overlap on that court is refused.
3. Given a two-sport club, when the week opens, then the sport chooser shows first and the grid lists only the chosen sport's recintos; the palette lists one entry per sport.
4. Given a pool-only club, then no chooser and the grid is unchanged (snapshot).
5. Given instructor scoped to Ténis (POOLSE-145), when `?sport=pool`, then 403 `sport_not_yours`.
6. Cross-tenant `playing_area_id` → refused by FK.
7. Both themes.

### Acceptance criteria
- [ ] Duty keyed on the recinto, pool duties filled by trigger.
- [ ] Week filtered by sport; coverage gaps remain pool-only and the court says so.
- [ ] Menu copy per sport, palette updated.
- [ ] data-model.md updated; tests above.
