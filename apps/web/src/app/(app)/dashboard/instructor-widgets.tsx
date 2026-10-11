import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { AlertTriangle, Ban, Check, ClipboardCheck } from 'lucide-react';
import type {
  DashboardWidget,
  MyTurmasWidgetData,
  NextClassWidgetData,
  TrainingPlanWidgetData,
  WeekWidgetData,
} from '@/lib/api';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/date-format';
import { laneLabel } from '@/lib/lanes';
import { withFrom } from '@/lib/back';
import { WidgetCard } from './widget-card';
import { CopyPlanButton } from './copy-plan-button';

/**
 * The instructor band's cards — POOLSE-66, slice 3.
 *
 * Their own file because they share two helpers no other card needs, and
 * `widgets.tsx` stays the one place an id maps to a card. Like every card, a
 * body renders only for `state: 'ok'`; `WidgetCard` owns `empty` and `error`.
 *
 * No amount appears anywhere in here — AC 8, and the API's payload carries
 * none for these widgets to show.
 */

type Translate = Awaited<ReturnType<typeof getTranslations>>;

/**
 * "Hoje", "Amanhã", or "Quinta · 15-10-2026".
 *
 * The offset is the server's, counted on the site's clock; only the words are
 * chosen here, so a browser in another timezone cannot turn tomorrow into
 * today. One function for every instructor card, so no two word a day apart.
 */
function dayPhrase(
  t: Translate,
  when: { dayOffset: number; weekday: number; localDate: string },
): string {
  if (when.dayOffset === 0) return t('dashboard.widget.day.today');
  if (when.dayOffset === 1) return t('dashboard.widget.day.tomorrow');
  return t('dashboard.widget.day.other', {
    weekday: t(`week.${when.weekday}`),
    date: formatDate(when.localDate),
  });
}

/** Where a class's own page is: its turma, or — for a parceria — its week. */
function classHref(one: { classGroupId: string | null; localDate: string }): string {
  return one.classGroupId === null
    ? `/dashboard/calendar?week=${one.localDate}`
    : `/dashboard/classes/${one.classGroupId}`;
}

const LINK =
  'font-medium hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

const ACTION_BUTTON =
   'inline-flex h-control items-center justify-center px-4 text-control gap-1.5 self-start rounded bg-primary font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/** My next class — and, while its register is owed, the button to take it. */
export async function NextClassCard({
  widget,
}: {
  widget: DashboardWidget;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const data = widget.data as NextClassWidgetData | null;
  const lanes = data === null ? null : laneLabel(data.lanes, t as never);

  return (
    <WidgetCard
      widget={widget}
      title={t('dashboard.widget.next.title')}
      href={data === null ? '/dashboard/calendar' : classHref(data)}
      linkLabel={
        data === null || data.partner
          ? t('dashboard.widget.next.openCalendar')
          : t('dashboard.widget.next.openTurma')
      }
      emptyMessage={t('dashboard.widget.next.empty')}
    >
      {data !== null && (
        <>
          <div className="flex flex-col gap-0.5">
            <p className="text-lg font-medium">
              {data.className}
              {data.levelName !== null && (
                <span className="text-sm font-normal text-foreground-muted">
                  {' '}
                  · {data.levelName}
                </span>
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
              {[data.poolName, lanes ?? t('grid.noLane')].filter(Boolean).join(' · ')}
            </p>
            <p className="text-sm text-foreground-muted">
              {data.partner
                ? t('dashboard.widget.next.partnerHeadcount', { count: data.enrolled })
                : data.capacity === null
                  ? t('dashboard.widget.next.headcountUnlimited', { enrolled: data.enrolled })
                  : t('dashboard.widget.next.headcount', {
                      enrolled: data.enrolled,
                      capacity: data.capacity,
                    })}
            </p>
            {data.coveringFor !== null && (
              <p className="text-sm text-foreground-muted">
                {t('dashboard.widget.next.covering', { name: data.coveringFor })}
              </p>
            )}
          </div>

          {data.registerTaken ? (
            <p className="flex items-center gap-1.5 text-sm text-success">
              <Check className="size-4 shrink-0" aria-hidden="true" />
              {t('dashboard.widget.next.registerTaken')}
            </p>
          ) : (
            data.registerOpen && (
              <Link
                href={withFrom(`/dashboard/calendar/sessions/${data.sessionId}`, '/dashboard')}
                className={ACTION_BUTTON}
              >
                <ClipboardCheck className="size-4" aria-hidden="true" />
                {t('attendance.mark')}
              </Link>
            )
          )}
        </>
      )}
    </WidgetCard>
  );
}

/** This week, my classes only — a strip, each one a link. */
export async function WeekCard({ widget }: { widget: DashboardWidget }): Promise<React.ReactElement> {
  const t = await getTranslations();
  const data = widget.data as WeekWidgetData | null;

  return (
    <WidgetCard
      widget={widget}
      title={t('dashboard.widget.week.title')}
      href="/dashboard/calendar"
      linkLabel={t('dashboard.widget.week.open')}
      emptyMessage={t('dashboard.widget.week.empty')}
    >
      {data !== null && (
        <>
          <p className="text-sm text-foreground-muted">
            {t('dashboard.widget.week.summary', {
              total: data.classes.length,
              remaining: data.remaining,
            })}
          </p>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {data.classes.map((one) => (
              <li
                key={one.sessionId}
                className={cn(
                  'flex flex-col gap-0.5 rounded border border-border p-2 text-sm',
                  (one.past || one.cancelled) && 'text-foreground-muted',
                )}
              >
                <span className="text-xs uppercase tracking-wider text-foreground-muted">
                  {dayPhrase(t, one)} · {one.localTime}
                </span>
                <Link
                  href={withFrom(classHref(one), '/dashboard')}
                  className={cn(LINK, one.cancelled && 'line-through')}
                >
                  {one.className}
                </Link>
                {one.poolName !== null && <span>{one.poolName}</span>}
                {/* Each state in words with its icon — never the strike or the colour alone. */}
                {one.cancelled ? (
                  <span className="flex items-center gap-1 text-xs">
                    <Ban className="size-3.5 shrink-0" aria-hidden="true" />
                    {t('dashboard.widget.week.cancelled')}
                  </span>
                ) : one.registerTaken ? (
                  <span className="flex items-center gap-1 text-xs text-success">
                    <Check className="size-3.5 shrink-0" aria-hidden="true" />
                    {t('dashboard.widget.next.registerTaken')}
                  </span>
                ) : (
                  one.past &&
                  !one.partner && (
                    <span className="flex items-center gap-1 text-xs text-warning">
                      <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
                      {t('dashboard.widget.week.registerMissing')}
                    </span>
                  )
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </WidgetCard>
  );
}

/** The next lesson's plan: what it says, or that there is none and how to fix that. */
export async function TrainingPlanCard({
  widget,
}: {
  widget: DashboardWidget;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const data = widget.data as TrainingPlanWidgetData | null;
  // The calendar opens the plan sheet for `plan=` on the week that holds it.
  const sheet =
    data === null
      ? '/dashboard/calendar'
      : `/dashboard/calendar?week=${data.next.localDate}&plan=${data.next.sessionId}`;

  return (
    <WidgetCard
      widget={widget}
      title={t('dashboard.widget.plan.title')}
      href={sheet}
      linkLabel={
        data !== null && !data.written && data.canEdit
          ? t('dashboard.widget.plan.write')
          : t('dashboard.widget.plan.open')
      }
      emptyMessage={t('dashboard.widget.plan.empty')}
    >
      {data !== null && (
        <>
          <p className="text-sm">
            {t('dashboard.widget.plan.for', {
              name: data.next.className,
              day: dayPhrase(t, data.next),
              time: data.next.localTime,
            })}
          </p>

          {data.written ? (
            <>
              <p className="text-sm italic">«{data.excerpt}»</p>
              {data.updatedBy !== null && (
                <p className="text-xs text-foreground-muted">
                  {t('dashboard.widget.plan.writtenBy', { name: data.updatedBy })}
                </p>
              )}
            </>
          ) : (
            <>
              <p className="flex items-center gap-1.5 text-sm text-warning">
                <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
                {t('dashboard.widget.plan.missing')}
              </p>
              {data.canEdit && data.previousOn !== null && (
                <CopyPlanButton sessionId={data.next.sessionId} previousOn={data.previousOn} />
              )}
              {!data.canEdit && (
                <p className="text-xs text-foreground-muted">
                  {t('dashboard.widget.plan.readOnly')}
                </p>
              )}
            </>
          )}
        </>
      )}
    </WidgetCard>
  );
}

/** The turmas I am responsible for, with how many are in each. */
export async function MyTurmasCard({
  widget,
}: {
  widget: DashboardWidget;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const data = widget.data as MyTurmasWidgetData | null;

  return (
    <WidgetCard
      widget={widget}
      title={t('dashboard.widget.turmas.title')}
      href="/dashboard/classes"
      linkLabel={t('dashboard.widget.turmas.open')}
      emptyMessage={t('dashboard.widget.turmas.empty')}
    >
      {data !== null && (
        <>
          <ul className="flex flex-col gap-1.5 text-sm">
            {data.turmas.map((turma) => (
              <li key={turma.id} className="flex items-baseline justify-between gap-3">
                <Link href={withFrom(`/dashboard/classes/${turma.id}`, '/dashboard')} className={LINK}>
                  {turma.name}
                </Link>
                <span className="tabular-nums text-foreground-muted">
                  {turma.capacity === null
                    ? t('dashboard.widget.turmas.students', { students: turma.students })
                    : t('dashboard.widget.turmas.studentsOf', {
                        students: turma.students,
                        capacity: turma.capacity,
                      })}
                </span>
              </li>
            ))}
          </ul>
          {data.total > data.turmas.length && (
            <p className="text-xs text-foreground-muted">
              {t('dashboard.widget.turmas.more', { count: data.total - data.turmas.length })}
            </p>
          )}
        </>
      )}
    </WidgetCard>
  );
}
