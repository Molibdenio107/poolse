'use client';

import { useState } from 'react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { FileText } from 'lucide-react';
import { useSavedAction } from '@/lib/saved';
import { Dialog } from '@/components/ui/dialog';
import { formatCents } from '@/lib/money';
import type { InvoiceRun } from '@/lib/api';
import type { FormState } from '../actions';
import { issueRunAction } from './invoices.actions';
import { LineLabel } from './line-label';

/**
 * What this month would issue, and the button that issues it.
 *
 * **The table is the preview and the preview is the commit.** Both come from one
 * endpoint with a flag, so an operator issues exactly what they read — a preview
 * computed differently from the write is a preview that lies, and nobody finds
 * out until a family is charged twice.
 *
 * **A draft is a payer, not a student.** Two siblings under one guardian are one
 * document with two lines, because that is what a family pays. An adult with no
 * guardian is their own payer and gets their own.
 *
 * **Every draft is selected by default and any of them can be dropped**, so a
 * club can bill the families it has heard back from and leave the rest for
 * Friday. Selecting none is the same as selecting all on the wire, so the button
 * says which it is rather than leaving the operator to guess.
 */

const INITIAL: FormState = { ok: false };

const BUTTON =
  'rounded bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50 ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

const BUTTON_QUIET =
  'rounded border border-border px-3 py-1.5 text-sm hover:bg-surface-muted ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

export function InvoiceRunPanel({
  facilityId,
  month,
  run,
}: {
  facilityId: string;
  month: string;
  run: InvoiceRun | null;
}): React.ReactElement {
  const t = useTranslations();
  const locale = useLocale();
  const format = useFormatter();
  const [confirming, setConfirming] = useState(false);

  // Every draft starts selected. Absent from this set means "issue it".
  const [dropped, setDropped] = useState<Set<string>>(new Set());

  if (run === null) {
    return (
      <section className="rounded border border-border bg-surface p-5">
        <p className="text-sm text-foreground-muted">{t('invoices.runUnavailable')}</p>
      </section>
    );
  }

  const chosen = run.drafts.filter((draft) => !dropped.has(draft.payerKey));
  const totalCents = chosen.reduce((sum, draft) => sum + draft.totalCents, 0);

  function toggle(payerKey: string): void {
    setDropped((current) => {
      const next = new Set(current);
      if (next.has(payerKey)) next.delete(payerKey);
      else next.add(payerKey);
      return next;
    });
  }

  return (
    <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
          {t('invoices.runTitle')}
        </h2>
        <span className="text-sm text-foreground-muted">
          {t('invoices.dueOn', {
            date: format.dateTime(new Date(`${run.dueOn}T12:00:00Z`), 'long'),
          })}
        </span>
      </div>

      {run.drafts.length === 0 ? (
        /*
         * Two different silences, told apart.
         *
         * "There is nothing to bill" and "everything here is already billed" look
         * identical on an empty table and are different things for an operator to
         * do — one is a price list to check, the other is a job already done.
         * Saying only the first is what made an empty run read as a feature that
         * did nothing.
         */
        <p className="text-sm text-foreground-muted">
          {run.alreadyChargedCount > 0
            ? t('invoices.allCharged', { count: run.alreadyChargedCount })
            : t('invoices.nothingToBill')}
        </p>
      ) : (
        <>
          {run.alreadyChargedCount > 0 && (
            <p className="text-sm text-foreground-muted">
              {t('invoices.someCharged', { count: run.alreadyChargedCount })}
            </p>
          )}

          {/*
            Wide content scrolls inside its own container. Without this one long
            student name pushes the whole page sideways, which is the rule the
            shell's `min-w-0` exists to hold up.
          */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[52rem] text-sm">
              <caption className="sr-only">{t('invoices.runTitle')}</caption>
              <thead>
                <tr className="border-b border-border text-left text-foreground-muted">
                  <th scope="col" className="w-10 pb-2" />
                  <th scope="col" className="pb-2 font-medium">
                    {t('invoices.payer')}
                  </th>
                  <th scope="col" className="pb-2 font-medium">
                    {t('invoices.lines')}
                  </th>
                  <th scope="col" className="pb-2 text-right font-medium">
                    {t('invoices.total')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {run.drafts.map((draft) => (
                  <tr key={draft.payerKey} className="align-top">
                    <td className="py-3">
                      <input
                        type="checkbox"
                        id={`draft-${draft.payerKey}`}
                        checked={!dropped.has(draft.payerKey)}
                        onChange={() => toggle(draft.payerKey)}
                        className="size-4 accent-primary"
                      />
                    </td>
                    <td className="py-3">
                      {/*
                        The label is the whole cell, so the name is the click
                        target rather than a 16-pixel box beside it.
                      */}
                      <label htmlFor={`draft-${draft.payerKey}`} className="font-medium">
                        {draft.payerName}
                      </label>
                      {draft.payerTaxNumber !== null && (
                        <span className="block text-foreground-muted">
                          {t('invoices.taxNumber', { number: draft.payerTaxNumber })}
                        </span>
                      )}
                      {draft.payerMembershipId === null && (
                        // The adult path, said rather than implied: this person
                        // is billed in their own name because they have no
                        // guardian, and an operator seeing their own child's
                        // name here would want to know why.
                        <span className="block text-foreground-muted">
                          {t('invoices.paysForThemselves')}
                        </span>
                      )}
                    </td>
                    <td className="py-3">
                      <ul className="flex flex-col gap-1">
                        {draft.lines.map((line) => (
                          <li key={`${line.studentFeeId}-${line.periodStart}`}>
                            <span className="font-medium">{line.studentName}</span>
                            {' · '}
                            <LineLabel line={line} />
                            <span className="text-foreground-muted">
                              {' · '}
                              {formatCents(locale, line.amountCents)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td className="py-3 text-right tabular-nums">
                      {formatCents(locale, draft.totalCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border font-medium">
                  <td colSpan={3} className="pt-3">
                    {t('invoices.selected', { count: chosen.length })}
                  </td>
                  <td className="pt-3 text-right tabular-nums">
                    {formatCents(locale, totalCents)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          <button
            type="button"
            disabled={chosen.length === 0}
            onClick={() => setConfirming(true)}
            className={`${BUTTON} self-start`}
          >
            <FileText aria-hidden className="mr-2 inline size-3.5" />
            {t('invoices.issue', { count: chosen.length })}
          </button>
        </>
      )}

      {confirming && (
        <IssueDialog
          facilityId={facilityId}
          month={month}
          /*
            The keys go on the wire only when the operator dropped something.
            An empty list would mean "issue nothing", and sending every key when
            every key is selected is a longer request that says the same thing.
          */
          payerKeys={dropped.size === 0 ? [] : chosen.map((draft) => draft.payerKey)}
          count={chosen.length}
          totalCents={totalCents}
          onDone={() => setConfirming(false)}
        />
      )}
    </section>
  );
}

/**
 * The confirmation, in a dialog rather than in place.
 *
 * Issuing consumes numbers that can never be reused, so it is worth one
 * deliberate press — and `Dialog` is what asks: it portals to the body so no
 * ancestor can clip it, closes on Escape and on the backdrop, and keeps Tab
 * inside itself. Never `window.confirm`.
 */
function IssueDialog({
  facilityId,
  month,
  payerKeys,
  count,
  totalCents,
  onDone,
}: {
  facilityId: string;
  month: string;
  payerKeys: string[];
  count: number;
  totalCents: number;
  onDone: () => void;
}): React.ReactElement {
  const t = useTranslations();
  const locale = useLocale();
  // Closed by the action rather than by a render-time check: `onDone` inside
  // the render body is a side effect, and React 19 would run it twice.
  const [state, dispatch, pending] = useSavedAction(
    async (previous: FormState, formData: FormData) => {
      const next = await issueRunAction(previous, formData);
      if (next.ok) onDone();
      return next;
    },
    INITIAL,
  );

  return (
    <Dialog
      open
      onClose={onDone}
      title={t('invoices.confirmTitle')}
      closeLabel={t('common.cancel')}
    >
      <form action={dispatch} className="flex flex-col gap-4">
        <input type="hidden" name="facilityId" value={facilityId} />
        <input type="hidden" name="periodStart" value={month} />
        {payerKeys.map((key) => (
          <input key={key} type="hidden" name="payerKeys" value={key} />
        ))}

        <p className="text-sm">
          {t('invoices.confirmBody', {
            count,
            total: formatCents(locale, totalCents),
          })}
        </p>
        {/*
          The part that cannot be undone, said before the button rather than
          discovered after it. A credit note is the only correction there is.
        */}
        <p className="text-sm text-foreground-muted">{t('invoices.confirmFinal')}</p>

        {state.errorKey !== undefined && (
          <p role="alert" className="text-sm text-danger">
            {t(state.errorKey, state.values ?? {})}
          </p>
        )}

        <div className="flex gap-2">
          <button type="submit" disabled={pending} className={BUTTON}>
            {t('invoices.confirmIssue')}
          </button>
          <button type="button" onClick={onDone} className={BUTTON_QUIET}>
            {t('common.cancel')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
