'use client';

import Link from 'next/link';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { formatCents } from '@/lib/money';
import type { Invoice } from '@/lib/api';
import { StatusBadge } from './status-badge';

/**
 * Em dívida — the chase list.
 *
 * **Everything still owed, not everything overdue.** A club working through its
 * debtors on a Wednesday wants Friday's document in front of it too; a list that
 * appeared only once the date had passed would be a list nobody could get ahead
 * of. Oldest debt first, because this is a job to work through rather than a
 * record to look something up in.
 *
 * The two numbers that decide what to do next are on every row and neither is a
 * tooltip: **what is still outstanding** — not the total, since a family that
 * has paid half owes half — and **when they were last asked**. An operator about
 * to telephone somebody who was telephoned yesterday is the failure this column
 * exists to prevent.
 */
export function OutstandingList({
  facilityId,
  invoices,
}: {
  facilityId: string;
  invoices: Invoice[];
}): React.ReactElement {
  const t = useTranslations();
  const locale = useLocale();
  const format = useFormatter();

  const totalCents = invoices.reduce((sum, invoice) => sum + invoice.outstandingCents, 0);

  return (
    <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
          {t('invoices.owingTitle')}
        </h2>
        <span className="text-sm text-foreground-muted">
          {t('invoices.owingTotal', {
            count: invoices.length,
            total: formatCents(locale, totalCents),
          })}
        </span>
      </div>

      {invoices.length === 0 ? (
        <p className="text-sm text-foreground-muted">{t('invoices.nothingOwed')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[52rem] text-sm">
            <caption className="sr-only">{t('invoices.owingTitle')}</caption>
            <thead>
              <tr className="border-b border-border text-left text-foreground-muted">
                <th scope="col" className="pb-2 font-medium">
                  {t('invoices.documentNo')}
                </th>
                <th scope="col" className="pb-2 font-medium">
                  {t('invoices.payer')}
                </th>
                <th scope="col" className="pb-2 font-medium">
                  {t('invoices.dueLabel')}
                </th>
                <th scope="col" className="pb-2 font-medium">
                  {t('invoices.lastChased')}
                </th>
                <th scope="col" className="pb-2 text-right font-medium">
                  {t('invoices.outstanding')}
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
                    <StatusBadge
                      status={invoice.status}
                      daysOverdue={invoice.daysOverdue}
                      className="ml-2"
                    />
                  </td>
                  <td className="py-3">
                    {invoice.payerName}
                    {invoice.payerEmail !== null && (
                      // Visible, not a tooltip: it is what the operator needs in
                      // order to do the thing this list exists for.
                      <span className="block text-foreground-muted">{invoice.payerEmail}</span>
                    )}
                  </td>
                  <td className="py-3">
                    {format.dateTime(new Date(`${invoice.dueOn}T12:00:00Z`), 'short')}
                  </td>
                  <td className="py-3">
                    {invoice.lastChasedOn === null ? (
                      <span className="text-foreground-muted">{t('invoices.neverChased')}</span>
                    ) : (
                      <>
                        {format.dateTime(new Date(`${invoice.lastChasedOn}T12:00:00Z`), 'short')}
                        <span className="block text-foreground-muted">
                          {t('invoices.chaseCount', { count: invoice.chaseCount })}
                        </span>
                      </>
                    )}
                  </td>
                  <td className="py-3 text-right tabular-nums">
                    {formatCents(locale, invoice.outstandingCents)}
                    {invoice.paidCents > 0 && (
                      // A family that has paid half owes half, and the total on
                      // its own would send somebody to ask for the whole amount.
                      <span className="block text-foreground-muted">
                        {t('invoices.ofTotal', {
                          paid: formatCents(locale, invoice.paidCents),
                          total: formatCents(locale, invoice.totalCents),
                        })}
                      </span>
                    )}
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
