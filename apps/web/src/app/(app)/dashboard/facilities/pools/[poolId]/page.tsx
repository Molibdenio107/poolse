import { getFormatter, getTranslations } from 'next-intl/server';
import { describeLoad, type LoadFailure } from '@/lib/load-failure';
import { ApiError, apiFetch, type LabResult, type PoolCostReport, type PoolDetail } from '@/lib/api';
import { backTarget } from '@/lib/back';
import { EntityIcon } from '@/components/entity-icon';
import { PhotoGallery } from '@/components/photo-gallery';
import { ArchiveButton } from '../../facility-forms';
import { PoolForm } from '../../pool-form';
import { ReadingsBlock } from '../../readings-block';
import { PageError, PageShell } from '@/components/page-shell';
import { DetailPage } from '@/components/detail-page';
import { excursions } from '@/lib/water';
import { CostPerUsePanel } from './cost-per-use-panel';
import { PublicLinkPanel } from './public-link-panel';
import { outcome } from '@/lib/load-failure';
import { publicLinkView } from '@/lib/public-water-link';

/**
 * One pool: its details, editable, and its gallery.
 *
 * The two belong together and that is the whole shape of this screen. Describing
 * a pool and photographing it are the same job done at the same moment — an
 * operator walking the site with a phone. Splitting them across a form here and
 * a gallery somewhere else would mean two visits to record one thing.
 *
 * Read-only for anyone who cannot manage facilities: an instructor should be able
 * to look up which pool has six lanes without being offered a save button that
 * the API would refuse.
 *
 * **Tabs since the detail-tabs change**: General (the details, with Arquivar at
 * its foot), Qualidade da água, Custo por utilização and Fotografias. Water
 * quality shows one section at a time by `?section=` — `ReadingsBlock` decides
 * which are offered, since it is the one that knows what each would draw.
 */
export default async function PoolPage({
  params,
  searchParams,
}: {
  params: Promise<{ poolId: string }>;
  searchParams: Promise<{ from?: string; tab?: string | string[]; section?: string | string[] }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const format = await getFormatter();
  const { poolId } = await params;
  const { from, tab, section } = await searchParams;

  /*
   * A pool is reached from the site list and from the site itself, and those are
   * different places to be returned to — R4. `lib/back.ts`.
   */
  const back = backTarget(from, '/dashboard/facilities');

  let pool: (PoolDetail & { canManage: boolean; canRecordAnalysis: boolean }) | null = null;
  let failure: LoadFailure | null = null;
  let missing = false;

  try {
    pool = await apiFetch<PoolDetail & { canManage: boolean; canRecordAnalysis: boolean }>(
      `/facilities/pools/${poolId}`,
    );
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) {
      missing = true;
    } else {
      failure = describeLoad(error);
    }
  }

  if (pool === null) {
    return (
      <PageShell
        title={t('facilities.editPool')}
        back={{ href: back.href, label: t(back.labelKey) }}
      >
        {missing && (
          <section className="rounded border border-border bg-surface p-5">
            <p>{t('facilities.poolNotFound')}</p>
          </section>
        )}

        {failure !== null && (
          <PageError
            message={t(failure.key)}
            {...(failure.detail === '' ? {} : { detail: failure.detail })}
          />
        )}
      </PageShell>
    );
  }

  const loaded = pool;
  const latest = loaded.analyses[loaded.analyses.length - 1];
  // The same judgement the readings block and the alert email make — never a
  // second one: `excursions` against the API's resolved bands.
  const outOfBand = latest !== undefined && excursions(latest.values, loaded.bands).length > 0;

  return (
    <DetailPage
      title={loaded.name}
      subtitle={loaded.facilityName}
      back={{ href: back.href, label: t(back.labelKey) }}
      /*
        The import is not here — round 6, ticket 1, reversing round 5. A page
        header is about the page, and this is about the readings: it sits in the
        Water quality tab directly under "Record an analysis".
      */
      actions={<EntityIcon kind="pool" className="size-6 text-primary" />}
      requested={tab}
      tabs={[
        {
          slug: 'general',
          labelKey: 'detailTabs.general',
          content: () => (
            <>
              <section className="rounded border border-border bg-surface p-5">
                <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-foreground-muted">
                  {t('facilities.details')}
                </h2>

                {loaded.canManage ? (
                  <PoolForm
                    organizationId={loaded.organizationId}
                    facilityId={loaded.facilityId}
                    pool={loaded}
                    mode="edit"
                  />
                ) : (
                  <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Detail
                      label={t('facilities.kindLabel')}
                      value={t(`facilities.kind.${loaded.kind}`)}
                    />
                    <Detail
                      label={t('facilities.useLabel')}
                      value={loaded.use === null ? t('facilities.useNone') : t(`facilities.use.${loaded.use}`)}
                    />
                    <Detail
                      label={t('facilities.lengthLabel')}
                      value={loaded.lengthM === null ? null : `${loaded.lengthM}`}
                    />
                    <Detail
                      label={t('facilities.widthLabel')}
                      value={loaded.widthM === null ? null : `${loaded.widthM}`}
                    />
                    <Detail
                      label={t('facilities.minDepthLabel')}
                      value={loaded.minDepthM === null ? null : `${loaded.minDepthM}`}
                    />
                    <Detail
                      label={t('facilities.depthLabel')}
                      value={loaded.maxDepthM === null ? null : `${loaded.maxDepthM}`}
                    />
                    <Detail
                      label={t('facilities.lanesLabel')}
                      value={loaded.laneCount === null ? null : `${loaded.laneCount}`}
                    />
                    {/*
                      The tank's ceiling — round 5, 4.2. Unset says so in words:
                      what an operator needs to know is that no limit is being
                      enforced on this tank, not that a field is blank.
                    */}
                    <Detail
                      label={t('facilities.maxCapacityLabel')}
                      value={
                        loaded.maxCapacity === null
                          ? t('facilities.maxCapacityUnlimited')
                          : `${loaded.maxCapacity}`
                      }
                    />
                    {/*
                      Grouped and in both units — round 4. A pool is quoted in m3
                      as often as in litres.
                    */}
                    <Detail
                      label={t('facilities.volumeLabel')}
                      value={
                        loaded.volumeLitres === null
                          ? null
                          : `${format.number(loaded.volumeLitres, { maximumFractionDigits: 2 })} L · ${format.number(loaded.volumeLitres / 1000, { maximumFractionDigits: 2 })} m³`
                      }
                    />
                  </dl>
                )}
              </section>

              {loaded.canManage && (
                <section className="flex flex-wrap items-center justify-between gap-3 rounded border border-border bg-surface p-5">
                  <span className="text-sm text-foreground-muted">
                    {t('facilities.archivePoolHint')}
                  </span>
                  {/*
                    Archiving belongs beside the thing it archives — at the foot
                    of the details it would retire.
                  */}
                  <ArchiveButton organizationId={loaded.organizationId} poolId={loaded.id} />
                </section>
              )}
            </>
          ),
        },
        {
          /*
            Water quality, as a tab of its own rather than more rows on the
            details form — round 4. Deliberately not on the create form either:
            somebody adding a pool is describing a tank, and its readings are
            what accumulates afterwards. The kit is not here at all — Inventário
            is a screen under Instalações.
          */
          slug: 'water',
          labelKey: 'facilities.readings',
          badge: outOfBand ? { kind: 'dot', labelKey: 'detailTabs.badge.waterOutOfBand' } : undefined,
          content: async () => {
            // Laboratory reports — POOLSE-72. A refusal hides the section; a
            // failure keeps it and says so, never a silent absence.
            const lab = await outcome(
              apiFetch<{ results: LabResult[] }>(`/facilities/pools/${poolId}/lab-results`),
            );
            return (
            <section className="rounded border border-border bg-surface p-5">
              <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-foreground-muted">
                {t('facilities.readings')}
              </h2>
              <ReadingsBlock
                organizationId={loaded.organizationId}
                poolId={loaded.id}
                poolName={loaded.name}
                analyses={loaded.analyses}
                alerts={loaded.alerts}
                bands={loaded.bands}
                reference={loaded.reference}
                labResults={lab.state === 'ok' ? lab.data.results : null}
                labFailed={lab.state === 'failed'}
                bandOverrides={loaded.bandOverrides}
                emailConfigured={loaded.emailConfigured}
                canManage={loaded.canManage}
                canRecord={loaded.canRecordAnalysis}
                section={section}
                from={from}
              />
            </section>
            );
          },
        },
        {
          /*
            What the tank costs per hour taught in it — POOLSE-28.

            The report is owner and admin, narrower than the rest of this page —
            the same two roles as `canManage`, so the tab is decided without
            asking for the report, which is fetched only when the tab opens. A
            maintenance member sees no tab for a thing they cannot open.
          */
          slug: 'cost',
          labelKey: 'energy.perUse.section',
          visible: loaded.canManage,
          content: async () => {
            const report = await apiFetch<PoolCostReport>(
              `/energy/pools/${poolId}/cost-report`,
            ).catch(() => null);
            return report === null ? (
              <PageError message={t('detailTabs.loadFailed')} />
            ) : (
              <CostPerUsePanel report={report} />
            );
          },
        },
        {
          /*
            The public water page — POOLSE-71. The roles that record an
            analysis decide whether the readings go on the wall, so the tab
            follows `canRecordAnalysis` rather than a list of its own.
          */
          slug: 'public',
          labelKey: 'publicWater.manage.tab',
          visible: loaded.canRecordAnalysis,
          content: async () => {
            const link = await outcome(
              apiFetch<{ token: string | null; createdAt: string | null }>(
                `/pools/${poolId}/public-link`,
              ),
            );
            if (link.state !== 'ok') {
              return <PageError message={t('detailTabs.loadFailed')} />;
            }
            const view = await publicLinkView(link.data.token);
            return (
              <PublicLinkPanel
                organizationId={loaded.organizationId}
                poolId={loaded.id}
                poolName={loaded.name}
                link={{ ...view, createdAt: link.data.createdAt }}
              />
            );
          },
        },
        {
          slug: 'photos',
          labelKey: 'facilities.photos',
          content: () => (
            <section className="rounded border border-border bg-surface p-5">
              <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-foreground-muted">
                {t('facilities.photos')}
              </h2>
              <PhotoGallery
                photos={loaded.photos}
                target={`pool-photo:${loaded.id}`}
                canManage={loaded.canManage}
                emptyLabel={t('facilities.noPhotos')}
                uploadLabel={t('facilities.uploadPoolPhoto')}
              />
            </section>
          ),
        },
      ]}
    />
  );
}

/** An unrecorded measurement shows a dash, not a blank — the row still reads. */
function Detail({ label, value }: { label: string; value: string | null }): React.ReactElement {
  return (
    <div className="flex flex-col">
      <dt className="text-sm text-foreground-muted">{label}</dt>
      <dd>{value ?? '—'}</dd>
    </div>
  );
}
