import Link from 'next/link';
import { describeLoad, type LoadFailure } from '@/lib/load-failure';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import {
  ApiError,
  apiFetch,
  type FacilityDetail,
  type PeopleCounts,
  type Students,
} from '@/lib/api';
import { withFrom } from '@/lib/back';
import { EntityIcon } from '@/components/entity-icon';
import { PhotoGallery } from '@/components/photo-gallery';
import { DetailPage } from '@/components/detail-page';
import { CityPicker } from './city-picker';
import { WeatherPanel } from './weather-panel';
import { HoursPanel } from './hours-panel';
import { PricesPanel } from './prices-panel';
import { listPrices } from './prices.actions';
import { InsurancePanel } from './insurance-panel';
import { listPolicies } from './insurance.actions';
import { CategoriesPanel } from './categories-panel';
import { listCategories } from './categories.actions';
import { PartnersPanel } from './partners-panel';
import { listPartners } from './partners.actions';
import { SpacesPanel } from '../spaces-panel';
import { listSpaces } from '../spaces.actions';
import { MaintenancePanel } from '../maintenance-panel';
import { listTasks } from '../maintenance.actions';
import { EnergyPanel } from '../energy-panel';
import { listMeters } from '../energy.actions';
import { PageError, PageShell } from '@/components/page-shell';

/**
 * One site, in detail — backlog round 3, stories 2 and 3.
 *
 * The two stories arrived separately and are one screen: "how big is this
 * operation" and "what is the weather doing there" are both things an operator
 * asks while looking at a site, and splitting them would have meant two pages
 * that each carried the site's name and address.
 *
 * **Tabs since the detail-tabs change.** Thirteen stacked sections became eight
 * tabs: General holds what the site *is* (its people, weather, location and
 * hours), Preços holds the price list with the two cards that modify it, and
 * every other section is a tab of its own, in the order they were stacked.
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
  searchParams,
}: {
  params: Promise<{ facilityId: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const { facilityId } = await params;
  const { tab } = await searchParams;

  let site: FacilityDetail | null = null;
  let failure: LoadFailure | null = null;

  try {
    site = await apiFetch<FacilityDetail>(`/facilities/${facilityId}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    failure = describeLoad(error);
  }

  if (site === null) {
    return (
      <PageShell
        title={t('facilities.title')}
        back={{ href: '/dashboard/facilities', label: t('facilities.backToSites') }}
      >
        {failure !== null && (
          <PageError
            message={t(failure.key)}
            {...(failure.detail === '' ? {} : { detail: failure.detail })}
          />
        )}
      </PageShell>
    );
  }

  /*
    What decides which tabs exist.

    Each of these lists answers null when its endpoint refuses, and that refusal
    *is* the permission check — so they run before the strip can be drawn, in
    parallel rather than one after another as the stacked page did. Three of
    them also feed a badge. What a tab needs beyond its own list (the register,
    for the price list's levels) waits until that tab is opened.

    Every one stays best-effort, as before: a list that cannot be read costs its
    tab, never the page.
  */
  const [partners, spaces, tasks, meters, prices, categories, policies] = await Promise.all([
    // Parcerias — POOLSE-47. Page 1; the panel pages itself.
    listPartners(facilityId, 1),
    // Espaços — round 6.
    listSpaces(facilityId),
    /*
     * Planned maintenance — slice 4.3. Null means the endpoint refused or was
     * unreachable, and an absent tab costs nothing, where a tab rendered empty
     * would say this site has no maintenance plan when in fact nobody knows.
     */
    listTasks(facilityId),
    // The meters, same terms — slice 5.1.
    listMeters(facilityId),
    /*
     * The price list — POOLSE-42. Null for an instructor: AC10 says they see no
     * amounts at all.
     */
    listPrices(facilityId),
    /*
     * Categorias de preço — round 19. Organization-scoped, so what is on the
     * page is the same on every site and the panel says so. A reader may see
     * the names without the amounts — `canSeeValues`, decided by the endpoint.
     */
    listCategories(),
    // What the club pays its insurer is a commercial fact; the endpoint decides.
    listPolicies(facilityId),
  ]);

  // A record opened from a tab is sent back to that tab, not to General.
  const path = `/dashboard/facilities/${facilityId}`;
  const loaded = site;

  return (
    <DetailPage
      title={loaded.name}
      subtitle={[loaded.address, loaded.city, loaded.timezone].filter(Boolean).join(' · ')}
      back={{ href: '/dashboard/facilities', label: t('facilities.backToSites') }}
      actions={<EntityIcon kind="facility" className="mt-1.5 size-6 text-primary" />}
      requested={tab}
      tabs={[
        {
          slug: 'general',
          labelKey: 'detailTabs.general',
          content: () => <GeneralTab site={loaded} path={path} />,
        },
        {
          slug: 'prices',
          labelKey: 'detailTabs.prices',
          visible: prices !== null || categories !== null || policies !== null,
          content: async () => {
            const register =
              prices === null ? null : await apiFetch<Students>('/students').catch(() => null);
            return (
              <>
                {prices !== null && (
                  <PricesPanel
                    facilityId={facilityId}
                    plans={prices.plans}
                    periods={prices.periods}
                    seasons={prices.seasons}
                    billing={prices.billing}
                    levels={register?.levels ?? []}
                    canManage={register?.canManage ?? false}
                  />
                )}

                {/*
                  Directly under the price list, because a concession is the
                  other half of what somebody pays and the two are one
                  conversation. Not gated on `prices`: a reader may see the
                  names without seeing the amounts.
                */}
                {categories !== null && (
                  <CategoriesPanel
                    facilityId={facilityId}
                    categories={categories.categories}
                    canManage={categories.canManage}
                    canSeeValues={categories.canSeeValues}
                  />
                )}

                {/*
                  The apólice sits beside the price list because the two halves
                  of the seguro are one conversation: what the club is covered
                  by, and what it charges a family for being on it.
                */}
                {policies !== null && (
                  <InsurancePanel
                    facilityId={facilityId}
                    policies={policies}
                    canManage={register?.canManage ?? false}
                  />
                )}
              </>
            );
          },
        },
        {
          slug: 'partners',
          labelKey: 'partners.title',
          visible: partners !== null,
          badge: partners === null ? undefined : { kind: 'count', value: partners.total },
          content: () =>
            partners !== null && (
              <PartnersPanel
                facilityId={facilityId}
                facilityName={loaded.name}
                partners={partners.items}
                total={partners.total}
                canManage={partners.canManage}
              />
            ),
        },
        {
          slug: 'pools',
          labelKey: 'facilities.pools',
          badge: { kind: 'count', value: loaded.pools.length },
          content: () => (
            <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
              <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
                {t('facilities.pools')}
              </h2>

              {loaded.pools.length === 0 ? (
                <p className="text-sm text-foreground-muted">{t('facilities.noPools')}</p>
              ) : (
                <ul className="flex flex-col divide-y divide-border">
                  {loaded.pools.map((pool) => (
                    <li key={pool.id} className="py-3 first:pt-0 last:pb-0">
                      <Link
                        href={withFrom(`/dashboard/facilities/pools/${pool.id}`, `${path}?tab=pools`)}
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
          ),
        },
        {
          /*
            Espaços, directly after Piscinas — round 6, and the same component
            Instalações draws inside each site card. The tanks are what a
            swimming pool is; the balneários, the sala de máquinas and the
            arrecadação are the rest of the building round them.
          */
          slug: 'spaces',
          labelKey: 'spaces.title',
          visible: spaces !== null,
          badge:
            spaces !== null && spaces.items.some((space) => space.overdue)
              ? { kind: 'dot', labelKey: 'detailTabs.badge.spacesOverdue' }
              : undefined,
          content: () =>
            spaces !== null && (
              <SpacesPanel
                facilityId={facilityId}
                spaces={spaces.items}
                canManage={spaces.canManage}
                backTo={`${path}?tab=spaces`}
              />
            ),
        },
        {
          /*
            Manutenção — about the future, what has to happen again, where the
            tabs before it are about what the site *is*. A task may be about a
            tank, a room or the building itself, which is why it is a section of
            the site rather than part of Espaços or Piscinas.
          */
          slug: 'maintenance',
          labelKey: 'maintenance.section',
          visible: tasks !== null,
          badge:
            tasks !== null && tasks.tasks.some((task) => task.state === 'due')
              ? { kind: 'dot', labelKey: 'detailTabs.badge.maintenanceDue' }
              : undefined,
          content: () =>
            tasks !== null && (
              <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
                <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
                  {t('maintenance.section')}
                </h2>
                <MaintenancePanel facilityId={facilityId} list={tasks} />
              </section>
            ),
        },
        {
          // Energy — slice 5.1: what running the site costs.
          slug: 'energy',
          labelKey: 'energy.section',
          visible: meters !== null,
          content: () =>
            meters !== null && (
              <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
                <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
                  {t('energy.section')}
                </h2>
                <EnergyPanel
                  facilityId={facilityId}
                  list={meters}
                  backTo={`${path}?tab=energy`}
                />
              </section>
            ),
        },
        {
          slug: 'photos',
          labelKey: 'facilities.photos',
          content: () => (
            <section className="rounded border border-border bg-surface p-5">
              <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-foreground-muted">
                {t('facilities.sitePhotos')}
              </h2>
              {/*
                The upload control is present, styled and visibly inert, exactly
                as it is for pool and student photographs. One storage decision
                unblocks all three; until then a control that opened a picker and
                then lost the file would be worse than one that says so.
              */}
              <PhotoGallery
                photos={loaded.photos}
                canManage={loaded.canManage}
                emptyLabel={t('facilities.noSitePhotos')}
                uploadLabel={t('facilities.uploadSitePhoto')}
                uploadReason={t('students.photoNoStorage')}
              />
            </section>
          ),
        },
      ]}
    />
  );
}

/**
 * General: what the site is — its people, its weather, where it is and when it
 * opens, in the order those questions are asked.
 */
async function GeneralTab({
  site,
  path,
}: {
  site: FacilityDetail;
  path: string;
}): Promise<React.ReactElement> {
  const t = await getTranslations();

  return (
    <>
      {/*
        Counts first, because "how big is this" is the question story 2 says the
        screen exists to answer. Absent entirely for anybody who is not an owner
        or an admin — the API does not send them, so there is nothing here to
        hide badly.
      */}
      {site.counts !== undefined && (
        <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
          <div>
            <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
              {t('facilities.people')}
            </h2>
            {/*
              Said out loud rather than left to be discovered. Students and staff
              belong to the organization, not to a site, so a club with two
              buildings sees the same numbers on both.
            */}
            <p className="mt-1 text-sm text-foreground-muted">{t('facilities.peopleHint')}</p>
          </div>

          <ul className="grid gap-3 sm:grid-cols-3">
            {GROUPS.map((group) => (
              <li key={group.key}>
                <Link
                  href={withFrom(group.href, path)}
                  className="flex flex-col gap-0.5 rounded border border-border p-3 transition-colors hover:border-primary/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  {/*
                    Zero renders as 0, never as an absence. "No instructors yet"
                    and "this screen forgot to load" look identical when the row
                    simply is not there.
                  */}
                  <span className="text-2xl font-semibold">{site.counts?.[group.key] ?? 0}</span>
                  <span className="text-sm text-foreground-muted">{t(group.label)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <WeatherPanel city={site.city} latitude={site.latitude} longitude={site.longitude} />

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
        The site's standing rules — round 4. Readable by anyone who may see the
        site — "we do not open on Sundays" is what makes the calendar's gaps
        explicable — and writable only by an owner or admin, which the API
        enforces rather than this.
      */}
      <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
            {t('facilities.hours')}
          </h2>
          {/*
            Closures live in the calendar and stay there: a second place to enter
            them would be a second place for them to disagree.
          */}
          <Link
            href={withFrom('/dashboard/calendar/closures', path)}
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
          The schedule grid's editor used to be here and was removed in round 6;
          the rows themselves are untouched and still read by the calendar, the
          Turmas board, the printed sheet and the XLSX export. If a club ever
          needs to change them again, this is where it comes back.
        */}
      </section>
    </>
  );
}
