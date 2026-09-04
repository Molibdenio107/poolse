import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import {
  ApiError,
  apiFetch,
  type Facilities,
  type Me,
  type Occupancy,
} from '../../../lib/api';
import { readTheme } from '../../../lib/preferences';
import { PreferenceSync } from './preference-sync';
import { CreateOrganizationForm } from './create-organization-form';
import { PageShell } from '@/components/page-shell';
import { OccupancyPanel } from '@/components/occupancy-panel';

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
 * The "you belong to no organization yet" path stays here on purpose:
 * `dashboard/start` sends somebody with no membership to this page precisely
 * because `CreateOrganizationForm` lives on it.
 */
export default async function DashboardPage(): Promise<React.ReactElement> {
  const t = await getTranslations();
  const activeLocale = await getLocale();
  const activeTheme = await readTheme();

  let me: Me | null = null;
  let failure: string | null = null;

  try {
    me = await apiFetch<Me>('/me');
  } catch (error) {
    failure = error instanceof ApiError ? `${error.status} ${error.message}` : String(error);
  }

  const membership = me?.memberships[0] ?? null;

  /*
   * The club's site, and its season in figures.
   *
   * One facility per licence, so the first is the club's — and both requests are
   * best-effort: a dashboard that fails to load because a figure would not
   * compute is worse than a dashboard without the figure.
   */
  let occupancy: Occupancy | null = null;
  let occupancyFailed = false;

  if (me !== null && membership !== null) {
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
      // Best-effort, but not silent: a dashboard that simply omits its main
      // panel is indistinguishable from one that has not been built.
      occupancyFailed = occupancy === null;
    }
  }
  const name =
    me === null
      ? null
      : [me.user.firstName, me.user.lastName].filter(Boolean).join(' ') || me.user.email;

  return (
    <PageShell title={name ?? t('nav.dashboard')} subtitle={t('dashboard.subtitle')}>

      {failure !== null && (
        <section className="rounded border border-danger/40 bg-danger/10 p-5">
          <p className="font-medium text-danger">{t('account.unavailable')}</p>
          <p className="mt-1 font-mono text-sm text-foreground-muted">{failure}</p>
        </section>
      )}

      {me !== null && (
        <>
          <PreferenceSync
            storedLocale={me.user.locale}
            storedTheme={me.user.theme}
            activeLocale={activeLocale}
            activeTheme={activeTheme}
          />

          {occupancy !== null && <OccupancyPanel occupancy={occupancy} />}

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
