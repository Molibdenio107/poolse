import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ArrowLeft } from 'lucide-react';
import { LinkBusy } from '@/components/link-busy';
import { PageError } from '@/components/page-shell';
import { apiFetch, type Me, type PersonQualifications } from '@/lib/api';
import { outcome } from '@/lib/load-failure';
import { storageConfigured } from '@/lib/storage-status';
import { QualificationsPanel } from '@/app/(app)/dashboard/facilities/staff/[membershipId]/qualifications-panel';

/**
 * A teacher's own qualifications — POOLSE-200: the desktop's panel, read-only here
 * as there, because a valid certificate decides who may teach and the office files it.
 */
export default async function MyQualifications(): Promise<React.ReactElement> {
  const t = await getTranslations();
  const me = await apiFetch<Me>('/me').catch(() => null);
  const membership = me?.memberships[0];
  if (membership === undefined) redirect('/dashboard');
  if (me?.viewing != null) redirect('/app/perfil');

  const id = membership.membershipId;
  const loaded = await outcome(apiFetch<PersonQualifications>(`/staff/${id}/qualifications`));

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
      <h1 className="text-xl font-semibold tracking-tight">{t('qualifications.title')}</h1>
      {loaded.state === 'ok' ? (
        <QualificationsPanel
          organizationId={membership.organizationId}
          membershipId={id}
          data={loaded.data}
          types={[]}
          storageReady={await storageConfigured()}
        />
      ) : (
        <PageError message={t(loaded.state === 'failed' ? loaded.failure.key : 'common.notAllowed')} />
      )}
    </>
  );
}
