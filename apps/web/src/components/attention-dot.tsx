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
  /** Nothing draws when zero or absent; 2 or more draws the number (POOLSE-215). */
  count: number | undefined;
  /** What a screen reader hears — "2 coisas por tratar". */
  label: string;
  className?: string;
}): React.ReactElement | null {
  return <AttentionMark count={count} label={label} className={cn('align-middle', className)} />;
}

/**
 * The one mark for "needs doing" — POOLSE-215 (Rui, 10-11-2026). One thing: the
 * breathing dot. Two or more: a small round chip in the same colour with the
 * number, breathing the same way. A number in that colour always means "to
 * do"; a plain count of what a tab holds is never drawn (they read as missing
 * work). The label is for a screen reader; the number is shown for 2+.
 */
export function AttentionMark({
  count,
  label,
  className,
}: {
  count: number | undefined;
  label: string;
  className?: string;
}): React.ReactElement | null {
  if (count === undefined || count <= 0) return null;
  if (count === 1) {
    return (
      <span className={cn('attention-dot', className)}>
        <span className="sr-only">{label}</span>
      </span>
    );
  }
  return (
    <span className={cn('attention-count', className)}>
      <span aria-hidden>{count > 99 ? '99+' : count}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** The class a card takes while it holds something pending — POOLSE-214. */
export const ATTENTION_CARD = 'attention-card';

/**
 * The emphasis for a pending item, by how many are pending beside it in the
 * same list — POOLSE-216: one alone is the bold box (`attention-card`), two or
 * more are each the accent bar with a faint tint (`attention-row`), so a list of
 * flagged rows is not a wall of boxes. Every pending card and row uses this.
 */
export function attentionClass(pendingInList: number): string {
  return pendingInList > 1 ? 'attention-row' : ATTENTION_CARD;
}
