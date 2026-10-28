import { cn } from '@/lib/utils';

/**
 * A small dot that says something here needs doing — POOLSE-120. The shared
 * `.attention-dot`: six pixels, the palette's colour, blinking gently for as
 * long as it is there (Rui, 28-10-2026). The words are for a screen reader,
 * because the item's own text says what it is about.
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
    <span className={cn('attention-dot align-middle', className)}>
      <span className="sr-only">{label}</span>
    </span>
  );
}
