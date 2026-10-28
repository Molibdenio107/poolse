'use client';

import { useEffect, useRef, useState } from 'react';
import { FromLink } from '@/components/from-link';
import { Mail } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { formatCents } from '@/lib/money';
import type { Invoice } from '@/lib/api';
import { StatusBadge } from './status-badge';
import { formatDate } from '@/lib/date-format';
import { ReminderDialog } from './reminder-dialog';

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
 *
 * **Ticking documents sends a reminder by email** — POOLSE-86, 3.0b: the
 * dialog groups them by payer and each payer gets one email of everything of
 * theirs that is overdue.
 *
 * **The header checkbox selects every overdue row shown** — POOLSE-104 D. Not
 * the open-but-not-yet-due ones, because a reminder is about what is late; a
 * row ticked by hand stays ticked. Indeterminate while only some are, and a
 * click with every overdue row ticked clears the lot.
 *
 * **Ten rows a page** (Rui, 28-10-2026), so "shown" is this page. Once a page's
 * overdue rows are all ticked and more are overdue elsewhere, a line offers
 * *Selecionar todas as N em atraso* — the selection is the whole list's, kept
 * while paging, and the total above is always the whole list's too. It is a real labelled
 * `<input>`, and below `md`, where `.table-stack` clips the header row, this
 * table un-clips that one cell as a line above the cards — the same element,
 * moved by CSS, never a second copy.
 */
export function OutstandingList({
  facilityId,
  invoices,
  shown = invoices,
  pager,
}: {
  facilityId: string;
  /** Everything owed — the total, the selection and "select all" read this. */
  invoices: Invoice[];
  /** This page's rows. */
  shown?: Invoice[];
  /** The page links, rendered on the server; nothing when one page holds all. */
  pager?: React.ReactNode;
}): React.ReactElement {
  const t = useTranslations();
  const locale = useLocale();

  const totalCents = invoices.reduce((sum, invoice) => sum + invoice.outstandingCents, 0);
  const [tickedRaw, setTicked] = useState<Set<string>>(new Set());
  // Only what is still on the list: a document paid since leaves the selection
  // with it, so nobody is reminded about it (sweep 19-10b).
  const listed = new Set(invoices.map((invoice) => invoice.id));
  const ticked = new Set([...tickedRaw].filter((id) => listed.has(id)));
  const [reminding, setReminding] = useState(false);
  const overdueOf = (list: Invoice[]): string[] =>
    list.filter((invoice) => invoice.status === 'overdue').map((invoice) => invoice.id);
  const overdue = overdueOf(shown);
  const overdueEverywhere = overdueOf(invoices);
  const tick = (id: string, on: boolean): void => {
    const next = new Set(ticked);
    if (on) next.add(id);
    else next.delete(id);
    setTicked(next);
  };
  const allOverdue = overdue.length > 0 && overdue.every((id) => ticked.has(id));
  const someTicked = ticked.size > 0 && !allOverdue;
  const tickAll = useRef<HTMLInputElement>(null);
  // `indeterminate` is a property with no attribute, so React cannot render it.
  useEffect(() => {
    if (tickAll.current !== null) tickAll.current.indeterminate = someTicked;
  }, [someTicked]);
  const toggleAll = (): void => {
    if (allOverdue) {
      const next = new Set(ticked);
      for (const id of overdue) next.delete(id);
      setTicked(next);
    } else {
      setTicked(new Set([...ticked, ...overdue]));
    }
  };
  const allOverdueEverywhere =
    overdueEverywhere.length > 0 && overdueEverywhere.every((id) => ticked.has(id));
  // The Gmail line: offered once this page is done and there is more elsewhere.
  const offerEverywhere = allOverdue && overdueEverywhere.length > overdue.length;

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

      {invoices.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={ticked.size === 0}
            onClick={() => setReminding(true)}
            className="inline-flex min-h-control items-center justify-center gap-2 rounded bg-primary px-4 py-1 text-control text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            <Mail aria-hidden className="size-4" />
            {t('invoices.reminders.open', { count: ticked.size })}
          </button>
        </div>
      )}

      {offerEverywhere && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded bg-surface-muted px-3 py-2 text-sm">
          {allOverdueEverywhere ? (
            <>
              <span>{t('invoices.reminders.allSelected', { count: overdueEverywhere.length })}</span>
              <button
                type="button"
                onClick={() => setTicked(new Set())}
                className="rounded font-medium text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                {t('invoices.reminders.clearSelection')}
              </button>
            </>
          ) : (
            <>
              <span>{t('invoices.reminders.pageSelected', { count: overdue.length })}</span>
              <button
                type="button"
                onClick={() => setTicked(new Set([...ticked, ...overdueEverywhere]))}
                className="rounded font-medium text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                {t('invoices.reminders.selectEverywhere', { count: overdueEverywhere.length })}
              </button>
            </>
          )}
        </p>
      )}

      <ReminderDialog
        facilityId={facilityId}
        invoiceIds={[...ticked]}
        open={reminding}
        onClose={() => setReminding(false)}
        onSent={() => {
          setReminding(false);
          setTicked(new Set());
        }}
      />

      {invoices.length === 0 ? (
        <p className="text-sm text-foreground-muted">{t('invoices.nothingOwed')}</p>
      ) : (
        <div className="relative overflow-x-auto">
          <table className="table-stack w-full min-w-[52rem] text-sm">
            <caption className="sr-only">{t('invoices.owingTitle')}</caption>
            {/*
              Below md `.table-stack` clips the header row; this one keeps its
              select-all cell on screen as a line above the cards and drops the
              column titles, which every card already carries as data-labels.
            */}
            <thead className="max-md:!static max-md:!block max-md:!h-auto max-md:!w-auto max-md:!overflow-visible max-md:![clip:auto] max-md:!whitespace-normal">
              <tr className="border-b border-border text-left text-foreground-muted max-md:mb-2 max-md:block max-md:border-0">
                <th scope="col" className="w-8 pb-2 font-medium max-md:block max-md:w-auto max-md:pb-0">
                  <label className="inline-flex items-center gap-2 max-md:min-h-control max-md:font-normal max-md:text-foreground">
                    <input
                      ref={tickAll}
                      type="checkbox"
                      checked={allOverdue}
                      disabled={overdue.length === 0}
                      onChange={toggleAll}
                      className="size-4"
                    />
                    <span className="md:sr-only">{t('invoices.reminders.tickAllOverdue')}</span>
                  </label>
                </th>
                <th scope="col" className="pb-2 font-medium max-md:hidden">
                  {t('invoices.documentNo')}
                </th>
                <th scope="col" className="pb-2 font-medium max-md:hidden">
                  {t('invoices.payer')}
                </th>
                <th scope="col" className="pb-2 font-medium max-md:hidden">
                  {t('invoices.dueLabel')}
                </th>
                <th scope="col" className="pb-2 font-medium max-md:hidden">
                  {t('invoices.lastChased')}
                </th>
                <th scope="col" className="pb-2 text-right font-medium max-md:hidden">
                  {t('invoices.outstanding')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {shown.map((invoice) => (
                <tr key={invoice.id}>
                  <td className="py-3 align-top">
                    <input
                      type="checkbox"
                      checked={ticked.has(invoice.id)}
                      onChange={(event) => tick(invoice.id, event.target.checked)}
                      aria-label={t('invoices.reminders.tickOne', { no: invoice.documentNo })}
                      className="mt-0.5 size-4"
                    />
                  </td>
                  <td className="py-3">
                    <FromLink
                      href={`/dashboard/faturacao/${invoice.id}?facilityId=${facilityId}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {invoice.documentNo}
                    </FromLink>
                    <StatusBadge
                      status={invoice.status}
                      daysOverdue={invoice.daysOverdue}
                      className="ml-2"
                    />
                  </td>
                  <td className="py-3" data-label={t('invoices.payer')}>
                    {invoice.payerName ?? t('invoices.finalConsumer')}
                    {invoice.payerEmail !== null && (
                      // Visible, not a tooltip: it is what the operator needs in
                      // order to do the thing this list exists for.
                      <span className="block text-foreground-muted">{invoice.payerEmail}</span>
                    )}
                  </td>
                  <td className="py-3" data-label={t('invoices.dueLabel')}>
                    {formatDate(new Date(`${invoice.dueOn}T12:00:00Z`))}
                  </td>
                  <td className="py-3" data-label={t('invoices.lastChased')}>
                    {invoice.lastChasedOn === null ? (
                      <span className="text-foreground-muted">{t('invoices.neverChased')}</span>
                    ) : (
                      <>
                        {formatDate(new Date(`${invoice.lastChasedOn}T12:00:00Z`))}
                        <span className="block text-foreground-muted">
                          {t('invoices.chaseCount', { count: invoice.chaseCount })}
                        </span>
                      </>
                    )}
                  </td>
                  <td className="py-3 text-right tabular-nums" data-label={t('invoices.outstanding')}>
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
      {pager}
    </section>
  );
}
