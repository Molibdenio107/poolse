'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { AlertTriangle, MailWarning } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { formatDate } from '@/lib/date-format';
import { formatCents } from '@/lib/money';
import { useSavedAction } from '@/lib/saved';
import type { ReminderPreview } from '@/lib/api';
import type { FormState } from '../actions';
import { previewRemindersAction, sendRemindersAction } from './invoices.actions';

/**
 * *Enviar lembrete por email* — POOLSE-86, 3.0b.
 *
 * The ticked documents name their payers; the server answers who would get
 * what, and this dialog says it before anything is written: each payer's
 * overdue documents and total, the address, anybody with no address, anybody
 * whose ticked documents are not late yet — and, beside a payer reminded in the
 * last 7 days, when. Rui's rule: that payer starts unticked and can be ticked
 * again; a warning, never a block.
 */

const INITIAL: FormState = { ok: false };
const PRIMARY =
  'inline-flex h-control items-center justify-center gap-2 rounded bg-primary px-4 text-control text-primary-foreground hover:bg-primary/90 disabled:opacity-60';
const QUIET =
  'inline-flex h-control items-center justify-center gap-2 rounded border border-border px-4 text-control hover:bg-surface-muted';

const day = (iso: string): string => formatDate(new Date(`${iso}T12:00:00Z`));

export function ReminderDialog({
  facilityId,
  invoiceIds,
  open,
  onClose,
  onSent,
}: {
  facilityId: string;
  invoiceIds: string[];
  open: boolean;
  onClose: () => void;
  onSent: () => void;
}): React.ReactElement {
  const t = useTranslations();
  const locale = useLocale();
  const [preview, setPreview] = useState<ReminderPreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [state, action, pending] = useSavedAction(sendRemindersAction, INITIAL);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setPreview(null);
    setLoadError(null);
    void previewRemindersAction(facilityId, invoiceIds).then((answer) => {
      if (!live) return;
      if (!answer.ok) {
        setLoadError(answer.errorKey);
        return;
      }
      setPreview(answer.preview);
      // Ticked: everybody with an address who was not reminded this week.
      setChosen(
        new Set(answer.preview.payers.filter((p) => p.email !== null && !p.recentlyReminded).map((p) => p.key)),
      );
    });
    return () => {
      live = false;
    };
    // Keyed on the ids' text: the array is rebuilt on every render of the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, facilityId, invoiceIds.join(',')]);

  useEffect(() => {
    if (state.ok) onSent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const toggle = (key: string, on: boolean): void => {
    const next = new Set(chosen);
    if (on) next.add(key);
    else next.delete(key);
    setChosen(next);
  };

  return (
    <Dialog open={open} onClose={onClose} title={t('invoices.reminders.title')} closeLabel={t('common.close')}>
      {loadError !== null ? (
        <p role="alert" className="text-sm text-danger">
          {t(loadError)}
        </p>
      ) : preview === null ? (
        <p className="text-sm text-foreground-muted">{t('invoices.reminders.loading')}</p>
      ) : (
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="facilityId" value={facilityId} />
          <input type="hidden" name="invoiceIds" value={JSON.stringify(invoiceIds)} />
          <input type="hidden" name="payerKeys" value={JSON.stringify([...chosen])} />

          <p className="text-sm text-foreground-muted">{t('invoices.reminders.explain')}</p>

          {!preview.emailConfigured && (
            <p className="flex items-start gap-2 rounded border border-warning/40 bg-warning/5 p-3 text-sm">
              <MailWarning aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
              {t('invoices.reminders.notConfigured')}
            </p>
          )}

          {preview.payers.length === 0 ? (
            <p className="text-sm">{t('invoices.reminders.nothingOverdueAtAll')}</p>
          ) : (
            <ul className="flex max-h-[50vh] flex-col divide-y divide-border overflow-y-auto">
              {preview.payers.map((payer) => {
                const total = payer.documents.reduce((sum, d) => sum + d.outstandingCents, 0);
                const id = `reminder-${payer.key}`;
                return (
                  <li key={payer.key} className="flex gap-3 py-3 first:pt-0">
                    <input
                      id={id}
                      type="checkbox"
                      checked={chosen.has(payer.key)}
                      disabled={payer.email === null}
                      onChange={(event) => toggle(payer.key, event.target.checked)}
                      className="mt-1 size-4"
                    />
                    <div className="flex min-w-0 flex-col gap-1 text-sm">
                      <label htmlFor={id} className="font-medium">
                        {payer.payerName} · {formatCents(locale, total)}
                      </label>
                      {payer.email === null ? (
                        <span className="flex items-center gap-1.5 text-danger">
                          <AlertTriangle aria-hidden className="size-4" />
                          {t('invoices.reminders.noAddress')}
                        </span>
                      ) : (
                        <span className="text-foreground-muted">{payer.email}</span>
                      )}
                      <span className="text-foreground-muted">
                        {payer.documents
                          .map((d) =>
                            t('invoices.reminders.document', {
                              no: d.documentNo,
                              due: day(d.dueOn),
                              amount: formatCents(locale, d.outstandingCents),
                            }),
                          )
                          .join(' · ')}
                      </span>
                      {payer.lastRemindedOn !== null && (
                        <span
                          className={
                            payer.recentlyReminded ? 'flex items-center gap-1.5 text-warning' : 'text-foreground-muted'
                          }
                        >
                          {payer.recentlyReminded && <AlertTriangle aria-hidden className="size-4" />}
                          {t('invoices.reminders.lastReminded', { date: day(payer.lastRemindedOn) })}
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {preview.nothingOverdue.length > 0 && (
            <p className="text-sm text-foreground-muted">
              {t('invoices.reminders.notLateYet', { names: preview.nothingOverdue.join(', ') })}
            </p>
          )}

          <div className="rounded border border-border bg-surface-muted p-3 text-sm">
            <p className="font-medium">{t('invoices.reminders.howToPay')}</p>
            {preview.paymentInstructions === null ? (
              <p className="text-foreground-muted">
                {t('invoices.reminders.noInstructions')}{' '}
                <Link href={`/dashboard/facilities/${facilityId}?tab=club`} className="text-primary underline">
                  {t('invoices.reminders.setInstructions')}
                </Link>
              </p>
            ) : (
              <p className="whitespace-pre-line text-foreground-muted">{preview.paymentInstructions}</p>
            )}
          </div>

          {state.errorKey !== undefined && (
            <p role="alert" className="text-sm text-danger">
              {t(state.errorKey, state.values ?? {})}
            </p>
          )}

          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={onClose} className={QUIET}>
              {t('common.cancel')}
            </button>
            <button type="submit" disabled={pending || chosen.size === 0} className={PRIMARY}>
              {pending ? t('common.working') : t('invoices.reminders.send', { count: chosen.size })}
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
