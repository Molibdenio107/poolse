import { getTranslations } from 'next-intl/server';
import { requiredDetails } from '@poolse/rules';
import { Check } from 'lucide-react';
import { PageShell } from '@/components/page-shell';
import { LogoLockIn } from '@/components/logo-lock-in';
import { WaterBanner } from '@/app/(app)/dashboard/water-banner';
import { cn } from '@/lib/utils';
import { apiFetch, type Me, type StaffDetails } from '@/lib/api';
import { outcome } from '@/lib/load-failure';
import { ConfirmDetailsForm, type ChildRow, type ClubContact } from './confirm-details-form';

/**
 * *Confirmar os seus dados* — POOLSE-227 (Rui, 19-11-2026).
 *
 * Drawn by the `(app)` layouts *in place of* the page whenever `/me` says the
 * active club still needs something from this person, so it holds whatever
 * address was typed and there is no redirect to get round. Rendered, never
 * redirected to: after Clerk's own post-sign-in navigation a server redirect
 * leaves a blank page (`docs/conventions/interface.md`, *Owner and Admin land on
 * Início*).
 *
 * Everything already on file is prefilled, so nothing is typed twice: the name
 * from Clerk, the mobile from the login, a staff member's NIF and morada from
 * their own record in this club. A guardian also sees their children, read-only,
 * with a way to tell the office something is wrong — the children's fields are
 * the office's (POOLSE-177).
 *
 * **It looks like the screen that created the club** (Rui, 19-11-2026): the
 * water and the Poolse mark, the fields in headed groups. For an Owner who has
 * just made their club it is that creation's next step, and says so — *O clube*
 * done, *Os seus dados* now, *Configurar o clube* next — because that is the
 * order the person actually meets them in.
 */
export async function ConfirmDetails({ me, surface }: { me: Me; surface: 'desk' | 'app' }): Promise<React.ReactElement> {
  const t = await getTranslations();
  const membership = me.memberships[0]!;
  const roles = membership.roles;
  const required = requiredDetails(roles, { adultPathStudent: true });
  const staff = required.includes('taxNumber');
  const guardian = roles.includes('guardian');

  // A club made a moment ago: its Owner's setup steps have not moved yet.
  const creating =
    roles.includes('owner') &&
    (await apiFetch<{ wizard: { step: string | null; skipped: string[] } | null }>('/onboarding')
      .then(({ wizard }) => wizard !== null && wizard.step === 'club' && wizard.skipped.length === 0)
      .catch(() => false));

  const [details, family, contact] = await Promise.all([
    staff ? outcome(apiFetch<StaffDetails>(`/staff/${membership.membershipId}/details`)) : null,
    guardian
      ? outcome(apiFetch<{ students: { id: string; name: string; relationship: string | null; self: boolean }[] }>('/family'))
      : null,
    guardian ? outcome(apiFetch<ClubContact>('/app/club-contact')) : null,
  ]);
  const known = details?.state === 'ok' ? details.data : null;
  const children: ChildRow[] | null =
    family === null
      ? null
      : family.state === 'ok'
        ? family.data.students
            .filter((one) => !one.self)
            .map(({ id, name, relationship }) => ({ id, name, relationship }))
        : [];

  const form = (
    <ConfirmDetailsForm
      required={required}
      missing={me.detailsMissing ?? []}
      initial={{
        firstName: me.user.firstName ?? '',
        lastName: me.user.lastName ?? '',
        contactPhone: me.user.contactPhone ?? '',
        taxNumber: known?.taxNumber ?? '',
        address: known?.address ?? '',
        postalCode: known?.postalCode ?? '',
        locality: known?.locality ?? '',
      }}
      // A NIF already on file is the Owner's to change (POOLSE-149): shown, not edited.
      taxNumberLocked={(known?.taxNumber ?? null) !== null}
      staffUnreadable={staff && details?.state !== 'ok'}
      children={children}
      contact={contact?.state === 'ok' ? contact.data : null}
      {...(creating ? { confirmLabelKey: 'confirmDetails.continue' } : {})}
    />
  );

  const card = (
    <section className="overflow-hidden rounded bg-surface shadow-card">
      <WaterBanner tall={surface === 'desk'}>
        <LogoLockIn />
      </WaterBanner>
      <div className="flex flex-col gap-6 p-5 sm:p-8">
        {creating && <CreationSteps t={t} />}
        <div className="onboard-rise flex flex-col gap-1" style={{ '--i': 0 } as React.CSSProperties}>
          <h2 className="text-lg font-semibold">
            {creating ? t('confirmDetails.creatingTitle') : t('confirmDetails.cardTitle', { club: membership.organizationName })}
          </h2>
          <p className="text-sm text-foreground-muted">
            {creating ? t('confirmDetails.creatingIntro') : t('confirmDetails.intro')}
          </p>
        </div>
        {form}
      </div>
    </section>
  );

  if (surface === 'app') {
    return (
      <div
        data-surface="app"
        className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-4 px-4 pb-safe-bottom pt-[calc(var(--safe-top)+1rem)]"
      >
        <h1 className="sr-only">{t('confirmDetails.title')}</h1>
        {card}
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col pl-safe-left pr-safe-right">
      <PageShell title={t('confirmDetails.title')} subtitle={membership.organizationName}>
        <div className="mx-auto w-full max-w-2xl">{card}</div>
      </PageShell>
    </div>
  );
}

/** Creating a club, as three steps: the one just done, this one, and the setup to come. */
function CreationSteps({ t }: { t: Awaited<ReturnType<typeof getTranslations>> }): React.ReactElement {
  const steps = [
    { key: 'club', state: 'done' },
    { key: 'details', state: 'current' },
    { key: 'setup', state: 'next' },
  ] as const;
  return (
    <ol aria-label={t('confirmDetails.creatingSteps')} className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
      {steps.map((step, index) => (
        <li
          key={step.key}
          aria-current={step.state === 'current' ? 'step' : undefined}
          className={cn('flex items-center gap-2', step.state === 'next' && 'text-foreground-muted')}
        >
          <span
            aria-hidden
            className={cn(
              'inline-flex size-6 items-center justify-center rounded-full text-xs font-semibold',
              step.state === 'done'
                ? 'bg-primary text-primary-foreground'
                : step.state === 'current'
                  ? 'bg-primary/20 text-primary ring-2 ring-primary/40'
                  : 'bg-surface-muted',
            )}
          >
            {step.state === 'done' ? <Check className="size-3.5" strokeWidth={3} /> : index + 1}
          </span>
          <span className={cn(step.state === 'current' && 'font-semibold')}>
            {t(`confirmDetails.creating.${step.key}` as never)}
            {step.state === 'done' && <span className="sr-only"> ({t('checklist.done')})</span>}
          </span>
          {index < steps.length - 1 && <span aria-hidden className="mx-1 h-px w-6 bg-border" />}
        </li>
      ))}
    </ol>
  );
}
