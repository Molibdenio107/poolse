'use client';

import Link from 'next/link';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { formatCents } from '@/lib/money';
import type { Invoice } from '@/lib/api';

/**
 * What has been issued this month.
 *
 * Deliberately a list of *documents* rather than of families: once a number is
 * allocated the document is the thing that exists, and the question an operator
 * asks here is "what went out" rather than "who owes what". The second question
 * belongs to chasing, in 2.3.
 *
 * A credited document stays in the list, marked. Hiding it would make the
 * numbering look gappy, and the whole arrangement rests on it not being.
 */
export function InvoiceList({
  facilityId,
  invoices,
  month,
}: {
  facilityId: string;
  invoices: Invoice[];
  month: string;
}): React.ReactElement {
  const t = useTranslations();
  const locale = useLocale();
  const format = useFormatter();

  return (
    <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
      <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
        {t('invoices.issuedTitle')}
      </h2>

      {invoices.length === 0 ? (
        <p className="text-sm text-foreground-muted">{t('invoices.noneIssued', { month })}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <caption className="sr-only">{t('invoices.issuedTitle')}</caption>
            <thead>
              <tr className="border-b border-border text-left text-foreground-muted">
                <th scope="col" className="pb-2 font-medium">
                  {t('invoices.documentNo')}
                </th>
                <th scope="col" className="pb-2 font-medium">
                  {t('invoices.payer')}
                </th>
                <th scope="col" className="pb-2 font-medium">
                  {t('invoices.issuedOn')}
                </th>
                <th scope="col" className="pb-2 text-right font-medium">
                  {t('invoices.total')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {invoices.map((invoice) => (
                <tr key={invoice.id}>
                  <td className="py-3">
                    <Link
                      href={`/dashboard/faturacao/${invoice.id}?facilityId=${facilityId}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {invoice.documentNo}
                    </Link>
                    {/*
                      Both states said in words, never by colour alone: a credit
                      note and a credited invoice are two different documents and
                      an operator has to be able to tell which they are reading.
                    */}
                    {invoice.kind === 'credit_note' && (
                      <span className="block text-foreground-muted">
                        {t('invoices.correctsDocument', {
                          documentNo: invoice.correctsDocumentNo ?? '',
                        })}
                      </span>
                    )}
                    {invoice.creditedByDocumentNo !== null && (
                      <span className="block text-foreground-muted">
                        {t('invoices.creditedBy', { documentNo: invoice.creditedByDocumentNo })}
                      </span>
                    )}
                  </td>
                  <td className="py-3">{invoice.payerName}</td>
                  <td className="py-3">
                    {format.dateTime(new Date(`${invoice.issuedOn}T12:00:00Z`), 'short')}
                  </td>
                  <td className="py-3 text-right tabular-nums">
                    {formatCents(locale, invoice.totalCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
