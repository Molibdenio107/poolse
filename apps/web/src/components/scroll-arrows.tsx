'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * A row that scrolls sideways shows a ‹ and a › instead of a scrollbar (Rui,
 * 01-11-2026): tab strips, section pills, the top bar's sections. Wrap the row
 * — the element marked `data-scroll-row` or `role="tablist"` — and nothing else
 * changes about it.
 *
 * - **An arrow shows only while there is more that way**, and the row fades
 *   under it (`data-more-start` / `data-more-end`, globals.css), so the edge
 *   says "there is more" with or without a pointer.
 * - **No scrollbar**, desk or phone; a finger, a trackpad and the keyboard still
 *   scroll it, and `ScrollRows` still brings the current item into view.
 * - **The arrows are not in the tab order** (`tabIndex={-1}`, hidden from a
 *   screen reader): every item behind them is already reachable by Tab, and the
 *   browser scrolls a focused item into view. Two extra stops on every page of
 *   tabs would be noise to a keyboard.
 */
export function ScrollArrows({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string | undefined;
}): React.ReactElement {
  const t = useTranslations();
  const box = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState({ start: false, end: false });

  const rowOf = useCallback(
    (): HTMLElement | null => box.current?.querySelector<HTMLElement>("[data-scroll-row], [role='tablist']") ?? null,
    [],
  );

  useEffect(() => {
    const row = rowOf();
    if (row === null) return;
    const measure = (): void => {
      const start = row.scrollLeft > 1;
      const end = row.scrollLeft + row.clientWidth < row.scrollWidth - 1;
      row.toggleAttribute('data-more-start', start);
      row.toggleAttribute('data-more-end', end);
      setMore((was) => (was.start === start && was.end === end ? was : { start, end }));
    };
    measure();
    row.addEventListener('scroll', measure, { passive: true });
    // A row changes width with the window and with its own items (a badge, a
    // label in the other language), so watch both rather than the window alone.
    const resize = new ResizeObserver(measure);
    resize.observe(row);
    for (const item of Array.from(row.children)) resize.observe(item);
    return () => {
      row.removeEventListener('scroll', measure);
      resize.disconnect();
    };
  }, [rowOf, children]);

  const step = (direction: 1 | -1): void => {
    const row = rowOf();
    if (row === null) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    row.scrollBy({ left: direction * row.clientWidth * 0.8, behavior: still ? 'auto' : 'smooth' });
  };

  const arrow = (direction: 1 | -1, shown: boolean): React.ReactElement => (
    <button
      type="button"
      tabIndex={-1}
      aria-hidden
      title={t(direction === 1 ? 'scrollRow.next' : 'scrollRow.previous')}
      onClick={() => step(direction)}
      className={cn(
        'absolute top-1/2 z-10 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-sm bg-surface text-foreground-muted shadow-card transition-opacity',
        'hover:text-foreground coarse:size-9',
        direction === 1 ? 'right-0' : 'left-0',
        shown ? 'opacity-100' : 'pointer-events-none opacity-0',
      )}
    >
      {direction === 1 ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
    </button>
  );

  return (
    <div ref={box} className={cn('relative min-w-0', className)}>
      {children}
      {arrow(-1, more.start)}
      {arrow(1, more.end)}
    </div>
  );
}
