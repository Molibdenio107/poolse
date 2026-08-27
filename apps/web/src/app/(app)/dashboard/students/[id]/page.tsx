import Link from 'next/link';
import { getLocale, getTranslations } from 'next-intl/server';
import {
  ApiError,
  apiFetch,
  type Calendar,
  type Student,
  type Students,
  type TimetableEntry,
} from '../../../../../lib/api';
import { WeekGrid, type WeekEntry } from '@/components/week-grid';
import { addDays, isDate, longDate, mondayOf, shortDate, today } from '@/lib/dates';
import { DocumentUpload } from '@/components/document-upload';
import { PersonAvatar } from '@/components/person-avatar';
import { PhotoUpload } from '@/components/photo-upload';
import { photoUrlFor } from '@/lib/photo';
import { StudentForm } from '../student-forms';
import { BackLink } from '@/components/back-link';
import { ActionButton } from '@/components/action-button';

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
  let register: Students | null = null;
  let failure: string | null = null;
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
    const [studentResult, registerResult, timetableResult, calendarResult] = await Promise.all([
      apiFetch<Student>(`/students/${id}`),
      apiFetch<Students>('/students'),
      apiFetch<{ entries: TimetableEntry[] }>(`/students/${id}/timetable`),
      apiFetch<Calendar>(`/students/${id}/calendar?from=${monday}&to=${sunday}`),
    ]);
    student = studentResult;
    register = registerResult;
    timetable = timetableResult.entries;
    calendar = calendarResult;
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) {
      missing = true;
    } else {
      failure = error instanceof ApiError ? `${error.status} ${error.message}` : String(error);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-16">
      <header className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          {student !== null && (
            <PersonAvatar
              id={student.id}
              name={`${student.firstName} ${student.lastName}`}
              photoUrl={photoUrlFor(student.photoStorageKey)}
              size="lg"
            />
          )}
          <div>
          <h1 className="text-3xl font-semibold tracking-tight">
            {student === null
              ? t('students.title')
              : `${student.firstName} ${student.lastName}`}
          </h1>
          <p className="text-foreground-muted">
            {student?.age === null || student === null
              ? t('students.subtitle')
              : t('students.years', { count: student.age })}
          </p>
          </div>
        </div>
      </header>

      <BackLink href="/dashboard/students" label={t('students.backToRegister')} />

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
        <section className="rounded border border-danger/40 bg-danger/10 p-5">
          <p className="font-medium text-danger">{t('account.unavailable')}</p>
          <p className="mt-1 font-mono text-sm text-foreground-muted">{failure}</p>
        </section>
      )}

      {student !== null && (
        <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
              {t('students.week')}
            </h2>
            <p className="text-sm text-foreground-muted">
              {t('calendar.range', {
                from: longDate(monday, locale),
                to: longDate(sunday, locale),
              })}
            </p>
          </div>

          {/*
            Real dates, not a recurring pattern. "When does João swim?" is
            answered by the week he is actually in — including the Tuesday the
            pool was shut, which a pattern has no way to express.
          */}
          <nav aria-label={t('calendar.weekNav')} className="flex flex-wrap items-center gap-2">
            <StudentWeekLink id={id} week={addDays(monday, -7)} label={t('calendar.previousWeek')} />
            <StudentWeekLink id={id} week={today()} label={t('calendar.thisWeek')} />
            <StudentWeekLink id={id} week={addDays(monday, 7)} label={t('calendar.nextWeek')} />
          </nav>

          <WeekGrid
            entries={(calendar?.sessions ?? []).map((session): WeekEntry => {
              const cancelled = session.status === 'cancelled';
              return {
                key: session.id,
                weekday: session.weekday,
                startTime: session.localTime,
                durationMinutes: session.durationMinutes,
                title: session.className,
                subtitle: [
                  session.poolName,
                  session.lane === null ? null : t('classes.laneN', { lane: session.lane }),
                  session.substituteName ?? session.instructorName,
                ]
                  .filter(Boolean)
                  .join(' · '),
                href: `/dashboard/classes/${session.classGroupId}`,
                cancelled,
                muted: cancelled,
                note: cancelled
                  ? session.cancellationReason ?? t('calendar.cancelledNoReason')
                  : null,
              };
            })}
            dayNames={Object.fromEntries(
              [0, 1, 2, 3, 4, 5, 6].map((offset) => [
                offset + 1,
                `${t(`week.${offset + 1}`)} · ${shortDate(addDays(monday, offset), locale)}`,
              ]),
            )}
            emptyLabel={t('students.noClassesThisWeek')}
          />

          {/*
            A student with a weekly pattern and no dated classes has not been
            left out of the timetable — the season simply has not been built.
            Saying which is which is the difference between a dead end and a
            next step, and the pattern below is shown so the week is not blank
            while somebody goes and presses the button.
          */}
          {(calendar?.sessions.length ?? 0) === 0 && timetable.length > 0 && (
            <div className="flex flex-col gap-3 rounded border border-dashed border-border p-4">
              <p className="text-sm text-foreground-muted">
                {t('students.noSessionsHint')}{' '}
                <Link href="/dashboard/calendar" className="text-primary hover:underline">
                  {t('calendar.title')}
                </Link>
              </p>
              <WeekGrid
                entries={timetable.map(
                  (entry, index): WeekEntry => ({
                    key: `${entry.classGroupId}-${entry.weekday}-${entry.startTime}-${index}`,
                    weekday: entry.weekday,
                    startTime: entry.startTime,
                    durationMinutes: entry.durationMinutes,
                    title: entry.className,
                    subtitle: [
                      entry.poolName,
                      entry.lane === null ? null : t('classes.laneN', { lane: entry.lane }),
                      entry.instructorName,
                    ]
                      .filter(Boolean)
                      .join(' · '),
                    href: `/dashboard/classes/${entry.classGroupId}`,
                    // A place on the waiting list is not a class to turn up to,
                    // so it is drawn as the provisional thing it is.
                    muted: entry.status === 'waiting',
                  }),
                )}
                dayNames={Object.fromEntries(
                  [1, 2, 3, 4, 5, 6, 7].map((day) => [day, t(`week.${day}`)]),
                )}
                emptyLabel={t('students.noClasses')}
              />
            </div>
          )}
        </section>
      )}

      {student !== null && register !== null && register.canManage && (
        <section className="flex flex-col gap-3 rounded border border-border bg-surface p-5">
          <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
            {t('students.photo')}
          </h2>
          {/*
            Two different reasons the control is off, and they are not
            interchangeable. Missing consent is something the operator can fix
            today; missing storage is something only we can. Saying which is
            which is the difference between a dead end and a next step.
          */}
          <PhotoUpload
            label={t('students.photoUpload')}
            reason={
              student.photoConsent ? t('students.photoNoStorage') : t('students.photoNoConsent')
            }
          />
        </section>
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

      {student !== null && register !== null && (
        <section className="rounded border border-border bg-surface p-5">
          {register.canManage ? (
            <StudentForm
              organizationId={register.organizationId}
              levels={register.levels}
              student={student}
              mode="edit"
              ageOfMajority={register.ageOfMajority}
            />
          ) : (
            <>
              <p className="mb-4 text-sm text-foreground-muted">{t('students.readOnly')}</p>
              <dl className="flex flex-col gap-3">
                <Row label={t('students.level')} value={student.levelName ?? t('students.noLevel')} />
                <Row label={t('students.birthDate')} value={student.birthDate} />
                <Row label={t('students.contactEmail')} value={student.contactEmail} />
                <Row label={t('students.contactPhone')} value={student.contactPhone} />
                <Row label={t('students.notes')} value={student.notes} />
              </dl>
            </>
          )}
        </section>
      )}
    </main>
  );
}

/** Same idea as the calendar's own stepper: every week gets its own URL. */
function StudentWeekLink({
  id,
  week,
  label,
}: {
  id: string;
  week: string;
  label: string;
}): React.ReactElement {
  return (
    <Link
      href={`/dashboard/students/${id}?week=${week}`}
      className="rounded border border-border px-3 py-1.5 text-sm transition-colors hover:border-primary/50 hover:text-primary"
    >
      {label}
    </Link>
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
