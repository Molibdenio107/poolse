'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Undo2 } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { useSavedAction } from '@/lib/saved';
import { revertAction, type RevertState } from '@/app/(app)/dashboard/activity.actions';

const INITIAL: RevertState = { ok: false };

const SECONDARY =
  'inline-flex h-control items-center justify-center gap-2 rounded border border-primary/40 px-4 text-control font-medium text-primary hover:bg-primary/10 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const PRIMARY =
  'inline-flex h-control items-center justify-center px-4 text-control rounded bg-primary font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/**
 * *Reverter* on one entry of a record's *Atividade* — POOLSE-80.
 *
 * The first press asks for nothing. When the field moved again since, the API
 * answers with the three values and this opens a dialog asking, per field,
 * whether to put the old value back anyway or keep what is there now. The
 * outcome is a toast either way, raised by `useSavedAction`.
 */
export function RevertButton({ entryId }: { entryId: string }): React.ReactElement {
  const t = useTranslations();
  const [state, dispatch, pending] = useSavedAction<RevertState, FormData>(
    revertAction.bind(null, entryId),
    INITIAL,
  );
  const [open, setOpen] = useState(false);
  const [answers, setAnswers] = useState<Record<string, 'before' | 'current'>>({});

  const conflicts = state.ok === false ? state.conflicts : undefined;

  // A conflict opens the question; a decided revert (or any refusal) closes it.
  useEffect(() => {
    if (conflicts !== undefined && conflicts.length > 0) {
      setAnswers(Object.fromEntries(conflicts.map((conflict) => [conflict.field, 'before'])));
      setOpen(true);
    } else {
      setOpen(false);
    }
  }, [conflicts]);

  return (
    <>
      <form action={dispatch}>
        <button type="submit" disabled={pending} className={SECONDARY}>
          <Undo2 className="size-4" aria-hidden />
          {pending && !open ? t('common.working') : t('activity.revert')}
        </button>
      </form>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t('activity.conflictTitle')}
        description={t('activity.conflictHint')}
        closeLabel={t('common.cancel')}
      >
        <form action={dispatch} className="flex flex-col gap-4">
          {(conflicts ?? []).map((conflict) => (
            <fieldset key={conflict.field} className="flex flex-col gap-2">
              <legend className="text-sm font-medium">{conflict.fieldLabel}</legend>
              <p className="text-sm text-foreground-muted">
                {t('activity.conflictValues', {
                  before: conflict.before,
                  after: conflict.after,
                  current: conflict.current,
                })}
              </p>
              {(['before', 'current'] as const).map((answer) => (
                <label key={answer} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name={`resolve.${conflict.field}`}
                    value={answer}
                    checked={answers[conflict.field] === answer}
                    onChange={() => setAnswers((now) => ({ ...now, [conflict.field]: answer }))}
                  />
                  {answer === 'before'
                    ? t('activity.keepBefore', { value: conflict.before })
                    : t('activity.keepCurrent', { value: conflict.current })}
                </label>
              ))}
            </fieldset>
          ))}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className={SECONDARY}>
              {t('common.cancel')}
            </button>
            <button type="submit" disabled={pending} className={PRIMARY}>
              {pending ? t('common.working') : t('activity.revert')}
            </button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
