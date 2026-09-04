'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The message that tells somebody why what they just did did not work.
 *
 * Rui's report: dragging a class onto a time the site is closed is correctly
 * refused, "however there's no user feedback why it didn't work". There *was* a
 * message — a line of small red text under a fourteen-row grid, three screens
 * below where the block was dropped. A message nobody can see is not feedback,
 * and the block silently springing back reads as a bug in the drag.
 *
 * So this floats: fixed to the top of the viewport, over whatever is there, in
 * the place the eye goes when something has just happened. Modelled on the
 * OutSystems 11 feedback message, which is the shape Rui asked for.
 *
 * ---------------------------------------------------------------------------
 * Three decisions worth keeping
 * ---------------------------------------------------------------------------
 *
 * **An error does not auto-dismiss; a success does.** A confirmation nobody
 * reads has still done its job — the thing happened. A refusal nobody reads
 * leaves somebody staring at a grid wondering what they did wrong, and a
 * five-second window is exactly long enough to be missed while looking at the
 * block that sprang back. Errors stay until dismissed or replaced.
 *
 * **`role="alert"` for a refusal, `role="status"` for the rest.** An alert
 * interrupts a screen reader, which is right for "that did not work" and wrong
 * for "saved". Getting this backwards makes the app either rude or silent.
 *
 * **Colour is never the signal.** Each kind carries its own icon and its own
 * words; the tint is what makes it findable, not what makes it readable — the
 * same rule the grid's category colours follow.
 */

export type FeedbackKind = 'error' | 'warning' | 'success' | 'info';

export interface FeedbackMessage {
  kind: FeedbackKind;
  /** Already translated. This component composes no sentences. */
  text: string;
  /** A second line, smaller — the lane that was taken, the hours the site keeps. */
  detail?: string | null;
  /**
   * Bumped by the caller on every raise, so the same message twice in a row
   * still re-announces and re-starts the dismiss timer. Without it, dropping on
   * the same closed Tuesday twice would look like nothing happened the second
   * time.
   */
  attempt: number;
}

const TONE: Record<FeedbackKind, { box: string; icon: typeof Info }> = {
  // Solid fills, for the reason POOLSE-53's alert chip uses one: this floats
  // over arbitrary content, so it has to carry its own ground rather than
  // borrow whatever is behind it.
  error: { box: 'bg-destructive text-destructive-foreground', icon: XCircle },
  warning: { box: 'bg-warning text-[rgb(17,24,28)]', icon: AlertTriangle },
  success: { box: 'bg-success text-[rgb(17,24,28)]', icon: CheckCircle2 },
  info: { box: 'bg-primary text-primary-foreground', icon: Info },
};

/** How long a message that is only good news stays up. */
const DISMISS_AFTER = 5_000;

export function Feedback({
  message,
  onDismiss,
  dismissLabel,
}: {
  message: FeedbackMessage | null;
  onDismiss: () => void;
  /** Translated by the caller — this component holds no strings. */
  dismissLabel: string;
}): React.ReactElement | null {
  const [shown, setShown] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const kind = message?.kind;
  const attempt = message?.attempt;

  useEffect(() => {
    if (message === null) {
      setShown(false);
      return;
    }

    setShown(true);

    if (timer.current !== null) clearTimeout(timer.current);

    /*
     * Only the kinds that are safe to miss. An error that vanished after five
     * seconds would recreate the bug this component exists to fix, one step
     * further along.
     */
    if (kind === 'success' || kind === 'info') {
      timer.current = setTimeout(onDismiss, DISMISS_AFTER);
    }

    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
    };
    // `attempt` rather than the object: a caller raising the same refusal twice
    // hands over a new object each time, and depending on it would restart the
    // timer on every render instead of on every raise.
  }, [kind, attempt, message, onDismiss]);

  if (message === null) return null;

  const tone = TONE[message.kind];
  const Icon = tone.icon;

  return (
    <div
      /*
       * Fixed and centred at the top, above the app bar. `pointer-events-none`
       * on the positioner and `auto` on the card, so a message sitting over the
       * grid never swallows a click meant for what is underneath it — the one
       * way a floating banner can be worse than no banner at all.
       */
      className="pointer-events-none fixed inset-x-0 top-4 z-50 flex justify-center px-4 print:hidden"
    >
      <div
        role={message.kind === 'error' || message.kind === 'warning' ? 'alert' : 'status'}
        aria-live={message.kind === 'error' ? 'assertive' : 'polite'}
        className={cn(
          'pointer-events-auto flex max-w-xl items-start gap-3 rounded-lg px-4 py-3 shadow-lg',
          tone.box,
          // A small entrance, skipped for anybody who has asked for less motion.
          'motion-safe:transition-all motion-safe:duration-200',
          shown ? 'translate-y-0 opacity-100' : '-translate-y-2 opacity-0',
        )}
      >
        <Icon aria-hidden className="mt-0.5 size-5 shrink-0" />

        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{message.text}</p>
          {message.detail !== null && message.detail !== undefined && message.detail !== '' && (
            <p className="mt-0.5 text-sm opacity-90">{message.detail}</p>
          )}
        </div>

        <button
          type="button"
          onClick={onDismiss}
          aria-label={dismissLabel}
          className="-mr-1 -mt-1 rounded p-1 hover:bg-black/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-current"
        >
          <X aria-hidden className="size-4" />
        </button>
      </div>
    </div>
  );
}
