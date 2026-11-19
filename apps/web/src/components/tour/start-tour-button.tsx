'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Compass } from 'lucide-react';

/** The event `GuidedTour` listens for — POOLSE-230. One way in, from any page. */
export const START_TOUR_EVENT = 'poolse:start-tour';

/** On a page with no menu to point at, the button opens this home instead, which starts it. */
export const TOUR_PARAM = 'tour';

/**
 * Starts the guided tour of the shell this page is in. With `home`, it opens
 * that home with `?tour=1` first — the app's *Definições* has no tab bar, so
 * the tour has to start where the tabs are. The tour never starts on
 * its own (Rui, 19-11-2026): this button, on *Vamos começar* and on Perfil →
 * Definições, and the Ctrl+K action are the only ways in.
 */
export function StartTourButton({
  labelKey = 'tour.start',
  className,
  home,
}: {
  labelKey?: string;
  className?: string;
  /** A home to open first, e.g. `/app/familia`. */
  home?: string;
}): React.ReactElement {
  const t = useTranslations();
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() =>
        home === undefined
          ? window.dispatchEvent(new CustomEvent(START_TOUR_EVENT))
          : router.push(`${home}${home.includes('?') ? '&' : '?'}${TOUR_PARAM}=1`)
      }
      className={
        className ??
        'inline-flex h-control items-center justify-center gap-2 rounded-sm bg-surface px-4 text-control shadow-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary'
      }
    >
      <Compass className="size-4" aria-hidden />
      {t(labelKey as never)}
    </button>
  );
}
