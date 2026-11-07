import { getTranslations } from 'next-intl/server';
import { Eye } from 'lucide-react';
import { PageEmpty, PageError } from '@/components/page-shell';
import { Pagination } from '@/components/pagination';
import { apiFetch, type AppViewEntry } from '@/lib/api';
import { formatDate, formatTime } from '@/lib/date-format';
import { outcome } from '@/lib/load-failure';
import type { Paginated } from '@/lib/pagination';

/**
 * *Vistas da app* — POOLSE-188, rule 9. Who looked at the app as whom, Poolse
 * support included. The Owner's alone, and the API refuses anybody else.
 */
export async function AppViews({ page }: { page: string | undefined }): Promise<React.ReactElement> {
  const t = await getTranslations();
  const query = page === undefined ? '' : `?page=${encodeURIComponent(page)}`;
  const loaded = await outcome(apiFetch<Paginated<AppViewEntry>>(`/app-view/history${query}`));

  if (loaded.state !== 'ok') {
    return <PageError message={t(loaded.state === 'failed' ? loaded.failure.key : 'common.notAllowed')} />;
  }
  if (loaded.data.items.length === 0) {
    return <PageEmpty message={t('appView.history.empty')} hint={t('appView.history.explain')} />;
  }

  return (
    <section className="flex flex-col gap-3 rounded bg-surface p-5 shadow-card">
      <div className="flex items-start gap-2">
        <Eye aria-hidden className="mt-0.5 size-4 shrink-0 text-foreground-muted" />
        <div>
          <h2 className="text-sm font-medium">{t('appView.history.title')}</h2>
          <p className="text-sm text-foreground-muted">{t('appView.history.explain')}</p>
        </div>
      </div>
      <ul className="flex flex-col divide-y divide-border">
        {loaded.data.items.map((entry) => (
          <li key={entry.id} className="flex flex-col gap-0.5 py-3 first:pt-0 last:pb-0">
            <p className="font-medium">
              {t('appView.history.line', {
                viewer: entry.support ? t('appView.history.support') : entry.viewerName,
                viewed: entry.viewedName,
              })}
            </p>
            <p className="text-sm text-foreground-muted">
              {t('appView.history.meta', {
                home: t(`appView.${entry.hat}`),
                date: formatDate(entry.startedAt),
                from: formatTime(entry.startedAt),
                to: formatTime(entry.endedAt),
              })}
            </p>
            {entry.reason !== null && (
              <p className="text-sm text-foreground-muted">
                {t('appView.history.reason', { reason: entry.reason })}
              </p>
            )}
          </li>
        ))}
      </ul>
      <Pagination page={loaded.data} basePath="/dashboard/profile" query={{ tab: 'app-views' }} />
    </section>
  );
}
