import { FromLink } from '@/components/from-link';
import { describeLoad, type LoadFailure } from '@/lib/load-failure';
import { backTarget } from '@/lib/back';
import { getTranslations } from 'next-intl/server';
import {
  ApiError,
  apiFetch,
  type People,
  type PersonQualifications,
  type QualificationTypes,
  type Me,
  type StaffIdentity,
  type StaffRecord,
} from '@/lib/api';
import { outcome } from '@/lib/load-failure';
import { QualificationsPanel } from './qualifications-panel';
import { PageShell, PageError } from '@/components/page-shell';
import { PhotoUpload } from '@/components/photo-upload';
import { RoleBadges } from '@/components/role-badge';
import { DetailPage } from '@/components/detail-page';
import { Reinvite, RoleEditor, StaffForm } from './staff-form';
import { storageConfigured } from '@/lib/storage-status';
import { IdentityCard } from './identity-card';

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
 *
 * **Tabs since the detail-tabs change**: General (the record), Funções (owner
 * and admin) and Acesso — the change of address, owner only.
 */
export default async function StaffMemberPage({
  params,
  searchParams,
}: {
  params: Promise<{ membershipId: string }>;
  searchParams: Promise<{ tab?: string | string[]; from?: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const { membershipId } = await params;
  const storageReady = await storageConfigured();
  const { tab, from } = await searchParams;

  let staff: StaffRecord | null = null;
  let people: People | null = null;
  let failure: LoadFailure | null = null;
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
    else failure = describeLoad(error);
  }

  // The full legal name: this is a record, not a row — POOLSE-32 criterion 3.
  const name = staff?.displayName ?? '';

  const target = backTarget(from, '/dashboard/facilities/staff');
  const back = { href: target.href, label: t(target.labelKey) };

  if (staff === null || people === null) {
    return (
      <PageShell title={t('staff.title')} back={back}>
        {notPermitted && (
          <section className="rounded border border-border bg-surface p-5">
            <p>{t('staff.recordRestricted')}</p>
          </section>
        )}

        {failure !== null && <PageError message={t(failure.key)} detail={failure.detail} />}
      </PageShell>
    );
  }

  const record = staff;
  const viewer = people;

  /*
    Qualificações — POOLSE-27. Owner and admin see anybody's; a person sees
    their own; anybody else is refused, and a refusal is what hides the tab, so
    it is asked with the page rather than when the tab opens.
  */
  const qualifications = await outcome(
    apiFetch<PersonQualifications>(`/staff/${membershipId}/qualifications`),
  );

  return (
    <DetailPage
      title={name === '' ? t('staff.title') : name}
      subtitle={record.email ?? undefined}
      back={back}
      actions={<RoleBadges roles={record.roles} />}
      requested={tab}
      /*
        `canArchive` is owner-or-admin and `canTransferOwnership` is owner alone
        — both already computed server-side by the same helpers the API guards
        with. Deriving either from the grantable list would be a second rule
        that agrees today and drifts later. They decide the two tabs after
        General exactly as they decided the two sections before.
      */
      tabs={[
        {
          slug: 'general',
          labelKey: 'detailTabs.general',
          content: async () => {
            /*
              Identificação — POOLSE-100. Asked with the tab: the API answers the
              owner, an admin and the person, and a refusal is no card at all.
              Every answer to somebody else is an audited read of the number.
            */
            const [identity, me] = await Promise.all([
              outcome(apiFetch<StaffIdentity>(`/staff/${membershipId}/identity`)),
              apiFetch<Me>('/me').catch(() => null),
            ]);
            return (
            <>
              {/*
                One Person, two sections — AC7. A phone number corrected here is
                the number Alunos shows, because it is the same row.
              */}
              {record.studentId !== null && (
                <p className="text-sm text-foreground-muted">
                  {t('staff.alsoAStudent')}{' '}
                  <FromLink
                    href={`/dashboard/students/${record.studentId}`}
                    className="text-primary underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  >
                    {t('staff.openStudentRecord')}
                  </FromLink>
                </p>
              )}

              {/*
                The same ID square the student record has — round 5. Disabled for
                the same reason and saying the same thing, because a photograph
                of a member of staff waits on exactly the storage a student's does.
              */}
              <div className="flex flex-wrap items-start gap-5">
                <PhotoUpload
                  variant="id"
                  label={t('students.photoUpload')}
                  reason={t('students.photoNoStorage')}
                />
                <div className="min-w-0 flex-1 basis-64">
                  <StaffForm
                    organizationId={viewer.organizationId}
                    staff={record}
                    canManage={viewer.canArchive}
                  />
                </div>
              </div>

              {identity.state === 'ok' && (
                <IdentityCard
                  membershipId={membershipId}
                  identity={identity.data}
                  own={me?.memberships[0]?.membershipId === membershipId}
                />
              )}
              {identity.state === 'failed' && <PageError message={t('staffIdentity.loadFailed')} />}
            </>
            );
          },
        },
        {
          slug: 'qualifications',
          labelKey: 'qualifications.title',
          visible: qualifications.state !== 'refused',
          badge:
            qualifications.state === 'ok' &&
            qualifications.data.standings.some((s) => s.status !== 'green')
              ? { kind: 'dot', labelKey: 'qualifications.badge' }
              : undefined,
          content: async () => {
            if (qualifications.state !== 'ok') {
              return qualifications.state === 'failed' ? (
                <PageError message={t(qualifications.failure.key)} />
              ) : null;
            }
            // The form's options. A failure says so rather than reading as "no
            // types", which would send somebody to create one that exists.
            const types = qualifications.data.canManage
              ? await outcome(apiFetch<QualificationTypes>('/qualification-types'))
              : null;
            if (types !== null && types.state === 'failed') {
              return <PageError message={t(types.failure.key)} />;
            }
            return (
              <QualificationsPanel
                organizationId={viewer.organizationId}
                membershipId={membershipId}
                data={qualifications.data}
                types={types !== null && types.state === 'ok' ? types.data.types : []}
                storageReady={storageReady}
              />
            );
          },
        },
        {
          slug: 'roles',
          labelKey: 'staff.roles',
          visible: viewer.canArchive,
          content: () => (
            <RoleEditor
              organizationId={viewer.organizationId}
              staff={record}
              grantable={[...viewer.grantableRoles]}
            />
          ),
        },
        {
          slug: 'access',
          labelKey: 'detailTabs.access',
          visible: viewer.canTransferOwnership,
          badge:
            record.pendingInvite !== null
              ? { kind: 'dot', labelKey: 'detailTabs.badge.reinvitePending' }
              : undefined,
          content: () => <Reinvite organizationId={viewer.organizationId} staff={record} />,
        },
      ]}
    />
  );
}
