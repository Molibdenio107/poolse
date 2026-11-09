import { useTranslations } from 'next-intl';
import type { PoolseSport } from '@poolse/rules';
import { RATING_ICON } from '@/components/sport-icon';
import { cn } from '@/lib/utils';

/**
 * How a lesson went, 1 to 5 — POOLSE-116; drawn in the sport's own icons since
 * 09-11-2026 (Rui): swimmers for a swimming lesson, tennis balls for tennis,
 * basketballs for basketball — counted, like stars. Faces before that.
 *
 * Still outlined, never a fill colour of its own: attendance, roles, ages and
 * certification already own four colour systems. The count is strong ink and
 * the rest faint, and **the word is always beside it**, so neither the count
 * nor the contrast carries the mood alone.
 */
export const MOODS = [1, 2, 3, 4, 5] as const;
export type Mood = (typeof MOODS)[number];

/** The sport's rating icon, `pool` for anything unknown. */
export function ratingIcon(sport: string | null | undefined): (typeof RATING_ICON)[PoolseSport] {
  return RATING_ICON[(sport ?? 'pool') as PoolseSport] ?? RATING_ICON.pool;
}

/** The count and its word, read-only — the agenda, the register strip, the record. */
export function MoodFace({
  mood,
  sport,
  className,
}: {
  mood: number;
  sport?: string | null;
  className?: string;
}): React.ReactElement {
  const t = useTranslations();
  const Icon = ratingIcon(sport);
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <span className="inline-flex shrink-0 items-center gap-0.5" aria-hidden>
        {MOODS.map((value) => (
          <Icon key={value} className={cn('size-4', value > mood && 'opacity-25')} />
        ))}
      </span>
      <span>{t(`feedback.mood.${mood}`)}</span>
    </span>
  );
}
