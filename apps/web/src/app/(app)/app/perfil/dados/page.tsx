import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';
import { LinkBusy } from '@/components/link-busy';
import { PageError } from '@/components/page-shell';
import { apiFetch, type Me, type StaffDetails, type StaffIdentity } from '@/lib/api';
import { outcome } from '@/lib/load-failure';
import { storageConfigured } from '@/lib/storage-status';
import { DetailsCard } from '@/app/(app)/dashboard/facilities/staff/[membershipId]/details-card';
import { Identification } from '@/app/(app)/dashboard/facilities/staff/[membershipId]/identification';

/**
 * A teacher's own details — POOLSE-200: the desktop's two cards, on the routes
 * that already let a person write their own. The NIF and NISS stay read-only:
 * `canManage` is off here, and the API refuses them to anybody but the Owner.
 */
export default async function MyDetails(): Promise<React.ReactElement> {
  const t = await getTranslations();
  const me = await apiFetch<Me>('/me').catch(() => null);
  const membership = me?.memberships[0];
  if (membership === undefined) redirect('/dashboard');
  if (me?.viewing != null) redirect('/app/perfil');

  const id = membership.membershipId;
  const [details, identity, storageReady] = await Promise.all([
    outcome(apiFetch<StaffDetails>(`/staff/${id}/details`)),
    outcome(apiFetch<StaffIdentity>(`/staff/${id}/identity`)),
    storageConfigured(),
  ]);

  return (
    <>
      <Link
        href="/app/perfil?home=teaching"
        aria-label={t('app.profile.backTo')}
        className="inline-flex items-center gap-1.5 self-start text-sm text-primary hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {t('common.back')}
        <LinkBusy />
      </Link>
      <h1 className="text-xl font-semibold tracking-tight">{t('app.profile.myDetails')}</h1>
      {details.state === 'ok' ? (
        <DetailsCard membershipId={id} details={details.data} canManage={false} />
      ) : (
        <PageError message={t('staffDetails.loadFailed')} />
      )}
      {identity.state === 'ok' ? (
        <Identification membershipId={id} identity={identity.data} own canEdit storageReady={storageReady} />
      ) : (
        <PageError message={t('staffIdentity.loadFailed')} />
      )}
    </>
  );
}
