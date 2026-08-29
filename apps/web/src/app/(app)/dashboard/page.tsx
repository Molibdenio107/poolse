import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import { ApiError, apiFetch, type Me } from '../../../lib/api';
import { readTheme } from '../../../lib/preferences';
import { PreferenceSync } from './preference-sync';
import { CreateOrganizationForm } from './create-organization-form';
import { PageShell } from '@/components/page-shell';

/**
 * The dashboard — and, for now, mostly a statement that it is not built yet.
 *
 * Round 4 emptied it. It had become the account screen: who am I signed in as,
 * what are my roles, where else is this session open. Every one of those is an
 * account question, they all now live on "O meu perfil", and answering them here
 * meant the first page after signing in was about the reader rather than about
 * the pool. A dashboard is for the operation.
 *
 * **The operational dashboard is deliberately not built yet**, and this page
 * says so rather than filling the gap. Occupancy, water quality at a glance,
 * today's classes and what needs maintenance all need data this product is still
 * growing; three counts in a row standing in for them is exactly what this page
 * just stopped being. The empty state names what is coming and points at the
 * screens that do work today, which is more use than a chart of nothing.
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

          {/*
            What this page will be, said plainly, with the way to the screens
            that already work. An operator who lands here should not have to
            guess whether Poolse has no dashboard or whether theirs failed to
            load — the two look identical from a blank panel.
          */}
          {membership !== null && (
            <section className="flex flex-col gap-4 rounded border border-dashed border-border bg-surface p-5">
              <div className="flex flex-col gap-1">
                <h2 className="text-lg font-medium">{t('dashboard.soonTitle')}</h2>
                <p className="text-sm text-foreground-muted">{t('dashboard.soonHint')}</p>
              </div>

              <nav className="flex flex-wrap gap-2">
                {[
                  { href: '/dashboard/calendar', label: t('calendar.title') },
                  { href: '/dashboard/facilities', label: t('facilities.title') },
                  { href: '/dashboard/classes', label: t('classes.title') },
                  { href: '/dashboard/students', label: t('students.title') },
                ].map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="rounded border border-border px-4 py-2 text-sm transition-colors hover:border-primary/50 hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  >
                    {link.label}
                  </Link>
                ))}
              </nav>
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
