import { getTranslations } from 'next-intl/server';
import { Building2, Plus } from 'lucide-react';
import { BASE_SPORT, type PoolseSport } from '@poolse/rules';
import { ApiError, apiFetch, type Facilities, type FacilityDetail, type Me } from '@/lib/api';
import { EntityIcon } from '@/components/entity-icon';
import { PoolClosureNote } from '@/components/pool-closure-note';
import { AttentionDot } from '@/components/attention-dot';
import { FromLink } from '@/components/from-link';
import { LinkBusy } from '@/components/link-busy';
import { PageEmpty, PageError, PageShell } from '@/components/page-shell';
import { readAttention } from '@/lib/attention';
import { backProp, originBack } from '@/lib/back';
import { describeLoad } from '@/lib/load-failure';
import { sportNameKey } from '@/components/sport-icon';
import { RecintosPanel } from '../facilities/[facilityId]/recintos-panel';

/** The word a sport's recintos go by — POOLSE-150, the menu's own. */
function titleKey(sport: PoolseSport): string {
  if (sport === BASE_SPORT) return 'recintos.nav.pool';
  if (sport === 'gym') return 'recintos.nav.rooms';
  return 'recintos.nav.courts';
}

const ADD =
  'inline-flex h-control items-center justify-center gap-2 rounded-sm bg-surface px-4 text-control shadow-card hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/**
 * A sport's recintos — POOLSE-150 (Rui, 02-11-2026). The tanks under Natação,
 * a court sport's courts under it: listed, added and opened here, in the
 * sport's section, rather than on the site page, which now links here.
 *
 * **Grouped by site** when the club has more than one (Rui); a single-site club
 * reads a plain list. A tank opens its own page, unchanged. Another sport's
 * recintos are each site's own read (`/facilities/:id`), whose roles are the
 * site page's, so a reader that page refuses sees the list say so.
 */
export default async function RecintosPage({
  searchParams,
}: {
  searchParams: Promise<{ sport?: string; from?: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const { sport: asked, from } = await searchParams;
  const me = await apiFetch<Me>('/me').catch(() => null);
  const clubSports = me?.memberships[0]?.sports ?? [BASE_SPORT];
  const sport: PoolseSport = clubSports.find((one) => one === asked) ?? clubSports[0] ?? BASE_SPORT;
  const back = originBack(from);
  const title = t(titleKey(sport));

  let sites: Facilities;
  try {
    sites = await apiFetch<Facilities>('/facilities');
  } catch (error) {
    const failure = describeLoad(error);
    return (
      <PageShell title={title} back={backProp(back, t)}>
        <PageError message={t(failure.key)} {...(failure.detail === '' ? {} : { detail: failure.detail })} />
      </PageShell>
    );
  }
  const manyPlaces = sites.facilities.length > 1;
  const canManage = sites.canManage;

  if (sites.facilities.length === 0) {
    return (
      <PageShell title={title} back={backProp(back, t)}>
        <PageEmpty icon={Building2} message={t('recintos.page.noSites')} hint={t('recintos.page.noSitesHint')} />
      </PageShell>
    );
  }

  if (sport === BASE_SPORT) {
    const attention = await readAttention();
    const total = sites.facilities.reduce((sum, site) => sum + site.pools.length, 0);
    return (
      <PageShell title={title} subtitle={t('recintos.page.poolSubtitle')} back={backProp(back, t)}>
        <div className="flex flex-col gap-page-gap">
          {sites.facilities.map((site) => (
            <section key={site.id} className="flex flex-col gap-4 rounded bg-surface p-5 shadow-card">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
                  {manyPlaces ? site.name : t('recintos.nav.pool')}
                </h2>
                {canManage && (
                  <FromLink href={`/dashboard/facilities/pools/new?facilityId=${site.id}`} className={ADD}>
                    <Plus aria-hidden className="size-4" />
                    {t('recintos.page.addPool')}
                    <LinkBusy />
                  </FromLink>
                )}
              </div>
              {site.pools.length === 0 ? (
                <p className="text-sm text-foreground-muted">{t('facilities.noPools')}</p>
              ) : (
                <ul className="flex flex-col divide-y divide-border">
                  {site.pools.map((pool) => (
                    <li key={pool.id} className="py-3 first:pt-0 last:pb-0">
                      <FromLink
                        href={`/dashboard/facilities/pools/${pool.id}`}
                        className="flex items-center gap-3 rounded hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                      >
                        <EntityIcon kind="pool" />
                        <span className="font-medium">{pool.name}</span>
                        <AttentionDot
                          count={attention.pools[pool.id]}
                          label={t('attention.dot', { count: attention.pools[pool.id] ?? 0 })}
                        />
                        <span className="text-sm text-foreground-muted">{t(`facilities.kind.${pool.kind}`)}</span>
                      </FromLink>
                      <PoolClosureNote closure={pool.closure} className="mt-1" />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
          {total === 0 && !canManage && <p className="text-sm text-foreground-muted">{t('facilities.noPools')}</p>}
        </div>
      </PageShell>
    );
  }

  /*
   * Another sport: each site's recintos of it, from the site's own read, in the
   * site page's own panel (add, rename, archive), narrowed to this sport.
   */
  const perSite = await Promise.all(
    sites.facilities.map((site) =>
      apiFetch<FacilityDetail>(`/facilities/${site.id}`).then(
        (detail) => ({ site, areas: detail.playingAreas.filter((area) => area.sportId === sport), refused: false }),
        (error: unknown) => {
          if (error instanceof ApiError && error.status === 403) return { site, areas: [], refused: true };
          throw error;
        },
      ),
    ),
  );

  return (
    <PageShell
      title={title}
      subtitle={t('recintos.page.courtSubtitle', { sport: t(sportNameKey(sport)) })}
      back={backProp(back, t)}
    >
      <div className="flex flex-col gap-page-gap">
        {perSite.map(({ site, areas, refused }) => (
          <div key={site.id} className="flex flex-col gap-3">
            {manyPlaces && (
              <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">{site.name}</h2>
            )}
            {refused ? (
              <p className="text-sm text-foreground-muted">{t('recintos.page.notYours')}</p>
            ) : (
              <RecintosPanel facilityId={site.id} areas={areas} sports={[sport]} />
            )}
          </div>
        ))}
      </div>
    </PageShell>
  );
}
