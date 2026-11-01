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
 * - the arrows, the fade and the hidden scrollbar are `ScrollArrows`'s, which
 *   wraps each such row (01-11-2026).
 *
 * Runs again on every navigation, because the rows are re-rendered then.
 */
const ROWS = "[data-scroll-row], [role='tablist']";
const CURRENT = "[aria-current='page'], [aria-current='true'], [aria-selected='true'], [data-state='active']";

export function ScrollRows(): null {
  const pathname = usePathname();
  const search = useSearchParams();

  useEffect(() => {
    const rows = Array.from(document.querySelectorAll<HTMLElement>(ROWS));
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
    }
  }, [pathname, search]);

  return null;
}
