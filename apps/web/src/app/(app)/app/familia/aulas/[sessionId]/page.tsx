import Link from 'next/link';
import { LinkBusy } from '@/components/link-busy';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ArrowLeft, CalendarCheck, NotebookPen } from 'lucide-react';
import { ApiError, apiFetch, type AppLesson } from '@/lib/api';
import type { LessonPlan } from '../../../../dashboard/calendar/lesson-plan.actions';
import { describeLoad } from '@/lib/load-failure';
import { PageError } from '@/components/page-shell';
import { EntryCard, dayHeading } from '../../agenda-parts';
import { FeedbackPanel } from '../../feedback';
import { NoticeToggle } from '../../notice-toggle';

/**
 * One lesson, for a family — POOLSE-90 slice 1. The time and the place, the
 * water, and the training plan where `familyMayReadPlan` lets the family read it
 * (the plan endpoint's own rule, unchanged). *Vou / Não vou* joins it in slice 2.
 *
 * Since POOLSE-116 it also opens for a lesson already over, inside the feedback
 * window, with each child's *Como correu a aula?* under the plan.
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

      {/* With siblings the answer is per child, said in each one's panel below, not on the shared card. */}
      <EntryCard entry={several ? { ...first, going: null } : first} childName={null} water={water} href={null} />

      {several && (
        <p className="text-sm text-foreground-muted">
          {t('app.family.alsoComing', { count: lesson.entries.length })}
        </p>
      )}

      {/*
        Vou / Não vou — POOLSE-90 slice 2: one per child, only while the lesson
        still takes an answer. A notice to the club, never a register mark.
      */}
      {lesson.entries
        .filter((entry) => entry.noticeOpen)
        .map((entry) => {
          const name = lesson.feedback.find((one) => one.studentId === entry.studentId)?.studentName ?? null;
          return (
            <section
              key={`notice-${entry.studentId}`}
              className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3"
            >
              <h2 className="flex items-center gap-1.5 text-sm font-medium uppercase tracking-wider text-foreground-muted">
                <CalendarCheck className="size-4" aria-hidden />
                {several && name !== null ? t('app.notice.titleFor', { name }) : t('app.notice.question')}
              </h2>
              {entry.mayAnswer ? (
                <NoticeToggle sessionId={sessionId} studentId={entry.studentId} going={entry.going} />
              ) : (
                <p className="text-sm text-foreground-muted">
                  {entry.going === null
                    ? t('app.notice.guardianAnswers')
                    : entry.going
                      ? t('app.notice.saidGoing')
                      : t('app.notice.saidNotGoing')}
                </p>
              )}
            </section>
          );
        })}

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

      {/*
        How it went — only once there is something to say it about. A coming
        lesson has *Vem à aula?* above; a cancelled one says so on its card.
      */}
      {lesson.feedback
        .filter((standing) => standing.state !== 'notEnded' && standing.state !== 'cancelled')
        .map((standing) => (
          <FeedbackPanel
            key={standing.studentId}
            sessionId={sessionId}
            standing={standing}
            named={lesson.feedback.length > 1}
          />
        ))}
    </>
  );
}
