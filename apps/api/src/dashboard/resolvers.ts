import { readSubscription } from '../billing/subscription.repository.js';
import { listMyTasks } from '../maintenance/maintenance.repository.js';
import { readSetupProgress } from './dashboard.repository.js';
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
