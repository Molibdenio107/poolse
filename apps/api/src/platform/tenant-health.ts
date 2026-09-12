/**
 * Whether a tenant's API is behaving — platform admin, slice 2.
 *
 * **Derived at read time, never stored.** The same reasoning as overdue cleaning
 * and every trigger refusal that carries its own numbers: a stored verdict needs
 * something to keep it true, and "something" is a per-tenant scheduled job, which
 * is the cost this product designs against. It is also a rule that changes — the
 * 2% below is a guess about a product with one tenant in it — and a threshold
 * somebody tunes must not require a backfill.
 *
 * **One config constant, and this is it.** The window and the rate live here, the
 * derivation reads them, and the SQL that gathers the counts is handed the same
 * window. Two implementations of one rule agree until the day they do not.
 */

/** How far back a verdict looks. */
export const HEALTH_WINDOW_HOURS = 24;

/**
 * The 5xx rate at or above which a tenant is red.
 *
 * Two percent of requests failing is roughly one broken screen in fifty page
 * loads, which is the point at which somebody would notice and not yet have
 * telephoned. Below it, a handful of 5xx in a day is worth *seeing* — amber —
 * without being worth interrupting an evening for.
 */
export const RED_5XX_RATE = 0.02;

export type TenantHealth = 'green' | 'amber' | 'red' | 'unknown';

export interface HealthCounts {
  /** Requests in the window. Zero means nothing was recorded, not that nothing failed. */
  requestCount: number;
  count4xx: number;
  count5xx: number;
  /**
   * Whether the most recent request in the window was itself an error.
   *
   * Exact rather than inferred: `tenant_request_stats` stamps both
   * `last_request_at` and `last_error_at`, so this is a comparison rather than a
   * guess about where in an hour a failure fell.
   */
  lastWasError: boolean;
}

/**
 * The verdict.
 *
 * Four states, ordered by severity, and the order is the point — a tenant that
 * satisfies two of them takes the worse one, the way `invoice_status` puts
 * credited above paid above overdue.
 *
 *   unknown  nothing recorded in the window
 *   red      5xx rate at or above the threshold, OR the newest request failed
 *   amber    at least one 5xx, but below the threshold
 *   green    no 5xx at all
 *
 * **`unknown` is not `green`.** A tenant that made no requests at all is a
 * tenant nobody used, which is a different and often more interesting fact than
 * a tenant that worked perfectly. Collapsing them would make a club that stopped
 * logging in look healthy, which is precisely backwards.
 *
 * **The newest-request rule is what makes this useful in the first minute.** A
 * tenant whose API has just started failing has one 5xx against a thousand good
 * requests — a rate of 0.1%, comfortably green — and is on fire. Reading the
 * most recent request catches it immediately and then stays red while the rate
 * climbs to meet it.
 *
 * 4xx never colours anything. A client sending a bad page number or hitting a
 * 403 is the API working; counting it as ill-health would make the strictest
 * tenant look like the sickest one. It is reported, because the count is worth
 * seeing next to the others, and it decides nothing.
 */
export function deriveHealth(counts: HealthCounts): TenantHealth {
  if (counts.requestCount <= 0) return 'unknown';

  if (counts.lastWasError) return 'red';

  if (counts.count5xx <= 0) return 'green';

  return counts.count5xx / counts.requestCount >= RED_5XX_RATE ? 'red' : 'amber';
}

/** Severity order, for sorting the tenants table worst-first. */
export const HEALTH_ORDER: Record<TenantHealth, number> = {
  red: 0,
  amber: 1,
  unknown: 2,
  green: 3,
};
