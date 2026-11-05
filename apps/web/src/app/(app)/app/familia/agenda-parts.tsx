import Link from 'next/link';
import { LinkBusy } from '@/components/link-busy';
import { getLocale, getTranslations } from 'next-intl/server';
import { Ban, Check, ChevronRight, Lock, MoveRight, Thermometer, UserRound, X } from 'lucide-react';
import type { AppAgendaEntry, AppChild, AppWater } from '@/lib/api';
import { formatDate } from '@/lib/date-format';
import { addDays, today } from '@/lib/dates';
import { laneLabel } from '@/lib/lanes';
import { formatCents } from '@/lib/money';
import { timeAgo } from '@/lib/relative-time';
import { cn } from '@/lib/utils';

type T = Awaited<ReturnType<typeof getTranslations>>;

/** "18:00" + 45 → "18:45", on the site's clock the start is already in. */
export function endTime(start: string, minutes: number): string {
  const [h, m] = start.split(':').map(Number);
  const total = (h ?? 0) * 60 + (m ?? 0) + minutes;
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** "Hoje", "Amanhã", or the weekday and the date — the day a lesson lands. */
export function dayHeading(t: T, date: string): string {
  if (date === today()) return t('app.family.today');
  if (date === addDays(today(), 1)) return t('app.family.tomorrow');
  const weekday = ((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
  return `${t(`week.${weekday}`)} · ${formatDate(date)}`;
}

/**
 * The water at a lesson's tank: the temperature and how long ago it was taken.
 * Always with its age, so three-day-old water never reads as this morning's
 * (POOLSE-90, QA 6).
 */
export async function WaterLine({ water }: { water: AppWater }): Promise<React.ReactElement> {
  const t = await getTranslations();
  const locale = await getLocale();
  const celsius = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(Number(water.celsius));
  return (
    <span className="flex items-center gap-1 text-sm">
      <Thermometer className="size-3.5 shrink-0" aria-hidden />
      {t('app.family.water', { celsius, ago: timeAgo(water.takenAt, locale) ?? '' })}
    </span>
  );
}

/** One lesson, as a card or a row. A link to its page unless it is the page. */
export async function EntryCard({
  entry,
  childName,
  water,
  href,
  row = false,
  attendance = null,
  planned = false,
}: {
  entry: Omit<AppAgendaEntry, 'sessionId'>;
  /** Shown when the agenda holds more than one child. */
  childName: string | null;
  water: AppWater | null;
  href: string | null;
  /** A row in a list (POOLSE-136, app mode's tabs): edge to edge, no card. */
  row?: boolean;
  /** The child's mark on a past lesson (POOLSE-175), in words with its icon. */
  attendance?: 'present' | 'absent' | 'excused' | null;
  /** A day of the weekly pattern, not yet a lesson (POOLSE-175). */
  planned?: boolean;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const cancelled = entry.status === 'cancelled';
  const lanes = laneLabel(entry.lanes, t as never);

  const body = (
    <div className="flex items-start gap-3">
      <div className="flex w-14 shrink-0 flex-col tabular-nums">
        <span className={cn('font-semibold', cancelled && 'line-through')}>{entry.localTime}</span>
        <span className="text-sm text-foreground-muted">{endTime(entry.localTime, entry.durationMinutes)}</span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {childName !== null && <span className="text-sm font-semibold text-primary">{childName}</span>}
        <span className="font-medium">
          {entry.className}
          {entry.levelName !== null && <span className="font-normal text-foreground-muted"> · {entry.levelName}</span>}
        </span>
        <span className="text-sm text-foreground-muted">
          {[entry.siteName, entry.poolName, lanes].filter(Boolean).join(' · ')}
        </span>
        {entry.instructorFirstName !== null && (
          <span className="flex items-center gap-1 text-sm">
            <UserRound className="size-3.5 shrink-0" aria-hidden />
            {entry.standIn
              ? t('app.family.standIn', { name: entry.instructorFirstName })
              : entry.instructorFirstName}
          </span>
        )}
        {/* Each state in words with its icon — never by colour or a strike alone. */}
        {planned && <span className="text-sm font-medium text-foreground-muted">{t('app.family.calendar.planned')}</span>}
        {attendance !== null && (
          <span className="flex items-center gap-1 text-sm font-medium">
            {attendance === 'present' ? (
              <Check className="size-3.5 shrink-0" aria-hidden />
            ) : (
              <X className="size-3.5 shrink-0" aria-hidden />
            )}
            {t(`app.family.calendar.attendance.${attendance}`)}
          </span>
        )}
        {cancelled && entry.byClosure && (
          <span className="flex items-center gap-1 text-sm font-medium text-warning">
            <Lock className="size-3.5 shrink-0" aria-hidden />
            {t('app.family.closed')}
            {entry.cancellationReason ? ` — ${entry.cancellationReason}` : ''}
          </span>
        )}
        {cancelled && !entry.byClosure && (
          <span className="flex items-center gap-1 text-sm font-medium text-danger">
            <Ban className="size-3.5 shrink-0" aria-hidden />
            {t('app.family.cancelled')}
            {entry.cancellationReason ? ` — ${entry.cancellationReason}` : ''}
          </span>
        )}
        {entry.moved && !cancelled && (
          <span className="flex items-center gap-1 text-sm font-medium text-[rgb(var(--app-accent-ink))]">
            <MoveRight className="size-3.5 shrink-0" aria-hidden />
            {t('app.family.moved')}
          </span>
        )}
        {water !== null && !cancelled && <WaterLine water={water} />}
        {/* What the family told the club — POOLSE-90 slice 2. Words and an icon. */}
        {!cancelled && entry.going !== null && (
          <span className="flex items-center gap-1 text-sm font-medium">
            {entry.going ? (
              <Check className="size-3.5 shrink-0" aria-hidden />
            ) : (
              <X className="size-3.5 shrink-0" aria-hidden />
            )}
            {entry.going ? t('app.notice.saidGoing') : t('app.notice.saidNotGoing')}
          </span>
        )}
      </div>
      {href !== null && <ChevronRight className="mt-1 size-4 shrink-0 text-foreground-muted" aria-hidden />}
    </div>
  );

  const card = row ? 'block min-h-[44px] py-3' : 'block rounded-lg bg-surface p-3 shadow-card';
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
      <LinkBusy />
    </Link>
  );
}

/**
 * One child's fees in a sentence — *Pagamentos* and *Início* say the same one.
 * Three states: overdue is a debt; unpaid before its date is not.
 */
export async function FeeSentence({ fees }: { fees: NonNullable<AppChild['fees']> }): Promise<React.ReactElement> {
  const t = await getTranslations();
  const locale = await getLocale();
  const amount = formatCents(locale, fees.outstandingCents);
  if (fees.overdueCount > 0) {
    return <span className="text-sm font-medium text-danger">{t('app.family.owing', { amount })}</span>;
  }
  if (fees.outstandingCents > 0) {
    return (
      <span className="text-sm">
        {fees.nextDueOn === null
          ? t('app.family.toPay', { amount })
          : t('app.family.toPayBy', { amount, date: formatDate(fees.nextDueOn) })}
      </span>
    );
  }
  return <span className="text-sm text-success">{t('app.family.upToDate')}</span>;
}
