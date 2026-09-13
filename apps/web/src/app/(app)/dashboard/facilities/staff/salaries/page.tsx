import { redirect } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { describeLoad, type LoadFailure } from '@/lib/load-failure';
import { ApiError, apiFetch, type Salaries, type SalarySummary } from '@/lib/api';
import { PageError, PageShell } from '@/components/page-shell';
import { Pagination } from '@/components/pagination';
import { isPastEnd, lastPage, pageHref, readPage } from '@/lib/pagination';
import { formatCents } from '@/lib/money';
import { SalaryTable } from './salary-table';

/**
 * Salários — POOLSE-58.
 *
 * **The guard is the API's, and this page is not it.** Every endpoint behind
 * this screen refuses anybody but an Owner or an Admin, and an Admin is refused
 * the Owner's row specifically. What happens here is that a refusal is turned
 * into a sentence instead of a stack trace — hiding the menu item was never the
 * control, and neither is this.
 *
 * **Two figures on the card, deliberately.** *Este mês* is what leaves the bank;
 * *média anual ÷ 12* is what these people cost once subsídios are spread. A club
 * on 14 periods pays €1,000 twelve times and costs €1,166.67 a month, and a card
 * showing only one of those is wrong for whoever wanted the other.
 */
export default async function SalariesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const locale = await getLocale();

  const { page: pageParam } = await searchParams;
  const page = readPage(pageParam);

  let data: Salaries | null = null;
  let summary: SalarySummary | null = null;
  let failure: LoadFailure | null = null;
  let notPermitted = false;

  try {
    const [list, roll] = await Promise.all([
      apiFetch<Salaries>(`/staff/salaries?${new URLSearchParams(page > 1 ? { page: String(page) } : {})}`),
      apiFetch<{ summary: SalarySummary }>('/staff/salaries/summary'),
    ]);
    data = list;
    summary = roll.summary;
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) notPermitted = true;
    else failure = describeLoad(error);
  }

  if (data !== null && isPastEnd(page, data.salaries.total, data.salaries.limit)) {
    redirect(
      pageHref(
        '/dashboard/facilities/staff/salaries',
        {},
        lastPage(data.salaries.total, data.salaries.limit),
      ),
    );
  }

  const money = (cents: number): string => formatCents(locale, cents);

  return (
    <PageShell
      title={t('salaries.title')}
      subtitle={t('salaries.subtitle')}
      back={{ href: '/dashboard/facilities/staff', label: t('staff.backToStaff') }}
    >
      {notPermitted && <PageError message={t('salaries.notPermitted')} />}
      {failure !== null && (
        <PageError message={t(failure.key)} detail={failure.detail} />
      )}

      {summary !== null && (
        <section className="rounded border border-border bg-surface p-5">
          <h2 className="text-sm font-medium text-foreground-muted">{t('salaries.rollup')}</h2>

          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <figure className="m-0">
              <figcaption className="text-sm text-foreground-muted">
                {t('salaries.thisMonth')}
              </figcaption>
              <p className="mt-1 text-2xl font-semibold tabular-nums">
                {money(summary.thisMonthCents)}
              </p>
              <p className="mt-1 text-sm text-foreground-muted">
                {t('salaries.thisMonthMeans')}
              </p>
            </figure>

            <figure className="m-0">
              <figcaption className="text-sm text-foreground-muted">
                {t('salaries.annualised')}
              </figcaption>
              <p className="mt-1 text-2xl font-semibold tabular-nums">
                {money(summary.annualisedMonthlyCents)}
              </p>
              <p className="mt-1 text-sm text-foreground-muted">
                {t('salaries.annualisedMeans')}
              </p>
            </figure>
          </div>

          <dl className="mt-4 grid gap-x-6 gap-y-2 border-t border-border pt-4 text-sm sm:grid-cols-2">
            <div className="flex justify-between gap-4">
              <dt className="text-foreground-muted">
                {t('salaries.monthlyContracts', { count: summary.monthlyContractCount })}
              </dt>
              <dd className="tabular-nums">{money(summary.monthlyContractCents)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-foreground-muted">
                {t('salaries.hourlyContracts', { count: summary.hourlyContractCount })}
              </dt>
              {/*
                * Labelled an estimate wherever it appears: an hourly contract's
                * monthly figure is contracted hours × 52 ÷ 12, which is what the
                * club agreed rather than what anybody worked.
                */}
              <dd className="tabular-nums">
                {money(summary.hourlyContractCents)}{' '}
                <span className="text-foreground-muted">{t('salaries.estimate')}</span>
              </dd>
            </div>
          </dl>

          {/*
            * The two honest absences, in words rather than as a missing row.
            *
            * Somebody with no hours recorded contributes nothing to either total
            * — folding them in at zero would make them look free — and somebody
            * with no rate at all is a gap the club can close. Both are said out
            * loud so neither reads as a euro figure of nought.
            */}
          <ul className="mt-3 space-y-1 text-sm text-foreground-muted">
            {summary.hoursUnknownCount > 0 && (
              <li>{t('salaries.hoursUnknown', { count: summary.hoursUnknownCount })}</li>
            )}
            {summary.noRateCount > 0 && (
              <li>{t('salaries.noRateCount', { count: summary.noRateCount })}</li>
            )}
            {summary.ownerExcluded && (
              <li className="text-foreground">{t('salaries.ownerExcluded')}</li>
            )}
          </ul>
        </section>
      )}

      {data !== null && (
        <>
          <SalaryTable
            organizationId={data.organizationId}
            rows={data.salaries.items}
            canEdit={data.canEdit}
            locale={locale}
          />

          <Pagination page={data.salaries} basePath="/dashboard/facilities/staff/salaries" />
        </>
      )}
    </PageShell>
  );
}
