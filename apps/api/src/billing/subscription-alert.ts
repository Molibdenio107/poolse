import { withOrg } from '@poolse/db';

/**
 * The subscription warning on the avatar — Rui, 28-10-2026.
 *
 * The subscription left the dashboard; what is left of it outside *O meu
 * perfil* is one small warning icon on the avatar, for the owner and the
 * admins, when the club's access is about to stop or already has. One
 * definition, here, so the icon, the menu line and their tests cannot disagree:
 *
 *   ended        read-only (the trial clock or an operator), or the
 *                subscription expired or was cancelled
 *   past_due     a payment failed — late already, so no window applies
 *   trial_ending the trial's last day is within the window
 *   paid_ending  a club paying by hand: its paid-through day is within it
 *   cancelling   a Stripe subscription set to cancel, ending within it
 *
 * A comped club is never warned, and a suspended one is not either: the shell
 * shows the suspension instead of the app. When several apply, the one that
 * already bites wins (ended, then past_due), then the soonest.
 *
 * It replaces the read-only banner every member saw (Rui, 28-10-2026: icon
 * only), so a read-only club is told through its owner and admins. A refused
 * write still says why where it failed.
 */

/** How far ahead an end is worth a warning. */
export const SUBSCRIPTION_WARNING_DAYS = 7;

export type SubscriptionAlertKind = 'ended' | 'past_due' | 'trial_ending' | 'paid_ending' | 'cancelling';

export interface SubscriptionAlert {
  kind: SubscriptionAlertKind;
  /** The day it ends or ended, `YYYY-MM-DD` in the club's day; null when there is no date to say. */
  endsOn: string | null;
  /** Days from the club's today to `endsOn`; negative once it has passed. Null with no date. */
  daysLeft: number | null;
}

/** What the decision reads — the organization's own columns, as days. */
export interface SubscriptionFacts {
  status: string | null;
  billingMode: 'stripe' | 'manual' | 'comped';
  suspended: boolean;
  readOnlyOn: string | null;
  trialEndsOn: string | null;
  paidThrough: string | null;
  cancelAtPeriodEnd: boolean;
  periodEndsOn: string | null;
  today: string;
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

export function subscriptionAlert(facts: SubscriptionFacts, windowDays = SUBSCRIPTION_WARNING_DAYS): SubscriptionAlert | null {
  if (facts.suspended || facts.billingMode === 'comped' || facts.status === 'comped') return null;

  const dated = (kind: SubscriptionAlertKind, endsOn: string): SubscriptionAlert => ({
    kind,
    endsOn,
    daysLeft: daysBetween(facts.today, endsOn),
  });

  if (facts.readOnlyOn !== null) return dated('ended', facts.readOnlyOn);
  if (facts.status === 'expired' || facts.status === 'canceled') return { kind: 'ended', endsOn: null, daysLeft: null };
  if (facts.status === 'past_due') {
    return facts.billingMode === 'manual' && facts.paidThrough !== null
      ? dated('past_due', facts.paidThrough)
      : { kind: 'past_due', endsOn: null, daysLeft: null };
  }

  const candidates: SubscriptionAlert[] = [];
  if (facts.status === 'trialing' && facts.trialEndsOn !== null) candidates.push(dated('trial_ending', facts.trialEndsOn));
  if (facts.billingMode === 'manual' && facts.paidThrough !== null) candidates.push(dated('paid_ending', facts.paidThrough));
  if (facts.billingMode === 'stripe' && facts.cancelAtPeriodEnd && facts.periodEndsOn !== null) {
    candidates.push(dated('cancelling', facts.periodEndsOn));
  }
  const soonest = candidates
    .filter((alert) => alert.daysLeft !== null && alert.daysLeft <= windowDays)
    .sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0))[0];
  return soonest ?? null;
}

/** The club's facts, every instant turned into a day in the club's own calendar. */
export async function readSubscriptionAlert(organizationId: string): Promise<SubscriptionAlert | null> {
  const facts = await withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      status: string | null;
      billing_mode: 'stripe' | 'manual' | 'comped';
      suspended: boolean;
      read_only_on: string | null;
      trial_ends_on: string | null;
      paid_through: string | null;
      cancel_at_period_end: boolean;
      period_ends_on: string | null;
      today: string;
    }>(
      `SELECT subscription_status::text AS status,
              billing_mode::text AS billing_mode,
              suspended_at IS NOT NULL AS suspended,
              to_char((read_only_at AT TIME ZONE 'Europe/Lisbon')::date, 'YYYY-MM-DD') AS read_only_on,
              to_char((trial_ends_at AT TIME ZONE 'Europe/Lisbon')::date, 'YYYY-MM-DD') AS trial_ends_on,
              to_char(paid_through, 'YYYY-MM-DD') AS paid_through,
              subscription_cancel_at_period_end AS cancel_at_period_end,
              to_char((subscription_current_period_end AT TIME ZONE 'Europe/Lisbon')::date, 'YYYY-MM-DD') AS period_ends_on,
              to_char(club_today(), 'YYYY-MM-DD') AS today
         FROM organization
        WHERE id = $1`,
      [organizationId],
    );
    return rows[0] ?? null;
  });
  if (facts === null) return null;
  return subscriptionAlert({
    status: facts.status,
    billingMode: facts.billing_mode,
    suspended: facts.suspended,
    readOnlyOn: facts.read_only_on,
    trialEndsOn: facts.trial_ends_on,
    paidThrough: facts.paid_through,
    cancelAtPeriodEnd: facts.cancel_at_period_end,
    periodEndsOn: facts.period_ends_on,
    today: facts.today,
  });
}
