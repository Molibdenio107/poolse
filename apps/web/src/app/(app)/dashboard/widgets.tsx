import Link from 'next/link';
import { getFormatter, getLocale, getTranslations } from 'next-intl/server';
import { AlertTriangle, CalendarClock, Check, Circle } from 'lucide-react';
import type {
  ChecklistWidgetData,
  DashboardWidget,
  EnergyCostsWidgetData,
  SubscriptionWidgetData,
  TasksWidgetData,
} from '@/lib/api';
import { ConsumptionBars } from '@/components/consumption-bars';
import { centsToText } from '@/lib/energy-invoice';
import { formatDate } from '@/lib/date-format';
import { withFrom } from '@/lib/back';
import { WidgetCard } from './widget-card';

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
export async function renderWidget(widget: DashboardWidget): Promise<React.ReactElement | null> {
  switch (widget.id) {
    case 'mgmt.subscription':
      return <SubscriptionCard widget={widget} />;
    case 'mgmt.energy.costs':
      return <EnergyCostsCard widget={widget} />;
    case 'maint.mytasks':
      return <TasksCard widget={widget} />;
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

  return (
    <WidgetCard
      widget={widget}
      title={t('maintenance.mine')}
      href="/dashboard/facilities/tasks"
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
