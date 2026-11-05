# POOLSE-174 · *Início* is the next lesson — one hero card per child that opens the lesson, with the water and the fee line; the two-week list moves to *Aulas*

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Mobile app / Family · **Priority:** Medium (pilot) · **Depends on** [POOLSE-136](./POOLSE-136-the-app-phone-shell.md), [POOLSE-90](./POOLSE-90-the-app-agenda-per-role.md), [POOLSE-173](./POOLSE-173-the-family-app-feels-playful.md) (the hero's look) · **Unblocks** [POOLSE-175](./POOLSE-175-aulas-is-a-calendar.md)

### PO — why this exists

Rui, 05-11-2026: *"on mobile, for student view, 'inicio' menu should only display the next class, and some details of the water temperature etc, we had this on a mobile template, why is not working? 'inicio' next class should be clickable for the student to see whos going, whos the teacher, whats the training etc."*

What is on screen today (`app/familia/page.tsx`) is the handoff's child card — avatar, name, *Próxima: Qua 5 · 18:00 · Golfinhos* — followed by **every** coming lesson for two weeks as rows, then *Pedir inscrição*. The card is not a link unless the family has several children, and then it only narrows the list (`?child=`). The water temperature sits on each row, not on the card. So the template was built, but the home still reads as a list, and the one thing a child wants to tap does nothing. This ticket makes the home one answer per child — *when is the next one, is the water warm, are we paid* — and one tap deep is the lesson.

**Not in scope:**
- The calendar and the list of coming lessons: they move to *Aulas* (POOLSE-175). Until 175 lands, the rows stay below the hero so nothing is lost.
- Changing what `GET /app/agenda` answers: everything the hero needs is already in it (next entry, `water`, `balance`).
- The lesson's plan read (`GET /sessions/:id/plan`) and `familyMayReadPlan` — unchanged.
- Showing other children's names to a family by default (rule 6).

### As built (05-11-2026) — wins over what follows

- **Two additions to the API the plan did not expect:** `closedUntil` on an agenda entry, from `pool_closure_at`, because the agenda had no end date; and `count` on `GET /app/lessons/:id`, numbers only.
- **POOLSE-173 is not built,** so the hero uses the app's `bg-primary` / `text-primary-foreground`, a pair already in `check-contrast.mjs`. Its own colour block lands with 173.
- **The class-mates setting (rule 6) is not built:** the count ships alone, the ticket's default.
- **The fee line is a link of its own beneath the hero,** because a link cannot hold a link.

### BA — rules

1. **One hero per child, the next lesson first.** For each child in the agenda, the hero is the first coming entry that is not cancelled: day in words (POOLSE-107's `formatDayMonth`), time, turma, tank. A child with nothing coming shows *Sem aulas marcadas* and, when there is a closure, *Encerrado até dd-MM-yyyy*.
2. **The hero is the lesson's link**, always — one child or several. It opens `/app/familia/aulas/:sessionId` with `from=/app/familia`. The child filter (`?child=`) stays as a row of chips above the heroes for a family with several children; the hero itself never narrows the list.
3. **Water on the hero.** The tank's latest temperature and its age (*27 °C · medida há 4 h*), from `agenda.water` by the entry's `poolId`. None when water quality is off or the entry has no tank — the line is absent, not a dash.
4. **Fees on the hero.** One line from `balance` on the fee read, the same three sentences the *Pagamentos* tab uses (*Em dia* / *Por pagar … até* / *Em dívida*), linking to *Pagamentos*. The line is the only money on *Início*.
5. **The lesson page answers "who's teaching, what's the training".** It already carries the instructor (`resolved_instructor_id`, named) and the plan where `familyMayReadPlan` allows it. Both move above *Vem à aula?* so a child sees them without scrolling.
6. **"Who's going" is a count, not a roll** (security call, 05-11-2026): *12 inscritos · 2 avisaram que não vêm*. Other children's names reach a family only when the club has turned on *Mostrar colegas de turma na app* in the facility's settings, and then as first name and initial, enrolled students only, never a guest or a reposição, never a child whose guardian has `can_view_progress = false`. **Open:** whether the pilot wants the setting at all; default **off**, and the count alone ships with this ticket. The setting is its own small ticket if asked.
7. **Order on *Início***: avisos (POOLSE-166), heroes, the fee line, *Pedir inscrição*. The list of rows leaves with POOLSE-175.

### Dev notes

- `app/familia/page.tsx`: replace the `<ul>` of child cards with a `NextLessonHero` (new, `components/app/next-lesson-hero.tsx`), server-rendered, taking `{ child, entry | null, water | null, balance }`. It is the first POOLSE-173 colour block — full-bleed app fill, ink text, radius `--app-radius-hero` — so land 173's tokens first or read them with a fallback.
- The link is `withFrom(…, '/app/familia')` exactly as the rows do, so *Voltar* on the lesson comes back here.
- The lesson page (`app/familia/aulas/[sessionId]/page.tsx`): reorder only — instructor and plan above the notice panel. The roll count comes from the register read the page already has for the notice count (`notComing`); add `enrolled` to `GET /app/lessons/:id` rather than a second call. **Do not** return names in that payload until rule 6's setting exists.
- Trap (POOLSE-140): the child card's secondary line was built with `t('app.family.next', …)` composing the day through `dayHeading`; keep `dayHeading` for the list and use `formatDayMonth` on the hero, never `Intl` with options.
- i18n keys: `app.family.hero.*` in both files; `pnpm i18n:check`.

### QA

1. Given a child with a lesson Wednesday 18:00 in tank A, when the family opens *Início*, then the hero says Wednesday's date in words, 18:00, the turma, the tank, the water temperature with its age, and tapping it opens that lesson's page.
2. Given two children, when *Início* opens, then there are two heroes, each tapping to its own lesson; the chips above narrow to one child and the hero still opens the lesson.
3. Given the next lesson is cancelled, then the hero shows the one after it; given every coming lesson is under a closure, then the hero says *Encerrado até dd-MM-yyyy*.
4. Given water quality is off for the club, then the hero carries no water line (snapshot).
5. Given the lesson page, then the instructor's name and the plan sit above *Vem à aula?*, and *12 inscritos · 2 avisaram que não vêm* appears; the raw JSON of `GET /app/lessons/:id` carries no other child's name.
6. Given another family's session id, when fetched, then 404 (cross-tenant and cross-family alike).
7. Light and dark: the hero's ink-on-fill pair is in `check-contrast.mjs` and passes.

### Acceptance criteria
- [x] One hero per child on *Início*: next lesson, water, fee line; the hero opens the lesson for one child or several.
- [x] The lesson page shows instructor and plan first, and a count of who is coming; no names by default.
- [x] Nothing is removed from *Início* before POOLSE-175 takes the list.
- [ ] `pnpm i18n:check` and `contrast:check` pass; QA 1–7 green.
