# POOLSE-172 · Every page change makes two calls instead of six, and the calendar stops asking about clashes student by student

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Architecture · **Area:** Platform / Performance · **Priority:** High (pre go-live) · **Depends on** [POOLSE-171] · **Unblocks** —

### PO — why this exists
Rui, 04-11-2026: "I think performance is being dragged into a slower Poolse, do you agree? With a lot of users will this be worse? Can we do something to improve?"

POOLSE-171 answered with numbers (`docs/perf/README.md`). Most of what is felt on `pnpm dev` is the dev server, and a production build answers every measured page in 0.12–0.34 s warm. So this ticket is not rescuing a slow product. It removes the two costs that grow with traffic and club size, before a real network sits between Vercel and the API. On localhost a call costs almost nothing; in production each of the layout's calls crosses that network, and they run in three rounds (`/me` + logo, then attention + inbox + subscription, then support).

**Not in scope:**
- The student record's 17 calls (cost 3). Slice A already takes five off it; re-measure first, and open a ticket only if the number still earns one.
- Any cache of memberships across requests, in memory or in Redis. A suspension, a removed role and the end of a support window take effect on the next request, and that promise is worth more than the 2 ms. This **replaces** the "per-request-chain cache" candidate in `docs/perf/README.md`.
- The six tables with no index leading on `organization_id`, unless one appears in `perf:slow-queries`.
- Asserted thresholds in the perf spec, the crons, CDN or infrastructure changes.

### As built (05-11-2026) — where this differs from the plan below
The rules and notes below are the plan as written; **this section wins where they disagree.**

- **`/me` + `GET /shell`, not one identity-only `/shell`.** Reading the code showed the single call would have to step round `TenantMiddleware`, copy its membership logic, lose the club's counts in `tenant_request_stats` and change 31 `/me` call sites. `/shell` is an ordinary tenant route called beside `/me`: two calls in one round, instead of six in three. The middleware, the suspended and read-only rules and the telemetry apply untouched, a suspended club's 403 reads as "nothing to draw", `/me` keeps answering it, and traps 1 to 3 do not arise. `readMe()` was not needed.
- **Each read keeps its own transaction.** One transaction would have meant rewriting `readAttention` and the shared `readPoolWater`. Each part runs after the last, not in parallel.
- **The query target was wrong.** "At most 45" rested on the README's "fixed ~7 queries per request". The fixed cost is 3 (`BEGIN`, `resolve_memberships`, `COMMIT`), so layout queries went 79 → 67. `/shell` itself is 48, mostly the `BEGIN` / `set_config` / `COMMIT` around each of `readAttention`'s reads.
- **No migration, no `enrollment_clashes_for`.** The plan confirmed the cost (48 ms with the clash subselect, 0.7 ms without). A clash needs a second active enrolment, so the roster asks only about a student who has one, and `enrollment_clashes()` is unchanged. Every enrolment skips it on the club seed; a real club keeps a few.
- **The other two calendar reads.** The turma list joins `enrolment_fee_category_all` instead of calling `enrolment_fee_category()` per student (54 → 15 ms). `listSessions` gains an indexed window two days wider than any timezone can move a day, with the exact day filter left in place: 37 → 33 ms today, and it stops the read growing with every past season.

### BA — rules
1. **Nothing a person sees changes.** Same menu, circles, badges, logo, avatar warning, support strip and suspension notice, for every role, in every access state.
2. One `GET /shell` answers what the `(app)` layout needs in one HTTP request: the `/me` payload, the logo id, the attention read, the meet inbox count, the subscription alert and the support status.
3. **Each part keeps its own gate, decided on the server.** The inbox count only for owner, admin or instructor with `competition` on; the alert only for owner or admin; support status only for the roles the layout calls `clubManager`. A part the reader may not see is `null`, and the same applies to the attention narrowing already in `readAttention`.
4. **A failing part costs that part.** Today a failed logo is no logo and a failed `/attention` is no circles; `/shell` keeps that, each part answering `null` on error, with the error logged. Only a failure of the membership read fails the request, and the layout's existing "fail closed on roles, open on suspension" branch handles it.
5. **A suspended club still gets its answer.** `/me` keeps answering for a suspended club so the shell can say why; `/shell` does too, with every tenant part `null`. A club in read-only is unaffected: it is a GET.
6. The six existing endpoints stay. Other screens use them (`/settings/logo`, `/subscription/alert`), and removing them buys nothing.
7. The roster on the calendar reads every enrolment's clashes in one statement over the turmas drawn, never once per student. `enrollment_clashes()` stays the one definition of a clash (POOLSE-144).

### Dev notes

**Slice A, `/shell`.**
- `apps/api/src/identity/`, beside `me.controller.ts`, on `IDENTITY_ONLY_ROUTES` as `/me` is: `TenantMiddleware` refuses a suspended club, so a tenant route cannot honour rule 5. The handler calls `listMemberships` once, picks the membership from `x-poolse-organization` as the middleware does, and when the club is open runs the existing reads inside one transaction with that tenant context.
- Call the repositories' own functions (`readAttention` and friends), never re-written SQL. Run them one after another in that transaction, not with `Promise.all`: one client takes one query at a time.
- The web side is `readShell = cache(…)` in `lib/shell.ts`. `currentViewer`, `brandLogo`, `menuBadges`, `subscriptionWarning` and `loadSupportStatus` read it; so do `readAttention` and `enabledModules`, which pages also call.
- **Trap 1, the 31 call sites of `apiFetch<Me>('/me')`.** Today fetch memoisation folds them into the layout's own call. Once the layout stops calling `/me`, each of those pages makes a *new* call, the saving shrinks and nothing reports it. Add a cached `readMe()` over `readShell` and move them to it.
- **Trap 2, telemetry.** `RequestStatsInterceptor` records nothing without a tenant context, and an identity-only route has none. Five counted calls per navigation become zero, so `tenant_request_stats` falls sharply and the `/admin` health dots read on a thinner sample. Record one row against the resolved club from the handler, or say out loud that the count dropped; do not leave it to be noticed.
- **Trap 3, a tenant read outside the middleware.** Check that `ModuleGuard`, `requireRole` and `currentTenant().support` behave for a read run this way. A support session must see what it sees today, and a support membership holds no roles, so rule 3 reads the resolved roles and never `membership_role`.
- `/shell` is `@CoreRoute()` or exempt as `/me` is (`modules.test.ts` will say), and gets its line in `security/role-probe.integration.test.ts`.

**Slice B, the calendar.**
- `apps/api/src/facilities/grid.repository.ts`, the roster statement. The turma list is already only what the week draws, so the README's candidate ("the week, not the season") does not apply. The likely cost is the correlated `enrollment_clashes(e.student_id, e.class_group_id)` inside `json_agg`, once per active enrolment, each opening a five-table join.
- **Confirm that with `perf:slow-queries` and `EXPLAIN (ANALYZE, BUFFERS)` as `poolse_app` before changing it.** If the plan disagrees, follow the plan.
- The fix is a set-based form, for example `enrollment_clashes_for(p_class_group_ids uuid[])`, with `enrollment_clashes(student, turma)` becoming a filter over it, so one definition remains (rule 7). It needs a migration, so use the `write-migration` skill. The function is read by a trigger (`enrollment_time_clash`) and is `LANGUAGE sql STABLE`: keep the trigger's cost in view, and check that the one-student path stays index-driven rather than expanding the whole club.
- Then take the other two grid statements (the class-group list with its site join, 3 570 buffers; the week's sessions, 2 004 buffers) through the same plan check. An index goes in only if the plan shows it being used.
- Note `grid-roster.integration.test.ts` and `GET /class-groups/clashes` read the same answer; both must be unchanged.

**Closing the slice.** Re-run the baseline on the same seed and build (`docs/perf/README.md`, *How to run a baseline*), which writes `baseline-<date>.md`. Update the README's costs. A production build needs the dev server stopped, and `NODE_ENV=production` for `next build`.

### QA
1. Given an owner on Painel, when the page renders, then the layout makes exactly 1 API call and the *API calls (layout)* column of the perf spec says so.
2. Given the Painel, Alunos and student-record pages, when each renders, then none makes a `/me` call of its own (trap 1).
3. Given each of owner, admin, instructor, maintenance, guardian and student, when `/shell` answers, then each part equals what its old endpoint answered that reader, asserted on the raw JSON.
4. Given a guardian, when `/shell` answers, then `inbox`, `subscriptionAlert` and `supportStatus` are `null` and absent from what the web renders (permission denial).
5. Given a request with `x-poolse-organization` naming a club the reader is not in, when `/shell` answers, then it carries none of that club's data (cross-tenant denial).
6. Given a suspended club, when `/shell` answers, then it is 200 with the suspension and every tenant part `null`, and the notice renders. Given a read-only club, then every part answers.
7. Given a club with `competition` off, when an instructor reads `/shell`, then the inbox count is `null`.
8. Given a support session inside its window, then the shell matches today's; given the window ended, then `requestedOrganizationMissing` still lands on the ended-window notice.
9. Given `readAttention` throws, when `/shell` answers, then it is 200, the attention part is `null`, the menu draws with no circles and the logo still shows.
10. Given a club's day of navigation, when the stats flush, then `tenant_request_stats` behaves as the slice decided (trap 2), and an `/admin` health dot is still derived rather than `unknown`.
11. Given a student enrolled in two turmas that overlap, when the grid reads, then `clashes` names the same patterns as before, and `GET /class-groups/clashes` and the `enrollment_time_clash` refusal are unchanged.
12. Given the club seed, when `perf:slow-queries` runs after a reset and a calendar load, then the roster's buffers per call are down against 5 884, and the figure is recorded.
13. Given the desk and phone e2e suites, when they run, then they pass unchanged in both themes: rule 1 has no snapshot of its own, the suites are the snapshot.

### Acceptance criteria
- [x] `GET /shell`, a gate per part shared with the part's old route, a failing part costs only that part.
- [x] Layout API calls 6 → 2, in one round rather than three.
- [ ] ~~Layout queries at most 45~~: 79 → 67, see *As built*.
- [x] A suspended, a read-only and a support session behave as today: the tenant path is unchanged.
- [x] Telemetry unchanged: `/shell` is a tenant route.
- [x] Roster clashes asked only of a student with a second active enrolment, `enrollment_clashes()` still the one definition, buffers per call 5 884 → 510.
- [x] Role-probe line for `/shell`.
- [x] New baseline in `docs/perf/`, README's costs and candidates updated. No memberships cache anywhere.
- [x] One line in `CLAUDE.md` and a section in `docs/features/observability.md`.
