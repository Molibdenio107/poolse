import Link from 'next/link';
import { describeLoad, type LoadFailure } from '@/lib/load-failure';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import {
  ApiError,
  apiFetch,
  type FacilityDetail,
  type Occupancy,
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
import { PassesPanel } from './passes-panel';
import { listPassProducts } from './passes.actions';
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
import { OccupancyPanel } from '@/components/occupancy-panel';
import { WaterThresholdForm } from './water-threshold-form';
import { backLabelKey, readFrom } from '@/lib/back';

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
  // Encarregados are families, not staff — the staff list has no guardian
  // filter and showed everybody but them.
  { key: 'guardian', label: 'roles.guardian', href: '/dashboard/students/guardians' },
  { key: 'owner', label: 'roles.owner', href: '/dashboard/facilities/staff?role=owner' },
];

export default async function FacilityPage({
  params,
  searchParams,
}: {
  params: Promise<{ facilityId: string }>;
  searchParams: Promise<{ tab?: string | string[]; from?: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const { facilityId } = await params;
  const { tab, from } = await searchParams;
  // Back to where the link was followed from, when it says — the `withFrom`
  // links from the dashboard, Energia and Turmas. October 2026 sweep.
  const origin = readFrom(from);
  const back =
    origin === null
      ? { href: '/dashboard/facilities', label: t('facilities.backToSites') }
      : { href: origin, label: t(backLabelKey(origin) as never) };


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
        back={back}
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

    Every one stays best-effort, and each answers one of three things
    (`Outcome`, `lib/load-failure.ts`): **refused** hides its tab, because a 403
    is the permission check; **failed** keeps the tab and says so inside it,
    because a 500 is not a permission — it used to be the same null, and on a
    bad night an owner's Manutenção tab simply was not there.
  */
  const [partners, spaces, tasks, meters, prices, categories, policies, passes] = await Promise.all([
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
    // Natação livre — POOLSE-68. Owner and admin; the endpoint decides.
    listPassProducts(facilityId),
  ]);

  // A record opened from a tab is sent back to that tab, not to General.
  const path = `/dashboard/facilities/${facilityId}`;
  const loaded = site;

  return (
    <DetailPage
      title={loaded.name}
      subtitle={[loaded.address, loaded.city, loaded.timezone].filter(Boolean).join(' · ')}
      back={back}
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
          visible:
            prices.state !== 'refused' ||
            categories.state !== 'refused' ||
            policies.state !== 'refused' ||
            passes.state !== 'refused',
          content: async () => {
            const register =
              prices.state === 'ok'
                ? await apiFetch<Students>('/students').catch(() => null)
                : null;
            return (
              <>
                {prices.state === 'failed' && <PageError message={t(prices.failure.key)} />}
                {prices.state === 'ok' && (
                  <>
                    {/*
                      The register supplies the levels and whether the reader may
                      edit. Without it an owner got a read-only list and no word
                      why; now the list is still shown, and the reason with it.
                    */}
                    {register === null && <PageError message={t('detailTabs.loadFailed')} />}
                    <PricesPanel
                      facilityId={facilityId}
                      plans={prices.data.plans}
                      periods={prices.data.periods}
                      seasons={prices.data.seasons}
                      billing={prices.data.billing}
                      levels={register?.levels ?? []}
                      canManage={register?.canManage ?? false}
                    />
                  </>
                )}

                {/*
                  Directly under the price list, because a concession is the
                  other half of what somebody pays and the two are one
                  conversation. Not gated on `prices`: a reader may see the
                  names without seeing the amounts.
                */}
                {categories.state === 'failed' && (
                  <PageError message={t(categories.failure.key)} />
                )}
                {categories.state === 'ok' && (
                  <CategoriesPanel
                    facilityId={facilityId}
                    categories={categories.data.categories}
                    canManage={categories.data.canManage}
                    canSeeValues={categories.data.canSeeValues}
                  />
                )}

                {/*
                  The apólice sits beside the price list because the two halves
                  of the seguro are one conversation: what the club is covered
                  by, and what it charges a family for being on it.
                */}
                {policies.state === 'failed' && <PageError message={t(policies.failure.key)} />}
                {policies.state === 'ok' && (
                  <InsurancePanel
                    facilityId={facilityId}
                    policies={policies.data}
                    canManage={register?.canManage ?? false}
                  />
                )}

                {/*
                  Natação livre — POOLSE-68. What reception sells, priced like
                  the rest of this tab, and the default stay that decides how
                  long somebody counts as in the water.
                */}
                {passes.state === 'failed' && <PageError message={t(passes.failure.key)} />}
                {passes.state === 'ok' && (
                  <PassesPanel
                    facilityId={facilityId}
                    products={passes.data.products}
                    stayMinutes={passes.data.stayMinutes}
                  />
                )}
              </>
            );
          },
        },
        {
          slug: 'partners',
          labelKey: 'partners.title',
          visible: partners.state !== 'refused',
          badge:
            partners.state === 'ok' ? { kind: 'count', value: partners.data.total } : undefined,
          content: () =>
            partners.state === 'failed' ? (
              <PageError message={t(partners.failure.key)} />
            ) : (
              partners.state === 'ok' && (
                <PartnersPanel
                  facilityId={facilityId}
                  facilityName={loaded.name}
                  partners={partners.data.items}
                  total={partners.data.total}
                  canManage={partners.data.canManage}
                />
              )
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
            The season in figures — POOLSE-52. It sat on the dashboard until
            POOLSE-66 slice 2b, which answers today's question there and moved
            this one home: it is one site's season, so it belongs on the site.
            Readable by everybody who may see the site; the money columns are the
            endpoint's to withhold. Fetched when the tab opens.
          */
          slug: 'occupancy',
          labelKey: 'detailTabs.occupancy',
          content: async () => {
            const occupancy = await apiFetch<Occupancy>(
              `/facilities/${facilityId}/occupancy`,
            ).catch(() => null);
            return occupancy === null ? (
              <PageError message={t('occupancy.unavailable')} />
            ) : (
              <OccupancyPanel occupancy={occupancy} facilityId={facilityId} />
            );
          },
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
          visible: spaces.state !== 'refused',
          badge:
            spaces.state === 'ok' && spaces.data.items.some((space) => space.overdue)
              ? { kind: 'dot', labelKey: 'detailTabs.badge.spacesOverdue' }
              : undefined,
          content: () =>
            spaces.state === 'failed' ? (
              <PageError message={t(spaces.failure.key)} />
            ) : (
              spaces.state === 'ok' && (
                <SpacesPanel
                  facilityId={facilityId}
                  spaces={spaces.data.items}
                  canManage={spaces.data.canManage}
                  backTo={`${path}?tab=spaces`}
                />
              )
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
          visible: tasks.state !== 'refused',
          badge:
            tasks.state === 'ok' && tasks.data.tasks.some((task) => task.state === 'due')
              ? { kind: 'dot', labelKey: 'detailTabs.badge.maintenanceDue' }
              : undefined,
          content: () =>
            tasks.state === 'failed' ? (
              <PageError message={t(tasks.failure.key)} />
            ) : (
              tasks.state === 'ok' && (
                <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
                  <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
                    {t('maintenance.section')}
                  </h2>
                  <MaintenancePanel facilityId={facilityId} list={tasks.data} />
                </section>
              )
            ),
        },
        {
          // Energy — slice 5.1: what running the site costs.
          slug: 'energy',
          labelKey: 'energy.section',
          visible: meters.state !== 'refused',
          content: () =>
            meters.state === 'failed' ? (
              <PageError message={t(meters.failure.key)} />
            ) : (
              meters.state === 'ok' && (
                <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
                  <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
                    {t('energy.section')}
                  </h2>
                  <EnergyPanel
                    facilityId={facilityId}
                    list={meters.data}
                    backTo={`${path}?tab=energy`}
                  />
                </section>
              )
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

          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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

      {/*
        How old a tank's latest analysis may be — POOLSE-66 slice 2b. A standing
        rule of the site, beside its opening hours; the dashboard's water card
        calls a tank "due" past it, and an empty box flags nothing.
      */}
      <section className="flex flex-col gap-3 rounded border border-border bg-surface p-5">
        <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
          {t('facilities.waterThreshold.title')}
        </h2>
        <WaterThresholdForm
          facilityId={site.id}
          hours={site.waterAnalysisMaxAgeHours}
          canManage={site.canManage}
        />
      </section>
    </>
  );
}
