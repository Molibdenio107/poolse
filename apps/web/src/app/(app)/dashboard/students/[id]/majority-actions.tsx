'use client';

import { useTranslations } from 'next-intl';
import { ConfirmAction } from '@/components/confirm-action';
import { useSavedAction } from '@/lib/saved';
import type { FormState } from '../../actions';
import { reviewMajorityAction } from '../majority.actions';

const INITIAL: FormState = { ok: false };
const PRIMARY =
  'inline-flex h-control items-center justify-center rounded-sm bg-primary px-4 text-control font-semibold text-primary-foreground disabled:opacity-60';
const QUIET =
  'inline-flex h-control items-center justify-center rounded-sm border border-border-strong px-4 text-control hover:bg-surface-muted disabled:opacity-60';

/**
 * One row's three answers — POOLSE-207 rule 4. Each asks first: *Confirmar*
 * leaves the parent as payer only, *É acompanhante* gives the parent back what a
 * guardian has, *Convidar para a app* sends the student invitation now (never
 * on its own). Acting clears the row.
 */
export function MajorityActions({
  studentId,
  name,
  invitable,
}: {
  studentId: string;
  name: string;
  invitable: boolean;
}): React.ReactElement {
  const t = useTranslations();
  const [, action, pending] = useSavedAction(reviewMajorityAction, INITIAL);
  const one = (kind: 'confirmed' | 'accompanying' | 'invited', className: string): React.ReactElement => (
    <ConfirmAction
      action={action}
      pending={pending}
      fields={{ studentId, action: kind }}
      title={t(`majority.ask.${kind}.title`, { name })}
      message={t(`majority.ask.${kind}.message`, { name })}
      confirmLabel={t(`majority.action.${kind}`)}
      trigger={t(`majority.action.${kind}`)}
      triggerClassName={className}
    />
  );
  return (
    <div className="flex flex-wrap gap-2">
      {one('confirmed', PRIMARY)}
      {one('accompanying', QUIET)}
      {invitable && one('invited', QUIET)}
    </div>
  );
}
