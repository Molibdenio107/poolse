import { getFormatter, getTranslations } from 'next-intl/server';
import { describeLoad, type LoadFailure } from '@/lib/load-failure';
import { backProp, originBack } from '@/lib/back';
import { ApiError, apiFetch, type Facilities } from '../../../../lib/api';
import { FromLink } from '@/components/from-link';
import { Settings } from 'lucide-react';
import { EntityIcon } from '@/components/entity-icon';
import { PoolClosureNote } from '@/components/pool-closure-note';
import { PhotoGallery } from '@/components/photo-gallery';
import { ArchiveButton } from './facility-forms';
import { PageError, PageShell } from '@/components/page-shell';

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
 */
export default async function FacilitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const back = originBack((await searchParams).from);
  const format = await getFormatter();

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
        <section className="rounded border border-border bg-surface p-5">
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
                className="inline-flex h-control items-center justify-center px-4 text-control gap-2 self-start rounded border border-border hover:bg-surface-muted"
              >
                {t('facilities.addSite')}
              </FromLink>
            ))}

          {data.facilities.length === 0 ? (
            <section className="rounded border border-border bg-surface p-5">
              <p>{t('facilities.none')}</p>
              <p className="mt-1 text-sm text-foreground-muted">
                {data.canManage ? t('facilities.noneHintManager') : t('facilities.noneHintMember')}
              </p>
            </section>
          ) : (
            data.facilities.map((facility) => (
              <section
                key={facility.id}
                className="flex flex-col gap-4 rounded border border-border bg-surface p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-col">
                    {/*
                      The name also opens the site (POOLSE-103 A) — a second way
                      in beside the labelled control, never instead of it.
                    */}
                    <h2 className="text-lg font-medium">
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
                        className="inline-flex h-control items-center justify-center gap-2 rounded bg-primary px-4 text-control font-medium text-primary-foreground hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
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
                        className="inline-flex h-control items-center justify-center gap-2 rounded border border-border px-4 text-control hover:border-primary/50 hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
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

                {facility.pools.length === 0 ? (
                  <p className="text-sm text-foreground-muted">{t('facilities.noPools')}</p>
                ) : (
                  <ul className="flex flex-col divide-y divide-border">
                    {facility.pools.map((pool) => (
                      <li
                        key={pool.id}
                        className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3 first:pt-0"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <EntityIcon kind="pool" className="text-foreground-muted" />
                          <div className="flex min-w-0 flex-col">
                          {/* A tank's page is staff only; a family reads the name. */}
                          {data.canOpenPools ? (
                            <FromLink
                              href={`/dashboard/facilities/pools/${pool.id}`}
                              className="truncate text-primary hover:underline"
                            >
                              {pool.name}
                            </FromLink>
                          ) : (
                            <span className="truncate">{pool.name}</span>
                          )}
                          <span className="text-sm text-foreground-muted">
                            {[
                              t(`facilities.kind.${pool.kind}`),
                              pool.laneCount === null
                                ? null
                                : t('facilities.lanes', { count: pool.laneCount }),
                              pool.volumeLitres === null
                                ? null
                                : t('facilities.volume', {
                                    litres: format.number(pool.volumeLitres),
                                  }),
                              // Shown as one measurement rather than three
                              // fields, because that is how anyone says it out
                              // loud: "25 by 12.5".
                              pool.lengthM === null && pool.widthM === null
                                ? null
                                : t('facilities.size', {
                                    size: [pool.lengthM, pool.widthM]
                                      .filter((value): value is number => value !== null)
                                      .map((value) => format.number(value))
                                      .join(' × '),
                                  }),
                              pool.maxDepthM === null
                                ? null
                                : t('facilities.depth', {
                                    depth: format.number(pool.maxDepthM),
                                  }),
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                          {/* Shut today — POOLSE-84. */}
                          <PoolClosureNote closure={pool.closure} />
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}

                {/* Under the tanks it adds to, before the photographs — POOLSE-92 C. */}
                {data.canManage && (
                  <FromLink
                    href={`/dashboard/facilities/pools/new?facilityId=${facility.id}`}
                    className="inline-flex h-control items-center justify-center px-4 text-control gap-2 self-start rounded border border-border hover:bg-surface-muted"
                  >
                    {t('facilities.addPool')}
                  </FromLink>
                )}

                {/*
                  The site's photographs, back on the card — Rui, 12 October
                  2026: the picture of the place is part of what the card is.
                */}
                {/*
                  A clear break before the photographs — POOLSE-92 D. `mt-4` on top
                  of the card's `gap-4` makes 32 px above the rule, enough to read
                  the gallery as its own block rather than the end of the tank list.
                */}
                <div className="mt-4 border-t border-border pt-4">
                  <h3 className="mb-3 text-sm text-foreground-muted">
                    {t('facilities.sitePhotos')}
                  </h3>
                  <PhotoGallery
                    photos={facility.photos}
                    target={`facility-photo:${facility.id}`}
                    canManage={data.canManage}
                    emptyLabel={t('facilities.noSitePhotos')}
                    uploadLabel={t('facilities.uploadSitePhoto')}
                  />
                </div>

              </section>
            ))
          )}
        </>
      )}
    </PageShell>
  );
}
