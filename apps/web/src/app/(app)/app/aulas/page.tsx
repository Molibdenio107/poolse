import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Ban, ChevronRight, ClipboardList, UsersRound } from 'lucide-react';
import { apiFetch, type TeachingLesson } from '@/lib/api';
import { describeLoad } from '@/lib/load-failure';
import { LinkBusy } from '@/components/link-busy';
import { PageError } from '@/components/page-shell';
import { cn } from '@/lib/utils';
import { dayHeading, endTime } from '../familia/agenda-parts';

/**
 * The instructor's home — POOLSE-90 slice 2.
 *
 * This week's lessons where the reader is `resolved_instructor_id`: the
 * dashboard band's own query (`GET /app/teaching`), so a stand-in sees the
 * night they cover and the regular instructor does not. Registers still owed
 * come first, because that is the one thing here that is late; then today, then
 * the rest of the week. Each lesson opens the existing lesson page (POOLSE-88
 * slice 2) — register, plan, stand-in, cancel — and nothing is copied.
 */
export default async function TeachingHome(): Promise<React.ReactElement> {
  const t = await getTranslations();

  let lessons: TeachingLesson[];
  try {
    lessons = (await apiFetch<{ lessons: TeachingLesson[] }>('/app/teaching')).lessons;
  } catch (error) {
    const failure = describeLoad(error);
    return <PageError message={t(failure.key)} {...(failure.detail === '' ? {} : { detail: failure.detail })} />;
  }

  const owed = lessons.filter((one) => one.past && !one.cancelled && !one.partner && !one.registerTaken);
  const coming = lessons.filter((one) => one.dayOffset >= 0 && !one.past);
  const byDay = new Map<string, TeachingLesson[]>();
  for (const lesson of coming) byDay.set(lesson.localDate, [...(byDay.get(lesson.localDate) ?? []), lesson]);

  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">{t('app.teaching.title')}</h1>

      {owed.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="flex items-center gap-1.5 text-base font-semibold">
            <ClipboardList className="size-4" aria-hidden />
            {t('app.teaching.owed', { count: owed.length })}
          </h2>
          <ul className="flex flex-col gap-2">
            {owed.map((lesson) => (
              <li key={lesson.sessionId}>
                <LessonCard lesson={lesson} t={t} owed />
              </li>
            ))}
          </ul>
        </section>
      )}

      {coming.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-sm text-foreground-muted">
          {t('app.teaching.empty')}
        </p>
      ) : (
        [...byDay.entries()].map(([date, day]) => (
          <section key={date} className="flex flex-col gap-2">
            <h2 className="text-base font-semibold">{dayHeading(t, date)}</h2>
            <ul className="flex flex-col gap-2">
              {day.map((lesson) => (
                <li key={lesson.sessionId}>
                  <LessonCard lesson={lesson} t={t} owed={false} />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </>
  );
}

function LessonCard({
  lesson,
  t,
  owed,
}: {
  lesson: TeachingLesson;
  t: Awaited<ReturnType<typeof getTranslations>>;
  owed: boolean;
}): React.ReactElement {
  return (
    <Link
      href={`/dashboard/calendar/sessions/${lesson.sessionId}?from=${encodeURIComponent('/app/aulas')}`}
      className={cn(
        'flex items-start gap-3 rounded-lg border border-border bg-surface p-3',
        'hover:border-primary/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
      )}
    >
      <div className="flex w-14 shrink-0 flex-col tabular-nums">
        <span className={cn('font-semibold', lesson.cancelled && 'line-through')}>{lesson.localTime}</span>
        <span className="text-sm text-foreground-muted">{endTime(lesson.localTime, lesson.durationMinutes)}</span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="font-medium">{lesson.className}</span>
        {owed && <span className="text-sm text-foreground-muted">{dayHeading(t, lesson.localDate)}</span>}
        {lesson.poolName !== null && <span className="text-sm text-foreground-muted">{lesson.poolName}</span>}
        {lesson.cancelled ? (
          <span className="flex items-center gap-1 text-sm font-medium text-danger">
            <Ban className="size-3.5 shrink-0" aria-hidden />
            {t('app.family.cancelled')}
          </span>
        ) : lesson.enrolled !== null ? (
          <span className="flex items-center gap-1 text-sm">
            <UsersRound className="size-3.5 shrink-0" aria-hidden />
            {lesson.notComing > 0
              ? t('app.teaching.enrolledNotComing', { enrolled: lesson.enrolled, notComing: lesson.notComing })
              : t('app.teaching.enrolled', { enrolled: lesson.enrolled })}
          </span>
        ) : null}
        {owed && (
          <span className="flex items-center gap-1 text-sm font-medium text-warning">
            <ClipboardList className="size-3.5 shrink-0" aria-hidden />
            {t('app.teaching.registerOwed')}
          </span>
        )}
      </div>
      <ChevronRight className="mt-1 size-4 shrink-0 text-foreground-muted" aria-hidden />
      <LinkBusy />
    </Link>
  );
}
