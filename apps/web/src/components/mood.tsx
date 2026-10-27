import { Angry, Frown, Laugh, Meh, Smile, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

/**
 * How a lesson went, 1 to 5 — POOLSE-116.
 *
 * Outlined faces, never a fill: the attendance states, role badges, age
 * brackets and certification status already own four colour systems, and a
 * fifth would be one too many to keep apart. So a mood is a face **and its
 * word**, everywhere it is shown, and colour (only `--primary`, only on the
 * chosen face in the form) never carries it alone.
 */
export const MOODS = [1, 2, 3, 4, 5] as const;
export type Mood = (typeof MOODS)[number];

export const MOOD_ICONS: Record<Mood, LucideIcon> = {
  1: Angry,
  2: Frown,
  3: Meh,
  4: Smile,
  5: Laugh,
};

/** The face and its word, read-only — the agenda, the register strip, the record. */
export function MoodFace({ mood, className }: { mood: number; className?: string }): React.ReactElement {
  const t = useTranslations();
  const Icon = MOOD_ICONS[mood as Mood] ?? Meh;
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <Icon className="size-5 shrink-0" aria-hidden />
      <span>{t(`feedback.mood.${mood}`)}</span>
    </span>
  );
}
