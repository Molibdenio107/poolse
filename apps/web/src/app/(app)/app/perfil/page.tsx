import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getLocale, getTranslations } from 'next-intl/server';
import { SignOutButton } from '@clerk/nextjs';
import {
  Award,
  IdCard,
  Eye, ChevronRight, FileText, LayoutDashboard, LogOut, Receipt, Settings, UserPlus, Wallet, Waves } from 'lucide-react';
import { apiFetch, type ActiveSession, type AppInvoiceList, type AppPasses, type Me } from '@/lib/api';
import { hatsOf, isHat, landsInTeaching } from '@/lib/app-hats';
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

  const [locale, sessionsLoad, familyLoad, joinLink, invoicesLoad, categoriesLoad, passesLoad] = await Promise.all([
    getLocale(),
    outcome(apiFetch<{ sessions: ActiveSession[] }>('/me/sessions')),
    outcome(apiFetch<{ students: { name: string; self: boolean }[] }>('/family')),
    outcome(apiFetch<{ slug: string | null }>('/app/join-link')),
    // *Extratos* (POOLSE-201): only somebody who pays has the row.
    hats.homes.includes('family') ? outcome(apiFetch<AppInvoiceList>('/app/invoices')) : Promise.resolve(null),
    // POOLSE-202, rule 6: the reader's own categories, read-only, never the proof.
    hats.homes.includes('family')
      ? outcome(apiFetch<{ categories: { name: string; validUntil: string | null }[] }>('/app/categories'))
      : Promise.resolve(null),
    // *Natação livre* (POOLSE-204): a row when there is a pass to see or a pack to buy.
    hats.homes.includes('family') ? outcome(apiFetch<AppPasses>('/app/passes')) : Promise.resolve(null),
  ]);
  const swims =
    passesLoad !== null &&
    passesLoad.state === 'ok' &&
    (passesLoad.data.passes.length > 0 || passesLoad.data.forSale.length > 0);
  const categories = categoriesLoad !== null && categoriesLoad.state === 'ok' ? categoriesLoad.data.categories : [];
  const pays = invoicesLoad !== null && invoicesLoad.state === 'ok' && invoicesLoad.data.payer;
  // *Convidar amigos* (Rui, 07-11-2026): only while the club takes pre-registrations.
  const mayInvite = joinLink.state === 'ok' && joinLink.data.slug !== null;
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
  // A teacher's profile is a teacher's (Rui, 07-11-2026): payments and documents
  // belong to the family home, for somebody who has one.
  const familyRows = hats.homes.includes('family') && (home === 'family' || !hats.homes.includes('teaching'));
  // Nothing to switch to and no back office on a phone: the section has no rows there.
  const onlyTeaches = landsInTeaching(membership.roles);
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
          {categories.length > 0 && (
            <div className="flex items-start justify-between gap-3 py-2">
              <dt className="text-sm text-foreground-muted">{t('personCategories.title')}</dt>
              <dd className="flex flex-col items-end text-right">
                {categories.map((one) => (
                  <span key={one.name}>
                    {one.validUntil === null
                      ? one.name
                      : t('personCategories.appUntil', { name: one.name, date: formatDate(one.validUntil) })}
                  </span>
                ))}
              </dd>
            </div>
          )}
        </dl>
        <EditProfile me={me} photo={<IdPhoto url={me.user.avatarUrl} name={fullName} target="own-photo" />} />
      </section>


      {familyRows && (
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

      {familyRows && swims && (
        <Link
          href="/app/perfil/natacao-livre"
          className={`${row} rounded bg-surface px-4 shadow-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary`}
        >
          <span className="flex items-center gap-3">
            <Waves className="size-5 text-primary" aria-hidden />
            {t('app.passes.title')}
          </span>
          <ChevronRight className="size-4 text-foreground-muted" aria-hidden />
          <LinkBusy />
        </Link>
      )}

      {familyRows && pays && (
        <Link
          href="/app/perfil/extratos"
          className={`${row} rounded bg-surface px-4 shadow-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary`}
        >
          <span className="flex items-center gap-3">
            <Receipt className="size-5 text-primary" aria-hidden />
            {t('app.invoices.title')}
          </span>
          <ChevronRight className="size-4 text-foreground-muted" aria-hidden />
          <LinkBusy />
        </Link>
      )}

      {familyRows && mayInvite && (
        <Link
          href="/app/perfil/convidar"
          className={`${row} rounded bg-surface px-4 shadow-card focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary`}
        >
          <span className="flex items-center gap-3">
            <UserPlus className="size-5 text-primary" aria-hidden />
            {t('invite.friendsTitle')}
          </span>
          <ChevronRight className="size-4 text-foreground-muted" aria-hidden />
          <LinkBusy />
        </Link>
      )}

      {familyRows && (
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
        <section className={onlyTeaches && hats.homes.length < 2 ? 'flex flex-col gap-2 max-md:hidden' : 'flex flex-col gap-2'}>
          <h2 className={label}>{t('app.profile.homes')}</h2>
          <AppSwitcher homes={hats.homes} />
          {hats.staff && (
            <Link
              href="/dashboard"
              className={`${row} rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${onlyTeaches ? 'max-md:hidden' : ''}`}
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
