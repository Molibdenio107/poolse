'use client';

import { useTranslations } from 'next-intl';
import type { InvitationDelivery } from '@/lib/api';

/**
 * Whether an invitation email actually went — backlog round 4, ticket 5.
 *
 * Four states, and the fourth is the one that matters. `not_configured` is not a
 * failure: no email provider is set up, the link is meant to be copied by hand,
 * and every invitation in local development would otherwise shout about a
 * problem that is a setting. Calling that "failed" would teach an operator to
 * ignore the badge, which is the one thing it must not do.
 *
 * `sent` deliberately renders nothing. A list where every healthy row carries a
 * green tick is a list nobody scans; absence is the quiet state and the badge
 * appears only when something needs attention.
 */
export function DeliveryBadge({
  delivery,
}: {
  delivery: InvitationDelivery;
}): React.ReactElement | null {
  const t = useTranslations();

  if (delivery === 'sent') return null;

  const tone =
    delivery === 'failed'
      ? 'bg-danger/15 text-danger'
      : delivery === 'pending'
        ? 'bg-warning/15 text-warning'
        : 'bg-surface-muted text-foreground-muted';

  return (
    <span className={`whitespace-nowrap rounded px-2 py-0.5 text-sm ${tone}`}>
      {t(`invite.delivery.${delivery}`)}
    </span>
  );
}
