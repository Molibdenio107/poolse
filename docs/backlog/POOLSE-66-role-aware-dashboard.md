# POOLSE-66 · Role-aware dashboard — a banded widget registry

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Dashboard / Global · **Priority:** High · **Slices:** five, each ending working

**Filed as 66, not 43.** The ticket arrived numbered 43, which is
[lanes as rows on a pool](./POOLSE-43-lanes-as-rows-on-a-pool.md) and was built in the ocupação
wave. 66 is the next free number.

### PO — why this exists

The dashboard is the home route and the first menu item: sign-in lands here, the logo comes
back here. It shows management content, so for an instructor, a maintenance technician or a
family it is a page about somebody else's job.

**The fix is not four dashboards.** A person holds several roles — POOLSE-17 is the whole
reason `membership_role` is a table — and a club owner who also teaches on Tuesdays is
ordinary here. So the page is a **union of bands**, each rendered only if the reader holds a
role in it, in a fixed order.

**Out of scope, and do not helpfully build them:** widget customisation (drag to reorder, hide
a widget), **new** energy-module widgets, push notifications, new chart types. If per-person
layout is wanted later it is one `dashboard_widget_prefs` table keyed on the person, and the
registry already makes that a small change.

### BA — the rules

**Three bands, always in this order**, each rendered only if the reader holds a role in it:

| # | Band | Roles | What it answers |
|---|---|---|---|
| 1 | `management` | owner, admin | org-wide, aggregated |
| 2 | `operational` | instructor, maintenance | "my work today" |
| 3 | `personal` | student, guardian | "me and mine" |

Band order is **one array constant** and must be trivial to reorder. An owner who also teaches
sees the management band, then their next class. A maintenance-only user sees the operational
band at the top, so it reads as "the maintenance dashboard" without one existing.

**Role seniority already exists and is not re-declared.** The ticket arrived with a numeric
rank (owner 100 … student 10); `MEMBER_ROLES` in `apps/api/src/tenant/roles.ts` is that exact
order and is already load-bearing for POOLSE-17 AC5 and POOLSE-18 AC3. Ordering *within* a band
reads that array; nothing gets a second copy of the rule, and seniority governs **ordering only,
never permissions**.

**Density cap.** At most **4 widgets per band**, chosen by `priority`. Every card carries a
"ver todos" link to the real page: the dashboard is a launcher, not a replacement for the pages.

**Empty tenant.** Zero facilities → render **only** an onboarding checklist widget — create a
facility → add pools → define the price list → invite staff → import students. No empty cards.

**Facility scope.** A selector at the top, persisted per user, defaulting to **all facilities**.
`scope=all` aggregates tenant-wide; `scope=<uuid>` restricts to one. **The operational and
personal bands ignore it** and always resolve from the reader's own attachments.

**The instructor band carries no financial information of any kind** — no amounts, no arrears
flag on a roster. Fees stay owner and admin, which is the rule `canSeeValues` already applies to
the price list.

**The personal band is built now and shown later.** Resolvers and the API contract in this
ticket; the web UI behind `dashboard.personal_band` until the "do adult students get app logins
in v1" question lands. The student mobile app consumes this same endpoint, so **the contract is
the deliverable**.

A guardian with more than one dependent gets a dependent selector at **band** level; the
personal widgets resolve for the selected dependent. A person who is both a student and a
guardian — the senior case — sees their own widgets **and** the selector.

### Dev — where it goes, and what is most likely to be got wrong

**A widget registry, in code. No new tables.**

```ts
{
  id: 'inst.nextclass',
  band: 'operational',
  roles: ['instructor'],
  kinds: ['business'],      // as app-sidebar.tsx already spells it
  scope: 'facility',        // 'tenant' | 'facility' | 'self'
  size: 2,                  // columns, 1-3
  priority: 10,             // higher wins when the band is capped
  featureFlag?: string,
  resolver: (ctx) => data,
}
```

`ctx = { membershipId, organizationId, roles, facilityIds, scope, locale }`.

**`GET /dashboard?facility=all|<uuid>`** answers:

```json
{
  "scope": { "mode": "all", "facilityId": null, "facilities": [] },
  "bands": [
    { "id": "management", "order": 0,
      "widgets": [{ "id": "", "size": 2, "priority": 10, "state": "ok", "data": {} }] }
  ]
}
```

- Resolvers run in parallel through `Promise.allSettled` with a **per-widget 2s timeout**. A
  rejected or timed-out resolver yields `state: 'error'` **for that widget only** — never a
  blank page.
- `state: 'empty'` is a first-class rendered state, not an error.

**Authorization is server-side, in the resolver. Non-negotiable.**

- `roles[]` is checked **before** the resolver runs. A widget the caller may not see is
  **absent from the payload** — not hidden in the UI, not present-but-empty.
- Every resolver query is scoped by `organization_id`. Facility-scoped resolvers are
  additionally scoped to the facilities the caller is attached to.

**Aggregates are computed in SQL, one grouped query per widget.** This screen is the most
likely thing in the product to become its slow query once a tenant has several sites.

- `mgmt.occupancy.today` (including the *sem professor* count) and
  `mgmt.maintenance.open` / `mgmt.cleanings` are each **one grouped query**, aggregated in the
  database.
- **Never loop over facilities issuing one query per facility.** `scope=all` is exactly where
  that becomes N+1.
- Same for `mgmt.money.period`: one grouped query over fee lines, never a per-student or
  per-turma fan-out.
- **An index check is part of the slice**: every aggregate must hit an index on
  `(organization_id, facility_id, <date column>)`. A missing one is *proposed in one line*, not
  added silently.

#### Notes from the codebase, 22 September 2026

These are the places this ticket meets what is already built. None of them change what it asks
for; two of them change how much work it is.

- **The dashboard today is a server component composing four panels**, each with its own
  best-effort fetch: `OccupancyPanel`, `MyTasksPanel`, `EnergyCostsPanel` and `MyPoolPanel`.
  Three of the four map onto widgets in the catalogue below; `EnergyCostsPanel` does not, and
  "new energy widgets are out of scope" does not say what happens to the one that exists. See
  the open question.
- **`kinds` already exists as a concept** — `app-sidebar.tsx` items carry `roles` and
  `kinds: ['business']`, and a personal tenant is an ordinary tenant with fewer screens
  (slice 4.5, `docs/features/personal.md`). The registry should use **the same two keys with the
  same meaning**, so `organization.kind` stays read in two places rather than three.
- **Vocabulary.** The schema says `organization_id`, not `tenant_id`; roles are the lowercase
  `member_role` values; *encarregado de educação* is `guardian`.
- **"The facilities the caller is attached to" has no column.** For an instructor it is derived:
  `assignment.ts` resolves "is this mine" from three places — `class_group.instructor_membership_id`,
  the booking override on `class_schedule`, and `class_session.resolved_instructor_id` (so a
  substitute is the assigned instructor for the night they cover). `ctx.facilityIds` is the
  distinct facilities behind those, and for maintenance it is `maintenance_task.assigned_membership_id`
  plus what they reported.
- **There is no feature-flag infrastructure.** Every flag in this product is an environment
  variable read at the API (`WEATHER_HISTORY_ENABLED`, `STRIPE_SECRET_KEY`, `ANTHROPIC_API_KEY`),
  and roadmap P.4 deliberately does not queue a per-tenant flag table. `dashboard.personal_band`
  should be `DASHBOARD_PERSONAL_BAND` unless a per-tenant answer is wanted, which would be a
  ticket of its own.
- **The next-class widget must read `class_session`, not `class_schedule`.** The calendar draws
  the pattern overlaid with the week's own sessions; a widget built on the pattern shows the
  wrong hour for any week that was moved. `occurs_on` is where a week *lands* — CLAUDE.md, and
  `docs/decisions.md` under round 8.
- **A cancelled occurrence is `class_session.status = 'cancelled'`** — that table has no
  `archived_at`, and a query that copies the `cs` habit raises `42703` at runtime with nothing
  catching it.
- **A query-count assertion needs a test helper that does not exist yet.** One counting wrapper
  around the pool, in `test/harness.ts`. Small, and the QA list below rests on it.
- **The page max-width is already right**: `PageShell` caps every page at `max-w-page` and the
  calendar is the single `width="wide"` caller. The dashboard stays capped.

#### Answered 22 September 2026, before slice 1

Three questions the codebase raised. All three took the recommended answer; none is re-opened.

- **The energy-costs panel folds in as-is**, as `mgmt.energy.costs` in the management band,
  reusing the resolver it already has. "No **new** energy widgets" is what the out-of-scope line
  protects, and a panel on the page obeying a different rule from the rest is the worse outcome.
  It competes for the four-widget cap like everything else.
- **`kinds` on the registry entry**, spelled exactly as `app-sidebar.tsx` spells it. A personal
  tenant's management band is then simply the widgets that make sense there — `MyPoolPanel`
  becomes `me.pool` — and `organization.kind` stays read in two places, which is what slice 4.5
  promised. No fourth band, and no second architecture for one tenant shape.
- **`DASHBOARD_PERSONAL_BAND`, an environment variable at the API.** The house pattern —
  `WEATHER_HISTORY_ENABLED`, `STRIPE_SECRET_KEY`, `ANTHROPIC_API_KEY` — off by default, one line
  to turn on. A per-tenant flag table is roadmap P.4 and still waits for a reason.

### Widget catalogue

**management — owner, admin** (scope: tenant or the selected facility)

| id | content |
|---|---|
| `mgmt.subscription` | Trial days remaining / subscription state. Priority boosted when the trial has fewer than 5 days left. |
| `mgmt.money.period` | Mensalidades for the current period: total paid and total still to pay (reuse the existing period-total logic, bold the relevant one), plus total overdue. |
| `mgmt.occupancy.today` | Classes today, occupancy against tank capacity, count of classes in *sem professor*. |
| `mgmt.maintenance.open` | Open avarias/reposições by severity, plus the count of espaços with an overdue cleaning period. |
| `mgmt.waterquality.alerts` | Pools with readings out of range, or whose last analysis is older than the facility's threshold. |
| `mgmt.people` | Members total, staff total with a per-role breakdown, pending invitations expiring within 24h. |
| `mgmt.staffcost` | Monthly staff-cost roll-up from Salários. **Owner and admin only** — and an admin's figure excludes the owner's own pay, which `compensation.repository.ts` already decides. |

**operational — instructor** (scope: self)

| id | content |
|---|---|
| `inst.nextclass` | Next occurrence: when, pool and pista(s), turma, level, enrolled/capacity, co-instructors. Primary action **Marcar presenças** within −30/+90 minutes of the slot, otherwise **Ver turma**. |
| `inst.week` | This week's strip, my classes only, click through to the class. |
| `inst.trainingplan.next` | The next occurrence's training plan: exists / missing (warn), an edit link, and **copiar da aula anterior**. |
| `inst.myturmas` | Turmas I am responsible for, with student counts. |

**operational — maintenance** (scope: self / facility)

| id | content |
|---|---|
| `maint.mytasks` | Avarias assigned to me, plus ones I reported that are unresolved, grouped by status. |
| `maint.cleanings.overdue` | Espaços past their cleaning period, with an inline **registar limpeza**. |
| `maint.waterquality.due` | Pools needing a reading, with **registar leitura**. |
| `maint.inventory` | Items flagged for reposição, and newly added lost-and-found entries. |

**personal — student, guardian** (scope: self) — behind `dashboard.personal_band`

| id | content |
|---|---|
| `me.nextclass` | When, with whom, which pool and pista, level. |
| `me.trainingplan` | Read-only plan for the next lesson. |
| `me.attendance` | Presences in the current period. |
| `me.fees` | What is due, when, paid or not. Read-only, no admin actions. |
| `me.pool` | Current water temperature of their pool. |

### QA — adversarial, not happy-path

1. **Given** one person holding owner, instructor and guardian, **then** three bands render in
   order and no widget appears twice.
2. **Given** a maintenance-only user, **then** the operational band is at the top and the raw
   JSON payload contains **no `mgmt.*` key whatsoever**.
3. **Given** a student calling `GET /dashboard` directly, **then** no `mgmt.*` and no `inst.*`
   keys are present.
4. **Given** an instructor in tenant A, **then** they cannot see tenant B's next class — a
   row-level assertion.
5. **Given** an instructor whose next occurrence is cancelled, **then** the widget shows the
   **following** occurrence, not the cancelled one.
6. **Given** an instructor with no classes at all, **then** `state: 'empty'`, not an error.
7. **Given** a week moved by hand, **then** the next-class widget reads the corrected `occurs_on`
   path — asserted, given the drift bug in `docs/decisions.md`.
8. **Given** a guardian with three dependents, one enrolled at a different site, **then** the
   selector resolves the right facility context per dependent.
9. **Given** a senior who is both student and guardian, **then** their own widgets *and* the
   selector.
10. **Given** an owner with five facilities, **then** `scope=all` totals equal the sum of the
    per-facility totals — including on the last day of a fee period, and across a DST change.
11. **Given** `scope=all` with five facilities, **then** the aggregate widgets' **query count
    does not scale** with the number of facilities.
12. **Given** one resolver that throws, **then** every other widget still renders.
13. **Given** one resolver that exceeds the 2s timeout, **then** that card shows `error` and the
    page is otherwise fine.
14. **Given** a new tenant with zero facilities, **then** the onboarding checklist only.
15. **Given** a role revoked between two loads, **then** that band is gone on the next load.

### Slices — each one ends working

1. ✅ **Built 22 September 2026.** The registry, `GET /dashboard`, the gating, the failure
   semantics and the empty-club rule, with three widgets whose data already existed —
   `mgmt.subscription` (owner only, see the decision), `maint.mytasks` and `setup.checklist`.
   21 tests: gating and registry soundness as pure functions, the page's behaviour against
   resolvers that throw and hang, and the endpoint against a real club including the
   raw-JSON absence assertions and the cross-tenant one. **QA 1–6, 12, 13 and 14 are
   covered.** 7, 8, 9, 10 and 15 belong to bands that are not built. **11 is not yet
   testable** — no widget aggregates over facilities yet, so there is no query count to
   assert; the checklist's five counts are already one statement, and the counting helper the
   assertion needs arrives with the first real aggregate, in slice 2. No web change.
   `docs/features/dashboard.md`.
2. **Shared widget card + the management band**, wired to existing data.
3. **The instructor band.**
4. **The maintenance band.**
5. **The personal band**, behind the flag.

**User stories with acceptance criteria are written out and shown to Rui before any code, per
slice.**

### Acceptance criteria

1. The dashboard composes bands as a **union** of the reader's roles, in the fixed order
   management → operational → personal, from one array constant.
2. A widget the reader may not see is **absent from the payload**, not hidden in the UI.
3. Every resolver query is scoped by `organization_id`; facility-scoped ones additionally by the
   reader's own facilities.
4. One resolver failing or timing out (2s) degrades **that widget only**.
5. `empty` is a rendered state distinct from `error`.
6. At most four widgets per band, chosen by priority; every card links to its real page.
7. A tenant with no facilities sees only the onboarding checklist.
8. The instructor band contains no financial information.
9. Aggregates are one grouped SQL query per widget, with no per-facility fan-out, and each hits
   an index on `(organization_id, facility_id, <date column>)`.
10. The facility selector persists per user and defaults to all facilities; operational and
    personal bands ignore it.
11. The personal band's resolvers and contract exist and are tested; its web UI is gated.
12. Every string goes through i18n as it is written, relative time included — one shared
    formatter, no hardcoded "hoje" / "amanhã", dates in Europe/Lisbon.
