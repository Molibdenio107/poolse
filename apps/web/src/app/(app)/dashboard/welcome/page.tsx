import { getTranslations } from 'next-intl/server';
import {
  ArrowRight,
  Building2,
  CalendarDays,
  Droplets,
  FileSpreadsheet,
  Settings,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { PageShell } from '@/components/page-shell';
import { FromLink } from '@/components/from-link';
import { apiFetch, type Facilities, type Me } from '@/lib/api';
import { formatDate } from '@/lib/date-format';
import { WaterBanner } from '../water-banner';
import { ScrollToTop } from './scroll-to-top';
import { LandOn } from './land-on';
import { LogoLockIn } from '@/components/logo-lock-in';
import type { WizardState } from '../setup/steps';
import type { ChecklistAnswer } from './vamos-comecar';
import { SetupPanel } from './setup-panel';
import { showMenusAction } from './menus.actions';
import { SectionPills, pickSection, sectionHref } from '@/components/section-pills';

type Step = { href: string; icon: LucideIcon; title: string; body: string };

/**
 * Início — the welcome after creating a club, made the Owner's and Admin's
 * home (Rui, 10-11-2026).
 *
 * `createOrganizationAction` redirects here with `?new=1`, and only that visit
 * says *Tudo pronto*; every other visit, from sign-in or the menu, is *Início*.
 * It reads `/me`: somebody who belongs to nothing yet, or whose roles are
 * neither owner nor admin, is sent on to `/dashboard` (by `LandOn`, in the
 * browser — see there why not a server redirect), which already knows where the
 * creation form, a family and a teacher's phone belong. Every link is to a
 * page an Owner or Admin may open, and none is gated by a module.
 *
 * The movement (a tick that draws itself, ripples, cards that rise in turn) is
 * CSS in globals.css under `onboard-*`, and none of it runs under reduced
 * motion. The trial's end is visible text, not a tooltip.
 */
export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string; section?: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const params = await searchParams;
  const fresh = params.new === '1';
  const me = await apiFetch<Me>('/me').catch(() => null);
  const membership = me?.memberships[0] ?? null;
  if (membership === null || !membership.roles.some((role) => role === 'owner' || role === 'admin')) {
    return (
      <PageShell title={t('nav.dashboard')}>
        <LandOn href="/dashboard" />
      </PageShell>
    );
  }

  const personal = membership.organizationKind === 'personal';

  /*
   * *Configurar o clube* — Rui, 17-11-2026. Straight to the site's own page
   * (opening hours, pools, lanes, the club's details under Geral), because that
   * is where a new club's first evening goes. With several sites, or none yet,
   * the Instalações list is the honest place to start. Only an Owner or Admin
   * reaches this far (above), and the site's page answers only them anyway.
   */
  const sites = personal ? null : await apiFetch<Facilities>('/facilities').catch(() => null);
  const live = sites?.facilities ?? [];
  const configureHref = live.length === 1 ? `/dashboard/facilities/${live[0]!.id}` : '/dashboard/facilities';
  /*
   * POOLSE-228: an Owner whose setup steps are under way continues them, in
   * place of *Configurar o clube*. Anybody else, or any failure, reads no wizard.
   */
  const wizard =
    personal || !membership.roles.includes('owner')
      ? null
      : await apiFetch<{ wizard: WizardState | null }>('/onboarding')
          .then((answer) => answer.wizard)
          .catch(() => null);
  const resume = wizard !== null && wizard.step !== null ? `/dashboard/setup?step=${wizard.step}` : null;
  // POOLSE-229: *Vamos começar*, for a club's Owner and Admins. A failed read draws nothing, never "all done".
  const checklist = personal
    ? null
    : await apiFetch<ChecklistAnswer>('/onboarding/checklist').catch(() => null);
  /*
   * Two pages since 19-11-2026 (Rui): *Configurar o clube*, highlighted, and
   * *Por onde começar*. The first exists while there is something to set up —
   * the Owner's steps under way, or *Vamos começar* with lines still open — and
   * is where Início opens until then.
   */
  const checklistOpen =
    checklist?.checklist != null &&
    !checklist.checklist.dismissed &&
    checklist.checklist.items.some((item) => !item.done);
  const hasSetupPage = !personal && (resume !== null || checklistOpen);
  const offered = hasSetupPage ? (['setup', 'start'] as const) : (['start'] as const);
  const section = pickSection<'setup' | 'start'>(offered, params.section, 'start');
  const steps: Step[] = personal
    ? [
        {
          href: '/dashboard',
          icon: Droplets,
          title: t('welcome.poolTitle'),
          body: t('welcome.poolBody'),
        },
      ]
    : [
        {
          href: '/dashboard/facilities',
          icon: Building2,
          title: t('welcome.facilityTitle'),
          body: t('welcome.facilityBody'),
        },
        {
          href: '/dashboard/classes',
          icon: CalendarDays,
          title: t('welcome.classesTitle'),
          body: t('welcome.classesBody'),
        },
        {
          href: '/dashboard/students/import',
          icon: FileSpreadsheet,
          title: t('welcome.studentsTitle'),
          body: t('welcome.studentsBody'),
        },
        {
          href: '/dashboard/facilities/staff',
          icon: Users,
          title: t('welcome.staffTitle'),
          body: t('welcome.staffBody'),
        },
      ];

  return (
    <PageShell
      title={fresh ? t('welcome.title') : t('nav.home')}
      subtitle={fresh ? t('welcome.subtitle', { club: membership.organizationName }) : undefined}
    >
      <ScrollToTop />
      <SectionPills
        label={t('welcome.sections')}
        current={section}
        items={offered.map((key) => ({
          key,
          label: t(`welcome.section.${key}`),
          href: sectionHref('/dashboard/welcome', params, key),
          ...(key === 'setup' ? { attention: t('welcome.setupWaiting') } : {}),
        }))}
      />

      {section === 'setup' && (
        <SetupPanel
          wizard={wizard}
          checklist={checklist}
          siteHref={configureHref}
          isOwner={membership.roles.includes('owner')}
        />
      )}

      {section === 'start' && (
      <section className="overflow-hidden rounded bg-surface shadow-card">
        <WaterBanner tall>
          <LogoLockIn />
        </WaterBanner>

        <div className="flex flex-col gap-6 p-5 sm:p-8">
          <div className="onboard-rise flex flex-col gap-1 text-center" style={{ '--i': 0 } as React.CSSProperties}>
            <p className="text-xl font-semibold">{membership.organizationName}</p>
            {!personal && membership.trialEndsAt !== null && (
              <p className="text-sm text-foreground-muted">
                {t('welcome.trial', { date: formatDate(membership.trialEndsAt) })}
              </p>
            )}
            {!personal && (
              <div className="mt-3 flex flex-col items-center gap-1.5">
                <FromLink
                  href={resume ?? configureHref}
                  className="inline-flex h-control items-center justify-center gap-2 rounded-sm bg-primary px-5 text-control font-semibold text-primary-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  <Settings className="size-4" aria-hidden />
                  {resume === null ? t('welcome.configureClub') : t('setup.resume')}
                </FromLink>
                <p className="text-sm text-foreground-muted">
                  {resume === null ? t('welcome.configureClubHint') : t('setup.resumeHint')}
                </p>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-3">
            <div className="onboard-rise flex flex-col gap-0.5" style={{ '--i': 1 } as React.CSSProperties}>
              <h2 className="text-base font-semibold">{t('welcome.nextTitle')}</h2>
              {!personal && <p className="text-sm text-foreground-muted">{t('welcome.nextHint')}</p>}
            </div>
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {steps.map((step, index) => (
                <li key={step.href} className="onboard-rise flex" style={{ '--i': index + 2 } as React.CSSProperties}>
                  <FromLink
                    href={step.href}
                    className="group flex w-full items-start gap-3 rounded border border-border p-4 transition-[border-color,background-color,transform] duration-300 hover:border-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary motion-safe:hover:-translate-y-0.5"
                  >
                    <span
                      aria-hidden
                      className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary"
                    >
                      <step.icon className="size-5" />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="font-medium">{step.title}</span>
                      <span className="text-sm text-foreground-muted">{step.body}</span>
                    </span>
                    <ArrowRight
                      aria-hidden
                      className="mt-0.5 size-4 shrink-0 text-foreground-muted transition-transform duration-300 group-hover:text-primary motion-safe:group-hover:translate-x-1"
                    />
                  </FromLink>
                </li>
              ))}
            </ul>
          </div>

          <div
            className="onboard-rise flex justify-center"
            style={{ '--i': steps.length + 2 } as React.CSSProperties}
          >
            {me?.guidedSetup === true ? (
              // Mid-setup the menus are hidden; this is the Owner's way to bring them back.
              <form action={showMenusAction} className="flex flex-col items-center gap-1.5">
                <button
                  type="submit"
                  className="inline-flex h-control items-center justify-center gap-2 rounded-sm bg-primary px-6 text-control font-semibold text-primary-foreground"
                >
                  {t('welcome.goToDashboard')}
                </button>
                <p className="text-sm text-foreground-muted">{t('welcome.menusHint')}</p>
              </form>
            ) : (
              <FromLink
                href="/dashboard"
                className="inline-flex h-control items-center justify-center gap-2 rounded-sm bg-primary px-6 text-control font-semibold text-primary-foreground"
              >
                {t('welcome.goToDashboard')}
              </FromLink>
            )}
          </div>
        </div>
      </section>
      )}
    </PageShell>
  );
}
