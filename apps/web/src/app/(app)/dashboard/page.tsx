import Link from 'next/link';
import { getFormatter, getLocale, getTranslations } from 'next-intl/server';
import {
  ApiError,
  apiFetch,
  type ActiveSession,
  type Facilities,
  type Me,
} from '../../../lib/api';
import { readTheme } from '../../../lib/preferences';
import { PreferenceSync } from './preference-sync';
import { Sessions } from './sessions';
import { CreateOrganizationForm } from './create-organization-form';
import { PageShell } from '@/components/page-shell';

/**
 * The screen people land on after signing in, and until now the weakest one in
 * the app.
 *
 * It was slice 0.4's proof that Clerk worked, and it never grew up: it led with
 * "My account", listed the signed-in person's name, email and internal UUID, and
 * offered no idea what to do next. Someone who had just accepted an invitation
 * arrived here, read their own database id, and reasonably concluded that
 * nothing had happened.
 *
 * So it now answers the two questions a landing screen owes you — where am I,
 * and what should I do next — and the identity block is what it always should
 * have been: a small footnote confirming who you are signed in as.
 */
export default async function DashboardPage(): Promise<React.ReactElement> {
  const t = await getTranslations();
  const format = await getFormatter();
  const activeLocale = await getLocale();
  const activeTheme = await readTheme();

  let me: Me | null = null;
  let failure: string | null = null;

  try {
    me = await apiFetch<Me>('/me');
  } catch (error) {
    failure = error instanceof ApiError ? `${error.status} ${error.message}` : String(error);
  }

  // Only worth asking once there is an organization to ask about. A person with
  // no membership gets a 403 here, which is the correct answer and not an error.
  let sites: Facilities | null = null;
  if (me !== null && me.memberships.length > 0) {
    try {
      sites = await apiFetch<Facilities>('/facilities');
    } catch {
      // The dashboard still renders without it; the facilities page will say why.
    }
  }

  // Where this account is signed in. Best-effort: a Clerk hiccup should cost the
  // device list, not the whole dashboard.
  let sessions: ActiveSession[] = [];
  if (me !== null) {
    try {
      sessions = (await apiFetch<{ sessions: ActiveSession[] }>('/me/sessions')).sessions;
    } catch {
      sessions = [];
    }
  }

  const membership = me?.memberships[0] ?? null;

  // Whole days remaining, rounded up, so the last day reads "1 day left" rather
  // than "0". Information only — nothing is enforced until phase 2.
  const trialDaysLeft =
    membership?.trialEndsAt == null
      ? null
      : Math.ceil((new Date(membership.trialEndsAt).getTime() - Date.now()) / 86_400_000);
  const poolCount = sites?.facilities.reduce((total, f) => total + f.pools.length, 0) ?? 0;
  const needsFirstSite = sites !== null && sites.facilities.length === 0;

  return (
    <PageShell
      title={membership?.organizationName ?? t('nav.dashboard')}
      subtitle={t('app.tagline')}
    >

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

          {membership === null ? (
            <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
              <div className="flex flex-col gap-1">
                <h2 className="text-lg font-medium">{t('account.noOrganizations')}</h2>
                <p className="text-sm text-foreground-muted">
                  {t('account.noOrganizationsHint')}
                </p>
              </div>
              <CreateOrganizationForm />
            </section>
          ) : (
            <>
              {membership.subscriptionStatus === 'trialing' && trialDaysLeft !== null && (
                <section className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded border border-border bg-surface-muted px-5 py-3">
                  <span className="text-sm font-medium">
                    {t('dashboard.trial')} —{' '}
                    {trialDaysLeft > 0
                      ? t('dashboard.trialDaysLeft', { days: trialDaysLeft })
                      : t('dashboard.trialEnded')}
                  </span>
                  <span className="text-sm text-foreground-muted">
                    {t('dashboard.trialNoCard')}
                  </span>
                </section>
              )}

              {/*
                The next step, stated rather than implied. An organization with no
                site cannot hold a class group, a session or an attendance record,
                so there is exactly one useful thing to do here and it says so.
              */}
              {needsFirstSite && (
                <section className="flex flex-col gap-3 rounded border border-primary/40 bg-primary/10 p-5">
                  <h2 className="font-medium text-primary">{t('dashboard.nextStep')}</h2>
                  <p className="text-sm">{t('dashboard.nextStepFirstSite')}</p>
                  <div>
                    <Link
                      href="/dashboard/facilities"
                      className="inline-block rounded bg-primary px-4 py-2 text-sm text-primary-foreground"
                    >
                      {t('dashboard.addFirstSite')}
                    </Link>
                  </div>
                </section>
              )}

              <section className="rounded border border-border bg-surface p-5">
                <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-foreground-muted">
                  {t('dashboard.overview')}
                </h2>
                <dl className="flex flex-wrap gap-x-10 gap-y-4">
                  <div className="flex flex-col">
                    <dt className="text-sm text-foreground-muted">{t('facilities.title')}</dt>
                    <dd className="text-2xl font-semibold">{sites?.facilities.length ?? '—'}</dd>
                  </div>
                  <div className="flex flex-col">
                    <dt className="text-sm text-foreground-muted">{t('dashboard.pools')}</dt>
                    <dd className="text-2xl font-semibold">{sites === null ? '—' : poolCount}</dd>
                  </div>
                  <div className="flex flex-col">
                    <dt className="text-sm text-foreground-muted">{t('dashboard.yourRoles')}</dt>
                    <dd className="mt-1 flex flex-wrap gap-1">
                      {membership.roles.length === 0 ? (
                        <span className="text-sm text-foreground-muted">
                          {t('account.noRoles')}
                        </span>
                      ) : (
                        membership.roles.map((role) => (
                          <span
                            key={role}
                            className="rounded bg-primary/15 px-2 py-0.5 text-sm text-primary"
                          >
                            {t(`roles.${role}`)}
                          </span>
                        ))
                      )}
                    </dd>
                  </div>
                </dl>
              </section>

              {me.memberships.length > 1 && (
                <section className="rounded border border-border bg-surface p-5">
                  <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-foreground-muted">
                    {t('account.organizations')}
                  </h2>
                  <ul className="flex flex-col gap-2">
                    {me.memberships.map((other) => (
                      <li key={other.membershipId} className="text-sm">
                        {other.organizationName}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 text-sm text-foreground-muted">
                    {t('dashboard.multipleOrganizations')}
                  </p>
                </section>
              )}
            </>
          )}

          {sessions.length > 0 && (
            <section className="rounded border border-border bg-surface p-5">
              <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-foreground-muted">
                {t('sessions.title')}
              </h2>
              <Sessions
                sessions={sessions}
                formatted={sessions.map((session) => ({
                  id: session.id,
                  started: format.dateTime(new Date(session.createdAt), {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  }),
                  lastActive: format.dateTime(new Date(session.lastActiveAt), {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  }),
                }))}
              />
            </section>
          )}

          {/*
            Demoted to a footnote. It confirms who you are signed in as, which is
            worth knowing; it is not what a dashboard should open with. The
            internal id is gone — it was diagnostics from slice 0.4 and meant
            nothing to the person reading it.
          */}
          <p className="text-sm text-foreground-muted">
            {t('account.signedInAs', {
              name:
                [me.user.firstName, me.user.lastName].filter(Boolean).join(' ') ||
                me.user.email ||
                t('account.noName'),
            })}
          </p>
        </>
      )}
    </PageShell>
  );
}
