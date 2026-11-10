'use client';

import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Send } from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { sendTestEmailAction } from './actions';

/** *Enviar email de teste* — POOLSE-217: to the operator's own sign-in address. */
export function EmailTestButton({ disabled }: { disabled: boolean }): React.ReactElement {
  const t = useTranslations();
  const toast = useToast();
  const [pending, start] = useTransition();

  return (
    <button
      type="button"
      disabled={disabled || pending}
      onClick={() =>
        start(async () => {
          const result = await sendTestEmailAction();
          if (result.sent) toast.show('success', t('admin.email.testSent', { to: result.to ?? '' }));
          else toast.show('danger', t(result.to === null ? 'admin.email.testNoAddress' : 'admin.email.testFailed'));
        })
      }
      className="inline-flex h-control items-center justify-center gap-2 rounded-sm border border-border bg-surface px-4 text-control hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50"
    >
      <Send aria-hidden className="size-4" />
      {pending ? t('common.working') : t('admin.email.test')}
    </button>
  );
}
