'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useCurrentBusy, type BusyKind } from '@/lib/busy';

/**
 * The corner that says something is happening — POOLSE-98.
 *
 * Bottom right, small, never in the way: it takes no clicks, sits below the
 * toasts (which are top centre, and above it in z-order besides) and lifts
 * itself over a bar stuck to the bottom of the screen (`data-bottom-bar`, the
 * register's Save) and the phone's home indicator.
 *
 * **Only when it is slow.** It appears once something has been running for
 * 400 ms, so a fast save never flickers, and once shown it stays at least
 * 300 ms, so a thing that ends just after it appeared does not blink. The
 * label is what is running: *A carregar…*, *A guardar…*, *A exportar…*.
 *
 * **Said once to a screen reader** through a polite live region that is always
 * mounted (a region that appears with its text is not announced everywhere).
 * Under reduced motion the spinner is a dot that pulses instead of turning.
 */

const SHOW_AFTER_MS = 400;
const SHOW_AT_LEAST_MS = 300;

export function BusyIndicator(): React.ReactElement {
  const t = useTranslations();
  const busy = useCurrentBusy();
  const [shown, setShown] = useState<BusyKind | null>(null);
  const shownAt = useRef(0);
  const [lift, setLift] = useState(0);

  useEffect(() => {
    if (busy !== null) {
      // Already showing: follow the label. Not yet: wait to see if it is slow.
      if (shown !== null) {
        setShown(busy);
        return;
      }
      const timer = window.setTimeout(() => {
        shownAt.current = performance.now();
        setShown(busy);
      }, SHOW_AFTER_MS);
      return () => window.clearTimeout(timer);
    }
    if (shown === null) return;
    const left = SHOW_AT_LEAST_MS - (performance.now() - shownAt.current);
    const timer = window.setTimeout(() => setShown(null), Math.max(0, left));
    return () => window.clearTimeout(timer);
  }, [busy, shown]);

  // Over whatever bar is stuck to the bottom of the screen right now.
  useEffect(() => {
    if (shown === null) return;
    const bars = Array.from(document.querySelectorAll<HTMLElement>('[data-bottom-bar]'))
      .map((bar) => bar.getBoundingClientRect())
      .filter((rect) => rect.height > 0 && rect.bottom >= window.innerHeight - 2);
    setLift(bars.length === 0 ? 0 : Math.max(...bars.map((rect) => rect.height)));
  }, [shown]);

  return (
    <div
      role="status"
      aria-live="polite"
      data-busy-indicator
      className="pointer-events-none fixed z-[55]"
      style={{
        right: 'calc(1rem + var(--safe-right))',
        bottom: `calc(1rem + var(--safe-bottom) + ${lift}px)`,
      }}
    >
      {shown !== null && (
        <span
          data-busy={shown}
          className="flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-sm text-foreground-muted shadow-md"
        >
          {/* A ring that turns, or — under reduced motion — a dot that pulses. */}
          <span
            aria-hidden
            className="size-3.5 rounded-full border-2 border-primary/30 border-t-primary motion-safe:animate-spin motion-reduce:hidden"
          />
          <span
            aria-hidden
            className="hidden size-2.5 rounded-full bg-primary motion-reduce:inline-block motion-reduce:animate-pulse"
          />
          {t(`busy.${shown}`)}
        </span>
      )}
    </div>
  );
}
