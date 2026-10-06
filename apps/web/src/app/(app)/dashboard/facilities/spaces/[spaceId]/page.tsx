import { getTranslations } from 'next-intl/server';
import { describeLoad, type LoadFailure } from '@/lib/load-failure';
import { ApiError, apiFetch, type SpaceDetail } from '@/lib/api';
import { backTarget } from '@/lib/back';
import { EntityIcon } from '@/components/entity-icon';
import { Pagination } from '@/components/pagination';
import { PageError, PageShell } from '@/components/page-shell';
import { DetailPage } from '@/components/detail-page';
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
 * **Tabs since the detail-tabs change**: General (the state and Marcar como
 * limpo), Histórico de limpezas and Ocorrências. All three come from one
 * request, so there is nothing to defer; the history's page number rides in the
 * URL beside the tab.
 *
 * Reachable by any member; every control on it is gated by what the API says
 * this person may do, and the API enforces the same answer again on the way in.
 */
export default async function SpacePage({
  params,
  searchParams,
}: {
  params: Promise<{ spaceId: string }>;
  searchParams: Promise<{ from?: string; page?: string; tab?: string | string[] }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const { spaceId } = await params;
  const { from, page, tab } = await searchParams;

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

  if (detail === null) {
    return (
      <PageShell
        title={t('spaces.title')}
        back={{ href: back.href, label: t(back.labelKey) }}
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
      </PageShell>
    );
  }

  const loaded = detail;
  const open = loaded.issues.filter((issue) => issue.status === 'open').length;

  return (
    <DetailPage
      title={loaded.space.name}
      subtitle={t(`spaces.type.${loaded.space.type}`)}
      back={{ href: back.href, label: t(back.labelKey) }}
      actions={<EntityIcon kind="facility" className="size-6 text-primary" />}
      requested={tab}
      tabs={[
        {
          slug: 'general',
          labelKey: 'detailTabs.general',
          badge: loaded.space.overdue
            ? { kind: 'dot', labelKey: 'detailTabs.badge.spaceOverdue' }
            : undefined,
          content: () => (
            <>
              <SpaceHeader space={loaded.space} canManage={loaded.canManage} />

              {loaded.canLog && (
                <CleanAction spaceId={loaded.space.id} facilityId={loaded.facilityId} />
              )}
            </>
          ),
        },
        {
          slug: 'history',
          labelKey: 'spaces.history',
          content: () => (
            <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
              <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
                {t('spaces.history')}
              </h2>

              <CleaningHistory
                spaceId={loaded.space.id}
                facilityId={loaded.facilityId}
                cleanings={loaded.cleanings.items}
                canManage={loaded.canManage}
              />

              {/* The tab rides along, or paging would land back on General. */}
              <Pagination
                page={loaded.cleanings}
                basePath={`/dashboard/facilities/spaces/${loaded.space.id}`}
                query={{ ...(from === undefined ? {} : { from }), tab: 'history' }}
              />
            </section>
          ),
        },
        {
          slug: 'issues',
          labelKey: 'spaces.issues',
          badge: open > 0 ? { kind: 'count', value: open } : undefined,
          content: () => (
            <IssuesPanel
              spaceId={loaded.space.id}
              facilityId={loaded.facilityId}
              issues={loaded.issues}
              canLog={loaded.canLog}
              canResolve={loaded.canResolve}
              canManage={loaded.canManage}
            />
          ),
        },
      ]}
    />
  );
}
