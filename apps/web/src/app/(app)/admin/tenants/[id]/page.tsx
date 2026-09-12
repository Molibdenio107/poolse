import { notFound, redirect } from 'next/navigation';
import { getFormatter, getLocale, getTranslations } from 'next-intl/server';
import { ApiError, apiFetch, type TenantRequests } from '@/lib/api';
import { DataTable, type Column } from '@/components/data-table';
import { PageEmpty, PageError, PageShell } from '@/components/page-shell';
import { describeLoad, type LoadFailure } from '@/lib/load-failure';
import { timeAgo } from '@/lib/relative-time';
import { HealthBadge } from '../../health-badge';
import { RequestCharts } from './request-charts';

/**
 * One tenant's request health over the last week — platform admin, slice 2.
 *
 * Read-only, like the list it hangs off. What it answers is the question the
 * coloured chip on that list raises and cannot settle: *when* did this start,
 * and *what* is failing.
 *
 * The redirect for a non-operator lives here rather than in the layout, for the
 * same reason it does on `/admin` — the page already asks the API a question
 * only an operator may ask, so one round trip answers both and leaves one line
 * in `platform_audit_log` rather than two that could disagree.
 */
export default async function TenantRequestsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const format = await getFormatter();
  const locale = await getLocale();

  const { id } = await params;

  let requests: TenantRequests | null = null;
  let failure: LoadFailure | null = null;

  try {
    requests = await apiFetch<TenantRequests>(`/platform/tenants/${id}/requests`);
  } catch (error) {
    if (error instanceof ApiError && error.code === 'not_platform_admin') {
      redirect('/dashboard');
    }
    /*
     * A tenant that does not exist is a 404, and the API says so rather than
     * answering an empty week — so a mistyped id looks like a mistyped id rather
     * than like a very quiet club.
     */
    if (error instanceof ApiError && error.status === 404) notFound();

    failure = describeLoad(error);
  }

  const errorColumns: Column<TenantRequests['errors'][number]>[] = [
    {
      key: 'at',
      header: t('admin.error.when'),
      render: (row) => (
        <span title={format.dateTime(new Date(row.at), 'stamp')}>
          {timeAgo(row.at, locale) ?? format.dateTime(new Date(row.at), 'stamp')}
        </span>
      ),
    },
    {
      key: 'route',
      header: t('admin.error.route'),
      // The route pattern, which is what the API stores — never the URL, so a
      // student's id cannot arrive here.
      render: (row) => <span className="font-mono text-xs">{row.route}</span>,
    },
    {
      key: 'message',
      header: t('admin.error.message'),
      render: (row) =>
        row.message ?? (
          <span className="text-foreground-muted">{t('admin.error.noMessage')}</span>
        ),
    },
  ];

  return (
    <PageShell
      title={requests?.name ?? t('admin.tenantRequests')}
      subtitle={t('admin.tenantRequestsSubtitle', { days: requests?.windowDays ?? 7 })}
      back={{ href: '/admin', label: t('admin.backToTenants') }}
      actions={
        requests !== null ? (
          <HealthBadge
            health={requests.health}
            requests={requests.requestCount24h}
            count4xx={requests.count4xx24h}
            count5xx={requests.count5xx24h}
          />
        ) : undefined
      }
    >
      {failure !== null && <PageError message={t(failure.key)} detail={failure.detail} />}

      {requests !== null && (
        <>
          {requests.buckets.length === 0 ? (
            <PageEmpty
              message={t('admin.noRequests')}
              hint={t('admin.noRequestsHint', { days: requests.windowDays })}
            />
          ) : (
            <RequestCharts buckets={requests.buckets} windowDays={requests.windowDays} />
          )}

          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">{t('admin.recentErrors')}</h2>
            {/*
              One line per *route*, newest first — not one per row. A route
              failing every minute for an hour writes itself into sixty buckets,
              and a list of sixty identical lines describes one problem while
              hiding every other.
            */}
            <p className="text-sm text-foreground-muted">{t('admin.recentErrorsHint')}</p>

            <DataTable
              columns={errorColumns}
              rows={requests.errors}
              rowKey={(row) => `${row.route}|${row.at}`}
              empty={<PageEmpty message={t('admin.noErrors')} />}
            />
          </section>
        </>
      )}
    </PageShell>
  );
}
