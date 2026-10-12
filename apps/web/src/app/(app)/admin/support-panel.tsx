import { getTranslations } from 'next-intl/server';
import { formatDate, formatTime } from '@/lib/date-format';
import { PageEmpty, PageError } from '@/components/page-shell';
import { listOpenSupportGrants } from '../dashboard/support.actions';
import { EnterSupportButton } from './enter-support-button';

/**
 * Where support has been let in — POOLSE-79.
 *
 * Every club with an open window, soonest to close first, and the way in. The
 * operator enters as a membership of their own, and from then on works in the
 * club through the ordinary app, with a banner saying so.
 */
export async function SupportPanel(): Promise<React.ReactElement> {
  const t = await getTranslations();
  const open = await listOpenSupportGrants();

  if (open.state !== 'ok') {
    return (
      <PageError
        message={t(open.state === 'failed' ? open.failure.key : 'common.notAllowed')}
      />
    );
  }

  if (open.data.length === 0) {
    return <PageEmpty message={t('admin.support.none')} hint={t('admin.support.noneHint')} />;
  }

  return (
    <section className="flex flex-col gap-3 rounded border border-border bg-surface p-5">
      <ul className="flex flex-col divide-y divide-border">
        {open.data.map((grant) => (
          <li
            key={grant.grantId}
            className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex min-w-0 flex-col gap-0.5">
              <p className="font-medium">{grant.organizationName}</p>
              <p className="text-sm text-foreground-muted">
                {t(`support.source.${grant.source}`)}
                {' · '}
                {t('admin.support.until', {
                  time: formatTime(grant.expiresAt),
                  date: formatDate(grant.expiresAt),
                })}
              </p>
            </div>
            <EnterSupportButton grantId={grant.grantId} club={grant.organizationName} />
          </li>
        ))}
      </ul>
    </section>
  );
}
