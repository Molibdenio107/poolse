import { useTranslations } from 'next-intl';
import type { PoolseSport } from '@poolse/rules';
import { SportIcon, sportNameKey } from '@/components/sport-icon';
import { cn } from '@/lib/utils';

/**
 * Which sport something belongs to — the handoff's sport chip (Slice 5, Rui
 * 01-11-2026): a 4 × 14 px bar in the sport's colour, its icon and its name.
 *
 * - **Never colour alone**: the name is always written, the icon beside it.
 * - **Only in a multi-sport club.** The caller decides with `isMultiSport`, as
 *   every multi-sport surface does, so a pool-only club never sees one.
 * - **Two fills**: on a card (`card`, the card's fill and lift) or inside a
 *   table or list (`muted`). The sport's colour is the bar, never the fill: it
 *   is a wash, made for atmosphere, and the text stays ink.
 */
export function SportChip({
  sport,
  variant = 'muted',
  className,
}: {
  sport: PoolseSport;
  variant?: 'card' | 'muted';
  className?: string | undefined;
}): React.ReactElement {
  const t = useTranslations();
  return (
    <span
      data-sport={sport}
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-sm py-0.5 pl-1 pr-2 text-xs font-medium text-foreground',
        variant === 'card' ? 'bg-surface shadow-card' : 'bg-surface-muted',
        className,
      )}
    >
      <span aria-hidden className="h-3.5 w-1 shrink-0 rounded-[1px] bg-[rgb(var(--sport-wash))]" />
      <SportIcon sport={sport} className="size-[15px]" />
      {t(sportNameKey(sport))}
    </span>
  );
}

/**
 * A count per sport, with the sport being read added at nought when it has none
 * — POOLSE-143. A sport's own page always has its chip marked current, even
 * before the first student or request arrives, or the row reads as unfiltered.
 */
export function withCurrent<T extends { sport: PoolseSport; count: number }>(
  counts: readonly T[],
  current: PoolseSport | 'none' | null | undefined,
): { sport: PoolseSport; count: number }[] {
  if (current === null || current === undefined || current === 'none') return [...counts];
  if (counts.some((entry) => entry.sport === current)) return [...counts];
  return [...counts, { sport: current, count: 0 }];
}
