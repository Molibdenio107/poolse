# POOLSE-211 · The dashboard opens the page where the problem is: turmas with no teacher on Turmas, water on Piscinas

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Dashboard / Turmas / Attention · **Priority:** High (pre go-live) · **Depends on** POOLSE-120 (attention), POOLSE-150 (recintos page) · **Unblocks** POOLSE-212

### PO — why this exists

Rui, 10-11-2026: *"'dashboard' - when clicking 'sem professor' it should go to 'turmas'. Then the screen 'turmas' should have a blinking notification for the ones without professor. (good quality of life would be adding a filter for the turmas without instructor). 2. then on 'dashboard' again, 'instalações' should have in consideration each sport (on the facility) and if its 'swimming', when clicking 'ver instalações' it should go to the 'pools' page."*

The *Sem professor* tile counted today's lessons and opened the calendar, which answers a different question ("who covers today?") from the one the office acts on ("which turmas have nobody?"). The water card's *Ver instalações* opened the site list, two clicks from the tanks it was about.

**Decided (Rui, 10-11-2026):** the tile counts **turmas** without a teacher and opens *Turmas* filtered to them; today's uncovered lessons stay a line in the *Hoje* card, which opens the calendar. Only the water card goes to the sport's page; *Avarias* stays on *Instalações*.

**Not in scope:** the notification bell (POOLSE-212); a per-lesson cover workflow (the calendar's *Marcar como sem professor* is unchanged); partnerships (a parceria brings its own teacher and is never "without").

### BA — rules

1. **A turma without a teacher** is a turma the Turmas page lists (its season not archived, **a draft season included**: Rui, 10-11-2026, staffing next season is work to do now), not archived, whose own `instructor_membership_id` is null: the rule the turma cards already use (`state === 'noInstructor'`). One definition, in SQL, read by the tile, the filter, the dots and POOLSE-212.
2. **The dashboard tile** *Sem professor* shows that count, opens `/dashboard/classes?instructor=none`, and says *Todas com professor* at zero.
3. **Turmas** gets a *Professor* filter: *Todos* / *Sem professor*, in the URL (`?instructor=none`), applied to the list and to the cards.
4. **A breathing dot** (`.attention-dot`) sits on every turma without a teacher, in the list and on its card, and on *Turmas* in the menu (`attention.menu.classes`, and `classes:<sport>` for a sport's copy). It clears the moment a teacher is assigned: no "seen" record.
5. **Only who can act is told:** the office (owner, admin). A teacher is not told about turmas they cannot staff.
6. **The water card's *Ver instalações*** opens the swimming recintos page (`/dashboard/recintos?sport=pool`, *Piscinas*), with the site filter when the dashboard is scoped to one site.
7. **Ctrl+K** gains *Turmas sem professor*.

### Dev notes

- `attention.repository.ts`: a `classes` kind (scope `classes: boolean`, office only) counting `class_group` rows by rule 1 and by sport (`playing_area.sport_id`), plus `out.classGroups[id] = 1` so the page can dot each turma. The shell carries it like the others.
- Dashboard: `management.repository.ts` gains `turmasWithoutInstructor` (same SQL as the attention count, one helper); `summary-band.tsx` reads it.
- Turmas page: `?instructor=none` filters `data.groups`; `FilterSelect` as the recinto filter is. `AttentionDot` on the list row and the card.
- `widgets.tsx` `WaterCard` href.
- The trap: `cs` means `class_schedule` and a join to `class_group` drops partnerships; this count reads `class_group` only, so partnerships never appear.

### QA

1. Given a turma with no teacher this season, when the owner opens the dashboard, then *Sem professor* says 1 and opens Turmas showing only that turma, with a breathing dot.
2. Given that turma, when a teacher is assigned, then the dot, the menu dot and the count clear on the next page load.
3. Given an instructor, when they read attention, then `classes` is absent.
4. Given an archived turma or an archived season's, then it is not counted; a draft season's is.
5. Given a parceria with its own teacher, then it is never counted.
6. Given the water card, when *Ver instalações* is pressed, then *Piscinas* opens.
7. Light and dark: the dot is the shared token and is still under reduced motion.

### Acceptance criteria

- [ ] One SQL definition of a turma without a teacher, read by the tile, the attention map and the filter.
- [ ] Tile → `/dashboard/classes?instructor=none`; the filter works on list and cards.
- [ ] Breathing dots on the turmas and on *Turmas* in the menu, office only, clearing when solved.
- [ ] Water card → *Piscinas*.
- [ ] Ctrl+K entry; pt-PT and en; attention integration test for rules 1, 3, 4, 5.
