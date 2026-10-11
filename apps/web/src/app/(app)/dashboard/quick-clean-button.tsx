'use client';

import { useTranslations } from 'next-intl';
import { Check } from 'lucide-react';
import { useSavedAction } from '@/lib/saved';
import type { FormState } from './actions';
import { logCleaning } from './facilities/spaces.actions';

const INITIAL: FormState = { ok: false };

/**
 * "Registar limpeza" on the dashboard — POOLSE-66 slice 4.
 *
 * The space page's own action, bound the same way, so who and when are the
 * server's and the log is the one the Espaços screen reads. No note here: the
 * note is the space page's secondary control, and the card is for the one
 * press. `useSavedAction` raises the toast and refreshes, and the room drops
 * off the list.
 */
export function QuickCleanButton({
  spaceId,
  facilityId,
  name,
}: {
  spaceId: string;
  facilityId: string;
  name: string;
}): React.ReactElement {
  const t = useTranslations();
  const [, dispatch, pending] = useSavedAction<FormState, FormData>(
    logCleaning.bind(null, spaceId, facilityId),
    INITIAL,
  );

  return (
    <form action={dispatch}>
      <button
        type="submit"
        disabled={pending}
        // The room's name is in the label, so a list of identical buttons is
        // still a list a screen reader can tell apart.
        aria-label={t('dashboard.widget.cleanings.markNamed', { name })}
        className="inline-flex h-control items-center justify-center px-4 text-control gap-1 rounded border border-primary/40 font-medium text-primary hover:bg-primary/10 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
      >
        <Check className="size-3.5" aria-hidden="true" />
        {pending ? t('common.working') : t('dashboard.widget.cleanings.mark')}
      </button>
    </form>
  );
}
