import { AsyncLocalStorage } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';
import type pg from 'pg';

/**
 * How much of a request was the database — POOLSE-171.
 *
 * Every pooled connection's `query` is timed once, here, and the time and the
 * count are added to whatever request is current. The API's one middleware
 * opens a measurement per request (`measureQueries`) and writes the totals as a
 * `Server-Timing` header; outside one (a cron, a script) the wrapper does
 * nothing but call through.
 *
 * Only a duration and a count leave this file — never a query's text, its
 * parameters or the tenant it ran for.
 */
export interface QueryTiming {
  /** Milliseconds spent waiting on the database, summed over the request's queries. */
  db: number;
  queries: number;
}

const storage = new AsyncLocalStorage<QueryTiming>();

/** Runs `fn` with a fresh measurement current; read it with `currentQueryTiming`. */
export function measureQueries<T>(fn: () => T): T {
  return storage.run({ db: 0, queries: 0 }, fn);
}

export function currentQueryTiming(): QueryTiming | undefined {
  return storage.getStore();
}

const TIMED = Symbol('poolse.queryTimed');

/** Wraps a connection's `query` once, when the pool makes it. */
export function timeQueriesOn(pool: pg.Pool): void {
  pool.on('connect', (client) => {
    const target = client as pg.PoolClient & { [TIMED]?: true };
    if (target[TIMED]) return;
    target[TIMED] = true;
    const original = client.query.bind(client) as (...args: unknown[]) => unknown;
    (client as unknown as { query: (...args: unknown[]) => unknown }).query = (...args: unknown[]) => {
      const timing = storage.getStore();
      const started = performance.now();
      const result = original(...args);
      if (timing === undefined || !(result instanceof Promise)) return result;
      return result.finally(() => {
        timing.db += performance.now() - started;
        timing.queries += 1;
      });
    };
  });
}
