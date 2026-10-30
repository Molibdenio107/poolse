import { AlertTriangle } from 'lucide-react';
import { FromLink } from '@/components/from-link';
import { ActivityPanel } from '@/components/activity-panel';
import { readPage, type Paginated } from '@/lib/pagination';
import { backTarget } from '@/lib/back';
import { describeLoad, outcome, type LoadFailure, type Outcome } from '@/lib/load-failure';
import { getLocale, getTranslations } from 'next-intl/server';
import {
  ApiError,
  apiFetch,
  type Calendar,
  type LessonFeedback,
  type Student,
  type StudentFees,
  type StudentIdDocument,
  type Students,
  type TimetableEntry,
  type ReposicaoCredit,
} from '../../../../../lib/api';
import { addDays, isDate, mondayOf, today } from '@/lib/dates';
import { PersonAvatar } from '@/components/person-avatar';
import { IdPhoto } from '@/components/id-photo';
import { storageConfigured } from '@/lib/storage-status';
import { photoUrlFor } from '@/lib/photo';
import { StudentForm } from '../student-forms';
import { CreditBooking } from './credit-booking';
import { StudentWeek } from './student-week';
import { CoverBadge, FeesBlock, type FeesSection } from './fees-block';
import { ContactsCard } from './contacts-card';
import { FamilyFees } from './family-fees';
import { BoletimPanel } from './boletim-panel';
import { AppInviteButton, FamilyAccess, type Invitee } from './family-access';
import { SectionPills, pickSection, sectionHref } from '@/components/section-pills';
import type { StudentDocuments } from '@/lib/fpn-forms';
import { FpnSection, IdentificationSection } from './documents';
import { loadFees } from './fees.actions';
import { ActionButton } from '@/components/action-button';
import { PageError, PageShell } from '@/components/page-shell';
import { DetailPage } from '@/components/detail-page';
import { FeedbackList } from '@/components/feedback-list';
import { Pagination } from '@/components/pagination';
import { formatDate } from '@/lib/date-format';
import { countryName } from '@/lib/countries';

/**
 * One student's record.
 *
 * Its own page rather than an inline row expansion: the register is a list an
 * operator scans, and editing is a different job done with attention. It also
 * gives every student a URL, which the class-group and attendance screens will
 * want to link to from slice 1.4 onward.
 *
 * **Tabs since the detail-tabs change**: General (the progress and medical
 * record buttons, then the identity form), Mensalidades, Documento, Turmas,
 * Semana and Reposições. Progress and the medical record stay their own pages.
 *
 * **A family reads it too** — 15 October 2026 (Rui). The child's guardian, or
 * the student, gets the record read-only (`familyView` from the API): General
 * without the club's notes, Mensalidades as `FamilyFees`, Turmas, Semana with
 * the lesson plans and Reposições. No medical record, no document, no forms.
 */
export default async function StudentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{
    week?: string;
    tab?: string | string[];
    section?: string | string[];
    page?: string;
    from?: string;
  }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const locale = await getLocale();
  const { id } = await params;
  const { week, tab, section, page, from } = await searchParams;

  const monday = mondayOf(isDate(week) ? week : today());
  const sunday = addDays(monday, 6);

  let student: Student | null = null;
  let credits: ReposicaoCredit[] = [];
  let register: Students | null = null;
  let failure: LoadFailure | null = null;
  let missing = false;

  let timetable: TimetableEntry[] = [];

  // Held apart so a missing record can still ask it whether the reader is
  // staff: `outcome` never throws, but `Promise.all` drops it when the record
  // itself 404s.
  const registerLoad = outcome(apiFetch<Students>('/students?limit=1'));

  try {
    // The register comes along for the level list and the write permission —
    // both belong to the organization rather than to this student.
    //
    // Both the dated week and the recurring pattern are needed, because the
    // page has to tell two empty weeks apart: "no classes this week" and "the
    // season has not been built yet" look identical from the calendar alone, and
    // only one of them is something to act on. The pattern is fetched here; the
    // dated week is the Semana tab's own fetch, made when that tab opens.
    const [studentResult, registerResult, timetableResult, creditsResult] =
      await Promise.all([
        apiFetch<Student>(`/students/${id}`),
        // One row is enough: this only needs the levels, the permissions and the
        // maioridade off the register response, not a page of other students.
        // Staff only; a family's record needs none of it, so a refusal here
        // is not a missing student.
        registerLoad,
        apiFetch<{ entries: TimetableEntry[] }>(`/students/${id}/timetable`),
        apiFetch<{ credits: ReposicaoCredit[] }>(`/students/${id}/credits`),
      ]);
    student = studentResult;
    if (registerResult.state === 'ok') register = registerResult.data;
    else if (registerResult.state === 'failed') failure = registerResult.failure;
    timetable = timetableResult.entries;
    credits = creditsResult.credits;
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) {
      missing = true;
    } else {
      failure = describeLoad(error);
    }
  }

  /*
   * What this student pays — POOLSE-42.
   *
   * After the main fetch and outside its try, because it is the one block on
   * this page whose absence is a *permission* rather than a failure: `loadFees`
   * answers null when the endpoint refuses, which is what an instructor gets.
   * AC10 makes that a page without the block, not a block saying no.
   */
  const family = student?.familyView === true;
  let sitesUnread = false;
  let organizationId = register?.organizationId ?? '';
  const facilities =
    student === null
      ? []
      : await apiFetch<{ organizationId: string; facilities: { id: string; name: string }[] }>('/facilities')
          .then((response) => {
            organizationId = organizationId || response.organizationId;
            return response.facilities.map((f) => ({ id: f.id, name: f.name }));
          })
          .catch(() => {
            // Still the lines the student has; but a new fee at another site
            // cannot be offered, and the tab says so.
            sitesUnread = true;
            return [];
          });

  const billing = student === null || family ? null : await loadFees(id, facilities.map((f) => f.id));
  // What a family owes, from the same endpoint's family path.
  const familyFees: Outcome<StudentFees> | null = family
    ? await outcome(apiFetch<StudentFees>(`/students/${id}/fees`))
    : null;

  // A record that will not load is a family's too: the register refuses
  // anybody who is not staff, which is the one thing a missing record can say.
  const readerIsFamily = family || (student === null && (await registerLoad).state === 'refused');

  // A detail page shows the full legal name, every part — POOLSE-32
  // criterion 3. Abbreviation is for lists.
  // A family is never shown the staff's "the organization's register".
  const subtitle =
    student?.age === null || student === null
      ? t(readerIsFamily ? 'family.recordSubtitle' : 'students.subtitle')
      : t('students.years', { count: student.age });

  /*
   * Back, for a family — 15-10-2026 sweep. *Os meus educandos* redirects
   * straight back here when it holds one record, so a back link to it was a
   * loop. Only a family with several records has a list to go back to; anyone
   * else, or a list that will not load, goes to the dashboard.
   */
  const familyRecords = readerIsFamily
    ? await apiFetch<{ students: unknown[] }>('/family')
        .then((answer) => answer.students.length)
        .catch(() => 0)
    : 0;
  // Where the link was followed from wins, for a family as for staff (POOLSE-91).
  const target = backTarget(
    from,
    readerIsFamily ? (familyRecords > 1 ? '/dashboard/family' : '/dashboard') : '/dashboard/students',
  );
  const back = { href: target.href, label: t(target.labelKey) };

  if (student === null || (register === null && !family)) {
    return (
      <PageShell title={t(readerIsFamily ? 'family.title' : 'students.title')} subtitle={subtitle} back={back}>
        {missing && (
          <section className="rounded border border-border bg-surface p-5">
            <p>{t('students.notFound')}</p>
          </section>
        )}

        {failure !== null && (
          <PageError
            message={t(failure.key)}
            {...(failure.detail === '' ? {} : { detail: failure.detail })}
          />
        )}
      </PageShell>
    );
  }

  const loaded = student;
  // A family has no register: nothing to manage, no levels to pick from.
  const reg = register ?? {
    organizationId,
    canManage: false,
    levels: [],
    ageOfMajority: 18,
  };
  // One row per turma, not per slot: a turma that meets on Tuesday and Thursday
  // is one enrolment, and listing it twice would read as two.
  const turmas = [...new Map(timetable.map((entry) => [entry.classGroupId, entry])).values()];

  const storageReady = await storageConfigured();

  /*
   * The ID document with its number in full, for owner and admin (Rui,
   * 30-10-2026) — read only on the two tabs that show it, because every read
   * that decrypts a number is a line in the activity log.
   */
  const requestedTab = Array.isArray(tab) ? tab[0] : tab;
  const idDocument: StudentIdDocument | null | undefined =
    reg.canManage && (requestedTab === undefined || requestedTab === 'general' || requestedTab === 'document')
      ? await apiFetch<StudentIdDocument>(`/students/${id}/documents/id-document`).catch(() => undefined)
      : undefined;

  /*
   * Who on this record could be in the app — POOLSE-129. Read once for both the
   * General tab's *Convidar para a app* and the *Acesso à app* tab. Staff only.
   */
  type AppAccess = { organizationName: string; canInvite: boolean; invitees: Invitee[] };
  const access: Outcome<AppAccess> | null = family
    ? null
    : await outcome(apiFetch<AppAccess>(`/students/${id}/invitations`));
  const invitable =
    access?.state === 'ok' &&
    access.data.canInvite &&
    access.data.invitees.some((invitee) => invitee.state !== 'in_app');

  return (
    <DetailPage
      title={loaded.displayName}
      subtitle={subtitle}
      back={back}
      actions={
        <PersonAvatar
          id={loaded.id}
          name={loaded.displayName}
          photoUrl={photoUrlFor(loaded.photoFileId)}
          size="lg"
        />
      }
      requested={tab}
      tabs={[
        {
          slug: 'general',
          labelKey: 'detailTabs.general',
          content: () => (
            <>
              {/*
                Retention — 7b.8. A student who left is told, in words, when
                their health data goes and when their identity does, or that the
                first already went. Visible text, never a tooltip.
              */}
              {loaded.retention != null && (
                <p className="rounded border border-border bg-surface-muted p-3 text-sm text-foreground-muted">
                  {loaded.retention.healthErasedAt === null
                    ? t('students.retention.pending', {
                        left: formatDate(loaded.retention.leftOn),
                        health: formatDate(loaded.retention.healthErasesOn),
                        identity: formatDate(loaded.retention.identityErasesOn),
                      })
                    : t('students.retention.healthErased', {
                        left: formatDate(loaded.retention.leftOn),
                        erased: formatDate(loaded.retention.healthErasedAt),
                        identity: formatDate(loaded.retention.identityErasesOn),
                      })}
                </p>
              )}

              {/*
                POOLSE-81: in a competitive level with no FPN licence. A warning,
                never a gate — the student is enrolled and marked as before.
              */}
              {loaded.licenceMissing && (
                <p className="flex items-start gap-2 rounded border border-warning/40 bg-warning/10 p-3 text-sm">
                  <AlertTriangle className="attention mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                  {t('students.licenceMissing', { level: loaded.levelName ?? '' })}
                </p>
              )}

              {/* One student at a time, into the app — Rui, 30-10-2026. */}
              {invitable && access?.state === 'ok' && (
                <AppInviteButton
                  studentId={id}
                  studentFirstName={loaded.firstName}
                  organizationName={access.data.organizationName}
                  canInvite={access.data.canInvite}
                  invitees={access.data.invitees}
                />
              )}

              {/*
                The record's action area — backlog round 3, story 9.

                Progress and the medical record remain their own screens rather
                than tabs here, and the hint beside them says why: opening the
                medical record is written to the audit log. Special-category
                data about a child should be reached deliberately, not clicked
                into while doing something else.
              */}
              {(loaded.canViewProgress !== false || loaded.canViewSensitive !== false) && (
                <div className="flex flex-wrap items-center gap-3">
                  {loaded.canViewProgress !== false && (
                    <ActionButton
                      href={`/dashboard/students/${id}/progress`}
                      icon="progress"
                      label={t('progress.open')}
                    />
                  )}
                  {loaded.canViewSensitive !== false && (
                    <>
                      <ActionButton
                        href={`/dashboard/students/${id}/sensitive`}
                        icon="medical"
                        tone="sensitive"
                        label={t('sensitive.open')}
                      />
                      <span className="text-sm text-foreground-muted">
                        {t('sensitive.openHint')}
                      </span>
                    </>
                  )}
                </div>
              )}

              {/*
                The seguro, and who to ring — POOLSE-88 slice 2. On the record
                itself rather than only under Pagamentos, because an instructor
                has no Pagamentos tab and is the person at the poolside who
                needs both. A warning, never a gate.
              */}
              {!family && loaded.cover !== undefined && loaded.cover !== null && (
                <CoverBadge cover={loaded.cover} />
              )}
              {!family && (
                <ContactsCard
                  guardians={loaded.guardians}
                  studentName={loaded.displayName}
                  studentPhone={loaded.contactPhone}
                  studentEmail={loaded.contactEmail}
                />
              )}

              {/*
                Who this student is — the name, the level, the birth date. It is
                the reason somebody opens this screen and the thing they most
                often came to correct, so it leads.

                The photograph sits inside this block rather than in a section of
                its own: an ID photo belongs beside the name it identifies.
              */}
              <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
                {reg.canManage ? (
                  <div className="flex flex-wrap items-start gap-5">
                    {/* Filed only with a photo consent, as it is shown (28-10-2026). */}
                    <IdPhoto
                      url={photoUrlFor(loaded.photoFileId)}
                      name={loaded.displayName}
                      target={`student-photo:${loaded.id}`}
                      reason={
                        !loaded.photoConsent
                          ? t('students.photoNoConsent')
                          : !storageReady
                            ? t('files.notConfigured')
                            : null
                      }
                    />
                    {/* A 16rem basis, so on a phone the form wraps under the photo
                        rather than shrinking beside it to a 138px column (POOLSE-88). */}
                    <div className="min-w-0 flex-1 basis-64">
                      <StudentForm
                        organizationId={reg.organizationId}
                        levels={reg.levels}
                        student={loaded}
                        mode="edit"
                        ageOfMajority={reg.ageOfMajority}
                        {...(idDocument === undefined ? {} : { idDocument })}
                      />
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="mb-4 text-sm text-foreground-muted">
                      {family ? t('family.recordHint') : t('students.readOnly')}
                    </p>
                    <dl className="flex flex-col gap-3">
                      <Row
                        label={t('students.level')}
                        value={loaded.levelName ?? t('students.noLevel')}
                      />
                      <Row
                        label={t('students.birthDate')}
                        value={loaded.birthDate === null ? null : formatDate(loaded.birthDate)}
                      />
                      <Row
                        label={t('students.gender')}
                        value={
                          loaded.gender === null
                            ? null
                            : loaded.gender === 'male'
                              ? t('students.genderMale')
                              : t('students.genderFemale')
                        }
                      />
                      <Row label={t('students.contactEmail')} value={loaded.contactEmail} />
                      <Row label={t('students.contactPhone')} value={loaded.contactPhone} />
                      <Row label={t('students.taxNumber')} value={loaded.taxNumber} />
                      <Row
                        label={t('students.federationLicence')}
                        value={loaded.federationLicence}
                      />
                      {/* POOLSE-131: read-only, and the SNS number only as "registado". */}
                      <Row
                        label={t('students.identity.addressLine')}
                        value={
                          [
                            loaded.identity?.addressLine,
                            [loaded.identity?.postalCode, loaded.identity?.locality].filter(Boolean).join(' '),
                          ]
                            .filter((part) => part !== undefined && part !== null && part !== '')
                            .join(', ') || null
                        }
                      />
                      <Row
                        label={t('students.identity.nationality')}
                        value={
                          loaded.identity?.nationality == null
                            ? null
                            : countryName(loaded.identity.nationality, locale)
                        }
                      />
                      {!family && (
                        <Row
                          label={t('students.identity.snsNumber')}
                          value={
                            loaded.identity?.snsRecorded === true
                              ? t('students.identity.snsOnFile')
                              : t('students.identity.snsNone')
                          }
                        />
                      )}
                      {!family && <Row label={t('students.notes')} value={loaded.notes} />}
                    </dl>
                  </>
                )}
              </section>
            </>
          ),
        },
        {
          /*
            What this student pays — POOLSE-42. Absent for an instructor: AC10
            makes that a page without the tab, not a tab saying no.
          */
          slug: 'fees',
          labelKey: 'detailTabs.fees',
          visible: family
            ? familyFees !== null && familyFees.state !== 'refused'
            : billing !== null && billing.state !== 'refused',
          content: () =>
            familyFees !== null ? (
              familyFees.state === 'failed' ? (
                <PageError message={t(familyFees.failure.key)} />
              ) : (
                familyFees.state === 'ok' && <FamilyFees fees={familyFees.data} />
              )
            ) : billing?.state === 'failed' ? (
              <PageError message={t(billing.failure.key)} />
            ) : (
              billing?.state === 'ok' && (
                <>
                  {/*
                    One section at a time — 12 October 2026, as on Preços.
                    Inscrição e seguro is offered only when a season has a
                    price to charge: with none, the card had nothing in it but
                    its heading, and a pill that opens an empty card is a pill
                    somebody clicks to find nothing.
                  */}
                  {(sitesUnread || billing.data.sitesFailed > 0) && (
                    <p className="text-sm text-warning">{t('fees.pricesUnread')}</p>
                  )}
                  <FeesBlock
                    studentId={loaded.id}
                    fees={billing.data.fees}
                    periods={billing.data.periods}
                    {...feesSections(billing.data.fees.seasonCharges.length > 0, section)}
                    path={`/dashboard/students/${id}`}
                  />
                  {/* POOLSE-134: the boletim, beside the sócio it is about. */}
                  {/* Only under the Sócio section — Rui, 30-10-2026. */}
                  {reg.canManage &&
                    loaded.isSocio &&
                    feesSections(billing.data.fees.seasonCharges.length > 0, section).section === 'socio' && (
                      <BoletimPanel studentId={loaded.id} storageReady={storageReady} />
                    )}
                </>
              )
            ),
        },
        {
          slug: 'document',
          labelKey: 'students.document',
          visible: reg.canManage,
          /*
            *Documentos* — POOLSE-132. Three sections behind pills: the ID
            document, the FPN's Anexo 2, and its minors' form only for a minor
            (offered with a sentence when the birth date is missing — never
            guessed). The slug stays `document` so old links still land here.
          */
          content: async () => {
            const documents = await outcome(apiFetch<StudentDocuments>(`/students/${id}/documents`));
            if (documents.state === 'refused') return <PageError message={t('common.notAllowed')} />;
            if (documents.state === 'failed') return <PageError message={t(documents.failure.key)} />;
            const docs = documents.data;
            const offered: DocumentsSection[] =
              docs.minor === false ? ['identificacao', 'fpn'] : ['identificacao', 'fpn', 'fpn-menores'];
            const current = pickSection(offered, section, 'identificacao');
            const path = `/dashboard/students/${id}`;
            return (
              <div className="flex flex-col gap-4">
                <SectionPills
                  label={t('documents.sectionsLabel')}
                  current={current}
                  items={offered.map((key) => ({
                    key,
                    label: t(`documents.section.${key}`),
                    href: sectionHref(path, { tab: 'document', from }, key),
                  }))}
                />
                {current === 'identificacao' && (
                  <>
                    {/*
                      The ID document's photograph and its details, together: a photo dropped
                      anywhere on the page is filed and, with the reader on, read into the form
                      below for confirmation (Rui, 30-10-2026).
                    */}
                    <IdentificationSection
                      studentId={loaded.id}
                      idDocument={docs.idDocument}
                      fullNumber={idDocument?.number ?? null}
                      photo={(() => {
                        const current = docs.copies.find((copy) => copy.kind === 'id_document' && copy.replacedAt === null);
                        return current === undefined ? null : { fileId: current.fileId, filedAt: current.filedAt };
                      })()}
                      storageReady={storageReady}
                    />
                  </>
                )}
                {current === 'fpn' && (
                  <FpnSection studentId={loaded.id} kind="fpn_declaration" documents={docs} storageReady={storageReady} />
                )}
                {current === 'fpn-menores' &&
                  (docs.minor === null ? (
                    <section className="flex flex-col gap-3 rounded border border-border bg-surface p-5">
                      <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
                        {t('documents.fpn.titleMinor')}
                      </h2>
                      <p className="text-sm">{t('documents.fpn.birthDateMissing')}</p>
                      <p>
                        <FromLink
                          href={`${path}?tab=general`}
                          className="text-primary underline-offset-2 hover:underline"
                        >
                          {t('documents.fpn.birthDateLink')}
                        </FromLink>
                      </p>
                    </section>
                  ) : (
                    <FpnSection
                      studentId={loaded.id}
                      kind="fpn_declaration_minor"
                      documents={docs}
                      storageReady={storageReady}
                    />
                  ))}
              </div>
            );
          },
        },
        {
          /*
            Which turmas this student is in — round 4 follow-up. Before the week
            on purpose: "what is she enrolled in" is the question somebody
            opening a student record is usually holding, and it explains an
            empty week. Read from the recurring pattern rather than the dated
            week, so it does not empty out on a week the club was closed.
          */
          slug: 'turmas',
          labelKey: 'students.turmas',
          visible: turmas.length > 0,
          badge: { kind: 'count', value: turmas.length },
          content: () => (
            <section className="flex flex-col gap-3 rounded border border-border bg-surface p-5">
              <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
                {t('students.turmas')}
              </h2>

              <ul className="flex flex-col divide-y divide-border">
                {turmas.map((entry) => (
                  <li
                    key={entry.classGroupId}
                    className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2 first:pt-0 last:pb-0"
                  >
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      {family ? (
                        // A turma's page is staff only.
                        <span className="font-medium">{entry.className}</span>
                      ) : (
                        <FromLink
                          href={`/dashboard/classes/${entry.classGroupId}`}
                          className="rounded font-medium text-primary underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                        >
                          {entry.className}
                        </FromLink>
                      )}
                      {entry.status === 'waiting' && (
                        <span className="rounded bg-surface-muted px-2 py-0.5 text-xs text-foreground-muted">
                          {t('students.waiting')}
                        </span>
                      )}
                    </span>

                    <span className="text-sm text-foreground-muted">
                      {[
                        entry.levelName,
                        entry.poolName,
                        entry.instructorName,
                        entry.lane === null ? null : t('classes.laneN', { lane: entry.lane }),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ),
        },
        {
          // The dated week — the only fetch on this page that waits for its tab.
          slug: 'week',
          labelKey: 'detailTabs.week',
          content: async () => {
            const calendar = await apiFetch<Calendar>(
              `/students/${id}/calendar?from=${monday}&to=${sunday}`,
            ).catch(() => null);
            return calendar === null ? (
              <PageError message={t('detailTabs.loadFailed')} />
            ) : (
              <StudentWeek
                studentId={id}
                initialWeek={monday}
                initialSessions={calendar.sessions}
                timetable={timetable}
                family={family}
              />
            );
          },
        },
        {
          /*
            What the club owes this family — POOLSE-21, criteria 2 and 5. Only
            when there is something to say: a club that has not turned
            reposições on mints nothing, and an empty tab on every record would
            be a permanent question with no answer. Oldest expiry first, as the
            server returns them.
          */
          slug: 'credits',
          labelKey: 'reposicao.credits',
          visible: credits.length > 0,
          badge: { kind: 'count', value: credits.length },
          content: () => (
            <section className="flex flex-col gap-3 rounded border border-border bg-surface p-5">
              <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
                {t('reposicao.credits')}
              </h2>

              <ul className="flex flex-col divide-y divide-border">
                {credits.map((credit) => (
                  <li
                    key={credit.id}
                    className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3 first:pt-0 last:pb-0"
                  >
                    <span className="flex flex-col">
                      <span>
                        {t('reposicao.missedOn', {
                          date: formatDate(credit.issuedOn),
                          turma: credit.className ?? t('classes.noTurma'),
                        })}
                      </span>
                      <span className="text-sm text-foreground-muted">
                        {t('reposicao.expiresOn', { date: formatDate(credit.expiresOn) })}
                      </span>
                    </span>

                    {/*
                      The state is a word, never a colour alone — it has to stay
                      visibly distinct from the attendance palette nearby.
                    */}
                    <span className="flex items-baseline gap-2">
                      {credit.daysLeft !== null && credit.daysLeft <= 14 && (
                        <span className="rounded bg-warning/15 px-2 py-0.5 text-sm text-warning">
                          {t('reposicao.daysLeft', { days: credit.daysLeft })}
                        </span>
                      )}
                      <span className="rounded bg-surface-muted px-2 py-0.5 text-sm text-foreground-muted">
                        {t(`reposicao.status.${credit.status}`)}
                      </span>
                    </span>

                    {/*
                      Booking sits on the credit: "when can we make this up?" is
                      only ever asked about a particular missed class —
                      POOLSE-21 criterion 3.
                    */}
                    <div className="w-full">
                      <CreditBooking
                        organizationId={reg.organizationId}
                        studentId={loaded.id}
                        credit={credit}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ),
        },
        {
          /*
            What the student said after their lessons — POOLSE-116. Staff only;
            an instructor's list holds the lessons they taught, decided by the
            API. Its own tab, paginated, because it grows with every lesson.
          */
          slug: 'feedback',
          labelKey: 'feedback.tab',
          visible: !family,
          content: async () => {
            const list = await apiFetch<Paginated<LessonFeedback>>(
              `/students/${id}/feedback?page=${readPage(page)}`,
            ).catch(() => null);
            if (list === null) return <PageError message={t('detailTabs.loadFailed')} />;
            return (
              <section className="flex flex-col gap-3 rounded border border-border bg-surface p-5">
                <h2 className="font-medium">{t('feedback.title')}</h2>
                {list.items.length === 0 ? (
                  <p className="text-sm text-foreground-muted">{t('feedback.noneForStudent')}</p>
                ) : (
                  <FeedbackList items={list.items} by="lesson" canArchive={reg.canManage} />
                )}
                <Pagination page={list} basePath={`/dashboard/students/${id}`} query={{ tab: 'feedback', from }} />
              </section>
            );
          },
        },
        {
          /*
            Who on this record uses the app — POOLSE-129. A family is invited
            here, never from Pessoas: the invitation names the guardian the
            club already has. Staff only; the API decides whether this reader
            may send (an instructor, for their own turmas).
          */
          slug: 'app',
          labelKey: 'detailTabs.appAccess',
          // Owner, admin and instructor — the readers the API answers; beside
          // Atividade, since only some roles see either (Rui, 30-10-2026).
          visible: !family && access !== null && access.state !== 'refused',
          content: () => {
            if (access === null || access.state !== 'ok') {
              if (access === null) return null;
              return access.state === 'failed' ? (
                <PageError
                  message={t(access.failure.key)}
                  {...(access.failure.detail === '' ? {} : { detail: access.failure.detail })}
                />
              ) : (
                <p className="text-sm text-foreground-muted">{t('familyAccess.readOnly')}</p>
              );
            }
            return (
              <FamilyAccess
                studentId={id}
                studentFirstName={loaded.firstName}
                organizationName={access.data.organizationName}
                canInvite={access.data.canInvite}
                invitees={access.data.invitees}
              />
            );
          },
        },
        {
          // POOLSE-80 — who changed what, and Reverter. Owner and Admin.
          slug: 'activity',
          labelKey: 'activity.tab',
          visible: reg.canManage,
          content: () => (
            <ActivityPanel
              kind="student"
              id={loaded.id}
              page={readPage(page)}
              basePath={`/dashboard/students/${loaded.id}`}
            />
          ),
        },
      ]}
    />
  );
}

function Row({ label, value }: { label: string; value: string | null }): React.ReactElement {
  return (
    // Stacked on a phone, where a long address beside its label squeezed the
    // label into one word a line (POOLSE-88); side by side from `sm`.
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
      <dt className="text-foreground-muted">{label}</dt>
      <dd className="min-w-0 break-words sm:text-right">{value ?? '—'}</dd>
    </div>
  );
}

/** The *Documentos* tab's sections — POOLSE-132. */
type DocumentsSection = 'identificacao' | 'fpn' | 'fpn-menores';

/** Which fee sections are offered, and which of them is open. */
function feesSections(
  hasSeasonCharges: boolean,
  requested: string | string[] | undefined,
): { offered: FeesSection[]; section: FeesSection } {
  const offered: FeesSection[] = hasSeasonCharges
    ? ['mensalidade', 'joining', 'socio']
    : ['mensalidade', 'socio'];
  return { offered, section: pickSection(offered, requested, 'mensalidade') };
}
