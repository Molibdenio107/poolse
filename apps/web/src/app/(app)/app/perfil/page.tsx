import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { SignOutButton } from '@clerk/nextjs';
import {
  Award,
  IdCard,
  Eye, ChevronRight, FileText, LayoutDashboard, LogOut, Settings, Wallet } from 'lucide-react';
import { apiFetch, type ActiveSession, type Me } from '@/lib/api';
import { hatsOf, isHat } from '@/lib/app-hats';
import { outcome } from '@/lib/load-failure';
import { formatDate, formatStamp } from '@/lib/date-format';
import { LinkBusy } from '@/components/link-busy';
import { IdPhoto } from '@/components/id-photo';
import { PageError } from '@/components/page-shell';
import { PersonAvatar } from '@/components/person-avatar';
import { Sessions } from '../../dashboard/sessions';
import { AppSwitcher } from '../app-switcher';
import { EditProfile } from './edit-profile';

/**
 * *O meu perfil* in app mode — Rui, 31-10-2026. The diamond *Perfil* tab opens
 * it; a tab screen, so the tab bar stays and there is no *Voltar*. One screen,
 * top to bottom:
 *
 * 1. The person, read-only: photo, name, birth date, phone, and *Editar dados*
 *    (POOLSE-176), which opens `ProfileForm` in a sheet.
 * 2. *Definições*, one row: language, theme, push and the club's email, a
 *    screen deeper in.
 * 3. *Áreas*, for somebody with more than one home or a staff role: the
 *    switcher and *Abrir o backoffice* — never left out, or a parent-instructor
 *    is locked in app mode.
 * 4. The devices signed in, folded; *Terminar sessão* last.
 *
 * The owner's parts — subscription, support access, transfer — stay on the
 * backoffice's `/dashboard/profile`.
 */
export default async function AppProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ home?: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const asked = (await searchParams).home;
  const home = isHat(asked) ? asked : undefined;

  let me: Me;
  try {
    me = await apiFetch<Me>('/me');
  } catch {
    redirect('/dashboard');
  }
  const membership = me.memberships[0];
  if (membership === undefined) redirect('/dashboard');
  const hats = hatsOf(membership.roles);

  // POOLSE-188: `/me` is the reader, so everything below would be the reader's
  // own account inside somebody else's app. A view says whose it is, and stops.
  if (me.viewing != null) {
    return (
      <>
        <h1>{me.viewing.name}</h1>
        <p className="text-sm text-foreground-muted">{t('appView.profileInView')}</p>
      </>
    );
  }

  const [locale, sessionsLoad, familyLoad] = await Promise.all([
    getLocale(),
    outcome(apiFetch<{ sessions: ActiveSession[] }>('/me/sessions')),
    outcome(apiFetch<{ students: { name: string; self: boolean }[] }>('/family')),
  ]);
  const sessions = sessionsLoad.state === 'ok' ? sessionsLoad.data.sessions : [];

  // Whose profile this is (POOLSE-177): editing it never changes a child's record.
  const family = familyLoad.state === 'ok' ? familyLoad.data.students : [];
  const children = family.filter((one) => !one.self).map((one) => one.name);
  const whose =
    children.length > 0
      ? t('app.profile.guardianOf', {
          names: new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(children),
        })
      : family.length > 0
        ? t('app.profile.ownAccount')
        : null;
  const fullName = [me.user.firstName, me.user.lastName].filter(Boolean).join(' ');
  const row = 'flex min-h-[52px] items-center justify-between gap-3 py-2';
  const label = 'pb-1 pt-3 text-xs font-semibold uppercase tracking-wider text-foreground-muted';

  return (
    <>
      <h1>{t('profile.title')}</h1>

      {/* It reads first (POOLSE-176): nothing on this card is an input. */}
      <section className="flex flex-col items-center gap-4 rounded bg-surface p-4 text-center shadow-card">
        <PersonAvatar id={fullName} name={fullName} photoUrl={me.user.avatarUrl} className="size-20 text-xl" />
        <div className="flex flex-col gap-1">
          <p className="text-lg font-bold">{fullName}</p>
          {whose !== null && <p className="text-sm text-foreground-muted">{whose}</p>}
        </div>
        <dl className="flex w-full flex-col divide-y divide-border text-left">
          <div className="flex items-center justify-between gap-3 py-2">
            <dt className="text-sm text-foreground-muted">{t('profile.birthDate')}</dt>
            <dd>{me.user.birthDate === null ? '—' : formatDate(me.user.birthDate)}</dd>
          </div>
          <div className="flex items-center justify-between gap-3 py-2">
            <dt className="text-sm text-foreground-muted">{t('profile.contactPhone')}</dt>
            <dd>{me.user.contactPhone ?? '—'}</dd>
          </div>
        </dl>
        <EditProfile me={me} photo={<IdPhoto url={me.user.avatarUrl} name={fullName} target="own-photo" />} />
      </section>


      {hats.homes.includes('family') && (
        <Link
          href="/app/familia/pagamentos"
          className={`${row} rounded bg-surface px-4 shadow-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary`}
        >
          <span className="flex items-center gap-3">
            <Wallet className="size-5 text-primary" aria-hidden />
            {t('app.tabs.familia.pagamentos')}
          </span>
          <ChevronRight className="size-4 text-foreground-muted" aria-hidden />
          <LinkBusy />
        </Link>
      )}

      {hats.homes.includes('family') && (
        <Link
          href="/app/familia/documentos"
          className={`${row} rounded bg-surface px-4 shadow-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary`}
        >
          <span className="flex items-center gap-3">
            <FileText className="size-5 text-primary" aria-hidden />
            {t('app.documents.title')}
          </span>
          <ChevronRight className="size-4 text-foreground-muted" aria-hidden />
          <LinkBusy />
        </Link>
      )}

      {/* POOLSE-200: a teacher's papers. The contract and holidays stay on the desktop (Rui). */}
      {hats.homes.includes('teaching') && (
        <Link
          href="/app/perfil/qualificacoes"
          className={`${row} rounded bg-surface px-4 shadow-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary`}
        >
          <span className="flex items-center gap-3">
            <Award className="size-5 text-primary" aria-hidden />
            {t('qualifications.title')}
          </span>
          <ChevronRight className="size-4 text-foreground-muted" aria-hidden />
          <LinkBusy />
        </Link>
      )}

      {hats.homes.includes('teaching') && (
        <Link
          href="/app/perfil/dados"
          className={`${row} rounded bg-surface px-4 shadow-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary`}
        >
          <span className="flex items-center gap-3">
            <IdCard className="size-5 text-primary" aria-hidden />
            {t('app.profile.myDetails')}
          </span>
          <ChevronRight className="size-4 text-foreground-muted" aria-hidden />
          <LinkBusy />
        </Link>
      )}

      <Link
        href={home === undefined ? '/app/perfil/definicoes' : `/app/perfil/definicoes?home=${home}`}
        className={`${row} rounded bg-surface px-4 shadow-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary`}
      >
        <span className="flex items-center gap-3">
          <Settings className="size-5 text-primary" aria-hidden />
          {t('app.profile.settings')}
        </span>
        <ChevronRight className="size-4 text-foreground-muted" aria-hidden />
        <LinkBusy />
      </Link>

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
          {hats.manages && (
            <Link
              href="/app/vista"
              className={`${row} rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary`}
            >
              <span className="flex items-center gap-3">
                <Eye className="size-5 text-primary" aria-hidden />
                {t('appView.menu')}
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
