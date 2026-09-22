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
      "widgets": [{ "id": "mgmt.subscription", "size": 1, "priority": 40,
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
  scope: 'facility',       // 'tenant' | 'facility' | 'self'
  size: 2,                 // columns, 1–3
  priority: 10,            // higher wins when the band is capped
  escalate: (data) => …,   // lifts it to escalatedPriority, on the resolved data
  featureFlag: 'DASHBOARD_PERSONAL_BAND',
  resolver: (ctx) => data,
}
```

`ctx = { organizationId, membershipId, roles, facilityIds, scope, locale }`.

**`kinds` is spelled exactly as `app-sidebar.tsx` spells it**, and means the same thing. A
personal tenant has no students, no turmas and no mensalidades, so its management band is
simply the widgets that make sense there — which keeps `organization.kind` read in two places
rather than branching the band model for one tenant shape.

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

**At most four widgets per band**, chosen by priority, ties broken on the id so the page does
not quietly reorder itself between two requests. Every card carries a link to the real page:
the dashboard is a launcher, not a replacement for the pages.

**`escalate` runs after the resolvers and before the cap.** "Boost the subscription widget when
the trial has fewer than five days left" is a predicate on the *resolved* data — nothing about
a declaration can know how many days are left — so every allowed widget is resolved rather than
only the four that would have survived a cap decided in advance. The cost is a few aggregates a
reader will not see, in parallel, under one ceiling; the alternative is a trial with three days
left being cut by a priority set before anybody counted.

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
| `mgmt.subscription` | management | **owner** | `readSubscription`, the same function `/subscription` answers from |
| `maint.mytasks` | operational | owner, admin, instructor, maintenance | `listMyTasks`, the same function `/maintenance/tasks/mine` uses |
| `setup.checklist` | management | owner, admin | five counts in one query |

**`mgmt.subscription` is the owner's alone**, narrower than the ticket's catalogue, which filed
it under owner and admin. POOLSE-60 settled that a subscription is the owner's own business
when it moved Subscrição under *O meu perfil* and out of the menu — the same reasoning that
keeps the owner's salary from an admin. An admin is not left uninformed by it: the standing
banner about a trial running out or a club going read-only comes from `/me` and reaches
everybody.

**`maint.mytasks` sits in the operational band although an owner may hold it.** That is the
band model working rather than a mistake: a task is "my work today", and an owner who fixes the
showers sees it under their own management figures.

**Not built:** the web UI (the dashboard page still composes its four panels directly — slice
2), the management, instructor and maintenance bands proper, the personal band behind
`DASHBOARD_PERSONAL_BAND`, and the per-user persistence of the facility selector. Widget
customisation is out of scope for the whole ticket; if it is ever wanted it is one
`dashboard_widget_prefs` table keyed on the person, and the registry already makes that small.
