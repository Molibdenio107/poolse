import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Ban, Check, ChevronRight, Lock, MoveRight, UserRound } from 'lucide-react';
import type { CalendarClosure, CalendarSession } from '@/lib/api';
import { addDays, isoWeekday } from '@/lib/dates';
import { formatDate } from '@/lib/date-format';
import { laneLabel } from '@/lib/lanes';
import { cn } from '@/lib/utils';

/**
 * The week on a phone — one day at a time, as a list of lessons.
 *
 * The desk calendar is a lane grid: seven days times every pista, blocks placed
 * by the minute and moved by dragging. At 360px that is seven columns a few
 * pixels wide, and no lesson in it can be read or tapped. So below `md` the
 * page draws this instead, from the same week's sessions the grid overlays:
 * a row of seven days to choose from (`?day=`), and that day's lessons as cards,
 * every tank together, in time order. A lesson opens its own page, which on a
 * phone carries the register, the plan, the stand-in and Cancelar aula.
 *
 * It moves nothing. Dragging a lesson to another hour or pista is the desk's
 * job, and the grid is still there on anything `md` and up.
 */
export async function CalendarAgenda({
  monday,
  day,
  sessions,
  closures,
  className,
}: {
  /** The week shown, as its Monday. */
  monday: string;
  /** The chosen day, inside that week. */
  day: string;
  sessions: CalendarSession[];
  /** This week's closures, by weekday — the same list the grid locks with. */
  closures: CalendarClosure[];
  className?: string;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const days = [0, 1, 2, 3, 4, 5, 6].map((offset) => addDays(monday, offset));
  const weekday = isoWeekday(day);

  // Sessions sit on `localDate`, which follows a one-week move; the pattern does not.
  const onDay = sessions
    .filter((session) => session.localDate === day)
    .sort((a, b) => a.localTime.localeCompare(b.localTime) || a.className.localeCompare(b.className));
  const shutToday = closures.filter((closure) => closure.weekday === weekday && closure.poolId === null);

  return (
    <section className={cn('flex flex-col gap-3', className)} aria-label={t('calendar.agenda.label')}>
      {/*
        Seven days across, each a link — 44px tall to a finger, and on a 360px
        screen each one is about a seventh of it, which fits a short name and a
        date. The number of lessons is the reason to tap one rather than another.
      */}
      <nav className="grid grid-cols-7 gap-1" aria-label={t('calendar.agenda.days')}>
        {days.map((date, index) => {
          const count = sessions.filter((session) => session.localDate === date && session.status !== 'cancelled').length;
          const chosen = date === day;
          return (
            <Link
              key={date}
              href={`/dashboard/calendar?week=${monday}&day=${date}`}
              scroll={false}
              aria-current={chosen ? 'date' : undefined}
              aria-label={t('calendar.agenda.dayLink', { day: t(`week.${index + 1}`), date: formatDate(date), count })}
              className={cn(
                'flex min-h-control flex-col items-center justify-center rounded border py-1 text-sm leading-tight',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
                chosen ? 'border-primary bg-primary/10 font-semibold text-primary' : 'border-border bg-surface',
              )}
            >
              <span>{t(`weekShort.${index + 1}`)}</span>
              <span className="tabular-nums">{date.slice(8, 10)}</span>
              <span className={cn('text-xs tabular-nums', count === 0 ? 'text-foreground-muted' : '')}>{count}</span>
            </Link>
          );
        })}
      </nav>

      <h2 className="text-base font-semibold">
        {t(`week.${weekday}`)} · {formatDate(day)}
      </h2>

      {shutToday.map((closure) => (
        <p key={closure.reason} className="flex items-center gap-2 rounded border border-warning/40 bg-warning/10 p-3 text-sm">
          <Lock className="size-4 shrink-0 text-warning" aria-hidden />
          {t('calendar.agenda.closed', { reason: closure.reason })}
        </p>
      ))}

      {onDay.length === 0 ? (
        <p className="rounded border border-dashed border-border p-4 text-center text-sm text-foreground-muted">
          {t('calendar.agenda.empty')}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {onDay.map((session) => (
            <li key={session.id}>
              <AgendaCard session={session} monday={monday} t={t} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AgendaCard({
  session,
  monday,
  t,
}: {
  session: CalendarSession;
  monday: string;
  t: Awaited<ReturnType<typeof getTranslations>>;
}): React.ReactElement {
  const cancelled = session.status === 'cancelled';
  const end = endTime(session.localTime, session.durationMinutes);
  const lanes = laneLabel(session.lanes, t as never);
  // A parceria or a free-swim block has no turma and so no register page.
  const href = session.classGroupId ? `/dashboard/calendar/sessions/${session.id}?week=${monday}` : null;

  const body = (
    <div className="flex items-start gap-3">
      <div className="flex w-14 shrink-0 flex-col tabular-nums">
        <span className="font-semibold">{session.localTime}</span>
        <span className="text-sm text-foreground-muted">{end}</span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={cn('font-medium', cancelled && 'line-through')}>
          {session.className}
          {session.levelName !== null && (
            <span className="font-normal text-foreground-muted"> · {session.levelName}</span>
          )}
        </span>
        <span className="text-sm text-foreground-muted">
          {[session.poolName, lanes].filter(Boolean).join(' · ')}
        </span>
        {(session.substituteName ?? session.instructorName) !== null && (
          <span className="flex items-center gap-1 text-sm">
            <UserRound className="size-3.5 shrink-0" aria-hidden />
            {session.substituteName !== null
              ? t('calendar.agenda.standIn', { name: session.substituteName })
              : session.instructorName}
          </span>
        )}
        {/* Each state in words with its icon — never the strike or a colour alone. */}
        {cancelled ? (
          <span className="flex items-center gap-1 text-sm text-danger">
            <Ban className="size-3.5 shrink-0" aria-hidden />
            {session.byClosure
              ? t('calendar.byClosure')
              : `${t('calendar.agenda.cancelled')}${session.cancellationReason ? ` — ${session.cancellationReason}` : ''}`}
          </span>
        ) : session.registerTaken ? (
          <span className="flex items-center gap-1 text-sm text-success">
            <Check className="size-3.5 shrink-0" aria-hidden />
            {t('calendar.agenda.registerTaken')}
          </span>
        ) : null}
        {session.moved === true && !cancelled && (
          <span className="flex items-center gap-1 text-sm text-foreground-muted">
            <MoveRight className="size-3.5 shrink-0" aria-hidden />
            {t('calendar.agenda.moved')}
          </span>
        )}
      </div>
      {href !== null && <ChevronRight className="mt-1 size-4 shrink-0 text-foreground-muted" aria-hidden />}
    </div>
  );

  const card = 'block rounded border border-border bg-surface p-3';
  return href === null ? (
    <div className={card}>{body}</div>
  ) : (
    <Link
      href={href}
      className={cn(
        card,
        'hover:border-primary/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
      )}
    >
      {body}
    </Link>
  );
}

/** "18:00" + 45 → "18:45", on the wall clock the start is already in. */
function endTime(start: string, minutes: number): string {
  const [h, m] = start.split(':').map(Number);
  const total = (h ?? 0) * 60 + (m ?? 0) + minutes;
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
