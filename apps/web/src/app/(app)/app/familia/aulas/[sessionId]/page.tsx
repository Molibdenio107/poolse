import Link from 'next/link';
import { LinkBusy } from '@/components/link-busy';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ArrowLeft, NotebookPen } from 'lucide-react';
import { ApiError, apiFetch, type AppLesson } from '@/lib/api';
import type { LessonPlan } from '../../../../dashboard/calendar/lesson-plan.actions';
import { describeLoad } from '@/lib/load-failure';
import { PageError } from '@/components/page-shell';
import { EntryCard, dayHeading } from '../../agenda-parts';

/**
 * One lesson, for a family — POOLSE-90 slice 1. The time and the place, the
 * water, and the training plan where `familyMayReadPlan` lets the family read it
 * (the plan endpoint's own rule, unchanged). *Vou / Não vou* joins it in slice 2.
 */
export default async function FamilyLesson({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const { sessionId } = await params;

  let lesson: AppLesson;
  try {
    lesson = await apiFetch<AppLesson>(`/app/lessons/${sessionId}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    const failure = describeLoad(error);
    return <PageError message={t(failure.key)} {...(failure.detail === '' ? {} : { detail: failure.detail })} />;
  }

  // The plan is a nice-to-have on this page: a refusal or a failure shows no plan.
  const plan = await apiFetch<LessonPlan>(`/sessions/${sessionId}/plan`).catch(() => null);
  const first = lesson.entries[0]!;
  const water = first.poolId === null ? null : (lesson.water.find((one) => one.poolId === first.poolId) ?? null);
  const several = lesson.entries.length > 1;

  return (
    <>
      <Link
        href="/app/familia"
        className="inline-flex items-center gap-1.5 self-start text-sm text-primary hover:underline coarse:-my-3 coarse:py-3 coarse:pr-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {t('app.family.backToAgenda')}
        <LinkBusy />
      </Link>

      <h1 className="text-xl font-semibold tracking-tight">{dayHeading(t, first.localDate)}</h1>

      <EntryCard entry={first} childName={null} water={water} href={null} />

      {several && (
        <p className="text-sm text-foreground-muted">
          {t('app.family.alsoComing', { count: lesson.entries.length })}
        </p>
      )}

      <section className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
        <h2 className="flex items-center gap-1.5 text-sm font-medium uppercase tracking-wider text-foreground-muted">
          <NotebookPen className="size-4" aria-hidden />
          {t('app.family.planTitle')}
        </h2>
        {plan !== null && plan.body.trim() !== '' ? (
          <p className="whitespace-pre-wrap">{plan.body}</p>
        ) : (
          <p className="text-sm text-foreground-muted">{t('app.family.noPlan')}</p>
        )}
      </section>
    </>
  );
}
