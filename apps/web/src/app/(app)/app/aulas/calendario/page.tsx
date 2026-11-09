import { getTranslations } from 'next-intl/server';
import { agendaWeekOf, agendaWeekRange, isAgendaWeek } from '@poolse/rules';
import { apiFetch, type TeachingLesson } from '@/lib/api';
import { addDays, today } from '@/lib/dates';
import { describeLoad } from '@/lib/load-failure';
import { PageError } from '@/components/page-shell';
import { WeekStrip, WeekToday } from '@/components/app/week-strip';
import { dayHeading } from '../../familia/agenda-parts';
import { LessonCard } from '../lesson-card';

const PATH = '/app/aulas/calendario';

/**
 * A teacher's *Aulas* — POOLSE-197: the family's calendar, a week at a time, with
 * what is coming first and what has happened after, so a late register is one
 * week's arrow away.
 */
export default async function TeachingCalendar({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const { week: asked } = await searchParams;
  const day = today();
  const thisWeek = agendaWeekOf(day);
  const { first, last } = agendaWeekRange(day);
  const week = isAgendaWeek(asked) && asked >= first && asked <= last ? asked : thisWeek;
  const query = new URLSearchParams({ from: week, to: addDays(week, 6) });

  let lessons: TeachingLesson[];
  try {
    lessons = (await apiFetch<{ lessons: TeachingLesson[] }>(`/app/teaching?${query.toString()}`)).lessons;
  } catch (error) {
    const failure = describeLoad(error);
    return <PageError message={t(failure.key)} {...(failure.detail === '' ? {} : { detail: failure.detail })} />;
  }

  const here = week === thisWeek ? PATH : `${PATH}?week=${week}`;
  const byDay = new Map<string, TeachingLesson[]>();
  for (const lesson of lessons) byDay.set(lesson.localDate, [...(byDay.get(lesson.localDate) ?? []), lesson]);
  const days = [...byDay.entries()];
  const coming = days.filter(([date]) => date >= day);
  const earlier = days.filter(([date]) => date < day).reverse();

  const dayRows = (date: string, rows: TeachingLesson[]): React.ReactElement => (
    <section key={date} className="flex flex-col">
      <h2 className="app-section-label">{dayHeading(t, date)}</h2>
      <ul className="flex flex-col divide-y divide-border">
        {rows.map((lesson) => (
          <li key={lesson.sessionId}>
            <LessonCard
              lesson={lesson}
              t={t}
              owed={lesson.past && !lesson.cancelled && !lesson.partner && !lesson.registerTaken}
              from={here}
            />
          </li>
        ))}
      </ul>
    </section>
  );

  return (
    <>
      <div className="flex min-h-9 items-center justify-between gap-3">
        <h1>{t('app.tabs.familia.aulas')}</h1>
        <WeekToday week={week} today={day} child={undefined} base={PATH} />
      </div>
      <WeekStrip
        week={week}
        today={day}
        child={undefined}
        lessonDays={new Set(byDay.keys())}
        closedDays={new Set()}
        base={PATH}
      />
      {days.length === 0 && <p className="text-foreground-muted">{t('app.family.calendar.noneThisWeek')}</p>}
      {coming.map(([date, rows]) => dayRows(date, rows))}
      {earlier.map(([date, rows]) => dayRows(date, rows))}
    </>
  );
}
