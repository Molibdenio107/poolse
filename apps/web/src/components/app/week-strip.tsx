import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { agendaWeekOf, agendaWeekRange } from '@poolse/rules';
import { LinkBusy } from '@/components/link-busy';
import { formatDateRange, formatDayMonthShort } from '@/lib/date-format';
import { addDays } from '@/lib/dates';
import { cn } from '@/lib/utils';

const STEP =
  'inline-flex h-control w-control shrink-0 items-center justify-center rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/**
 * *Hoje* — back to this week from any other (Rui, 09-11-2026). Its own piece, for
 * the page's title row: inside the card it squeezed the week, and in a row of
 * its own above the card it pushed the arrows down the moment it appeared. In
 * the title row nothing moves. Nothing is drawn on this week itself.
 */
export async function WeekToday({
  week,
  today,
  child,
  base = '/app/familia/aulas',
}: {
  week: string;
  today: string;
  child: string | undefined;
  base?: string;
}): Promise<React.ReactElement | null> {
  const current = agendaWeekOf(today);
  if (week === current) return null;
  const t = await getTranslations();
  const query = new URLSearchParams({ week: current });
  if (child !== undefined) query.set('child', child);
  return (
    <Link
      href={`${base}?${query.toString()}`}
      className="inline-flex h-8 shrink-0 items-center rounded-full bg-primary/15 px-3 text-xs font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      {t('app.family.calendar.today')}
      <LinkBusy />
    </Link>
  );
}

/**
 * The family's calendar strip — POOLSE-175, a week since 06-11-2026 (Rui): the
 * arrows move the seven days on show, as far as the API answers
 * (`agendaWeekRange`, one definition). The stepper changes `?week=` and carries
 * `?child=`.
 *
 * A dot is a lesson and hatching is a closed day: two shapes, said once in the
 * legend and again for a screen reader, so colour carries neither. **That is the
 * whole of what a closure says here**: the page writes no sentence for it.
 */
export async function WeekStrip({
  week,
  today,
  child,
  lessonDays,
  closedDays,
  base = '/app/familia/aulas',
}: {
  /** The Monday. */
  week: string;
  today: string;
  child: string | undefined;
  lessonDays: ReadonlySet<string>;
  closedDays: ReadonlySet<string>;
  /** The page it steps; a teacher's *Aulas* passes its own (POOLSE-197). */
  base?: string;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const locale = await getLocale();
  const { first, last } = agendaWeekRange(today);
  const hrefFor = (target: string): string => {
    const query = new URLSearchParams({ week: target });
    if (child !== undefined) query.set('child', child);
    return `${base}?${query.toString()}`;
  };
  const step = (target: string, label: string, icon: React.ReactNode, allowed: boolean): React.ReactElement =>
    allowed ? (
      <Link href={hrefFor(target)} aria-label={label} className={STEP}>
        {icon}
        <LinkBusy />
      </Link>
    ) : (
      <span aria-hidden className={cn(STEP, 'opacity-30')}>
        {icon}
      </span>
    );

  return (
    <section aria-label={t('app.family.calendar.label')} className="flex flex-col gap-2 rounded bg-surface p-3 shadow-card">
      <div className="flex items-center justify-between gap-2">
        {step(addDays(week, -7), t('app.family.calendar.previous'), <ChevronLeft className="size-5" aria-hidden />, week > first)}
        {/*
          Two lines' room on every week (Rui, 09-11-2026), so "30 de novembro a 6 de
          dezembro de 2026" does not make that one week's card taller than the rest.
        */}
        <h2 className="flex min-h-[2lh] items-center justify-center text-center font-bold">
          {/* A week across New Year names both years, so its words are the short months. */}
          {week.slice(0, 4) === addDays(week, 6).slice(0, 4)
            ? formatDateRange(week, addDays(week, 6), locale)
            : t('app.family.calendar.yearRange', {
                from: `${formatDayMonthShort(week, locale)} ${week.slice(0, 4)}`,
                to: `${formatDayMonthShort(addDays(week, 6), locale)} ${addDays(week, 6).slice(0, 4)}`,
              })}
        </h2>
        {step(addDays(week, 7), t('app.family.calendar.next'), <ChevronRight className="size-5" aria-hidden />, week < last)}
      </div>
      <ol className="grid grid-cols-7 gap-1">
        {Array.from({ length: 7 }, (_, index) => addDays(week, index)).map((day) => {
          const closed = closedDays.has(day);
          const lesson = lessonDays.has(day);
          return (
            <li
              key={day}
              aria-current={day === today ? 'date' : undefined}
              className={cn(
                'flex min-h-12 flex-col items-center gap-1 whitespace-nowrap rounded-chip py-1.5 text-center text-[11px]',
                day === today && 'font-bold',
                closed && 'closed-hatch',
              )}
            >
              <span>{formatDayMonthShort(day, locale)}</span>
              {lesson && <span aria-hidden className="size-1.5 rounded-full bg-[rgb(var(--primary-ink))]" />}
              {lesson && <span className="sr-only">{t('app.family.calendar.lesson')}</span>}
              {closed && <span className="sr-only">{t('app.family.closed')}</span>}
            </li>
          );
        })}
      </ol>
      <p aria-hidden className="flex items-center gap-4 text-xs text-foreground-muted">
        <span className="flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-[rgb(var(--primary-ink))]" />
          {t('app.family.calendar.lesson')}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="closed-hatch size-3 rounded-sm" />
          {t('app.family.closed')}
        </span>
      </p>
    </section>
  );
}
