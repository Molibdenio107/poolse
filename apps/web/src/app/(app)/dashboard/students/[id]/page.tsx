import Link from 'next/link';
import { describeLoad, outcome, type LoadFailure, type Outcome } from '@/lib/load-failure';
import { getLocale, getTranslations } from 'next-intl/server';
import {
  ApiError,
  apiFetch,
  type Calendar,
  type Student,
  type StudentFees,
  type Students,
  type TimetableEntry,
  type ReposicaoCredit,
} from '../../../../../lib/api';
import { addDays, isDate, mondayOf, today } from '@/lib/dates';
import { DocumentUpload } from '@/components/document-upload';
import { PersonAvatar } from '@/components/person-avatar';
import { PhotoUpload } from '@/components/photo-upload';
import { photoUrlFor } from '@/lib/photo';
import { StudentForm } from '../student-forms';
import { CreditBooking } from './credit-booking';
import { StudentWeek } from './student-week';
import { FeesBlock, type FeesSection } from './fees-block';
import { FamilyFees } from './family-fees';
import { pickSection } from '@/components/section-pills';
import { loadFees } from './fees.actions';
import { ActionButton } from '@/components/action-button';
import { PageError, PageShell } from '@/components/page-shell';
import { DetailPage } from '@/components/detail-page';
import { formatDate } from '@/lib/date-format';

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
  searchParams: Promise<{ week?: string; tab?: string | string[]; section?: string | string[] }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const locale = await getLocale();
  const { id } = await params;
  const { week, tab, section } = await searchParams;

  const monday = mondayOf(isDate(week) ? week : today());
  const sunday = addDays(monday, 6);

  let student: Student | null = null;
  let credits: ReposicaoCredit[] = [];
  let register: Students | null = null;
  let failure: LoadFailure | null = null;
  let missing = false;

  let timetable: TimetableEntry[] = [];

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
        outcome(apiFetch<Students>('/students?limit=1')),
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

  // A detail page shows the full legal name, every part — POOLSE-32
  // criterion 3. Abbreviation is for lists.
  const subtitle =
    student?.age === null || student === null
      ? t('students.subtitle')
      : t('students.years', { count: student.age });
  const back = family
    ? { href: '/dashboard/family', label: t('family.back') }
    : { href: '/dashboard/students', label: t('students.backToRegister') };

  if (student === null || (register === null && !family)) {
    return (
      <PageShell title={t('students.title')} subtitle={subtitle} back={back}>
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

  return (
    <DetailPage
      title={loaded.displayName}
      subtitle={subtitle}
      back={back}
      actions={
        <PersonAvatar
          id={loaded.id}
          name={loaded.displayName}
          photoUrl={photoUrlFor(loaded.photoStorageKey)}
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
                Who this student is — the name, the level, the birth date. It is
                the reason somebody opens this screen and the thing they most
                often came to correct, so it leads.

                The photograph sits inside this block rather than in a section of
                its own: an ID photo belongs beside the name it identifies.
              */}
              <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
                {reg.canManage ? (
                  <div className="flex flex-wrap items-start gap-5">
                    <PhotoUpload
                      variant="id"
                      label={t('students.photoUpload')}
                      reason={
                        loaded.photoConsent
                          ? t('students.photoNoStorage')
                          : t('students.photoNoConsent')
                      }
                    />
                    <div className="min-w-0 flex-1">
                      <StudentForm
                        organizationId={reg.organizationId}
                        levels={reg.levels}
                        student={loaded}
                        mode="edit"
                        ageOfMajority={reg.ageOfMajority}
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
                </>
              )
            ),
        },
        {
          slug: 'document',
          labelKey: 'students.document',
          visible: reg.canManage,
          content: () => (
            <section className="flex flex-col gap-3 rounded border border-border bg-surface p-5">
              <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
                {t('students.document')}
              </h2>
              {/*
                Its own slot beside the photograph, never mixed with it —
                POOLSE-11. A Cartão de Cidadão rendered as an avatar would put a
                government identity document on every list that shows a face.
              */}
              <DocumentUpload
                label={t('students.documentUpload')}
                reason={t('students.documentNoStorage')}
                purpose={t('students.documentPurpose')}
              />
            </section>
          ),
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
                        <Link
                          href={`/dashboard/classes/${entry.classGroupId}`}
                          className="rounded font-medium text-primary underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                        >
                          {entry.className}
                        </Link>
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
      ]}
    />
  );
}

function Row({ label, value }: { label: string; value: string | null }): React.ReactElement {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-foreground-muted">{label}</dt>
      <dd className="text-right">{value ?? '—'}</dd>
    </div>
  );
}

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
