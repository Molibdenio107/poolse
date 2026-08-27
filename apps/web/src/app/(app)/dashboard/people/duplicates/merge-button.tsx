'use client';

import { useActionState, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { FormState } from '../../actions';
import { mergeAction } from './duplicates.actions';

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
  const [state, action, pending] = useActionState(mergeAction, INITIAL);

  if (!confirming) {
    return (
      <div className="flex flex-col gap-1">
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="self-start rounded border border-border px-4 py-2 text-sm hover:border-primary/50 hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {label}
        </button>
        {state.errorKey !== undefined && <p className="text-sm text-danger">{t(state.errorKey)}</p>}
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="keepId" value={keepId} />
      <input type="hidden" name="absorbId" value={absorbId} />

      <span className="text-sm">{t('people.mergeConfirm')}</span>
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-danger px-4 py-2 text-sm text-white disabled:opacity-60"
      >
        {pending ? t('common.working') : t('people.mergeYes')}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="rounded border border-border px-4 py-2 text-sm"
      >
        {t('common.cancel')}
      </button>
    </form>
  );
}
