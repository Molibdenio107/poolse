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
  type StaffContract,
  type StaffDetails,
  type StaffIdentity,
  type StaffRecord,
} from '@/lib/api';
import { outcome } from '@/lib/load-failure';
import { QualificationsPanel } from './qualifications-panel';
import { PageShell, PageError } from '@/components/page-shell';
import { IdPhoto } from '@/components/id-photo';
import { fileUrl } from '@/lib/files';
import { RoleBadges } from '@/components/role-badge';
import { DetailPage } from '@/components/detail-page';
import { Reinvite, RoleEditor, StaffForm } from './staff-form';
import { storageConfigured } from '@/lib/storage-status';
import { Identification } from './identification';
import { ContractTab } from './contract-tab';
import { DetailsCard } from './details-card';
import { SportsCard } from './sports-card';
import { isMultiSport } from '@poolse/rules';

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
          <section className="rounded bg-surface p-5 shadow-card">
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
  /*
    Contrato — POOLSE-149. The pay rule: an Admin never sees the Owner's, which
    the API answers as a 404 (absent, not refused) — so it is asked with the
    page, and that answer hides the tab while a real failure keeps it.
  */
  const contract = await outcome(apiFetch<StaffContract>(`/staff/${membershipId}/contract`));

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
            // POOLSE-149: owner, admin and the person; a refusal is no card.
            const [details, me] = await Promise.all([
              outcome(apiFetch<StaffDetails>(`/staff/${membershipId}/details`)),
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
                The photograph inside the person's card, beside the form — as on
                O meu perfil (Rui, 28-10-2026). The club files one for somebody
                with no login; somebody with a login sets their own, as with
                their name, and their own record offers them that here too.
              */}
              <section className="flex flex-wrap items-start gap-5 rounded bg-surface p-5 shadow-card">
                <IdPhoto
                  url={record.photoFileId !== null ? fileUrl(record.photoFileId) : record.avatarUrl}
                  name={record.displayName ?? ''}
                  target={
                    record.appUserId === null
                      ? viewer.canArchive
                        ? `staff-photo:${record.membershipId}`
                        : null
                      : me?.memberships[0]?.membershipId === membershipId
                        ? 'own-photo'
                        : null
                  }
                  reason={
                    record.appUserId === null
                      ? viewer.canArchive && !storageReady
                        ? t('files.notConfigured')
                        : null
                      : me?.memberships[0]?.membershipId === membershipId
                        ? null
                        : viewer.canArchive
                          ? t('photo.theirOwn')
                          : null
                  }
                />
                <div className="min-w-0 flex-1 basis-64">
                  <StaffForm
                    organizationId={viewer.organizationId}
                    staff={record}
                    canManage={viewer.canArchive}
                  />
                </div>
              </section>

              {/*
                Desportos — POOLSE-145. Only where the club has more than one
                sport, and only for an instructor: the sports decide whose
                students they read, and nobody else's reading depends on it.
              */}
              {isMultiSport(me?.memberships[0]?.sports) && record.roles.includes('instructor') && (
                <SportsCard
                  membershipId={membershipId}
                  sports={record.sports}
                  clubSports={me?.memberships[0]?.sports ?? []}
                  canManage={viewer.canArchive}
                />
              )}

              {details.state === 'ok' && (
                <DetailsCard membershipId={membershipId} details={details.data} canManage={viewer.canArchive} />
              )}
              {details.state === 'failed' && <PageError message={t('staffDetails.loadFailed')} />}
            </>
            );
          },
        },
        {
          /*
            Identificação — POOLSE-100's number and POOLSE-149's photograph.
            Whoever can open this record (owner, admin, the person) is whom the
            identity route answers, so the tab is always offered; the read is
            asked when the tab opens, because every answer to somebody else is
            an audited read of the number.
          */
          slug: 'identification',
          labelKey: 'staffIdentity.title',
          content: async () => {
            const [identity, me] = await Promise.all([
              outcome(apiFetch<StaffIdentity>(`/staff/${membershipId}/identity`)),
              apiFetch<Me>('/me').catch(() => null),
            ]);
            if (identity.state === 'failed') return <PageError message={t('staffIdentity.loadFailed')} />;
            if (identity.state !== 'ok') return <p className="text-sm text-foreground-muted">{t('staffIdentity.notAllowed')}</p>;
            return (
              <Identification
                membershipId={membershipId}
                identity={identity.data}
                own={me?.memberships[0]?.membershipId === membershipId}
                storageReady={storageReady}
              />
            );
          },
        },
        {
          slug: 'contract',
          labelKey: 'staffContract.title',
          visible: contract.state === 'ok' || (contract.state === 'failed' && contract.status !== 404),
          content: () =>
            contract.state === 'ok' ? (
              <ContractTab membershipId={membershipId} contract={contract.data} storageReady={storageReady} />
            ) : contract.state === 'failed' ? (
              <PageError message={t('staffContract.loadFailed')} />
            ) : null,
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
