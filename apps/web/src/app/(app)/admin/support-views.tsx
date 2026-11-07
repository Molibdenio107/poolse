import { getTranslations } from 'next-intl/server';
import { PageError } from '@/components/page-shell';
import { formatDate, formatTime } from '@/lib/date-format';
import { apiFetch, type SupportViewEntry } from '@/lib/api';
import { outcome } from '@/lib/load-failure';

/**
 * The views made as support, every club — POOLSE-188. Which club, which home, why
 * and when, and no person's name: the club's Owner has that in *Vistas da app*.
 */
export async function SupportViews(): Promise<React.ReactElement> {
  const t = await getTranslations();
  const loaded = await outcome(apiFetch<{ views: SupportViewEntry[] }>('/platform/support/views'));

  if (loaded.state !== 'ok') {
    return <PageError message={t(loaded.state === 'failed' ? loaded.failure.key : 'common.notAllowed')} />;
  }

  return (
    <section className="flex flex-col gap-3 rounded bg-surface p-5 shadow-card">
      <h2 className="text-sm font-medium">{t('appView.admin.title')}</h2>
      {loaded.data.views.length === 0 ? (
        <p className="text-sm text-foreground-muted">{t('appView.admin.empty')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {loaded.data.views.map((view) => (
            <li key={view.id} className="flex flex-col gap-0.5 py-3 first:pt-0 last:pb-0">
              <p className="font-medium">{view.organizationName}</p>
              <p className="text-sm text-foreground-muted">
                {view.hat === null ? '' : `${t(`appView.${view.hat}`)} · `}
                {formatDate(view.startedAt)} {formatTime(view.startedAt)}
              </p>
              {view.reason !== null && (
                <p className="text-sm text-foreground-muted">
                  {t('appView.history.reason', { reason: view.reason })}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
