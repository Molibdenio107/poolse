'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * Sticks directly beneath the page's own sticky header — POOLSE-92 E.
 *
 * The header's height is not a constant: a back link or not, a subtitle or
 * not, the tab strip or not, and below `md` the whole header sticks where from
 * `md` only the back link does. A fixed `top` would be right on one page and
 * leave a gap or an overlap on the next, so this measures whichever block is
 * actually sticky (`PageShell` marks them `data-page-sticky`) and parks itself
 * at that block's bottom, again whenever it changes size.
 *
 * Until it has measured — the server render, the first frame — it is an
 * ordinary block, which is what it was before.
 */
export function StickyUnderHeader({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState<number | null>(null);

  useLayoutEffect(() => {
    const heads = (): HTMLElement[] =>
      Array.from(document.querySelectorAll<HTMLElement>('[data-page-sticky]')).filter(
        (head) => getComputedStyle(head).position === 'sticky',
      );

    const measure = (): void => {
      const bottoms = heads().map(
        (head) => (Number.parseFloat(getComputedStyle(head).top) || 0) + head.offsetHeight,
      );
      setTop(bottoms.length === 0 ? null : Math.max(...bottoms));
    };

    measure();
    const observer = new ResizeObserver(measure);
    document.querySelectorAll<HTMLElement>('[data-page-sticky]').forEach((head) => observer.observe(head));
    // A breakpoint changes which block sticks without resizing either of them.
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  return (
    <div
      ref={ref}
      // Opaque and full-bleed like the header above it, so content passes under
      // it cleanly; one step below the header's z-10, which wins if they touch.
      className={cn(top !== null && 'sticky z-[9] -mx-page bg-background px-page py-2', className)}
      style={top === null ? undefined : { top }}
    >
      {children}
    </div>
  );
}
