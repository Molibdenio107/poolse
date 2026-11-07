import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { apiFetch, type Me } from '@/lib/api';
import { HOME_CHOICE_COOKIE, HOME_PATH, appHome, hatsOf, rememberedHome, type AppHat } from '@/lib/app-hats';
import { RememberedHome } from './app-switcher';

/**
 * `/app` — app mode's front door, and the installed PWA's `start_url`
 * (POOLSE-90). It decides by the reader's roles in the active club: owner or
 * admin to the backoffice, a family to its agenda, and a person with several
 * homes to the one they used last on this device.
 */
export default async function AppRoot(): Promise<React.ReactElement> {
  const t = await getTranslations();
  const me = await apiFetch<Me>('/me').catch(() => null);
  const membership = me?.memberships[0];
  const roles = membership?.roles ?? [];
  const hats = hatsOf(roles);

  // POOLSE-188: a live view is the home, and an owner, an admin or support
  // chooses once per device.
  if (membership?.view != null) redirect(HOME_PATH[membership.view.hat as AppHat]);
  if (hats.manages) {
    const choice = (await cookies()).get(HOME_CHOICE_COOKIE)?.value;
    const chosen = rememberedHome(choice, membership?.membershipId ?? '', hats.homes);
    if (chosen === null) redirect('/app/vista');
    redirect(chosen === 'backoffice' ? appHome(roles) : HOME_PATH[chosen]);
  }
  if (hats.homes.length < 2) redirect(appHome(roles));

  return (
    <>
      <RememberedHome homes={hats.homes} />
      <p className="text-sm text-foreground-muted">{t('common.working')}</p>
    </>
  );
}
