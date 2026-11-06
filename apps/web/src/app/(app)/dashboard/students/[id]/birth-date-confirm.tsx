'use client';

import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { ConfirmAction } from '@/components/confirm-action';
import { useSavedAction } from '@/lib/saved';
import type { FormState } from '../../actions';
import { confirmBirthDateAction } from './submissions.actions';

const INITIAL: FormState = { ok: false };

/**
 * *Data de nascimento por confirmar* — POOLSE-186. Only a date the person gave in
 * the app shows this, so a record the office typed stays quiet. It warns and
 * blocks nothing; to correct the date, the form below saves it.
 */
export function BirthDateConfirm({ studentId }: { studentId: string }): React.ReactElement {
  const t = useTranslations();
  const [, action, pending] = useSavedAction(confirmBirthDateAction, INITIAL);
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded border border-border p-3">
      <div className="flex min-w-0 flex-col gap-1">
        <Badge tone="pending">{t('birthDateConfirm.pending')}</Badge>
        <p className="text-sm text-foreground-muted">{t('birthDateConfirm.hint')}</p>
      </div>
      <ConfirmAction
        action={action}
        pending={pending}
        fields={{ studentId }}
        title={t('birthDateConfirm.confirmTitle')}
        message={t('birthDateConfirm.confirmMessage')}
        confirmLabel={t('birthDateConfirm.confirm')}
        trigger={t('birthDateConfirm.confirm')}
        triggerClassName="inline-flex h-control items-center justify-center rounded-sm bg-surface px-4 text-control shadow-card hover:bg-surface-muted disabled:opacity-60"
      />
    </div>
  );
}
