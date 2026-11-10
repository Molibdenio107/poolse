import type { PoolseSport } from '@poolse/rules';
import { SportIcon, sportNameKey } from '@/components/sport-icon';
import { RegulationPanel, type ComplaintsSettingsView, type RegulationVersionView } from './regulation-panel';
import { ClubContactsPanel, PaymentInstructionsPanel, TaxPanel } from './tax-panel';
import { FoldCard } from '@/components/fold-card';
import { COUNTRY_CODES, formatClubPhone, formatIban, formatMbwayPhone } from '@poolse/rules';
import { LogoPanel } from './logo-panel';
import { SiteDetailsForm } from './address-field';
import { DocumentsTab } from './boletim-template-panel';
import { SeriesPanel } from './series-panel';
import { listSeries } from '../../faturacao/invoices.actions';
import { readTaxSettings } from './club.actions';
import { wallClockNow } from '@/lib/date-format';
import { FromLink } from '@/components/from-link';
import {
  SUB_MENU_ROW,
  SectionPills,
  pickSection,
  sectionHref as sectionUrl,
  subMenuPillClass,
} from '@/components/section-pills';
import { describeLoad, outcome, type LoadFailure } from '@/lib/load-failure';
import { notFound } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import {
  ApiError,
  apiFetch,
  type FacilityDetail,
  type Occupancy,
  type PeopleCounts,
  type Students,
} from '@/lib/api';
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
import { readAttention } from '@/lib/attention';
import { SpacesPanel } from '../spaces-panel';
import { listSpaces } from '../spaces.actions';
import { MaintenancePanel } from '../maintenance-panel';
import { listTasks } from '../maintenance.actions';
import { PageError, PageShell } from '@/components/page-shell';
import { OccupancyPanel } from '@/components/occupancy-panel';
import { WaterThresholdForm } from './water-threshold-form';
import { moduleIsOn } from '@/lib/modules';
import { backLabelKey, readFrom } from '@/lib/back';
import { storageConfigured } from '@/lib/storage-status';
import { clubAddonSports } from '@/lib/modules';

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
 *
 * **Owner and admin configure the site here; maintenance works here** —
 * 15 October 2026, Rui's call. The API answers owner, admin and maintenance
 * (`SITE_PAGE_ROLES`), and maintenance is shown Espaços and Manutenção
 * only — its daily work, not the club's set-up. Energia is its own page
 * (POOLSE-103), not a tab here. Everybody else has
 * the Instalações list, photographs included.
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
 * Each link carries this page as its origin (`FromLink`, R4 and POOLSE-91). Both destinations are real
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
  searchParams: Promise<{
    tab?: string | string[];
    from?: string;
    section?: string;
    form?: string;
    sport?: string;
  }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const { facilityId } = await params;
  const storageReady = await storageConfigured();
  const { tab, from, section, form, sport } = await searchParams;
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
  const [partners, spaces, tasks, prices, categories, policies, passes] = await Promise.all([
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

  // POOLSE-120: what needs doing in this site's tanks and spaces.
  const attention = await readAttention();
  // The club's sports besides swimming, for Ocupação's chooser (POOLSE-151).
  const addonSports = await clubAddonSports();

  return (
    <DetailPage
      title={loaded.name}
      subtitle={[loaded.address, loaded.city, loaded.timezone].filter(Boolean).join(' · ')}
      back={back}
      actions={<EntityIcon kind="facility" className="mt-1.5 size-6 text-primary" />}
      // `?tab=club` was Dados do clube's own tab until 10-11-2026: it is Geral's pill now.
      requested={tab === 'club' ? 'general' : tab}
      tabs={[
        {
          slug: 'general',
          visible: loaded.canManage,
          labelKey: 'detailTabs.general',
          /*
            The site's own set-up, and nothing else — Rui, 04-11-2026: the
            sports are on the Instalações page, between the set-up card and the
            photographs, and not repeated here.
          */
          content: () => <GeneralTab site={loaded} path={path} from={from} section={tab === 'club' ? 'club' : section} />,
        },
        {
          slug: 'prices',
          labelKey: 'detailTabs.prices',
          visible:
            loaded.canManage &&
            (prices.state !== 'refused' ||
              categories.state !== 'refused' ||
              policies.state !== 'refused' ||
              passes.state !== 'refused'),
          content: async () => {
            /*
              One section at a time — 12 October 2026, Rui's report that the
              tab was "all on top of each other". Six sub-sections of the price
              list and three more cards had stacked into one long page, and the
              one a club came for (often Natação livre, last of all) was found
              by scrolling. Each section is a pill naming it, `?section=`, and
              a section whose list the reader may not see is not offered.
            */
            const sections = (
              [
                ['mensalidade', prices.state !== 'refused'],
                ['quota', prices.state !== 'refused'],
                ['joining', prices.state !== 'refused'],
                // Its own pill since POOLSE-151: the seguro prices and the apólice.
                ['insurance', prices.state !== 'refused' || policies.state !== 'refused'],
                ['freeSwim', passes.state !== 'refused'],
                ['categories', categories.state !== 'refused'],
                ['payments', prices.state !== 'refused'],
              ] as const
            )
              .filter(([, offered]) => offered)
              .map(([key]) => key);
            const current = pickSection(sections, section, 'mensalidade');

            const needsRegister =
              prices.state === 'ok' && (current !== 'freeSwim' && current !== 'categories');
            const register = needsRegister
              ? await apiFetch<Students>('/students').catch(() => null)
              : null;
            const sectionHref = (key: string): string =>
              sectionUrl(path, { tab: 'prices', from }, key);

            return (
              <>
                <p className="text-sm text-foreground-muted">{t('fees.pricesHint')}</p>
                <SectionPills
                  label={t('fees.section.nav')}
                  current={current}
                  items={sections.map((key) => ({
                    key,
                    label: t(`fees.section.${key}`),
                    href: sectionHref(key),
                  }))}
                />

                {current !== 'freeSwim' && current !== 'categories' && (
                  <>
                    {prices.state === 'failed' && <PageError message={t(prices.failure.key)} />}
                    {prices.state === 'ok' && (
                      <>
                        {/*
                          The register supplies the levels and whether the reader
                          may edit. Without it an owner got a read-only list and no
                          word why; now the list is still shown, and the reason.
                        */}
                        {register === null && <PageError message={t('detailTabs.loadFailed')} />}
                        <PricesPanel
                          section={current}
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
                  </>
                )}

                {/*
                  The apólice beside the seguro price, because the two halves of
                  the seguro are one conversation: what the club is covered by,
                  and what it charges a family for being on it.
                */}
                {current === 'insurance' && (
                  <>
                    {policies.state === 'failed' && (
                      <PageError message={t(policies.failure.key)} />
                    )}
                    {policies.state === 'ok' && (
                      <InsurancePanel
                        facilityId={facilityId}
                        policies={policies.data}
                        canManage={register?.canManage ?? false}
                        storageReady={storageReady}
                      />
                    )}
                  </>
                )}

                {/* Natação livre — POOLSE-68. What reception sells, and the default stay. */}
                {current === 'freeSwim' && (
                  <>
                    {passes.state === 'failed' && <PageError message={t(passes.failure.key)} />}
                    {passes.state === 'ok' && (
                      <PassesPanel
                        facilityId={facilityId}
                        products={passes.data.products}
                        stayMinutes={passes.data.stayMinutes}
                        categories={categories.state === 'ok' ? categories.data.categories : []}
                      />
                    )}
                  </>
                )}

                {/*
                  Concessions: a reader may see the names without the amounts,
                  so this is not gated on the price list.
                */}
                {current === 'categories' && (
                  <>
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
                  </>
                )}
              </>
            );
          },
        },
        {
          slug: 'partners',
          labelKey: 'partners.title',
          visible: loaded.canManage && partners.state !== 'refused',
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
          /*
            The season in figures — POOLSE-52. It sat on the dashboard until
            POOLSE-66 slice 2b, which answers today's question there and moved
            this one home: it is one site's season, so it belongs on the site.
            Readable by everybody who may see the site; the money columns are the
            endpoint's to withhold. Fetched when the tab opens.
          */
          slug: 'occupancy',
          visible: loaded.canManage,
          labelKey: 'detailTabs.occupancy',
          content: async () => (
            <OccupancyTab
              facilityId={facilityId}
              path={path}
              from={from}
              sports={['pool', ...addonSports]}
              asked={sport}
            />
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
          visible: spaces.state !== 'refused',
          badge:
            spaces.state === 'ok' && spaces.data.items.some((space) => space.overdue)
              ? {
                  kind: 'dot',
                  labelKey: 'detailTabs.badge.spacesOverdue',
                  // How many, from two (POOLSE-215).
                  count: spaces.data.items.filter((space) => space.overdue).length,
                }
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
                  defaultOpen
                  attention={attention.spaces}
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
              ? {
                  kind: 'dot',
                  labelKey: 'detailTabs.badge.maintenanceDue',
                  count: tasks.data.tasks.filter((task) => task.state === 'due').length,
                }
              : undefined,
          content: () =>
            tasks.state === 'failed' ? (
              <PageError message={t(tasks.failure.key)} />
            ) : (
              tasks.state === 'ok' && (
                <section className="flex flex-col gap-4 rounded bg-surface p-5 shadow-card">
                  <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
                    {t('maintenance.section')}
                  </h2>
                  <MaintenancePanel facilityId={facilityId} list={tasks.data} />
                </section>
              )
            ),
        },
        {
          /*
            The operating regulation and where complaints go — POOLSE-73. Both
            reach the public pages, so they are managed here, beside the site.
            Every staff role reads; the API refuses a family, so the tab follows.
          */
          slug: 'regulation',
          visible: loaded.canManage,
          labelKey: 'regulation.tab',
          content: async () => {
            const [versions, complaints] = await Promise.all([
              outcome(
                apiFetch<{ versions: RegulationVersionView[] }>(`/facilities/${loaded.id}/regulations`),
              ),
              outcome(apiFetch<ComplaintsSettingsView>('/settings/complaints')),
            ]);
            if (versions.state !== 'ok') {
              return <PageError message={t('detailTabs.loadFailed')} />;
            }
            return (
              <section className="rounded bg-surface p-5 shadow-card">
                <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-foreground-muted">
                  {t('regulation.title')}
                </h2>
                <RegulationPanel
                  facilityId={loaded.id}
                  versions={versions.data.versions}
                  complaints={complaints.state === 'ok' ? complaints.data : null}
                  canManage={loaded.canManage}
                  today={wallClockNow(loaded.timezone ?? 'Europe/Lisbon').slice(0, 10)}
                />
              </section>
            );
          },
        },
        {
          /*
            The club's own paper forms — POOLSE-142 (Rui, 01-11-2026): the
            boletim de sócio and the FPN declaration, each filled for every
            student when it is printed from the record. The club's, like
            Dados do clube; owner and admin, as the endpoints are.
          */
          slug: 'documents',
          labelKey: 'boletimTemplate.tab',
          visible: loaded.canManage,
          content: () => <DocumentsTab path={path} from={from} section={section} form={form} />,
        },
        {
          slug: 'photos',
          visible: loaded.canManage,
          // *Multimédia*, not *Fotografias* (Rui, 04-11-2026): the logo and the photographs.
          labelKey: 'facilities.mediaTab',
          content: () => (
            <div className="flex flex-col gap-4">
              <SitePhotos site={loaded} />
            </div>
          ),
        },
      ]}
    />
  );
}

/**
 * *Dados do clube* — a pill of Geral since 10-11-2026 (Rui), a tab of its own
 * before. The club's own data — its NIPC, where families' replies go, its phone,
 * *Como pagar* — moved here from Faturação → Configuração on 13 October 2026,
 * and this site's numbering books followed (POOLSE-104 B). Club-wide, as the
 * complaints setting on the Regulamento tab is, and the hint says so. Owner and
 * admin, as the endpoints are. Old `?tab=club` links land here.
 */
async function ClubSection({ facilityId }: { facilityId: string }): Promise<React.ReactElement> {
  const t = await getTranslations();
  const invoicing = await moduleIsOn('invoicing');
  // The numbering books are invoicing's, and this site's own (POOLSE-104 B).
  const [tax, books] = await Promise.all([
    readTaxSettings(),
    invoicing ? listSeries(facilityId) : Promise.resolve(null),
  ]);
  if (tax.state === 'refused') return <PageError message={t('common.notAllowed')} />;
  if (tax.state === 'failed') return <PageError message={t(tax.failure.key)} />;
  const club = tax.data;
  const unset = t('clubData.fold.unset');

  // What each card says while folded: the value set today, or that nothing is.
  const contacts = [club.replyEmail ?? club.replyEmailFallback, club.contactPhone && formatClubPhone(club.contactPhone)]
    .filter(Boolean)
    .join(' · ');
  const payment = [
    club.paymentIban && `IBAN ${formatIban(club.paymentIban)}`,
    club.paymentMbwayPhone && `MB WAY ${formatMbwayPhone(club.paymentMbwayPhone)}`,
    club.paymentInstructions && t('clubData.fold.otherWays'),
  ]
    .filter(Boolean)
    .join(' · ');
  const series = books?.state === 'ok' ? books.data.series : [];

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-foreground-muted">{t('clubData.hint')}</p>
      <FoldCard title={t('settings.tax.title')} summary={club.taxNumber === null ? unset : `NIPC ${club.taxNumber}`}>
        <TaxPanel settings={club} />
      </FoldCard>
      {/* POOLSE-209 + POOLSE-210: where replies go and the phone families see, one save. */}
      <FoldCard title={t('clubData.contacts.title')} summary={contacts === '' ? unset : contacts}>
        <ClubContactsPanel settings={club} />
      </FoldCard>
      {/* Como pagar is read by invoice reminders: invoicing's (POOLSE-87). */}
      {invoicing && (
        <FoldCard title={t('clubData.paymentTitle')} summary={payment === '' ? unset : payment}>
          <PaymentInstructionsPanel settings={club} />
        </FoldCard>
      )}
      {/* This site's numbering books (POOLSE-104 B); a failure says so in its place. */}
      {books?.state === 'failed' && <PageError message={t(books.failure.key)} />}
      {series.length > 0 && (
        <FoldCard
          title={t('invoices.seriesTitle')}
          summary={series.map((book) => `${book.name} (${book.prefix})`).join(' · ')}
        >
          <SeriesPanel facilityId={facilityId} series={series} />
        </FoldCard>
      )}
    </div>
  );
}

/**
 * General: what the club and the site are — its people, the club's own data,
 * where it is and when it opens, its water rule, and the weather last (Rui,
 * 10-11-2026: the things to configure first, the thing to glance at after).
 *
 * **One section at a time**, as on Preços — 12 October 2026. Five independent
 * cards stacked into a page whose last one (the water rule) was found by
 * scrolling. A pill per card, `?section=`, and a card the reader cannot see is
 * not offered: the counts are absent for anybody below admin (the API does not
 * send them) and the city picker is a manager's. Only the chosen card is drawn,
 * so the weather is fetched only when somebody asks for it.
 */
const GENERAL_SECTIONS = ['details', 'people', 'club', 'hours', 'water', 'weather'] as const;
type GeneralSection = (typeof GENERAL_SECTIONS)[number];

async function GeneralTab({
  site,
  path,
  from,
  section,
}: {
  site: FacilityDetail;
  path: string;
  /** The page's `?from=`, kept on every pill so "Voltar" still knows its way. */
  from: string | undefined;
  /** The requested `?section=`; a key from another tab falls back to the first. */
  section: string | undefined;
}): Promise<React.ReactElement> {
  const t = await getTranslations();

  // POOLSE-87 sweep: the water rule is water quality's, refused with it off.
  const waterOn = await moduleIsOn('water_quality');
  const offered = GENERAL_SECTIONS.filter((key: GeneralSection) =>
    key === 'people'
      ? site.counts !== undefined
      : key === 'details' || key === 'club'
        ? site.canManage
        : key === 'water'
          ? waterOn
          : true,
  );
  // Opens on Geral, the site's details (Rui, 10-11-2026); `?section=location` was its old name.
  const current = pickSection(offered, section === 'location' ? 'details' : section, 'details');
  // País's list, named once here on the server (see `SiteDetailsForm`).
  const locale = await getLocale();
  const regionNames = new Intl.DisplayNames([locale], { type: 'region' });
  const countries =
    current === 'details'
      ? COUNTRY_CODES.map((code) => ({ value: code, label: regionNames.of(code) ?? code })).sort((a, b) =>
          a.label.localeCompare(b.label, locale),
        )
      : [];
  // The club's name for Geral's form: the owner may change it there.
  const clubName =
    current === 'details' && site.canManage
      ? await readTaxSettings().then((r) => (r.state === 'ok' ? r.data.clubName : ''))
      : '';

  return (
    <>
      <SectionPills
        label={t('facilities.section.nav')}
        current={current}
        items={offered.map((key) => ({
          key,
          label: t(`facilities.section.${key}`),
          href: sectionUrl(path, { tab: 'general', from }, key),
        }))}
      />

      {/*
        Counts first, because "how big is this" is the question story 2 says the
        screen exists to answer. Absent entirely for anybody who is not an owner
        or an admin — the API does not send them, so there is nothing here to
        hide badly.
      */}
      {current === 'people' && site.counts !== undefined && (
        <section className="flex flex-col gap-4 rounded bg-surface p-5 shadow-card">
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
                <FromLink
                  href={group.href}
                  className="flex flex-col gap-0.5 rounded border border-border p-3 transition-colors hover:border-primary/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  {/*
                    Zero renders as 0, never as an absence. "No instructors yet"
                    and "this screen forgot to load" look identical when the row
                    simply is not there.
                  */}
                  <span className="text-2xl font-semibold">{site.counts?.[group.key] ?? 0}</span>
                  <span className="text-sm text-foreground-muted">{t(group.label)}</span>
                </FromLink>
              </li>
            ))}
          </ul>
        </section>
      )}

      {current === 'club' && site.canManage && <ClubSection facilityId={site.id} />}

      {current === 'weather' && (
        <WeatherPanel city={site.city} latitude={site.latitude} longitude={site.longitude} />
      )}

      {/* Geral: the site's details, where the page opens (Rui, 10-11-2026). */}
      {current === 'details' && site.canManage && (
        <section className="rounded bg-surface p-5 shadow-card">
          <SiteDetailsForm
            facilityId={site.id}
            canRename={site.canRename}
            clubName={clubName}
            facilityName={site.name}
            address={site.address}
            postalCode={site.postalCode}
            district={site.district}
            countryCode={site.countryCode}
            countries={countries}
            locality={
              <CityPicker
                key="locality"
                organizationId={site.organizationId}
                facilityId={site.id}
                city={site.city}
                countryCode={site.countryCode}
              />
            }
          />
        </section>
      )}

      {/*
        The site's standing rules — round 4. Readable by anyone who may see the
        site — "we do not open on Sundays" is what makes the calendar's gaps
        explicable — and writable only by an owner or admin, which the API
        enforces rather than this.
      */}
      {current === 'hours' && (
        <section className="flex flex-col gap-4 rounded bg-surface p-5 shadow-card">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
              {t('facilities.hours')}
            </h2>
            {/*
              Closures live in the calendar and stay there: a second place to enter
              them would be a second place for them to disagree.
            */}
            <FromLink
              href={'/dashboard/calendar/closures'}
              className="rounded text-sm text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              {t('facilities.manageClosures')}
            </FromLink>
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
      )}

      {/*
        How old a tank's latest analysis may be — POOLSE-66 slice 2b. A standing
        rule of the site, beside its opening hours; the dashboard's water card
        calls a tank "due" past it, and an empty box flags nothing.
      */}
      {current === 'water' && (
        <section className="flex flex-col gap-3 rounded bg-surface p-5 shadow-card">
          <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
            {t('facilities.waterThreshold.title')}
          </h2>
          <WaterThresholdForm
            facilityId={site.id}
            hours={site.waterAnalysisMaxAgeHours}
            canManage={site.canManage}
          />
        </section>
      )}
    </>
  );
}

/**
 * How the site looks — the *Fotografias* tab: the club's logo and this site's
 * photographs. The logo first (POOLSE-104 C): both are how the club looks, and
 * its card says it is the club's, not this site's.
 */
async function SitePhotos({ site }: { site: FacilityDetail }): Promise<React.ReactElement> {
  const t = await getTranslations();
  return (
    <>
      <LogoPanel />
      <section className="rounded bg-surface p-5 shadow-card">
        <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-foreground-muted">
          {t('facilities.sitePhotos')}
        </h2>
        <PhotoGallery
          photos={site.photos}
          target={`facility-photo:${site.id}`}
          canManage={site.canManage}
          emptyLabel={t('facilities.noSitePhotos')}
          uploadLabel={t('facilities.uploadSitePhoto')}
        />
      </section>
    </>
  );
}

/**
 * Ocupação asks for the sport first — POOLSE-151 (Rui, 04-11-2026). A club with
 * one sport goes straight to it; a club with several picks one (`?sport=`) and
 * sees no figures until it has. The link below names the sport's calendar.
 *
 * **Only swimming has figures.** Occupancy is lane-hours of the site's pools
 * (POOLSE-52), so a court has none under that definition; it says so in words
 * and still links to its sport's calendar, rather than showing a 0 % that looks
 * measured. A court's own measure is POOLSE-128's to decide.
 */
async function OccupancyTab({
  facilityId,
  path,
  from,
  sports,
  asked,
}: {
  facilityId: string;
  path: string;
  from: string | undefined;
  sports: PoolseSport[];
  asked: string | undefined;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const multi = sports.length > 1;
  const chosen: PoolseSport | null = multi ? (sports.find((one) => one === asked) ?? null) : 'pool';

  const chooser = multi && (
    <nav aria-label={t('occupancy.sportNav')} className={SUB_MENU_ROW}>
      {sports.map((one) => (
        <FromLink
          key={one}
          href={`${path}?${new URLSearchParams({ tab: 'occupancy', ...(from === undefined ? {} : { from }), sport: one })}`}
          aria-current={one === chosen ? 'page' : undefined}
          className={subMenuPillClass(one === chosen)}
        >
          <SportIcon sport={one} className="size-4" />
          {t(sportNameKey(one))}
        </FromLink>
      ))}
    </nav>
  );

  if (chosen === null) {
    return (
      <>
        {chooser}
        <p className="text-sm text-foreground-muted">{t('occupancy.pickSport')}</p>
      </>
    );
  }

  const calendarLabel = t('occupancy.sportCalendar', { sport: t(sportNameKey(chosen)) });

  if (chosen !== 'pool') {
    return (
      <>
        {chooser}
        <section className="flex flex-col gap-3 rounded bg-surface p-5 shadow-card">
          <p className="text-sm text-foreground-muted">
            {t('occupancy.sportPending', { sport: t(sportNameKey(chosen)) })}
          </p>
          <FromLink
            href={`/dashboard/calendar?sport=${chosen}`}
            className="self-start rounded text-sm text-primary hover:underline coarse:-my-3 coarse:py-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {calendarLabel}
          </FromLink>
        </section>
      </>
    );
  }

  const occupancy = await apiFetch<Occupancy>(`/facilities/${facilityId}/occupancy`).catch(() => null);
  return (
    <>
      {chooser}
      {occupancy === null ? (
        <PageError message={t('occupancy.unavailable')} />
      ) : (
        <OccupancyPanel
          occupancy={occupancy}
          facilityId={facilityId}
          calendarHref="/dashboard/calendar"
          calendarLabel={calendarLabel}
        />
      )}
    </>
  );
}
