import Link from 'next/link';
import { getFormatter, getLocale, getTranslations } from 'next-intl/server';
import { ApiError, apiFetch, type ActiveSession, type Me } from '../../../lib/api';
import { readTheme } from '../../../lib/preferences';
import { PersonAvatar } from '@/components/person-avatar';
import { PreferenceSync } from './preference-sync';
import { Sessions } from './sessions';
import { CreateOrganizationForm } from './create-organization-form';
import { PageShell } from '@/components/page-shell';

/**
 * The signed-in person's own screen.
 *
 * It used to open with the organization's name, its licence and a count of
 * facilities and pools, which made it a second and worse version of Instalações.
 * Instalações is the landing page now and lists both properly, so this answers a
 * different question: who am I signed in as, what am I allowed to do here, where
 * else is this account open, and where do I go to change any of it. The licence
 * and the organizations list moved to "O meu perfil", where somebody looking for
 * their own account details will actually go looking for them.
 *
 * **The operational dashboard is deliberately not here yet.** Metrics and
 * maintenance are a later piece of work with their own data behind them, and a
 * half version of it — three counts in a row, standing in for the real thing —
 * is exactly what this page just stopped being. Add it when there is something
 * to add, not before.
 *
 * The "you belong to no organization yet" path stays here on purpose:
 * `dashboard/start` sends somebody with no membership to this page precisely
 * because `CreateOrganizationForm` lives on it.
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

  // Where this account is signed in. Best-effort: a Clerk hiccup should cost the
  // device list, not the whole page.
  let sessions: ActiveSession[] = [];
  if (me !== null) {
    try {
      sessions = (await apiFetch<{ sessions: ActiveSession[] }>('/me/sessions')).sessions;
    } catch {
      sessions = [];
    }
  }

  const membership = me?.memberships[0] ?? null;
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

          <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
            <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
              {t('account.title')}
            </h2>

            <div className="flex items-center gap-4">
              <PersonAvatar
                id={me.user.id}
                name={name ?? t('account.noName')}
                photoUrl={me.user.avatarUrl}
                size="lg"
              />
              <div className="flex min-w-0 flex-col">
                <span className="text-lg font-medium">{name ?? t('account.noName')}</span>
                <span className="truncate text-sm text-foreground-muted">
                  {me.user.email ?? t('account.noEmail')}
                </span>
              </div>
            </div>

            {membership !== null && (
              <dl className="flex flex-wrap gap-x-10 gap-y-4">
                <div className="flex flex-col">
                  <dt className="text-sm text-foreground-muted">{t('dashboard.organization')}</dt>
                  <dd className="mt-1 font-medium">{membership.organizationName}</dd>
                </div>
                <div className="flex flex-col">
                  <dt className="text-sm text-foreground-muted">{t('dashboard.yourRoles')}</dt>
                  <dd className="mt-1 flex flex-wrap gap-1">
                    {membership.roles.length === 0 ? (
                      <span className="text-sm text-foreground-muted">{t('account.noRoles')}</span>
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
            )}

            {/*
              The way out of a read-only screen. Everything above is a copy of
              something the profile page owns, so the person who came here to
              correct their name needs one obvious control rather than a hunt
              through the menu.
            */}
            <div>
              <Link
                href="/dashboard/profile"
                className="inline-block rounded border border-border px-4 py-2 text-sm transition-colors hover:border-primary/50 hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                {t('dashboard.editProfile')}
              </Link>
            </div>
          </section>

          {membership === null && (
            <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
              <div className="flex flex-col gap-1">
                <h2 className="text-lg font-medium">{t('account.noOrganizations')}</h2>
                <p className="text-sm text-foreground-muted">{t('account.noOrganizationsHint')}</p>
              </div>
              <CreateOrganizationForm />
            </section>
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
        </>
      )}
    </PageShell>
  );
}
