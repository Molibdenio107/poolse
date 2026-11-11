'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useBlocking } from '@/lib/busy';

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

/** The dialogs open now, innermost last — so a stacked one owns the keyboard. */
const OPEN_STACK: symbol[] = [];

export function Dialog({
  open,
  onClose,
  title,
  /** Under the title, in the muted tone. The thing being acted on, usually. */
  description,
  closeLabel,
  children,
  className,
  placement = 'centre',
  initialFocus,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string | undefined;
  /** Translated by the caller — this component holds no strings. */
  closeLabel: string;
  children: React.ReactNode;
  className?: string;
  /**
   * Centred, or a sheet down the right-hand edge — round 6, ticket 4.3.
   *
   * A layout choice and nothing else: the portal, the Escape key, the focus
   * round trip and the scroll lock are identical, and duplicating all four to
   * get a different position is how two dialogs end up behaving differently in
   * the one respect nobody tests.
   *
   * Centred asks a question and waits. A sheet is somewhere to work while the
   * week is still visible behind it, which is what a lesson plan wants — an
   * instructor writing Tuesday's plan is looking at Tuesday.
   *
   * `start` is a sheet down the left-hand edge: the phone's menu (POOLSE-88),
   * which slides out from where the sidebar sits on a desk.
   *
   * `sheet` is app mode's question (POOLSE-136): below `md` the handoff's bottom
   * sheet — scrim at .42, top corners, a 40×4 grabber, dismissed by a swipe
   * down, the scrim or its button; from `md` up the ordinary centred dialog.
   */
  placement?: 'centre' | 'side' | 'start' | 'sheet';
  /**
   * The control to start on, when it is not the first one.
   *
   * The first focusable control is the close button, which is right for a
   * form and wrong for a question whose answer is one key — a dropped file's
   * "read it", where Enter should accept rather than dismiss.
   */
  initialFocus?: React.RefObject<HTMLElement | null> | undefined;
}): React.ReactElement | null {
  const panel = useRef<HTMLDivElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  // `createPortal` needs a document, and the server has none. One state flip
  // after mount is cheaper than a dynamic import for something this small.
  const [mounted, setMounted] = useState(false);
  // Work running (a save, a read, a check) washes the dialog too (Rui, 11-11-2026): the page's
  // wash sits under dialogs, so a dialog stayed bright and clickable while it waited.
  const blocking = useBlocking();
  useEffect(() => setMounted(true), []);

  const close = useCallback(() => onClose(), [onClose]);

  // A sheet follows a finger dragged down from its top, and lets go past 80px.
  const [dragY, setDragY] = useState(0);
  const dragFrom = useRef<number | null>(null);
  const onGrab = (event: React.PointerEvent): void => {
    if (placement !== 'sheet') return;
    dragFrom.current = event.clientY;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };
  const onDrag = (event: React.PointerEvent): void => {
    if (dragFrom.current === null) return;
    setDragY(Math.max(0, event.clientY - dragFrom.current));
  };
  const onRelease = (): void => {
    if (dragFrom.current === null) return;
    dragFrom.current = null;
    if (dragY > 80) close();
    setDragY(0);
  };

  useEffect(() => {
    if (!open) return;

    returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // One more on the stack: only the topmost dialog answers the keyboard.
    const me = Symbol('dialog');
    OPEN_STACK.push(me);

    const onKeyDown = (event: KeyboardEvent): void => {
      // A dialog opened from inside this one owns Escape and Tab until it closes
      // (02-11-2026: the timetable import's own clash and drop questions).
      if (OPEN_STACK[OPEN_STACK.length - 1] !== me) return;
      if (event.key === 'Escape') {
        // A control inside that closes itself on Escape — the turma picker
        // over an earlier choice (POOLSE-110) — marks itself, and the key is
        // its own: Escape then closes that control and not the whole question.
        if (event.target instanceof Element && event.target.closest('[data-own-escape]') !== null) return;
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
      if (initialFocus?.current) {
        initialFocus.current.focus();
        return;
      }
      const focusable = panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      (focusable?.[0] ?? panel.current)?.focus();
    });

    return () => {
      const at = OPEN_STACK.lastIndexOf(me);
      if (at !== -1) OPEN_STACK.splice(at, 1);
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      cancelAnimationFrame(focusFirst);
      returnTo.current?.focus();
    };
  }, [open, close, initialFocus]);

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
      className={cn(
        'fixed inset-0 z-50 flex overflow-y-auto bg-black/40 backdrop-blur-[1px]',
        placement === 'side'
          ? 'items-stretch justify-end p-0 sm:p-4'
          : placement === 'sheet'
            ? '!bg-black/[0.42] items-end justify-center !p-0 md:items-center md:!p-8'
            : placement === 'start'
            ? 'items-stretch justify-start p-0'
            : // Full-screen on a phone (POOLSE-88): a box floating 16px in from
              // every edge leaves a keyboard and a form fighting for half a screen.
              'items-start justify-center p-4 max-sm:p-0 sm:items-center sm:p-8',
        // POOLSE-88: nothing under the notch or the home bar.
        'pt-[max(var(--safe-top),theme(spacing.4))] pb-[max(var(--safe-bottom),theme(spacing.4))]',
        placement === 'centre' || placement === 'sheet' ? '' : 'pt-safe-top pb-0',
      )}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        {...(description === undefined ? {} : { 'aria-describedby': descriptionId })}
        tabIndex={-1}
        aria-busy={blocking}
        onMouseDown={(event) => event.stopPropagation()}
        style={dragY > 0 ? { transform: `translateY(${dragY}px)` } : undefined}
        className={cn(
          'w-full border border-border bg-surface p-5 shadow-lg focus:outline-none',
          placement === 'side'
            ? 'max-w-md self-stretch overflow-y-auto pb-[calc(theme(spacing.5)+var(--safe-bottom))] sm:rounded-lg'
            : placement === 'sheet'
              ? 'max-h-[90dvh] overflow-y-auto rounded-t-[var(--radius-sheet)] border-0 px-4 pt-2.5 pb-[calc(30px+var(--safe-bottom))] shadow-card md:max-w-lg md:rounded md:border md:p-5'
              : placement === 'start'
              ? 'max-w-xs self-stretch overflow-y-auto pb-[calc(theme(spacing.5)+var(--safe-bottom))] pl-[calc(theme(spacing.5)+var(--safe-left))]'
              : 'max-w-lg rounded-lg max-sm:min-h-dvh max-sm:max-w-none max-sm:rounded-none max-sm:border-0 max-sm:pt-[calc(theme(spacing.5)+var(--safe-top))] max-sm:pb-[calc(theme(spacing.5)+var(--safe-bottom))]',
          className,
        )}
      >
        {placement === 'sheet' && (
          // The grabber, and the place a finger takes hold of the sheet.
          <div
            aria-hidden
            onPointerDown={onGrab}
            onPointerMove={onDrag}
            onPointerUp={onRelease}
            onPointerCancel={onRelease}
            className="-mx-4 -mt-2.5 mb-2 flex touch-none justify-center pb-2 pt-2.5 md:hidden"
          >
            <span className="h-1 w-10 rounded-full bg-foreground/20" />
          </div>
        )}
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
            // A control-sized square, pulled back by its own margin so the title
            // row does not grow: 36px to a mouse, 44px to a finger (POOLSE-88).
            className="-m-2 inline-flex h-control w-control shrink-0 items-center justify-center rounded-sm hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>

        {children}
      </div>
      {/*
        Over the panel, inside the backdrop's own layer: the same watermark the page
        gets, taking the clicks and not the focus, for as long as the work runs.
      */}
      {/* After 400 ms, like the page's, so a quick save does not flash. */}
      {blocking && <div aria-hidden data-busy-wash className="busy-wash fixed inset-0 [animation-delay:400ms]" />}
    </div>,
    document.body,
  );
}
