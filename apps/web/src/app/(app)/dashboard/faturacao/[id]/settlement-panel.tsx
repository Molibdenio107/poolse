'use client';

import { useState } from 'react';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { Plus, Trash2 } from 'lucide-react';
import { useSavedAction } from '@/lib/saved';
import { Dialog } from '@/components/ui/dialog';
import {
  CONTROL_LINE,
  FIELD_COLUMN,
  FIELD_LABEL,
  TextAreaField,
  TextField,
} from '@/components/ui/field';
import { centsToInput, formatCents } from '@/lib/money';
import type { ChaseChannel, Invoice, PaymentSource } from '@/lib/api';
import type { FormState } from '../../actions';
import {
  archivePaymentAction,
  recordChaseAction,
  recordPaymentAction,
} from '../invoices.actions';

/**
 * What has been paid, and who has been asked — 2.3.
 *
 * **Nothing here writes to the document.** A payment is a child row and the
 * document's state is recomputed from the sum every time it is read, which is
 * why recording one changes a badge without changing an invoice. The invoice
 * table holds no UPDATE grant at all.
 *
 * The two lists sit together because they answer one question between them:
 * this family owes €22,50, has paid €22,50 of €45,00, and was last telephoned
 * on Tuesday. Either half on its own sends somebody into a conversation
 * unprepared.
 */

const INITIAL: FormState = { ok: false };

const BUTTON =
  'rounded bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50 ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

const BUTTON_QUIET =
  'rounded border border-border px-3 py-1.5 text-sm hover:bg-surface-muted ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

const SOURCES: PaymentSource[] = ['manual', 'mbway', 'sepa'];
const CHANNELS: ChaseChannel[] = ['email', 'phone', 'message', 'in_person', 'letter'];

/** Today as an ISO day, for a date box that should open on it. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function SettlementPanel({
  facilityId,
  invoice,
}: {
  facilityId: string;
  invoice: Invoice;
}): React.ReactElement | null {
  const t = useTranslations();
  const locale = useLocale();
  const format = useFormatter();
  const [paying, setPaying] = useState(false);
  const [chasing, setChasing] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  /*
   * A credit note is owed by nobody, so it is neither paid nor chased — and the
   * panel is absent rather than present-and-refusing. The API refuses it too;
   * this is the courtesy, not the control.
   */
  if (invoice.kind !== 'invoice') return null;

  const settled = invoice.outstandingCents === 0 || invoice.status === 'credited';

  return (
    <section className="grid gap-6 rounded border border-border bg-surface p-5 sm:grid-cols-2">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
            {t('invoices.paymentsTitle')}
          </h2>
          <span className="text-sm tabular-nums">
            {t('invoices.paidOfTotal', {
              paid: formatCents(locale, invoice.paidCents),
              total: formatCents(locale, invoice.totalCents),
            })}
          </span>
        </div>

        {invoice.payments === undefined || invoice.payments.length === 0 ? (
          <p className="text-sm text-foreground-muted">{t('invoices.noPayments')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {invoice.payments.map((payment) => (
              <li
                key={payment.id}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2 text-sm first:pt-0"
              >
                <span>
                  <span className="tabular-nums font-medium">
                    {formatCents(locale, payment.amountCents)}
                  </span>{' '}
                  <span className="text-foreground-muted">
                    {t(`invoices.source.${payment.source}`)} ·{' '}
                    {format.dateTime(new Date(`${payment.paidOn}T12:00:00Z`), 'short')}
                  </span>
                  {payment.reference !== null && (
                    <span className="block text-foreground-muted">{payment.reference}</span>
                  )}
                  {payment.recordedByName !== null && (
                    <span className="block text-foreground-muted">
                      {t('invoices.recordedBy', { name: payment.recordedByName })}
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => setRemoving(payment.id)}
                  aria-label={t('invoices.removePayment')}
                  className={BUTTON_QUIET}
                >
                  <Trash2 aria-hidden className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {!settled && (
          <button type="button" onClick={() => setPaying(true)} className={`${BUTTON} self-start`}>
            <Plus aria-hidden className="mr-1 inline size-3.5" />
            {t('invoices.recordPayment')}
          </button>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
            {t('invoices.chasesTitle')}
          </h2>
          <span className="text-sm text-foreground-muted">
            {t('invoices.chaseCount', { count: invoice.chaseCount })}
          </span>
        </div>

        {/*
          Said on the page rather than assumed: Poolse is not sending anything.
          A club that thought this emailed the family would stop telephoning
          them, which is the worst possible outcome of a hopeful label.
        */}
        <p className="text-sm text-foreground-muted">{t('invoices.chaseIsManual')}</p>

        {invoice.chases === undefined || invoice.chases.length === 0 ? (
          <p className="text-sm text-foreground-muted">{t('invoices.noChases')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {invoice.chases.map((chase) => (
              <li key={chase.id} className="py-2 text-sm first:pt-0">
                <span className="font-medium">{t(`invoices.channel.${chase.channel}`)}</span>{' '}
                <span className="text-foreground-muted">
                  {format.dateTime(new Date(`${chase.chasedOn}T12:00:00Z`), 'short')}
                </span>
                {chase.note !== null && <span className="block">{chase.note}</span>}
                {chase.recordedByName !== null && (
                  <span className="block text-foreground-muted">
                    {t('invoices.recordedBy', { name: chase.recordedByName })}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}

        {!settled && (
          <button
            type="button"
            onClick={() => setChasing(true)}
            className={`${BUTTON_QUIET} self-start`}
          >
            <Plus aria-hidden className="mr-1 inline size-3.5" />
            {t('invoices.recordChase')}
          </button>
        )}
      </div>

      {paying && (
        <PaymentDialog
          facilityId={facilityId}
          invoice={invoice}
          onDone={() => setPaying(false)}
        />
      )}
      {chasing && (
        <ChaseDialog
          facilityId={facilityId}
          invoiceId={invoice.id}
          onDone={() => setChasing(false)}
        />
      )}
      {removing !== null && (
        <RemovePaymentDialog
          facilityId={facilityId}
          invoiceId={invoice.id}
          paymentId={removing}
          onDone={() => setRemoving(null)}
        />
      )}
    </section>
  );
}

function PaymentDialog({
  facilityId,
  invoice,
  onDone,
}: {
  facilityId: string;
  invoice: Invoice;
  onDone: () => void;
}): React.ReactElement {
  const t = useTranslations();
  const [state, submit, pending] = useSavedAction(
    async (previous: FormState, formData: FormData) => {
      const next = await recordPaymentAction(previous, formData);
      if (next.ok) onDone();
      return next;
    },
    INITIAL,
  );

  const fields = state.fields ?? {};

  return (
    <Dialog
      open
      onClose={onDone}
      title={t('invoices.recordPayment')}
      closeLabel={t('common.cancel')}
    >
      <form action={submit} className="flex flex-col gap-4">
        <input type="hidden" name="facilityId" value={facilityId} />
        <input type="hidden" name="invoiceId" value={invoice.id} />

        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            name="amount"
            label={t('invoices.amount')}
            /*
              Pre-filled with what is still owed, which is the amount in the
              overwhelming majority of cases — and not the *total*, which would
              be wrong for every family that has already paid something.
            */
            initial={centsToInput(invoice.outstandingCents)}
            inputMode="decimal"
            error={fields['amount'] === undefined ? undefined : t(fields['amount'])}
            required
            className="max-w-none"
          />
          <div className={FIELD_COLUMN}>
            <label htmlFor="payment-paid-on" className={FIELD_LABEL}>
              {t('invoices.paidOn')}
            </label>
            <input
              id="payment-paid-on"
              type="date"
              name="paidOn"
              defaultValue={today()}
              className={CONTROL_LINE}
            />
            {/*
              The day the money arrived, not the day it was entered: Friday's
              transfers get typed in on Monday and the record should say Friday.
            */}
            <p className="text-sm text-foreground-muted">{t('invoices.paidOnHint')}</p>
          </div>
        </div>

        <div className={FIELD_COLUMN}>
          <label htmlFor="payment-source" className={FIELD_LABEL}>
            {t('invoices.sourceLabel')}
          </label>
          <select id="payment-source" name="source" defaultValue="manual" className={CONTROL_LINE}>
            {SOURCES.map((source) => (
              <option key={source} value={source}>
                {t(`invoices.source.${source}`)}
              </option>
            ))}
          </select>
        </div>

        <TextField
          name="reference"
          label={t('invoices.reference')}
          initial=""
          hint={t('invoices.referenceHint')}
          className="max-w-none"
        />

        {state.errorKey !== undefined && (
          <p role="alert" className="text-sm text-danger">
            {t(state.errorKey, state.values ?? {})}
          </p>
        )}

        <div className="flex gap-2">
          <button type="submit" disabled={pending} className={BUTTON}>
            {t('common.save')}
          </button>
          <button type="button" onClick={onDone} className={BUTTON_QUIET}>
            {t('common.cancel')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function ChaseDialog({
  facilityId,
  invoiceId,
  onDone,
}: {
  facilityId: string;
  invoiceId: string;
  onDone: () => void;
}): React.ReactElement {
  const t = useTranslations();
  const [state, submit, pending] = useSavedAction(
    async (previous: FormState, formData: FormData) => {
      const next = await recordChaseAction(previous, formData);
      if (next.ok) onDone();
      return next;
    },
    INITIAL,
  );

  const fields = state.fields ?? {};

  return (
    <Dialog
      open
      onClose={onDone}
      title={t('invoices.recordChase')}
      closeLabel={t('common.cancel')}
    >
      <form action={submit} className="flex flex-col gap-4">
        <input type="hidden" name="facilityId" value={facilityId} />
        <input type="hidden" name="invoiceId" value={invoiceId} />

        <p className="text-sm text-foreground-muted">{t('invoices.chaseIsManual')}</p>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className={FIELD_COLUMN}>
            <label htmlFor="chase-channel" className={FIELD_LABEL}>
              {t('invoices.channelLabel')}
            </label>
            <select id="chase-channel" name="channel" defaultValue="phone" className={CONTROL_LINE}>
              {CHANNELS.map((channel) => (
                <option key={channel} value={channel}>
                  {t(`invoices.channel.${channel}`)}
                </option>
              ))}
            </select>
            {fields['channel'] !== undefined && (
              <p role="alert" className="text-sm text-danger">
                {t(fields['channel'])}
              </p>
            )}
          </div>
          <div className={FIELD_COLUMN}>
            <label htmlFor="chase-on" className={FIELD_LABEL}>
              {t('invoices.chasedOn')}
            </label>
            <input
              id="chase-on"
              type="date"
              name="chasedOn"
              defaultValue={today()}
              className={CONTROL_LINE}
            />
          </div>
        </div>

        <TextAreaField
          name="note"
          label={t('invoices.chaseNote')}
          initial=""
          hint={t('invoices.chaseNoteHint')}
          className="max-w-none"
        />

        {state.errorKey !== undefined && (
          <p role="alert" className="text-sm text-danger">
            {t(state.errorKey, state.values ?? {})}
          </p>
        )}

        <div className="flex gap-2">
          <button type="submit" disabled={pending} className={BUTTON}>
            {t('common.save')}
          </button>
          <button type="button" onClick={onDone} className={BUTTON_QUIET}>
            {t('common.cancel')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function RemovePaymentDialog({
  facilityId,
  invoiceId,
  paymentId,
  onDone,
}: {
  facilityId: string;
  invoiceId: string;
  paymentId: string;
  onDone: () => void;
}): React.ReactElement {
  const t = useTranslations();
  const [state, submit, pending] = useSavedAction(
    async (previous: FormState, formData: FormData) => {
      const next = await archivePaymentAction(previous, formData);
      if (next.ok) onDone();
      return next;
    },
    INITIAL,
  );

  return (
    <Dialog
      open
      onClose={onDone}
      title={t('invoices.removePayment')}
      closeLabel={t('common.cancel')}
    >
      <form action={submit} className="flex flex-col gap-4">
        <input type="hidden" name="facilityId" value={facilityId} />
        <input type="hidden" name="invoiceId" value={invoiceId} />
        <input type="hidden" name="paymentId" value={paymentId} />

        <p className="text-sm">{t('invoices.removePaymentAsk')}</p>
        {/*
          Archived, not erased: money is history, and a hard delete would take
          the record of the mistake with it.
        */}
        <p className="text-sm text-foreground-muted">{t('invoices.removePaymentKept')}</p>

        {state.errorKey !== undefined && (
          <p role="alert" className="text-sm text-danger">
            {t(state.errorKey, state.values ?? {})}
          </p>
        )}

        <div className="flex gap-2">
          <button type="submit" disabled={pending} className={BUTTON}>
            {t('invoices.removePayment')}
          </button>
          <button type="button" onClick={onDone} className={BUTTON_QUIET}>
            {t('common.cancel')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
