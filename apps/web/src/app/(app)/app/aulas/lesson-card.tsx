import Link from 'next/link';
import { Ban, ChevronRight, ClipboardList, UsersRound } from 'lucide-react';
import type { getTranslations } from 'next-intl/server';
import { LinkBusy } from '@/components/link-busy';
import type { TeachingLesson } from '@/lib/api';
import { withFrom } from '@/lib/back';
import { cn } from '@/lib/utils';
import { dayHeading, endTime } from '../familia/agenda-parts';

/**
 * Where a lesson opens. A turma's lesson is the phone's own screen (POOLSE-197); a
 * parceria takes no register and keeps the backoffice page.
 */
export function lessonHref(lesson: TeachingLesson, from: string): string {
  return lesson.partner
    ? `/dashboard/calendar/sessions/${lesson.sessionId}?from=${encodeURIComponent(from)}`
    : withFrom(`/app/aulas/${lesson.sessionId}`, from);
}

/** One lesson as a row, shared by *Início* and *Aulas*. */
export function LessonCard({
  lesson,
  t,
  owed,
  from,
}: {
  lesson: TeachingLesson;
  t: Awaited<ReturnType<typeof getTranslations>>;
  owed: boolean;
  from: string;
}): React.ReactElement {
  return (
    <Link
      href={lessonHref(lesson, from)}
      className={cn(
        // A row, not a card (POOLSE-136 rule 6): one tap opens the lesson and its register.
        'flex min-h-[44px] items-start gap-3 py-3',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
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
