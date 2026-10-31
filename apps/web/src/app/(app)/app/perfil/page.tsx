import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ChevronRight, LayoutDashboard } from 'lucide-react';
import { apiFetch, type Me } from '@/lib/api';
import { hatsOf } from '@/lib/app-hats';
import { LinkBusy } from '@/components/link-busy';
import { PreferenceControls } from '../../preference-controls';
import { UserMenu } from '../../user-menu';
import { AppSwitcher } from '../app-switcher';
import { PushCard } from '../push-card';

/**
 * *Perfil* — POOLSE-136 rule 4. Where app mode's chrome went: language and
 * theme, the account (Clerk's avatar menu: O meu perfil, conta, sair), the
 * switcher between a person's homes, *Abrir o backoffice* for staff who are
 * also parents, and the push switch. One page for every tabbed home; `?home=`
 * only says which tab bar to draw around it.
 *
 * Built for every hat at once, never for families first: a parent-instructor
 * who lost *Abrir o backoffice* here would be locked in app mode.
 */
export default async function ProfilePage(): Promise<React.ReactElement> {
  const t = await getTranslations();

  let me: Me;
  try {
    me = await apiFetch<Me>('/me');
  } catch {
    redirect('/dashboard');
  }
  const membership = me.memberships[0];
  if (membership === undefined) redirect('/dashboard');
  const hats = hatsOf(membership.roles);

  const row = 'flex min-h-[52px] items-center justify-between gap-3 py-2';

  return (
    <>
      <h1>{t('app.profile.title')}</h1>

      <section className="flex flex-col">
        <h2 className="app-section-label">{t('app.profile.account')}</h2>
        <ul className="flex flex-col divide-y divide-border">
          <li className={row}>
            <span>{t('app.profile.accountHint')}</span>
            <UserMenu />
          </li>
          <li className={row}>
            <span>{t('app.profile.preferences')}</span>
            <span className="flex items-center gap-2">
              <PreferenceControls />
            </span>
          </li>
        </ul>
      </section>

      {(hats.homes.length > 1 || hats.staff) && (
        <section className="flex flex-col gap-2">
          <h2 className="app-section-label">{t('app.profile.homes')}</h2>
          <AppSwitcher homes={hats.homes} />
          {hats.staff && (
            <Link
              href="/dashboard"
              className={`${row} rounded-sm px-1 text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary`}
            >
              <span className="flex items-center gap-2">
                <LayoutDashboard className="size-5" aria-hidden />
                {t('app.openBackoffice')}
              </span>
              <ChevronRight className="size-4 text-foreground-muted" aria-hidden />
              <LinkBusy />
            </Link>
          )}
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="app-section-label">{t('app.profile.notifications')}</h2>
        <PushCard />
      </section>
    </>
  );
}
