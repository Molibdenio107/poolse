import { getLocale, getTranslations } from 'next-intl/server';
import { AlertTriangle, Check } from 'lucide-react';
import type {
  ChildAttendanceWidgetData,
  ChildFeesWidgetData,
  ChildNextClassWidgetData,
  ChildPlanWidgetData,
  DashboardWidget,
  PoolTemperatureWidgetData,
} from '@/lib/api';
import { formatCents } from '@/lib/money';
import { formatDate } from '@/lib/date-format';
import { laneLabel } from '@/lib/lanes';
import { WidgetCard } from './widget-card';
import { dayPhrase } from './instructor-widgets';

/**
 * The personal band's cards — POOLSE-66 slice 5, 15 October 2026.
 *
 * Every card is about the one child the API chose (`dashboard.family`), and
 * every link goes to that child's own record, on the tab the card summarises.
 * Like every card, a body renders only for `state: 'ok'`; `WidgetCard` owns
 * `empty` and `error`. Nothing here writes: paying is done at the club, and the
 * plan is the instructor's.
 */

function record(childId: string, tab?: string): string {
  return `/dashboard/students/${childId}${tab === undefined ? '' : `?tab=${tab}`}`;
}

/** Their next lesson: when, where, with whom. */
export async function ChildNextClassCard({
  widget,
  childId,
}: {
  widget: DashboardWidget;
  childId: string;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const data = widget.data as ChildNextClassWidgetData | null;
  const lanes = data === null ? null : laneLabel(data.lanes, t as never);

  return (
    <WidgetCard
      widget={widget}
      title={t('family.widget.next.title')}
      href={record(childId, 'week')}
      linkLabel={t('family.widget.next.open')}
      emptyMessage={t('family.widget.next.empty')}
    >
      {data !== null && (
        <div className="flex flex-col gap-0.5">
          <p className="text-lg font-medium">
            {data.className}
            {data.levelName !== null && (
              <span className="text-sm font-normal text-foreground-muted"> · {data.levelName}</span>
            )}
          </p>
          <p className="text-sm">
            {t('dashboard.widget.next.when', {
              day: dayPhrase(t, data),
              time: data.localTime,
              minutes: data.durationMinutes,
            })}
          </p>
          <p className="text-sm text-foreground-muted">
            {[data.poolName, lanes].filter(Boolean).join(' · ')}
          </p>
          {data.instructorName !== null && (
            <p className="text-sm text-foreground-muted">
              {t('family.widget.next.with', { name: data.instructorName })}
            </p>
          )}
        </div>
      )}
    </WidgetCard>
  );
}

/** That lesson's plan, read-only and without its author. */
export async function ChildPlanCard({
  widget,
  childId,
}: {
  widget: DashboardWidget;
  childId: string;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const data = widget.data as ChildPlanWidgetData | null;

  return (
    <WidgetCard
      widget={widget}
      title={t('family.widget.plan.title')}
      href={record(childId, 'week')}
      linkLabel={t('family.widget.plan.open')}
      emptyMessage={t('family.widget.plan.empty')}
    >
      {data !== null && (
        <div className="flex flex-col gap-1">
          <p className="text-sm text-foreground-muted">
            {data.next.className} · {dayPhrase(t, data.next)} · {data.next.localTime}
          </p>
          {data.body === '' ? (
            <p className="text-sm text-foreground-muted">{t('family.planEmpty')}</p>
          ) : (
            <p className="line-clamp-6 whitespace-pre-wrap text-sm">{data.body}</p>
          )}
        </div>
      )}
    </WidgetCard>
  );
}

/** What is still to pay, and whether any of it is late. */
export async function ChildFeesCard({
  widget,
  childId,
}: {
  widget: DashboardWidget;
  childId: string;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const locale = await getLocale();
  const data = widget.data as ChildFeesWidgetData | null;

  return (
    <WidgetCard
      widget={widget}
      title={t('family.widget.fees.title')}
      href={record(childId, 'fees')}
      linkLabel={t('family.widget.fees.open')}
      emptyMessage={t('family.noFees')}
    >
      {data !== null && (
        <div className="flex flex-col gap-1">
          {data.outstandingCents > 0 ? (
            <>
              <p className="text-sm">{t('fees.totalRemaining')}</p>
              <p className="text-2xl font-semibold tabular-nums">
                {formatCents(locale, data.outstandingCents)}
              </p>
            </>
          ) : (
            <p className="flex items-center gap-1.5 text-sm">
              <Check aria-hidden className="size-4 shrink-0 text-primary" />
              {t('family.widget.fees.settled')}
            </p>
          )}
          {/* A word and an icon, never colour alone. */}
          {data.overdueCount > 0 && (
            <p className="flex items-center gap-1.5 text-sm text-danger">
              <AlertTriangle aria-hidden className="size-4 shrink-0" />
              {t('family.widget.fees.overdue', { count: data.overdueCount })}
            </p>
          )}
          {data.overdueCount === 0 && data.nextDueOn !== null && (
            <p className="text-sm text-foreground-muted">
              {t('fees.dueBy', { date: formatDate(data.nextDueOn) })}
            </p>
          )}
        </div>
      )}
    </WidgetCard>
  );
}

/** This month's register, in words. */
export async function ChildAttendanceCard({
  widget,
  childId,
}: {
  widget: DashboardWidget;
  childId: string;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const data = widget.data as ChildAttendanceWidgetData | null;

  return (
    <WidgetCard
      widget={widget}
      title={t('family.widget.attendance.title')}
      href={`/dashboard/students/${childId}/progress`}
      linkLabel={t('family.widget.attendance.open')}
      emptyMessage={t('family.widget.attendance.empty')}
    >
      {data !== null && (
        <div className="flex flex-col gap-1 text-sm">
          <p>{t('family.widget.attendance.summary', { present: data.present, held: data.held })}</p>
          <p className="text-foreground-muted">
            {t('family.widget.attendance.detail', {
              absent: data.absent,
              excused: data.excused,
            })}
          </p>
          {data.unmarked > 0 && (
            <p className="text-foreground-muted">
              {t('family.widget.attendance.unmarked', { count: data.unmarked })}
            </p>
          )}
        </div>
      )}
    </WidgetCard>
  );
}

/** The water at the pool of their next lesson — temperature only. */
export async function ChildWaterCard({
  widget,
  childId,
}: {
  widget: DashboardWidget;
  childId: string;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const data = widget.data as PoolTemperatureWidgetData | null;

  return (
    <WidgetCard
      widget={widget}
      title={t('family.widget.water.title')}
      href={record(childId, 'week')}
      linkLabel={t('family.widget.next.open')}
      emptyMessage={t('family.widget.water.empty')}
    >
      {data !== null && (
        <div className="flex flex-col gap-0.5">
          <p className="text-2xl font-semibold tabular-nums">
            {t('family.widget.water.celsius', { value: Number(data.celsius) })}
          </p>
          <p className="text-sm text-foreground-muted">
            {t('family.widget.water.measured', {
              pool: data.poolName,
              date: formatDate(data.localDate),
              time: data.localTime,
            })}
          </p>
        </div>
      )}
    </WidgetCard>
  );
}
