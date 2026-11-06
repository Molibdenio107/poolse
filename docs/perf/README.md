# Performance — what is measured, and what it says (POOLSE-171)

Written for whoever picks up POOLSE-172. Numbers first, fixes later: this page changes no behaviour.

## After POOLSE-172 (05-11-2026)

Same seed, same build, [baseline-2026-11-05.md](./baseline-2026-11-05.md). Warm DOM ready, production:

| Page | 04-11 | 05-11 | API calls | DB ms |
|---|---:|---:|---:|---:|
| Painel | 163 | 158 | 7 → 3 | 281 → 337 |
| Alunos, page 2 | 168 | 163 | 7 → 3 | 141 → 115 |
| Student record | 229 | 218 | 17 → 13 | 298 → 274 |
| Calendário | 335 | 256 | 13 → 9 | 316 → 211 |
| Pessoas | 115 | 101 | 7 → 3 | 89 → 75 |
| Site page | 127 | 124 | 18 → 14 | 227 → 217 |

Three runs on one machine, so a few milliseconds either way is noise: Painel's database time is one of those, and only Calendário's gain is unmistakable. The layout's saving is mostly invisible on localhost, because it removes round trips, and a round trip here costs almost nothing.

**Corrections to what follows.** The fixed cost per request is **3 queries**, not ~7. Cost 2's candidate did not apply: the roster was already the week's turmas, and the cost was `enrollment_clashes()` asked once per student. The "per-request-chain cache of `resolve_memberships`" is **refused**: a suspension, a removed role and an ended support window take effect on the next request (POOLSE-172).

**What is left, in order:** `/shell`'s 48 queries, mostly the transaction wrapping around each of `readAttention`'s reads; the student record's 13 calls, which was never slow enough to earn its own ticket.

## The answer to "is Poolse getting slower?"

**Most of what is felt on `pnpm dev` is the dev server, not Poolse.** Same club, same pages, same browser
([baseline-2026-11-04.md](./baseline-2026-11-04.md)):

| | First visit to a page (cold) | Every visit after (warm) |
|---|---|---|
| `pnpm dev` | 2.3 – 7.5 s DOM ready | 0.41 – 0.95 s |
| Production build (`next build` + `next start`, `node dist/main.js`) | 0.14 – 0.84 s | 0.12 – 0.34 s |

`next dev` compiles each route on its first hit and keeps doing extra work on every request; a production
build does neither. The database time is the **same** in both (Calendário ≈ 316 ms of queries either way), so
the gap is the toolchain. On the club-sized seed every page answers in a third of a second warm.

**More users:** the costs below are per page view and per club, not per user, so they grow with traffic rather
than with each club's size. The ones that do grow with a club's size are the calendar's three queries (cost 2).

## Top three costs, with evidence

1. **Every page view makes the same six layout calls — 79 queries before the page asks for anything.** The
   `(app)` layout calls `/me`, `/settings/logo`, `/subscription/alert`, `/attention`, `/meet-inbox/count` and
   `/support-grants/status` on every navigation (the *API calls (layout)* column: 6 of 7 on Painel, Alunos and
   Pessoas). And each API request pays a fixed ~7 queries of its own before its handler runs (transaction,
   GUC, `resolve_memberships`, …): `resolve_memberships` is **the most expensive statement by total time**
   (276 calls, 599 ms, one per request) in the clean `pg_stat_statements` run.
   *Candidate:* one `/app-shell` read returning the six answers in one request (one membership resolution,
   one transaction), and a short per-request-chain cache of `resolve_memberships`. Not dev-only.

2. **Calendário's three grid queries are the slowest reads — about 45 ms each, 2 000–5 900 buffers per call.**
   The turma roster `json_agg` (5 884 buffers/call, 48 ms mean), the class-group list with its site join
   (3 570, 47 ms) and the week's sessions (2 004, 42 ms). Calendário is the slowest page in both builds
   (335 ms production warm, 13 API calls, `/facilities/:id/grid` the slowest call). These scale with the
   season's sessions and enrolments.
   *Candidate:* read the roster only for the week shown (not the season) and check both plans with
   `perf:slow-queries` for a missing `(organization_id, class_group_id, …)` index. Not dev-only.

3. **The student record makes 17 API calls and 192 queries** (≈ 119 of them the per-request fixed cost
   above), the most of any page; the site page makes 18. Warm production is still 0.23 s, so this is cost 1
   multiplied, not a slow query. *Candidate:* the record's tabs already load lazily — fold the always-loaded
   reads (`/students/:id`, `/credits`, `/timetable`, `/fees`, the two fee-plan reads) into one. Not dev-only.

**Dev-only:** the cold compile (2–7.5 s per first visit) and the extra 0.3–0.6 s per warm load. Nothing to fix
in Poolse; `pnpm build && pnpm start` is the instrument for judging speed.

## Other findings

- **Six tenant tables have no index leading with `organization_id`:** `incident_detail`, `lab_result_value`,
  `platform_alert`, `platform_audit_log`, `slug_claim`, `student_sensitive`. Most are read by id or by a parent
  key, so this is a list to check, not six bugs.
- **Server pages already fetch in parallel:** only two pages await two `apiFetch` calls back to back
  (`students/[id]/sensitive`, `facilities/staff/vacations`).
- **A local `next build` needs `NODE_ENV=production`.** The root `.env` sets `NODE_ENV=development` and
  `next.config` loads it, so a plain `pnpm build` in `apps/web` fails pre-rendering `/en/pricing`. Production
  hosts set `NODE_ENV` themselves; a developer building locally must too.
- **The club seed has 16 turmas, not 40.** The reference timetable is 16 turmas on one site; more would mean a
  second site's timetable. 400 students, 25 staff, 2 349 sessions (the whole season), 2 579 register marks and
  a year of daily water analyses on every tank are there. Billing invoices are not seeded (no page measured
  here reads them).
- **The trial clock and the other crons** were not measured (out of scope).

## The instruments

- **`Server-Timing`** on every API response: `total`, `db` (time waiting on Postgres), `queries` (count) —
  `apps/api/src/common/server-timing.ts`, measured by `@poolse/db`'s pool wrapper (`query-timing.ts`). Nothing
  identifying. `PERF_LOG_FILE`, set only on a machine being measured, also appends one JSON line per request
  (ids masked); never set it in production.
- **The club seed:** `pnpm --filter @poolse/db seed --size=club` builds *Clube Medida* (slug `clube-medida`) and
  gives the e2e owner an admin seat in it. Re-running adds only what is missing. Plain `pnpm db:seed` is
  unchanged.
- **`pg_stat_statements`** is loaded by the dev Docker image (`docker-compose.yml`).
  `pnpm --filter @poolse/db perf:slow-queries [--reset] [--org=clube-medida]` prints the top 20 by total and by
  mean time (statements the app login ran), a plan for every read over 10 000 buffers a call — as `poolse_app`
  with the club's GUC set, so RLS is in the plan; `ANALYZE, BUFFERS` when the statement takes no parameters,
  `GENERIC_PLAN` when it does, because the statistics keep `$1` and not its value — and the index check.
  **Reset before measuring**: an `api:test` run fills it with a thousand test clubs.
- **The baseline spec:** `apps/web/e2e/perf.spec.ts`, Playwright project `perf`, never part of the suite.
  Cold, then the median of three warm loads, per page; it asserts nothing.

## How to run a baseline

1. `pnpm --filter @poolse/db seed --size=club`, then read the ids:
   `SELECT id FROM organization WHERE slug = 'clube-medida'`, a student with an active enrolment, its facility.
2. `pnpm --filter @poolse/db perf:slow-queries --reset`.
3. **Dev:** start `pnpm dev` with `PERF_LOG_FILE=<path>` exported; do not open any page.
   **Production:** stop dev, `cd apps/api && pnpm build`, `cd apps/web && NODE_ENV=production pnpm build`, then
   with `NODE_ENV=production` and `PERF_LOG_FILE` exported: `node --env-file=../../.env dist/main.js` in
   `apps/api` and `pnpm start` in `apps/web`.
4. In `apps/web`, with `PERF_LABEL`, `PERF_ORG_ID`, `PERF_STUDENT_ID`, `PERF_FACILITY_ID` and the same
   `PERF_LOG_FILE`: `node --env-file=../../.env node_modules/@playwright/test/cli.js test --project=perf`.
   It writes `docs/perf/runs/<date>-<label>.json` and rebuilds `baseline-<date>.md`.
5. `pnpm --filter @poolse/db perf:slow-queries --org=clube-medida`.
6. Restart `pnpm dev` (after a production build, delete `apps/web/.next` first).
