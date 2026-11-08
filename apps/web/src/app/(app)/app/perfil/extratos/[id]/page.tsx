import Link from 'next/link';
import { getFormatter, getLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft, Printer } from 'lucide-react';
import { formatDate } from '@/lib/date-format';
import { formatCents } from '@/lib/money';
import { LinkBusy } from '@/components/link-busy';
import { LineLabel } from '../../../../dashboard/faturacao/line-label';
import { StatusBadge } from '../../../../dashboard/faturacao/status-badge';
import { loadPayerInvoice } from './load';

/**
 * One *Extrato* — POOLSE-201. What the office's paper says and nothing more,
 * laid out for a phone. **The internal-record notice comes first**, before the
 * number: a parent must not read this as a fatura (rule 2), and the bottom of
 * a long screen is where nobody looks.
 *
 * *Guardar PDF* opens the same A4 paper the office prints (`InvoicePaper`).
 */
export default async function PayerInvoice({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.ReactElement> {
  const [t, locale, format] = await Promise.all([getTranslations(), getLocale(), getFormatter()]);
  const { id } = await params;
  const invoice = await loadPayerInvoice(id);
  const lines = invoice.lines ?? [];
  const title =
    invoice.kind === 'credit_note' ? t('invoices.kind.credit_note') : t('app.invoices.document');
  const month = (iso: string): string => format.dateTime(new Date(`${iso}T12:00:00Z`), 'month');
  const sum = 'flex items-center justify-between gap-3';

  return (
    <>
      <Link
        href="/app/perfil/extratos"
        aria-label={t('app.invoices.backTo')}
        className="inline-flex items-center gap-1.5 self-start text-sm text-primary hover:underline coarse:-my-3 coarse:py-3"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {t('common.back')}
        <LinkBusy />
      </Link>

      <p role="note" className="rounded border border-border bg-surface p-3 text-sm text-foreground-muted">
        {t('invoices.internalOnly')}
      </p>

      <header className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold tracking-tight">
          {title} {invoice.documentNo}
        </h1>
        <StatusBadge status={invoice.status} daysOverdue={invoice.daysOverdue} className="self-start" />
        {invoice.correctsDocumentNo !== null && (
          <p className="text-sm">{t('invoices.correctsDocument', { documentNo: invoice.correctsDocumentNo })}</p>
        )}
        {invoice.creditedByDocumentNo !== null && (
          <p className="text-sm">{t('invoices.creditedBy', { documentNo: invoice.creditedByDocumentNo })}</p>
        )}
      </header>

      <section className="flex flex-col gap-3 rounded bg-surface p-4 shadow-card">
        <dl className="flex flex-col divide-y divide-border">
          <div className={`${sum} py-2`}>
            <dt className="text-sm text-foreground-muted">{t('invoices.issuedOn')}</dt>
            <dd>{formatDate(invoice.issuedOn)}</dd>
          </div>
          <div className={`${sum} py-2`}>
            <dt className="text-sm text-foreground-muted">{t('invoices.dueLabel')}</dt>
            <dd>{formatDate(invoice.dueOn)}</dd>
          </div>
          <div className="flex flex-col gap-0.5 py-2">
            <dt className="text-sm text-foreground-muted">{t('invoices.payer')}</dt>
            <dd>
              <p>{invoice.payerName ?? t('invoices.finalConsumer')}</p>
              {invoice.payerTaxNumber !== null && (
                <p className="text-sm">{t('invoices.taxNumber', { number: invoice.payerTaxNumber })}</p>
              )}
              {invoice.payerAddress !== null && <p className="text-sm">{invoice.payerAddress}</p>}
            </dd>
          </div>
        </dl>
      </section>

      <section className="flex flex-col gap-1 rounded bg-surface p-4 shadow-card">
        <h2 className="text-sm font-bold">{t('invoices.lines')}</h2>
        <ul className="flex flex-col divide-y divide-border">
          {lines.map((line) => (
            <li
              key={line.id ?? `${line.studentFeeId ?? line.passId}-${line.periodStart}`}
              className="flex items-start justify-between gap-3 py-2"
            >
              <span className="flex min-w-0 flex-col">
                <LineLabel line={line} />
                <span className="text-sm text-foreground-muted">
                  {[line.studentName, month(line.periodStart)].filter(Boolean).join(' · ')}
                  {line.months > 1 && ` ${t('invoices.months', { count: line.months })}`}
                </span>
              </span>
              <span className="shrink-0 font-semibold tabular-nums">{formatCents(locale, line.amountCents)}</span>
            </li>
          ))}
        </ul>

        <div className="mt-2 flex flex-col gap-0.5 border-t border-border pt-2 text-sm">
          <p className={sum}>
            <span className="text-foreground-muted">{t('invoices.net')}</span>
            <span className="tabular-nums">{formatCents(locale, invoice.netCents)}</span>
          </p>
          <p className={sum}>
            <span className="text-foreground-muted">{t('invoices.vat')}</span>
            <span className="tabular-nums">{formatCents(locale, invoice.vatCents)}</span>
          </p>
          <p className={`${sum} text-base font-bold`}>
            <span>{t('invoices.total')}</span>
            <span className="tabular-nums">{formatCents(locale, invoice.totalCents)}</span>
          </p>
          {/* A credit note is never paid, so it says no paid or owed figure (as the paper). */}
          {invoice.kind === 'invoice' && (
            <>
              <p className={sum}>
                <span className="text-foreground-muted">{t('invoices.status.paid')}</span>
                <span className="tabular-nums">{formatCents(locale, invoice.paidCents)}</span>
              </p>
              <p className={`${sum} font-semibold`}>
                <span>{t('invoices.outstanding')}</span>
                <span className="tabular-nums">{formatCents(locale, invoice.outstandingCents)}</span>
              </p>
            </>
          )}
        </div>
      </section>

      {invoice.notes !== null && <p className="text-sm">{invoice.notes}</p>}

      <Link
        href={`/app/perfil/extratos/${invoice.id}/print`}
        className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-sm border border-border px-4 font-semibold text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
      >
        <Printer className="size-4" aria-hidden />
        {t('app.invoices.savePdf')}
        <LinkBusy />
      </Link>
    </>
  );
}
