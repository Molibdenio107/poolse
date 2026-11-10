import { getTranslations } from 'next-intl/server';
import { ApiError, apiFetch, type PlatformEmailStatus } from '@/lib/api';
import { PageError } from '@/components/page-shell';
import { describeLoad } from '@/lib/load-failure';
import { FromLink } from '@/components/from-link';
import { EmailTestButton } from './email-test-button';

/**
 * *Email* on Plataforma — POOLSE-217 (Rui, 10-11-2026). Read-only: whether
 * sending is on, from which address, and per club what has not left yet
 * (waiting for the hourly retry, or given up after five tries). The key is a
 * server secret and is never shown or set here. One action: a test email to the
 * operator's own address, recorded and alerted as every platform write is.
 */
export async function EmailPanel(): Promise<React.ReactElement | null> {
  const t = await getTranslations();
  let status: PlatformEmailStatus;
  try {
    status = await apiFetch<PlatformEmailStatus>('/platform/email');
  } catch (error) {
    if (error instanceof ApiError && error.code === 'not_platform_admin') return null;
    const failure = describeLoad(error);
    return <PageError message={t(failure.key)} detail={failure.detail} />;
  }

  return (
    <section aria-labelledby="admin-email" className="flex flex-col gap-3 rounded bg-surface p-5 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="admin-email" className="font-medium">
            {t('admin.email.title')}
          </h2>
          <p className="text-sm">
            {status.configured
              ? t('admin.email.on', { from: status.from })
              : t('admin.email.off', { provider: status.provider })}
          </p>
          <p className="text-sm text-foreground-muted">{t('admin.email.hint')}</p>
        </div>
        <EmailTestButton disabled={!status.configured} />
      </div>

      {status.clubs.length === 0 ? (
        <p className="text-sm text-foreground-muted">{t('admin.email.nothingUnsent')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border text-sm">
          {status.clubs.map((club) => (
            <li key={club.organizationId} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
              <FromLink href={`/admin/tenants/${club.organizationId}`} className="font-medium text-primary hover:underline">
                {club.name}
              </FromLink>
              <span className="text-foreground-muted">
                {[
                  club.waiting > 0 ? t('admin.email.waiting', { count: club.waiting }) : null,
                  club.failed > 0 ? t('admin.email.failed', { count: club.failed }) : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
