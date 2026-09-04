import Link from 'next/link';
import { describeLoad, type LoadFailure } from '@/lib/load-failure';
import { getLocale, getTranslations } from 'next-intl/server';
import {
  ApiError,
  apiFetch,
  type Calendar,
  type Student,
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
import { FeesBlock } from './fees-block';
import { loadFees } from './fees.actions';
import { ActionButton } from '@/components/action-button';
import { PageError, PageShell } from '@/components/page-shell';

/**
 * One student's record.
 *
 * Its own page rather than an inline row expansion: the register is a list an
 * operator scans, and editing is a different job done with attention. It also
 * gives every student a URL, which the class-group and attendance screens will
 * want to link to from slice 1.4 onward.
 */
export default async function StudentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ week?: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const locale = await getLocale();
  const { id } = await params;
  const { week } = await searchParams;

  const monday = mondayOf(isDate(week) ? week : today());
  const sunday = addDays(monday, 6);

  let student: Student | null = null;
  let credits: ReposicaoCredit[] = [];
  let register: Students | null = null;
  let failure: LoadFailure | null = null;
  let missing = false;

  let timetable: TimetableEntry[] = [];
  let calendar: Calendar | null = null;

  try {
    // The register comes along for the level list and the write permission —
    // both belong to the organization rather than to this student.
    //
    // Both the dated week and the recurring pattern are fetched, because the
    // page needs to tell two empty weeks apart: "no classes this week" and "the
    // season has not been built yet" look identical from the calendar alone, and
    // only one of them is something to act on.
    const [studentResult, registerResult, timetableResult, calendarResult, creditsResult] =
      await Promise.all([
        apiFetch<Student>(`/students/${id}`),
        // One row is enough: this only needs the levels, the permissions and the
        // maioridade off the register response, not a page of other students.
        apiFetch<Students>('/students?limit=1'),
        apiFetch<{ entries: TimetableEntry[] }>(`/students/${id}/timetable`),
        apiFetch<Calendar>(`/students/${id}/calendar?from=${monday}&to=${sunday}`),
        apiFetch<{ credits: ReposicaoCredit[] }>(`/students/${id}/credits`),
      ]);
    student = studentResult;
    register = registerResult;
    timetable = timetableResult.entries;
    calendar = calendarResult;
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
  const facilities =
    student === null
      ? []
      : await apiFetch<{ facilities: { id: string; name: string }[] }>('/facilities')
          .then((response) => response.facilities.map((f) => ({ id: f.id, name: f.name })))
          .catch(() => []);

  const billing = student === null ? null : await loadFees(id, facilities.map((f) => f.id));

  return (
    <PageShell
      // A detail page shows the full legal name, every part — POOLSE-32
      // criterion 3. Abbreviation is for lists.
      title={student === null ? t('students.title') : student.displayName}
      subtitle={student?.age === null || student === null
              ? t('students.subtitle')
              : t('students.years', { count: student.age })}
      back={{ href: "/dashboard/students", label: t('students.backToRegister') }}
      actions={student !== null && (
            <PersonAvatar
              id={student.id}
              name={student.displayName}
              photoUrl={photoUrlFor(student.photoStorageKey)}
              size="lg"
            />
          )}
    >


      {/*
        The record's action area — backlog round 3, story 9.
        
        Separate from the back link, which is navigation rather than an action,
        and rendered only once the student has loaded: two buttons offering to
        open the record of somebody who is not there would be a worse answer than
        nothing.

        Both remain their own screen rather than a section here, and the hint
        beside them says why: opening the medical record is written to the audit
        log. Special-category data about a child should be reached deliberately,
        not scrolled past while doing something else — which is exactly why
        making it easier to find raises the stakes on the logging rather than
        lowering them.
      */}
      {student !== null && (student.canViewProgress !== false || student.canViewSensitive !== false) && (
        <div className="flex flex-wrap items-center gap-3">
          {student.canViewProgress !== false && (
            <ActionButton
              href={`/dashboard/students/${id}/progress`}
              icon="progress"
              label={t('progress.open')}
            />
          )}
          {student.canViewSensitive !== false && (
            <>
              <ActionButton
                href={`/dashboard/students/${id}/sensitive`}
                icon="medical"
                tone="sensitive"
                label={t('sensitive.open')}
              />
              <span className="text-sm text-foreground-muted">{t('sensitive.openHint')}</span>
            </>
          )}
        </div>
      )}

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

      {student !== null && register !== null && (
        /*
          First on the page, since round 4.
 
          Who this student is — the name, the level, the birth date — was at the
          bottom, under the week, the register, the guardians and the uploads. It
          is the reason somebody opens this screen and the thing they most often
          came to correct, so it now leads. Everything below it is context about
          a person you have already identified.
 
          The photograph sits inside this block rather than in a section of its
          own: an ID photo belongs beside the name it identifies, and at 7rem
          square it is furniture next to the form instead of a panel competing
          with it.
        */
        <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
          {register.canManage ? (
            <div className="flex flex-wrap items-start gap-5">
              <PhotoUpload
                variant="id"
                label={t('students.photoUpload')}
                reason={
                  student.photoConsent
                    ? t('students.photoNoStorage')
                    : t('students.photoNoConsent')
                }
              />
              <div className="min-w-0 flex-1">
            <StudentForm
              organizationId={register.organizationId}
              levels={register.levels}
              student={student}
              mode="edit"
              ageOfMajority={register.ageOfMajority}
            />
              </div>
            </div>
          ) : (
            <>
              <p className="mb-4 text-sm text-foreground-muted">{t('students.readOnly')}</p>
              <dl className="flex flex-col gap-3">
                <Row label={t('students.level')} value={student.levelName ?? t('students.noLevel')} />
                <Row label={t('students.birthDate')} value={student.birthDate} />
                <Row
                  label={t('students.gender')}
                  value={
                    student.gender === null
                      ? null
                      : student.gender === 'male'
                        ? t('students.genderMale')
                        : t('students.genderFemale')
                  }
                />
                <Row label={t('students.contactEmail')} value={student.contactEmail} />
                <Row label={t('students.contactPhone')} value={student.contactPhone} />
                <Row label={t('students.taxNumber')} value={student.taxNumber} />
                <Row label={t('students.notes')} value={student.notes} />
              </dl>
            </>
          )}
        </section>
      )}

      {student !== null && billing !== null && (
        <FeesBlock studentId={student.id} fees={billing.fees} periods={billing.periods} />
      )}

      {student !== null && register?.canManage === true && (
        <section className="flex flex-col gap-3 rounded border border-border bg-surface p-5">
          <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
            {t('students.document')}
          </h2>
          {/*
            Its own slot beside the photograph, never mixed with it — POOLSE-11.
            A Cartão de Cidadão rendered as an avatar would put a government
            identity document on every list that shows a face.
          */}
          <DocumentUpload
            label={t('students.documentUpload')}
            reason={t('students.documentNoStorage')}
            purpose={t('students.documentPurpose')}
          />
        </section>
      )}

      {/*
        Which turmas this student is in — round 4 follow-up.

        Above the week on purpose. The week answers "when does she swim"; this
        answers "what is she enrolled in", and the second question is the one
        somebody opening a student record is usually holding. It is also the
        thing that explains an empty week: a student in no turma has nothing to
        show, and a student in two whose week is blank means the season has not
        been generated.

        Read from the recurring pattern rather than from the dated week, so it
        does not empty out when you page to a week the club was closed.
      */}
      {student !== null && timetable.length > 0 && (
        <section className="flex flex-col gap-3 rounded border border-border bg-surface p-5">
          <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
            {t('students.turmas')}
          </h2>

          <ul className="flex flex-col divide-y divide-border">
            {/*
              One row per turma, not per slot: a turma that meets on Tuesday and
              Thursday is one enrolment, and listing it twice would read as two.
            */}
            {[...new Map(timetable.map((entry) => [entry.classGroupId, entry])).values()].map(
              (entry) => (
                <li
                  key={entry.classGroupId}
                  className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2 first:pt-0 last:pb-0"
                >
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <Link
                      href={`/dashboard/classes/${entry.classGroupId}`}
                      className="rounded font-medium text-primary underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    >
                      {entry.className}
                    </Link>
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
              ),
            )}
          </ul>
        </section>
      )}

      {student !== null && (
        <StudentWeek
          studentId={id}
          initialWeek={monday}
          initialSessions={calendar?.sessions ?? []}
          timetable={timetable}
        />
      )}


      {/*
        What the club owes this family — POOLSE-21, criteria 2 and 5.

        Rendered only when there is something to say. A club that has not turned
        reposições on mints nothing, and an empty panel headed "Reposições" on
        every student record would be a permanent question with no answer.

        Oldest expiry first, as the server returns them: the perishable credits
        are the ones somebody should spend.
      */}
      {student !== null && credits.length > 0 && (
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
                      date: credit.issuedOn,
                      turma: credit.className ?? t('classes.noTurma'),
                    })}
                  </span>
                  <span className="text-sm text-foreground-muted">
                    {t('reposicao.expiresOn', { date: credit.expiresOn })}
                  </span>
                </span>

                {/*
                  The state is a word, never a colour alone — the convention, and
                  it matters more here because these four states have to stay
                  visibly distinct from the attendance palette they sit near.
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
                  Booking sits on the credit rather than on a screen of its own:
                  the question "when can we make this up?" only ever gets asked
                  about a particular missed class — POOLSE-21 criterion 3.
                */}
                {register !== null && (
                  <div className="w-full">
                    <CreditBooking
                      organizationId={register.organizationId}
                      studentId={student.id}
                      credit={credit}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

    </PageShell>
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
