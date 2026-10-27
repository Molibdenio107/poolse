import { getLocale, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { formatDate, formatStamp } from '@/lib/date-format';
import { formatCents } from '@/lib/money';
import { isMissing } from '@/lib/load-failure';
import { apiFetch } from '@/lib/api';
import { fileUrl } from '@/lib/files';
import { PageError } from '@/components/page-shell';
import { LineLabel } from '../../line-label';
import { PrintButton } from '@/components/print-button';
import { loadInvoice } from '../load-invoice';
import { AutoPrint } from '@/components/auto-print';

/**
 * One document, on paper — 12 October 2026.
 *
 * **A print page, not a generated PDF**, the call the water report and the wall
 * timetable already made: "Guardar como PDF" from a page laid out for A4 beats a
 * second layout engine on fonts, accents and selectable text.
 *
 * **It says what the screen says, and nothing the screen does not.** The number,
 * the kind, the dates, the payer — "Consumidor final" when there is none — the
 * lines composed by the same `LineLabel`, the VAT, the totals, what is paid and
 * what is owed, and the notice that this is an internal record and not a legal
 * fatura. That notice is not optional on paper: a printout travels further than
 * the screen, and it is the one place nobody can see the rest of the app.
 *
 * **Monochrome and unthemed**, like the water report: dark mode's surface would
 * print as a black rectangle. `LineLabel` is shared with the screen and carries
 * the theme's muted grey, so the table overrides that one class to a black at
 * reduced opacity rather than forking the component.
 *
 * Loaded through `loadInvoice`, the page's own loader, so `?facilityId=` means
 * the same thing here as there. A refusal or a missing document is a 404; a
 * failure says it failed, rather than printing an empty document.
 */
/**
 * The club's logo at the head of the document (POOLSE-104 C), read as the app
 * bar reads it: a failure is no logo, never a document that did not print.
 */
async function clubLogo(): Promise<string | null> {
  try {
    return fileUrl((await apiFetch<{ fileId: string | null }>('/settings/logo')).fileId);
  } catch {
    return null;
  }
}

export default async function InvoicePrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ facilityId?: string }>;
}): Promise<React.ReactElement> {
  const [t, locale] = await Promise.all([getTranslations(), getLocale()]);
  const { id } = await params;
  const { facilityId: requested = '' } = await searchParams;

  const [{ loaded }, logo] = await Promise.all([loadInvoice(id, requested), clubLogo()]);
  if (loaded === null || isMissing(loaded)) notFound();
  if (loaded.state !== 'ok') {
    return (
      <main className="p-6">
        <PageError message={t(loaded.state === 'failed' ? loaded.failure.key : 'invoices.notFound')} />
      </main>
    );
  }
  const invoice = loaded.data;
  const lines = invoice.lines ?? [];

  // A `YYYY-MM-DD` is a day, never a UTC instant — noon keeps it on its day.
  const day = (iso: string): string => formatDate(new Date(`${iso}T12:00:00Z`));
  const stamp = (value: string | null): string => {
    if (value === null) return '—';
    const at = new Date(value);
    return Number.isNaN(at.getTime()) ? '—' : formatStamp(at);
  };

  const kind = t(`invoices.kind.${invoice.kind}`);
  const status =
    invoice.status === 'overdue' && invoice.daysOverdue !== null
      ? t('invoices.status.overdueBy', { days: invoice.daysOverdue })
      : t(`invoices.status.${invoice.status}`);

  return (
    <main className="mx-auto max-w-[210mm] bg-white p-6 text-[10pt] leading-snug text-black print:max-w-none print:p-0">
      <style>{`
        @page { size: A4 portrait; margin: 14mm; }
        @media print {
          thead { display: table-header-group; }
          tr { break-inside: avoid; page-break-inside: avoid; }
        }
      `}</style>

      <AutoPrint />

      <div className="mb-6 print:hidden">
        <PrintButton label={t('export.pdf.printLabel')} />
      </div>

      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-black/40 pb-3">
        <div>
          {logo !== null && (
            // eslint-disable-next-line @next/next/no-img-element -- streamed through /files/:id
            <img src={logo} alt={t('files.logoAlt')} className="mb-2 h-12 w-auto max-w-40 object-contain" />
          )}
          <h1 className="text-[16pt] font-bold">
            {kind} {invoice.documentNo}
          </h1>
          <p className="mt-0.5">{invoice.facilityName}</p>
          {/* The state in words — on paper there is no badge to colour. */}
          <p className="mt-0.5 font-medium">{status}</p>
        </div>

        <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5">
          <dt className="text-black/70">{t('invoices.issuedOn')}</dt>
          <dd>{day(invoice.issuedOn)}</dd>
          <dt className="text-black/70">{t('invoices.dueLabel')}</dt>
          <dd>{day(invoice.dueOn)}</dd>
          <dt className="text-black/70">{t('invoices.enteredAt')}</dt>
          <dd>{stamp(invoice.systemEntryAt)}</dd>
        </dl>
      </header>

      <p className="mt-3 border border-black/40 p-2 text-[8.5pt]">{t('invoices.internalOnly')}</p>

      {invoice.correctsDocumentNo !== null && (
        <p className="mt-2">
          {t('invoices.correctsDocument', { documentNo: invoice.correctsDocumentNo })}
        </p>
      )}
      {invoice.creditedByDocumentNo !== null && (
        <p className="mt-2">
          {t('invoices.creditedBy', { documentNo: invoice.creditedByDocumentNo })}
        </p>
      )}

      <section className="mt-4">
        <h2 className="text-[8.5pt] font-semibold uppercase tracking-wider text-black/70">
          {t('invoices.payer')}
        </h2>
        <p className="mt-1 font-medium">{invoice.payerName ?? t('invoices.finalConsumer')}</p>
        {invoice.payerTaxNumber !== null && (
          <p>{t('invoices.taxNumber', { number: invoice.payerTaxNumber })}</p>
        )}
        {invoice.payerAddress !== null && <p>{invoice.payerAddress}</p>}
        {invoice.payerEmail !== null && <p>{invoice.payerEmail}</p>}
      </section>

      <table className="mt-4 w-full border-collapse [&_.text-foreground-muted]:text-black/70">
        <caption className="sr-only">{t('invoices.lines')}</caption>
        <thead>
          <tr className="border-b border-black/60 text-left">
            <th scope="col" className="py-1 pr-2 font-semibold">
              {t('invoices.student')}
            </th>
            <th scope="col" className="py-1 pr-2 font-semibold">
              {t('invoices.lineDescription')}
            </th>
            <th scope="col" className="py-1 pr-2 font-semibold">
              {t('invoices.period')}
            </th>
            <th scope="col" className="py-1 pr-2 font-semibold">
              {t('invoices.vat')}
            </th>
            <th scope="col" className="py-1 text-right font-semibold">
              {t('invoices.amount')}
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr
              key={line.id ?? `${line.studentFeeId ?? line.passId}-${line.periodStart}`}
              className="border-b border-black/20 align-top"
            >
              <td className="py-1.5 pr-2">
                {line.studentName ?? '—'}
                {line.studentTaxNumber !== null && (
                  <span className="block text-black/70">
                    {t('invoices.taxNumber', { number: line.studentTaxNumber })}
                  </span>
                )}
              </td>
              <td className="py-1.5 pr-2">
                <LineLabel line={line} />
              </td>
              <td className="py-1.5 pr-2">
                {day(line.periodStart)}
                {line.months > 1 && (
                  <span className="text-black/70"> {t('invoices.months', { count: line.months })}</span>
                )}
              </td>
              <td className="py-1.5 pr-2">
                {line.vatExempt ? (
                  <>
                    {t('invoices.exempt')}
                    {line.vatExemptionReason !== null && (
                      <span className="block text-black/70">{line.vatExemptionReason}</span>
                    )}
                  </>
                ) : (
                  <>
                    {t('invoices.vatRate', { rate: line.vatRate })}
                    <span className="block tabular-nums text-black/70">
                      {formatCents(locale, line.vatCents)}
                    </span>
                  </>
                )}
              </td>
              <td className="py-1.5 text-right tabular-nums">
                {formatCents(locale, line.amountCents)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="ml-auto mt-4 flex w-full max-w-[80mm] flex-col gap-0.5 break-inside-avoid">
        <div className="flex justify-between">
          <span className="text-black/70">{t('invoices.net')}</span>
          <span className="tabular-nums">{formatCents(locale, invoice.netCents)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-black/70">{t('invoices.vat')}</span>
          <span className="tabular-nums">{formatCents(locale, invoice.vatCents)}</span>
        </div>
        <div className="flex justify-between border-t border-black/60 pt-0.5 font-bold">
          <span>{t('invoices.total')}</span>
          <span className="tabular-nums">{formatCents(locale, invoice.totalCents)}</span>
        </div>

        {/*
          Settlement, as on the screen — only on an invoice: a credit note is
          never paid, by trigger, so a "paid" line under one would be a figure
          about nothing.
        */}
        {invoice.kind === 'invoice' && (
          <>
            <div className="mt-1 flex justify-between">
              <span className="text-black/70">{t('invoices.status.paid')}</span>
              <span className="tabular-nums">{formatCents(locale, invoice.paidCents)}</span>
            </div>
            <div className="flex justify-between font-medium">
              <span>{t('invoices.outstanding')}</span>
              <span className="tabular-nums">{formatCents(locale, invoice.outstandingCents)}</span>
            </div>
          </>
        )}
      </section>

      {invoice.notes !== null && <p className="mt-4">{invoice.notes}</p>}

      <p className="mt-6 text-[8pt] text-black/70">
        {t('export.pdf.printedOn', { date: formatDate(new Date()) })}
      </p>
    </main>
  );
}
