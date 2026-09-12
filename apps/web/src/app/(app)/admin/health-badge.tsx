'use client';

import { useTranslations } from 'next-intl';
import { CircleCheck, CircleHelp, CircleSlash, TriangleAlert, type LucideIcon } from 'lucide-react';
import type { TenantHealth } from '@/lib/api';
import { Hint } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/**
 * Is this tenant's API behaving — one chip.
 *
 * **An icon per verdict, and the word, always.** Four states whose whole
 * vocabulary is colour would be the clearest possible breach of the standing
 * rule; red and green are also the pair most people who see colour differently
 * cannot separate, and this is a column of exactly those two. The glyph differs
 * for every value and the label is rendered, so the column reads in greyscale.
 *
 * **The counts are visible text, not only a tooltip.** A tooltip may clarify
 * what a control does; it may never be the only place a fact appears. So the
 * chip carries the 24-hour figures beside it and the tooltip adds the sentence
 * explaining what the verdict means — which is the explanation, not the
 * information.
 *
 * `unknown` is drawn quietly and is not green. A tenant nobody used is a
 * different fact from a tenant that worked perfectly.
 */
const TONE: Record<TenantHealth, { className: string; Icon: LucideIcon }> = {
  green: { className: 'bg-success/15 text-success', Icon: CircleCheck },
  amber: { className: 'bg-warning/15 text-warning', Icon: TriangleAlert },
  red: { className: 'bg-danger/15 text-danger', Icon: CircleSlash },
  unknown: { className: 'bg-surface-muted text-foreground-muted', Icon: CircleHelp },
};

export function HealthBadge({
  health,
  requests,
  count4xx,
  count5xx,
  className,
}: {
  health: TenantHealth;
  requests: number;
  count4xx: number;
  count5xx: number;
  className?: string;
}): React.ReactElement {
  const t = useTranslations();
  const { className: tone, Icon } = TONE[health];

  return (
    <div className={cn('flex flex-col items-start gap-1', className)}>
      <Hint text={t(`admin.health.hint.${health}`)}>
        {/*
          `tabIndex` so the tooltip opens on keyboard focus as well as on hover —
          the standing rule, and this span is not a button, so Radix has nothing
          focusable to clone without it. A control whose explanation is only
          available to a mouse is a control half the users cannot read.
        */}
        <span
          tabIndex={0}
          className={cn(
            'inline-flex cursor-help items-center gap-1.5 whitespace-nowrap rounded px-2 py-0.5 text-sm',
            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
            tone,
          )}
        >
          <Icon className="size-3.5 shrink-0" aria-hidden />
          {t(`admin.health.${health}`)}
        </span>
      </Hint>

      {/*
        The figures the verdict was derived from, on screen rather than behind a
        hover. `unknown` shows nothing instead of "0 pedidos", which would read
        as a measurement rather than as the absence of one.
      */}
      {health !== 'unknown' && (
        <span className="whitespace-nowrap text-xs tabular-nums text-foreground-muted">
          {t('admin.health.counts', { requests, count4xx, count5xx })}
        </span>
      )}
    </div>
  );
}
