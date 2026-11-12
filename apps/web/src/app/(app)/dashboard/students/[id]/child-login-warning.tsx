'use client';

import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { ConfirmAction } from '@/components/confirm-action';
import { useSavedAction } from '@/lib/saved';
import type { FormState } from '../../actions';
import { handToGuardianAction } from '../child-login.actions';

const INITIAL: FormState = { ok: false };

/**
 * A child who signs in as themself — POOLSE-218, rules 4 and 5.
 *
 * The record's own login is too young to be the student's (the server's
 * `student_login_child_age()`): almost certainly a parent's, from before
 * *Convidar aluno* asked who uses the app. It says so in words, blocks nothing,
 * and offers *O acesso é do encarregado* to owner and admin, which asks first.
 */
export function ChildLoginWarning({
  studentId,
  age,
  studentName,
  canAct,
}: {
  studentId: string;
  age: number;
  studentName: string;
  canAct: boolean;
}): React.ReactElement {
  const t = useTranslations();
  const [, action, pending] = useSavedAction(handToGuardianAction, INITIAL);
  return (
    <section className="flex flex-col gap-3 rounded border border-warning bg-warning/[0.08] p-4">
      <div className="flex flex-col items-start gap-1">
        <Badge tone="pending">{t('childLogin.badge')}</Badge>
        <p className="text-sm">{t('childLogin.body', { age })}</p>
        <p className="text-sm text-foreground-muted">{t('childLogin.why')}</p>
      </div>
      {canAct && (
        <ConfirmAction
          action={action}
          pending={pending}
          fields={{ studentId }}
          title={t('childLogin.confirmTitle')}
          message={t('childLogin.confirmMessage', { name: studentName })}
          confirmLabel={t('childLogin.action')}
          trigger={t('childLogin.action')}
          triggerClassName="inline-flex h-control items-center justify-center self-start rounded-sm border border-border-strong px-4 text-control hover:bg-surface-muted"
        />
      )}
    </section>
  );
}
