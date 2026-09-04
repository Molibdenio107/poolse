import { getFormatter, getTranslations } from 'next-intl/server';
import { describeLoad, type LoadFailure } from '@/lib/load-failure';
import { ApiError, apiFetch, type PoolDetail } from '@/lib/api';
import { backTarget } from '@/lib/back';
import { EntityIcon } from '@/components/entity-icon';
import { PhotoGallery } from '@/components/photo-gallery';
import { ArchiveButton } from '../../facility-forms';
import { PoolForm } from '../../pool-form';
import { ReadingsBlock } from '../../readings-block';
import { PageError, PageShell } from '@/components/page-shell';

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
 */
export default async function PoolPage({
  params,
  searchParams,
}: {
  params: Promise<{ poolId: string }>;
  searchParams: Promise<{ from?: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const format = await getFormatter();
  const { poolId } = await params;
  const { from } = await searchParams;

  /*
   * A pool is reached from the site list and from the site itself, and those are
   * different places to be returned to — R4. `lib/back.ts`.
   */
  const back = backTarget(from, '/dashboard/facilities');

  let pool: (PoolDetail & { canManage: boolean }) | null = null;
  let failure: LoadFailure | null = null;
  let missing = false;

  try {
    pool = await apiFetch<PoolDetail & { canManage: boolean }>(`/facilities/pools/${poolId}`);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) {
      missing = true;
    } else {
      failure = describeLoad(error);
    }
  }

  return (
    <PageShell
      title={pool?.name ?? t('facilities.editPool')}
      subtitle={pool?.facilityName ?? ''}
      back={{ href: back.href, label: t(back.labelKey) }}
      actions={<EntityIcon kind="pool" className="size-6 text-primary" />}
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

      {pool !== null && (
        <>
          <section className="rounded border border-border bg-surface p-5">
            <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-foreground-muted">
              {t('facilities.details')}
            </h2>

            {pool.canManage ? (
              <PoolForm
                organizationId={pool.organizationId}
                facilityId={pool.facilityId}
                pool={pool}
                mode="edit"
              />
            ) : (
              <dl className="grid gap-4 sm:grid-cols-2">
                <Detail
                  label={t('facilities.kindLabel')}
                  value={t(`facilities.kind.${pool.kind}`)}
                />
                <Detail
                  label={t('facilities.lengthLabel')}
                  value={pool.lengthM === null ? null : `${pool.lengthM}`}
                />
                <Detail
                  label={t('facilities.widthLabel')}
                  value={pool.widthM === null ? null : `${pool.widthM}`}
                />
                <Detail
                  label={t('facilities.minDepthLabel')}
                  value={pool.minDepthM === null ? null : `${pool.minDepthM}`}
                />
                <Detail
                  label={t('facilities.depthLabel')}
                  value={pool.maxDepthM === null ? null : `${pool.maxDepthM}`}
                />
                <Detail
                  label={t('facilities.lanesLabel')}
                  value={pool.laneCount === null ? null : `${pool.laneCount}`}
                />
                {/*
                  Grouped and in both units — round 4. A bare 106500 is a number
                  somebody has to count the digits of, and a pool is quoted in m3
                  as often as in litres.
                */}
                <Detail
                  label={t('facilities.volumeLabel')}
                  value={
                    pool.volumeLitres === null
                      ? null
                      : `${format.number(pool.volumeLitres, { maximumFractionDigits: 2 })} L · ${format.number(pool.volumeLitres / 1000, { maximumFractionDigits: 2 })} m³`
                  }
                />
              </dl>
            )}
          </section>

          {/*
            Water quality, as a block of its own rather than more rows on the
            details form — round 4.

            Deliberately not on the create form either. Somebody adding a pool is
            describing a tank; its readings are what accumulates afterwards, and
            putting them in the creation flow would ask for answers nobody has
            yet at the one moment they are least likely to have them.

            The kit is not here at all — Inventário is a screen under Instalações,
            because an item belongs to a site and serves whichever tanks need it.
          */}
          <section className="rounded border border-border bg-surface p-5">
            <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-foreground-muted">
              {t('facilities.readings')}
            </h2>
            <ReadingsBlock
              organizationId={pool.organizationId}
              poolId={pool.id}
              poolName={pool.name}
              analyses={pool.analyses}
              canManage={pool.canManage}
            />
          </section>

          <section className="rounded border border-border bg-surface p-5">
            <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-foreground-muted">
              {t('facilities.photos')}
            </h2>
            <PhotoGallery
              photos={pool.photos}
              canManage={pool.canManage}
              emptyLabel={t('facilities.noPhotos')}
              uploadLabel={t('facilities.uploadPoolPhoto')}
              uploadReason={t('students.photoNoStorage')}
            />
          </section>

          {pool.canManage && (
            <section className="flex flex-wrap items-center justify-between gap-3 rounded border border-border bg-surface p-5">
              <span className="text-sm text-foreground-muted">
                {t('facilities.archivePoolHint')}
              </span>
              {/*
                Moved here from the list. Archiving belongs beside the thing it
                archives, not on a row somebody is scanning past.
              */}
              <ArchiveButton organizationId={pool.organizationId} poolId={pool.id} />
            </section>
          )}
        </>
      )}
    </PageShell>
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
