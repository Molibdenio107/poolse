import Stripe from 'stripe';

/**
 * Stripe, and the fact that it is usually not there — slice 2.4, narrowed by
 * POOLSE-60.
 *
 * **Off unless a key says otherwise**, exactly as Sentry and the energy-invoice
 * parser are. A development machine has no Stripe account, the free pilot will
 * never be charged, and a module that threw at boot because a key was absent
 * would make every one of those a broken application rather than an application
 * that does not sell anything today.
 *
 * So every caller asks `stripeEnabled()` first, and the screens say *a
 * subscrição ainda não está configurada* rather than failing. Nothing else in
 * the product changes shape when billing is off.
 *
 * **One plan, two intervals.** Three plans shipped and lasted a day: an
 * organization either pays for Poolse and gets everything, or it does not pay
 * and is on a trial. What is left is how often they pay, so the price map is
 * keyed on the interval rather than on a tier — and `plan` stays in the schema
 * as the descriptive fact that they bought the thing.
 *
 * **Prices live in Stripe, never here.** The pricing page has said "valor por
 * definir" since it was written, and hardcoding an amount would put a number in
 * a deploy that belongs in a dashboard. What this file holds is the *mapping* —
 * which env var names the price for which interval — and the amounts are read
 * back from Stripe for display. Rui sets a price, the page shows it, nothing
 * ships.
 */

/** The one plan. It is what a club bought, never what it may do. */
export const PLAN = 'poolse_full' as const;
export type PlanKey = typeof PLAN;

export type BillingInterval = 'monthly' | 'yearly';

/**
 * Yearly first, because it is what the pricing page offers first.
 *
 * The order is a reading order and nothing else depends on it — but a list that
 * disagreed with the screen would be one more thing to keep in step.
 */
export const BILLING_INTERVALS: readonly BillingInterval[] = ['yearly', 'monthly'];

/**
 * Which environment variable carries each interval's Stripe price.
 *
 * A price id (`price_...`), not a product id: one product has several prices —
 * monthly, yearly, a legacy rate somebody is grandfathered on — and the thing a
 * checkout session needs is the one being sold today.
 */
const PRICE_ENV: Record<BillingInterval, string> = {
  monthly: 'STRIPE_PRICE_MONTHLY',
  yearly: 'STRIPE_PRICE_YEARLY',
};

export function isBillingInterval(value: string): value is BillingInterval {
  return (BILLING_INTERVALS as readonly string[]).includes(value);
}

/** The configured price for an interval, or null where nobody has set one yet. */
export function priceIdFor(interval: BillingInterval): string | null {
  const value = process.env[PRICE_ENV[interval]];
  return value === undefined || value.trim() === '' ? null : value.trim();
}

/**
 * The interval a price id belongs to — the webhook's reverse lookup.
 *
 * Deliberately a map over environment variables rather than a call to Stripe:
 * the webhook path stays fast, stays offline-testable, and cannot fail because
 * somebody else's API is slow while an event is being applied.
 */
export function intervalForPrice(priceId: string): BillingInterval | null {
  return BILLING_INTERVALS.find((interval) => priceIdFor(interval) === priceId) ?? null;
}

export function stripeEnabled(): boolean {
  const key = process.env['STRIPE_SECRET_KEY'];
  return key !== undefined && key.trim() !== '';
}

/** Set when Stripe is configured *and* somebody has priced at least one interval. */
export function anyPriceConfigured(): boolean {
  return BILLING_INTERVALS.some((interval) => priceIdFor(interval) !== null);
}

let client: Stripe | null = null;

/**
 * The client, built once.
 *
 * Lazily rather than at import time, because importing this module must stay
 * free: `app.module.ts` pulls in the controller on every boot, including the
 * boots with no key at all.
 */
export function stripeClient(): Stripe {
  const key = process.env['STRIPE_SECRET_KEY'];
  if (key === undefined || key.trim() === '') {
    throw new Error('Stripe is not configured; callers must check stripeEnabled() first');
  }

  client ??= new Stripe(key.trim(), {
    // Pinned, not floating. An API version that moves under a running
    // deployment is a change nobody made, arriving on Stripe's schedule rather
    // than on ours; upgrading is an edit here and a read of their changelog.
    apiVersion: '2026-08-26.dahlia',
    appInfo: { name: 'Poolse' },
  });

  return client;
}

/** For tests, which build their own client against a fake or none at all. */
export function resetStripeClient(): void {
  client = null;
}

/**
 * What the yearly interval saves against twelve months of the monthly one.
 *
 * Computed here rather than in the view, so *poupa 17%* is a sentence the page
 * renders rather than a sum it does — the same reason the salaries roll-up is
 * derived once on the server.
 *
 * Null unless both prices are known: a saving against a price nobody has set is
 * not a figure, it is a guess. Null too when yearly is not actually cheaper,
 * because *poupa 0%* is a worse thing to print than nothing at all.
 *
 * Floored rather than rounded, so a club working it out on the back of an
 * envelope never finds less than was promised.
 */
export function yearlySavingPercent(
  monthlyCents: number | null,
  yearlyCents: number | null,
): number | null {
  if (monthlyCents === null || yearlyCents === null || monthlyCents <= 0) return null;

  const twelveMonths = monthlyCents * 12;
  if (yearlyCents >= twelveMonths) return null;

  return Math.floor(((twelveMonths - yearlyCents) / twelveMonths) * 100);
}

/**
 * Where Stripe sends somebody back to.
 *
 * `WEB_ORIGIN` is what the invitation links already use, read the same way —
 * first entry, trimmed, because it is a comma-separated list for CORS. Reusing
 * it means a deployment configures one origin rather than two that can disagree
 * about where the app lives.
 */
export function appUrl(path: string): string {
  const base = (process.env['WEB_ORIGIN'] ?? 'http://localhost:3000')
    .split(',')[0]!
    .trim()
    .replace(/\/$/, '');
  return `${base}${path}`;
}
