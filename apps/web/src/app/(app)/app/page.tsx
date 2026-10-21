import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { apiFetch, type Me } from '@/lib/api';
import { appHome, hatsOf } from '@/lib/app-hats';
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
  const roles = me?.memberships[0]?.roles ?? [];
  const hats = hatsOf(roles);

  if (hats.manages || hats.homes.length < 2) redirect(appHome(roles));

  return (
    <>
      <RememberedHome homes={hats.homes} />
      <p className="text-sm text-foreground-muted">{t('common.working')}</p>
    </>
  );
}
