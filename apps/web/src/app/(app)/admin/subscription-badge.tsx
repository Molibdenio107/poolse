'use client';

import { useTranslations } from 'next-intl';
import {
  Ban,
  CircleCheck,
  CircleHelp,
  Clock,
  Gift,
  TimerOff,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import type { SubscriptionStatus } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * What a tenant is paying, or not — one chip.
 *
 * **An icon per state, not a colour per state.** The standing rule is that
 * colour never carries meaning alone, and this is the badge where it would be
 * most tempting to break it: six statuses, six hues, and an operator scanning a
 * column of them. The word is always rendered and the glyph differs for every
 * value, so the column reads in greyscale, in a screenshot, and to somebody who
 * cannot separate the red from the green.
 *
 * `comped` gets its own everything, because that is the whole reason the value
 * exists. The free pilot is a live tenant that is deliberately not billed — as
 * `active` it would look like revenue, as `trialing` it would look like it was
 * about to lapse, and neither is a thing the operator should have to remember
 * per row.
 *
 * Full class names, never interpolated: Tailwind scans the source as text, so
 * a computed `bg-${tone}/15` is emitted nowhere and the chip arrives unstyled
 * with nothing in the console to say why. The same trap `RoleBadge` documents.
 */
const TONE: Record<SubscriptionStatus, { className: string; Icon: LucideIcon }> = {
  trialing: { className: 'bg-warning/15 text-warning', Icon: Clock },
  active: { className: 'bg-success/15 text-success', Icon: CircleCheck },
  past_due: { className: 'bg-danger/15 text-danger', Icon: TriangleAlert },
  canceled: { className: 'bg-surface-muted text-foreground-muted', Icon: Ban },
  /*
   * A trial that ran out — POOLSE-61, and its own everything for the same reason
   * `comped` had one: it is not `canceled`, which is somebody who chose to
   * leave, and it is not `past_due`, which is a card that will probably work
   * next week. It is a club in read-only waiting to be paid for.
   */
  expired: { className: 'bg-warning/15 text-warning', Icon: TimerOff },
  /*
   * Kept for a row written before POOLSE-63 moved the free pilot onto
   * `billingMode`. Nothing writes it any more; the badge still knows the word,
   * because a value that renders as a grey unknown is worse than one that does
   * not exist.
   */
  comped: { className: 'bg-primary/15 text-primary', Icon: Gift },
};

const FALLBACK = { className: 'bg-surface-muted text-foreground-muted', Icon: CircleHelp };

export function SubscriptionBadge({
  status,
  className,
}: {
  status: string;
  className?: string;
}): React.ReactElement {
  const t = useTranslations();

  // An unrecognised status still renders, greyed and with its raw value, rather
  // than disappearing. A new value added by Stripe in 2.4 should look unfamiliar,
  // not invisible.
  const tone = TONE[status as SubscriptionStatus] ?? FALLBACK;
  const { Icon } = tone;
  const known = status in TONE;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded px-2 py-0.5 text-sm',
        tone.className,
        className,
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {known ? t(`admin.status.${status}`) : status}
    </span>
  );
}
