import { getTranslations } from 'next-intl/server';
import { ChevronRight, Settings, Building2 } from 'lucide-react';
import { BASE_SPORT, type PoolseSport } from '@poolse/rules';
import { describeLoad, type LoadFailure } from '@/lib/load-failure';
import { backProp, originBack } from '@/lib/back';
import { ApiError, apiFetch, type Facilities, type FacilityDetail, type Me } from '../../../../lib/api';
import { FromLink } from '@/components/from-link';
import { LinkBusy } from '@/components/link-busy';
import { SportIcon, sportNameKey } from '@/components/sport-icon';
import { readableSports } from '@/lib/sport-scope';
import { PhotoGallery } from '@/components/photo-gallery';
import { ArchiveButton } from './facility-forms';
import { PageError, PageShell, PageEmpty } from '@/components/page-shell';
import { AttentionDot } from '@/components/attention-dot';
import { readAttention } from '@/lib/attention';

/**
 * Slice 1.1 — an operator sets up their site.
 *
 * The first screen in Poolse that is the product rather than a proof that the
 * plumbing works. Everything in module 1 hangs off what is created here: a class
 * group happens at a pool, attendance is taken at a pool, and a reading in phase
 * 4 belongs to one.
 *
 * **A card per site is the site's identity, its tanks and its photographs** —
 * 12 October 2026, Rui's calls. The espaços block left the card (it made a
 * two-site club a page of balneários) and lives on the site's own tab, one
 * link away, which also drops the per-site `listSpaces` loop this page ran on
 * every visit. The photo gallery went with it and came back the same day.
 *
 * **The tanks left the card for a card per sport above the sites** (Rui,
 * 02-11-2026, after POOLSE-150): each sport the reader works in, its count of
 * recintos across every site, opening that sport's own list, where tanks and
 * courts are added and opened.
 */
export default async function FacilitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  // POOLSE-120: what needs doing at a site and in its tanks, for who can act.
  const attention = await readAttention();
  const back = originBack((await searchParams).from);

  let data: Facilities | null = null;
  let failure: LoadFailure | null = null;
  let noOrganization = false;

  try {
    data = await apiFetch<Facilities>('/facilities');
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) {
      noOrganization = true;
    } else {
      failure = describeLoad(error);
    }
  }

  return (
    <PageShell
      back={backProp(back, t)}
      title={t('facilities.title')}
      subtitle={t('facilities.subtitle')}
    >

      {noOrganization && (
        <section className="rounded bg-surface p-5 shadow-card">
          <p>{t('account.noOrganizations')}</p>
        </section>
      )}

      {failure !== null && (
        <PageError
          message={t(failure.key)}
          {...(failure.detail === '' ? {} : { detail: failure.detail })}
        />
      )}

      {data !== null && (
        <>
          {!data.canManage && (
            <p className="text-sm text-foreground-muted">{t('facilities.readOnly')}</p>
          )}

          {/*
            The plan's ceiling, said rather than discovered — 12 October 2026.
            With the licence full, "Adicionar instalação" led to a form the
            database then refused; now the place where it stood says why it is
            gone and what to do. The trigger is still the control.
          */}
          {data.canManage &&
            (data.maxFacilities !== null && data.facilities.length >= data.maxFacilities ? (
              <p className="text-sm text-foreground-muted">
                {t('facilities.planFull', { max: data.maxFacilities })}
              </p>
            ) : (
              <FromLink
                href="/dashboard/facilities/new"
                className="inline-flex h-control items-center justify-center px-4 text-control gap-2 self-start rounded-sm hover:bg-surface-muted bg-surface shadow-card"
              >
                {t('facilities.addSite')}
              </FromLink>
            ))}

          {data.facilities.length === 0 ? (
            <PageEmpty
              icon={Building2}
              message={t('facilities.none')}
              hint={data.canManage ? t('facilities.noneHintManager') : t('facilities.noneHintMember')}
            />
          ) : (
            data.facilities.map((facility) => (
              <section
                key={facility.id}
                className="flex flex-col gap-4 rounded bg-surface p-5 shadow-card"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-col">
                    {/*
                      The name also opens the site (POOLSE-103 A) — a second way
                      in beside the labelled control, never instead of it.
                    */}
                    <h2 className="flex items-center gap-2 text-lg font-medium">
                      {data.canOpenSite ? (
                        <FromLink
                          href={`/dashboard/facilities/${facility.id}`}
                          className="rounded hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                        >
                          {facility.name}
                        </FromLink>
                      ) : (
                        facility.name
                      )}
                      <AttentionDot
                        count={attention.facilities[facility.id]}
                        label={t('attention.dot', { count: attention.facilities[facility.id] ?? 0 })}
                      />
                    </h2>
                    {/* What is behind the button, so it reads as the place to go. */}
                    {data.canManage && (
                      <span className="text-sm text-foreground-muted">
                        {t('facilities.configureHint')}
                      </span>
                    )}
                    {facility.address !== null && (
                      <span className="text-sm text-foreground-muted">{facility.address}</span>
                    )}
                    <span className="text-sm text-foreground-muted">{facility.timezone}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    {/*
                      Story 2 asks for "a clearly labelled control", not a title
                      that turns out to be clickable. A heading that navigates is
                      a heading half the people reading it never try — so the
                      name's link (POOLSE-103 A) is an extra, and this stays.
                    */}
                    {/*
                      The site's page is where it is configured — hours, prices,
                      tanks, partners, spaces, maintenance, energy — so its door
                      is the page's primary action (Rui, 12 October 2026), not a
                      quiet bordered button beside the archive control.
                      Owner and admin only since 15 October 2026 (Rui): this
                      card is everybody's, configuring the site is not.
                    */}
                    {data.canManage && (
                      <FromLink
                        href={`/dashboard/facilities/${facility.id}`}
                        className="inline-flex h-control items-center justify-center gap-2 rounded-sm bg-primary px-4 text-control font-semibold text-primary-foreground hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                      >
                        <Settings aria-hidden className="size-4" />
                        {t('facilities.configure')}
                      </FromLink>
                    )}
                    {/*
                      Maintenance may open a site's page (Espaços, Manutenção,
                      Energia) but not configure it, and has no Configurar —
                      so a quiet Abrir is its way in, now that the card no
                      longer lists those tabs (POOLSE-92 B, Rui 22-10-2026).
                    */}
                    {data.canOpenSite && !data.canManage && (
                      <FromLink
                        href={`/dashboard/facilities/${facility.id}`}
                        aria-label={t('facilities.openSite', { name: facility.name })}
                        className="inline-flex h-control items-center justify-center gap-2 rounded-sm px-4 text-control hover:border-primary/50 hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary bg-surface shadow-card"
                      >
                        {t('facilities.open')}
                      </FromLink>
                    )}
                    {data.canManage && (
                      <ArchiveButton
                        organizationId={data.organizationId}
                        facilityId={facility.id}
                        poolCount={facility.pools.length}
                      />
                    )}
                  </div>
                </div>

              </section>
            ))
          )}

          {/*
            Rui's order (04-11-2026): setting the site up first, then its
            sports as they are, and only then its photographs.
          */}
          {data.canOpenPools && data.facilities.length > 0 && (
            <SportCards data={data} attention={attention.pools} />
          )}

          {/*
            The site's photographs — Rui, 12 October 2026: the picture of the
            place belongs on this page. Their own card since 04-11-2026, after
            the sports, named by site when the club has more than one.
          */}
          {data.facilities.map((facility) => (
            <section
              key={`photos-${facility.id}`}
              className="flex flex-col gap-3 rounded bg-surface p-5 shadow-card"
            >
              <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
                {data.facilities.length > 1
                  ? `${t('facilities.sitePhotos')} · ${facility.name}`
                  : t('facilities.sitePhotos')}
              </h2>
              <PhotoGallery
                photos={facility.photos}
                target={`facility-photo:${facility.id}`}
                canManage={data.canManage}
                emptyLabel={t('facilities.noSitePhotos')}
                uploadLabel={t('facilities.uploadSitePhoto')}
              />
            </section>
          ))}
        </>
      )}
    </PageShell>
  );
}

/** The word a sport's recintos go by, counted — the menu's own (POOLSE-150). */
function countKey(sport: PoolseSport): string {
  if (sport === BASE_SPORT) return 'facilities.sportCount.pool';
  if (sport === 'gym') return 'facilities.sportCount.rooms';
  return 'facilities.sportCount.courts';
}

/**
 * A card per sport (Rui, 02-11-2026): the sports this reader works in
 * (`readableSports`, POOLSE-145), each with its recintos across every site and
 * a way into its list. A tank count is the list's own; another sport's comes
 * from each site's page read, which only the site's readers get — anybody else
 * sees the card without a number rather than a wrong one. The pool card carries
 * the tanks' attention dot, which the tank rows used to.
 */
async function SportCards({
  data,
  attention,
}: {
  data: Facilities;
  attention: Record<string, number>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const me = await apiFetch<Me>('/me').catch(() => null);
  const membership = me?.memberships[0];
  const sports = membership === undefined ? [BASE_SPORT] : readableSports(membership);
  const others = sports.filter((sport) => sport !== BASE_SPORT);

  const counts = new Map<PoolseSport, number>();
  counts.set(BASE_SPORT, data.facilities.reduce((sum, site) => sum + site.pools.length, 0));
  if (others.length > 0 && data.canOpenSite) {
    const details = await Promise.all(
      data.facilities.map((site) => apiFetch<FacilityDetail>(`/facilities/${site.id}`).catch(() => null)),
    );
    if (details.every((detail) => detail !== null)) {
      for (const sport of others) {
        counts.set(
          sport,
          details.reduce(
            (sum, detail) => sum + (detail?.playingAreas ?? []).filter((area) => area.sportId === sport).length,
            0,
          ),
        );
      }
    }
  }
  const poolAttention = data.facilities
    .flatMap((site) => site.pools)
    .reduce((sum, pool) => sum + (attention[pool.id] ?? 0), 0);

  return (
    <section aria-labelledby="facilities-sports" className="flex flex-col gap-3">
      <h2 id="facilities-sports" className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
        {t('facilities.sports')}
      </h2>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sports.map((sport) => {
          const count = counts.get(sport);
          return (
            <li key={sport} data-sport={sport}>
              <FromLink
                href={`/dashboard/recintos?sport=${sport}`}
                className="group flex h-full items-center gap-4 rounded bg-surface p-5 shadow-card hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                <span
                  aria-hidden
                  className="inline-flex size-11 shrink-0 items-center justify-center rounded-chip bg-[rgb(var(--sport-wash)/0.35)] text-foreground"
                >
                  <SportIcon sport={sport} className="size-5" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex items-center gap-2 text-lg font-medium">
                    {t(sportNameKey(sport))}
                    {sport === BASE_SPORT && (
                      <AttentionDot count={poolAttention} label={t('attention.dot', { count: poolAttention })} />
                    )}
                  </span>
                  <span className="text-sm text-foreground-muted">
                    {count === undefined ? t('facilities.sportOpen') : t(countKey(sport), { count })}
                  </span>
                </span>
                <ChevronRight aria-hidden className="size-5 shrink-0 text-foreground-muted group-hover:text-foreground" />
                <LinkBusy />
              </FromLink>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
