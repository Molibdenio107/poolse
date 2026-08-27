import { getFormatter, getTranslations } from 'next-intl/server';
import { ApiError, apiFetch, type Facilities } from '../../../../lib/api';
import Link from 'next/link';
import { ActionButton } from '@/components/action-button';
import { EntityIcon } from '@/components/entity-icon';
import { PhotoGallery } from '@/components/photo-gallery';
import { ArchiveButton } from './facility-forms';
import { PageShell } from '@/components/page-shell';

/**
 * Slice 1.1 — an operator sets up their site.
 *
 * The first screen in Poolse that is the product rather than a proof that the
 * plumbing works. Everything in module 1 hangs off what is created here: a class
 * group happens at a pool, attendance is taken at a pool, and a reading in phase
 * 4 belongs to one.
 */
export default async function FacilitiesPage(): Promise<React.ReactElement> {
  const t = await getTranslations();
  const format = await getFormatter();

  let data: Facilities | null = null;
  let failure: string | null = null;
  let noOrganization = false;

  try {
    data = await apiFetch<Facilities>('/facilities');
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) {
      noOrganization = true;
    } else {
      failure = error instanceof ApiError ? `${error.status} ${error.message}` : String(error);
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
        <section className="rounded border border-danger/40 bg-danger/10 p-5">
          <p className="font-medium text-danger">{t('account.unavailable')}</p>
          <p className="mt-1 font-mono text-sm text-foreground-muted">{failure}</p>
        </section>
      )}

      {data !== null && (
        <>
          {!data.canManage && (
            <p className="text-sm text-foreground-muted">{t('facilities.readOnly')}</p>
          )}

          {data.canManage && (
            <Link
              href="/dashboard/facilities/new"
              className="self-start rounded bg-primary px-4 py-2 text-sm text-primary-foreground"
            >
              {t('facilities.addSite')}
            </Link>
          )}

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
                    <ActionButton
                      href={`/dashboard/facilities/${facility.id}`}
                      icon="facility"
                      label={t('facilities.seeDetails')}
                    />
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
                        <Link
                          href={`/dashboard/facilities/pools/${pool.id}`}
                          className="text-sm text-primary hover:underline"
                        >
                          {t('facilities.seeDetails')}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="border-t border-border pt-4">
                  <h3 className="mb-3 text-sm text-foreground-muted">
                    {t('facilities.sitePhotos')}
                  </h3>
                  <PhotoGallery
                    photos={facility.photos}
                    canManage={data.canManage}
                    emptyLabel={t('facilities.noSitePhotos')}
                    uploadLabel={t('facilities.uploadSitePhoto')}
                    uploadReason={t('students.photoNoStorage')}
                  />
                </div>

                {data.canManage && (
                  <Link
                    href={`/dashboard/facilities/pools/new?facilityId=${facility.id}`}
                    className="self-start rounded border border-border px-3 py-1.5 text-sm hover:bg-surface-muted"
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
