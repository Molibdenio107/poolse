'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The app's dialog — round 6, ticket 4.1.
 *
 * Written because there was not one. Round 5's cancel confirmation rendered
 * itself *in place of its own trigger*, which on the calendar meant inside a
 * grid cell: a form the width of one seventh of a column, clipped by the cell's
 * own `overflow-hidden`, sitting under whatever the next block's stacking
 * context put on top of it. Every screen that needed a question asked in the
 * middle of the page had been hand-rolling a fixed overlay, and the water
 * import's is a third copy of the same forty lines.
 *
 * **`createPortal` rather than a Radix package**, deliberately. The app already
 * depends on Radix for the tooltip and the hover card, where the hard parts are
 * placement near a viewport edge and hover intent — genuinely fiddly things
 * worth a dependency. A centred modal is not that: it is a portal, an Escape
 * key, a click on the backdrop, and returning focus where it came from. All four
 * are below, and a dependency for them would be one more thing to keep current.
 *
 * **What it does do, because each one shipped as a separate bug somewhere:**
 *
 * - **Portals to `document.body`**, so no ancestor's `overflow`, `transform` or
 *   `z-index` can clip or bury it. That is the whole of 4.1.
 * - **Escape closes it**, at the document level, so a keystroke works wherever
 *   focus happens to be.
 * - **The backdrop closes it; the panel does not.** The listener is on the
 *   backdrop element itself rather than testing the event target, so a drag that
 *   *starts* inside the panel and ends outside it does not dismiss the form
 *   somebody was filling in.
 * - **Focus moves in and comes back.** On open, the first focusable control in
 *   the panel takes focus; on close, whatever had it before gets it back — which
 *   is what stops the keyboard user landing back at the top of the page.
 * - **Focus stays in.** Tab from the last control wraps to the first, so a modal
 *   question cannot be answered by tabbing into the page behind it.
 * - **The page behind does not scroll** while it is open.
 *
 * **Rendered only on the client.** `createPortal` needs a real `document`, and a
 * dialog has nothing to contribute to a server render — it is closed until
 * somebody opens it.
 */

/** Everything the browser will hand focus to, in DOM order. */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function Dialog({
  open,
  onClose,
  title,
  /** Under the title, in the muted tone. The thing being acted on, usually. */
  description,
  closeLabel,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string | undefined;
  /** Translated by the caller — this component holds no strings. */
  closeLabel: string;
  children: React.ReactNode;
  className?: string;
}): React.ReactElement | null {
  const panel = useRef<HTMLDivElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  // `createPortal` needs a document, and the server has none. One state flip
  // after mount is cheaper than a dynamic import for something this small.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const close = useCallback(() => onClose(), [onClose]);

  useEffect(() => {
    if (!open) return;

    returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
        return;
      }

      if (event.key !== 'Tab' || panel.current === null) return;

      /*
       * The wrap, both ways.
       *
       * Without it, Tab from the last control lands on the browser chrome and
       * then on the page behind — which is a modal question somebody can walk
       * away from without answering, while the backdrop still says they cannot.
       */
      const focusable = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) return;

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;

      if (event.shiftKey && (active === first || !panel.current.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);

    // The page behind stays put. Restored to whatever it was, not to `''`, so a
    // second dialog closing does not un-hide a scrollbar the first one hid.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // After paint, so the panel exists to be searched.
    const focusFirst = requestAnimationFrame(() => {
      const focusable = panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      (focusable?.[0] ?? panel.current)?.focus();
    });

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      cancelAnimationFrame(focusFirst);
      returnTo.current?.focus();
    };
  }, [open, close]);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      /*
       * The backdrop is the click target, not a `target === currentTarget` test
       * on the panel's parent. A pointer that goes down inside the form and up
       * outside it — selecting text, dragging a slider — reports the backdrop as
       * its target, and the test would throw away what somebody had typed.
       */
      onMouseDown={close}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 backdrop-blur-[1px] sm:items-center sm:p-8"
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        {...(description === undefined ? {} : { 'aria-describedby': descriptionId })}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
        className={cn(
          'w-full max-w-lg rounded-lg border border-border bg-surface p-5 shadow-lg',
          'focus:outline-none',
          className,
        )}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h2 id={titleId} className="text-lg font-medium">
              {title}
            </h2>
            {description !== undefined && (
              <p id={descriptionId} className="text-sm text-foreground-muted">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={close}
            aria-label={closeLabel}
            className="rounded p-1 hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>

        {children}
      </div>
    </div>,
    document.body,
  );
}
