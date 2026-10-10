import { notFound, redirect } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import {
  ApiError,
  apiFetch,
  type ManualPayment,
  type Paginated,
  type TenantClaim,
  type PlatformTenant,
  type TenantRequests,
} from '@/lib/api';
import { DataTable, type Column } from '@/components/data-table';
import { PageEmpty, PageError, PageShell } from '@/components/page-shell';
import { DetailPage } from '@/components/detail-page';
import { describeLoad, type LoadFailure } from '@/lib/load-failure';
import { timeAgo } from '@/lib/relative-time';
import { HealthBadge } from '../../health-badge';
import { RequestCharts } from './request-charts';
import { TenantActions } from './tenant-actions';
import { formatDate, formatStamp } from '@/lib/date-format';
import { formatCents } from '@/lib/money';

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
 *
 * **Tabs since the detail-tabs change**: General (the trial claim), Ações,
 * Pagamentos (only when there are some) and Pedidos e erros — eager, so the
 * audit trail still records one view per page and not one per tab.
 */
export default async function TenantRequestsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const locale = await getLocale();

  const { id } = await params;
  const { tab } = await searchParams;

  let requests: TenantRequests | null = null;
  let tenant: PlatformTenant | null = null;
  let payments: Paginated<ManualPayment> | null = null;
  let claim: TenantClaim | null = null;
  let failure: LoadFailure | null = null;

  try {
    /*
     * In parallel. They are two independent reads and nothing on this page needs
     * one to ask for the other; sequential would make the page wait for the sum.
     * Both are audited, which is two lines in the trail for one page view — the
     * honest price of the screen showing two different things.
     */
    [tenant, requests, payments, claim] = await Promise.all([
      apiFetch<PlatformTenant>(`/platform/tenants/${id}`),
      apiFetch<TenantRequests>(`/platform/tenants/${id}/requests`),
      apiFetch<Paginated<ManualPayment>>(`/platform/tenants/${id}/payments`),
      apiFetch<TenantClaim | null>(`/platform/tenants/${id}/claim`),
    ]);
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

  /**
   * A payment, as a row — POOLSE-63.
   *
   * Dates are `dd-MM-yyyy` through `formatDate`, like every date in Poolse, and
   * the amount goes through `formatCents` with the locale rather than having a
   * symbol concatenated onto it: pt-PT writes `120,00 €` and en writes `€120.00`.
   */
  const paymentColumns: Column<ManualPayment>[] = [
    {
      key: 'receivedOn',
      header: t('admin.payment.receivedOn'),
      render: (row) => formatDate(row.receivedOn),
    },
    {
      key: 'amount',
      header: t('admin.payment.amount'),
      render: (row) => formatCents(locale, row.amountCents),
    },
    {
      key: 'method',
      header: t('admin.payment.method'),
      render: (row) => t(`admin.method.${row.method}`),
    },
    {
      key: 'covers',
      header: t('admin.payment.covers'),
      render: (row) =>
        row.coversFrom === null
          ? t('admin.payment.coversUntil', { to: formatDate(row.coversTo) })
          : t('admin.payment.coversRange', {
              from: formatDate(row.coversFrom),
              to: formatDate(row.coversTo),
            }),
    },
    {
      key: 'note',
      header: t('admin.payment.note'),
      render: (row) =>
        row.note ?? <span className="text-foreground-muted">{t('admin.payment.noNote')}</span>,
    },
  ];

  const errorColumns: Column<TenantRequests['errors'][number]>[] = [
    {
      key: 'at',
      header: t('admin.error.when'),
      render: (row) => (
        // The exact moment as text beside the phrase, not only in a `title`:
        // somebody investigating an error needs it, on any device.
        <time dateTime={row.at} className="flex flex-col">
          <span>{timeAgo(row.at, locale) ?? formatStamp(row.at)}</span>
          <span className="text-xs text-foreground-muted">{formatStamp(row.at)}</span>
        </time>
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

  const subtitle = t('admin.tenantRequestsSubtitle', { days: requests?.windowDays ?? 7 });
  const back = { href: '/admin', label: t('admin.backToTenants') };

  if (tenant === null || requests === null) {
    return (
      <PageShell title={t('admin.tenantRequests')} subtitle={subtitle} back={back}>
        {failure !== null && <PageError message={t(failure.key)} detail={failure.detail} />}
      </PageShell>
    );
  }

  const club = tenant;
  const week = requests;

  return (
    <DetailPage
      title={club.name}
      subtitle={subtitle}
      back={back}
      actions={
        <HealthBadge
          health={week.health}
          requests={week.requestCount24h}
          count4xx={week.count4xx24h}
          count5xx={week.count5xx24h}
        />
      }
      requested={tab}
      /*
        Eager: every request to PlatformModule writes a line to
        `platform_audit_log`, so the tabs all come from the page's one set of
        reads and switching between them asks the API for nothing more.
      */
      eager
      tabs={[
        {
          /*
            The trial this club claimed — POOLSE-62. First, because an operator
            pressing *conceder novo período* should be able to see what they are
            freeing; a one-click override on an invisible record is a click
            nobody can check.
          */
          slug: 'general',
          labelKey: 'detailTabs.general',
          content: () => (
            <section className="flex flex-col gap-2 rounded border border-border bg-surface p-4">
              <div>
                <h2 className="text-sm font-medium">{t('admin.claim')}</h2>
                <p className="text-sm text-foreground-muted">{t('admin.claimHint')}</p>
              </div>

              {claim === null ? (
                <p className="text-sm text-foreground-muted">{t('admin.claimNone')}</p>
              ) : (
                <>
                  <dl className="grid gap-3 sm:grid-cols-2">
                    <div className="flex flex-col">
                      <dt className="text-sm text-foreground-muted">{t('admin.claimAddress')}</dt>
                      {/* The normalised address, which is what the ledger is keyed
                          on — never the raw one the person typed. */}
                      <dd className="break-all font-mono text-sm">{claim.normalizedEmail}</dd>
                    </div>
                    <div className="flex flex-col">
                      <dt className="text-sm text-foreground-muted">{t('admin.claimedAt')}</dt>
                      <dd className="text-sm">{formatDate(claim.claimedAt)}</dd>
                    </div>
                  </dl>

                  {claim.releasedAt !== null && (
                    <p className="text-sm">
                      {t('admin.claimReleased', {
                        date: formatDate(claim.releasedAt),
                        who: claim.releasedByClerkUserId ?? '—',
                      })}
                    </p>
                  )}

                  {/* Counts and a sentence saying they are not evidence. A flag
                      that looks like a verdict is a flag that gets acted on as one. */}
                  <ul className="flex flex-col gap-1 text-sm text-foreground-muted">
                    <li>{t('admin.flagDomain', { count: claim.sameDomainCount })}</li>
                    <li>
                      {claim.sameIpCount === null
                        ? t('admin.flagIpUnknown')
                        : t('admin.flagIp', { count: claim.sameIpCount })}
                    </li>
                  </ul>
                  <p className="text-sm text-foreground-muted">{t('admin.flagsHint')}</p>
                </>
              )}
            </section>
          ),
        },
        {
          slug: 'actions',
          labelKey: 'detailTabs.actions',
          content: () => <TenantActions tenant={club} />,
        },
        {
          /*
            What this club actually paid outside Stripe — POOLSE-63. The
            evidence behind the paid-through date. **Insert-only, and it says
            so**: a correction is another row.
          */
          slug: 'payments',
          labelKey: 'admin.payments',
          visible: payments !== null && payments.items.length > 0,
          badge:
            payments === null ? undefined : { kind: 'count', value: payments.items.length },
          content: () =>
            payments !== null && (
              <section className="flex flex-col gap-2">
                <h2 className="text-sm font-medium">{t('admin.payments')}</h2>
                <p className="text-sm text-foreground-muted">{t('admin.paymentsHint')}</p>

                <DataTable
                  columns={paymentColumns}
                  rows={payments.items}
                  rowKey={(row) => row.id}
                  empty={<PageEmpty message={t('admin.noPayments')} />}
                />
              </section>
            ),
        },
        {
          slug: 'requests',
          labelKey: 'detailTabs.requests',
          badge:
            week.health === 'amber' || week.health === 'red'
              ? { kind: 'dot', labelKey: 'detailTabs.badge.tenantUnhealthy' }
              : undefined,
          content: () => (
            <>
              {week.buckets.length === 0 ? (
                <PageEmpty
                  message={t('admin.noRequests')}
                  hint={t('admin.noRequestsHint', { days: week.windowDays })}
                />
              ) : (
                <RequestCharts buckets={week.buckets} windowDays={week.windowDays} />
              )}

              <section className="flex flex-col gap-2">
                <h2 className="text-sm font-medium">{t('admin.recentErrors')}</h2>
                {/*
                  One line per *route*, newest first — not one per row. A route
                  failing every minute for an hour writes itself into sixty
                  buckets, and sixty identical lines describe one problem while
                  hiding every other.
                */}
                <p className="text-sm text-foreground-muted">{t('admin.recentErrorsHint')}</p>

                <DataTable
                  columns={errorColumns}
                  rows={week.errors}
                  rowKey={(row) => `${row.route}|${row.at}`}
                  empty={<PageEmpty message={t('admin.noErrors')} />}
                />
              </section>
            </>
          ),
        },
      ]}
    />
  );
}
