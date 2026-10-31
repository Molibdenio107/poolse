import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { SignOutButton } from '@clerk/nextjs';
import { ChevronRight, LayoutDashboard, LogOut } from 'lucide-react';
import { apiFetch, type ActiveSession, type Me } from '@/lib/api';
import { hatsOf } from '@/lib/app-hats';
import { outcome } from '@/lib/load-failure';
import { formatStamp } from '@/lib/date-format';
import { readTheme } from '@/lib/preferences';
import { locales } from '@/i18n';
import { LinkBusy } from '@/components/link-busy';
import { IdPhoto } from '@/components/id-photo';
import { PageError } from '@/components/page-shell';
import { ProfileForm } from '../../dashboard/profile/profile-form';
import { MessagePreferenceCard } from '../../dashboard/profile/message-preference-card';
import { Sessions } from '../../dashboard/sessions';
import { AppSwitcher } from '../app-switcher';
import { PushCard } from '../push-card';
import { PreferenceRows } from './preference-rows';

/**
 * *O meu perfil* in app mode — Rui, 31-10-2026. The diamond *Perfil* tab opens
 * it, and so does the photo in the header's top-right corner; a tab screen, so
 * the tab bar stays and there is no *Voltar*. One screen, top to bottom:
 *
 * 1. The person: photo, name, birth date, phone (`ProfileForm`, the desk page's
 *    own save, without its language and theme fields).
 * 2. *Preferências*: notifications on this phone, *Idioma* and *Tema* as rows
 *    that open a bottom sheet, and the club's general messages by email.
 * 3. *Áreas*, for somebody with more than one home or a staff role: the
 *    switcher and *Abrir o backoffice* — never left out, or a parent-instructor
 *    is locked in app mode.
 * 4. The devices signed in, folded; *Terminar sessão* last.
 *
 * The owner's parts — subscription, support access, transfer — stay on the
 * backoffice's `/dashboard/profile`.
 */
export default async function AppProfilePage(): Promise<React.ReactElement> {
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

  const [locale, theme, sessionsLoad] = await Promise.all([
    getLocale(),
    readTheme(),
    outcome(apiFetch<{ sessions: ActiveSession[] }>('/me/sessions')),
  ]);
  const sessions = sessionsLoad.state === 'ok' ? sessionsLoad.data.sessions : [];
  const fullName = [me.user.firstName, me.user.lastName].filter(Boolean).join(' ');
  const row = 'flex min-h-[52px] items-center justify-between gap-3 py-2';
  const label = 'pb-1 pt-3 text-xs font-semibold uppercase tracking-wider text-foreground-muted';

  return (
    <>
      <h1>{t('profile.title')}</h1>

      {/* The photo and its buttons centred, every field the card's width (Rui, 31-10-2026). */}
      <section className="app-form flex flex-col gap-4 rounded bg-surface p-4 shadow-card">
        <div className="flex justify-center">
          <IdPhoto url={me.user.avatarUrl} name={fullName} target="own-photo" />
        </div>
        <ProfileForm me={me} withPreferences={false} />
      </section>

      <section className="flex flex-col">
        <h2 className={label}>{t('app.profile.preferences')}</h2>
        <ul className="flex flex-col divide-y divide-border">
          <PreferenceRows locale={locale} locales={locales} theme={theme} />
        </ul>
        <div className="mt-2 flex flex-col gap-3">
          <PushCard />
          <MessagePreferenceCard clubName={membership.organizationName} />
        </div>
      </section>

      {(hats.homes.length > 1 || hats.staff) && (
        <section className="flex flex-col gap-2">
          <h2 className={label}>{t('app.profile.homes')}</h2>
          <AppSwitcher homes={hats.homes} />
          {hats.staff && (
            <Link
              href="/dashboard"
              className={`${row} rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary`}
            >
              <span className="flex items-center gap-3">
                <LayoutDashboard className="size-5 text-primary" aria-hidden />
                {t('app.openBackoffice')}
              </span>
              <ChevronRight className="size-4 text-foreground-muted" aria-hidden />
              <LinkBusy />
            </Link>
          )}
        </section>
      )}

      {(sessions.length > 0 || sessionsLoad.state === 'failed') && (
        <details className="group rounded bg-surface px-4 shadow-card">
          <summary className={`${row} cursor-pointer list-none`}>
            <span>{t('sessions.title')}</span>
            <ChevronRight className="size-4 text-foreground-muted transition-transform group-open:rotate-90" aria-hidden />
          </summary>
          <div className="pb-4">
            {sessionsLoad.state === 'failed' && <PageError message={t(sessionsLoad.failure.key)} />}
            <Sessions
              sessions={sessions}
              formatted={sessions.map((session) => ({
                id: session.id,
                started: formatStamp(new Date(session.createdAt)),
                lastActive: formatStamp(new Date(session.lastActiveAt)),
              }))}
            />
          </div>
        </details>
      )}

      {me.memberships.length > 1 && (
        <p className="text-sm text-foreground-muted">{t('dashboard.multipleOrganizations')}</p>
      )}

      <SignOutButton redirectUrl="/">
        <button
          type="button"
          className={`${row} w-full rounded-sm text-left font-semibold text-danger focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary`}
        >
          <span className="flex items-center gap-3">
            <LogOut className="size-5" aria-hidden />
            {t('app.profile.signOut')}
          </span>
        </button>
      </SignOutButton>
    </>
  );
}
