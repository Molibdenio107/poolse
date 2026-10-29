# POOLSE-127 · The app: one person, a tab per sport, child-first for a guardian, one invoice

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Mobile app / Students / Billing · **Priority:** Low (post go-live) · **Depends on** [POOLSE-122](./POOLSE-122-recintos-typed-playing-areas.md), [POOLSE-124](./POOLSE-124-sport-modules-and-billing.md), [POOLSE-90](./POOLSE-90-the-app-agenda-per-role.md), [POOLSE-126](./POOLSE-126-levels-and-seasons-per-sport.md)

### PO — why this exists

Rui, 28-10-2026: *"a student can be a pool user but they can also play tennis. It should be the same student on the same database... a parent can have each child on both sports; a parent has to pay for both services and access both views."*

Nothing new in the data: a person is one `membership`; enrolments, passes and fee lines each reach a recinto and so a sport. This ticket is the app's presentation of that.

**Not in scope:** sport-specific stats (swim speed, tennis match history) — each is its own ticket when its sport ships; in-app payment (POOLSE-121's open point).

### BA — rules

1. The app's home shows a tab per sport the person (or, for a guardian, any of their children) has a live enrolment or pass in, among the club's enabled sports. One sport: no tabs, today's screen.
2. A guardian's view is **child first, then sport within the child** — the child cards POOLSE-90 draws, each with its sports beneath.
3. The agenda, *Vou / Não vou*, reposições and feedback filter by the selected tab; the calendar is one engine.
4. Payments and profile are shared across tabs: one payer invoice lists every enrolment, grouped by child then sport, extending today's sibling grouping.
5. Push notifications name the sport when the person has more than one.

### Dev notes

- Tabs derive from `GET /me/sports` (enrolments ∪ passes → recinto → sport), no stored preference.
- Invoice grouping: a `sport` sub-group on the existing payer invoice render; no schema.

### QA

1. One sport: the app renders as today (snapshot).
2. A child in swim and padel: two tabs under the child; a sibling in swim only: one.
3. The invoice lists both children's lines grouped child → sport, one total.
4. *Vou / Não vou* on a padel lesson writes against that session only.

### Acceptance criteria

- [ ] Sport tabs derived, child-first for guardians.
- [ ] One invoice, grouped.
- [ ] Unchanged for a single-sport person.
