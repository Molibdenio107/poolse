'use client';

import { useTranslations } from 'next-intl';
import { TextAreaField } from '@/components/ui/field';
import { useSavedAction } from '@/lib/saved';
import {
  saveLessonPlanAction,
  type LessonPlan,
  type PlanState,
} from '@/app/(app)/dashboard/calendar/lesson-plan.actions';

const INITIAL: PlanState = { ok: false, attempt: 0 };

/**
 * The plan and the *Desafio* at the poolside — POOLSE-197: two short boxes and one
 * save, on the action the desktop uses. Copying a plan from another week, and the
 * level's suggestions, stay on the desktop.
 */
export function TeacherPlan({ plan }: { plan: LessonPlan }): React.ReactElement {
  const t = useTranslations();
  const [, action, pending] = useSavedAction(saveLessonPlanAction, INITIAL);
  const partner = plan.classGroupId === null;

  if (!plan.canEdit) {
    return (
      <section className="flex flex-col gap-2">
        <h2 className="app-section-label">{t('calendar.plan.title')}</h2>
        <p className="whitespace-pre-wrap">{plan.body === '' ? t('calendar.plan.none') : plan.body}</p>
        {plan.challenge !== '' && <p className="whitespace-pre-wrap">{plan.challenge}</p>}
      </section>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="sessionId" value={plan.sessionId} />
      <TextAreaField
        name="body"
        label={t('calendar.plan.title')}
        initial={plan.body}
        placeholder={t('calendar.plan.placeholder')}
        rows={4}
      />
      {!partner && (
        <TextAreaField
          name="challenge"
          label={t('calendar.plan.challenge')}
          initial={plan.challenge}
          hint={t('calendar.plan.challengeHint')}
          rows={2}
        />
      )}
      <button
        type="submit"
        disabled={pending}
        className="inline-flex h-control items-center justify-center self-start rounded-sm bg-primary px-4 text-control font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        {pending ? t('common.working') : t('common.save')}
      </button>
    </form>
  );
}
