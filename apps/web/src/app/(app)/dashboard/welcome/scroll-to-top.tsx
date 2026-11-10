'use client';

import { useEffect } from 'react';

/**
 * The welcome opens at the top of the window.
 *
 * It is reached by the create action's redirect, a soft navigation, and Next
 * then scrolls the new page segment into view — which puts its top edge under
 * the sticky app bar and hides half the title (walk, 10-11-2026). `DetailTabs`
 * answers the same thing the same way.
 */
export function ScrollToTop(): null {
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, []);
  return null;
}
