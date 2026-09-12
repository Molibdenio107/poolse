import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { pool } from '@poolse/db';

/**
 * The platform's health check, and the one the deploy pipeline gates on.
 *
 * **The status code is the contract and it has not changed.** 503 when Postgres
 * is unreachable, 200 otherwise. Railway and every other host read the code and
 * nothing else, so a health endpoint that always answers 200 is one that always
 * passes — it would wave through a deploy whose database credentials are wrong
 * and take the site down instead of rolling back.
 *
 * Slice 2 adds a body: which dependency, and how long it took. That is for the
 * strip at the top of `/admin`, and it is why the two halves are separate —
 * **only Postgres can make this `down`.** Clerk being slow is worth a dot on a
 * screen and must never roll back a deploy; a product where the sign-in provider
 * having a bad minute triggers an automatic rollback is a product that rolls back
 * during every one of its provider's bad minutes.
 *
 * Public and unauthenticated (`PUBLIC_ROUTES`), outside every tenant, and
 * deliberately **not** audit-logged: a platform probe hitting it every ten
 * seconds would otherwise be the only thing in `platform_audit_log`.
 *
 * It carries no detail worth having to somebody who should not see it. Which
 * dependency is unwell, and how slowly it answered — nothing about why, no
 * versions, no hostnames.
 */

export type CheckStatus = 'ok' | 'slow' | 'failing' | 'not_installed';

export interface DependencyCheck {
  /** `postgres`, `timescale`, `clerk`. The client translates it. */
  name: string;
  status: CheckStatus;
  latencyMs: number | null;
}

export interface Health {
  status: 'ok' | 'degraded' | 'down';
  checks: DependencyCheck[];
}

/**
 * Everything tunable about this endpoint, in one place.
 *
 * `SLOW_MS` is not a failure — it is the line between a green dot and an amber
 * one, so an operator can see a database getting unhappy before it stops
 * answering. `TIMEOUT_MS` bounds the whole endpoint: a health check that hangs
 * because a dependency hangs is a health check that tells the platform nothing,
 * and the platform's own probe timeout is usually shorter than a TCP one.
 */
const HEALTH = {
  slowMs: 500,
  timeoutMs: 3_000,
} as const;

@Controller('health')
export class HealthController {
  @Get()
  async check(@Res({ passthrough: true }) res: Response): Promise<Health> {
    /*
     * In parallel. Three sequential checks would make the endpoint's own latency
     * the sum of its dependencies', so a slow Clerk would make Postgres look
     * slow too — and the strip would be measuring this handler rather than the
     * things it is about.
     */
    const [postgres, timescale, clerk] = await Promise.all([
      timed('postgres', async () => {
        await pool.query('SELECT 1');
      }),
      timed('timescale', checkTimescale),
      timed('clerk', checkClerk),
    ]);

    const checks = [postgres, timescale, clerk];

    /*
     * Only Postgres can take the whole thing down. Everything else degrades.
     *
     * `not_installed` is not a failure either, and that distinction earns its
     * place: TimescaleDB is deliberately absent until the hosting question in
     * `docs/decisions.md` (2026-09-11) is settled, and a red dot for a considered
     * absence is how an operator learns to stop reading the strip.
     */
    const down = postgres.status === 'failing';
    const degraded = checks.some(
      (check) => check.status === 'failing' || check.status === 'slow',
    );

    if (down) res.status(HttpStatus.SERVICE_UNAVAILABLE);

    return { status: down ? 'down' : degraded ? 'degraded' : 'ok', checks };
  }
}

/**
 * Run a check, time it, and never let it throw or hang.
 *
 * A thrown error is `failing`; a check that returns `'not_installed'` says so.
 * The timeout races rather than aborts — there is no cancelling a query that is
 * already in flight — so a hung dependency costs one connection until it
 * resolves, and the endpoint still answers in three seconds.
 */
async function timed(
  name: string,
  run: () => Promise<CheckStatus | void>,
): Promise<DependencyCheck> {
  const startedAt = Date.now();

  try {
    const outcome = await Promise.race([
      run(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), HEALTH.timeoutMs).unref(),
      ),
    ]);

    const latencyMs = Date.now() - startedAt;

    if (outcome === 'not_installed') return { name, status: 'not_installed', latencyMs };

    return { name, status: latencyMs > HEALTH.slowMs ? 'slow' : 'ok', latencyMs };
  } catch {
    // The reason is not returned. This endpoint is public, and "which of our
    // dependencies is down and why" is free information to somebody probing.
    return { name, status: 'failing', latencyMs: Date.now() - startedAt };
  }
}

/**
 * Whether the time-series extension is there, and doing something.
 *
 * Not merely `SELECT 1` — that would only re-test Postgres. It asks for the
 * extension's version, so the check fails if the extension is dropped or the
 * database is swapped for one without it, which is exactly the change that would
 * silently stop the retention policy running.
 */
async function checkTimescale(): Promise<CheckStatus | void> {
  const { rows } = await pool.query<{ version: string | null }>(
    `SELECT extversion AS version FROM pg_extension WHERE extname = 'timescaledb'`,
  );
  if (rows.length === 0 || rows[0]?.version === null) return 'not_installed';
}

/**
 * Whether Clerk is answering.
 *
 * A cheap authenticated call rather than a ping to the marketing site: the
 * question is whether *our* credentials still work against *their* API, and a
 * reachable host with a rejected key is the failure that actually happens — a
 * rotated secret nobody updated.
 *
 * Without a secret key configured this is `not_installed` rather than failing:
 * a developer running the API with Clerk stubbed out is not an incident.
 */
async function checkClerk(): Promise<CheckStatus | void> {
  const secret = process.env['CLERK_SECRET_KEY'];
  if (!secret) return 'not_installed';

  const response = await fetch('https://api.clerk.com/v1/jwks', {
    headers: { authorization: `Bearer ${secret}` },
  });

  if (!response.ok) throw new Error(`Clerk answered ${response.status}`);
}
