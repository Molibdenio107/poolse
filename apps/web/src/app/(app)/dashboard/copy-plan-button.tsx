'use client';

import { useTranslations } from 'next-intl';
import { Copy } from 'lucide-react';
import { useSavedAction } from '@/lib/saved';
import { formatDate } from '@/lib/date-format';
import type { FormState } from './actions';
import { copyPreviousPlanAction } from './instructor.actions';

const INITIAL: FormState = { ok: false };

/**
 * One press: the previous lesson's plan becomes this one's — POOLSE-66 slice 3.
 *
 * The outcome is the toast `useSavedAction` raises, like every save here, and
 * the refreshed card then reads "written". The date is on the button because
 * "copy the previous one" is only a sensible thing to press when you know
 * which lesson that was.
 */
export function CopyPlanButton({
  sessionId,
  previousOn,
}: {
  sessionId: string;
  previousOn: string;
}): React.ReactElement {
  const t = useTranslations();
  const [, action, pending] = useSavedAction(copyPreviousPlanAction, INITIAL);

  return (
    <form action={action}>
      <input type="hidden" name="sessionId" value={sessionId} />
      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-control items-center justify-center px-4 text-control gap-1.5 rounded border border-primary/40 font-medium text-primary hover:bg-primary/10 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
      >
        <Copy className="size-4" aria-hidden="true" />
        {t('dashboard.widget.plan.copy', { date: formatDate(previousOn) })}
      </button>
    </form>
  );
}
