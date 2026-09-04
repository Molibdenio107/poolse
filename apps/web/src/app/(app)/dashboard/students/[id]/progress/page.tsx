import { getFormatter, getTranslations } from 'next-intl/server';
import { describeLoad, type LoadFailure } from '@/lib/load-failure';
import {
  ApiError,
  apiFetch,
  type Progression,
  type Stroke,
  type Student,
  type SwimRecord,
} from '@/lib/api';
import { formatTime, ProgressChart } from '@/components/progress-chart';
import { Hint } from '@/components/ui/tooltip';
import { AddRecordForm, ArchiveRecordButton, FavouriteStrokeForm } from './progress-forms';
import { BackLink } from '@/components/back-link';
import { PageError, PageShell } from '@/components/page-shell';

/**
 * Backlog story 6 — a student's performances over time.
 *
 * Its own page rather than a section on the student record, because it is a
 * different job: the record is set up once and edited rarely, while this is
 * opened after every trial with a stopwatch still in hand.
 */
export default async function ProgressPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const format = await getFormatter();
  const { id } = await params;

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
  // clock, which may be in another timezone or simply wrong.
  const today = new Date().toISOString().slice(0, 10);

  // The chart shows one line, so it has to be one comparable thing: the stroke
  // and distance this student has raced most. Mixing a 50 m butterfly into a
  // 400 m freestyle line would draw a shape that means nothing.
  const groups = new Map<string, SwimRecord[]>();
  for (const record of progression?.records ?? []) {
    const key = `${record.stroke}|${record.distanceM}`;
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }

  // Two points is the minimum that shows a direction; one is not a progression.
  let headline: { stroke: Stroke; distanceM: number; records: SwimRecord[] } | null = null;
  for (const [key, records] of groups) {
    if (records.length >= 2 && (headline === null || records.length > headline.records.length)) {
      const [stroke, distance] = key.split('|');
      headline = { stroke: stroke as Stroke, distanceM: Number(distance), records };
    }
  }

  return (
    <PageShell
      // The full legal name — a detail page, not a list (POOLSE-32 criterion 3).
      title={student === null ? t('progress.title') : student.displayName}
      subtitle={t('progress.title')}
    >

      <BackLink href={`/dashboard/students/${id}`} label={t('sensitive.backToStudent')} />

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

      {progression !== null && (
        <>
          {progression.records.length === 0 ? (
            <section className="flex flex-col gap-2 rounded border border-border bg-surface p-5">
              <p>{t('progress.none')}</p>
              <p className="text-sm text-foreground-muted">
                {progression.canRecord ? t('progress.noneHintCoach') : t('progress.noneHintMember')}
              </p>
            </section>
          ) : (
            <>
              <section className="flex flex-wrap gap-8 rounded border border-border bg-surface p-5">
                <div className="flex flex-col gap-1">
                  {/*
                    "Fastest", not "best". A genuine best stroke is a comparison
                    against reference times for a swimmer's age, which Poolse does
                    not hold — so the tooltip says what this number actually is
                    rather than letting the label imply more.
                  */}
                  <Hint text={t('progress.fastestHint')}>
                    <span className="cursor-help text-sm text-foreground-muted">
                      {t('progress.fastest')}
                    </span>
                  </Hint>
                  <span className="text-lg">
                    {progression.fastestStroke === null
                      ? '—'
                      : t(`progress.strokes.${progression.fastestStroke}`)}
                  </span>
                </div>

                <div className="flex flex-col gap-1">
                  <span className="text-sm text-foreground-muted">{t('progress.favourite')}</span>
                  <span className="text-lg">
                    {progression.favouriteStroke === null
                      ? t('progress.noFavourite')
                      : t(`progress.strokes.${progression.favouriteStroke}`)}
                  </span>
                </div>
              </section>

              {headline !== null && (
                <section className="flex flex-col gap-3 rounded border border-border bg-surface p-5">
                  <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
                    {t('progress.chartTitle', {
                      stroke: t(`progress.strokes.${headline.stroke}`),
                      distance: headline.distanceM,
                    })}
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

              <section className="rounded border border-border bg-surface p-5">
                <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-foreground-muted">
                  {t('progress.bests')}
                </h2>
                <ul className="flex flex-col divide-y divide-border">
                  {progression.bests.map((best) => (
                    <li
                      key={`${best.stroke}-${best.distanceM}`}
                      className="flex items-baseline justify-between gap-4 py-2 first:pt-0 last:pb-0"
                    >
                      <span>
                        {best.distanceM} m {t(`progress.strokes.${best.stroke}`)}
                      </span>
                      <span className="flex items-baseline gap-3">
                        <span className="font-mono text-lg">{formatTime(best.timeMs)}</span>
                        <span className="text-sm text-foreground-muted">
                          {format.dateTime(new Date(best.swumOn), { dateStyle: 'medium' })}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </section>

              <section className="rounded border border-border bg-surface p-5">
                <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-foreground-muted">
                  {t('progress.history')}
                </h2>
                <ul className="flex flex-col divide-y divide-border">
                  {progression.records.map((record) => (
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
                        </span>
                        <span className="text-sm text-foreground-muted">
                          {[
                            format.dateTime(new Date(record.swumOn), { dateStyle: 'long' }),
                            record.recordedByName,
                            record.note,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </div>
                      {progression.canRecord && (
                        <ArchiveRecordButton
                          organizationId={progression.organizationId}
                          studentId={id}
                          recordId={record.id}
                        />
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            </>
          )}

          {progression.canRecord && (
            <>
              <section className="rounded border border-border bg-surface p-5">
                <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-foreground-muted">
                  {t('progress.add')}
                </h2>
                <AddRecordForm
                  organizationId={progression.organizationId}
                  studentId={id}
                  strokes={progression.strokes}
                  today={today}
                />
              </section>

              <section className="rounded border border-border bg-surface p-5">
                <FavouriteStrokeForm
                  organizationId={progression.organizationId}
                  studentId={id}
                  strokes={progression.strokes}
                  current={progression.favouriteStroke}
                />
              </section>
            </>
          )}
        </>
      )}
    </PageShell>
  );
}
