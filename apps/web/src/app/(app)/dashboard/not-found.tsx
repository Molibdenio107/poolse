import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { LinkBusy } from '@/components/link-busy';

/**
 * A record that is not there — sweep of 31-10-2026. Every `notFound()` under
 * the backoffice used to land on Next's own page: English, no sidebar, white in
 * dark mode. This one keeps the shell, says it in the reader's language and
 * offers the way back to the Painel, like `error.tsx` beside it.
 */
export default async function DashboardNotFound(): Promise<React.ReactElement> {
  const t = await getTranslations();
  return (
    <section className="mx-auto mt-10 flex max-w-page flex-col items-start gap-3 rounded bg-surface p-5 shadow-card">
      <h1 className="font-semibold">{t('common.pageNotFound')}</h1>
      <p className="text-sm text-foreground-muted">{t('common.notFound')}</p>
      <Link
        href="/dashboard"
        className="inline-flex h-control items-center justify-center rounded-sm bg-primary px-4 text-control font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        {t('common.backToDashboard')}
        <LinkBusy />
      </Link>
    </section>
  );
}
