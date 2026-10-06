import { readSubscription } from '../billing/subscription.repository.js';
import { energyCosts } from '../energy/invoices.repository.js';
import { listMyTasks } from '../maintenance/maintenance.repository.js';
import { readSetupProgress } from './dashboard.repository.js';
import { excursions, resolveBands, type PoolMetric } from '@poolse/rules';
import { salarySummary, type SalarySummary } from '../staff/compensation.repository.js';
import {
  readMaintenanceOpen,
  readMoneyPeriod,
  readOccupancyToday,
  readPeopleSummary,
  readPoolWater,
  type MaintenanceOpen,
  type MoneyPeriod,
  type OccupancyToday,
  type PeopleSummary,
} from './management.repository.js';
import type { ResolverContext } from './widget-registry.js';

/**
 * The three resolvers slice 1 ships — POOLSE-66.
 *
 * All three answer from data that already exists, through the repository
 * functions the existing endpoints use. That is deliberate: a slice that ends in
 * stubs has not ended, and a resolver that duplicates a query is a second
 * definition of a figure the product already states somewhere else.
 *
 * **A resolver answers `null` for "there is nothing here", and throws for "that
 * went wrong".** The composer turns the first into `state: 'empty'` and the
 * second into `state: 'error'`, and the difference is the whole point: a club
 * with no tasks outstanding and a broken query must not look the same.
 */

/** How many days are left on a trial. Null when there is no trial date. */
function daysLeft(iso: string | null): number | null {
  if (iso === null) return null;
  const ends = Date.parse(iso);
  if (Number.isNaN(ends)) return null;
  /*
   * Rounded up, and floored at zero. A trial ending in four hours has "1 day
   * left" rather than none — the figure is a warning, and rounding a warning
   * down is how it arrives after the thing it warned about. The exact wording
   * belongs to the client, which has the reader's language.
   */
  return Math.max(0, Math.ceil((ends - Date.now()) / 86_400_000));
}

export interface SubscriptionWidget {
  status: string | null;
  trialEndsAt: string | null;
  trialDaysLeft: number | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  /** True once the club is paying through Stripe — the card lives there. */
  hasSubscription: boolean;
}

/**
 * Where this club stands with Poolse — the owner's own question.
 *
 * Reuses `readSubscription`, which is what `/subscription` answers from, so the
 * widget and the Subscrição page cannot disagree about a status. It carries **no
 * price and no card**: those are Stripe's pages, and this is a state, not a
 * receipt.
 */
export async function subscriptionState(ctx: ResolverContext): Promise<SubscriptionWidget | null> {
  const subscription = await readSubscription(ctx.organizationId);
  // Null means the organization is gone from under the request, which is a
  // failure rather than an absence — the reader is inside it.
  if (subscription === null) throw new Error('The organization behind this request is missing');

  return {
    status: subscription.status,
    trialEndsAt: subscription.trialEndsAt,
    trialDaysLeft: daysLeft(subscription.trialEndsAt),
    currentPeriodEnd: subscription.currentPeriodEnd,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    hasSubscription: subscription.hasSubscription,
  };
}

/**
 * Is this trial close enough to matter more than everything else in the band?
 *
 * The ticket asks for the priority to be boosted under five days. It is a
 * predicate on the *resolved* data rather than a number in the registry, because
 * nothing about a declaration can know how many days are left — and it runs
 * after the resolvers precisely so an escalation can still change what survives
 * the band's cap.
 */
export function trialIsClosing(data: unknown): boolean {
  const days = (data as SubscriptionWidget | null)?.trialDaysLeft;
  return typeof days === 'number' && days < 5;
}

export interface TasksWidget {
  total: number;
  /** The first few, for the card. The link goes to the real list. */
  tasks: unknown[];
}

/** How many tasks a card shows before it stops being a card. */
const TASKS_SHOWN = 5;

/**
 * What is mine — slice 4.3's panel, resolving through the same repository
 * function `/maintenance/tasks/mine` uses, including its rule that a job nobody
 * has been given is still visible to somebody.
 */
export async function myTasks(ctx: ResolverContext): Promise<TasksWidget | null> {
  const tasks = await listMyTasks(ctx.organizationId, ctx.membershipId, true);
  if (tasks.length === 0) return null;

  return { total: tasks.length, tasks: tasks.slice(0, TASKS_SHOWN) };
}

export interface EnergyCostsWidget {
  /** Twelve months of bills, summed here rather than in the card. */
  totalCents: number;
  kwh: number;
  billCount: number;
  /** Every month present, an unbilled one null — the chart draws a gap. */
  months: { month: string; totalCents: number | null; kwh: number | null }[];
  latest: {
    supplier: string;
    meterName: string;
    periodStart: string;
    periodEnd: string;
    totalCents: number;
    kwh: number;
  } | null;
}

/**
 * What the club's electricity has cost — slice 2a.
 *
 * The one widget in this slice that was not in slice 1: it was a bespoke panel
 * on the dashboard outside the registry, which is exactly the drift the registry
 * exists to end. Same repository function `/energy/costs` answers from, so the
 * card and the Energia screen cannot disagree about a euro.
 *
 * **The totals are summed here, not in the card.** The panel this replaces
 * reduced the months in the component; a figure derived in two places is a
 * figure that disagrees in one of them, and the rule is that a derived answer is
 * derived once, on the server.
 *
 * `null` when the club has no bills at all, which is the panel's own behaviour —
 * but as an `empty` card rather than as nothing, so a club with meters and no
 * bill yet is told where bills go instead of being shown a blank page.
 */
export async function energySpend(ctx: ResolverContext): Promise<EnergyCostsWidget | null> {
  const costs = await energyCosts(ctx.organizationId);
  if (costs.billCount === 0) return null;

  return {
    totalCents: costs.months.reduce((sum, m) => sum + (m.totalCents ?? 0), 0),
    kwh: costs.months.reduce((sum, m) => sum + (m.kwh ?? 0), 0),
    billCount: costs.billCount,
    months: costs.months.map((m) => ({ month: m.month, totalCents: m.totalCents, kwh: m.kwh })),
    latest:
      costs.latest === null
        ? null
        : {
            supplier: costs.latest.supplier,
            meterName: costs.latest.meterName,
            periodStart: costs.latest.periodStart,
            periodEnd: costs.latest.periodEnd,
            totalCents: costs.latest.totalCents,
            kwh: costs.latest.kwh,
          },
  };
}

export interface ChecklistStep {
  id: 'facility' | 'pools' | 'prices' | 'staff' | 'students';
  done: boolean;
}

export interface ChecklistWidget {
  steps: ChecklistStep[];
}

/**
 * What a brand-new club does next.
 *
 * Rendered **only** when the club has no sites, and then it is the only thing on
 * the page — see `compose.ts`. The later steps are computed anyway rather than
 * assumed false: a club that archived its last site has students and a price
 * list, and telling it to start from nothing would be wrong as well as
 * dispiriting.
 *
 * Never `null`: an empty club is exactly when this has something to say.
 */
export async function setupChecklist(ctx: ResolverContext): Promise<ChecklistWidget> {
  const progress = await readSetupProgress(ctx.organizationId);

  return {
    steps: [
      { id: 'facility', done: progress.facilities > 0 },
      { id: 'pools', done: progress.pools > 0 },
      { id: 'prices', done: progress.feePlans > 0 },
      { id: 'staff', done: progress.staff > 0 },
      { id: 'students', done: progress.students > 0 },
    ],
  };
}

/* -------------------------------------------------------------------------- */
/* The management band's aggregates — slice 2b                                */
/* -------------------------------------------------------------------------- */

/**
 * Mensalidades in their current period. Empty when no line is current — a club
 * that has not priced anything yet has nothing to sum, and "0,00 €" would read
 * as a month nobody paid.
 */
export async function moneyPeriod(ctx: ResolverContext): Promise<MoneyPeriod | null> {
  const money = await readMoneyPeriod(ctx.organizationId, ctx.facilityIds);
  return money.lines === 0 ? null : money;
}

/** Today's classes. Empty on a day nothing is scheduled — a Sunday, a closure. */
export async function occupancyToday(ctx: ResolverContext): Promise<OccupancyToday | null> {
  const today = await readOccupancyToday(ctx.organizationId, ctx.facilityIds);
  return today.classes === 0 ? null : today;
}

/** Open requests and overdue rooms. Empty is good news: nothing outstanding. */
export async function maintenanceOpen(ctx: ResolverContext): Promise<MaintenanceOpen | null> {
  const open = await readMaintenanceOpen(ctx.organizationId, ctx.facilityIds);
  return open.open.length === 0 && open.overdueCleanings === 0 ? null : open;
}

export function maintenanceNeedsSomebody(data: unknown): boolean {
  const open = data as MaintenanceOpen | null;
  if (open === null) return false;
  return open.overdueCleanings > 0 || open.open.some((group) => group.type === 'fault');
}

export interface WaterQualityWidget {
  /** Live tanks in scope, so "2 of 5" can be said. */
  tanks: number;
  /** Tanks out of range, due, or both — the ones somebody should look at. */
  flagged: {
    poolId: string;
    poolName: string;
    takenAt: string | null;
    outOfRange: PoolMetric[];
    due: boolean;
  }[];
}

/**
 * Tanks whose latest analysis is out of range, or overdue for one.
 *
 * The verdict is `excursions` against `resolveBands` — the one definition the
 * pool page and the alert email share — over the latest live analysis that one
 * SQL statement fetched for every tank at once. Empty when there are no tanks,
 * and when every tank is in range and on time: that is the sentence a club
 * wants to read, and it is not an error.
 */
export async function waterQuality(ctx: ResolverContext): Promise<WaterQualityWidget | null> {
  const pools = await readPoolWater(ctx.organizationId, ctx.facilityIds);
  if (pools.length === 0) return null;

  const flagged = pools.flatMap((pool) => {
    const bad = excursions(pool.values, resolveBands(pool.overrides));
    if (bad.length === 0 && !pool.due) return [];
    return [
      {
        poolId: pool.poolId,
        poolName: pool.poolName,
        takenAt: pool.takenAt,
        outOfRange: bad.map((excursion) => excursion.metric),
        due: pool.due,
      },
    ];
  });

  return flagged.length === 0 ? null : { tanks: pools.length, flagged };
}

export function waterIsOutOfRange(data: unknown): boolean {
  const water = data as WaterQualityWidget | null;
  return water?.flagged.some((pool) => pool.outOfRange.length > 0) ?? false;
}

/** The club's people. Never empty: a club has at least the person reading this. */
export async function people(ctx: ResolverContext): Promise<PeopleSummary> {
  return readPeopleSummary(ctx.organizationId);
}

/**
 * What the club's staff cost a month — `salarySummary`, the function Salários
 * answers from, so an Admin's figure excludes the Owner's pay by the same SQL
 * predicate and the card says so in words (`ownerExcluded`). Empty when the
 * club has no staff to cost.
 */
export async function staffCost(ctx: ResolverContext): Promise<SalarySummary | null> {
  const summary = await salarySummary(ctx.organizationId, {
    isOwner: ctx.roles.includes('owner'),
  });
  return summary.coverage.total === 0 ? null : summary;
}
