# The dashboard

The home route and the first menu item: sign-in lands here and so does the logo. POOLSE-66.

**It is a union of bands, never a layout chosen by a role.** A person holds several roles —
that is the whole reason `membership_role` is a table — and a club owner who also teaches on
Tuesdays is the ordinary case here, not the edge one. So an owner who teaches sees the
management band *and* their next class, and a maintenance-only user sees the operational band
at the top, which reads as "the maintenance dashboard" without one existing.

| # | Band | Roles | Answers |
|---|---|---|---|
| 0 | `management` | owner, admin | the club, aggregated |
| 1 | `operational` | instructor, maintenance | "my work today" |
| 2 | `personal` | student, guardian | "me and mine" |

`BANDS` in `apps/api/src/dashboard/widget-registry.ts` is that order, and it is **one array
constant** — reordering the page is that line and nothing else. Ordering *within* a band is
priority; ordering *between* roles is `MEMBER_ROLES`, which already existed and is not
re-declared here. Seniority governs ordering only, never permissions.

## `GET /dashboard?facility=all|<uuid>`

```json
{
  "scope": { "mode": "all", "facilityId": null, "facilities": [{ "id": "…", "name": "Sede" }] },
  "bands": [
    { "id": "management", "order": 0,
      "widgets": [{ "id": "mgmt.energy.costs", "size": 2, "priority": 50,
                    "state": "ok", "data": { } }] }
  ]
}
```

**Every signed-in member may call it.** There is no `requireRole`, because there is no single
role this page is for — which is the reason it is a union of bands rather than four screens.
What comes back is decided by what the reader holds: somebody with no band gets `bands: []`.

**A widget the reader may not see is absent from the payload**, not hidden in the browser.
`widgetsFor` applies `roles` *before* any resolver runs, so a client that renders whatever it
is given cannot leak anything — there is nothing to leak. The integration test asserts this on
the raw JSON rather than on the shape: a blank-but-present widget would pass a shape assertion
and fail the promise.

**A band the reader holds no role in is absent too**, rather than present and empty. The client
should not have to tell "you are not an instructor" from "you have no classes this week".

## The registry

One declaration per widget, in code, no new tables:

```ts
{
  id: 'inst.nextclass',
  band: 'operational',
  roles: ['instructor'],
  kinds: ['business'],     // omitted means every kind
  module: 'maintenance',   // POOLSE-87; omitted means core
  scope: 'facility',       // 'tenant' | 'facility' | 'self'
  size: 2,                 // columns, 1–3
  priority: 10,            // higher wins when the band is capped
  escalate: (data) => …,   // lifts it to escalatedPriority, on the resolved data
  trailing: true,          // POOLSE-103: a one-line card after the band, outside the cap
  featureFlag: 'DASHBOARD_PERSONAL_BAND',
  resolver: (ctx) => data,
}
```

`ctx = { organizationId, membershipId, roles, facilityIds, scope, locale }`.

**`kinds` is spelled exactly as `app-sidebar.tsx` spells it**, and means the same thing. A
personal tenant has no students, no turmas and no mensalidades, so its management band is
simply the widgets that make sense there — which keeps `organization.kind` read in two places
rather than branching the band model for one tenant shape.

**`module` drops a card whose module the club has switched off** (POOLSE-87), in
`widgetsFor`, before any resolver runs — the same place roles are applied, so the card is absent
from the payload rather than resolved and hidden. Tagged: `mgmt.staffcost` (salaries),
`mgmt.energy.costs` (energy), `mgmt.freeswim` (reception), `mgmt.qualifications`
(qualifications), `mgmt.waterquality.alerts`, `maint.waterquality.due` and `me.water` (water
quality), and `mgmt.maintenance.open`, `maint.mytasks`, `maint.requests`,
`maint.cleanings.overdue`, `maint.inventory` (maintenance). `mgmt.money.period` and `me.fees`
read `student_fee`, not invoices, so they are core. An unknown module is refused at registration.

**`assertRegistryIsSound` refuses five mistakes**, every one of which otherwise produces
*nothing on screen* rather than an error: a duplicate id, an unknown band, an empty `roles`
list, an unknown role, a width outside 1–3 — and a facility-scoped widget offered to a role
whose `facilityIds` are not derived yet. That last one is the live gap: slice 1 derives a
manager's sites (all of them) and leaves the instructor and maintenance derivations to the
bands that need them, so `ROLES_WITH_DERIVED_FACILITIES` and the check around it are what stop
a facility-scoped instructor widget from resolving against an empty list and reporting "no
classes" to somebody who teaches four.

## What the page does when a widget misbehaves

- **Resolvers run in parallel**, each with a **2-second** ceiling (`WIDGET_TIMEOUT_MS`). A
  throw or a timeout is `state: 'error'` on that card; every other widget still renders and the
  response is still 200. A dashboard that 500s because one aggregate is slow is a home page
  that goes down when any query does.
- **A timed-out query is not cancelled** — the statement finishes into nothing and returns its
  connection. The timeout protects the reader, not the database.
- **`empty` is a rendered state.** A resolver answering `null` means "there is nothing here",
  which is a sentence a club needs to read. It tests for `null` and not for falsiness, so a
  resolver answering `0` or `false` has answered.
- **An error card carries no message.** The reason goes to the log: a resolver's error text is
  written for a developer and can name a column or a constraint.

## Density, and the two rules that come with it

**At most four widgets per band**: a card with something to say (data, or an error) before an
empty one, then by priority, ties broken on the id so the page does not quietly reorder itself
between two requests. The first key arrived with slice 2b, when the management band grew to eight
widgets for four places and a new club's empty mensalidades card outranked an energy card with a
year of bills. Every card carries a link to the real page:
the dashboard is a launcher, not a replacement for the pages.

**Between the empty key and priority sits the reader's leading working role** (`leadRank`,
15 October 2026, Rui). Somebody who is both maintenance and an instructor sees the maintenance
cards first, because maintenance now outranks instructor in `MEMBER_ROLES`. Owner and admin
are left out of that rank, so an owner who also teaches keeps the order priority gives them.

**`escalate` runs after the resolvers and before the cap.** "Boost this widget when the water
is out of range" is a predicate on the *resolved* data — nothing about
a declaration can know how many days are left — so every allowed widget is resolved rather than
only the four that would have survived a cap decided in advance. The cost is a few aggregates a
reader will not see, in parallel, under one ceiling; the alternative is an urgent card being cut
by a priority set before anybody looked.

**A `trailing` widget is one line at the end of its band and outside the cap** (POOLSE-103). It
is never cut and never ranked above a card about the pool. The subscription was the only one,
and it left the dashboard on 28-10-2026 (Rui), so no widget is trailing today.

## The empty club, and the selector

**A club with no sites sees the onboarding checklist and nothing else** — create a facility →
add pools → define the price list → invite staff → import students — and a club with sites
never sees it. One branch, both directions, so the two halves cannot drift. The later steps are
computed rather than assumed false: a club that archived its last site still has its students
and its price list.

"Has this club got anywhere to teach" is a fact about the club, not about who is asking, so an
instructor at a club with two pools is never handed a checklist because the selector is not
theirs.

**The selector** is `?facility=all|<uuid>`, and the two wrong values are read differently on
purpose. A **malformed** value is no filter at all — it arrives from a link or a bookmark, and
a mistyped one should show the club rather than an error page, the reading `/platform/tenants`
already takes. A **well-formed uuid this club does not have** is a 404: that is not a typo, it
is a question about somebody else's site, and answering it with "here is everything instead"
would quietly widen what was asked for.

The list of sites to choose from is sent only to the management band's readers, because nobody
else is offered the control. Operational and personal widgets ignore the selector entirely and
resolve from the reader's own attachments.

## Built so far

**Slice 1 — the registry, the endpoint, the gating and the failure semantics** (22 September
2026), with three widgets whose data already existed, because a slice that ends in stubs has
not ended:

| id | band | roles | from |
|---|---|---|---|
| `maint.mytasks` | operational | owner, admin, instructor, maintenance | `listMyTasks`, the same function `/maintenance/tasks/mine` uses |
| `setup.checklist` | management | owner, admin | five counts in one query |
| `mgmt.energy.costs` | management | owner, admin | `energyCosts`, the same function `/energy/costs` answers from — added in slice 2a |

**The subscription is not on the dashboard** (Rui, 28-10-2026). It was the `mgmt.subscription`
line from POOLSE-60 to POOLSE-103. It now lives only under *O meu perfil* (owner), and a club
whose subscription is ending is told by a warning on the avatar, for the owner and the admins
(`docs/features/subscription.md`).

**`maint.mytasks` sits in the operational band although an owner may hold it.** That is the
band model working rather than a mistake: a task is "my work today", and an owner who fixes the
showers sees it under their own management figures.

## The page — slice 2a, 23 September 2026

The dashboard now **renders the payload** rather than composing panels of its own.

**A band is a heading and a grid; a card is `WidgetCard` plus one case in `widgets.tsx`.**
Adding a widget is a declaration in the registry and a case there, and nothing else — no new
fetch, no new failure handling, no new role check on the client.

**`empty` and `error` are drawn differently, and the sentence for `empty` is written per
widget.** "No bills yet" and "nothing outstanding" are different facts, and one shared sentence
for both would make good news unreadable. The `error` card carries **no message** — the
resolver's own words name columns and go to the log — and is drawn in the muted tone rather
than the danger one, because a card that could not load is not a refusal and spending the
danger colour here would make it mean less where it matters.

**Every card links to its page in all three states.** A card that failed is still the way to
the thing it failed to summarise, and an empty one is usually exactly where somebody is going
to add the first row.

**Band headings are shown even when the reader has only one band.** A reader who sees
*Operação* learns there is somewhere else the product lives.

`mgmt.energy.costs` is **narrower than the endpoint it resolves through**: `/energy/costs` is
owner, admin and maintenance, and the card is owner and admin. What the site costs is readable
on Energia by whoever runs it; the management band is not where they read it. Asserted, because
it is a decision rather than an oversight.

**One panel is still bespoke, below the bands**: the personal tenant's own pool (`MyPoolPanel`).
Occupancy became `mgmt.occupancy.today` in slice 2b. The family band's water card is `me.water`,
a child's pool at a club, so it does not replace that panel. A slice that ended by removing a figure an operator reads every morning would not
have ended well.

## The management band — slice 2b, 6 October 2026

Six aggregates, **one SQL statement each whatever the number of sites**
(`management.repository.ts`), every one borrowing the rule its page already uses:

| id | priority | scope | what it says | the rule it reads |
|---|---|---|---|---|
| `mgmt.money.period` | 50 | site | mensalidades this period: paid, to pay, overdue | `current_period_start`, `fee_payable_cents`, `fee_due_on` — the per-student rule, summed |
| `mgmt.occupancy.today` | 45 | site | classes today, swimmers expected, classes *sem professor*, the busiest tank against its `max_capacity` | `class_session` (never the pattern), the booking's `instructor_status` |
| `mgmt.freeswim` | 40 → 85 with a tank ≥ 90 % full | site | each tank's people in the water out of its capacity; free swim sold this month and entries, **apart from mensalidades** (POOLSE-68) | `pool_occupancy`, and sale lines not since credited — `reception.md` |
| `mgmt.waterquality.alerts` | 30 → 80 out of range | site | tanks out of range, or due for an analysis | `excursions` / `resolveBands`, and `facility.water_analysis_max_age_hours` |
| `mgmt.maintenance.open` | 25 → 60 with a fault or overdue room | site | open avarias and reposições by severity, rooms overdue for cleaning, and the same per site (`bySite`). Links to a site's Espaços tab, never the list: the selected site; on *all sites*, each site when there are three or fewer, else the one with the most overdue rooms (POOLSE-92) | `OVERDUE` from `spaces.repository.ts` |
| `mgmt.leads` | 20 → 65 when a request has waited 3 days | club | pre-registrations waiting, trials booked, the oldest wait | `readLeadsWidget` — POOLSE-69, `registration.md` |
| `mgmt.people` | 15 | club | students, staff by role, invitations lapsing within 24 h | `countPeople`'s headcount rules |
| `mgmt.staffcost` | 10 | club | the monthly staff cost with coverage | `salarySummary` — an admin's excludes the owner's pay, and says so |
| `mgmt.qualifications` | 12, 55 when one has lapsed | club | qualifications vermelho, âmbar and em falta, the worst five | `qualification_current` — POOLSE-27, `staff.md` |

**Money is mensalidades only**, and the late-payment penalty is not in it: it is charged once per
student, not per line, and the student's page decides it. **Today is each site's own date.** A
partnership's session counts through a LEFT join. **Sem professor** is `to_define` or `uncovered`
where nothing resolves for that one session; `external` never counts. **A tank is due** only where
the site set a threshold — null enforces nothing — and then a tank never analysed is due.
**People and staff cost are the club's**, because a membership, an invitation and a salary belong
to the club; their cards say so rather than following the selector.

**The selector is remembered per person and per club** on `membership.dashboard_facility_id`,
written by `PUT /dashboard/scope` (`{ facilityId }`, a uuid or null; owner and admin; an unknown
uuid is 404, anything else not a uuid is 400). A `?facility=` in the URL wins over the remembered
site, so a shared link shows what it says; a remembered site since archived reads as every site.

**QA 10 and 11 are asserted**: "every site" equals the sum of each site, and the number of
statements a page runs does not change between one site and five — `countStatements` in
`test/harness.ts` counts them, leaving `withOrg`'s own BEGIN, GUC and COMMIT out.

**On the page**, the selector sits in the shell's filter row, only where the API sent a list of
more than one site — one site is no choice. Choosing saves through a server action and the page
re-renders on the new scope. The season-occupancy panel that sat below the bands went with this
slice: today's figures are the occupancy card, and the season summary is each site's **Ocupação**
tab, loaded when it opens.

## The instructor band — slice 3, 10 October 2026

Four widgets, instructor role only, **all `scope: 'self'`**: they are about the sessions this
person teaches, so they need no list of sites and ignore the management selector by
construction (AC 10). Reads are `instructor.repository.ts`, one statement each.

| id | priority | what it says |
|---|---|---|
| `inst.nextclass` | 50 → 85 while its register is owed | when (hoje / amanhã / weekday and date, on the site's clock), tank and pistas, turma and level, enrolled against capacity — or the school's headcount for a parceria — and, for a stand-in, whose class it is. **Marcar presenças** from 30 min before the start to 90 min after; otherwise the card links to the turma |
| `inst.trainingplan.next` | 40 → 70 when a lesson inside two days has none | the next *plannable* lesson's plan: its first line and author, or "no plan yet" with **Copiar o plano de dd-MM-yyyy** |
| `inst.week` | 35 | this Monday-to-Sunday, my classes only, cancelled ones kept and said, a past turma class with no register flagged |
| `inst.myturmas` | 20 | the turmas I am responsible for, with active enrolments against capacity |

**"Mine" is `class_session.resolved_instructor_id`** — the generated stand-in-or-instructor
column the one-building exclusion already compares — so a stand-in sees the class they cover and
the regular instructor does not see it that week. **"Next" holds on to a class whose register is
still owed**: upcoming, in progress, or finished within 90 minutes with no register taken. A
cancelled class gives way to the following one (QA 5); a week moved by hand is read at its moved
`starts_at` (QA 7). **A parceria is on every card through LEFT joins**, never takes a register,
and is plannable only when the club runs its lessons (`managed_lessons`). **Responsible for a
turma** is `myTurmaIds`' union — its own instructor, or named on one of its bookings; a one-week
stand-in is not.

**The copy button sends only the session id.** The server action re-reads the plan, copies the
previous lesson's body only if nothing has been written since the page was drawn, and writes
through the sheet's own `PUT /sessions/:id/plan`, so the row-level rule is the API's. The card's
*Escrever o plano* opens `/dashboard/calendar?week=…&plan=<session>`, which opens that lesson's
sheet on arrival.

**No money anywhere in the band** (AC 8), asserted on the raw payload with a search for
`cents`. With `maint.mytasks` an instructor has five candidates for four places; the cap's
ordering decides, and an instructor at a club with no classes sees four empty cards.

**Staffing a booking now re-stamps its generated weeks.** `assignInstructor` used to write the
booking's override and leave every session behind it on the old instructor, so the calendar
(which coalesces the booking in) and `resolved_instructor_id` disagreed. It now re-stamps future,
uncancelled, unregistered weeks that still carry the pattern's previous instructor, one savepoint
each, and reports `weeksUpdated` and `weeksBlocked` — a week where the person already teaches in
another building is left alone and counted.

## The maintenance band — slice 4, 10 October 2026

Four widgets, maintenance role only, reading **every site the reader works at and never the
selector**: maintenance is assigned to no site in this schema, so it joined
`ROLES_WITH_DERIVED_FACILITIES` with the whole club, and the resolvers read
`ResolverContext.ownFacilityIds` — the reader's sites before the selector narrows them — which is
how the operational band ignores the management control (AC 10). The selector itself is now
`SELECTOR_ROLES`, owner and admin. Reads are `maintenance-band.repository.ts`, one statement each.

| id | priority | what it says |
|---|---|---|
| `maint.requests` | 45 → 75 with a high-severity avaria | open avarias, worst first and oldest within that, where each is and how long ago it was reported; those the reader reported are marked |
| `maint.cleanings.overdue` | 40 | espaços past their interval by `OVERDUE`, never-cleaned first, each with **Registar limpeza** — the space page's own action, one press |
| `maint.waterquality.due` | 35 → 80 with a tank out of range | the owner's water card over the reader's sites, each tank linking to its water tab to **Registar análise** |
| `maint.inventory` | 20 | open reposições, and lost property found in the last 7 days and not returned |

**Avarias have no assignee** (decided 10-10-2026): the card lists every open one with the
reporter's marked, rather than inventing a column. **A reposição is listed once**, on the store
room card, not with the avarias. **Maintenance may now record one water analysis** — the
endpoint and the form; importing a file, archiving an analysis and setting bands stay owner and
admin (`canRecordAnalysis` beside `canManage` on the pool). With `maint.mytasks` there are five
candidates for four places. No money anywhere in the band, asserted on the raw payload, and no
selector is sent to a maintenance reader even at a club with two sites.

## The personal band — slice 5, 15 October 2026

Guardians and students, about **one child at a time**. The controller lists the reader's own
records (`familyStudents`, the list `GET /family` gives): themselves first when they are a
student, then their children. `?child=` chooses among them, and an id that is not theirs is a
404. No choice means the first. A reader with nobody has no band at all, not a row of empty
cards, and `family` is null.

The response carries `family: { children, selectedId }`. The web draws a link per child above
the band when there is more than one, so the choice lives in the address (Rui's call) and Back
works. **It ships visible**, also Rui's call: the `DASHBOARD_PERSONAL_BAND` flag the ticket
named is not used.

| id | priority | content |
|---|---|---|
| `me.nextclass` | 50 | next lesson not cancelled, at the week's own hour; pool, pista, who teaches it (the stand-in when set) |
| `me.fees` | 35, 60 when something is overdue | what is still to pay, the next due date, how many are late: `balance` from the fee read |
| `me.trainingplan` | 40 | the next lesson's plan, read-only, no author |
| `me.attendance` | 30 | this calendar month on the club's clock: present, absent, excused, unmarked, of lessons held |
| `me.water` | 20 | the latest water temperature at the next lesson's pool, and when it was taken |

"Their lesson" is a session of a turma the child was enrolled in on that day, the predicate
`familyMayReadPlan` uses (`family.repository.ts`). Five cards for four places: the water is the
one that waits. **`balance` is computed once, on the API** (`billing/fee-balance.ts`), and the
office's fee block, the family's Mensalidades tab and this card all read it.

**Also not built:** there is **no React test harness in this repo**,
so the card's three states are proven by the API's own state assertions and by the build rather
than by a render test; adding one is its own decision. Widget customisation is out of scope for
the whole ticket; if it is ever wanted it is one `dashboard_widget_prefs` table keyed on the
person, and the registry already makes that small.
