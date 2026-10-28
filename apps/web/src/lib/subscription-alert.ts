import { formatDate } from './date-format';

/**
 * The subscription warning's words — Rui, 28-10-2026. The API decides whether
 * there is a warning and which (`GET /subscription/alert`); this says it, once,
 * for the avatar's menu and the Subscrição card on *O meu perfil*.
 */

export type SubscriptionAlertKind = 'ended' | 'past_due' | 'trial_ending' | 'paid_ending' | 'cancelling';

export interface SubscriptionAlert {
  kind: SubscriptionAlertKind;
  /** `YYYY-MM-DD`, or null when there is no date to say. */
  endsOn: string | null;
  /** Negative once it has passed. */
  daysLeft: number | null;
}

export interface SubscriptionAlertView {
  alert: SubscriptionAlert | null;
  /** The owner: the warning links to Subscrição. Anybody else is told who renews. */
  canOpen: boolean;
}

type Translate = (key: string, values?: Record<string, string | number>) => string;

/** One sentence: what is ending and when. */
export function subscriptionAlertSentence(t: Translate, alert: SubscriptionAlert): string {
  const date = alert.endsOn === null ? '' : formatDate(alert.endsOn);
  const days = alert.daysLeft ?? 0;
  switch (alert.kind) {
    case 'ended':
      return alert.endsOn === null ? t('subscriptionAlert.ended') : t('subscriptionAlert.endedOn', { date });
    case 'past_due':
      return alert.endsOn === null ? t('subscriptionAlert.pastDue') : t('subscriptionAlert.pastDueSince', { date });
    case 'trial_ending':
      return days <= 0 ? t('subscriptionAlert.trialToday') : t('subscriptionAlert.trialEnding', { days, date });
    case 'paid_ending':
      return days < 0 ? t('subscriptionAlert.paidLate', { date }) : t('subscriptionAlert.paidEnding', { days, date });
    case 'cancelling':
      return t('subscriptionAlert.cancelling', { days, date });
  }
}
