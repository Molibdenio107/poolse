import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { AlertTriangle, CalendarClock } from 'lucide-react';
import type { BillingOverview } from '@/lib/api';
import { formatDate } from '@/lib/date-format';
import { formatCents } from '@/lib/money';
import { cn } from '@/lib/utils';

/**
 * The operator's own billing picture — POOLSE-63.
 *
 * Two things, and the second is the one that earns the panel: **what is falling
 * due**. A manual subscription is a promise nobody is chasing but Rui, and the
 * failure this screen exists to prevent is forgetting one — so a club whose
 * cover has already lapsed sorts first and is marked, rather than being quietly
 * absent from a list called "renewals".
 *
 * **Three counts and one sum, never one number.** `docs/financials.md` forbids
 * summing across provenances into an unlabelled figure, and this is a stronger
 * case than that: a comped tenant is worth nothing on purpose, and a Stripe one
 * is worth an amount nothing in this database holds. The panel says where that
 * figure lives instead of inventing it — an unqualified total over partial data
 * looks exactly like a complete one, and nothing on it says which.
 */
export async function BillingPanel({
  overview,
}: {
  overview: BillingOverview;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const locale = await getLocale();

  return (
    <section className="flex flex-col gap-3 rounded border border-border bg-surface p-4">
      <div>
        <h2 className="text-sm font-medium">{t('admin.billing.title')}</h2>
        <p className="text-sm text-foreground-muted">{t('admin.billing.hint')}</p>
      </div>

      <dl className="grid gap-3 sm:grid-cols-4">
        {(['stripe', 'manual', 'comped'] as const).map((mode) => (
          <div key={mode} className="flex flex-col">
            <dt className="text-sm text-foreground-muted">{t(`admin.billingMode.${mode}`)}</dt>
            <dd className="text-lg font-medium tabular-nums">{overview.tenantsByMode[mode]}</dd>
          </div>
        ))}

        <div className="flex flex-col">
          <dt className="text-sm text-foreground-muted">{t('admin.billing.manualReceived')}</dt>
          <dd className="text-lg font-medium tabular-nums">
            {formatCents(locale, overview.manualCentsLast12Months)}
          </dd>
        </div>
      </dl>

      {/*
        Said in visible text rather than left to be assumed. An operator reading
        three counts and one euro figure would otherwise reasonably take the
        figure for revenue.
      */}
      <p className="text-sm text-foreground-muted">
        {t('admin.billing.manualOnly', {
          count: overview.manualPaymentCount,
          total: formatCents(locale, overview.manualCentsAllTime),
        })}
      </p>

      <div className="flex flex-col gap-2">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <CalendarClock className="size-4 shrink-0" aria-hidden />
          {t('admin.billing.renewals', { days: overview.renewalsWindowDays })}
        </h3>

        {overview.renewals.length === 0 ? (
          <p className="text-sm text-foreground-muted">{t('admin.billing.noRenewals')}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {overview.renewals.map((renewal) => {
              const late = renewal.daysLeft < 0;

              return (
                <li key={renewal.organizationId} className="flex flex-wrap items-center gap-2 text-sm">
                  <Link
                    href={`/admin/tenants/${renewal.organizationId}`}
                    className="font-medium underline-offset-2 hover:underline"
                  >
                    {renewal.name}
                  </Link>

                  <span className="text-foreground-muted">
                    {t('admin.billing.paidThrough', { date: formatDate(renewal.paidThrough) })}
                  </span>

                  {/*
                    An icon as well as the colour, and the words either way —
                    colour never carries the meaning alone.
                  */}
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 whitespace-nowrap rounded px-2 py-0.5',
                      late ? 'bg-danger/15 text-danger' : 'bg-surface-muted text-foreground-muted',
                    )}
                  >
                    {late && <AlertTriangle className="size-3.5 shrink-0" aria-hidden />}
                    {late
                      ? t('admin.billing.lateBy', { days: Math.abs(renewal.daysLeft) })
                      : t('admin.billing.dueIn', { days: renewal.daysLeft })}
                  </span>

                  {renewal.readOnlyAt !== null && (
                    <span className="text-foreground-muted">{t('admin.billing.readOnly')}</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
