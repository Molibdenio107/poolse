import Link from 'next/link';
import { getFormatter, getLocale, getTranslations } from 'next-intl/server';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { agendaMonthRange, monthDays, shiftMonth } from '@poolse/rules';
import { LinkBusy } from '@/components/link-busy';
import { formatDayMonthShort } from '@/lib/date-format';
import { addDays } from '@/lib/dates';
import { cn } from '@/lib/utils';

const STEP =
  'inline-flex h-control w-control shrink-0 items-center justify-center rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/** Seven days: from today in this month, from the 1st in any other, never past the month's end. */
function stripDays(month: string, today: string): string[] {
  const { from, to } = monthDays(month);
  const wanted = today >= from && today <= to ? today : from;
  const latest = addDays(to, -6);
  const start = wanted > latest ? latest : wanted;
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

/**
 * The family's calendar strip — POOLSE-175. A week, and the month above it as a
 * stepper reaching as far as the API answers (`agendaMonthRange`, one definition).
 * The stepper changes `?month=` and carries `?child=`.
 *
 * A dot is a lesson and hatching is a closed day: two shapes, said once in the
 * legend and again for a screen reader, so colour carries neither.
 */
export async function MonthStrip({
  month,
  today,
  child,
  lessonDays,
  closedDays,
}: {
  month: string;
  today: string;
  child: string | undefined;
  lessonDays: ReadonlySet<string>;
  closedDays: ReadonlySet<string>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const locale = await getLocale();
  const format = await getFormatter();
  const { first, last } = agendaMonthRange(today);
  const hrefFor = (target: string): string => {
    const query = new URLSearchParams({ month: target });
    if (child !== undefined) query.set('child', child);
    return `/app/familia/aulas?${query.toString()}`;
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
        {step(shiftMonth(month, -1), t('app.family.calendar.previous'), <ChevronLeft className="size-5" aria-hidden />, month > first)}
        <h2 className="font-bold first-letter:uppercase">{format.dateTime(new Date(`${month}-15T12:00:00Z`), 'month')}</h2>
        {step(shiftMonth(month, 1), t('app.family.calendar.next'), <ChevronRight className="size-5" aria-hidden />, month < last)}
      </div>
      <ol className="grid grid-cols-7 gap-1">
        {stripDays(month, today).map((day) => {
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
