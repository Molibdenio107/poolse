import { getTranslations } from 'next-intl/server';
import {
  ArrowRight,
  Building2,
  CalendarDays,
  Droplets,
  FileSpreadsheet,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { PageShell } from '@/components/page-shell';
import { FromLink } from '@/components/from-link';
import { apiFetch, type Me } from '@/lib/api';
import { formatDate } from '@/lib/date-format';
import { WaterBanner } from '../water-banner';
import { ScrollToTop } from './scroll-to-top';
import { LandOn } from './land-on';
import { CheckPulse } from '@/components/check-pulse';

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
  searchParams: Promise<{ new?: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const fresh = (await searchParams).new === '1';
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
      <section className="overflow-hidden rounded bg-surface shadow-card">
        <WaterBanner tall>
          <CheckPulse />
        </WaterBanner>

        <div className="flex flex-col gap-6 p-5 sm:p-8">
          <div className="onboard-rise flex flex-col gap-1 text-center" style={{ '--i': 0 } as React.CSSProperties}>
            <p className="text-xl font-semibold">{membership.organizationName}</p>
            {!personal && membership.trialEndsAt !== null && (
              <p className="text-sm text-foreground-muted">
                {t('welcome.trial', { date: formatDate(membership.trialEndsAt) })}
              </p>
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
            <FromLink
              href="/dashboard"
              className="inline-flex h-control items-center justify-center gap-2 rounded-sm bg-primary px-6 text-control font-semibold text-primary-foreground"
            >
              {t('welcome.goToDashboard')}
            </FromLink>
          </div>
        </div>
      </section>
    </PageShell>
  );
}
