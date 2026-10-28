# POOLSE-120 · Circles that say where something needs doing — and travel up to the menu

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Navigation / Facilities / Students · **Priority:** Medium (pilot) · **Depends on** [POOLSE-66](./POOLSE-66-role-aware-dashboard.md) (the dashboard's resolvers, same facts), [POOLSE-72](./POOLSE-72-national-water-reference-and-lab-grading.md), [POOLSE-69](./POOLSE-69-online-pre-registration.md), [POOLSE-90](./POOLSE-90-the-app-agenda-per-role.md) (notices), [POOLSE-116](./POOLSE-116-lesson-feedback-from-the-family-app.md)

### PO — why this exists

Rui, 28-10-2026: a warning inside a pool should show on the pool's name; a site with a warning inside should show it too, and so should the menu, *like a notifications menu*. Small circles already exist (a tab's dot, *Recebidos por email*'s count), but they say nothing above the page they sit on, and none of them pulses.

**Not in scope:** buying free swim or enrolling from the phone (POOLSE-121); push or email for any of this (the circle is on screen only); a notification list or inbox page.

### BA — rules (decided by Rui, 28-10-2026)

1. **A circle means "needs doing", and clears when it is done** — not "new since I looked". There is no per-person *seen* record: when a colleague answers the pre-registration, the circle clears for everybody.
2. **What raises one:**
   - **Pre-registrations** waiting for an answer → *Alunos → Pedidos*, and *Alunos*.
   - **Water**: a pool whose latest reading is out of its band, or whose latest lab report is *não conforme* → the pool, its site, *Instalações*.
   - **Maintenance**: an overdue recurring task, or an open fault of high severity, on a pool or a space → the pool or space, its site, *Instalações*.
   - **Families' answers** (*Não vou* on a lesson still to come, feedback written in the last 7 days) → the lesson on the calendar and *Calendário*, for the teacher of that class only.
3. **It travels up.** A pool's circle shows on the pool's name in the site's *Piscinas* list. The site shows it on its card in *Instalações* and on its own tab. The menu entry shows it too, and a section shows it when any child entry has one. One fact, every level, never a second computation.
4. **Only who can act sees it.** Water and maintenance: owner, admin, maintenance. Pre-registrations: owner, admin. Families' answers: the teacher of that class (`resolved_instructor_id`); owner and admin also see the calendar's count. A role with no circle sees the page exactly as today.
5. **Modules apply.** A circle belonging to a module that is off is never raised (`moduleIsOn`).
6. **Every circle pulses three times as it appears, then stays still**, and not at all under reduced motion (`.attention`, CLAUDE.md). This includes the existing tab dots and the *Recebidos* count.
7. **Never colour alone.** A circle carries a count where there is one, and the item's own words say what it is (*2 pedidos por responder*, *pH fora do intervalo*). A circle with no visible words beside it has an `sr-only` sentence.

### Dev notes

- **One server read.** `GET /attention` answers a map the layout reads once per page, as it reads `menuBadges` today: `{ menu: Record<menuKey, number>, facilities: Record<facilityId, number>, pools: Record<poolId, number>, spaces: Record<spaceId, number> }`. One grouped query per kind, never a loop over sites (the dashboard's rule), each filtered by the reader's roles and modules before it runs.
- Reuse the dashboard's definitions, never a second one: out-of-band from `excursions()` / `resolveBands`, *não conforme* from `gradeLabResult`, overdue from the SQL the maintenance band uses, pending leads from the Pedidos count.
- `badge` on a menu item in `lib/nav-entries.ts` generalises from `'meetInbox'` to the attention keys; a parent shows a dot when any child has one. Site cards and pool rows take a small `AttentionDot` component (count or dot, `.attention`, sr-only text).
- Role probe: one line for `GET /attention`, asserting a guardian and a student get an empty map rather than a 403, because the layout asks for everybody.

### QA — scenarios

1. **Given** a reading out of band on Piscina 2, **then** a circle shows on Piscina 2 in the site's list, on the site's card in *Instalações*, and on *Instalações* in the menu, for owner, admin and maintenance. An instructor sees none.
2. **Given** a new reading back in band, **then** every one of those circles is gone on the next page load.
3. **Given** two unanswered pre-registrations, **then** *Pedidos* shows 2 and *Alunos* shows a dot, for owner and admin. Answering one leaves 1.
4. **Given** a family says *Não vou* for tomorrow's lesson, **then** that lesson's teacher sees a circle on *Calendário*, and another instructor does not.
5. **Given** the competition module off, **then** *Recebidos* raises nothing. **Given** water quality off, **then** no water circle anywhere.
6. **Given** reduced motion, **then** no circle moves. Otherwise each pulses three times and stops.
7. pt-PT and en, light and dark, keyboard and screen reader (the sr-only sentence is read).

### Acceptance criteria

1. One server read gives the circles. They travel from pool and space to site to menu, with the same count at every level.
2. They clear when the thing is done, and appear only for roles that can act, in modules that are on.
3. Every circle, the existing ones included, pulses three times, then stays still; none under reduced motion; never colour alone.
