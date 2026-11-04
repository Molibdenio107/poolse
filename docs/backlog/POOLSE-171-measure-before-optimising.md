# POOLSE-171 · Measure Poolse before optimising it: a production build, a club-sized seed, and numbers per page and per query

> Part of the Poolse backlog. Conventions in [CONVENTIONS.md](./CONVENTIONS.md) apply to this ticket and are not repeated here.

**Type:** Architecture · **Area:** Platform / Performance · **Priority:** High (pre go-live) · **Depends on** — · **Unblocks** [POOLSE-172]

### PO — why this exists
Rui, 04-11-2026: "I think performance is being dragged into a slower Poolse, do you agree? With a lot of users will this be worse? Can we do something to improve?" — felt on **every page change**, on `pnpm dev`.

Nobody agrees or disagrees until there is a number. `next dev` compiles a route on first hit and caches nothing, so a dev box is the wrong instrument; and a one-club seed hides every query that scales with rows. This ticket builds the instrument and records the baseline. **It changes no product behaviour.** Fixes are POOLSE-172, written from this ticket's numbers, not before.

**Not in scope:** any optimisation; caching layers; infrastructure changes; the trial clock and other crons (noted, not tuned).

### BA — rules
1. The comparison that answers Rui's first question: the same six pages timed on `pnpm dev` and on `pnpm build && pnpm start` (web + API), same seed, same browser. Pages: Painel, Alunos (page 2), a student record, Calendário (a full week), Pessoas, the site page. Three loads each, median recorded.
2. A club-sized seed: 400 students, 40 turmas, 25 staff, one season of sessions, 12 months of readings and invoices — `packages/db/src/seed.ts` takes a `--size=club` flag; the demo seed is unchanged.
3. The API answers `Server-Timing` on every response: total, `db` (summed query time), `queries` (count) — from the pool wrapper, one place. Never a query's text or a tenant id.
4. `pg_stat_statements` on in the dev Docker image; a script `packages/db/scripts/slow-queries.ts` prints the top 20 by total time and by mean, with `EXPLAIN (ANALYZE, BUFFERS)` for any that reads more than 10 000 buffers, run as `poolse_app` with the GUC set so RLS is in the plan.
5. A Playwright `perf.spec.ts` project records, per page: TTFB, DOM content loaded, number of API calls and the longest one — written to `docs/perf/baseline-<date>.md` as a table. Thresholds are **not** asserted yet; the first run is the baseline.
6. The write-up (`docs/perf/README.md`) lists the top three costs with evidence, each as a one-line candidate fix, and names which are dev-only.

### Dev notes
- Index check: a query over every tenant table whose first index column is not `organization_id` — one SQL in the slow-queries script. The composite FKs already give most of them; the ones missing are the finding.
- The layout's per-navigation work (`/me`, `readAttention`, badge counts) is a known candidate; measure it as one row ("layout only": an empty page under `(app)`).
- Server pages: grep for sequential `await apiFetch` pairs that share no data (`rg -n "await apiFetch" --after-context=1`) and count them per page; do not fix.
- `RequestStatsInterceptor` already buffers per-tenant counts — do not add a second per-request write; `Server-Timing` is a header, not a row.
- Trap: timing a dev server once, warm, and calling it fast. Always cold then warm, and say which.

### QA
1. Given `pnpm build && pnpm start`, when `perf.spec.ts` runs against the club seed, then `docs/perf/baseline-<date>.md` exists with six rows × both builds.
2. Given any API response, then it carries `Server-Timing` with `total`, `db`, `queries` and nothing identifying.
3. Given `slow-queries.ts`, then it runs as `poolse_app` under the GUC and prints plans for the heavy ones.
4. Given the demo seed, then it is byte-for-byte what it was (snapshot of a count per table).
5. No product screen changes (the full e2e suite stays green).

### Acceptance criteria
- [ ] Club-sized seed behind a flag.
- [ ] Server-Timing header, one place, no identifiers.
- [ ] pg_stat_statements + slow-queries script with RLS in the plan.
- [ ] Baseline table dev vs prod, six pages, cold and warm.
- [ ] `docs/perf/README.md` with the top three costs and which are dev-only → POOLSE-172 is written from it.
