import { getFormatter, getTranslations } from 'next-intl/server';
import { describeLoad, type LoadFailure } from '@/lib/load-failure';
import { ApiError, apiFetch, type Facilities } from '../../../../lib/api';
import Link from 'next/link';
import { Settings } from 'lucide-react';
import { EntityIcon } from '@/components/entity-icon';
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
export default async function FacilitiesPage(): Promise<React.ReactElement> {
  const t = await getTranslations();
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
              <Link
                href="/dashboard/facilities/new"
                className="inline-flex h-control items-center justify-center px-4 text-control gap-2 self-start rounded border border-border hover:bg-surface-muted"
              >
                {t('facilities.addSite')}
              </Link>
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
                    <h2 className="text-lg font-medium">{facility.name}</h2>
                    {/* What is behind the button, so it reads as the place to go. */}
                    <span className="text-sm text-foreground-muted">
                      {t('facilities.configureHint')}
                    </span>
                    {facility.address !== null && (
                      <span className="text-sm text-foreground-muted">{facility.address}</span>
                    )}
                    <span className="text-sm text-foreground-muted">{facility.timezone}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    {/*
                      Story 2 asks for "a clearly labelled control", not a title
                      that turns out to be clickable. A heading that navigates is
                      a heading half the people reading it never try.
                    */}
                    {/*
                      The site's page is where it is configured — hours, prices,
                      tanks, partners, spaces, maintenance, energy — so its door
                      is the page's primary action (Rui, 12 October 2026), not a
                      quiet bordered button beside the archive control.
                    */}
                    <Link
                      href={`/dashboard/facilities/${facility.id}`}
                      className="inline-flex h-control items-center justify-center gap-2 rounded bg-primary px-4 text-control font-medium text-primary-foreground hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    >
                      <Settings aria-hidden className="size-4" />
                      {t('facilities.configure')}
                    </Link>
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
                          <Link
                            href={`/dashboard/facilities/pools/${pool.id}`}
                            className="truncate text-primary hover:underline"
                          >
                            {pool.name}
                          </Link>
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
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}

                {/*
                  The site's photographs, back on the card — Rui, 12 October
                  2026: the picture of the place is part of what the card is.
                */}
                <div className="border-t border-border pt-4">
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

                {/* Its espaços are a tab of the site's page, one link away. */}
                <nav
                  aria-label={t('facilities.cardMore', { name: facility.name })}
                  className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-4 text-sm"
                >
                  <Link
                    href={`/dashboard/facilities/${facility.id}?tab=spaces`}
                    className="rounded text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  >
                    {t('spaces.title')}
                  </Link>
                </nav>

                {data.canManage && (
                  <Link
                    href={`/dashboard/facilities/pools/new?facilityId=${facility.id}`}
                    className="inline-flex h-control items-center justify-center px-4 text-control gap-2 self-start rounded border border-border hover:bg-surface-muted"
                  >
                    {t('facilities.addPool')}
                  </Link>
                )}
              </section>
            ))
          )}
        </>
      )}
    </PageShell>
  );
}
