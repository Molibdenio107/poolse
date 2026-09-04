import { redirect } from 'next/navigation';
import { describeLoad, type LoadFailure } from '@/lib/load-failure';
import { getTranslations } from 'next-intl/server';
import { ApiError, apiFetch, type Inventory } from '@/lib/api';
import { EntityIcon } from '@/components/entity-icon';
import { PageError, PageShell } from '@/components/page-shell';
import { Pagination } from '@/components/pagination';
import { isPastEnd, lastPage, pageHref, readPage } from '@/lib/pagination';
import { InventoryPanel } from './inventory-panel';

const BASE = '/dashboard/facilities/inventory';

/**
 * Inventário — round 6.
 *
 * A screen of its own, under Instalações, rather than a block on the pool page.
 * The move follows the model: an item belongs to a *facility* and says which
 * tanks it serves, so a page about one tank was never where the whole list
 * belonged — and the operator doing a stocktake walks the store room once, not
 * once per pool.
 *
 * **Search and paging, the same way the register does them.** Both live in the
 * query string, so a filtered view is a real URL that survives a refresh and can
 * be sent to somebody — and the search works before any JavaScript has loaded.
 * The store room is paginated because it grows as the club buys things, which is
 * the test CONVENTIONS applies rather than a judgement about how long the list
 * feels.
 *
 * Read-only for anyone who cannot manage facilities. An instructor who wants to
 * know whether there are enough pranchas for a class is asking a reasonable
 * question and should not be offered a save button the API would refuse.
 */
export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ facilityId?: string; search?: string; page?: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const {
    facilityId: requested = '',
    search = '',
    page: pageParam,
  } = await searchParams;

  const page = readPage(pageParam);

  const query = new URLSearchParams();
  if (requested.trim()) query.set('facilityId', requested.trim());
  if (search.trim()) query.set('search', search.trim());
  if (page > 1) query.set('page', String(page));

  let data: Inventory | null = null;
  let failure: LoadFailure | null = null;
  let noOrganization = false;

  try {
    /*
     * The site list travels with the store rather than being fetched
     * separately: the picker cannot render without it, and a second round trip
     * would put a loading state on a `<select>`. An unknown or archived id falls
     * back to the first site on the API side, so a stale bookmark still shows
     * somebody an inventory.
     */
    data = await apiFetch<Inventory>(`/inventory${query.size > 0 ? `?${query}` : ''}`);
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) noOrganization = true;
    else failure = describeLoad(error);
  }

  /*
   * A page that has fallen off the end — the same two ordinary causes as the
   * register: a link to `?page=999`, and archiving the last row on the last
   * page. A redirect rather than a clamp, so the URL tells the truth about which
   * page is on screen.
   */
  if (data !== null && isPastEnd(page, data.items.total, data.items.limit)) {
    redirect(
      pageHref(
        BASE,
        { facilityId: data.facilityId ?? '', search },
        lastPage(data.items.total, data.items.limit),
      ),
    );
  }

  return (
    <PageShell
      title={t('inventory.title')}
      subtitle={t('inventory.subtitle')}
      back={{ href: '/dashboard/facilities', label: t('facilities.backToSites') }}
      actions={<EntityIcon kind="facility" className="size-6 text-primary" />}
    >
      {noOrganization && (
        <section className="rounded border border-border bg-surface p-5">
          <p>{t('account.noOrganizations')}</p>
        </section>
      )}

      {failure !== null && (
        <PageError
          message={t(failure.key)}
          {...(failure.detail === '' ? {} : { detail: failure.detail })}
        />
      )}

      {/*
        A club with no site yet has nowhere to keep anything, and the useful
        thing to say is where sites are created — not an empty list with an add
        form that would 404 on save.
      */}
      {data !== null && data.facilityId === null && (
        <section className="rounded border border-border bg-surface p-5">
          <p>{t('inventory.noSites')}</p>
        </section>
      )}

      {data !== null && data.facilityId !== null && (
        <>
          {!data.canManage && (
            <p className="text-sm text-foreground-muted">{t('inventory.readOnly')}</p>
          )}


          <InventoryPanel
            organizationId={data.organizationId}
            facilities={data.facilities}
            facilityId={data.facilityId}
            items={data.items.items}
            total={data.items.total}
            search={search.trim()}
            canManage={data.canManage}
          />

          <Pagination
            page={data.items}
            basePath={BASE}
            query={{ facilityId: data.facilityId, search }}
          />
        </>
      )}
    </PageShell>
  );
}
