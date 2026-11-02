import { getLocale, getTranslations } from 'next-intl/server';
import { isMultiSport, type PoolseSport } from '@poolse/rules';
import { FromLink } from '@/components/from-link';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { sportNameKey } from '@/components/sport-icon';
import { SportChip } from '@/components/sport-chip';
import { apiFetch } from '@/lib/api';
import type {
  CollectedWidgetData,
  InsightsWidgetData,
  Me,
  DashboardWidget,
  OccupancyTodayWidgetData,
  RecintosWidgetData,
} from '@/lib/api';
import { formatCents } from '@/lib/money';
import { formatReading } from '@/lib/pool-metrics';
import { TodayRow } from './today-row';
import { cn } from '@/lib/utils';

/**
 * The summary on top of the dashboard — multi-sport Slice 2 (Rui, 01-11-2026),
 * the handoff's *01 Dashboard*: a row of four figures, then today hour by hour
 * beside the tanks as they are now. The cards below are unchanged.
 *
 * Every figure is a widget's own (`sum.today`, `sum.collected`, `sum.recintos`)
 * — the same reads the cards use, never a second definition — and a widget the
 * reader may not see or the club has switched off is simply absent, as in every
 * band. The handoff's insight cards wait for the AI and draw nothing until then:
 * an empty box would say "nothing deserves attention", which is not known.
 *
 * Colour never carries a figure alone: each tile's line says it in words, a
 * chart bar has its value in a list beside it, and a tank's state is a badge.
 */

export async function SummaryBand({ widgets }: { widgets: DashboardWidget[] }): Promise<React.ReactElement> {
  const t = await getTranslations();
  const locale = await getLocale();
  // The club's sports, to split today's lessons by sport only where there are
  // two — the layout's own `/me`, which Next answers once per render.
  const sports: readonly PoolseSport[] = await apiFetch<Me>('/me').then(
    (me) => me.memberships[0]?.sports ?? [],
    () => [],
  );
  const find = (id: string): DashboardWidget | undefined => widgets.find((w) => w.id === id);
  const todayWidget = find('sum.today');
  const collectedWidget = find('sum.collected');
  const recintosWidget = find('sum.recintos');
  const today = todayWidget?.state === 'ok' ? (todayWidget.data as OccupancyTodayWidgetData) : null;
  const collected = collectedWidget?.state === 'ok' ? (collectedWidget.data as CollectedWidgetData) : null;
  const recintos = recintosWidget?.state === 'ok' ? (recintosWidget.data as RecintosWidgetData) : null;
  // Nothing until the AI writes some — never an empty box (see `summaryInsights`).
  const insightsWidget = find('sum.insights');
  const insights = insightsWidget?.state === 'ok' ? (insightsWidget.data as InsightsWidgetData).insights : [];
  const failed = t('dashboard.widgetFailed');

  return (
    <div className="flex flex-col gap-page-gap">
      {insights.length > 0 && (
        <div className="grid grid-cols-1 gap-page-gap lg:grid-cols-3">
          {insights.map((insight) => (
            <section key={insight.headline} className="flex flex-col gap-2 rounded bg-surface p-5 shadow-card">
              <span className="flex flex-wrap items-center gap-2">
                <Badge tone="pending">{t(`dashboard.summary.category.${insight.category}`)}</Badge>
                {insight.sport !== null && isMultiSport(sports) && <SportChip sport={insight.sport} />}
              </span>
              <h3 className="font-heading text-[19px] font-semibold leading-snug">{insight.headline}</h3>
              <p className="text-[13px] text-foreground-muted">{insight.body}</p>
              <FromLink
                href={insight.href}
                className={cn(
                  'mt-auto inline-flex h-control items-center justify-center self-start rounded-sm px-4 text-control',
                  insight.recommended
                    ? 'bg-primary font-semibold text-primary-foreground'
                    : 'bg-surface text-foreground shadow-card hover:bg-surface-muted',
                )}
              >
                {insight.actionLabel}
              </FromLink>
            </section>
          ))}
        </div>
      )}
      {/* The KPI row. */}
      <div className="grid grid-cols-2 gap-page-gap lg:grid-cols-4">
        {todayWidget !== undefined && (
          <>
            <Tile
              label={t('dashboard.summary.lessons')}
              value={todayWidget.state === 'error' ? '—' : String(today?.classes ?? 0)}
              href="/dashboard/calendar"
              sub={
                todayWidget.state === 'error'
                  ? { text: failed, tone: 'muted' }
                  : today === null
                    ? { text: t('dashboard.summary.noLessons'), tone: 'muted' }
                    : isMultiSport(sports) && today.bySport.length > 0
                      ? {
                          text: today.bySport.map((s) => `${t(sportNameKey(s.sport))} ${s.count}`).join(' · '),
                          tone: 'muted',
                        }
                      : { text: t('dashboard.summary.lessonsDone', { done: today.done }), tone: 'muted' }
              }
            />
            <Tile
              label={t('dashboard.summary.attendance')}
              value={today === null || today.marked === 0 ? '—' : String(today.present)}
              href="/dashboard/calendar"
              sub={
                today === null || today.expectedSoFar === 0
                  ? { text: t('dashboard.summary.attendanceNotYet'), tone: 'muted' }
                  : today.marked === 0
                    ? { text: t('dashboard.summary.attendanceUnmarked', { expected: today.expectedSoFar }), tone: 'late' }
                    : { text: t('dashboard.summary.attendanceOf', { expected: today.expectedSoFar }), tone: 'ok' }
              }
            />
          </>
        )}
        {collectedWidget !== undefined && (
          <Tile
            label={t('dashboard.summary.collected')}
            value={collected === null ? '—' : formatCents(locale, collected.cents)}
            href="/dashboard/faturacao"
            sub={
              collected === null
                ? { text: failed, tone: 'muted' }
                : { text: t('dashboard.summary.payments', { count: collected.payments }), tone: 'muted' }
            }
          />
        )}
        {todayWidget !== undefined && (
          <Tile
            label={t('dashboard.summary.noInstructor')}
            value={today === null ? '0' : String(today.withoutInstructor)}
            href="/dashboard/calendar"
            sub={
              today !== null && today.withoutInstructor > 0
                ? { text: t('dashboard.summary.noInstructorToday'), tone: 'late' }
                : { text: t('dashboard.summary.allCovered'), tone: 'ok' }
            }
          />
        )}
      </div>

      {(todayWidget !== undefined || recintosWidget !== undefined) && (
        <TodayRow
          today={today}
          todayShown={todayWidget !== undefined}
          todayFailed={todayWidget?.state === 'error'}
          recintos={recintos}
          recintosShown={recintosWidget !== undefined}
          recintosFailed={recintosWidget?.state === 'error'}
        />
      )}
    </div>
  );
}



/** A figure, its name and a line saying what it means — the handoff's KPI tile. */
function Tile({
  label,
  value,
  sub,
  href,
}: {
  label: string;
  value: string;
  sub: { text: string; tone: 'ok' | 'late' | 'muted' };
  href: string;
}): React.ReactElement {
  return (
    <FromLink
      href={href}
      className="flex flex-col gap-1 rounded bg-surface p-4 shadow-card hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
    >
      <span className="text-xs text-foreground-muted">{label}</span>
      <span className="font-heading text-[30px] font-semibold leading-tight tabular-nums">{value}</span>
      <span
        className={cn(
          'text-xs',
          sub.tone === 'ok' ? 'text-success' : sub.tone === 'late' ? 'text-warning' : 'text-foreground-muted',
        )}
      >
        {sub.text}
      </span>
    </FromLink>
  );
}

