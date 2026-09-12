import { redirect } from 'next/navigation';
import { getFormatter, getLocale, getTranslations } from 'next-intl/server';
import { Building2, User } from 'lucide-react';
import Link from 'next/link';
import { ApiError, apiFetch, type PlatformTenant } from '@/lib/api';
import { DataTable, type Column } from '@/components/data-table';
import { PageEmpty, PageError, PageShell } from '@/components/page-shell';
import { Pagination } from '@/components/pagination';
import { SearchInput, SearchStatus } from '@/components/search-input';
import { describeLoad, type LoadFailure } from '@/lib/load-failure';
import { isPastEnd, lastPage, pageHref, readPage } from '@/lib/pagination';
import type { Paginated } from '@/lib/pagination';
import { timeAgo } from '@/lib/relative-time';
import { cn } from '@/lib/utils';
import { HealthBadge } from './health-badge';
import { StatusStrip } from './status-strip';
import { SubscriptionBadge } from './subscription-badge';

/**
 * Every tenant, one row each — platform admin, slice 1.
 *
 * Read-only. There is nothing to press: extending a trial, changing a plan,
 * suspending and "view as" are the next slice, and a screen that offers half of
 * them would be a screen whose disabled controls need explaining.
 *
 * **The redirect lives here rather than in the layout**, and that is worth a
 * sentence. The page already asks the API a question only a platform
 * administrator may ask, so the answer to "may this person be here" is the
 * answer to "did that request work" — one round trip, one line in
 * `platform_audit_log`. Checking in the layout would double both, and the second
 * check could disagree with the first.
 *
 * The guard on the API is the real control. This only saves a non-admin from
 * looking at a shell wrapped round an error.
 */
export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; search?: string; sort?: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const format = await getFormatter();
  const locale = await getLocale();

  const { page: pageParam, search = '', sort } = await searchParams;
  const page = readPage(pageParam);
  const term = search.trim();

  let tenants: Paginated<PlatformTenant> | null = null;
  let failure: LoadFailure | null = null;
  let notConfigured = false;

  try {
    tenants = await apiFetch<Paginated<PlatformTenant>>(
      `/platform/tenants?${new URLSearchParams({
        ...(term === '' ? {} : { search: term }),
        ...(page > 1 ? { page: String(page) } : {}),
      })}`,
    );
  } catch (error) {
    if (error instanceof ApiError && error.code === 'not_platform_admin') {
      /*
       * Not an error screen. Somebody who is not an operator has no business
       * knowing this address resolves to anything, and the club they *are* a
       * member of is the right place to put them.
       */
      redirect('/dashboard');
    }

    if (error instanceof ApiError && error.code === 'platform_not_configured') {
      // A developer with no DATABASE_PLATFORM_URL, not a permission problem.
      // Said plainly, because "forbidden" would send them hunting for the wrong
      // thing entirely.
      notConfigured = true;
    } else {
      failure = describeLoad(error);
    }
  }

  if (tenants !== null && isPastEnd(page, tenants.total, tenants.limit)) {
    redirect(
      pageHref('/admin', { search: term }, lastPage(tenants.total, tenants.limit)),
    );
  }

  const columns = tenantColumns(t, format, locale);

  /*
   * Sorted in the page, not the query — and this is the one list in the product
   * where that is right.
   *
   * `health` is derived at read time from a 24-hour window rather than stored,
   * so there is no column to ORDER BY; sorting it in SQL would mean the derivation
   * moving into the statement and existing twice. The window is one page of ten
   * rows that has already been fetched, so ordering it here costs nothing and
   * cannot disagree with the badge beside it. The trade is honest and worth
   * naming: this sorts *the page*, not the whole list, which is exactly what a
   * reader scanning one screen wants and is not a substitute for a server sort
   * if tenants ever run to several pages.
   */
  const rows = sort === 'health' ? [...(tenants?.items ?? [])].sort(byHealth) : tenants?.items ?? [];

  return (
    <PageShell
      title={t('admin.title')}
      subtitle={t('admin.subtitle')}
      filters={
        <>
          <SearchInput
            label={t('admin.searchLabel')}
            placeholder={t('admin.searchPlaceholder')}
          />
          {/*
            The sort control lives here rather than in the table head, because
            `DataTable.header` takes a string and widening it is a change to a
            component every list in the app renders — proposed, not done inline.
            Links rather than buttons: this page is a server component whose
            filters are already a plain GET, so an anchor is linkable, survives a
            refresh and works before any JavaScript has loaded.
          */}
          <SortLinks current={sort} search={term} t={t} />
        </>
      }
    >
      {/*
        Is the server up — refreshed every 60s, above the table because it is the
        question that makes the table meaningful. A tenant's health is unreadable
        while the API is the thing that is broken.
      */}
      <StatusStrip />

      {notConfigured && (
        <PageError message={t('admin.notConfigured')} detail={t('admin.notConfiguredHint')} />
      )}

      {failure !== null && <PageError message={t(failure.key)} detail={failure.detail} />}

      {tenants !== null && (
        <>
          <SearchStatus total={tenants.total} term={term} />

          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(tenant) => tenant.id}
            empty={
              <PageEmpty
                message={term === '' ? t('admin.empty') : t('admin.noMatches', { term })}
              />
            }
          />

          <Pagination page={tenants} basePath="/admin" query={{ search: term || undefined }} />
        </>
      )}
    </PageShell>
  );
}

/**
 * "3 / 25", or "3" when there is no ceiling.
 *
 * A null ceiling means *not measured* and enforces nothing — the same reading as
 * `pool.max_capacity` and `space.expected_cleaning_interval_hours`. Rendering it
 * as "3 / 0" or "3 / —" would both invite the eye to read a limit where there is
 * none, so the limit simply is not drawn.
 *
 * Over the ceiling is marked, not hidden. `max_management_users` is a soft quota
 * that nothing enforces yet, so a tenant genuinely can sit above it, and that is
 * exactly the row the operator opened this screen to find.
 */
function Quota({ used, ceiling }: { used: number; ceiling: number | null }): React.ReactElement {
  if (ceiling === null) return <span className="tabular-nums">{used}</span>;

  return (
    <span className={used > ceiling ? 'font-medium text-danger tabular-nums' : 'tabular-nums'}>
      {used}
      <span className="text-foreground-muted"> / {ceiling}</span>
    </span>
  );
}

/**
 * The table's columns.
 *
 * A function below the component rather than a `const` inside it, and the reason
 * is `scripts/check-layout.mjs`: it greps everything above `<PageShell>` for
 * outer-layout classes, and a column renderer with a `px-2` chip in it looks
 * exactly like a page that set its own padding. Moving the definitions down
 * keeps the guard meaningful instead of teaching it an exception — and the page
 * body reads as the page rather than as a schema.
 */
function tenantColumns(
  t: Awaited<ReturnType<typeof getTranslations>>,
  format: Awaited<ReturnType<typeof getFormatter>>,
  locale: string,
): Column<PlatformTenant>[] {
  return [

    {
      key: 'name',
      header: t('admin.column.tenant'),
      render: (tenant) => (
        <div className="flex min-w-0 items-center gap-2">
          {/*
            A personal tenant is an ordinary tenant with fewer screens, and on
            this list it is worth telling apart at a glance — the seat and pool
            counts mean something different for one person's back garden than
            for a municipal pool. Icon plus the name, with the kind announced
            for anybody who cannot see the glyph.
          */}
          {tenant.kind === 'personal' ? (
            <User className="size-4 shrink-0 text-foreground-muted" aria-hidden />
          ) : (
            <Building2 className="size-4 shrink-0 text-foreground-muted" aria-hidden />
          )}
          <span className="sr-only">{t(`admin.kind.${tenant.kind}`)}</span>

          <div className="min-w-0">
            {/*
              The name is the way into the tenant's request history. A whole row
              that navigates would swallow the badges' own focus targets; a link
              on the name is where a reader already expects one.
            */}
            <Link
              href={`/admin/tenants/${tenant.id}`}
              className="block truncate font-medium hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              {tenant.name}
            </Link>
            <div className="truncate font-mono text-xs text-foreground-muted">
              {tenant.slug}
            </div>
          </div>

          {tenant.archivedAt !== null && (
            <span className="shrink-0 rounded bg-surface-muted px-2 py-0.5 text-xs text-foreground-muted">
              {t('admin.archived')}
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'health',
      header: t('admin.column.health'),
      render: (tenant) => (
        <HealthBadge
          health={tenant.health}
          requests={tenant.requestCount24h}
          count4xx={tenant.count4xx24h}
          count5xx={tenant.count5xx24h}
        />
      ),
    },
    {
      key: 'status',
      header: t('admin.column.status'),
      render: (tenant) => (
        <div className="flex flex-col items-start gap-1">
          <SubscriptionBadge status={tenant.subscriptionStatus} />
          {/*
            The trial's end date, in words, under the chip. A "trialing" badge
            with no date is the one state an operator cannot act on: it does not
            say whether there are ten days left or it lapsed on Tuesday.
          */}
          {tenant.trialEndsAt !== null && tenant.subscriptionStatus === 'trialing' && (
            <span className="text-xs text-foreground-muted">
              {t('admin.trialEnds', {
                date: format.dateTime(new Date(tenant.trialEndsAt), 'short'),
              })}
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'plan',
      header: t('admin.column.plan'),
      render: (tenant) =>
        /*
         * Null, and it says so in words rather than leaving a blank cell. Plan
         * tiers are indicative in the decisions log and modelled nowhere; an
         * empty cell would read as data that failed to load.
         */
        tenant.planTier ?? (
          <span className="text-sm text-foreground-muted">{t('admin.noPlan')}</span>
        ),
    },
    {
      key: 'seats',
      header: t('admin.column.seats'),
      numeric: true,
      render: (tenant) => (
        <Quota used={tenant.managementSeatsUsed} ceiling={tenant.maxManagementUsers} />
      ),
    },
    {
      key: 'facilities',
      header: t('admin.column.facilities'),
      numeric: true,
      render: (tenant) => <Quota used={tenant.facilityCount} ceiling={tenant.maxFacilities} />,
    },
    {
      key: 'pools',
      header: t('admin.column.pools'),
      numeric: true,
      render: (tenant) => tenant.poolCount,
    },
    {
      key: 'created',
      header: t('admin.column.created'),
      render: (tenant) => format.dateTime(new Date(tenant.createdAt), 'short'),
    },
    {
      key: 'activity',
      header: t('admin.column.activity'),
      render: (tenant) =>
        tenant.lastActivityAt === null ? (
          <span className="text-sm text-foreground-muted">{t('admin.neverActive')}</span>
        ) : (
          /*
            `timeAgo` returns the phrase and lets the catalogue own the word
            order — never "há 2 dias" assembled in a component, which is a
            Portuguese string hard-coded into an interface that ships in two
            languages.
          */
          <span title={format.dateTime(new Date(tenant.lastActivityAt), 'stamp')}>
            {t('admin.activeAgo', { ago: timeAgo(tenant.lastActivityAt, locale) ?? '' })}
          </span>
        ),
    },
  ];
}

/**
 * Worst first — red, amber, unknown, green.
 *
 * `unknown` above `green` deliberately: a tenant nobody used is not a problem,
 * but it is more worth a glance than one that worked. Mirrors `HEALTH_ORDER` on
 * the API, which is the definition; duplicated here rather than shipped on the
 * wire because it is four strings and an ordering the API has no reason to
 * impose on a client that may want its own.
 */
const HEALTH_ORDER: Record<PlatformTenant['health'], number> = {
  red: 0,
  amber: 1,
  unknown: 2,
  green: 3,
};

function byHealth(a: PlatformTenant, b: PlatformTenant): number {
  return HEALTH_ORDER[a.health] - HEALTH_ORDER[b.health];
}

/**
 * Order by: signed up, or health.
 *
 * `aria-current` rather than colour alone marks the active one, and the inactive
 * one is a real link so the choice is reversible with the keyboard and the back
 * button. Page 1 is the absence of the parameter, the same convention
 * `pageHref` uses, so the default view has one URL rather than two.
 */
function SortLinks({
  current,
  search,
  t,
}: {
  current: string | undefined;
  search: string;
  t: Awaited<ReturnType<typeof getTranslations>>;
}): React.ReactElement {
  const href = (sort?: string): string => {
    const query = new URLSearchParams();
    if (search !== '') query.set('search', search);
    if (sort !== undefined) query.set('sort', sort);
    return query.size > 0 ? `/admin?${query}` : '/admin';
  };

  const link = (sort: string | undefined, label: string): React.ReactElement => {
    const active = (current === 'health' ? 'health' : undefined) === sort;
    return (
      <Link
        href={href(sort)}
        aria-current={active ? 'true' : undefined}
        className={cn(
          'rounded border px-2.5 text-sm leading-[var(--control-h,2.25rem)] h-control inline-flex items-center',
          active
            ? 'border-primary font-medium text-primary'
            : 'border-border-strong text-foreground-muted hover:text-foreground',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
        )}
      >
        {label}
      </Link>
    );
  };

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm text-foreground-muted">{t('admin.sortLabel')}</span>
      <div className="flex items-center gap-2">
        {link(undefined, t('admin.sort.created'))}
        {link('health', t('admin.sort.health'))}
      </div>
    </div>
  );
}
