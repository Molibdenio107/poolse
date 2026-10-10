'use client';

import { useEffect, useState } from 'react';
import { useSavedAction } from '@/lib/saved';
import { useTranslations } from 'next-intl';
import type { FormState } from '../../../actions';
import { mergeAction } from './duplicates.actions';
import { Dialog } from '@/components/ui/dialog';

const INITIAL: FormState = { ok: false };

/**
 * Merging one pair — POOLSE-17 AC10, phase 2.
 *
 * Behind a confirmation, because the merge is reversible only by somebody with
 * database access: the absorbed record keeps a `merged_into` pointer so nothing
 * is lost, but putting it back is not a button. One pair at a time, so the
 * report above is read rather than skimmed.
 */
export function MergeButton({
  organizationId,
  keepId,
  absorbId,
  label,
}: {
  organizationId: string;
  keepId: string;
  absorbId: string;
  label: string;
}): React.ReactElement {
  const t = useTranslations();
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useSavedAction(mergeAction, INITIAL);
  useEffect(() => {
    if (state.ok) setConfirming(false);
  }, [state]);

  return (
    <>
      <div className="flex flex-col gap-1">
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="self-start rounded border border-border px-4 py-2 text-sm hover:border-primary/50 hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {label}
        </button>
      </div>

      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={label}
        closeLabel={t('common.close')}
      >
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="keepId" value={keepId} />
          <input type="hidden" name="absorbId" value={absorbId} />

          <p className="text-sm">{t('people.mergeConfirm')}</p>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded border border-border px-4 py-2 text-sm"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded bg-destructive px-4 py-2 text-sm text-destructive-foreground disabled:opacity-60"
            >
              {pending ? t('common.working') : t('people.mergeYes')}
            </button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
