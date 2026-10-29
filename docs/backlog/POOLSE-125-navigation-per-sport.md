# POOLSE-125 · Navigation: one main-menu group per enabled sport, the rest stays the site's

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Navigation / Facilities · **Priority:** Medium (shell before go-live, sport screens after) · **Depends on** [POOLSE-122](./POOLSE-122-recintos-typed-playing-areas.md), [POOLSE-124](./POOLSE-124-sport-modules-and-billing.md), [POOLSE-118](./POOLSE-118-command-palette.md) (`nav-entries.ts`)

### PO — why this exists

Rui, 28-10-2026: each sport gets *"a separate main screen containing energy, calendar, classes, all that we use for Poolse that we can recycle, plus extra fields that might be needed."* The recycling must be real: one calendar engine, one bookings engine, one fees engine, each called with a recinto filter — never a copy per sport. A bug fixed in the pool calendar is fixed everywhere.

**Decided 10 — the split.** Per sport: Calendário, Turmas, Recintos (the pool page today), the sport's metrics (water quality for pools), Reposições. Facility-level, shared: Dashboard, Alunos/Membros, Staff, Mensalidades, Faturação, Receção, Energia (the roll-up, POOLSE-128), Competição, Mensagens, Incidentes, Configuração, Espaços/Inventário.

**Decided 11 — the pilot sees nothing.** With only `pool` enabled the sidebar is byte-for-byte today's. The sport group renders only when a second sport is on.

**Not in scope:** any sport-specific metric screen; the court grid (POOLSE-123 rule 4 and a later ticket).

### BA — rules

1. `nav-entries.ts` entries gain an optional `sport` scope. An entry with a sport renders inside that sport's group; an entry without one is facility-level, as today.
2. With one enabled sport, groups collapse: the sport's entries render at the top level under today's labels (*Piscinas*, *Calendário*, *Turmas*). With two or more, each sport is a collapsible group labelled by the sport (*Piscina*, *Ténis*), ordered by `sport.position`, and the shared entries follow.
3. The calendar, turmas list and recintos list take `?sport=` and show only that sport's recintos and bookings. A URL without it, reached from the shared Dashboard, defaults to the reader's first enabled sport.
4. Attention circles (POOLSE-120) travel recinto → site → the sport's group, not the shared menu, so a padel court's warning does not light up *Piscina*.
5. The command palette offers each sport's entries with the sport in the label when there are two or more.
6. Mobile (POOLSE-90) is out of scope here; POOLSE-127 covers the app.

### Dev notes

- Everything is a filter on `playing_area.sport_id`; no route duplicates. `GET /calendar`, `GET /class-groups`, `GET /facilities/:id/playing-areas` gain `sport` as a query param validated against `/me.sports`.
- The single-sport collapse is a render rule in `app-sidebar.tsx` and the phone menu, not a second entries list.
- Snapshot test the pool-only sidebar before and after.

### QA

1. Given `{pool}`, then the sidebar snapshot is identical to before this ticket.
2. Given `{pool, tennis}`, then two groups appear in `sport.position` order, shared entries after them, and *Piscinas* is relabelled *Piscina* inside its group.
3. Given `?sport=tennis` on the calendar, then only tennis recintos and their bookings are drawn.
4. Given a warning on a court, then the circle lights the tennis group and the site, not the pool group.
5. The palette lists *Calendário · Ténis* and *Calendário · Piscina* distinctly.
6. Both themes, keyboard navigation through collapsed groups.

### Acceptance criteria

- [ ] `sport` scope on nav entries; single-sport collapse proven by snapshot.
- [ ] `?sport=` filter on the three list endpoints with validation.
- [ ] Circles scoped to the sport group.
