'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Dialog } from '@/components/ui/dialog';
import { useSavedAction } from '@/lib/saved';
import type { FormState } from '../../actions';
import { archiveMeetAction } from './meets.actions';

const INITIAL: FormState = { ok: false };

/** Owner and admin. Its results leave the bests with it; the bin brings both back. */
export function ArchiveMeetButton({
  organizationId,
  meetId,
  results,
}: {
  organizationId: string;
  meetId: string;
  results: number;
}): React.ReactElement {
  const t = useTranslations();
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useSavedAction(archiveMeetAction, INITIAL);
  useEffect(() => {
    if (state.ok) setConfirming(false);
  }, [state]);

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="inline-flex h-control items-center justify-center px-4 text-control gap-2 rounded border border-border text-foreground-muted hover:border-danger/50 hover:text-danger"
      >
        {t('meets.archive')}
      </button>
      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={t('meets.archive')}
        closeLabel={t('common.close')}
      >
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="organizationId" value={organizationId} />
          <input type="hidden" name="meetId" value={meetId} />
          <p className="text-sm">{t('meets.confirmArchive', { count: results })}</p>
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
              {pending ? t('common.working') : t('facilities.confirmArchive')}
            </button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
