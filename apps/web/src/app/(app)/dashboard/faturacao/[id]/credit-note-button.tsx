'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useSavedAction } from '@/lib/saved';
import { Dialog } from '@/components/ui/dialog';
import { TextAreaField } from '@/components/ui/field';
import type { FormState } from '../../actions';
import { creditInvoiceAction } from '../invoices.actions';

/**
 * The only correction there is.
 *
 * Nothing edits or deletes an issued document — the application holds no
 * privilege to do either — so this is what a club reaches for when one is wrong.
 * The credit note is a second document with its own number in its own book, and
 * once it exists the periods the original covered are billable again, which is
 * how a corrected invoice gets issued.
 *
 * Asked in a `Dialog`, by the standing convention: it portals to the body so no
 * ancestor's overflow can clip it, closes on Escape and on the backdrop, moves
 * focus in and gives it back. Never `window.confirm`.
 */

const INITIAL: FormState = { ok: false };

const BUTTON_QUIET =
  'rounded border border-border px-3 py-1.5 text-sm hover:bg-surface-muted ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

const BUTTON_DANGER =
  'rounded bg-danger px-4 py-2 text-sm text-primary-foreground disabled:opacity-50 ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger';

export function CreditNoteButton({
  facilityId,
  invoiceId,
  documentNo,
}: {
  facilityId: string;
  invoiceId: string;
  documentNo: string;
}): React.ReactElement {
  const t = useTranslations();
  const [asking, setAsking] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setAsking(true)} className={BUTTON_QUIET}>
        {t('invoices.credit')}
      </button>

      {asking && (
        <CreditDialog
          facilityId={facilityId}
          invoiceId={invoiceId}
          documentNo={documentNo}
          onDone={() => setAsking(false)}
        />
      )}
    </>
  );
}

function CreditDialog({
  facilityId,
  invoiceId,
  documentNo,
  onDone,
}: {
  facilityId: string;
  invoiceId: string;
  documentNo: string;
  onDone: () => void;
}): React.ReactElement {
  const t = useTranslations();
  const [state, submit, pending] = useSavedAction(
    async (previous: FormState, formData: FormData) => {
      const next = await creditInvoiceAction(previous, formData);
      if (next.ok) onDone();
      return next;
    },
    INITIAL,
  );

  return (
    <Dialog
      open
      onClose={onDone}
      title={t('invoices.credit')}
      closeLabel={t('common.cancel')}
    >
      <form action={submit} className="flex flex-col gap-4">
        <input type="hidden" name="facilityId" value={facilityId} />
        <input type="hidden" name="invoiceId" value={invoiceId} />

        <p className="text-sm">{t('invoices.creditAsk', { documentNo })}</p>
        {/*
          What happens next, said before the button. The original stays where it
          is with its own number — nothing is deleted — and the periods it
          covered become billable again, which is the operator's next step.
        */}
        <p className="text-sm text-foreground-muted">{t('invoices.creditEffect')}</p>

        <TextAreaField
          name="reason"
          label={t('invoices.creditReason')}
          initial=""
          hint={t('invoices.creditReasonHint')}
          className="max-w-none"
        />

        {state.errorKey !== undefined && (
          <p role="alert" className="text-sm text-danger">
            {t(state.errorKey, state.values ?? {})}
          </p>
        )}

        <div className="flex gap-2">
          <button type="submit" disabled={pending} className={BUTTON_DANGER}>
            {t('invoices.creditConfirm')}
          </button>
          <button type="button" onClick={onDone} className={BUTTON_QUIET}>
            {t('common.cancel')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
