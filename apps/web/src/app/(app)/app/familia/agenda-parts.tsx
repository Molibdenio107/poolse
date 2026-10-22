import Link from 'next/link';
import { LinkBusy } from '@/components/link-busy';
import { getLocale, getTranslations } from 'next-intl/server';
import { Ban, ChevronRight, Lock, MoveRight, Thermometer, UserRound } from 'lucide-react';
import type { AppAgendaEntry, AppChild, AppWater } from '@/lib/api';
import { formatDate } from '@/lib/date-format';
import { addDays, today } from '@/lib/dates';
import { laneLabel } from '@/lib/lanes';
import { formatCents } from '@/lib/money';
import { timeAgo } from '@/lib/relative-time';
import { cn } from '@/lib/utils';
import { PaymentDestinations } from '@/components/payment-destinations';

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

/** One lesson, as a card. A link to its page unless it is the page. */
export async function EntryCard({
  entry,
  childName,
  water,
  href,
}: {
  entry: AppAgendaEntry;
  /** Shown when the agenda holds more than one child. */
  childName: string | null;
  water: AppWater | null;
  href: string | null;
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
      </div>
      {href !== null && <ChevronRight className="mt-1 size-4 shrink-0 text-foreground-muted" aria-hidden />}
    </div>
  );

  const card = 'block rounded-lg border border-border bg-surface p-3';
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
 * What each child owes, read-only — `balance` from the fee read, never re-added
 * (POOLSE-90). It links to the child's own fee page.
 */
export async function FeeStatus({ children }: { children: AppChild[] }): Promise<React.ReactElement | null> {
  const t = await getTranslations();
  const locale = await getLocale();
  const owing = children.filter((child) => child.fees !== null);
  if (owing.length === 0) return null;
  // One account per club, so one block; the reference is each child's own.
  const paying = owing.filter((child) => child.payTo !== null);
  const destinations = paying[0]?.payTo?.destinations ?? null;

  return (
    <section className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
      <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">{t('app.family.feesTitle')}</h2>
      <ul className="flex flex-col divide-y divide-border">
        {owing.map((child) => (
          <li key={child.id}>
            <Link
              href={`/dashboard/students/${child.id}?tab=fees`}
              className="flex min-h-control items-center justify-between gap-3 py-2 hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <span className="font-medium">{child.name}</span>
              {/* Three states: overdue is a debt; unpaid before its date is not. */}
              {child.fees!.overdueCount > 0 ? (
                <span className="text-sm font-medium text-danger">
                  {t('app.family.owing', { amount: formatCents(locale, child.fees!.outstandingCents) })}
                </span>
              ) : child.fees!.outstandingCents > 0 ? (
                <span className="text-sm">
                  {child.fees!.nextDueOn === null
                    ? t('app.family.toPay', { amount: formatCents(locale, child.fees!.outstandingCents) })
                    : t('app.family.toPayBy', {
                        amount: formatCents(locale, child.fees!.outstandingCents),
                        date: formatDate(child.fees!.nextDueOn),
                      })}
                </span>
              ) : (
                <span className="text-sm text-success">{t('app.family.upToDate')}</span>
              )}
              <LinkBusy />
            </Link>
          </li>
        ))}
      </ul>
      {destinations !== null && (
        <PaymentDestinations
          destinations={destinations}
          references={paying.map((child) => ({
            label: paying.length > 1 ? child.name : undefined,
            reference: child.payTo!.reference,
          }))}
        />
      )}
    </section>
  );
}
