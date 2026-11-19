import { getTranslations } from 'next-intl/server';
import { requiredDetails } from '@poolse/rules';
import { PageShell } from '@/components/page-shell';
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
 */
export async function ConfirmDetails({ me, surface }: { me: Me; surface: 'desk' | 'app' }): Promise<React.ReactElement> {
  const t = await getTranslations();
  const membership = me.memberships[0]!;
  const roles = membership.roles;
  const required = requiredDetails(roles, { adultPathStudent: true });
  const staff = required.includes('taxNumber');
  const guardian = roles.includes('guardian');

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
    />
  );

  if (surface === 'app') {
    return (
      <div
        data-surface="app"
        className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-4 px-4 pb-safe-bottom pt-[calc(var(--safe-top)+1rem)]"
      >
        <header className="flex flex-col gap-1">
          <p className="text-sm text-foreground-muted">{membership.organizationName}</p>
          <h1 className="text-xl font-semibold tracking-tight">{t('confirmDetails.title')}</h1>
          <p className="text-sm text-foreground-muted">{t('confirmDetails.intro')}</p>
        </header>
        {form}
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col pl-safe-left pr-safe-right">
      <PageShell title={t('confirmDetails.title')} subtitle={membership.organizationName}>
        <p className="text-sm text-foreground-muted">{t('confirmDetails.intro')}</p>
        {form}
      </PageShell>
    </div>
  );
}
