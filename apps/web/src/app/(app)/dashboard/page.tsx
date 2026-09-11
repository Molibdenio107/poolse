import Link from 'next/link';
import { describeLoad, type LoadFailure } from '@/lib/load-failure';
import { getLocale, getTranslations } from 'next-intl/server';
import {
  ApiError,
  apiFetch,
  type Facilities,
  type Me,
  type Occupancy,
  type PoolDetail,
} from '../../../lib/api';
import { readTheme } from '../../../lib/preferences';
import { PreferenceSync } from './preference-sync';
import { CreateOrganizationForm } from './create-organization-form';
import { PageError, PageShell } from '@/components/page-shell';
import { OccupancyPanel } from '@/components/occupancy-panel';
import { MyTasksPanel } from './my-tasks-panel';
import { MyPoolPanel } from './my-pool-panel';
import { listMyTasks } from './facilities/maintenance.actions';

/**
 * The dashboard — and, for now, mostly a statement that it is not built yet.
 *
 * Round 4 emptied it. It had become the account screen: who am I signed in as,
 * what are my roles, where else is this session open. Every one of those is an
 * account question, they all now live on "O meu perfil", and answering them here
 * meant the first page after signing in was about the reader rather than about
 * the pool. A dashboard is for the operation.
 *
 * **Occupancy is the first real thing on it** — moved here from the facility
 * page, because how much of the water is sold is the question a manager opens
 * Poolse with, and POOLSE-52 had it filed under a site's own settings. It moved
 * rather than being copied: two of the same panel would be two answers to one
 * question the day somebody edited one.
 *
 * The "coming soon" panel that used to sit under it is **gone**, at Rui's
 * request. It earned its place while the page was empty — an operator landing on
 * a blank screen cannot tell a dashboard that has no content from one that
 * failed to load. With a real panel on the page that ambiguity is gone, and a
 * card explaining what is not here yet becomes furniture between the reader and
 * what is.
 *
 * The "you belong to no organization yet" path stays here on purpose: this is
 * where `CreateOrganizationForm` lives, and somebody with no membership has to
 * land somewhere that offers them a way forward.
 *
 * **This is the home route — round 5, ticket 1.** Sign-in comes straight here
 * and so does the logo. `dashboard/start` and `lib/landing.ts` are gone with
 * that change: POOLSE-37 resolved a landing page per role, and there is nothing
 * left to resolve once every role lands on the same one. Both fetches below stay
 * best-effort for the same reason they always were, which is now load-bearing —
 * an instructor or a guardian opening the front door must get a page, not a
 * permission error, so a figure that will not compute becomes a muted note.
 *
 * **A personal tenant gets its pool instead of occupancy — slice 4.5.** There
 * are no bookings to sell, so the occupancy call is not made at all rather than
 * made and reported as unavailable; what a person with one pool opens Poolse
 * for is whether the water is all right, and `MyPoolPanel` is that answer.
 */
export default async function DashboardPage(): Promise<React.ReactElement> {
  const t = await getTranslations();
  const activeLocale = await getLocale();
  const activeTheme = await readTheme();

  let me: Me | null = null;
  let failure: LoadFailure | null = null;

  try {
    me = await apiFetch<Me>('/me');
  } catch (error) {
    failure = describeLoad(error);
  }

  const membership = me?.memberships[0] ?? null;
  const personal = membership?.organizationKind === 'personal';

  /*
   * The club's site, and its season in figures.
   *
   * One facility per licence, so the first is the club's — and both requests are
   * best-effort: a dashboard that fails to load because a figure would not
   * compute is worse than a dashboard without the figure.
   */
  let occupancy: Occupancy | null = null;
  let occupancyFacilityId: string | null = null;
  let occupancyFailed = false;

  /*
   * The personal tenant's pools, each with its record — one round trip per tank,
   * which for the tenant this is built for is one. Best-effort like the rest:
   * a tank whose page will not load is simply not on the dashboard, and the
   * pool page itself says what went wrong.
   */
  let pools: PoolDetail[] = [];
  let poolsFailed = false;

  if (me !== null && membership !== null && personal) {
    const sites = await apiFetch<Facilities>('/facilities').catch(() => null);
    const listed = sites?.facilities.flatMap((site) => site.pools) ?? [];
    pools = (
      await Promise.all(
        listed.map((pool) =>
          apiFetch<PoolDetail>(`/facilities/pools/${pool.id}`).catch(() => null),
        ),
      )
    ).filter((pool): pool is PoolDetail => pool !== null);
    // Best-effort, but not silent — the same rule as occupancy below. A
    // dashboard with no card is indistinguishable from a tenant with no pool.
    poolsFailed = sites === null || pools.length < listed.length;
  } else if (me !== null && membership !== null) {
    /*
     * `/facilities` answers with an object, not an array — `{ organizationId,
     * facilities, canManage, timezones }`. The first version of this typed it as
     * `Facility[]`, so `sites[0]` was always undefined and the panel silently
     * never rendered: `.catch(() => null)` and a `!== null` guard between them
     * turned a wrong type into no error and no output, which is the hardest
     * shape of bug to see.
     */
    const sites = await apiFetch<Facilities>('/facilities').catch(() => null);
    const first = sites?.facilities[0]?.id;

    if (first !== undefined) {
      occupancy = await apiFetch<Occupancy>(`/facilities/${first}/occupancy`).catch(() => null);
      occupancyFacilityId = first;
      // Best-effort, but not silent: a dashboard that simply omits its main
      // panel is indistinguishable from one that has not been built.
      occupancyFailed = occupancy === null;
    }
  }
  /*
   * What is mine — slice 4.3.
   *
   * `listMyTasks` answers null for anybody the endpoint refuses, which is every
   * student and encarregado. That is not a failure worth a banner: the panel
   * simply is not there, exactly as the occupancy one is absent for a club with
   * no bookings.
   */
  const myTasks = me === null ? null : await listMyTasks();

  const name =
    me === null
      ? null
      : [me.user.firstName, me.user.lastName].filter(Boolean).join(' ') || me.user.email;

  return (
    <PageShell title={name ?? t('nav.dashboard')} subtitle={t('dashboard.subtitle')}>

      {failure !== null && (
        <PageError
          message={t(failure.key)}
          {...(failure.detail === '' ? {} : { detail: failure.detail })}
        />
      )}

      {me !== null && (
        <>
          <PreferenceSync
            storedLocale={me.user.locale}
            storedTheme={me.user.theme}
            activeLocale={activeLocale}
            activeTheme={activeTheme}
          />

          {pools.map((pool) => (
            <MyPoolPanel key={pool.id} pool={pool} />
          ))}

          {occupancy !== null && (
            <OccupancyPanel occupancy={occupancy} facilityId={occupancyFacilityId} />
          )}

          {myTasks !== null && <MyTasksPanel list={myTasks} />}

          {poolsFailed && (
            <section className="rounded border border-border bg-surface p-5">
              <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
                {t('dashboard.myPool')}
              </h2>
              <p className="mt-1 text-sm text-foreground-muted">{t('dashboard.poolUnavailable')}</p>
            </section>
          )}

          {occupancyFailed && (
            <section className="rounded border border-border bg-surface p-5">
              <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
                {t('occupancy.title')}
              </h2>
              <p className="mt-1 text-sm text-foreground-muted">{t('occupancy.unavailable')}</p>
            </section>
          )}

          {membership === null && (
            <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
              <div className="flex flex-col gap-1">
                <h2 className="text-lg font-medium">{t('account.noOrganizations')}</h2>
                <p className="text-sm text-foreground-muted">{t('account.noOrganizationsHint')}</p>
              </div>
              <CreateOrganizationForm />
            </section>
          )}

        </>
      )}
    </PageShell>
  );
}
