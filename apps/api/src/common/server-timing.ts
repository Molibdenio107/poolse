import { appendFile } from 'node:fs';
import { performance } from 'node:perf_hooks';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { currentQueryTiming, measureQueries } from '@poolse/db';

/**
 * `Server-Timing` on every response — POOLSE-171: the request's total, the
 * time it spent waiting on the database (`db`) and how many queries it ran
 * (`queries`), measured by `@poolse/db`'s pool wrapper. One middleware, one
 * place. A header, never a row: `RequestStatsInterceptor` already keeps the
 * per-tenant counts, and a second per-request write is exactly what it exists
 * to avoid.
 *
 * Nothing identifying: three numbers, no query text, no tenant.
 *
 * **`PERF_LOG_FILE`**, set only on a machine being measured, also appends one
 * JSON line per request — method, path with every id masked, status and the
 * three numbers — so the perf spec can count the API calls behind a page the
 * Next server rendered (the browser never sees those). Unset, nothing is
 * written. Never set it in production.
 */
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

export function serverTiming(
  request: IncomingMessage,
  response: ServerResponse,
  next: () => void,
): void {
  const started = performance.now();
  measureQueries(() => {
    const timing = currentQueryTiming()!;
    const header = (): string =>
      `total;dur=${(performance.now() - started).toFixed(1)}, db;dur=${timing.db.toFixed(1)}, ` +
      `queries;desc="${timing.queries}"`;

    // Written as the headers go out, so it holds whatever ran before them.
    const writeHead = response.writeHead.bind(response) as (...args: unknown[]) => ServerResponse;
    (response as unknown as { writeHead: (...args: unknown[]) => ServerResponse }).writeHead = (
      ...args: unknown[]
    ) => {
      if (!response.headersSent) response.setHeader('Server-Timing', header());
      return writeHead(...args);
    };

    const file = process.env['PERF_LOG_FILE'];
    if (file) {
      response.on('finish', () => {
        const line = {
          at: Date.now(),
          method: request.method,
          path: (request.url ?? '').split('?')[0]!.replace(UUID, ':id'),
          status: response.statusCode,
          total: Math.round(performance.now() - started),
          db: Math.round(timing.db),
          queries: timing.queries,
        };
        appendFile(file, `${JSON.stringify(line)}\n`, () => undefined);
      });
    }
    next();
  });
}
