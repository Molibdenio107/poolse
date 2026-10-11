import Link from 'next/link';
import { getFormatter, getLocale, getTranslations } from 'next-intl/server';
import { AlertTriangle, CalendarClock, Check, Circle } from 'lucide-react';
import type {
  ChecklistWidgetData,
  DashboardScope,
  DashboardWidget,
  EnergyCostsWidgetData,
  MaintenanceWidgetData,
  MoneyWidgetData,
  OccupancyTodayWidgetData,
  PeopleWidgetData,
  StaffCostWidgetData,
  SubscriptionWidgetData,
  TasksWidgetData,
  WaterWidgetData,
  QualificationsWidgetData,
} from '@/lib/api';
import { formatCents } from '@/lib/money';
import { cn } from '@/lib/utils';
import { ConsumptionBars } from '@/components/consumption-bars';
import { centsToText } from '@/lib/energy-invoice';
import { formatDate } from '@/lib/date-format';
import { withFrom } from '@/lib/back';
import { WidgetCard } from './widget-card';
import { QualificationStatus } from '@/components/qualification-status';
import { MyTurmasCard, NextClassCard, TrainingPlanCard, WeekCard } from './instructor-widgets';
import {
  FaultsCard,
  InventoryWatchCard,
  OverdueCleaningsCard,
  WaterDueCard,
} from './maintenance-widgets';

/**
 * What each card draws — POOLSE-66, slice 2a.
 *
 * One function per widget id, and `renderWidget` below is the only place that
 * maps one to the other. The shape is deliberately flat: a widget is a
 * declaration in the registry on the server and a case here, and adding one is
 * those two things rather than a new pipeline.
 *
 * **A body renders only for `state: 'ok'`.** `WidgetCard` owns `empty` and
 * `error`, so nothing here needs a null check on its own data — and no card can
 * forget to tell the difference between "nothing to show" and "that broke",
 * which was the whole reason for a shared card.
 */

/** Every widget the client can draw. An id not here renders nothing — see below. */
export async function renderWidget(
  widget: DashboardWidget,
  scope: DashboardScope,
): Promise<React.ReactElement | null> {
  switch (widget.id) {
    case 'mgmt.money.period':
      return <MoneyCard widget={widget} />;
    case 'mgmt.occupancy.today':
      return <OccupancyTodayCard widget={widget} />;
    case 'mgmt.waterquality.alerts':
      return <WaterCard widget={widget} scope={scope} />;
    case 'mgmt.maintenance.open':
      return <MaintenanceCard widget={widget} scope={scope} />;
    case 'mgmt.people':
      return <PeopleCard widget={widget} />;
    case 'mgmt.staffcost':
      return <StaffCostCard widget={widget} />;
    case 'mgmt.qualifications':
      return <QualificationsCard widget={widget} />;
    case 'mgmt.subscription':
      return <SubscriptionCard widget={widget} />;
    case 'mgmt.energy.costs':
      return <EnergyCostsCard widget={widget} />;
    case 'maint.mytasks':
      return <TasksCard widget={widget} />;
    case 'inst.nextclass':
      return <NextClassCard widget={widget} />;
    case 'inst.week':
      return <WeekCard widget={widget} />;
    case 'inst.trainingplan.next':
      return <TrainingPlanCard widget={widget} />;
    case 'inst.myturmas':
      return <MyTurmasCard widget={widget} />;
    case 'maint.requests':
      return <FaultsCard widget={widget} />;
    case 'maint.cleanings.overdue':
      return <OverdueCleaningsCard widget={widget} />;
    case 'maint.waterquality.due':
      return <WaterDueCard widget={widget} />;
    case 'maint.inventory':
      return <InventoryWatchCard widget={widget} />;
    case 'setup.checklist':
      return <ChecklistCard widget={widget} />;
    /*
     * A widget the server offers and this client cannot draw.
     *
     * Nothing, on purpose: the registry and the client ship in the same commit,
     * so this is unreachable today. It is a `default` rather than an exhaustive
     * union because `id` is a string on the wire — an older browser holding a
     * cached bundle after a deploy is the one case that reaches it, and drawing
     * a card whose body nobody wrote would be worse than drawing none.
     */
    default:
      return null;
  }
}

/* -------------------------------------------------------------------------- */

/** Where the club stands with Poolse. Owner only — POOLSE-60. */
async function SubscriptionCard({ widget }: { widget: DashboardWidget }): Promise<React.ReactElement> {
  const t = await getTranslations();
  const data = widget.data as SubscriptionWidgetData | null;

  return (
    <WidgetCard
      widget={widget}
      title={t('subscription.title')}
      href="/dashboard/profile/subscription"
      linkLabel={t('subscription.open')}
      emptyMessage={t('dashboard.widget.subscription.empty')}
    >
      {data !== null && (
        <>
          <p className="text-lg font-medium">
            {data.status === null
              ? t('subscription.state.unknown')
              : t(`subscription.state.${data.status}`)}
          </p>

          {/*
            The days, not the date, when a trial is running — "faltam 3 dias" is
            a thing to act on and "termina a 26-09-2026" is a thing to work out.
            The date comes too, because somebody has to put it in a diary.
          */}
          {data.trialDaysLeft !== null && data.trialEndsAt !== null && (
            <p className="text-sm text-foreground-muted">
              {t('dashboard.widget.subscription.trial', {
                days: data.trialDaysLeft,
                on: formatDate(data.trialEndsAt),
              })}
            </p>
          )}

          {data.currentPeriodEnd !== null && (
            <p className="text-sm text-foreground-muted">
              {t(
                data.cancelAtPeriodEnd
                  ? 'dashboard.widget.subscription.ends'
                  : 'dashboard.widget.subscription.renews',
                { on: formatDate(data.currentPeriodEnd) },
              )}
            </p>
          )}
        </>
      )}
    </WidgetCard>
  );
}

/* -------------------------------------------------------------------------- */

/** The jobs that are mine, and the ones nobody has taken — slice 4.3's panel. */
async function TasksCard({ widget }: { widget: DashboardWidget }): Promise<React.ReactElement> {
  const t = await getTranslations();
  const data = widget.data as TasksWidgetData | null;
  const due = data?.tasks.filter((task) => task.state === 'due') ?? [];

  /*
    There is no list of every task — a task belongs to a site, and the site's
    Manutenção tab is that list. So the card opens the one site its tasks are on,
    which is every club on a one-site licence, and the sites otherwise. It used
    to point at /dashboard/facilities/tasks, a page that does not exist.
  */
  const sites = new Set(data?.tasks.map((task) => task.facilityId) ?? []);
  const [only] = sites;
  const href =
    sites.size === 1 && only !== undefined
      ? `/dashboard/facilities/${only}?tab=maintenance`
      : '/dashboard/facilities';

  return (
    <WidgetCard
      widget={widget}
      title={t('maintenance.mine')}
      href={href}
      linkLabel={t('dashboard.widget.tasks.open')}
      emptyMessage={t('dashboard.widget.tasks.empty')}
    >
      {data !== null && (
        <>
          <p className="text-sm text-foreground-muted">
            {t('maintenance.summary', { total: data.total, due: due.length })}
          </p>

          <ul className="flex flex-col divide-y divide-border rounded border border-border">
            {data.tasks.map((task) => (
              <li
                key={task.id}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 p-3"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <Link
                    href={withFrom(`/dashboard/facilities/tasks/${task.id}`, '/dashboard')}
                    className="text-sm font-medium hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  >
                    {task.title}
                  </Link>

                  {/* Icon and words together, never colour alone. */}
                  {task.state === 'due' ? (
                    <span className="inline-flex items-center gap-1 rounded bg-danger/10 px-1.5 py-0.5 text-xs font-medium text-danger">
                      <AlertTriangle className="size-3.5" aria-hidden="true" />
                      {task.daysOverdue > 0
                        ? t('maintenance.dueBy', { days: task.daysOverdue })
                        : t('maintenance.due')}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded bg-success/10 px-1.5 py-0.5 text-xs font-medium text-success">
                      <CalendarClock className="size-3.5" aria-hidden="true" />
                      {t('maintenance.scheduled')}
                    </span>
                  )}
                </span>

                <span className="text-sm text-foreground-muted">
                  {task.facilityName}
                  {task.assignedTo === null && ` · ${t('maintenance.unassigned')}`}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </WidgetCard>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * What a brand-new club does next.
 *
 * Every step links to the screen that completes it, because a checklist that
 * only tells you what is missing is a checklist you read and then go hunting
 * from. A done step keeps its link: "prices" is done at one plan and is still
 * where the second one goes.
 */
const CHECKLIST_HREF: Record<ChecklistWidgetData['steps'][number]['id'], string> = {
  facility: '/dashboard/facilities/new',
  pools: '/dashboard/facilities/pools/new',
  prices: '/dashboard/facilities',
  staff: '/dashboard/facilities/staff',
  students: '/dashboard/students/new',
};

async function ChecklistCard({ widget }: { widget: DashboardWidget }): Promise<React.ReactElement> {
  const t = await getTranslations();
  const data = widget.data as ChecklistWidgetData | null;

  return (
    <WidgetCard
      widget={widget}
      title={t('dashboard.widget.checklist.title')}
      href="/dashboard/facilities/new"
      linkLabel={t('dashboard.widget.checklist.open')}
      emptyMessage={t('dashboard.widget.checklist.empty')}
    >
      {data !== null && (
        <ul className="flex flex-col gap-2">
          {data.steps.map((step) => (
            <li key={step.id} className="flex items-center gap-2">
              {/*
                A tick or an empty ring, and the word beside it — the state is
                never the colour alone. `aria-hidden` on both: the sentence a
                screen reader needs is in the text, not in the shape.
              */}
              {step.done ? (
                <Check className="size-4 shrink-0 text-success" aria-hidden="true" />
              ) : (
                <Circle className="size-4 shrink-0 text-foreground-muted" aria-hidden="true" />
              )}
              <Link
                href={withFrom(CHECKLIST_HREF[step.id], '/dashboard')}
                className="text-sm hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                {t(`dashboard.widget.checklist.step.${step.id}`)}
              </Link>
              <span className="text-sm text-foreground-muted">
                {step.done
                  ? t('dashboard.widget.checklist.done')
                  : t('dashboard.widget.checklist.todo')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * What electricity has cost — the bespoke panel of slice 5.3, now a widget.
 *
 * The totals arrive summed: the panel this replaces reduced the months in the
 * component, and a figure derived in two places is a figure that disagrees in
 * one of them.
 */
async function EnergyCostsCard({ widget }: { widget: DashboardWidget }): Promise<React.ReactElement> {
  const t = await getTranslations();
  const locale = await getLocale();
  const format = await getFormatter();
  const data = widget.data as EnergyCostsWidgetData | null;

  return (
    <WidgetCard
      widget={widget}
      title={t('energy.costs.title')}
      href="/dashboard/energy"
      linkLabel={t('energy.costs.open')}
      emptyMessage={t('dashboard.widget.energy.empty')}
    >
      {data !== null && (
        <>
          <p className="text-sm text-foreground-muted">
            {t('energy.costs.summary', {
              total: `${centsToText(data.totalCents)} €`,
              kwh: format.number(data.kwh, { maximumFractionDigits: 0 }),
              bills: data.billCount,
            })}
          </p>

          <ConsumptionBars
            monthly={data.months.map((m) => ({
              month: m.month,
              consumed: m.totalCents === null ? null : m.totalCents / 100,
            }))}
            unit="€"
            locale={locale}
            money
          />

          {data.latest !== null && (
            <p className="text-sm">
              {t('energy.costs.latest', {
                supplier: data.latest.supplier,
                meter: data.latest.meterName,
                from: formatDate(data.latest.periodStart),
                to: formatDate(data.latest.periodEnd),
                total: `${centsToText(data.latest.totalCents)} €`,
                perKwh:
                  data.latest.kwh > 0
                    ? format.number(data.latest.totalCents / 100 / data.latest.kwh, {
                        maximumFractionDigits: 3,
                      })
                    : '—',
              })}
            </p>
          )}
        </>
      )}
    </WidgetCard>
  );
}

/* -------------------------------------------------------------------------- */
/* The management band's aggregates — slice 2b                                */
/* -------------------------------------------------------------------------- */

/** The selected site's own page, or every site — where a site-scoped card links. */
function siteHref(scope: DashboardScope, tab?: string): string {
  if (scope.mode === 'facility' && scope.facilityId !== null) {
    return `/dashboard/facilities/${scope.facilityId}${tab === undefined ? '' : `?tab=${tab}`}`;
  }
  return '/dashboard/facilities';
}

/**
 * Mensalidades in their current period. The figure that matters is in bold:
 * what is overdue when anything is, otherwise what is still to pay.
 */
async function MoneyCard({ widget }: { widget: DashboardWidget }): Promise<React.ReactElement> {
  const t = await getTranslations();
  const locale = await getLocale();
  const data = widget.data as MoneyWidgetData | null;
  const late = (data?.overdueCents ?? 0) > 0;

  const row = (label: string, cents: number, strong: boolean): React.ReactElement => (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-sm text-foreground-muted">{label}</dt>
      <dd className={cn('tabular-nums', strong ? 'text-lg font-semibold' : 'text-sm')}>
        {formatCents(locale, cents)}
      </dd>
    </div>
  );

  return (
    <WidgetCard
      widget={widget}
      title={t('dashboard.widget.money.title')}
      href="/dashboard/faturacao"
      linkLabel={t('dashboard.widget.money.open')}
      emptyMessage={t('dashboard.widget.money.empty')}
    >
      {data !== null && (
        <>
          <dl className="flex flex-col gap-1">
            {row(t('dashboard.widget.money.paid'), data.paidCents, false)}
            {row(t('dashboard.widget.money.due'), data.dueCents, !late)}
            {row(t('dashboard.widget.money.overdue'), data.overdueCents, late)}
          </dl>
          <p className="text-sm text-foreground-muted">
            {t('dashboard.widget.money.students', {
              students: data.students,
              overdue: data.studentsOverdue,
            })}
          </p>
        </>
      )}
    </WidgetCard>
  );
}

/** Today's classes, who is in them, and what nobody is teaching. */
async function OccupancyTodayCard({
  widget,
}: {
  widget: DashboardWidget;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const data = widget.data as OccupancyTodayWidgetData | null;

  return (
    <WidgetCard
      widget={widget}
      title={t('dashboard.widget.today.title')}
      href="/dashboard/calendar"
      linkLabel={t('dashboard.widget.today.open')}
      emptyMessage={t('dashboard.widget.today.empty')}
    >
      {data !== null && (
        <>
          <p className="text-lg font-medium">
            {t('dashboard.widget.today.classes', {
              classes: data.classes,
              swimmers: data.swimmers,
            })}
          </p>

          {/* An icon and the words, never the colour alone. */}
          {data.withoutInstructor > 0 && (
            <p className="flex items-center gap-1.5 text-sm text-warning">
              <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
              {t('dashboard.widget.today.withoutInstructor', { count: data.withoutInstructor })}
            </p>
          )}

          {data.peak !== null && (
            <p className="text-sm text-foreground-muted">
              {data.peak.capacity === null
                ? t('dashboard.widget.today.peakUnlimited', {
                    pool: data.peak.poolName,
                    swimmers: data.peak.swimmers,
                  })
                : t('dashboard.widget.today.peak', {
                    pool: data.peak.poolName,
                    swimmers: data.peak.swimmers,
                    capacity: data.peak.capacity,
                  })}
            </p>
          )}
        </>
      )}
    </WidgetCard>
  );
}

/** Tanks out of range or due an analysis — each named, each a link. */
async function WaterCard({
  widget,
  scope,
}: {
  widget: DashboardWidget;
  scope: DashboardScope;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const data = widget.data as WaterWidgetData | null;

  return (
    <WidgetCard
      widget={widget}
      title={t('facilities.readings')}
      href={siteHref(scope)}
      linkLabel={t('dashboard.widget.water.open')}
      emptyMessage={t('dashboard.widget.water.empty')}
    >
      {data !== null && (
        <>
          <p className="text-sm text-foreground-muted">
            {t('dashboard.widget.water.summary', {
              flagged: data.flagged.length,
              tanks: data.tanks,
            })}
          </p>
          <ul className="flex flex-col gap-2">
            {data.flagged.map((pool) => (
              <li key={pool.poolId} className="flex flex-col gap-0.5 text-sm">
                <Link
                  href={withFrom(`/dashboard/facilities/pools/${pool.poolId}?tab=water`, '/dashboard')}
                  className="font-medium hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  {pool.poolName}
                </Link>
                {pool.outOfRange.length > 0 && (
                  <span className="flex items-center gap-1.5 text-danger">
                    <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
                    {t('dashboard.widget.water.outOfRange', {
                      metrics: pool.outOfRange
                        .map((metric) => t(`facilities.metric.${metric}`))
                        .join(', '),
                    })}
                  </span>
                )}
                {pool.due && (
                  <span className="flex items-center gap-1.5 text-warning">
                    <CalendarClock className="size-3.5 shrink-0" aria-hidden="true" />
                    {pool.takenAt === null
                      ? t('dashboard.widget.water.never')
                      : t('dashboard.widget.water.due', { on: formatDate(pool.takenAt) })}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </WidgetCard>
  );
}

/** Open avarias and reposições by severity, and rooms overdue for cleaning. */
async function MaintenanceCard({
  widget,
  scope,
}: {
  widget: DashboardWidget;
  scope: DashboardScope;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const data = widget.data as MaintenanceWidgetData | null;

  const kinds = (['fault', 'restock'] as const).map((type) => {
    const groups = data?.open.filter((group) => group.type === type) ?? [];
    return {
      type,
      total: groups.reduce((sum, group) => sum + group.count, 0),
      // Highest severity first, each said as a word.
      split: (['high', 'normal', 'low'] as const)
        .map((severity) => ({
          severity,
          count: groups.find((group) => group.severity === severity)?.count ?? 0,
        }))
        .filter((part) => part.count > 0),
    };
  });

  return (
    <WidgetCard
      widget={widget}
      title={t('maintenance.section')}
      href={siteHref(scope, 'spaces')}
      linkLabel={t('dashboard.widget.maintenance.open')}
      emptyMessage={t('dashboard.widget.maintenance.empty')}
    >
      {data !== null && (
        <ul className="flex flex-col gap-1.5 text-sm">
          {kinds
            .filter((kind) => kind.total > 0)
            .map((kind) => (
              <li key={kind.type}>
                <span className="font-medium">
                  {t(`dashboard.widget.maintenance.${kind.type}`, { count: kind.total })}
                </span>{' '}
                <span className="text-foreground-muted">
                  (
                  {kind.split
                    .map((part) =>
                      t('dashboard.widget.maintenance.split', {
                        count: part.count,
                        severity: t(`spaces.severity.${part.severity}`),
                      }),
                    )
                    .join(', ')}
                  )
                </span>
              </li>
            ))}
          {data.overdueCleanings > 0 && (
            <li className="flex items-center gap-1.5 text-warning">
              <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
              {t('dashboard.widget.maintenance.overdue', { count: data.overdueCleanings })}
            </li>
          )}
        </ul>
      )}
    </WidgetCard>
  );
}

/** The club's people. Club-wide, and the card says so. */
async function PeopleCard({ widget }: { widget: DashboardWidget }): Promise<React.ReactElement> {
  const t = await getTranslations();
  const data = widget.data as PeopleWidgetData | null;
  const roles = ['owner', 'admin', 'instructor', 'maintenance', 'guardian'] as const;

  return (
    <WidgetCard
      widget={widget}
      title={t('facilities.people')}
      href="/dashboard/facilities/staff"
      linkLabel={t('dashboard.widget.people.open')}
      emptyMessage={t('dashboard.widget.people.empty')}
    >
      {data !== null && (
        <>
          <p className="text-lg font-medium">
            {t('dashboard.widget.people.summary', { students: data.students, staff: data.staff })}
          </p>
          <p className="text-sm text-foreground-muted">
            {roles
              .filter((role) => data.byRole[role] > 0)
              .map((role) => `${t(`roles.${role}`)} ${data.byRole[role]}`)
              .join(' · ')}
          </p>
          {data.expiringInvitations > 0 && (
            <p className="flex items-center gap-1.5 text-sm text-warning">
              <CalendarClock className="size-3.5 shrink-0" aria-hidden="true" />
              {t('dashboard.widget.people.expiring', { count: data.expiringInvitations })}
            </p>
          )}
          <p className="text-xs text-foreground-muted">{t('dashboard.widget.clubWide')}</p>
        </>
      )}
    </WidgetCard>
  );
}

/**
 * Qualifications âmbar, vermelho or em falta — POOLSE-27, 7b.2. The counts in
 * words, then the most urgent few, each with its own status and date.
 */
async function QualificationsCard({
  widget,
}: {
  widget: DashboardWidget;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const data = widget.data as QualificationsWidgetData | null;

  return (
    <WidgetCard
      widget={widget}
      title={t('qualifications.title')}
      href="/dashboard/facilities/staff/qualifications"
      linkLabel={t('dashboard.widget.qualifications.open')}
      emptyMessage={t('dashboard.widget.qualifications.empty')}
    >
      {data !== null && (
        <>
          <p className="text-sm">
            {t('dashboard.widget.qualifications.summary', {
              red: data.red,
              amber: data.amber,
              missing: data.missing,
            })}
          </p>
          <ul className="flex flex-col gap-1.5">
            {data.top.map((row) => (
              <li
                key={`${row.membershipId}-${row.typeId}`}
                className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-sm"
              >
                <span className="min-w-0 truncate">
                  {row.personName ?? t('qualifications.unnamed')} · {row.typeName}
                </span>
                <QualificationStatus status={row.status} expiresOn={row.expiresOn} />
              </li>
            ))}
          </ul>
        </>
      )}
    </WidgetCard>
  );
}

/** What the staff cost a month — Salários' figure, with its coverage said. */
async function StaffCostCard({ widget }: { widget: DashboardWidget }): Promise<React.ReactElement> {
  const t = await getTranslations();
  const locale = await getLocale();
  const data = widget.data as StaffCostWidgetData | null;

  return (
    <WidgetCard
      widget={widget}
      title={t('dashboard.widget.staffcost.title')}
      href="/dashboard/facilities/staff/salaries"
      linkLabel={t('dashboard.widget.staffcost.open')}
      emptyMessage={t('dashboard.widget.staffcost.empty')}
    >
      {data !== null && (
        <>
          <p>
            <span className="text-lg font-semibold tabular-nums">
              {formatCents(locale, data.thisMonthCents)}
            </span>{' '}
            <span className="text-sm text-foreground-muted">{t('salaries.thisMonth')}</span>
          </p>
          {/* Coverage in words — an unqualified total over partial data looks complete. */}
          <p className="text-sm text-foreground-muted">
            {data.complete
              ? t('salaries.coverageComplete', { total: data.coverage.total })
              : t('salaries.coverage', {
                  withRate: data.coverage.withRate,
                  total: data.coverage.total,
                })}
          </p>
          {data.ownerExcluded && (
            <p className="text-sm text-foreground-muted">{t('salaries.ownerExcluded')}</p>
          )}
          <p className="text-xs text-foreground-muted">{t('dashboard.widget.clubWide')}</p>
        </>
      )}
    </WidgetCard>
  );
}
