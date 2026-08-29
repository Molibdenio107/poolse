import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ApiError, apiFetch, type FacilityDetail, type PeopleCounts } from '@/lib/api';
import { withFrom } from '@/lib/back';
import { EntityIcon } from '@/components/entity-icon';
import { PhotoGallery } from '@/components/photo-gallery';
import { CityPicker } from './city-picker';
import { WeatherPanel } from './weather-panel';
import { PageShell } from '@/components/page-shell';

/**
 * One site, in detail — backlog round 3, stories 2 and 3.
 *
 * The two stories arrived separately and are one screen: "how big is this
 * operation" and "what is the weather doing there" are both things an operator
 * asks while looking at a site, and splitting them would have meant two pages
 * that each carried the site's name and address.
 */

/**
 * The five groups story 2 names, plus the owner.
 *
 * The owner is not in the story's list, and leaving them out would have meant a
 * tally that quietly loses the one person who runs the club — a headcount you
 * cannot reconcile against the room is worse than a sixth row.
 *
 * Every one links through. `student` goes to the register, which instructors can
 * also reach; the role groups go to People, which story 8 restricted to owners
 * and admins — and the whole block only renders for those two, so no link here
 * ends in a refusal.
 *
 * Each link is stamped with this site's path — R4. Both destinations are real
 * sections with their own back targets, so without it "Voltar" from the staff
 * list lands on the dashboard rather than on the site somebody was reading, and
 * the only way back to it is the browser's own button. See `lib/back.ts`.
 */
const GROUPS: { key: keyof PeopleCounts; label: string; href: string }[] = [
  { key: 'student', label: 'roles.student', href: '/dashboard/students' },
  { key: 'instructor', label: 'roles.instructor', href: '/dashboard/facilities/staff?role=instructor' },
  { key: 'admin', label: 'roles.admin', href: '/dashboard/facilities/staff?role=admin' },
  { key: 'maintenance', label: 'roles.maintenance', href: '/dashboard/facilities/staff?role=maintenance' },
  { key: 'guardian', label: 'roles.guardian', href: '/dashboard/facilities/staff?role=guardian' },
  { key: 'owner', label: 'roles.owner', href: '/dashboard/facilities/staff?role=owner' },
];

export default async function FacilityPage({
  params,
}: {
  params: Promise<{ facilityId: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const { facilityId } = await params;

  let site: FacilityDetail | null = null;
  let failure: string | null = null;

  try {
    site = await apiFetch<FacilityDetail>(`/facilities/${facilityId}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    failure = error instanceof ApiError ? `${error.status} ${error.message}` : String(error);
  }

  return (
    <PageShell
      title={site?.name ?? t('facilities.title')}
      subtitle={
        site === null
          ? undefined
          : [site.address, site.city, site.timezone].filter(Boolean).join(' · ')
      }
      back={{ href: "/dashboard/facilities", label: t('facilities.backToSites') }}
      actions={<EntityIcon kind="facility" className="mt-1.5 size-6 text-primary" />}
    >

      {failure !== null && (
        <section className="rounded border border-danger/40 bg-danger/10 p-5">
          <p className="font-medium text-danger">{t('account.unavailable')}</p>
          <p className="mt-1 font-mono text-sm text-foreground-muted">{failure}</p>
        </section>
      )}

      {site !== null && (
        <>

          {/*
            Counts first, because "how big is this" is the question story 2 says
            the screen exists to answer. Absent entirely for anybody who is not
            an owner or an admin — the API does not send them, so there is
            nothing here to hide badly.
          */}
          {site.counts !== undefined && (
            <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
              <div>
                <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
                  {t('facilities.people')}
                </h2>
                {/*
                  Said out loud rather than left to be discovered. Students and
                  staff belong to the organization, not to a site, so a club with
                  two buildings sees the same numbers on both — and an operator
                  who assumed otherwise would be reading them wrongly.
                */}
                <p className="mt-1 text-sm text-foreground-muted">
                  {t('facilities.peopleHint')}
                </p>
              </div>

              <ul className="grid gap-3 sm:grid-cols-3">
                {GROUPS.map((group) => (
                  <li key={group.key}>
                    <Link
                      href={withFrom(group.href, `/dashboard/facilities/${facilityId}`)}
                      className="flex flex-col gap-0.5 rounded border border-border p-3 transition-colors hover:border-primary/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    >
                      {/*
                        Zero renders as 0, never as an absence. "No instructors
                        yet" and "this screen forgot to load" look identical when
                        the row simply is not there.
                      */}
                      <span className="text-2xl font-semibold">
                        {site.counts?.[group.key] ?? 0}
                      </span>
                      <span className="text-sm text-foreground-muted">{t(group.label)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <WeatherPanel
            city={site.city}
            latitude={site.latitude}
            longitude={site.longitude}
          />

          {site.canManage && (
            <section className="rounded border border-border bg-surface p-5">
              <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-foreground-muted">
                {t('facilities.location')}
              </h2>
              <CityPicker
                organizationId={site.organizationId}
                facilityId={site.id}
                city={site.city}
                countryCode={site.countryCode}
              />
            </section>
          )}

          <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
            <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
              {t('facilities.pools')}
            </h2>

            {site.pools.length === 0 ? (
              <p className="text-sm text-foreground-muted">{t('facilities.noPools')}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {site.pools.map((pool) => (
                  <li key={pool.id} className="py-3 first:pt-0 last:pb-0">
                    <Link
                      href={withFrom(
                        `/dashboard/facilities/pools/${pool.id}`,
                        `/dashboard/facilities/${facilityId}`,
                      )}
                      className="flex items-center gap-3 rounded hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    >
                      <EntityIcon kind="pool" />
                      <span className="font-medium">{pool.name}</span>
                      <span className="text-sm text-foreground-muted">
                        {t(`facilities.kind.${pool.kind}`)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded border border-border bg-surface p-5">
            <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-foreground-muted">
              {t('facilities.sitePhotos')}
            </h2>
            {/*
              The upload control is present, styled and visibly inert, exactly as
              it is for pool and student photographs. One storage decision
              unblocks all three; until then a control that opened a picker and
              then lost the file would be worse than one that says so.
            */}
            <PhotoGallery
              photos={site.photos}
              canManage={site.canManage}
              emptyLabel={t('facilities.noSitePhotos')}
              uploadLabel={t('facilities.uploadSitePhoto')}
              uploadReason={t('students.photoNoStorage')}
            />
          </section>
        </>
      )}
    </PageShell>
  );
}
