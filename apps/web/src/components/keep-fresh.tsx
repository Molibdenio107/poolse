'use client';

import { startTransition, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { currentBusy } from '@/lib/busy';

/** While the tab is visible, the page re-reads itself this often. */
const EVERY_MS = 2 * 60_000;
/** Coming back to a tab hidden for longer than this re-reads at once. */
const AWAY_MS = 30_000;
/** Somebody who typed within this window is still writing: the refresh waits. */
const TYPING_MS = 60_000;

/**
 * Keep fresh — Rui, 11-11-2026. The light version: no live connection, just a
 * quiet `router.refresh()` so what other people did reaches a page left open —
 * the bell and its circles, the support strip, a colleague's edit.
 *
 * - Every 2 minutes while the tab is visible, and at once on coming back to a
 *   tab that was hidden for more than 30 seconds. Nothing while hidden, so a
 *   forgotten tab costs nothing.
 * - Never in the middle of something: not while a field has focus or was typed
 *   in during the last minute, not with a dialog open, not while the app is
 *   already loading or saving. It simply tries again at the next tick.
 * - `router.refresh()` re-reads the server's part of the page and keeps the
 *   client's — scroll, open sections, controlled form values — so a refresh is
 *   invisible unless something changed. It runs in a transition and raises no
 *   busy indicator: it is not something the person started.
 *
 * Mounted once in each shell (backoffice and phone app). `/admin` has its own
 * status poll and does not mount it.
 */
export function KeepFresh(): null {
  const router = useRouter();

  useEffect(() => {
    let lastTyped = 0;
    let hiddenAt: number | null = document.visibilityState === 'hidden' ? Date.now() : null;

    const busyWithSomething = (): boolean => {
      if (Date.now() - lastTyped < TYPING_MS) return true;
      const active = document.activeElement;
      if (active instanceof HTMLElement && active.matches('input, textarea, select, [contenteditable="true"]')) {
        return true;
      }
      if (document.querySelector('dialog[open], [role="dialog"], [role="alertdialog"]') !== null) return true;
      return currentBusy() !== null;
    };

    const refresh = (): void => {
      if (document.visibilityState !== 'visible' || busyWithSomething()) return;
      startTransition(() => router.refresh());
    };

    const onInput = (): void => {
      lastTyped = Date.now();
    };
    const onVisibility = (): void => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
        return;
      }
      const away = hiddenAt === null ? 0 : Date.now() - hiddenAt;
      hiddenAt = null;
      if (away > AWAY_MS) refresh();
    };

    const timer = window.setInterval(refresh, EVERY_MS);
    document.addEventListener('input', onInput, true);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('input', onInput, true);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [router]);

  return null;
}
