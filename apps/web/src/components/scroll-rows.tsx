'use client';

import { useEffect } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

/**
 * Rows that scroll sideways on a phone — tab rows and section pills — say so
 * and show where you are (sweep of 31-10-2026). Mounted once per root layout,
 * like `DetailsAnimator`, so no row has to remember it.
 *
 * For every `[data-scroll-row]` and `[role='tablist']`:
 * - the current item (`aria-current`, `aria-selected`, `data-state=active`) is
 *   scrolled into view, so a pill past the edge is never the one you are on;
 * - a row wider than its box gets `data-overflowing`, and `data-at-end` once it
 *   is scrolled to the end — globals.css fades the right edge until then, which
 *   is the hint that there is more.
 *
 * Runs again on every navigation, because the rows are re-rendered then.
 */
const ROWS = "[data-scroll-row], [role='tablist']";
const CURRENT = "[aria-current='page'], [aria-current='true'], [aria-selected='true'], [data-state='active']";

function mark(row: HTMLElement): void {
  const overflowing = row.scrollWidth > row.clientWidth + 1;
  row.toggleAttribute('data-overflowing', overflowing);
  row.toggleAttribute('data-at-end', !overflowing || row.scrollLeft + row.clientWidth >= row.scrollWidth - 1);
}

export function ScrollRows(): null {
  const pathname = usePathname();
  const search = useSearchParams();

  useEffect(() => {
    const rows = Array.from(document.querySelectorAll<HTMLElement>(ROWS));
    const onScroll = (event: Event): void => mark(event.currentTarget as HTMLElement);
    for (const row of rows) {
      const current = row.querySelector<HTMLElement>(CURRENT);
      if (current !== null && row.scrollWidth > row.clientWidth + 1) {
        // Only the row moves, never the page. Measured on screen rather than by
        // offsetLeft, which is relative to whichever ancestor is positioned —
        // the row itself for the top bar's sections, the page for a tab list.
        const offset = current.getBoundingClientRect().left - row.getBoundingClientRect().left + row.scrollLeft;
        const left = offset - (row.clientWidth - current.offsetWidth) / 2;
        row.scrollLeft = Math.max(0, left);
      }
      mark(row);
      row.addEventListener('scroll', onScroll, { passive: true });
    }
    const onResize = (): void => rows.forEach(mark);
    window.addEventListener('resize', onResize);
    return () => {
      for (const row of rows) row.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
    };
  }, [pathname, search]);

  return null;
}
