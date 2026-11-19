# POOLSE-237 · The family app shows free-swim hours for the week and how full the tank is now, as a number and never a name

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Feature · **Area:** Family app / Free swim / Reception · **Priority:** Low (post go-live) · **Status:** backlog, build not decided (Rui, 19-11-2026) · **Depends on** [POOLSE-68](./POOLSE-68-free-swim-passes-and-check-in.md) (free-swim holds, check-in, `pool_occupancy`), [POOLSE-84](./POOLSE-84-closures-by-facility-and-tank.md) (closures per tank), [POOLSE-204](./POOLSE-204-family-packs-and-packs-in-the-app.md) (the app's *Natação livre* page)

### PO — why this exists

Rui, 19-11-2026, in a brainstorm: the data a swimmer needs before leaving home already exists. Free-swim hours and lanes are holds on the calendar (POOLSE-68, slice 2). Reception's *Na água agora* counts check-ins that clear by themselves: an entry carries its stay, and *Saída* ends it early. A family cannot see any of it, so they phone the club or turn up to a full tank.

**Not in scope:**
- Booking a lane or a slot. The screen is read-only.
- Any name, photo or list of who is in the water.
- Push or email alerts ("a piscina está livre").
- A public (signed-out) version on the club's public page.
- Clubs that do not sell free swim.

### BA — rules

1. **Where.** The app's *Natação livre* page (`/app/perfil/natacao-livre`, under *+ Natação*) gains a section per site: *Horário de nado livre*. It sits above the passes, because it is what a swimmer checks first.
2. **What the schedule shows.** Today and the next 7 days of free-swim hours per site, from the calendar's free-swim sessions (`booking_subject = 'free_swim'`), in the facility's timezone:
   - the day;
   - start and end;
   - the tank;
   - the number of lanes held (*3 pistas*).
   A cancelled session is not shown.
3. **What "now" shows.** For a free-swim session running now: *Agora: 60 % ocupado (12 de 20)*, computed as (swimmers + people in classes) ÷ capacity, from `pool_occupancy()`. The percentage is rounded down, so a full tank reads 100 % and never 101 %. Text, never only a colour bar. A bar may sit beside the text.
4. **No capacity, no percentage.** A tank with `max_capacity` null shows the schedule only, with no number and no "unknown" placeholder (Rui).
5. **Closures.** A tank or site closed by a closure (holiday or manual, POOLSE-84) shows *Encerrado até {date}* in place of its hours for the days it covers. A holiday shuts every tank, free swim included (decision of 19-10-2026).
6. **Counts and percentages only** (Rui). The response carries no person, no name, no id of a check-in and no pass. *Na água agora* stays reception's.
7. **Who sees it.** Any member of the club in the app: family, adult student, staff on their phone. Only when the club sells free swim, meaning the `reception` module is on (free swim's module, POOLSE-68), and only for sites with at least one free-swim session in the window. A club without it shows nothing new.
8. **Freshness.** The occupancy figure is at most 30 seconds old. The page says when it was read (*às 18:42*) in visible text, so a stale number is never mistaken for live.

### Dev notes

**One new read endpoint, `GET /app/free-swim`, under `@PoolseModule('reception')`.**
- **First line:** `requireRole(...MEMBER_ROLES)`.
- **Tenancy:** `withOrg(currentTenant())`, RLS on every table read.
- **Response:** `{ sites: [{ facilityId, name, days: [{ date, sessions: [{ startsAt, endsAt, poolName, lanes }], closedUntil? }], now?: { occupied, capacity, readAt } | null }] }`. No membership, student, pass or check-in field. Assert the exact key set in a test, so a later edit cannot widen it by accident.

**Sources, none new:**
- **The schedule** is `class_session` joined to `class_schedule` where the subject is `free_swim`, with its lane rows for the count. `class_session` has no `archived_at`; filter `status <> 'cancelled'`.
- **Closures** come from `closure` by facility and tank. Reuse the function reception uses to refuse a check-in on a closed tank; never a second "is it closed" definition.
- **Occupancy** is `pool_occupancy(org, pool, now())`, the one definition of who is in the water. Do not count `pass_check_in` rows here.

**Cache.** Cache in the API, in memory, per `(organization_id, facility_id)`, for 30 seconds: the occupancy part only. The schedule is cheap and is read each time. The cache key carries the organization, so one club's figure can never answer another's request. Write the test that proves it.

**Window.** Eight days is a fixed window, so the list is exempt from pagination (CONVENTIONS, *Which lists paginate*). Say so in a comment.

**Page.** The page is a server component; the "now" figure updates on a reload or a pull-to-refresh, with no live socket. It uses the phone shell, `app-` tokens and both themes. The text is in i18n pt-PT and en, with `formatDate` for days and times and the ICU plural for *pistas*.

**Security:** run `poolse-security-review` (new endpoint). The privacy question is aggregation. Rui's rule is counts only, with no minimum count. A tank showing *1 de 20* at 07:00 tells a family that someone is swimming, not who. Record that in the review as considered and accepted, not as a finding.

### QA

1. Given a free-swim session today 18:00–20:00 on tank A with 3 lanes, when a guardian opens *Natação livre*, then they read the day, *18:00–20:00*, the tank's name and *3 pistas*.
2. Given that session running now, tank capacity 20 and 12 people counted by `pool_occupancy`, then the page reads *Agora: 60 % ocupado (12 de 20)* and *às HH:mm*.
3. Given a tank with no capacity, then the schedule shows and no percentage appears.
4. Given a national holiday tomorrow, then tomorrow reads *Encerrado até {date}* for every tank of the site.
5. Given a check-in made 10 seconds ago, when the page is reloaded, then the figure may lag by at most 30 seconds, and the *às* time says which reading it is.
6. **No personal data:** the JSON response has exactly the documented keys. No name, id of a person, pass or check-in appears anywhere in it (key-set test).
7. **Module off:** given a club with `reception` off, `GET /app/free-swim` returns 403 `module_disabled` and the page shows no section.
8. **Permission:** a signed-out request is refused. The role-probe has a line showing every member role is answered and a non-member is not.
9. **Cross-tenant:** a member of club A with club B's id in the `poolse_org` cookie is refused by `TenantMiddleware`. The cache test shows club A's figure is never served to club B.
10. Phone width (390 px), light and dark: the text is contrast-checked and the bar is never the only signal.
11. **Nothing changes for reception:** *Na água agora* and its list are unchanged.

### Acceptance criteria

- [ ] `GET /app/free-swim` with role check first, the `reception` module, RLS, a fixed key set, and a 30-second per-club occupancy cache with its test.
- [ ] *Horário de nado livre* on *Natação livre*: today + 7 days per site, lanes, tank, closures.
- [ ] *Agora: N % ocupado (x de y)* with its reading time; no percentage without a capacity.
- [ ] No personal data in the response (key-set test); role-probe and cross-tenant lines.
- [ ] `poolse-security-review` run; the aggregation note recorded.
- [ ] `docs/features/` (free swim) and the user guide updated.
- [ ] pt-PT and en strings; `i18n:check`, `pt:check`, `contrast:check` green.
