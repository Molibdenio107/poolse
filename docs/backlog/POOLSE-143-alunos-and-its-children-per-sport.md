# POOLSE-143 · Alunos, Níveis, Avanços, Competição and Pedidos join each sport's group as filtered views of the shared pages

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Navigation / Students · **Priority:** Low (post go-live; invisible to a pool-only club) · **Depends on** [POOLSE-125](./POOLSE-125-navigation-per-sport.md), [POOLSE-126](./POOLSE-126-levels-and-seasons-per-sport.md), multi-sport Slice 3 (`?sport=` on `GET /students`) · **Unblocks** [POOLSE-145](./POOLSE-145-instructor-scoped-to-sports.md)

### PO — why this exists

Rui, 01-11-2026: *"Students menu could also make sense to add on each sport separator, filter by which students attend that sportId … it might be a recycle/reuse but with some more logic. Even some submenus might make sense to add on each sport and not on the facility main page."*

POOLSE-125 Decided 10 put Alunos, Competição and Receção in the shared block. This ticket moves part of that: a student is one record (Slice 3: *a student's sport is their turma's recinto, never their level*), so a sport's *Alunos* is the shared register pre-filtered, never a second screen. Some of Alunos' children are more sport-bound than the parent: levels are per sport by POOLSE-126, so Níveis and Avanços belong in the sport group outright; Competição is FPN swimming and exists for no other sport yet.

The rule this ticket sets, for every later menu question (Rui, 01-11-2026): **a facility-level item whose rows carry a sport gets a filtered copy inside each sport's group; an item whose data is sport-specific moves into the group; an item with no sport dimension stays shared.**

**Not in scope:** any restriction on *who* sees which sport's students (POOLSE-145); a competition model for any sport but swimming; Receção per sport (ask the pilot whether the desk sells anything per sport before deciding); Mensagens by sport and qualification types per sport (POOLSE-146); the app (POOLSE-127).

### BA — rules

1. A sport's *Alunos* lists the students with an **active** enrolment this season in a turma whose recinto has that sport — the register's existing `?sport=` filter. A student in two sports appears in both groups and opens the same record. (Decided, Rui 01-11-2026: enrolment-derived, no sport column on the student.)
2. The shared *Alunos* stays, and gains a *Sem modalidade* chip: students with no active enrolment (new, paused, between seasons) belong to no sport group and are found only there. The chip exists only for a multi-sport club.
3. *Níveis* and *Avanços* move into the sport group (`perSport`), listing that sport's ladder and that sport's proposals. They leave the shared Alunos; with one sport on, they render where they do today.
4. *Competição* (Provas, Mínimos, Escalões) moves into the sport group **and renders only for sports that have a competition model**: a new `sports: readonly PoolseSport[]` scope on `Item`, set to `['pool']`. A sport without one shows no entry, never an empty page — a menu never offers a screen that would refuse (15-10-2026). Adding a sport later is adding it to that list and building its page. No shared `competition` table is built for a sport nobody has requirements for.
5. *Pedidos* gets a filtered copy per sport. A lead's sport is derived: its `requested_class_group_id`'s recinto, else its `level_id`'s sport, else none. The shared *Pedidos* keeps every lead, with the *Sem modalidade* chip for leads with neither. No new column.
6. The public form (POOLSE-69) offers a sport only when `isMultiSport`, which narrows the levels it lists; a pool-only club's form is byte-for-byte today's.
7. The `leads` circle (POOLSE-120) splits per sport group, as POOLSE-125 rule 4 does for recintos; the shared entry carries the leads with no sport.
8. *Encarregados* and *Mensagens* stay shared: a guardian is child-first (POOLSE-127), a message is audience-based. *Mensalidades* needs nothing — a plan priced by a level is per sport already; inscrição, seguro and quota are per season or age and stay shared. Say so in `docs/features/navigation.md` so nobody duplicates the price list per sport.
9. With only `pool` on, nothing changes: sidebar snapshot identical (POOLSE-125 Decided 11).
10. `?sport=` on every list this ticket touches is validated against `/me.sports` (POOLSE-125 Dev). **It is a convenience filter, not an authorisation boundary** — an instructor may still ask for another sport's students, exactly as today, until POOLSE-145.

**Open:** whether the per-sport *Alunos* should also take the group's wash (`SportShell`) when reached from the sport tab. Default: yes, it is the sport's page.

### Dev notes

- `lib/nav-entries.ts`: `perSport` on students, levels, advancement, leads, competition; new `sports?: readonly PoolseSport[]` scope read by `groupBySport` — an entry whose `sports` excludes the group's sport is skipped for that group. Snapshot the pool-only sidebar before and after.
- `GET /students` already takes `?sport=` (Slice 3). `GET /leads` gains it; the derivation is one SQL expression over `requested_class_group_id → class_group → playing_area.sport_id` else `student_level.sport_id`, written once in `leads.repository.ts` and reused by the attention count.
- `GET /students/levels`, `GET /advancement` gain `?sport=`; both already join `student_level.sport_id` (POOLSE-126).
- `public_lead_form()` returns `sports` beside `levels` only when the club is multi-sport; `submit_lead` accepts a `sport` only to filter the level it stores — the lead row is unchanged.
- The trap: the lead's sport must be derived in one place. POOLSE-125 rule 4 and the shared chip count must agree on which leads have no sport.
- No migration.

### QA

1. Given `{pool}`, then the sidebar snapshot equals POOLSE-125's.
2. Given `{pool, tennis}` and a student enrolled in both, then they appear under *Piscina › Alunos* and *Ténis › Alunos* and both open `/students/:id`.
3. Given a student with no active enrolment, then they appear under shared *Alunos › Sem modalidade* and in neither sport group.
4. Given `{pool, tennis}`, then *Competição* appears under *Piscina* and not under *Ténis*; `/students/provas?sport=tennis` is a 404 page, not a blank one.
5. Given a lead naming a tennis turma and one naming nothing, then the tennis group's *Pedidos* circle counts 1 and the shared chip counts the other.
6. Given `?sport=padel` on a club without padel, then 400, and a stranger's organization sees no lead of ours (cross-tenant).
7. Given an instructor, then `GET /students?sport=tennis` answers as today (rule 10 holds until POOLSE-145).
8. Both themes; keyboard through the groups.

### Acceptance criteria

- [ ] `perSport` on the five entries; `sports` scope; pool-only snapshot unchanged.
- [ ] *Sem modalidade* chip on Alunos and Pedidos, multi-sport only.
- [ ] Lead sport derived in one SQL expression, read by the list and the circle.
- [ ] Public form offers a sport only when multi-sport.
- [ ] `docs/features/navigation.md` states the facility/sport placement rule (PO).
