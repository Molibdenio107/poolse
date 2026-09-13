import Stripe from 'stripe';

/**
 * Stripe, and the fact that it is usually not there — slice 2.4.
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
 * **Prices live in Stripe, never here.** The pricing page has said "valor por
 * definir" since it was written, and hardcoding an amount would put a number in
 * a deploy that belongs in a dashboard. What this file holds is the *mapping* —
 * which env var names the price for which plan — and the amounts are read back
 * from Stripe for display. Rui sets a price, the page shows it, nothing ships.
 */

export type PlanKey = 'starter' | 'club' | 'network';

export const PLAN_KEYS: readonly PlanKey[] = ['starter', 'club', 'network'];

/**
 * Which environment variable carries each plan's Stripe price.
 *
 * A price id (`price_...`), not a product id: a product can have several prices
 * — monthly, yearly, a legacy rate somebody is grandfathered on — and the thing
 * a checkout session needs is the one being sold today.
 */
const PRICE_ENV: Record<PlanKey, string> = {
  starter: 'STRIPE_PRICE_STARTER',
  club: 'STRIPE_PRICE_CLUB',
  network: 'STRIPE_PRICE_NETWORK',
};

export function isPlanKey(value: string): value is PlanKey {
  return (PLAN_KEYS as readonly string[]).includes(value);
}

/** The configured price for a plan, or null where nobody has set one yet. */
export function priceIdFor(plan: PlanKey): string | null {
  const value = process.env[PRICE_ENV[plan]];
  return value === undefined || value.trim() === '' ? null : value.trim();
}

/** The plan a price id belongs to — the webhook's reverse lookup. */
export function planForPrice(priceId: string): PlanKey | null {
  return PLAN_KEYS.find((plan) => priceIdFor(plan) === priceId) ?? null;
}

export function stripeEnabled(): boolean {
  const key = process.env['STRIPE_SECRET_KEY'];
  return key !== undefined && key.trim() !== '';
}

/** Set when Stripe is configured *and* somebody has priced at least one plan. */
export function anyPlanPriced(): boolean {
  return PLAN_KEYS.some((plan) => priceIdFor(plan) !== null);
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
