import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { ChevronRight, FileText, Lock } from 'lucide-react';
import { LinkBusy } from '@/components/link-busy';
import { agendaMonthRange, isAgendaMonth, monthDays } from '@poolse/rules';
import { ApiError, apiFetch, type AppCalendar, type AppCalendarEntry, type FamilyLeave } from '@/lib/api';
import { withFrom } from '@/lib/back';
import { formatDate } from '@/lib/date-format';
import { addDays, today } from '@/lib/dates';
import { describeLoad, outcome } from '@/lib/load-failure';
import { storageConfigured } from '@/lib/storage-status';
import { PageError } from '@/components/page-shell';
import { MonthStrip } from '@/components/app/month-strip';
import { EntryCard, dayHeading } from '../agenda-parts';
import { FamilyCertificates } from '../certificates';
import { RecentLessons } from '../feedback';
import { ChildFilter } from '../child-filter';

/**
 * *Aulas* is the family's calendar — POOLSE-175. A month at a time, six ahead
 * and three back: its lessons, its closures and, past the lessons the club has
 * generated, the weekly pattern as *Previsto*. Under it, *Últimas aulas*
 * (POOLSE-116) and the medical certificates (POOLSE-109), as POOLSE-136 left them.
 *
 * Nothing here is edited. A row opens the lesson's page only where that page
 * answers, which the API says per entry (`opens`).
 */
export default async function FamilyLessons({
  searchParams,
}: {
  searchParams: Promise<{ child?: string; month?: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const { child, month: asked } = await searchParams;
  const day = today();
  const thisMonth = day.slice(0, 7);
  const { first, last } = agendaMonthRange(day);
  const month = isAgendaMonth(asked) && asked >= first && asked <= last ? asked : thisMonth;
  const { from, to } = monthDays(month);

  const query = new URLSearchParams({ from, to });
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
  if (month !== thisMonth) here.set('month', month);
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

      <MonthStrip
        month={month}
        today={day}
        child={child}
        lessonDays={new Set(byDay.keys())}
        closedDays={closedDays}
      />

      {agenda.closures.map((closure) => (
        <p key={closure.id} className="flex items-start gap-2 rounded bg-surface-muted p-3 text-sm">
          <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            {closure.startsOn === closure.endsOn
              ? t('app.family.calendar.closedDay', { date: formatDate(closure.startsOn) })
              : t('app.family.calendar.closedRange', {
                  from: formatDate(closure.startsOn),
                  to: formatDate(closure.endsOn),
                })}
            {closure.reason === '' ? '' : ` — ${closure.reason}`}
          </span>
        </p>
      ))}

      {byDay.size === 0 && (
        <p className="text-foreground-muted">
          {month === thisMonth && agenda.recent.length === 0
            ? t('app.family.calendar.notYet')
            : t('app.family.calendar.noneThisMonth')}
        </p>
      )}

      {coming.map(([date, entries]) => dayRows(date, entries))}

      {recent}

      {earlier.map(([date, entries]) => dayRows(date, entries))}

      {certificates}

      {/* POOLSE-179: one row, a screen deeper in. */}
      <Link
        href={child === undefined ? '/app/familia/documentos' : `/app/familia/documentos?child=${child}`}
        className="flex min-h-control items-center justify-between gap-3 rounded bg-surface px-4 py-3 shadow-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <span className="flex items-center gap-3">
          <FileText className="size-5 text-primary" aria-hidden />
          {t('app.documents.title')}
        </span>
        <ChevronRight className="size-4 text-foreground-muted" aria-hidden />
        <LinkBusy />
      </Link>

      {leaves.state === 'failed' && <PageError message={t('app.family.certificatesFailed')} />}
    </>
  );
}
