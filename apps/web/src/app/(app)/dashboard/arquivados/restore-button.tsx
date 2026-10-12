'use client';

import { useTranslations } from 'next-intl';
import { RotateCcw } from 'lucide-react';
import { useSavedAction } from '@/lib/saved';
import { restoreArchiveAction, type RestoreState } from './archive.actions';

const INITIAL: RestoreState = { ok: false };

const BUTTON =
  'inline-flex h-control items-center justify-center gap-2 rounded border border-primary/40 px-4 text-control font-medium text-primary hover:bg-primary/10 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/**
 * *Restaurar* on one bin row — POOLSE-78.
 *
 * `useSavedAction` raises the toast either way: "Restaurado: Piscina 1", or the
 * refusal as a sentence. One refusal also offers the way forward: when the row's
 * site (or tank, or space) is archived too, a second button restores that one.
 */
export function RestoreButton({
  entryId,
  name,
}: {
  entryId: string;
  name: string;
}): React.ReactElement {
  const t = useTranslations();
  const [state, dispatch, pending] = useSavedAction<RestoreState, FormData>(
    restoreArchiveAction.bind(null, entryId),
    INITIAL,
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <form action={dispatch}>
        <button
          type="submit"
          disabled={pending}
          aria-label={t('archive.restoreNamed', { name })}
          className={BUTTON}
        >
          <RotateCcw className="size-4" aria-hidden />
          {pending ? t('common.working') : t('archive.restore')}
        </button>
      </form>
      {state.ok === false && state.parentEntryId !== undefined && (
        <ParentRestoreButton
          entryId={state.parentEntryId}
          name={state.parentName ?? ''}
        />
      )}
    </div>
  );
}

function ParentRestoreButton({
  entryId,
  name,
}: {
  entryId: string;
  name: string;
}): React.ReactElement | null {
  const t = useTranslations();
  const [state, dispatch, pending] = useSavedAction<RestoreState, FormData>(
    restoreArchiveAction.bind(null, entryId),
    INITIAL,
  );

  // Its job is done once the parent is back; the row's own button is next.
  if (state.ok) return null;

  return (
    <form action={dispatch}>
      <button type="submit" disabled={pending} className={BUTTON}>
        <RotateCcw className="size-4" aria-hidden />
        {pending ? t('common.working') : t('archive.restoreParent', { name })}
      </button>
    </form>
  );
}
