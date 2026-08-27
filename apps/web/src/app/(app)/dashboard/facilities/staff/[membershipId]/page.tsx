import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ApiError, apiFetch, type People, type StaffRecord } from '@/lib/api';
import { PageShell, PageError } from '@/components/page-shell';
import { RoleBadges } from '@/components/role-badge';
import { StaffForm } from './staff-form';

/**
 * One staff member — POOLSE-39.
 *
 * A record that could be created and not corrected is the complaint that
 * produced the ticket. Name, phone and notes are editable here; email is shown
 * and explained rather than merely disabled, because it is the login identity
 * and moves only by re-invitation.
 *
 * Where this Person is also a student, the two are sections of one record and
 * this links across — AC7, and POOLSE-17's whole point.
 */
export default async function StaffMemberPage({
  params,
}: {
  params: Promise<{ membershipId: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const { membershipId } = await params;

  let staff: StaffRecord | null = null;
  let people: People | null = null;
  let failure: string | null = null;
  let notPermitted = false;

  try {
    // `people` carries who the *viewer* is allowed to grant, which is what the
    // role editor offers. Asking the matrix rather than assuming from a role.
    [staff, people] = await Promise.all([
      apiFetch<StaffRecord>(`/staff/${membershipId}`),
      apiFetch<People>('/people'),
    ]);
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) notPermitted = true;
    else failure = error instanceof ApiError ? `${error.status} ${error.message}` : String(error);
  }

  const name = [staff?.firstName, staff?.lastName].filter(Boolean).join(' ');

  return (
    <PageShell
      title={name === '' ? t('staff.title') : name}
      subtitle={staff?.email ?? undefined}
      back={{ href: '/dashboard/facilities/staff', label: t('staff.backToStaff') }}
      actions={staff === null ? undefined : <RoleBadges roles={staff.roles} />}
    >
      {notPermitted && (
        <section className="rounded border border-border bg-surface p-5">
          <p>{t('staff.recordRestricted')}</p>
        </section>
      )}

      {failure !== null && <PageError message={t('account.unavailable')} detail={failure} />}

      {staff !== null && people !== null && (
        <>
          {/*
            One Person, two sections — AC7. A phone number corrected here is the
            number Alunos shows, because it is the same row.
          */}
          {staff.studentId !== null && (
            <p className="text-sm text-foreground-muted">
              {t('staff.alsoAStudent')}{' '}
              <Link
                href={`/dashboard/students/${staff.studentId}`}
                className="text-primary underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                {t('staff.openStudentRecord')}
              </Link>
            </p>
          )}

          {/*
            `canArchive` is owner-or-admin and `canTransferOwnership` is owner
            alone — both already computed server-side by the same helpers the API
            guards with. Deriving either from the grantable list would be a
            second rule that agrees today and drifts later.
          */}
          <StaffForm
            organizationId={people.organizationId}
            staff={staff}
            canManage={people.canArchive}
            isOwner={people.canTransferOwnership}
            grantable={[...people.grantableRoles]}
          />
        </>
      )}
    </PageShell>
  );
}
