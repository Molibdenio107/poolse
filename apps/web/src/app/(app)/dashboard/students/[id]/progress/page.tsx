import { getTranslations } from 'next-intl/server';
import { describeLoad, type LoadFailure } from '@/lib/load-failure';
import {
  ApiError,
  apiFetch,
  type Course,
  type PersonalBest,
  type Progression,
  type Stroke,
  type Student,
  type SwimRecord,
} from '@/lib/api';
import { formatTime, ProgressChart } from '@/components/progress-chart';
import { Hint } from '@/components/ui/tooltip';
import { AddRecordForm, ArchiveRecordButton, FavouriteStrokeForm } from './progress-forms';
import { DetailPage } from '@/components/detail-page';
import { GapTable } from '@/components/gap-table';
import { PageError, PageShell } from '@/components/page-shell';
import { formatDate } from '@/lib/date-format';
import { today as todayOfClub } from '@/lib/dates';

/**
 * Backlog story 6 — a student's performances over time.
 *
 * Its own page rather than a section on the student record, because it is a
 * different job: the record is set up once and edited rarely, while this is
 * opened after every trial with a stopwatch still in hand.
 *
 * **Tabs since the detail-tabs change**: General (fastest, favourite and the
 * chart), Recordes, Histórico and Registar — the last for whoever may record.
 */
export default async function ProgressPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string | string[] }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const { id } = await params;
  const { tab } = await searchParams;

  let student: Student | null = null;
  let progression: Progression | null = null;
  let failure: LoadFailure | null = null;
  let missing = false;

  try {
    [student, progression] = await Promise.all([
      apiFetch<Student>(`/students/${id}`),
      apiFetch<Progression>(`/students/${id}/progression`),
    ]);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 403)) {
      missing = true;
    } else {
      failure = describeLoad(error);
    }
  }

  // Resolved on the server so the default date does not depend on the visitor's
  // clock, which may be in another timezone or simply wrong — and in the club's
  // zone, because `toISOString()` is the UTC day and was yesterday until 01:00
  // every Lisbon summer night. `sv-SE` only because it writes `YYYY-MM-DD`.
  const today = todayOfClub();

  // The chart shows one line, so it has to be one comparable thing: the stroke,
  // distance and pool this student has raced most. Mixing a 50 m butterfly into
  // a 400 m freestyle line would draw a shape that means nothing, and so would
  // mixing a 25 m pool into a 50 m one (POOLSE-81).
  const groups = new Map<string, SwimRecord[]>();
  for (const record of progression?.records ?? []) {
    const key = `${record.stroke}|${record.distanceM}|${record.course ?? ''}`;
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }

  // Two points is the minimum that shows a direction; one is not a progression.
  let headline: {
    stroke: Stroke;
    distanceM: number;
    course: Course | null;
    records: SwimRecord[];
  } | null = null;
  for (const [key, records] of groups) {
    if (records.length >= 2 && (headline === null || records.length > headline.records.length)) {
      const [stroke, distance, course] = key.split('|');
      headline = {
        stroke: stroke as Stroke,
        distanceM: Number(distance),
        course: course === '' ? null : (course as Course),
        records,
      };
    }
  }

  // The bests, one table per pool — a 25 m and a 50 m best are two figures,
  // never one (POOLSE-81). The API already orders them 25, 50, then unsaid.
  const bestsByCourse: { course: Course | null; bests: PersonalBest[] }[] = [];
  for (const best of progression?.bests ?? []) {
    const group = bestsByCourse.find((entry) => entry.course === best.course);
    if (group === undefined) bestsByCourse.push({ course: best.course, bests: [best] });
    else group.bests.push(best);
  }
  const courseRank = (course: Course | null): number =>
    course === 'scm' ? 0 : course === 'lcm' ? 1 : 2;
  bestsByCourse.sort((a, b) => courseRank(a.course) - courseRank(b.course));

  const back = { href: `/dashboard/students/${id}`, label: t('sensitive.backToStudent') };

  if (progression === null) {
    return (
      <PageShell title={t('progress.title')} back={back}>
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

  const loaded = progression;
  const hasRecords = loaded.records.length > 0;

  return (
    <DetailPage
      // The full legal name — a detail page, not a list (POOLSE-32 criterion 3).
      title={student === null ? t('progress.title') : student.displayName}
      subtitle={t('progress.title')}
      back={back}
      requested={tab}
      tabs={[
        {
          slug: 'general',
          labelKey: 'detailTabs.general',
          content: () =>
            !hasRecords ? (
              <section className="flex flex-col gap-2 rounded border border-border bg-surface p-5">
                <p>{t('progress.none')}</p>
                <p className="text-sm text-foreground-muted">
                  {loaded.canRecord ? t('progress.noneHintCoach') : t('progress.noneHintMember')}
                </p>
              </section>
            ) : (
              <>
                <section className="flex flex-wrap gap-8 rounded border border-border bg-surface p-5">
                  <div className="flex flex-col gap-1">
                    {/*
                      "Fastest", not "best". A genuine best stroke is a comparison
                      against reference times for a swimmer's age, which Poolse
                      does not hold — so the tooltip says what this number
                      actually is rather than letting the label imply more.
                    */}
                    <Hint text={t('progress.fastestHint')}>
                      <span
                        tabIndex={0}
                        className="cursor-help rounded text-sm text-foreground-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                      >
                        {t('progress.fastest')}
                      </span>
                    </Hint>
                    <span className="text-lg">
                      {loaded.fastestStroke === null
                        ? '—'
                        : t(`progress.strokes.${loaded.fastestStroke}`)}
                    </span>
                  </div>

                  <div className="flex flex-col gap-1">
                    <span className="text-sm text-foreground-muted">{t('progress.favourite')}</span>
                    <span className="text-lg">
                      {loaded.favouriteStroke === null
                        ? t('progress.noFavourite')
                        : t(`progress.strokes.${loaded.favouriteStroke}`)}
                    </span>
                  </div>
                </section>

                {headline !== null && (
                  <section className="flex flex-col gap-3 rounded border border-border bg-surface p-5">
                    <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
                      {t('progress.chartTitle', {
                        stroke: t(`progress.strokes.${headline.stroke}`),
                        distance: headline.distanceM,
                      })}{' '}
                      · {t(`progress.course.${headline.course ?? 'none'}`)}
                    </h2>
                    <ProgressChart
                      label={t('progress.chartLabel')}
                      points={[...headline.records]
                        .reverse()
                        .map((record) => ({ date: record.swumOn, timeMs: record.timeMs }))}
                    />
                    <p className="text-sm text-foreground-muted">{t('progress.chartHint')}</p>
                  </section>
                )}
              </>
            ),
        },
        {
          slug: 'bests',
          labelKey: 'progress.bests',
          visible: hasRecords,
          content: () => (
            <>
              {bestsByCourse.map((group) => (
                <section
                  key={group.course ?? 'none'}
                  className="rounded border border-border bg-surface p-5"
                >
                  <h2 className="mb-1 text-sm font-medium uppercase tracking-wider text-foreground-muted">
                    {t('progress.bestsIn', { course: t(`progress.course.${group.course ?? 'none'}`) })}
                  </h2>
                  {group.course === null && (
                    <p className="mb-3 text-sm text-foreground-muted">{t('progress.courseNoneHint')}</p>
                  )}
                  <ul className="flex flex-col divide-y divide-border">
                    {group.bests.map((best) => (
                      <li
                        key={`${best.stroke}-${best.distanceM}`}
                        className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2 first:pt-0 last:pb-0"
                      >
                        <span>
                          {best.distanceM} m {t(`progress.strokes.${best.stroke}`)}
                        </span>
                        <span className="flex flex-col items-end gap-0.5">
                          <span className="flex items-baseline gap-3">
                            <span className="font-mono text-lg">{formatTime(best.timeMs)}</span>
                            {best.official && (
                              <span className="rounded border border-primary/40 px-2 text-sm text-primary">
                                {t('progress.official')}
                              </span>
                            )}
                            <span className="text-sm text-foreground-muted">
                              {formatDate(best.swumOn)}
                            </span>
                          </span>
                          {/* The best at an official meet, where it differs — what qualifying reads. */}
                          {best.officialBest !== null && (
                            <span className="text-sm text-foreground-muted">
                              {t('progress.officialBest', {
                                time: formatTime(best.officialBest.timeMs),
                                meet: best.officialBest.meetName,
                                date: formatDate(best.officialBest.swumOn),
                              })}
                            </span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </>
          ),
        },
        {
          // POOLSE-85: the gap to this season's standards. Absent, not empty,
          // when the club has none — most swim-school students never see one.
          slug: 'qualifying',
          labelKey: 'qualifying.tab.student',
          visible: loaded.qualifying !== null,
          content: () => {
            const q = loaded.qualifying;
            if (q === null) return null;
            return (
              <>
                <section className="flex flex-col gap-1 rounded border border-border bg-surface p-5">
                  <p>
                    {q.ageGroups.length > 0
                      ? t('qualifying.studentBand', { season: q.seasonName, groups: q.ageGroups.join(', ') })
                      : t(
                          q.noBand === 'birthDate'
                            ? 'qualifying.studentNoBirthDate'
                            : q.noBand === 'gender'
                              ? 'qualifying.studentNoGender'
                              : 'qualifying.studentNoBand',
                          {
                          season: q.seasonName,
                        })}
                  </p>
                  <p className="text-sm text-foreground-muted">{t('qualifying.studentExplain')}</p>
                </section>
                {q.ageGroups.length > 0 && q.standards.length === 0 && (
                  <section className="rounded border border-border bg-surface p-5">
                    <p>{t('qualifying.studentNoTimes')}</p>
                  </section>
                )}
                {q.standards.map((standard) => (
                  <section key={standard.id} className="flex flex-col gap-3 rounded border border-border bg-surface p-5">
                    <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
                      {standard.name}
                    </h2>
                    <GapTable rows={standard.rows} />
                  </section>
                ))}
              </>
            );
          },
        },
        {
          slug: 'history',
          labelKey: 'progress.history',
          visible: hasRecords,
          badge: { kind: 'count', value: loaded.records.length },
          content: () => (
            <section className="rounded border border-border bg-surface p-5">
              <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-foreground-muted">
                {t('progress.history')}
              </h2>
              <ul className="flex flex-col divide-y divide-border">
                {loaded.records.map((record) => (
                  <li
                    key={record.id}
                    className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3 first:pt-0 last:pb-0"
                  >
                    <div className="flex min-w-0 flex-col">
                      <span>
                        {record.distanceM} m {t(`progress.strokes.${record.stroke}`)}{' '}
                        <span className="font-mono">{formatTime(record.timeMs)}</span>
                        {record.isPersonalBest && (
                          <span className="ml-2 rounded bg-success/15 px-2 py-0.5 text-sm text-success">
                            {t('progress.personalBest')}
                          </span>
                        )}
                        {record.official && (
                          <span className="ml-2 rounded border border-primary/40 px-2 text-sm text-primary">
                            {t('progress.official')}
                          </span>
                        )}
                      </span>
                      <span className="text-sm text-foreground-muted">
                        {[
                          formatDate(record.swumOn),
                          t(`progress.course.${record.course ?? 'none'}`),
                          record.meetName,
                          record.recordedByName,
                          record.note,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </div>
                    {/*
                      `canArchive`, not `canRecord` — round 5, G1. An instructor
                      still records, and only owner and admin remove. Hiding it
                      is the courtesy; the endpoint refuses it either way.
                    */}
                    {loaded.canArchive && (
                      <ArchiveRecordButton
                        organizationId={loaded.organizationId}
                        studentId={id}
                        recordId={record.id}
                      />
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ),
        },
        {
          slug: 'record',
          labelKey: 'progress.add',
          visible: loaded.canRecord,
          content: () => (
            <>
              <section className="rounded border border-border bg-surface p-5">
                <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-foreground-muted">
                  {t('progress.add')}
                </h2>
                <AddRecordForm
                  organizationId={loaded.organizationId}
                  studentId={id}
                  strokes={loaded.strokes}
                  courses={loaded.courses}
                  defaultCourse={loaded.defaultCourse}
                  meets={loaded.meets}
                  today={today}
                />
              </section>

              <section className="rounded border border-border bg-surface p-5">
                <FavouriteStrokeForm
                  organizationId={loaded.organizationId}
                  studentId={id}
                  strokes={loaded.strokes}
                  current={loaded.favouriteStroke}
                />
              </section>
            </>
          ),
        },
      ]}
    />
  );
}
