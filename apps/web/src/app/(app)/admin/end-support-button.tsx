'use client';

import { useTranslations } from 'next-intl';
import { LogOut } from 'lucide-react';
import { useSavedAction } from '@/lib/saved';
import { ConfirmButton } from '@/components/confirm-action';
import type { FormState } from '../dashboard/actions';
import { endSupportAction } from '../dashboard/support.actions';

const INITIAL: FormState = { ok: false };

/**
 * *Terminar sessão* — from /admin, beside *Entrar* (Rui, 11-11-2026): support
 * that stepped out with *Sair* can close the window here when the work is done,
 * and the club is told. The same `leave` as the banner's *Terminar agora*, so it
 * is recorded as ended by support. Asks first; a refusal is a toast.
 */
export function EndSupportButton({ organizationId, club }: { organizationId: string; club: string }) {
  const t = useTranslations();
  const [, dispatch, pending] = useSavedAction(endSupportAction.bind(null, organizationId), INITIAL);
  return (
    <form action={dispatch}>
      <ConfirmButton
        title={t('confirm.equipa.supportEndTitle', { club })}
        message={t('admin.support.endMessage')}
        confirmLabel={t('admin.support.end')}
        tone="danger"
        disabled={pending}
        ariaLabel={t('admin.support.endNamed', { club })}
        className="inline-flex h-control items-center justify-center gap-2 rounded-sm bg-surface px-4 text-control font-medium shadow-card hover:border-primary/50 hover:text-primary disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <LogOut aria-hidden className="size-4" />
        {pending ? t('common.working') : t('admin.support.end')}
      </ConfirmButton>
    </form>
  );
}
