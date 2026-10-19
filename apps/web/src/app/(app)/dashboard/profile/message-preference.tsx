'use client';

import { useTranslations } from 'next-intl';
import { useSeeded } from '@/components/ui/field';
import { useSavedAction } from '@/lib/saved';
import { saveMessagePreferenceAction } from './profile.actions';

const INITIAL: { ok: boolean; errorKey?: string } = { ok: false };

/**
 * *Mensagens do clube por email* — POOLSE-86, 3.0c. One box for this club; the
 * other clubs a person belongs to are asked separately. What it does not stop is
 * said beside it, so nobody unticks it expecting silence about a closed pool.
 */
export function MessagePreference({
  email,
  optedOut,
  clubName,
}: {
  email: string;
  optedOut: boolean;
  clubName: string;
}): React.ReactElement {
  const t = useTranslations();
  const [wants, setWants] = useSeeded<boolean>(!optedOut);
  const [state, action, pending] = useSavedAction(saveMessagePreferenceAction, INITIAL);

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="wantsMessages" value={wants ? 'true' : 'false'} />
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={wants}
          onChange={(event) => setWants(event.target.checked)}
          className="mt-0.5 size-4"
        />
        <span>
          <span className="font-medium">{t('profile.messages.label', { club: clubName })}</span>
          <span className="block text-foreground-muted">{t('profile.messages.hint', { email })}</span>
        </span>
      </label>
      {state.errorKey !== undefined && (
        <p role="alert" className="text-sm text-danger">
          {t(state.errorKey)}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-control items-center justify-center self-start rounded bg-primary px-4 text-control text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
      >
        {pending ? t('common.working') : t('common.save')}
      </button>
    </form>
  );
}
