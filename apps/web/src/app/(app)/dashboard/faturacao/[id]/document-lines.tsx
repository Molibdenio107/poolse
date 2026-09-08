'use client';

import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { formatCents } from '@/lib/money';
import type { InvoiceLine } from '@/lib/api';
import { LineLabel } from '../line-label';

/**
 * What is on the document.
 *
 * One line per fee occurrence per student, so a family with two children reads
 * two lines and can see which is whose — the reason the student's name is on
 * the line rather than only in the address block.
 *
 * **The exemption is said, not implied by a zero.** On a Portuguese document an
 * exemption and a zero rate are two different statements, and the schema keeps
 * them apart precisely so this column can. Where the club recorded a reason, the
 * reason is what is printed.
 */
export function DocumentLines({ lines }: { lines: InvoiceLine[] }): React.ReactElement {
  const t = useTranslations();
  const locale = useLocale();
  const format = useFormatter();

  return (
    <section className="rounded border border-border bg-surface p-5">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[48rem] text-sm">
          <caption className="sr-only">{t('invoices.lines')}</caption>
          <thead>
            <tr className="border-b border-border text-left text-foreground-muted">
              <th scope="col" className="pb-2 font-medium">
                {t('invoices.student')}
              </th>
              <th scope="col" className="pb-2 font-medium">
                {t('invoices.lineDescription')}
              </th>
              <th scope="col" className="pb-2 font-medium">
                {t('invoices.period')}
              </th>
              <th scope="col" className="pb-2 font-medium">
                {t('invoices.vat')}
              </th>
              <th scope="col" className="pb-2 text-right font-medium">
                {t('invoices.amount')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {lines.map((line) => (
              <tr key={line.id ?? `${line.studentFeeId}-${line.periodStart}`}>
                <td className="py-3">
                  {line.studentName}
                  {line.studentTaxNumber !== null && (
                    <span className="block text-foreground-muted">
                      {t('invoices.taxNumber', { number: line.studentTaxNumber })}
                    </span>
                  )}
                </td>
                <td className="py-3">
                  <LineLabel line={line} />
                </td>
                <td className="py-3">
                  {format.dateTime(new Date(`${line.periodStart}T12:00:00Z`), 'short')}
                  {line.months > 1 && (
                    <span className="text-foreground-muted">
                      {' '}
                      {t('invoices.months', { count: line.months })}
                    </span>
                  )}
                </td>
                <td className="py-3">
                  {line.vatExempt ? (
                    <span>
                      {t('invoices.exempt')}
                      {line.vatExemptionReason !== null && (
                        <span className="block text-foreground-muted">
                          {line.vatExemptionReason}
                        </span>
                      )}
                    </span>
                  ) : (
                    <span>
                      {t('invoices.vatRate', { rate: line.vatRate })}
                      <span className="block text-foreground-muted tabular-nums">
                        {formatCents(locale, line.vatCents)}
                      </span>
                    </span>
                  )}
                </td>
                <td className="py-3 text-right tabular-nums">
                  {formatCents(locale, line.amountCents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
