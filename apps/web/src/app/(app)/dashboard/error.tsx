'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { useTranslations } from 'next-intl';

/**
 * What a page shows when it fails in a way it did not plan for — 16-10-2026
 * sweep.
 *
 * Before this, an uncaught server error (the API restarting, a network blip)
 * replaced the whole screen with Next's English "Application error". The
 * sidebar stays, the sentence is the reader's language, and they can try
 * again without losing the rest of the app. Pages that expect a failure still
 * say so themselves, with `PageError`; this is only the net under them.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.ReactElement {
  const t = useTranslations();

  useEffect(() => {
    // The digest is what matches this to the server log; the message is not
    // shown, because it is written for a developer.
    console.error('Page failed', error.digest ?? '', error);
  }, [error]);

  return (
    <section className="mx-auto mt-10 flex max-w-page flex-col items-start gap-3 rounded border border-danger/40 bg-danger/10 p-5">
      <h1 className="font-medium text-danger">{t('common.pageFailed')}</h1>
      <p className="text-sm text-foreground-muted">{t('common.pageFailedHint')}</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={reset}
          className="inline-flex h-control items-center justify-center rounded bg-primary px-4 text-control font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {t('common.tryAgain')}
        </button>
        <Link
          href="/dashboard"
          className="inline-flex h-control items-center justify-center rounded border border-border px-4 text-control hover:border-primary/50 hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {t('common.backToDashboard')}
        </Link>
      </div>
    </section>
  );
}
