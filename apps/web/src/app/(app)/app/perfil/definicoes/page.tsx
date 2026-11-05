import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';
import { apiFetch, type Me } from '@/lib/api';
import { LinkBusy } from '@/components/link-busy';
import { locales } from '@/i18n';
import { readTheme } from '@/lib/preferences';
import { MessagePreferenceCard } from '../../../dashboard/profile/message-preference-card';
import { PushCard } from '../../push-card';
import { PreferenceRows } from '../preference-rows';

/**
 * *Definições* — POOLSE-176 (Rui, 05-11-2026: "'idiom' 'tema' 'mensagens do
 * clube' should be discreet"). A screen deeper in, so it has its own *Voltar* and
 * no tab bar: language, theme, this phone's notifications and the club's email,
 * each with the control it always had, in that order.
 */
export default async function AppSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ home?: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const { home } = await searchParams;

  let me: Me;
  try {
    me = await apiFetch<Me>('/me');
  } catch {
    redirect('/dashboard');
  }
  const membership = me.memberships[0];
  if (membership === undefined) redirect('/dashboard');

  const [locale, theme] = await Promise.all([getLocale(), readTheme()]);
  const back = home === 'family' || home === 'teaching' ? `/app/perfil?home=${home}` : '/app/perfil';

  return (
    <>
      <Link
        href={back}
        className="inline-flex items-center gap-1.5 self-start text-sm text-primary hover:underline coarse:-my-3 coarse:py-3"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {t('app.profile.backTo')}
        <LinkBusy />
      </Link>

      <h1 className="text-xl font-semibold tracking-tight">{t('app.profile.settings')}</h1>

      <ul className="flex flex-col divide-y divide-border">
        <PreferenceRows locale={locale} locales={locales} theme={theme} />
      </ul>
      <div className="flex flex-col gap-3">
        <PushCard />
        <MessagePreferenceCard clubName={membership.organizationName} />
      </div>
    </>
  );
}
