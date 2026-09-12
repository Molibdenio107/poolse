import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
  OnModuleDestroy,
} from '@nestjs/common';
import type { Response } from 'express';
import { platformConfigured, withOrg, withPlatform } from '@poolse/db';
import { Observable, tap } from 'rxjs';
import { tenantStorage } from '../tenant/tenant.context.js';

/**
 * Per-tenant request health, aggregated in memory and flushed once a minute.
 *
 * **Never one row per request.** That is the shape of the whole feature rather
 * than a tuning decision: a club at a hundred requests a minute would write
 * 144,000 rows a day, which is more storage than everything the club actually
 * does, for data whose entire purpose is a coloured dot. Aggregating here means
 * the write rate is one statement per *active tenant* per minute whatever the
 * traffic is, and the table stays small enough that nobody has to think about it.
 *
 * **It records nothing for a request with no tenant.** The landing page, the
 * health check itself, the Clerk webhook, `/me`, `/organizations`, `/join` and
 * every `/platform` route run outside `tenantStorage`, so they are skipped by
 * construction rather than by a list somebody maintains. An operator looking at
 * a tenant's error rate wants that tenant's screens, not Poolse's own plumbing.
 *
 * **It costs a request nothing.** Everything here is an object mutation on a
 * Map; the database is touched by a timer, never in the request path. A
 * telemetry layer that made every response wait on an insert would be the
 * slowness it was installed to measure.
 */

/** How often the buffer reaches the database. */
const FLUSH_INTERVAL_MS = 60_000;

/**
 * How long a row survives where Timescale is not doing it for us.
 *
 * The 30 days come from the same decision as the retention policy; this is the
 * fallback path for the development image and for any host without the
 * extension. Pruned at most once an hour, on the flush that was going to open a
 * connection anyway, so there is still no scheduled job and no per-tenant cost —
 * which is the constraint that ruled a worker out in the first place.
 *
 * Where the hypertable exists, the policy has already dropped the chunk and this
 * DELETE matches nothing. Running both is harmless and means one code path.
 */
const RETENTION_DAYS = 30;
const PRUNE_INTERVAL_MS = 60 * 60_000;

/** What one tenant did in one hour, so far, in this process. */
interface Bucket {
  organizationId: string;
  /** Hour, truncated, as an ISO instant. */
  bucket: string;
  requestCount: number;
  count4xx: number;
  count5xx: number;
  /**
   * Every latency seen since the last flush, in milliseconds.
   *
   * Cleared on flush, so this holds at most a minute of samples for one tenant
   * and never grows. p95 is computed from it and merged into the row by taking
   * the larger of the two — an approximation, documented in the migration and in
   * `docs/features/observability.md`, and one that errs high, which is the safe
   * direction for a health signal.
   */
  latencies: number[];
  lastRequestAt: Date;
  lastErrorAt: Date | null;
  lastErrorRoute: string | null;
  lastErrorMessage: string | null;
}

/** The 500-character ceiling the column also enforces. */
const MESSAGE_LIMIT = 500;

@Injectable()
export class RequestStatsInterceptor implements NestInterceptor, OnModuleDestroy {
  private readonly logger = new Logger(RequestStatsInterceptor.name);

  /** Keyed `<organizationId>|<bucket ISO>`. */
  private readonly buffer = new Map<string, Bucket>();

  private timer: NodeJS.Timeout | undefined;
  private lastPrunedAt = 0;

  constructor() {
    this.timer = setInterval(() => {
      void this.flush();
    }, FLUSH_INTERVAL_MS);

    /*
     * `unref`, so an interval that exists purely to write telemetry never keeps
     * the process alive. Without it `node --test` hangs for a minute at the end
     * of every run and a graceful shutdown waits on a timer nobody is waiting
     * for.
     */
    this.timer.unref();
  }

  /**
   * Flush on the way out, so the last minute of a deploy is not lost.
   *
   * Nest calls this on SIGTERM and SIGINT once `enableShutdownHooks` is on,
   * which `main.ts` turns on for exactly this.
   */
  async onModuleDestroy(): Promise<void> {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    await this.flush();
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    /*
     * `getStore()` rather than `currentTenant()`. The latter throws outside a
     * scoped request, which is the ordinary case for a third of this API —
     * "no tenant" is an answer here, not an error.
     */
    const tenant = tenantStorage.getStore();
    if (!tenant) return next.handle();

    const startedAt = Date.now();
    const response = context.switchToHttp().getResponse<Response>();
    const route = routeOf(context);

    const record = (status: number, message: string | null): void => {
      try {
        this.add(tenant.organizationId, Date.now() - startedAt, status, route, message);
      } catch (error) {
        // Telemetry must never break the request it is measuring.
        this.logger.error(
          `Could not record request stats: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    };

    return next.handle().pipe(
      tap({
        next: () => record(response.statusCode, null),
        error: (error: unknown) => {
          /*
           * The thrown exception's status, not `response.statusCode` — the
           * response has not been written yet when the observable errors, so it
           * still reads 200 and every failure would be counted as a success.
           */
          const status = statusOf(error);
          record(status, status >= 500 ? messageOf(error) : null);
        },
      }),
    );
  }

  private add(
    organizationId: string,
    latencyMs: number,
    status: number,
    route: string,
    message: string | null,
  ): void {
    const now = new Date();
    const bucket = hourOf(now);
    const key = `${organizationId}|${bucket}`;

    let entry = this.buffer.get(key);
    if (entry === undefined) {
      entry = {
        organizationId,
        bucket,
        requestCount: 0,
        count4xx: 0,
        count5xx: 0,
        latencies: [],
        lastRequestAt: now,
        lastErrorAt: null,
        lastErrorRoute: null,
        lastErrorMessage: null,
      };
      this.buffer.set(key, entry);
    }

    entry.requestCount += 1;
    entry.latencies.push(latencyMs);
    entry.lastRequestAt = now;

    if (status >= 500) {
      entry.count5xx += 1;
      entry.lastErrorAt = now;
      entry.lastErrorRoute = route;
      entry.lastErrorMessage = message;
    } else if (status >= 400) {
      entry.count4xx += 1;
    }
  }

  /**
   * Write the buffer out and empty it.
   *
   * **The buffer is taken before the first `await`.** Node is single-threaded up
   * to the await, so swapping the map atomically here means a request arriving
   * mid-flush lands in the *next* batch rather than in one being written — which
   * is the difference between a slightly late count and a lost one.
   *
   * One `withOrg` per tenant, because that is the only sanctioned way to touch
   * tenant-scoped data and the row's RLS policy reads the GUC. Sequential rather
   * than parallel: a flush has all minute to finish and a burst of connections
   * from a timer is exactly the kind of thing that makes a small database
   * unhappy at the moment it is least convenient.
   *
   * Deliberately swallows its own failures. A telemetry write that could take
   * the API down would be worse than no telemetry.
   */
  async flush(): Promise<void> {
    if (this.buffer.size === 0) {
      await this.prune();
      return;
    }

    const batch = [...this.buffer.values()];
    this.buffer.clear();

    for (const entry of batch) {
      try {
        await withOrg(entry.organizationId, async (tx) => {
          await tx.query(
            `
            INSERT INTO tenant_request_stats (
              organization_id, bucket,
              request_count, count_4xx, count_5xx, p95_latency_ms,
              last_request_at, last_error_at, last_error_route, last_error_message
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            ON CONFLICT (organization_id, bucket) DO UPDATE SET
              /*
               * Counts add. p95 takes the larger of the two, which is the
               * approximation the column's comment owns: a true hourly p95
               * needs every sample kept for the hour, and keeping them is the
               * per-request storage this whole design exists to avoid.
               */
              request_count  = tenant_request_stats.request_count + excluded.request_count,
              count_4xx      = tenant_request_stats.count_4xx     + excluded.count_4xx,
              count_5xx      = tenant_request_stats.count_5xx     + excluded.count_5xx,
              p95_latency_ms = greatest(tenant_request_stats.p95_latency_ms,
                                        excluded.p95_latency_ms),
              last_request_at = greatest(tenant_request_stats.last_request_at,
                                         excluded.last_request_at),
              /*
               * The error fields move together or not at all. A batch with no
               * failure in it must not blank the one recorded twenty minutes
               * ago, and a batch that did fail must not leave last hour's route
               * beside this minute's timestamp.
               */
              last_error_at      = coalesce(excluded.last_error_at,
                                            tenant_request_stats.last_error_at),
              last_error_route   = CASE WHEN excluded.last_error_at IS NULL
                                        THEN tenant_request_stats.last_error_route
                                        ELSE excluded.last_error_route END,
              last_error_message = CASE WHEN excluded.last_error_at IS NULL
                                        THEN tenant_request_stats.last_error_message
                                        ELSE excluded.last_error_message END
            `,
            [
              entry.organizationId,
              entry.bucket,
              entry.requestCount,
              entry.count4xx,
              entry.count5xx,
              percentile(entry.latencies, 95),
              entry.lastRequestAt,
              entry.lastErrorAt,
              entry.lastErrorRoute,
              entry.lastErrorMessage,
            ],
          );
        });
      } catch (error) {
        this.logger.error(
          `Could not flush request stats for ${entry.organizationId}: ` +
            (error instanceof Error ? error.message : String(error)),
        );
      }
    }

    await this.prune();
  }

  /**
   * Drop rows past the retention window, where Timescale is not doing it.
   *
   * At most hourly, and only on a flush that was going to open a connection
   * anyway, so this adds no timer and no per-tenant running cost — which is the
   * constraint that ruled a scheduled worker out in the first place.
   */
  private async prune(): Promise<void> {
    const now = Date.now();
    if (now - this.lastPrunedAt < PRUNE_INTERVAL_MS) return;
    this.lastPrunedAt = now;

    /*
     * On the platform connection, not the tenant one.
     *
     * Retention is not one tenant's operation, and `poolse_app` could not do it
     * anyway: with no GUC set its policy admits nothing, so an unscoped DELETE
     * would remove zero rows and report success — the isolation guarantee
     * working exactly as designed, and silently useless here. Scoping the
     * delete per tenant is the other tempting wrong answer: an inactive
     * tenant's old rows would then never be reached, because only active
     * tenants are in the batch.
     *
     * Where the hypertable exists its retention policy has already dropped the
     * chunk and this matches nothing. Running both is harmless and keeps one
     * code path.
     */
    try {
      if (!platformConfigured()) {
        // Nothing to prune with. Debug rather than a warning: a developer
        // without the platform area configured is not in trouble.
        this.logger.debug('No platform connection; skipping retention prune.');
        return;
      }

      await withPlatform(async (tx) => {
        const { rowCount } = await tx.query(
          `DELETE FROM tenant_request_stats
            WHERE bucket < now() - make_interval(days => $1)`,
          [RETENTION_DAYS],
        );
        if ((rowCount ?? 0) > 0) {
          this.logger.log(`Retention: removed ${rowCount} request-stats row(s).`);
        }
      });
    } catch (error) {
      this.logger.error(
        `Could not prune request stats: ` +
          (error instanceof Error ? error.message : String(error)),
      );
    }
  }
}

/** The hour a moment falls in, truncated, as the column stores it. */
function hourOf(at: Date): string {
  const hour = new Date(at);
  hour.setUTCMinutes(0, 0, 0);
  return hour.toISOString();
}

/**
 * The route pattern, never the URL.
 *
 * `/students/:id` rather than `/students/8f3c…`: the pattern groups, and the URL
 * would put a tenant's identifiers into a table that is explicitly meant to hold
 * none. Falls back to the path only where Express has no route — a 404, where
 * there is no pattern to have.
 */
function routeOf(context: ExecutionContext): string {
  const request = context.switchToHttp().getRequest<{
    method: string;
    path?: string;
    route?: { path?: string };
  }>();
  return `${request.method} ${request.route?.path ?? request.path ?? '?'}`;
}

function statusOf(error: unknown): number {
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : 500;
}

/**
 * A message short enough for the column and shorn of anything identifying.
 *
 * Only the exception's own text, never its cause chain, never a body, never a
 * parameter. A Postgres error quoting the row that violated a constraint is the
 * realistic way a student's name would end up in here, so the message is cut
 * hard and the column refuses anything longer.
 */
function messageOf(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error);
  const trimmed = message.trim();
  if (trimmed === '') return null;
  return trimmed.length > MESSAGE_LIMIT ? `${trimmed.slice(0, MESSAGE_LIMIT - 1)}…` : trimmed;
}

/**
 * The nth percentile of a sample, nearest-rank.
 *
 * Nearest-rank rather than interpolating: with a minute's worth of samples the
 * difference is noise, and this always returns a latency that actually occurred,
 * which is easier to reason about when somebody is looking at a number and
 * wondering whether to believe it.
 */
export function percentile(samples: number[], nth: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.ceil((nth / 100) * sorted.length);
  return Math.round(sorted[Math.min(Math.max(rank, 1), sorted.length) - 1]!);
}
