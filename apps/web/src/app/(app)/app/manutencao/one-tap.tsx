'use client';

import { useTranslations } from 'next-intl';
import { useSavedAction } from '@/lib/saved';
import type { FormState } from '../../dashboard/actions';
import { cleanAction, completeAction } from './maintenance.actions';

const INITIAL: FormState = { ok: false };
const ACTIONS = { clean: cleanAction, complete: completeAction } as const;

/**
 * *Limpo* or *Concluir* — one tap, the toast says it was recorded, and the row
 * leaves the list on the refresh that follows. `label` names what it acts on,
 * because a column of buttons all called "Limpo" says nothing to a screen reader.
 */
export function OneTap({
  kind,
  id,
  label,
}: {
  kind: keyof typeof ACTIONS;
  id: string;
  label: string;
}): React.ReactElement {
  const t = useTranslations();
  const [, action, pending] = useSavedAction(ACTIONS[kind], INITIAL);
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        disabled={pending}
        aria-label={label}
        className="inline-flex h-control items-center justify-center rounded bg-primary px-4 text-control font-medium text-primary-foreground disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        {kind === 'clean' ? t('app.maintenance.clean') : t('app.maintenance.complete')}
      </button>
    </form>
  );
}
