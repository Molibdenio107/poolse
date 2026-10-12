import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ChevronLeft, ChevronRight, TriangleAlert } from 'lucide-react';
import { apiFetch, type Facilities, type LifeguardDuty, type RosterGap } from '@/lib/api';
import { outcome } from '@/lib/load-failure';
import { APP_TIME_ZONE, formatDate, formatTime, wallClockNow } from '@/lib/date-format';
import { addDays, isDate, isoWeekday, mondayOf, weekOf } from '@/lib/dates';
import { PageEmpty, PageError, PageShell } from '@/components/page-shell';
import { SectionPills, pickSection } from '@/components/section-pills';
import { SiteLinks } from '../incidents/site-links';
import { readRoster } from './roster.actions';
import { AddDuty } from './add-duty';
import { RemoveDuty } from './remove-duty';
import { PeriodsPanel } from './periods';

const QUIET =
  'inline-flex h-control items-center justify-center gap-2 rounded border border-border px-4 text-control hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/**
 * Nadadores-salvadores — POOLSE-70, slice 2.
 *
 * Who is the lifeguard on which tank, a week at a time. One site via `?site=`,
 * as on Ocorrências; one week via `?week=` (any day, read as its Monday); and,
 * where the site has several tanks, **one tank at a time** behind pills — Rui's
 * standing rule that the reader scrolls as little as possible. Seven rows, one a
 * day, each with its duties, its uncovered windows and, for owner and admin, a
 * way to add one.
 *
 * **Two warnings and no gate.** A duty whose person held no valid lifeguard
 * qualification that day, and an open window with nobody on it, are both
 * derived in SQL and said here in words beside an icon. Neither stops a save:
 * a warning about a person never gates what a club does with them.
 *
 * A day with no duties and no gaps is a day the site does not open — the gaps
 * come from the opening hours, so an open day with nobody is a gap the size of
 * the day — and it says "Fechado" rather than nothing.
 */
export default async function LifeguardsPage({
  searchParams,
}: {
  searchParams: Promise<{ site?: string; week?: string; pool?: string; view?: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const { site: requested = '', week, pool: requestedPool, view: requestedView } = await searchParams;

  // Today on the club's wall clock, not the server's — at 00:30 in Lisbon a
  // server on UTC would still be showing yesterday's week.
  const today = wallClockNow(APP_TIME_ZONE).slice(0, 10);
  const monday = mondayOf(isDate(week) ? week : today);
  const days = weekOf(monday);

  const sites = await outcome(apiFetch<Facilities>('/facilities'));
  if (sites.state !== 'ok' || sites.data.facilities.length === 0) {
    return (
      <PageShell title={t('roster.title')}>
        <PageError
          message={t(
            sites.state === 'refused'
              ? 'roster.notPermitted'
              : sites.state === 'failed'
                ? sites.failure.key
                : 'roster.noSites',
          )}
        />
      </PageShell>
    );
  }

  const list = sites.data.facilities;
  const chosen = list.find((site) => site.id === requested.trim()) ?? list[0]!;
  // Two views, one at a time (Rui, 12 October 2026): the week, and the
  // vigilance periods that fill it.
  const view = pickSection(['week', 'periods'], requestedView, 'week');

  // The periods view lists what is still running from today; the week, from its Monday.
  const roster = await readRoster(chosen.id, view === 'periods' ? today : monday);

  const href = (query: { week?: string; pool?: string; view?: string }): string => {
    const params = new URLSearchParams({ site: chosen.id });
    params.set('week', query.week ?? monday);
    if (query.pool !== undefined) params.set('pool', query.pool);
    if ((query.view ?? view) !== 'week') params.set('view', query.view ?? view);
    return `/dashboard/facilities/lifeguards?${params.toString()}`;
  };

  return (
    <PageShell title={t('roster.title')} subtitle={t('roster.subtitle')}>
      <div className="flex flex-col gap-6">
        <SiteLinks
          sites={list}
          chosenId={chosen.id}
          basePath="/dashboard/facilities/lifeguards"
          label={t('roster.sites')}
        />

        {roster.state === 'refused' && <PageError message={t('roster.notPermitted')} />}
        {roster.state === 'failed' && (
          <PageError
            message={t(roster.failure.key)}
            {...(roster.failure.detail === '' ? {} : { detail: roster.failure.detail })}
          />
        )}

        {roster.state === 'ok' && roster.data.pools.length === 0 && (
          <PageEmpty message={t('roster.noPools', { site: chosen.name })} />
        )}

        {roster.state === 'ok' && roster.data.pools.length > 0 && (() => {
          const { pools, duties, gaps, canManage } = roster.data;
          const poolId = pickSection(
            pools.map((pool) => pool.id),
            requestedPool,
            pools[0]!.id,
          );
          // The pool is kept in the week links, so moving a week stays on the tank.
          const weekHref = (to: string): string => href({ week: to, pool: poolId });

          const views = (
            <SectionPills
              items={[
                { key: 'week', label: t('roster.view.week'), href: href({ pool: poolId, view: 'week' }) },
                { key: 'periods', label: t('roster.view.periods'), href: href({ pool: poolId, view: 'periods' }) },
              ]}
              current={view}
              label={t('roster.view.label')}
            />
          );

          if (view === 'periods') {
            return (
              <>
                {views}
                <PeriodsPanel
                  facilityId={chosen.id}
                  pools={pools}
                  periods={roster.data.periods}
                  canManage={canManage}
                  defaultPoolId={poolId}
                  today={today}
                />
              </>
            );
          }

          return (
            <>
              {views}
              <nav
                aria-label={t('roster.weekNav')}
                className="flex flex-wrap items-center gap-2"
              >
                <Link href={weekHref(addDays(monday, -7))} className={QUIET}>
                  <ChevronLeft aria-hidden className="size-4" />
                  {t('roster.previousWeek')}
                </Link>
                <Link href={weekHref(addDays(monday, 7))} className={QUIET}>
                  {t('roster.nextWeek')}
                  <ChevronRight aria-hidden className="size-4" />
                </Link>
                {mondayOf(today) !== monday && (
                  <Link href={weekHref(mondayOf(today))} className={QUIET}>
                    {t('roster.thisWeek')}
                  </Link>
                )}
                <span className="text-sm text-foreground-muted">
                  {t('roster.weekRange', {
                    from: formatDate(monday),
                    to: formatDate(addDays(monday, 6)),
                  })}
                </span>
              </nav>

              <SectionPills
                items={pools.map((pool) => ({
                  key: pool.id,
                  label: pool.name,
                  href: href({ pool: pool.id }),
                }))}
                current={poolId}
                label={t('roster.pools')}
              />

              <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
                <p className="text-sm text-foreground-muted">{t('roster.hint')}</p>
                <ul className="flex flex-col divide-y divide-border">
                  {days.map((day) => (
                    <DayRow
                      key={day}
                      day={day}
                      today={day === today}
                      facilityId={chosen.id}
                      poolId={poolId}
                      duties={duties.filter(
                        (duty) => duty.poolId === poolId && dayOf(duty.startsAt) === day,
                      )}
                      gaps={gaps.filter((gap) => gap.poolId === poolId && gap.day === day)}
                      canManage={canManage}
                    />
                  ))}
                </ul>
              </section>
            </>
          );
        })()}
      </div>
    </PageShell>
  );
}

/** The `YYYY-MM-DD` an instant falls on, on the club's wall clock. */
function dayOf(instant: string): string {
  return wallClockNow(APP_TIME_ZONE, new Date(instant)).slice(0, 10);
}

async function DayRow({
  day,
  today,
  facilityId,
  poolId,
  duties,
  gaps,
  canManage,
}: {
  day: string;
  today: boolean;
  facilityId: string;
  poolId: string;
  duties: LifeguardDuty[];
  gaps: RosterGap[];
  canManage: boolean;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const closed = duties.length === 0 && gaps.length === 0;

  return (
    <li className="flex flex-col gap-2 py-4 first:pt-0 last:pb-0">
      <h2 className="font-medium">
        {t('roster.dayHeading', {
          weekday: t(`week.${isoWeekday(day)}` as never),
          date: formatDate(day),
        })}
        {today && <span className="font-normal text-foreground-muted"> · {t('roster.today')}</span>}
      </h2>

      {closed && <p className="text-sm text-foreground-muted">{t('roster.closed')}</p>}

      {duties.length > 0 && (
        <ul className="flex flex-col gap-2">
          {duties.map((duty) => (
            <li key={duty.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="font-medium">{duty.name ?? t('roster.unknownPerson')}</span>
              {duty.periodId !== null && (
                <span className="text-foreground-muted">{t('roster.fromPeriod')}</span>
              )}
              <span className="tabular-nums">
                {t('roster.dutyTimes', {
                  from: formatTime(duty.startsAt),
                  to: formatTime(duty.endsAt),
                })}
              </span>
              {!duty.licensed && (
                <span className="inline-flex items-center gap-1.5">
                  <TriangleAlert aria-hidden className="size-4 shrink-0 text-warning" />
                  {t('roster.notLicensed')}
                </span>
              )}
              {canManage && (
                <RemoveDuty
                  dutyId={duty.id}
                  description={t('roster.removeHint', {
                    name: duty.name ?? t('roster.unknownPerson'),
                    from: formatTime(duty.startsAt),
                    to: formatTime(duty.endsAt),
                    date: formatDate(day),
                  })}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {gaps.length > 0 && (
        <ul className="flex flex-col gap-1">
          {gaps.map((gap) => (
            <li key={gap.from} className="inline-flex items-center gap-1.5 text-sm">
              <TriangleAlert aria-hidden className="size-4 shrink-0 text-warning" />
              {t('roster.gap', { from: formatTime(gap.from), to: formatTime(gap.to) })}
            </li>
          ))}
        </ul>
      )}

      {canManage && (
        // Keyed by the day's duty count, so a saved duty empties the form.
        <AddDuty
          key={duties.length}
          facilityId={facilityId}
          poolId={poolId}
          day={day}
        />
      )}
    </li>
  );
}
