import Link from 'next/link';
import { describeLoad, type LoadFailure } from '@/lib/load-failure';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import {
  ApiError,
  apiFetch,
  type FacilityDetail,
  type FacilitySlots,
  type PeopleCounts,
  type Students,
} from '@/lib/api';
import { withFrom } from '@/lib/back';
import { EntityIcon } from '@/components/entity-icon';
import { PhotoGallery } from '@/components/photo-gallery';
import { CityPicker } from './city-picker';
import { WeatherPanel } from './weather-panel';
import { HoursPanel } from './hours-panel';
import { SlotsPanel } from './slots-panel';
import { PricesPanel } from './prices-panel';
import { listPrices } from './prices.actions';
import { PartnersPanel } from './partners-panel';
import { listPartners } from './partners.actions';
import { PageError, PageShell } from '@/components/page-shell';

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
  let failure: LoadFailure | null = null;

  try {
    site = await apiFetch<FacilityDetail>(`/facilities/${facilityId}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    failure = describeLoad(error);
  }

  /*
   * The price list — POOLSE-42.
   *
   * `listPrices` answers null when the endpoint refuses, which is what an
   * instructor gets: AC10 says they see no amounts at all, so the block is
   * simply absent rather than rendered empty or rendered with a refusal in it.
   * The levels come from the register, for the optional level a plan suggests.
   */
  /*
   * The schedule grid — POOLSE-44.
   *
   * Best-effort: the slot editor is one block on a long page, and a club with
   * no season yet has no grid to show. Losing it must not cost the site.
   */
  const slots = await apiFetch<FacilitySlots>(`/facilities/${facilityId}/slots`).catch(
    () => null,
  );

  /*
   * Parcerias — POOLSE-47.
   *
   * Best-effort like the grid above it: a club that sells no water in blocks has
   * an empty panel, and an endpoint that refuses must not cost the site page.
   * The page number rides in the query string so the list is linkable.
   */
  const partners = await listPartners(facilityId, 1);

  /*
    The season in figures — POOLSE-52.

    Best-effort like the blocks around it. A draft season is refused outright by
    the endpoint (it has no dated sessions to measure), and a club with no grid
    yet has nothing to divide by — both come back as an absent panel rather than
    a screen full of dashes.
  */

  const prices = await listPrices(facilityId);
  const register =
    prices === null ? null : await apiFetch<Students>('/students').catch(() => null);

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
        <PageError
          message={t(failure.key)}
          {...(failure.detail === '' ? {} : { detail: failure.detail })}
        />
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

          {/*
            The site's standing rules — round 4.

            Below the location and above the pools because that is the order the
            questions are asked in: where is it, when is it open, what is in it.
            Readable by anyone who may see the site — "we do not open on Sundays"
            is what makes the calendar's gaps explicable — and writable only by
            an owner or admin, which the API enforces rather than this.
          */}
          <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
                {t('facilities.hours')}
              </h2>
              {/*
                Closures live in the calendar and stay there. A site's closed
                dates are the same table the holidays and the vacation calendar
                already read, and a second place to enter them would be a second
                place for them to disagree — so this links rather than repeats.
              */}
              <Link
                href={withFrom('/dashboard/calendar/closures', `/dashboard/facilities/${facilityId}`)}
                className="rounded text-sm text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                {t('facilities.manageClosures')}
              </Link>
            </div>

            <HoursPanel
              organizationId={site.organizationId}
              facilityId={site.id}
              hours={site.hours}
              canManage={site.canManage}
            />

            {/*
              The schedule grid, inside this card rather than beside it.

              It was its own section and read as a duplicate of the hours above
              it, which is fair: both blocks answered "when does this building
              run" and the page asked the question twice. They are not the same
              fact — the hours say when the site is open at all, the grid says
              which rows a class may sit in inside those hours — but that
              distinction only earns a heading of its own once the calendar draws
              those rows, and it does not yet.

              So: one card about when the building runs, in two parts, with the
              second explaining itself.
            */}
            {slots !== null && (
              <div className="flex flex-col gap-4 border-t border-border pt-4">
                <div>
                  <h3 className="text-sm font-medium">{t('slots.title')}</h3>
                  <p className="mt-1 text-sm text-foreground-muted">{t('slots.versusHours')}</p>
                </div>

                <SlotsPanel
                  organizationId={site.organizationId}
                  facilityId={site.id}
                  slots={slots.slots}
                  hours={site.hours}
                  canManage={site.canManage}
                />
              </div>
            )}
          </section>

          {prices !== null && (
            <PricesPanel
              facilityId={facilityId}
              plans={prices.plans}
              periods={prices.periods}
              billing={prices.billing}
              levels={register?.levels ?? []}
              canManage={register?.canManage ?? false}
            />
          )}


          {partners !== null && (
            <PartnersPanel
              facilityId={facilityId}
              partners={partners.items}
              total={partners.total}
              canManage={partners.canManage}
            />
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
