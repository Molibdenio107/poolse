'use client';

import { useTranslations } from 'next-intl';
import { LogIn } from 'lucide-react';
import { useSavedAction } from '@/lib/saved';
import type { FormState } from '../dashboard/actions';
import { enterSupportAction } from '../dashboard/support.actions';

const INITIAL: FormState = { ok: false };

/** *Entrar* — into the club, through its window. A refusal is a toast. */
export function EnterSupportButton({ grantId, club }: { grantId: string; club: string }) {
  const t = useTranslations();
  const [, dispatch, pending] = useSavedAction(enterSupportAction.bind(null, grantId), INITIAL);
  return (
    <form action={dispatch}>
      <button
        type="submit"
        disabled={pending}
        aria-label={t('admin.support.enterNamed', { club })}
        className="inline-flex h-control items-center justify-center gap-2 rounded bg-primary px-4 text-control font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <LogIn aria-hidden className="size-4" />
        {pending ? t('common.working') : t('admin.support.enter')}
      </button>
    </form>
  );
}
