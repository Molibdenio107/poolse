import { getFormatter, getTranslations } from 'next-intl/server';
import { Medal, Plug } from 'lucide-react';
import { formatSwimTime } from '@poolse/rules';
import { apiFetch, type FamilyProgress, type Progression } from '@/lib/api';
import { formatDate } from '@/lib/date-format';
import { outcome } from '@/lib/load-failure';
import { PageError } from '@/components/page-shell';
import { ChildFilter } from '../child-filter';
import { AddTime, RemoveTime } from './progress-forms';

/** Coming after go-live: named here so a family knows, and nothing behind them yet. */
const INTEGRATIONS = ['Apple Health', 'Garmin', 'Fitbit'];

/**
 * *Progressos* — the triangle tab (Rui, 06-11-2026). The distance swum, added up
 * from every time on the record and never typed; each child's best times; the
 * times the family typed, which are marked and never official. Who may add is
 * `family_may_answer()`, which the API decides.
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

  return (
    <>
      <h1>{t('app.tabs.familia.progressos')}</h1>
      <ChildFilter base="/app/familia/progressos" children={everyone} chosen={child} />

      {rows.map((one) => {
        const progress = one.times.state === 'ok' ? one.times.data : null;
        const bests = progress?.bests ?? [];
        const typed = (progress?.records ?? []).filter((record) => record.selfReported);
        const entered = one.entered.state === 'ok' ? one.entered.data : null;
        return (
          <section key={one.id} className="flex flex-col gap-3">
            {several && <h2 className="font-bold">{one.name}</h2>}

            <div className="flex items-baseline justify-between gap-3 rounded bg-surface p-4 shadow-card">
              <span className="text-sm font-bold">{t('app.records.totalDistance')}</span>
              <span className="text-xl font-semibold tabular-nums">
                {t('app.records.metres', { value: format.number(progress?.totalDistanceM ?? 0) })}
              </span>
            </div>

            {entered?.canEnterTimes === true && (
              <AddTime studentId={one.id} strokes={progress?.strokes ?? []} pools={entered.pools} />
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

            {typed.length > 0 && (
              <div className="flex flex-col gap-1 rounded bg-surface p-4 shadow-card">
                <h3 className="text-sm font-bold">{t('app.records.entered')}</h3>
                <ul className="flex flex-col divide-y divide-border">
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
                        {entered?.canEnterTimes === true && (
                          <RemoveTime studentId={one.id} entry={record.id} name={line} />
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

      <section className="flex flex-col gap-1 rounded bg-surface p-4 shadow-card">
        <h2 className="flex items-center gap-2 text-sm font-bold">
          <Plug className="size-4" aria-hidden />
          {t('app.records.integrations')}
        </h2>
        <ul className="flex flex-col divide-y divide-border">
          {INTEGRATIONS.map((name) => (
            <li key={name} className="flex items-center justify-between gap-3 py-2">
              <span>{name}</span>
              <span className="text-sm text-foreground-muted">{t('app.records.soon')}</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
