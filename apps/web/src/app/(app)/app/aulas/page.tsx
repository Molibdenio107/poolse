import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { ChevronRight, ClipboardList, UsersRound } from 'lucide-react';
import { apiFetch, type TeachingLesson } from '@/lib/api';
import { addDays, today } from '@/lib/dates';
import { formatDayMonth } from '@/lib/date-format';
import { describeLoad } from '@/lib/load-failure';
import { LinkBusy } from '@/components/link-busy';
import { PageError } from '@/components/page-shell';
import { StaffBoardHome } from '@/components/staff-notes';
import { NewNoteButton } from '@/components/staff-board-forms';
import { endTime } from '../familia/agenda-parts';
import { LessonCard, lessonHref } from './lesson-card';

const HOME = '/app/aulas';

/**
 * A teacher's *Início* — POOLSE-197. Like the student's: the next class is the
 * screen, then whatever attendance is still owed, then the staff board (Rui,
 * 07-11-2026). The week's rows moved to *Aulas*.
 *
 * Reads a window rather than this week, so a Sunday night still shows Monday's
 * class. A stand-in sees the night they cover, and the regular teacher does not:
 * `resolved_instructor_id`, one definition.
 */
export default async function TeachingHome(): Promise<React.ReactElement> {
  const t = await getTranslations();
  const locale = await getLocale();
  const day = today();
  // A week back for late registers, and the rest of the API's 31 days ahead.
  const query = new URLSearchParams({ from: addDays(day, -7), to: addDays(day, 24) });

  let lessons: TeachingLesson[];
  try {
    lessons = (await apiFetch<{ lessons: TeachingLesson[] }>(`/app/teaching?${query.toString()}`)).lessons;
  } catch (error) {
    const failure = describeLoad(error);
    return <PageError message={t(failure.key)} {...(failure.detail === '' ? {} : { detail: failure.detail })} />;
  }

  const owed = lessons.filter((one) => one.past && !one.cancelled && !one.partner && !one.registerTaken);
  const next = lessons.find((one) => !one.past && !one.cancelled);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1>{t('app.tabs.familia.inicio')}</h1>
        <NewNoteButton />
      </div>

      {next === undefined ? (
        <p className="text-foreground-muted">{t('app.teaching.noneComing')}</p>
      ) : (
        <Link
          href={lessonHref(next, HOME)}
          className="app-hero flex flex-col gap-3 rounded bg-primary p-4 text-primary-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <span className="flex items-start justify-between gap-3">
            <span className="flex flex-col gap-0.5">
              <span className="text-xl font-bold tracking-tight">{formatDayMonth(next.localDate, locale)}</span>
              <span className="font-semibold tabular-nums">
                {next.localTime} – {endTime(next.localTime, next.durationMinutes)}
              </span>
              <span>{[next.className, next.poolName].filter(Boolean).join(' · ')}</span>
            </span>
            <ChevronRight className="size-5 shrink-0" aria-hidden />
          </span>
          {next.enrolled !== null && (
            <span className="flex items-center gap-1.5 text-sm font-medium">
              <UsersRound className="size-4 shrink-0" aria-hidden />
              {next.notComing > 0
                ? t('app.teaching.enrolledNotComing', { enrolled: next.enrolled, notComing: next.notComing })
                : t('app.teaching.enrolled', { enrolled: next.enrolled })}
            </span>
          )}
          <LinkBusy />
        </Link>
      )}

      {owed.length > 0 && (
        <section className="flex flex-col">
          <h2 className="app-section-label flex items-center gap-1.5">
            <ClipboardList className="size-4" aria-hidden />
            {t('app.teaching.owed', { count: owed.length })}
          </h2>
          <ul className="flex flex-col divide-y divide-border">
            {owed.map((lesson) => (
              <li key={lesson.sessionId}>
                <LessonCard lesson={lesson} t={t} owed from={HOME} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <StaffBoardHome />
    </>
  );
}
