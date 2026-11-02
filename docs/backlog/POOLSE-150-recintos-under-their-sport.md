# POOLSE-150 · Each recinto lives under its sport, and a single-sport club shows its one sport tab

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Navigation / Facilities · **Priority:** Medium (pilot) — after the week of testing · **Depends on** [POOLSE-122](./POOLSE-122-recintos-typed-playing-areas.md), [POOLSE-125](./POOLSE-125-navigation-per-sport.md), [POOLSE-141](./POOLSE-141-sport-tabs-in-the-top-bar.md) · **Related** [POOLSE-123](./POOLSE-123-area-units-generalise-lanes.md)

### PO — why this exists

Rui, 02-11-2026: *"I think the 'Pools' items that are on 'facilities' right now, makes sense to move them to the swimming sport part. The same rule maybe applied for other sports, but instead of pools are like 'courts' or 'fields'. One tenant that only has one sport like swimming will keep the top navigation menu with only one sport."*

A pool is swimming's recinto as a court is tennis's (POOLSE-122). Today a tank is reached through *Instalações*, beside the building's spaces, inventory and staff, while everything taught in it (Turmas, Calendário, Níveis) sits in the sport's section. Putting the recinto in its sport's section puts the water next to the classes in it. Showing the one sport tab to a single-sport club gives a pool one home, whatever the number of sports, so switching a second sport on later moves nothing the club already knows.

**Not in scope:** bookable units for courts and pitches (POOLSE-123); a recinto's own page for a non-pool sport beyond what POOLSE-122 already shows; moving site-level things (spaces, maintenance, energy, inventory, staff) — they stay in *Instalações*.

### BA — rules

1. Each sport's section gains a **recintos** entry named in **the sport's own word** (Rui, 02-11-2026): *Piscinas* in Natação, *Campos* for ténis, padel, futebol, basquetebol, andebol and voleibol, *Salas* for ginásio; *Recintos* where none is set. One entry, `perSport: true`, filtered by the recinto's sport. **Grouped by site** when the club has more than one (Rui); a single-site club sees a plain list.
2. **The sport's section is the recinto's home** (Rui): its list adds, opens and edits tanks (or courts). The site page's *Piscinas* and *Recintos* tabs go, leaving a one-line link to each sport's list. **Instalações keeps the site**: its details, *Espaços*, maintenance, energy, inventory, incidents and staff.
3. **A single-sport business club shows its one sport tab** in the top bar (POOLSE-141), holding **exactly what a multi-sport club's Natação tab holds** (Rui): Calendário, Turmas, Alunos (filtered copy), Níveis, Avanços, Competição, plus Piscinas; the club's tab keeps Painel, Instalações, Energia, Receção, Faturação and the shared Alunos. This changes `groupBySport`'s gate from `isMultiSport` to "a business club with at least one sport". A personal tenant keeps today's menu.
4. **Nothing moves address**: every page keeps its URL, so bookmarks, `FromLink`'s `?from=` and the e2e specs' routes hold; only the menu and `sectionOf` change.
5. An instructor scoped to some sports (POOLSE-145) sees only their sports' tabs, as today.

**Open:** whether *Instalações* should keep a read-only list of every recinto across sports for the owner. Default taken: no — the site page links to each sport's list, with its count (built 02-11-2026).

### Dev notes

- `lib/nav-entries.ts`: a `recintos` entry with `perSport: true`; its page is a per-sport list (`/dashboard/facilities/pools?sport=` or a new `/dashboard/recintos?sport=`) reading `FacilityDetail.playingAreas` by sport.
- `groupBySport`: gate on business club + ≥1 sport; check `sectionOf` and `SportShell` for a single sport.
- The trap: every phone spec that walks the menu (`phone-*.spec.ts`) assumes a pool-only club has no sport tab — update them in the same change, and add one walk of the single tab.

### QA

1. Given a pool-only club, then the top bar shows Natação, and Natação holds Turmas, Calendário and Piscinas.
2. Given swimming and tennis, then Natação → Piscinas lists the tanks and Ténis → Recintos lists the courts, and neither lists the other's.
3. Given any page's old URL, then it still opens (rule 4).
4. Given a tennis-only instructor, then only Ténis shows (POOLSE-145).
5. Given a personal tenant, then its menu is unchanged.
6. Both themes; a phone walk of the menu.

### Acceptance criteria

- [x] A recintos entry per sport; tanks under Natação.
- [x] A single-sport business club shows its one sport tab.
- [x] No URL changes; phone specs updated.
- [x] `docs/features/navigation.md`, `docs/features/facilities.md`, `CLAUDE.md` (the menu paragraph).
