import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { agendaWeekOf, agendaWeekRange, isAgendaWeek } from '@poolse/rules';
import { ApiError, apiFetch, type AppCalendar, type AppCalendarEntry, type FamilyLeave } from '@/lib/api';
import { withFrom } from '@/lib/back';
import { addDays, today } from '@/lib/dates';
import { describeLoad, outcome } from '@/lib/load-failure';
import { storageConfigured } from '@/lib/storage-status';
import { PageError } from '@/components/page-shell';
import { WeekStrip } from '@/components/app/week-strip';
import { EntryCard, dayHeading } from '../agenda-parts';
import { FamilyCertificates } from '../certificates';
import { RecentLessons } from '../feedback';
import { ChildFilter } from '../child-filter';

/**
 * *Aulas* is the family's calendar — POOLSE-175. A week at a time (Rui, 06-11-2026),
 * reaching six months ahead and three back: its lessons, its closures on the strip
 * and, past the lessons the club has generated, the weekly pattern as *Previsto*. Under it, *Últimas aulas*
 * (POOLSE-116) and the medical certificates (POOLSE-109), as POOLSE-136 left them.
 *
 * Nothing here is edited. A row opens the lesson's page only where that page
 * answers, which the API says per entry (`opens`).
 */
export default async function FamilyLessons({
  searchParams,
}: {
  searchParams: Promise<{ child?: string; week?: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const { child, week: asked } = await searchParams;
  const day = today();
  const thisWeek = agendaWeekOf(day);
  const { first, last } = agendaWeekRange(day);
  const week = isAgendaWeek(asked) && asked >= first && asked <= last ? asked : thisWeek;

  const query = new URLSearchParams({ from: week, to: addDays(week, 6) });
  if (child !== undefined) query.set('child', child);

  let agenda: AppCalendar;
  try {
    agenda = await apiFetch<AppCalendar>(`/app/agenda?${query.toString()}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    const failure = describeLoad(error);
    return <PageError message={t(failure.key)} {...(failure.detail === '' ? {} : { detail: failure.detail })} />;
  }

  const here = new URLSearchParams();
  if (week !== thisWeek) here.set('week', week);
  if (child !== undefined) here.set('child', child);
  const path = here.size === 0 ? '/app/familia/aulas' : `/app/familia/aulas?${here.toString()}`;

  const leaves = await outcome(apiFetch<{ leaves: FamilyLeave[] }>('/app/medical-leave'));
  const storageReady = await storageConfigured();
  const several = agenda.children.length > 1;
  const nameOf = new Map(agenda.children.map((one) => [one.id, one.name]));
  const water = new Map(agenda.water.map((one) => [one.poolId, one]));

  const byDay = new Map<string, AppCalendarEntry[]>();
  for (const entry of agenda.entries) {
    byDay.set(entry.localDate, [...(byDay.get(entry.localDate) ?? []), entry]);
  }
  const closedDays = new Set<string>();
  for (const closure of agenda.closures) {
    for (let at = closure.startsOn; at <= closure.endsOn; at = addDays(at, 1)) closedDays.add(at);
  }

  const recent = await RecentLessons({
    recent: agenda.recent,
    names: several && child === undefined ? nameOf : null,
    from: path,
  });
  const certificates =
    leaves.state === 'ok'
      ? await FamilyCertificates({
          leaves: leaves.data.leaves.filter((leave) => child === undefined || leave.studentId === child),
          names: several ? nameOf : null,
          storageReady,
        })
      : null;

  // What is coming leads, and what has happened sits under *Últimas aulas*,
  // newest first (rule 4), so the tab opens on today in any month.
  const days = [...byDay.entries()];
  const coming = days.filter(([date]) => date >= day);
  const earlier = days.filter(([date]) => date < day).reverse();

  const dayRows = (date: string, entries: AppCalendarEntry[]): React.ReactElement => (
    <section key={date} className="flex flex-col">
      <h2 className="app-section-label">{dayHeading(t, date)}</h2>
      {/* Rows, not cards: edge to edge, a hairline between. */}
      <ul className="flex flex-col divide-y divide-border">
        {entries.map((entry) => (
          <li key={`${entry.sessionId ?? entry.localTime}-${entry.studentId}`}>
            <EntryCard
              entry={entry}
              childName={several && child === undefined ? (nameOf.get(entry.studentId) ?? null) : null}
              water={entry.poolId === null ? null : (water.get(entry.poolId) ?? null)}
              href={entry.opens && entry.sessionId !== null ? withFrom(`/app/familia/aulas/${entry.sessionId}`, path) : null}
              row
              attendance={entry.attendance}
              planned={!entry.generated}
            />
          </li>
        ))}
      </ul>
    </section>
  );

  return (
    <>
      <h1>{t('app.tabs.familia.aulas')}</h1>
      <ChildFilter base="/app/familia/aulas" children={agenda.children} chosen={child} />

      <WeekStrip
        week={week}
        today={day}
        child={child}
        lessonDays={new Set(byDay.keys())}
        closedDays={closedDays}
      />

      {byDay.size === 0 && (
        <p className="text-foreground-muted">
          {week === thisWeek && agenda.recent.length === 0
            ? t('app.family.calendar.notYet')
            : t('app.family.calendar.noneThisWeek')}
        </p>
      )}

      {coming.map(([date, entries]) => dayRows(date, entries))}

      {recent}

      {earlier.map(([date, entries]) => dayRows(date, entries))}

      {certificates}

      {leaves.state === 'failed' && <PageError message={t('app.family.certificatesFailed')} />}
    </>
  );
}
