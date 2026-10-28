'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Dialog } from '@/components/ui/dialog';
import { TextAreaField } from '@/components/ui/field';
import { useSavedAction } from '@/lib/saved';
import type { FormState } from '../../actions';
import { discardInboxAction } from './meets.actions';

const INITIAL: FormState = { ok: false };

/** *Rejeitar* — owner and admin (POOLSE-114). A reason is optional; the row leaves the list and the audit says why. */
export function DiscardInboxButton({
  organizationId,
  inboxId,
  label,
}: {
  organizationId: string;
  inboxId: string;
  /** The row's own name for the button, so a list of *Rejeitar* says which. */
  label: string;
}): React.ReactElement {
  const t = useTranslations();
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useSavedAction(discardInboxAction, INITIAL);
  useEffect(() => {
    if (state.ok) setConfirming(false);
  }, [state]);

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        aria-label={label}
        className="inline-flex h-control items-center justify-center px-4 text-control gap-2 rounded border border-border text-foreground-muted hover:border-danger/50 hover:text-danger focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        {t('meetInbox.discard')}
      </button>
      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={t('meetInbox.discardTitle')}
        closeLabel={t('common.close')}
      >
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="inboxId" value={inboxId} />
          <p className="text-sm">{t('meetInbox.discardConfirm')}</p>
          <TextAreaField
            name="reason"
            label={t('meetInbox.discardReason')}
            hint={t('meetInbox.discardReasonHint')}
            rows={2}
            maxLength={500}
          />
          {state.errorKey !== undefined && <p className="text-sm text-danger">{t(state.errorKey)}</p>}
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="inline-flex h-control items-center justify-center px-4 text-control gap-2 rounded border border-border text-foreground-muted hover:bg-surface-muted"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={pending}
              className="inline-flex h-control items-center justify-center px-4 text-control gap-2 rounded border border-danger/50 text-danger hover:bg-danger/10 disabled:opacity-60"
            >
              {pending ? t('common.working') : t('meetInbox.discard')}
            </button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
