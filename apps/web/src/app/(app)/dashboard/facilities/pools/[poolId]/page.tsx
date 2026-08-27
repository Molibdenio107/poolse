import { getTranslations } from 'next-intl/server';
import { ApiError, apiFetch, type PoolDetail } from '@/lib/api';
import { EntityIcon } from '@/components/entity-icon';
import { PhotoGallery } from '@/components/photo-gallery';
import { ArchiveButton } from '../../facility-forms';
import { PoolForm } from '../../pool-form';
import { PageShell } from '@/components/page-shell';

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
}: {
  params: Promise<{ poolId: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const { poolId } = await params;

  let pool: (PoolDetail & { canManage: boolean }) | null = null;
  let failure: string | null = null;
  let missing = false;

  try {
    pool = await apiFetch<PoolDetail & { canManage: boolean }>(`/facilities/pools/${poolId}`);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) {
      missing = true;
    } else {
      failure = error instanceof ApiError ? `${error.status} ${error.message}` : String(error);
    }
  }

  return (
    <PageShell
      title={pool?.name ?? t('facilities.editPool')}
      subtitle={pool?.facilityName ?? ''}
      back={{ href: "/dashboard/facilities", label: t('facilities.backToFacilities') }}
      actions={<EntityIcon kind="pool" className="size-6 text-primary" />}
    >


      {missing && (
        <section className="rounded border border-border bg-surface p-5">
          <p>{t('facilities.poolNotFound')}</p>
        </section>
      )}

      {failure !== null && (
        <section className="rounded border border-danger/40 bg-danger/10 p-5">
          <p className="font-medium text-danger">{t('account.unavailable')}</p>
          <p className="mt-1 font-mono text-sm text-foreground-muted">{failure}</p>
        </section>
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
                  label={t('facilities.depthLabel')}
                  value={pool.maxDepthM === null ? null : `${pool.maxDepthM}`}
                />
                <Detail
                  label={t('facilities.lanesLabel')}
                  value={pool.laneCount === null ? null : `${pool.laneCount}`}
                />
                <Detail
                  label={t('facilities.volumeLabel')}
                  value={pool.volumeLitres === null ? null : `${pool.volumeLitres}`}
                />
              </dl>
            )}
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
