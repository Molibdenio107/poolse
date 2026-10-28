import { cn } from '@/lib/utils';

/**
 * A small circle that says something here needs doing — POOLSE-120. It pulses
 * three times as it appears, then stays (`.attention`); the words are for a
 * screen reader, because the item's own text says what it is about.
 */
export function AttentionDot({
  count,
  label,
  className,
}: {
  /** Nothing draws when zero or absent. */
  count: number | undefined;
  /** What a screen reader hears — "2 coisas por tratar". */
  label: string;
  className?: string;
}): React.ReactElement | null {
  if (count === undefined || count <= 0) return null;
  return (
    <span className={cn('attention inline-block size-2.5 shrink-0 rounded-full bg-warning align-middle', className)}>
      <span className="sr-only">{label}</span>
    </span>
  );
}
