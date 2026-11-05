# POOLSE-185 · A child sees their progress in the app: skills as stickers and attendance as stamps, on a *Progresso* section of *Aulas*

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Mobile app / Family / Skills · **Priority:** Medium (pilot) · **Depends on** [POOLSE-173](./POOLSE-173-the-family-app-feels-playful.md), [POOLSE-175](./POOLSE-175-aulas-is-a-calendar.md), [POOLSE-20](./POOLSE-20-four-state-skill-progress.md), [POOLSE-13](./POOLSE-13-attendance-states-colour-scheme-drop-the-static-atrasado.md)

### PO — why this exists

Rui, 05-11-2026, on POOLSE-173: *"The visual feel of the mobile app to the students should also be more playful, more kid friendly."* That ticket's rules 8 and 9 turn skills into stickers and attendance into stamps, and it could not ship them: no app-mode screen shows either, and it allowed no new API. Rui's call, 05-11-2026: a ticket of its own, after POOLSE-175, since *Aulas* is its natural home.

The rules for how a sticker and a stamp look are POOLSE-173's rules 8, 9 and 12, and are not repeated here.

**Not in scope:**
- Points, streaks, confetti or a league of any kind (POOLSE-173).
- A family marking anything. Skills and attendance stay the staff's to write.
- Other children's progress, in any form.
- Swim times and meets: `GET /students/:id/progression` already answers a family, and its screen is a separate question.

### BA — rules

1. **One child at a time.** *Progresso* sits on *Aulas*, under POOLSE-175's calendar, and follows the `?child=` chips. With several children and none chosen it shows the first.
2. **The level first.** The child's level, as POOLSE-173's 64 px badge. One per sport the child holds a level in (POOLSE-148).
3. **Skills as stickers.** The skills of the child's current level, each with its name beneath it. *Not applicable* is hidden, and a level with no skills defined shows no section.
4. **Attendance as stamps.** Each turma's recent lessons, with the count beside them. Present, absent and not marked are told apart by the ring and the icon. *Justificada* is the register's fourth state and POOLSE-173 gave it no stamp: it takes the absent stamp's ring with its own icon.
5. **A family reads only its own child.** Anybody else is a 404, the answer `requireActsForStudent` gives a stranger.
6. **A club with no skills defined** for the child's level shows no sticker section, rather than an empty one. Skills are core, not a module.

**Open:** `guardian_link.can_view_progress` exists, defaults to false, and no code reads it. Honouring it as it stands would hide progress from every guardian. Default: do not read it here, as the family's own attendance read does not, and say so in the docs. Rui to confirm before this is built, because POOLSE-174's rule 6 also names it.

### Dev notes

- **Attendance needs no API work.** `GET /students/:id/attendance-recent` (`RecentAttendanceController`) already answers a family through `requireActsForStudent`, marks and absences included. `recentAttendanceFor` is the read. `agenda.recent` is not: it holds attended lessons only.
- **Skills need one read.** Every route on `skills.controller.ts` is staff only, so a family has none. Add `GET /students/:id/skills` behind `requireActsForStudent`, or a `skills` part on an app route, marked `@CoreRoute()` as `skills.controller.ts` is. Reuse the query behind the turma grid rather than writing a second definition of a skill's state. **A new endpoint gets a line in `security/role-probe.integration.test.ts`.**
- **It must not widen `GET /skills/turma/:classGroupId`.** That read carries a whole turma; opening it to families would hand them every classmate's marks.
- `Selo` and `Stamp` go in `apps/web/src/components/app/`, each taking the state enum and a label. New pairs go in `check-contrast.mjs` `PAIRS`.
- `.ms` and Material Symbols do not exist here: icons are `lucide-react` (POOLSE-173, *As built*).
- Trap (POOLSE-173): a Playwright `fullPage` screenshot drops the coarse-pointer look. Check the soft style with a viewport shot.

### QA

1. **Given** a child with skills in all four states, **then** three distinct stickers with names, and *not applicable* hidden; a screen reader reads the state from the label, not the colour.
2. **Given** a child with present, absent, excused and unmarked lessons, **then** four distinct stamps and the count; the assertion is on the icon and the ring.
3. **Given** two children, **when** the chips change, **then** progress follows the chosen child.
4. **Given** another family's child, **when** the read is called directly, **then** 404; **given** a child of another club, **then** 404.
5. **Given** an unlinked guardian and a student calling the skills read for somebody else, **then** the role probe refuses both; the raw JSON carries no other child's name.
6. **Given** a level with no skills defined, **then** the section is absent and the stamps still show.
7. **Given** a laptop, **then** the section reads at the app's sharp scale; **given** reduced motion, **then** no pop.
8. Light and dark, AA; `phone-app.spec.ts` green on both phones.

### Acceptance criteria

- [ ] `Selo` and `Stamp` built and wired to real skill states and attendance marks.
- [ ] One new family read for skills, scoped to the reader's own child, with cross-family and cross-tenant denials and a role-probe line.
- [ ] `GET /skills/turma/:classGroupId` is unchanged.
- [ ] The `can_view_progress` question is answered and written down.
- [ ] Light and dark AA; reduced motion respected.
