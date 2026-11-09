import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { LinkBusy } from '@/components/link-busy';
import { getFormatter, getLocale, getTranslations } from 'next-intl/server';
import { ApiError, apiFetch, type AppChildFees, type AppFeeCharge, type AppFeeItem, type AppInvoiceList, type AppPasses } from '@/lib/api';
import { formatDate } from '@/lib/date-format';
import { describeLoad, outcome } from '@/lib/load-failure';
import { formatCents } from '@/lib/money';
import { PageError } from '@/components/page-shell';
import { PaymentDestinations } from '@/components/payment-destinations';
import { ChildFilter } from '../child-filter';

/**
 * *Pagamentos* — POOLSE-178 (Rui, 05-11-2026). What is owed now, what comes next
 * and what has been settled, per child, then how to pay. Every section is always
 * there, *Nada* when empty, so a parent learns the shape once. Nothing here
 * leaves app mode, and there is no decoration: this is the parent's screen.
 *
 * Paying in the app is not built, and the last line says so in words. A disabled
 * button would promise a date.
 */
export default async function FamilyPayments({
  searchParams,
}: {
  searchParams: Promise<{ child?: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const locale = await getLocale();
  const format = await getFormatter();
  const { child } = await searchParams;
  const query = child === undefined ? '' : `?child=${encodeURIComponent(child)}`;

  let answer: { children: AppChildFees[]; family: { id: string; name: string }[] };
  try {
    answer = await apiFetch(`/app/fees${query}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    const failure = describeLoad(error);
    return <PageError message={t(failure.key)} {...(failure.detail === '' ? {} : { detail: failure.detail })} />;
  }

  // *Ver extratos* (POOLSE-201) only for somebody who pays: a second guardian
  // would open an empty list.
  const invoices = await outcome(apiFetch<AppInvoiceList>('/app/invoices'));
  const pays = invoices.state === 'ok' && invoices.data.payer;
  // Phone packs owed (POOLSE-204): their own block, beside the fees, never mixed in.
  const passes = await outcome(apiFetch<AppPasses>('/app/passes'));
  const owedPacks = passes.state === 'ok' ? passes.data.owed : [];

  const several = answer.children.length > 1;
  const title = (one: AppFeeItem): string =>
    [
      t(`app.fees.kind.${one.kind}`),
      one.recurring
        ? format.dateTime(new Date(`${one.periodStart}T12:00:00Z`), 'month')
        : one.seasonName,
      one.className,
    ]
      .filter(Boolean)
      .join(' · ');

  const charges = (rows: AppFeeCharge[]): React.ReactElement =>
    rows.length === 0 ? (
      <p className="text-sm text-foreground-muted">{t('app.fees.nothing')}</p>
    ) : (
      <ul className="flex flex-col divide-y divide-border">
        {rows.map((row) => (
          <li key={`${row.lineId}-${row.periodStart}`} className="flex items-start justify-between gap-3 py-2">
            <span className="flex min-w-0 flex-col">
              <span>{title(row)}</span>
              {row.dueOn !== null && (
                <span className="text-sm text-foreground-muted">
                  {t('app.fees.until', { date: formatDate(row.dueOn) })}
                </span>
              )}
              {row.sharedWith.length > 0 && (
                <span className="text-sm text-foreground-muted">
                  {t('app.fees.sharedWith', {
                    names: new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(row.sharedWith),
                  })}
                </span>
              )}
            </span>
            <span className="shrink-0 font-semibold tabular-nums">{formatCents(locale, row.amountCents)}</span>
          </li>
        ))}
      </ul>
    );

  const destinations = answer.children.find((one) => one.payTo !== null)?.payTo?.destinations ?? null;
  const paying = answer.children.filter((one) => one.payTo !== null);

  return (
    <>
      <Link
        href="/app/perfil?home=family"
        aria-label={t('app.profile.backTo')}
        className="inline-flex items-center gap-1.5 self-start text-sm text-primary hover:underline coarse:-my-3 coarse:py-3"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {t('common.back')}
        <LinkBusy />
      </Link>
      <h1 className="text-xl font-semibold tracking-tight">{t('app.tabs.familia.pagamentos')}</h1>
      <ChildFilter base="/app/familia/pagamentos" children={answer.family} chosen={child} />

      {answer.children.length === 0 && <p className="text-foreground-muted">{t('app.family.nobody')}</p>}

      {answer.children.map((one) => (
        <section key={one.id} className="flex flex-col gap-3 rounded bg-surface p-4 shadow-card">
          {several && <h2 className="font-bold">{one.name}</h2>}
          {one.paidOnly === true && (
            <p className="text-sm text-foreground-muted">{t('app.fees.cameOfAge', { name: one.name })}</p>
          )}

          <div className="flex flex-col gap-1">
            {/* Red is a debt, not a heading: with nothing overdue it stays plain. */}
            <h3 className={`text-sm font-bold ${one.overdue.length > 0 ? 'text-danger' : ''}`}>{t('app.fees.overdue')}</h3>
            {one.overdue.length > 1 && (
              <p className="text-sm text-foreground-muted">{t('app.fees.overdueCount', { count: one.overdue.length })}</p>
            )}
            {charges(one.overdue)}
            {one.penaltyCents > 0 && (
              <p className="flex items-center justify-between gap-3 text-sm">
                <span>{t('app.fees.penalty')}</span>
                <span className="font-semibold tabular-nums">{formatCents(locale, one.penaltyCents)}</span>
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-bold">{t('app.fees.upcoming')}</h3>
            {charges(one.upcoming)}
          </div>

          <details className="group">
            <summary className="cursor-pointer text-sm font-bold">{t('app.fees.paid')}</summary>
            {one.paid.length === 0 ? (
              <p className="pt-1 text-sm text-foreground-muted">{t('app.fees.nothing')}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border pt-1">
                {one.paid.map((row) => (
                  <li key={`${row.lineId}-${row.periodStart}`} className="py-2">
                    {title(row)}
                  </li>
                ))}
              </ul>
            )}
          </details>
        </section>
      ))}

      {owedPacks.length > 0 && (
        <section aria-labelledby="owed-packs" className="flex flex-col gap-2 rounded bg-surface p-4 shadow-card">
          <h2 id="owed-packs" className="text-base font-semibold">
            {t('app.passes.owedTitle')}
          </h2>
          <p className="text-sm text-foreground-muted">{t('app.passes.owedHint')}</p>
          <ul className="flex flex-col divide-y divide-border">
            {owedPacks.map((one) => (
              <li key={one.passId} className="flex items-center justify-between gap-3 py-2">
                <span className="flex flex-col">
                  <span className="font-semibold">{one.productName}</span>
                  <Link
                    href={`/app/perfil/extratos/${one.invoiceId}`}
                    className="text-sm text-primary hover:underline"
                  >
                    {one.documentNo}
                  </Link>
                </span>
                <span className="font-semibold tabular-nums">{formatCents(locale, one.amountCents)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* The documents live on *Extratos*, so the money is never in two lists (POOLSE-201). */}
      {pays && (
        <Link
          href="/app/perfil/extratos"
          className="inline-flex items-center gap-1.5 self-start text-sm font-semibold text-primary hover:underline coarse:-my-3 coarse:py-3"
        >
          {t('app.invoices.seeAll')}
          <LinkBusy />
        </Link>
      )}

      {destinations !== null && (
        <PaymentDestinations
          destinations={destinations}
          references={paying.map((one) => ({
            label: paying.length > 1 ? one.name : undefined,
            reference: one.payTo!.reference,
          }))}
        />
      )}

      <p className="text-sm text-foreground-muted">{t('app.fees.comingSoon')}</p>
    </>
  );
}
