'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import type { CalendarSession } from '@/lib/api';
import { formatDate } from '@/lib/date-format';
import { familyPlanAction } from './family-plan.actions';

/**
 * This week's lessons with their plans, for a family — 15 October 2026 (Rui).
 *
 * A plan is fetched when somebody asks for it, one lesson at a time, the same
 * as the calendar's panel: loading a week of plans to show the one a parent
 * opens would be paying for six they did not. A cancelled lesson has no plan
 * to read and offers none.
 */
export function FamilyPlans({ sessions }: { sessions: CalendarSession[] }): React.ReactElement | null {
  const t = useTranslations();
  const lessons = sessions.filter((session) => session.status !== 'cancelled');
  if (lessons.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">{t('family.plansTitle')}</h3>
      <ul className="flex flex-col divide-y divide-border rounded border border-border">
        {lessons.map((session) => (
          <PlanRow key={session.id} session={session} />
        ))}
      </ul>
    </div>
  );
}

function PlanRow({ session }: { session: CalendarSession }): React.ReactElement {
  const t = useTranslations();
  const [plan, setPlan] = useState<string | null | undefined>(undefined);
  const [pending, startTransition] = useTransition();

  function open(): void {
    startTransition(async () => setPlan(await familyPlanAction(session.id)));
  }

  return (
    <li className="flex flex-col gap-2 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm">
          <span className="font-medium">{session.className}</span>
          <span className="text-foreground-muted">
            {' · '}
            {formatDate(session.localDate)} · {session.localTime}
          </span>
        </span>
        {plan === undefined && (
          <button
            type="button"
            onClick={open}
            disabled={pending}
            className="inline-flex h-control items-center justify-center rounded border border-border px-4 text-control hover:bg-surface-muted disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {pending ? t('common.working') : t('family.showPlan')}
          </button>
        )}
      </div>
      {plan === null && (
        <p className="text-sm text-danger">
          {t('family.planFailed')}{' '}
          <button type="button" onClick={open} className="text-primary underline">
            {t('family.retry')}
          </button>
        </p>
      )}
      {typeof plan === 'string' &&
        (plan.trim() === '' ? (
          <p className="text-sm text-foreground-muted">{t('family.planEmpty')}</p>
        ) : (
          <p className="whitespace-pre-wrap text-sm">{plan}</p>
        ))}
    </li>
  );
}
