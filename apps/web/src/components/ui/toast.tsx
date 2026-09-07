'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CircleAlert, CircleCheck, TriangleAlert, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

/**
 * The short message that says a save landed — round 7.
 *
 * Every card in this app has a Save button and, until now, almost none of them
 * said anything when it worked. A handful printed "Guardado" in grey beside the
 * button, which is the message somebody is least likely to be looking at: their
 * eyes are on the field they just corrected, not on the button they have already
 * pressed.
 *
 * **Raised in one place.** `useSavedAction` is the hook every form's save goes
 * through — 82 call sites — and it already knows when a new result has arrived,
 * because it compares state identity to decide whether to refresh the router.
 * That is exactly the moment a message belongs, so the toast is raised there and
 * no form has to remember to do it.
 *
 * **Muted, not loud.** A success that fills the top of the screen with saturated
 * green is a celebration of something utterly routine. These are the surface
 * colour with a tinted edge and a tinted icon: enough to read the tone at a
 * glance, quiet enough to appear forty times an afternoon without wearing
 * anybody down. The tone is never carried by colour alone — each has its own
 * icon, and the words say what happened.
 *
 * **It leaves on its own.** Four seconds for a success, eight for anything that
 * went wrong, and an × on every one. A refusal is something somebody has to act
 * on, so it gets more reading time; it still goes by itself, because a stack of
 * messages nobody has dismissed is its own kind of clutter.
 */

export type ToastTone = 'success' | 'warning' | 'danger';

export interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
}

/** How long each tone stays, in milliseconds. */
const DWELL: Record<ToastTone, number> = {
  success: 4000,
  warning: 8000,
  danger: 8000,
};

/**
 * Never more than this on screen at once.
 *
 * A page that saves three cards in a row should not bury its own content. The
 * oldest goes when a fourth arrives, which is the one somebody has had longest
 * to read.
 */
const MOST = 3;

interface ToastApi {
  show: (tone: ToastTone, message: string) => void;
}

/*
 * A no-op default rather than a throw.
 *
 * `useToast` is called from a shared hook that runs on every form in the app,
 * including in tests and in any tree that has not mounted the provider. A
 * missing provider should cost a silent message, never a crash on a screen that
 * was otherwise working.
 */
const ToastContext = createContext<ToastApi>({ show: () => undefined });

export function useToast(): ToastApi {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  // Portals need a DOM, and this renders on the server first.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const dismiss = useCallback((id: number) => {
    setToasts((was) => was.filter((one) => one.id !== id));
  }, []);

  const show = useCallback((tone: ToastTone, message: string) => {
    const id = (nextId.current += 1);
    setToasts((was) => [...was, { id, tone, message }].slice(-MOST));
  }, []);

  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {mounted &&
        createPortal(
          /*
            Above the dialog layer, which is z-50: a save inside a side sheet has
            to be readable without closing it. `pointer-events-none` on the stack
            so the strip never swallows a click meant for the page underneath;
            each toast turns them back on for its own box.
          */
          <div
            className="pointer-events-none fixed inset-x-0 top-4 z-[60] flex flex-col items-center gap-2 px-4"
            aria-live="polite"
          >
            {toasts.map((toast) => (
              <ToastCard key={toast.id} toast={toast} onDismiss={dismiss} />
            ))}
          </div>,
          document.body,
        )}
    </ToastContext.Provider>
  );
}

const TONE = {
  success: {
    box: 'border-success/40 bg-success/5',
    icon: 'text-success',
    Icon: CircleCheck,
  },
  warning: {
    box: 'border-warning/40 bg-warning/5',
    icon: 'text-warning',
    Icon: TriangleAlert,
  },
  danger: {
    box: 'border-danger/40 bg-danger/5',
    icon: 'text-danger',
    Icon: CircleAlert,
  },
} as const;

function ToastCard({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: (id: number) => void;
}): React.ReactElement {
  const t = useTranslations();
  const tone = TONE[toast.tone];
  const { Icon } = tone;

  useEffect(() => {
    const timer = window.setTimeout(() => onDismiss(toast.id), DWELL[toast.tone]);
    return () => window.clearTimeout(timer);
  }, [toast.id, toast.tone, onDismiss]);

  return (
    <div
      /*
        `alert` for anything that went wrong, `status` for a success. A screen
        reader interrupts for the first and waits for a pause on the second,
        which is the difference between "you need to know this now" and "that
        worked".
      */
      role={toast.tone === 'success' ? 'status' : 'alert'}
      className={cn(
        'pointer-events-auto flex w-full max-w-md items-start gap-2.5 rounded-lg border',
        'bg-surface px-3 py-2.5 shadow-lg',
        tone.box,
        'animate-in fade-in-0 slide-in-from-top-2 motion-reduce:animate-none',
      )}
    >
      <Icon aria-hidden="true" className={cn('mt-0.5 size-4 shrink-0', tone.icon)} />
      <p className="min-w-0 flex-1 text-sm text-foreground">{toast.message}</p>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label={t('common.close')}
        className="-mr-1 -mt-0.5 shrink-0 rounded p-1 text-foreground-muted hover:bg-surface-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
      >
        <X aria-hidden="true" className="size-3.5" />
      </button>
    </div>
  );
}
