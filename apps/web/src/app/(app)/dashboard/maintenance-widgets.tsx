import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { AlertTriangle, CalendarClock, PackageOpen, Search, Wrench } from 'lucide-react';
import type {
  DashboardWidget,
  FaultsWidgetData,
  InventoryWatchWidgetData,
  OverdueSpacesWidgetData,
  WaterWidgetData,
} from '@/lib/api';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/date-format';
import { timeAgo } from '@/lib/relative-time';
import { withFrom } from '@/lib/back';
import { WidgetCard } from './widget-card';
import { QuickCleanButton } from './quick-clean-button';

/**
 * The maintenance band's cards — POOLSE-66, slice 4.
 *
 * Every card reads the sites the reader works at, never the management
 * selector, and links to the screen that does the job. Two of them do the job
 * in place: a room is marked clean from the card, and a tank due a reading
 * opens its own water tab with the form. No amount appears anywhere.
 */

const LINK =
  'font-medium hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/** Severity as a word with a tone, never the colour alone. */
const SEVERITY_TONE: Record<'low' | 'normal' | 'high', string> = {
  high: 'bg-danger/10 text-danger',
  normal: 'bg-warning/10 text-warning',
  low: 'bg-foreground-muted/10 text-foreground-muted',
};

/** Open avarias at my sites, worst first — the ones I reported marked. */
export async function FaultsCard({ widget }: { widget: DashboardWidget }): Promise<React.ReactElement> {
  const t = await getTranslations();
  const locale = await getLocale();
  const data = widget.data as FaultsWidgetData | null;

  return (
    <WidgetCard
      widget={widget}
      title={t('dashboard.widget.faults.title')}
      href="/dashboard/facilities"
      linkLabel={t('dashboard.widget.faults.open')}
      emptyMessage={t('dashboard.widget.faults.empty')}
    >
      {data !== null && (
        <>
          <p className="text-sm text-foreground-muted">
            {t('dashboard.widget.faults.summary', { total: data.total, high: data.high })}
          </p>
          <ul className="flex flex-col divide-y divide-border rounded border border-border">
            {data.faults.map((fault) => {
              const where = fault.spaceName ?? fault.poolName ?? fault.facilityName;
              const href =
                fault.spaceId !== null
                  ? `/dashboard/facilities/spaces/${fault.spaceId}?tab=issues`
                  : fault.poolId !== null
                    ? `/dashboard/facilities/pools/${fault.poolId}`
                    : `/dashboard/facilities/${fault.facilityId}?tab=spaces`;
              return (
                <li key={fault.id} className="flex flex-col gap-1 p-3 text-sm">
                  <span className="flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium',
                        SEVERITY_TONE[fault.severity],
                      )}
                    >
                      <Wrench className="size-3.5" aria-hidden="true" />
                      {t('spaces.severity.chip', { severity: t(`spaces.severity.${fault.severity}`) })}
                    </span>
                    <Link href={withFrom(href, '/dashboard')} className={LINK}>
                      {fault.description}
                    </Link>
                  </span>
                  <span className="text-foreground-muted">
                    {where} · {timeAgo(fault.reportedAt, locale)}
                    {fault.mine && ` · ${t('dashboard.widget.faults.mine')}`}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </WidgetCard>
  );
}

/** Rooms past their cleaning interval, each with the one press that fixes it. */
export async function OverdueCleaningsCard({
  widget,
}: {
  widget: DashboardWidget;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const locale = await getLocale();
  const data = widget.data as OverdueSpacesWidgetData | null;

  return (
    <WidgetCard
      widget={widget}
      title={t('dashboard.widget.cleanings.title')}
      href="/dashboard/facilities"
      linkLabel={t('dashboard.widget.cleanings.open')}
      emptyMessage={t('dashboard.widget.cleanings.empty')}
    >
      {data !== null && (
        <>
          <ul className="flex flex-col gap-2 text-sm">
            {data.spaces.map((space) => (
              <li key={space.id} className="flex items-start justify-between gap-3">
                <span className="flex flex-col">
                  <Link
                    href={withFrom(`/dashboard/facilities/spaces/${space.id}`, '/dashboard')}
                    className={LINK}
                  >
                    {space.name}
                  </Link>
                  <span className="flex items-center gap-1 text-xs text-warning">
                    <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
                    {space.lastCleanedAt === null
                      ? t('dashboard.widget.cleanings.never')
                      : t('spaces.cleanedAgo', { ago: timeAgo(space.lastCleanedAt, locale) ?? '' })}
                  </span>
                </span>
                <QuickCleanButton
                  spaceId={space.id}
                  facilityId={space.facilityId}
                  name={space.name}
                />
              </li>
            ))}
          </ul>
          {data.total > data.spaces.length && (
            <p className="text-xs text-foreground-muted">
              {t('dashboard.widget.more', { count: data.total - data.spaces.length })}
            </p>
          )}
        </>
      )}
    </WidgetCard>
  );
}

/** Tanks due a reading or out of range, each opening its own water tab. */
export async function WaterDueCard({ widget }: { widget: DashboardWidget }): Promise<React.ReactElement> {
  const t = await getTranslations();
  const data = widget.data as WaterWidgetData | null;

  return (
    <WidgetCard
      widget={widget}
      title={t('dashboard.widget.waterDue.title')}
      href="/dashboard/facilities"
      linkLabel={t('dashboard.widget.waterDue.open')}
      emptyMessage={t('dashboard.widget.water.empty')}
    >
      {data !== null && (
        <ul className="flex flex-col gap-2 text-sm">
          {data.flagged.map((pool) => (
            <li key={pool.poolId} className="flex flex-col gap-0.5">
              <span className="font-medium">{pool.poolName}</span>
              {pool.outOfRange.length > 0 && (
                <span className="flex items-center gap-1.5 text-danger">
                  <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
                  {t('dashboard.widget.water.outOfRange', {
                    metrics: pool.outOfRange.map((metric) => t(`facilities.metric.${metric}`)).join(', '),
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
              <Link
                href={withFrom(`/dashboard/facilities/pools/${pool.poolId}?tab=water`, '/dashboard')}
                className="self-start text-sm text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                {t('dashboard.widget.waterDue.record')}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  );
}

/** Open reposições, and lost property found this week and not yet returned. */
export async function InventoryWatchCard({
  widget,
}: {
  widget: DashboardWidget;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const data = widget.data as InventoryWatchWidgetData | null;

  return (
    <WidgetCard
      widget={widget}
      title={t('dashboard.widget.store.title')}
      href="/dashboard/facilities/inventory"
      linkLabel={t('dashboard.widget.store.open')}
      emptyMessage={t('dashboard.widget.store.empty')}
    >
      {data !== null && (
        <div className="flex flex-col gap-3 text-sm">
          {data.restockTotal > 0 && (
            <div className="flex flex-col gap-1">
              <p className="flex items-center gap-1.5 font-medium">
                <PackageOpen className="size-4 shrink-0" aria-hidden="true" />
                {t('dashboard.widget.store.restocks', { count: data.restockTotal })}
              </p>
              <ul className="flex flex-col gap-0.5 pl-6 text-foreground-muted">
                {data.restocks.map((restock) => (
                  <li key={restock.id}>
                    {restock.itemName === null
                      ? restock.description
                      : `${restock.itemName} — ${restock.description}`}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {data.lostTotal > 0 && (
            <div className="flex flex-col gap-1">
              <p className="flex items-center gap-1.5 font-medium">
                <Search className="size-4 shrink-0" aria-hidden="true" />
                {t('dashboard.widget.store.lost', { count: data.lostTotal })}
              </p>
              <ul className="flex flex-col gap-0.5 pl-6 text-foreground-muted">
                {data.lost.map((item) => (
                  <li key={item.id}>
                    {item.description} · {formatDate(item.foundOn)}
                    {item.locationFound !== null && ` · ${item.locationFound}`}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </WidgetCard>
  );
}
