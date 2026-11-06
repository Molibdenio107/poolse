import { getFormatter, getTranslations } from 'next-intl/server';
import { Medal } from 'lucide-react';
import { formatSwimTime } from '@poolse/rules';
import { apiFetch, type FamilyProgress, type Progression } from '@/lib/api';
import { formatDate } from '@/lib/date-format';
import { outcome } from '@/lib/load-failure';
import { PageError } from '@/components/page-shell';
import { ChildFilter } from '../child-filter';
import { AddMeasure, AddTime, RemoveEntry } from './progress-forms';

/**
 * *Progressos* — the triangle tab (Rui, 06-11-2026). Each child's best times, then
 * what the family recorded: a time it typed, weight, height, distance swum. A typed
 * time is marked and is never official. Who may add is `family_may_answer()`, which
 * the API decides. Health integrations come here after go-live.
 */
export default async function FamilyProgressPage({
  searchParams,
}: {
  searchParams: Promise<{ child?: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const format = await getFormatter();
  const { child } = await searchParams;

  const family = await outcome(apiFetch<{ students: { id: string; name: string }[] }>('/family'));
  if (family.state !== 'ok') return <PageError message={t('app.records.failed')} />;
  const everyone = family.data.students;
  const shown = child === undefined ? everyone : everyone.filter((one) => one.id === child);
  const several = shown.length > 1;

  const rows = await Promise.all(
    shown.map(async (one) => ({
      ...one,
      times: await outcome(apiFetch<Progression>(`/students/${one.id}/progression`)),
      entered: await outcome(apiFetch<FamilyProgress>(`/app/progress/${one.id}`)),
    })),
  );

  const measureText = (kind: string, value: number, unit: string): string =>
    t('app.records.measureLine', {
      kind: t(`app.records.kind.${kind}`),
      value: format.number(value, { maximumFractionDigits: 2 }),
      unit,
    });

  return (
    <>
      <h1>{t('app.tabs.familia.progressos')}</h1>
      <ChildFilter base="/app/familia/progressos" children={everyone} chosen={child} />

      {rows.map((one) => {
        const progress = one.times.state === 'ok' ? one.times.data : null;
        const bests = progress?.bests ?? [];
        const typed = (progress?.records ?? []).filter((record) => record.selfReported);
        const entered = one.entered.state === 'ok' ? one.entered.data : null;
        const measures = entered?.measures ?? [];
        return (
          <section key={one.id} className="flex flex-col gap-3">
            {several && <h2 className="font-bold">{one.name}</h2>}

            {entered?.canEnter === true && (
              <div className="flex gap-2">
                {entered.canEnterTimes && <AddTime studentId={one.id} strokes={progress?.strokes ?? []} />}
                <AddMeasure studentId={one.id} />
              </div>
            )}

            <div className="flex flex-col gap-1 rounded bg-surface p-4 shadow-card">
              <h3 className="text-sm font-bold">{t('app.records.bests')}</h3>
              {bests.length === 0 ? (
                <p className="flex items-center gap-2 text-foreground-muted">
                  <Medal className="size-4" aria-hidden />
                  {t('app.records.none')}
                </p>
              ) : (
                <ul className="flex flex-col divide-y divide-border">
                  {bests.map((best) => (
                    <li
                      key={`${best.stroke}-${best.distanceM}-${best.course ?? 'none'}`}
                      className="flex items-baseline justify-between gap-3 py-2"
                    >
                      <span className="flex min-w-0 flex-col">
                        <span className="font-medium">
                          {t('app.records.event', { distance: best.distanceM, stroke: t(`progress.strokes.${best.stroke}`) })}
                        </span>
                        <span className="text-sm text-foreground-muted">
                          {best.selfReported
                            ? t('app.records.typedOn', { date: formatDate(best.swumOn) })
                            : formatDate(best.swumOn)}
                        </span>
                      </span>
                      <span className="shrink-0 font-semibold tabular-nums">{formatSwimTime(best.timeMs)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {(typed.length > 0 || measures.length > 0) && (
              <div className="flex flex-col gap-1 rounded bg-surface p-4 shadow-card">
                <h3 className="text-sm font-bold">{t('app.records.entered')}</h3>
                <ul className="flex flex-col divide-y divide-border">
                  {measures.map((measure) => {
                    const line = measureText(measure.kind, measure.value, measure.unit);
                    return (
                      <li key={measure.id} className="flex items-center justify-between gap-3 py-1">
                        <span className="flex min-w-0 flex-col">
                          <span className="font-medium">{line}</span>
                          <span className="text-sm text-foreground-muted">{formatDate(measure.measuredOn)}</span>
                        </span>
                        {measure.mine && entered?.canEnter === true && (
                          <RemoveEntry studentId={one.id} entry={measure.id} what="measures" name={line} />
                        )}
                      </li>
                    );
                  })}
                  {typed.map((record) => {
                    const line = t('app.records.event', {
                      distance: record.distanceM,
                      stroke: t(`progress.strokes.${record.stroke}`),
                    });
                    return (
                      <li key={record.id} className="flex items-center justify-between gap-3 py-1">
                        <span className="flex min-w-0 flex-col">
                          <span className="font-medium">
                            {line} · {formatSwimTime(record.timeMs)}
                          </span>
                          <span className="text-sm text-foreground-muted">{formatDate(record.swumOn)}</span>
                        </span>
                        {entered?.canEnter === true && (
                          <RemoveEntry studentId={one.id} entry={record.id} what="times" name={line} />
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </section>
        );
      })}
    </>
  );
}
