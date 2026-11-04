import { FromLink } from '@/components/from-link';
import { getLocale, getTranslations } from 'next-intl/server';
import { ChevronLeft, ChevronRight, LifeBuoy, Waves } from 'lucide-react';
import { apiFetch, type Facilities, type Me } from '@/lib/api';
import type { PoolseSport } from '@poolse/rules';
import { SportIcon, sportNameKey } from '@/components/sport-icon';
import { readableSports } from '@/lib/sport-scope';
import { outcome } from '@/lib/load-failure';
import { backProp, originBack } from '@/lib/back';
import { APP_TIME_ZONE, formatDateRange, wallClockNow } from '@/lib/date-format';
import { addDays, isDate, mondayOf, weekOf } from '@/lib/dates';
import { PageEmpty, PageError, PageShell } from '@/components/page-shell';
import { SUB_MENU_ROW, SectionPills, pickSection, subMenuPillClass } from '@/components/section-pills';
import { SiteLinks } from '../incidents/site-links';
import { readRoster } from './roster.actions';
import { RosterGrid } from './roster-grid';
import { PeriodsPanel } from './periods';

const QUIET =
  'inline-flex h-control items-center justify-center gap-2 rounded-sm px-4 text-control hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary bg-surface shadow-card';

/**
 * Nadadores-salvadores — POOLSE-70, slice 2.
 *
 * Who is the lifeguard on which tank, a week at a time. One site via `?site=`,
 * as on Ocorrências; one week via `?week=` (any day, read as its Monday); and,
 * where the site has several tanks, **one tank at a time** behind pills — Rui's
 * standing rule that the reader scrolls as little as possible. The week is a
 * grid — days across, hours down, each duty a block placed to the minute —
 * since POOLSE-96 (`roster-grid.tsx`), and its heading is written out in
 * words ("16 a 22 de novembro de 2026"), the one deliberate exception to
 * dd-MM-yyyy (`formatDateRange`).
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
  searchParams: Promise<{
    site?: string;
    week?: string;
    pool?: string;
    view?: string;
    from?: string;
    sport?: string;
  }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const locale = await getLocale();
  const {
    site: requested = '',
    week,
    pool: requestedPool,
    view: requestedView,
    from,
    sport: requestedSport,
  } = await searchParams;
  const back = originBack(from);

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

  /*
   * The sport first — POOLSE-156 (Rui, 04-11-2026). A club with one sport goes
   * straight to it; with several, the week waits for one to be chosen. The
   * reader's own sports only: an instructor of one sport plans that one.
   */
  const me = await apiFetch<Me>('/me').catch(() => null);
  const membership = me?.memberships[0];
  const sports: PoolseSport[] = membership === undefined ? ['pool'] : readableSports(membership);
  const multi = sports.length > 1;
  const sport: PoolseSport | null = multi
    ? (sports.find((one) => one === requestedSport) ?? null)
    : (sports[0] ?? 'pool');
  // Two views, one at a time (Rui, 12 October 2026): the week, and the
  // vigilance periods that fill it.
  const view = pickSection(['week', 'periods'], requestedView, 'week');

  // The periods view lists what is still running from today; the week, from its Monday.
  const roster =
    sport === null ? null : await readRoster(chosen.id, view === 'periods' ? today : monday, sport);

  const href = (query: { week?: string; pool?: string; view?: string; sport?: string }): string => {
    const params = new URLSearchParams({ site: chosen.id });
    const forSport = query.sport ?? sport;
    if (forSport !== null && multi) params.set('sport', forSport);
    params.set('week', query.week ?? monday);
    if (query.pool !== undefined) params.set('pool', query.pool);
    if ((query.view ?? view) !== 'week') params.set('view', query.view ?? view);
    return `/dashboard/facilities/lifeguards?${params.toString()}`;
  };

  return (
    <PageShell title={t('roster.title')} subtitle={t('roster.subtitle')} back={backProp(back, t)}>
      <div className="flex flex-col gap-6">
        <SiteLinks
          sites={list}
          chosenId={chosen.id}
          basePath="/dashboard/facilities/lifeguards"
          label={t('roster.sites')}
        />

        {/*
          Only before a sport is chosen (Rui, 04-11-2026): a pill opens that
          sport's own page, inside its section, where the other sports do not
          belong — the top bar's sport tabs are the way across.
        */}
        {multi && sport === null && (
          <nav aria-label={t('roster.sportNav')} className={SUB_MENU_ROW}>
            {sports.map((one) => (
              <FromLink
                key={one}
                href={href({ sport: one })}
                aria-current={one === sport ? 'page' : undefined}
                className={subMenuPillClass(one === sport)}
              >
                <SportIcon sport={one} className="size-4" />
                {t(sportNameKey(one))}
              </FromLink>
            ))}
          </nav>
        )}
        {roster === null && <p className="text-sm text-foreground-muted">{t('roster.pickSport')}</p>}

        {roster?.state === 'refused' && <PageError message={t('roster.notPermitted')} />}
        {roster?.state === 'failed' && (
          <PageError
            message={t(roster.failure.key)}
            {...(roster.failure.detail === '' ? {} : { detail: roster.failure.detail })}
          />
        )}

        {roster?.state === 'ok' && roster.data.places.length === 0 && (
          <PageEmpty
            icon={roster.data.placeKind === 'pool' ? Waves : LifeBuoy}
            message={
              roster.data.placeKind === 'pool'
                ? t('roster.noPools', { site: chosen.name })
                : t('roster.noRecintos', { site: chosen.name, sport: t(sportNameKey(roster.data.sport)) })
            }
          />
        )}

        {roster?.state === 'ok' && roster.data.places.length > 0 && (() => {
          const { pools, places, placeKind, duties, gaps, canManage } = roster.data;
          // The place shown: a pool for swimming, a recinto otherwise (POOLSE-156).
          const poolId = pickSection(
            places.map((place) => place.id),
            requestedPool,
            places[0]!.id,
          );
          // The pool is kept in the week links, so moving a week stays on the tank.
          const weekHref = (to: string): string => href({ week: to, pool: poolId });

          // Vigilance periods fill a pool's cover; another sport has the week only.
          const views = placeKind !== 'pool' ? null : (
            <SectionPills
              items={[
                { key: 'week', label: t('roster.view.week'), href: href({ pool: poolId, view: 'week' }) },
                { key: 'periods', label: t('roster.view.periods'), href: href({ pool: poolId, view: 'periods' }) },
              ]}
              current={view}
              label={t('roster.view.label')}
            />
          );

          if (view === 'periods' && placeKind === 'pool') {
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
                <FromLink href={weekHref(addDays(monday, -7))} className={QUIET}>
                  <ChevronLeft aria-hidden className="size-4" />
                  {t('roster.previousWeek')}
                </FromLink>
                <FromLink href={weekHref(addDays(monday, 7))} className={QUIET}>
                  {t('roster.nextWeek')}
                  <ChevronRight aria-hidden className="size-4" />
                </FromLink>
                {mondayOf(today) !== monday && (
                  <FromLink href={weekHref(mondayOf(today))} className={QUIET}>
                    {t('roster.thisWeek')}
                  </FromLink>
                )}
                {/* The week in words — POOLSE-96. Intl says the shared month once. */}
                <h2 className="text-sm font-medium">
                  {formatDateRange(monday, addDays(monday, 6), locale)}
                </h2>
              </nav>

              <SectionPills
                items={places.map((place) => ({
                  key: place.id,
                  label: place.name,
                  href: href({ pool: place.id }),
                }))}
                current={poolId}
                label={placeKind === 'pool' ? t('roster.pools') : t('roster.recintos')}
              />
              {/* A court has no required cover: duties, and no gaps (POOLSE-156 rule 3). */}
              {placeKind !== 'pool' && (
                <p className="text-sm text-foreground-muted">{t('roster.noRequiredCover')}</p>
              )}

              <section className="flex flex-col gap-4 rounded bg-surface p-5 shadow-card">
                <RosterGrid
                  // A new week or tank starts on its own today and its own dialogs.
                  key={`${monday}-${poolId}`}
                  days={days}
                  today={today}
                  facilityId={chosen.id}
                  placeKind={placeKind}
                  placeId={poolId}
                  duties={duties.filter((duty) => duty.placeId === poolId)}
                  gaps={gaps.filter((gap) => gap.placeId === poolId)}
                  canManage={canManage}
                />
              </section>
            </>
          );
        })()}
      </div>
    </PageShell>
  );
}
