import { getTranslations } from 'next-intl/server';
import { describeLoad, type LoadFailure } from '@/lib/load-failure';
import { ApiError, apiFetch, type SpaceDetail } from '@/lib/api';
import { backTarget } from '@/lib/back';
import { EntityIcon } from '@/components/entity-icon';
import { Pagination } from '@/components/pagination';
import { PageError, PageShell } from '@/components/page-shell';
import { SpaceHeader } from './space-header';
import { CleanAction } from './clean-action';
import { CleaningHistory } from './cleaning-history';
import { IssuesPanel } from './issues-panel';

/**
 * One espaço: how it is doing, and what has happened in it. Round 6.
 *
 * The order is the order somebody standing in the room needs it. *Is it overdue*
 * at the top, because that is the question. *Marcar como limpo* immediately
 * under it, because for most visits that is the whole errand. Then the history,
 * then the issues.
 *
 * Reachable by any member; every control on it is gated by what the API says
 * this person may do, and the API enforces the same answer again on the way in.
 */
export default async function SpacePage({
  params,
  searchParams,
}: {
  params: Promise<{ spaceId: string }>;
  searchParams: Promise<{ from?: string; page?: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const { spaceId } = await params;
  const { from, page } = await searchParams;

  // Reached from the site page, and one day from a QR code on the door — both
  // need somewhere to go back to. `lib/back.ts`.
  const back = backTarget(from, '/dashboard/facilities');

  let detail: SpaceDetail | null = null;
  let failure: LoadFailure | null = null;
  let missing = false;

  try {
    detail = await apiFetch<SpaceDetail>(
      `/spaces/${spaceId}${page === undefined ? '' : `?page=${encodeURIComponent(page)}`}`,
    );
  } catch (error) {
    /*
     * 403 is folded into "not found", deliberately.
     *
     * A space id belonging to another tenant must not be distinguishable from
     * one that does not exist — the difference is itself an answer about who
     * else uses this product.
     */
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) {
      missing = true;
    } else {
      failure = describeLoad(error);
    }
  }

  return (
    <PageShell
      title={detail?.space.name ?? t('spaces.title')}
      subtitle={detail === null ? undefined : t(`spaces.type.${detail.space.type}`)}
      back={{ href: back.href, label: t(back.labelKey) }}
      actions={<EntityIcon kind="facility" className="size-6 text-primary" />}
    >
      {missing && (
        <section className="rounded border border-border bg-surface p-5">
          <p>{t('spaces.notFound')}</p>
        </section>
      )}

      {failure !== null && (
        <PageError
          message={t(failure.key)}
          {...(failure.detail === '' ? {} : { detail: failure.detail })}
        />
      )}

      {detail !== null && (
        <>
          <SpaceHeader space={detail.space} canManage={detail.canManage} />

          {detail.canLog && (
            <CleanAction spaceId={detail.space.id} facilityId={detail.facilityId} />
          )}

          <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
            <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
              {t('spaces.history')}
            </h2>

            <CleaningHistory
              spaceId={detail.space.id}
              facilityId={detail.facilityId}
              cleanings={detail.cleanings.items}
              canManage={detail.canManage}
            />

            <Pagination
              page={detail.cleanings}
              basePath={`/dashboard/facilities/spaces/${detail.space.id}`}
              query={{ ...(from === undefined ? {} : { from }) }}
            />
          </section>

          <IssuesPanel
            spaceId={detail.space.id}
            facilityId={detail.facilityId}
            issues={detail.issues}
            canLog={detail.canLog}
            canResolve={detail.canResolve}
            canManage={detail.canManage}
          />
        </>
      )}
    </PageShell>
  );
}
