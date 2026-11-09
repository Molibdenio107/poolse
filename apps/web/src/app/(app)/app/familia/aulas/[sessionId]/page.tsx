import Link from 'next/link';
import { LinkBusy } from '@/components/link-busy';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ArrowLeft, CalendarCheck, NotebookPen, Target } from 'lucide-react';
import { ApiError, apiFetch, type AppClassmates, type AppLesson } from '@/lib/api';
import { Classmates } from '@/components/app/classmates';
import type { LessonPlan } from '../../../../dashboard/calendar/lesson-plan.actions';
import { describeLoad } from '@/lib/load-failure';
import { backTarget } from '@/lib/back';
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
  searchParams,
}: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{ from?: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const { sessionId } = await params;
  // Voltar goes back to where the lesson was opened — Início or Aulas, with its
  // child filter (POOLSE-91) — and to Início when it was opened from nowhere.
  const back = backTarget((await searchParams).from, '/app/familia');

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
  const people = await apiFetch<AppClassmates>(`/app/lessons/${sessionId}/classmates`).catch(() => null);
  // Who is the reader: about oneself it is *Vou / Não vou*, about a child *Vem / Não vem* (Rui, 09-11-2026).
  const selves = await apiFetch<{ students: { id: string; self: boolean }[] }>('/family')
    .then((answer) => new Set(answer.students.filter((one) => one.self).map((one) => one.id)))
    .catch(() => new Set<string>());
  const first = lesson.entries[0]!;
  const water = first.poolId === null ? null : (lesson.water.find((one) => one.poolId === first.poolId) ?? null);
  const several = lesson.entries.length > 1;

  return (
    <>
      <Link
        href={back.href}
        aria-label={t(back.labelKey)}
        className="inline-flex items-center gap-1.5 self-start text-sm text-primary hover:underline coarse:-my-3 coarse:py-3 coarse:pr-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {t('common.back')}
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

      {/* POOLSE-194: no minor's name reaches another family, and the API sends none. */}
      {people !== null && (
        <div className="overflow-hidden rounded-lg shadow-card">
          <Classmates data={people} />
        </div>
      )}

      <section className="flex flex-col gap-2 rounded-lg bg-surface p-3 shadow-card">
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
        POOLSE-195: below the plan, in a colour of its own, to try. Read here, and
        answered in the feedback after the lesson.
      */}
      {plan !== null && plan.challenge.trim() !== '' && (
        <section className="flex flex-col gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 shadow-card">
          <h2 className="flex items-center gap-1.5 text-sm font-medium uppercase tracking-wider">
            <Target className="size-4 text-warning" aria-hidden />
            {t('app.family.challenge')}
          </h2>
          <p className="whitespace-pre-wrap font-medium">{plan.challenge}</p>
        </section>
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
              className="flex flex-col gap-2 rounded-lg bg-surface p-3 shadow-card"
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
                    ? t(entry.needsBirthDate ? 'app.notice.needsBirthDate' : 'app.notice.guardianAnswers')
                    : selves.has(entry.studentId)
                      ? t(entry.going ? 'app.notice.saidGoingSelf' : 'app.notice.saidNotGoingSelf')
                      : t(entry.going ? 'app.notice.saidGoing' : 'app.notice.saidNotGoing')}
                </p>
              )}
            </section>
          );
        })}

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
