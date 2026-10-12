'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Headset, LogOut } from 'lucide-react';
import { useSavedAction } from '@/lib/saved';
import { formatDate, formatTime } from '@/lib/date-format';
import type { FormState } from './actions';
import { endSupportAction, forgetActiveClubAction, stepOutOfSupportAction } from './support.actions';

const INITIAL: FormState = { ok: false };

const BUTTON =
  'inline-flex h-control items-center justify-center gap-2 rounded border px-4 text-control font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60';

/**
 * Support access — POOLSE-79. Two strips, one for each side of the window.
 *
 * Above the page and below the app bar, like the read-only notice: a standing
 * condition, said in words with an icon so the colour only repeats it.
 */

/** The operator's own: whose club this is, when it ends, and the way out. */
export function SupportSessionBanner({
  organizationId,
  organizationName,
  expiresAt,
}: {
  organizationId: string;
  organizationName: string;
  expiresAt: string;
}): React.ReactElement {
  const t = useTranslations();
  const [, end, ending] = useSavedAction<FormState, FormData>(
    endSupportAction.bind(null, organizationId),
    INITIAL,
  );

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-primary/40 bg-primary/10 px-6 py-3 text-sm print:hidden"
    >
      <Headset aria-hidden className="size-4 shrink-0 text-primary" />
      <p className="min-w-0 flex-1 font-medium">
        {t('support.sessionBanner', {
          club: organizationName,
          time: formatTime(expiresAt),
          date: formatDate(expiresAt),
        })}
      </p>
      <form action={stepOutOfSupportAction}>
        <button type="submit" className={`${BUTTON} border-border bg-surface hover:border-primary/50`}>
          <LogOut aria-hidden className="size-4" />
          {t('support.stepOut')}
        </button>
      </form>
      <form action={end}>
        <button
          type="submit"
          disabled={ending}
          className={`${BUTTON} border-primary bg-primary text-primary-foreground hover:bg-primary/90`}
        >
          {ending ? t('common.working') : t('support.endNow')}
        </button>
      </form>
    </div>
  );
}

/**
 * The club's own, quieter: support may be in until …, or support has asked.
 * The Owner gets the way to answer; an Admin is told, so an unfamiliar name
 * in the log reads as Poolse and not as a stranger.
 */
export function ClubSupportStrip({
  isOwner,
  liveUntil,
  pendingRequests,
}: {
  isOwner: boolean;
  liveUntil: string | null;
  pendingRequests: number;
}): React.ReactElement | null {
  const t = useTranslations();
  if (liveUntil === null && pendingRequests === 0) return null;

  const sentence =
    liveUntil !== null
      ? t('support.clubStripLive', { time: formatTime(liveUntil), date: formatDate(liveUntil) })
      : t('support.clubStripAsked', { count: pendingRequests });

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-surface-muted px-6 py-2.5 text-sm print:hidden"
    >
      <Headset aria-hidden className="size-4 shrink-0 text-foreground-muted" />
      <p className="min-w-0 flex-1">{sentence}</p>
      {isOwner && (
        <Link
          href="/dashboard/profile?tab=support"
          className={`${BUTTON} border-border bg-surface hover:border-primary/50 hover:text-primary`}
        >
          {liveUntil !== null ? t('support.manage') : t('support.answer')}
        </Link>
      )}
    </div>
  );
}

/**
 * Instead of the app, when the club this browser chose is not one of the
 * person's clubs any more — a window that ended or was revoked. Acting
 * somewhere else without saying so is the failure this prevents.
 */
export function SupportEndedNotice(): React.ReactElement {
  const t = useTranslations();
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-start justify-center gap-4 px-4">
      <Headset aria-hidden className="size-6 text-foreground-muted" />
      <h1 className="text-lg font-medium">{t('support.endedTitle')}</h1>
      <p className="text-sm text-foreground-muted">{t('support.endedBody')}</p>
      <form action={forgetActiveClubAction}>
        <button type="submit" className={`${BUTTON} border-primary bg-primary text-primary-foreground`}>
          {t('support.backToMine')}
        </button>
      </form>
    </main>
  );
}
