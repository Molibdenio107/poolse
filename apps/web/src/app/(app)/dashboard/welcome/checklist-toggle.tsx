'use client';

import { useTranslations } from 'next-intl';
import { ConfirmButton } from '@/components/confirm-action';
import { useSavedAction } from '@/lib/saved';
import type { FormState } from '../actions';
import { setChecklistDismissedAction } from './checklist.actions';

const INITIAL: FormState = { ok: false };

/**
 * *Dispensar* on the card (it asks first: taking a list away is a decision), or
 * *Mostrar "Vamos começar"* on Perfil, which gives it back in one tap.
 */
export function ChecklistToggle({ dismiss }: { dismiss: boolean }): React.ReactElement {
  const t = useTranslations();
  const [, action, pending] = useSavedAction(setChecklistDismissedAction, INITIAL);

  return (
    <form action={action}>
      <input type="hidden" name="dismissed" value={dismiss ? 'true' : 'false'} />
      {dismiss ? (
        <ConfirmButton
          title={t('checklist.dismissTitle')}
          message={t('checklist.dismissMessage')}
          confirmLabel={t('checklist.dismiss')}
          disabled={pending}
          className="inline-flex min-h-control items-center text-sm text-foreground-muted hover:text-foreground"
        >
          {t('checklist.dismiss')}
        </ConfirmButton>
      ) : (
        <button
          type="submit"
          disabled={pending}
          className="inline-flex h-control items-center justify-center rounded-sm bg-surface px-4 text-control shadow-card disabled:opacity-60"
        >
          {t('checklist.restore')}
        </button>
      )}
    </form>
  );
}
