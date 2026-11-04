# POOLSE-167 · Competição's children (Provas, Mínimos, Escalões) show in the sidebar under the sport, not only inside the page

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Bug · **Area:** Navigation / Students · **Priority:** Medium (pilot) · **Depends on** [POOLSE-143], [POOLSE-125] · **Unblocks** —

### PO — why this exists
Rui, 04-11-2026: "On 'Students' – sports tab – 'competition' menu does not have the submenus on the left menu bar, only the ones inside."

**Not in scope:** the competition pages themselves.

### BA — rules
1. In a sport's group the *Competição* entry expands to its three children, as it does in the shared group; the current child is highlighted.
2. The palette lists the three children per sport (it reads the same entries).
3. A sport without a competition model shows none (`COMPETITION_SPORTS`).

### Dev notes
- `groupBySport` in `nav-entries.ts` probably copies the entry without `children` — fix there, once, and add a unit test that a per-sport copy keeps its children.
- Trap: `badgePerSport` splits the meet-inbox circle; keep it on the parent.

### QA
1. Given a pool club, when Natação's group renders, then Competição has three children and `/provas/minimos` highlights Mínimos.
2. Given a tennis-only sport group, then no Competição.
3. Palette search *mínimos* → the Natação copy.

### Acceptance criteria
- [ ] Children present and highlighted in the per-sport group.
- [ ] Unit test on `groupBySport`.
