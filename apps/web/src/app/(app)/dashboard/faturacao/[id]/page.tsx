import Link from 'next/link';
import { getFormatter, getLocale, getTranslations } from 'next-intl/server';
import { apiFetch, type Facilities } from '@/lib/api';
import { PageError, PageShell } from '@/components/page-shell';
import { formatCents } from '@/lib/money';
import { DocumentLines } from './document-lines';
import { SettlementPanel } from './settlement-panel';
import { StatusBadge } from '../status-badge';
import { CreditNoteButton } from './credit-note-button';
import { readInvoice } from '../invoices.actions';

/**
 * One document.
 *
 * **Nothing on this page edits the document**, and that is the design rather
 * than an omission: an issued document is written once, the application holds
 * no privilege to update or delete it, and the correction is a credit note.
 *
 * What the two controls here write are *child rows* — a payment and a chase.
 * That is why recording €45,00 changes the badge at the top without changing a
 * single column on the invoice: the state is `total − paid` against today,
 * derived on every read.
 *
 * The payer, the amounts and the students' names are the document's own
 * snapshots, not joins — a family that corrects a surname or moves house must
 * not silently rewrite what they were sent last March.
 */
export default async function InvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ facilityId?: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const locale = await getLocale();
  const format = await getFormatter();
  const { id } = await params;
  const { facilityId: requested = '' } = await searchParams;

  let sites: Facilities | null = null;
  try {
    sites = await apiFetch<Facilities>('/facilities');
  } catch {
    sites = null;
  }

  const facilityId =
    sites?.facilities.find((site) => site.id === requested.trim())?.id ??
    sites?.facilities[0]?.id ??
    '';

  const invoice = facilityId === '' ? null : await readInvoice(facilityId, id);

  if (invoice === null) {
    return (
      <PageShell title={t('invoices.title')}>
        <PageError message={t('invoices.notFound')} />
      </PageShell>
    );
  }

  const day = (iso: string): string =>
    format.dateTime(new Date(`${iso}T12:00:00Z`), 'long');

  /*
   * An instant, or an em dash — F-04.
   *
   * `format.dateTime` throws FORMATTING_ERROR on an unparseable value, and a
   * `throw` in a server component takes the whole page down: the document, the
   * lines, the totals and the credit-note button, over one field in the corner.
   * A date that cannot be read is worth saying nothing about, not worth losing
   * the invoice for.
   */
  const stamp = (value: string | null): string => {
    if (value === null) return '—';
    const at = new Date(value);
    return Number.isNaN(at.getTime()) ? '—' : format.dateTime(at, 'stamp');
  };

  return (
    <PageShell title={invoice.documentNo} subtitle={t(`invoices.kind.${invoice.kind}`)}>
      <div className="flex flex-col gap-6">
        {/*
          The state first, because it is what somebody opening this page came to
          find out. Derived on the server: nothing here recomputes it, and a page
          held open overnight cannot age into a wrong answer of its own.
        */}
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge status={invoice.status} daysOverdue={invoice.daysOverdue} />
          {invoice.outstandingCents > 0 && invoice.kind === 'invoice' && (
            <span className="text-sm text-foreground-muted">
              {t('invoices.outstandingIs', {
                amount: formatCents(locale, invoice.outstandingCents),
              })}
            </span>
          )}
        </div>

        <p className="rounded border border-border bg-surface-muted p-4 text-sm text-foreground-muted">
          {t('invoices.internalOnly')}
        </p>

        {/*
          What this document corrects, or what corrected it. Said in words rather
          than by a colour or a strike-through: which of the two a reader is
          holding changes what they should do next.
        */}
        {invoice.correctsDocumentNo !== null && (
          <p className="text-sm">
            {t('invoices.correctsDocument', { documentNo: invoice.correctsDocumentNo })}
          </p>
        )}
        {invoice.creditedByDocumentNo !== null && (
          <p className="text-sm">
            {t('invoices.creditedBy', { documentNo: invoice.creditedByDocumentNo })}
          </p>
        )}

        <section className="grid gap-6 rounded border border-border bg-surface p-5 sm:grid-cols-2">
          <div>
            <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
              {t('invoices.payer')}
            </h2>
            <p className="mt-2 font-medium">{invoice.payerName}</p>
            {invoice.payerTaxNumber !== null && (
              <p className="text-sm text-foreground-muted">
                {t('invoices.taxNumber', { number: invoice.payerTaxNumber })}
              </p>
            )}
            {invoice.payerAddress !== null && (
              <p className="text-sm text-foreground-muted">{invoice.payerAddress}</p>
            )}
            {invoice.payerEmail !== null && (
              <p className="text-sm text-foreground-muted">{invoice.payerEmail}</p>
            )}
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-foreground-muted">{t('invoices.facility')}</dt>
            <dd>{invoice.facilityName}</dd>
            <dt className="text-foreground-muted">{t('invoices.issuedOn')}</dt>
            <dd>{day(invoice.issuedOn)}</dd>
            <dt className="text-foreground-muted">{t('invoices.dueLabel')}</dt>
            <dd>{day(invoice.dueOn)}</dd>
            {/*
              When the document entered the system, as opposed to the date it
              carries. A club issuing March's invoices on the 2nd of April dates
              them March and entered them in April, and the record says both — it
              is also the SAF-T field of the same name.
            */}
            <dt className="text-foreground-muted">{t('invoices.enteredAt')}</dt>
            <dd>{stamp(invoice.systemEntryAt)}</dd>
          </dl>
        </section>

        <DocumentLines lines={invoice.lines ?? []} />

        <SettlementPanel facilityId={facilityId} invoice={invoice} />

        <section className="flex flex-col gap-1 rounded border border-border bg-surface p-5 text-sm">
          <div className="flex justify-between">
            <span className="text-foreground-muted">{t('invoices.net')}</span>
            <span className="tabular-nums">{formatCents(locale, invoice.netCents)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-foreground-muted">{t('invoices.vat')}</span>
            <span className="tabular-nums">{formatCents(locale, invoice.vatCents)}</span>
          </div>
          <div className="flex justify-between border-t border-border pt-1 font-medium">
            <span>{t('invoices.total')}</span>
            <span className="tabular-nums">{formatCents(locale, invoice.totalCents)}</span>
          </div>
        </section>

        {invoice.notes !== null && (
          <p className="text-sm text-foreground-muted">{invoice.notes}</p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Link
            href={`/dashboard/faturacao?facilityId=${facilityId}&month=${invoice.issuedOn.slice(0, 7)}`}
            className="text-sm text-primary hover:underline"
          >
            {t('invoices.backToList')}
          </Link>

          {/*
            The only control on the page, and only on a document that is an
            invoice and has not already been credited. A correction is a second
            document, never an edit.
          */}
          {invoice.kind === 'invoice' && invoice.creditedByInvoiceId === null && (
            <CreditNoteButton
              facilityId={facilityId}
              invoiceId={invoice.id}
              documentNo={invoice.documentNo}
            />
          )}
        </div>
      </div>
    </PageShell>
  );
}
