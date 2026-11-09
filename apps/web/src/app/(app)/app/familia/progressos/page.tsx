import { getFormatter, getTranslations } from 'next-intl/server';
import { ChevronDown, Medal } from 'lucide-react';
import { formatSwimTime } from '@poolse/rules';
import { apiFetch, type FamilyProgress } from '@/lib/api';
import { formatDate } from '@/lib/date-format';
import { outcome } from '@/lib/load-failure';
import { PageError } from '@/components/page-shell';
import { pickSection, SectionPills } from '@/components/section-pills';
import { ChildFilter } from '../child-filter';
import { AddTime, FavouriteStroke } from './progress-forms';
import { TimesList } from './times-list';

/** Coming after go-live: named here so a family knows, and nothing behind them yet. */
const INTEGRATIONS = ['Apple Health', 'Garmin', 'Fitbit'];
const SECTIONS = ['summary', 'times', 'integrations'] as const;

/**
 * *Progressos* — the triangle tab (Rui, 06-11-2026), in three sections. *Resumo*:
 * the distance, added up and never typed, the favourite stroke, and the best time
 * per stroke. *Registos*: every time, and adding one, in a lesson or not. *Integrações*:
 * what comes after go-live. Who may add is `family_may_answer()`, which the API
 * decides, and a typed time is marked and never official.
 */
export default async function FamilyProgressPage({
  searchParams,
}: {
  searchParams: Promise<{ child?: string; section?: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const format = await getFormatter();
  const { child, section: asked } = await searchParams;
  const section = pickSection(SECTIONS, asked, 'summary');

  const family = await outcome(apiFetch<{ students: { id: string; name: string }[] }>('/family'));
  if (family.state !== 'ok') return <PageError message={t('app.records.failed')} />;
  const everyone = family.data.students;
  const shown = child === undefined ? everyone : everyone.filter((one) => one.id === child);
  const several = shown.length > 1;

  const hrefOf = (key: string): string => {
    const query = new URLSearchParams();
    if (key !== 'summary') query.set('section', key);
    if (child !== undefined) query.set('child', child);
    return query.size === 0 ? '/app/familia/progressos' : `/app/familia/progressos?${query.toString()}`;
  };

  const rows =
    section === 'integrations'
      ? []
      : await Promise.all(
          shown.map(async (one) => ({
            ...one,
            progress: await outcome(apiFetch<FamilyProgress>(`/app/progress/${one.id}`)),
          })),
        );

  return (
    <>
      <h1>{t('app.tabs.familia.progressos')}</h1>
      <SectionPills
        label={t('app.records.sectionsLabel')}
        current={section}
        items={SECTIONS.map((key) => ({ key, label: t(`app.records.section.${key}`), href: hrefOf(key) }))}
      />

      {section === 'integrations' ? (
        <ul className="flex flex-col divide-y divide-border rounded bg-surface px-4 py-1 shadow-card">
          {INTEGRATIONS.map((name) => (
            <li key={name} className="flex items-center justify-between gap-3 py-3">
              <span>{name}</span>
              <span className="text-sm text-foreground-muted">{t('app.records.soon')}</span>
            </li>
          ))}
        </ul>
      ) : (
        <ChildFilter base="/app/familia/progressos" children={everyone} chosen={child} />
      )}

      {rows.map((one) => {
        const progress = one.progress.state === 'ok' ? one.progress.data : null;
        const bests = progress?.bests ?? [];
        return (
          <section key={one.id} className="flex flex-col gap-3">
            {several && <h2 className="font-bold">{one.name}</h2>}

            {section === 'summary' && (
              <>
                {/*
                  All time is the figure on show; a tap opens the rest (Rui,
                  09-11-2026): this season, this month, the average per year.
                */}
                <details className="group rounded bg-surface shadow-card">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary [&::-webkit-details-marker]:hidden">
                    <span className="flex items-center gap-1.5 text-sm font-bold">
                      {t('app.records.totalDistance')}
                      <ChevronDown className="size-4 text-foreground-muted transition-transform group-open:rotate-180" aria-hidden />
                    </span>
                    <span className="text-xl font-semibold tabular-nums">
                      {t('app.records.metres', { value: format.number(progress?.distance.allTimeM ?? progress?.totalDistanceM ?? 0) })}
                    </span>
                  </summary>
                  {progress !== null && (
                    <dl className="flex flex-col divide-y divide-border px-4 pb-3 text-sm">
                      {(
                        [
                          ['season', progress.distance.seasonM],
                          ['month', progress.distance.monthM],
                          ['perYear', progress.distance.perYearM],
                        ] as const
                      ).map(([key, metres]) => (
                        <div key={key} className="flex items-baseline justify-between gap-3 py-2">
                          <dt className="text-foreground-muted">{t(`app.records.distanceBy.${key}`)}</dt>
                          <dd className="font-semibold tabular-nums">
                            {metres === null ? '—' : t('app.records.metres', { value: format.number(metres) })}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </details>

                {progress?.canEdit === true && (
                  <div className="rounded bg-surface p-4 shadow-card">
                    <FavouriteStroke studentId={one.id} strokes={progress.strokes} favourite={progress.favouriteStroke} />
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
                          key={`${best.stroke}-${best.distanceM}`}
                          className="flex items-baseline justify-between gap-3 py-2"
                        >
                          <span className="flex min-w-0 flex-col">
                            <span className="font-medium">
                              {t('app.records.event', { distance: best.distanceM, stroke: t(`progress.strokes.${best.stroke}`) })}
                            </span>
                            <span className="text-sm text-foreground-muted">
                              {formatDate(best.swumOn)}
                            </span>
                          </span>
                          <span className="shrink-0 font-semibold tabular-nums">{formatSwimTime(best.timeMs)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            )}

            {section === 'times' && progress !== null && (
              <>
                {progress.canEnterTimes && (
                  <AddTime
                    studentId={one.id}
                    strokes={progress.strokes}
                    pools={progress.pools}
                    lessons={progress.lessons}
                  />
                )}
                <div className="flex flex-col gap-1 rounded bg-surface p-4 shadow-card">
                  <h3 className="text-sm font-bold">{t('app.records.allTimes')}</h3>
                  {/* Keyed on the total: adding or removing one starts the list again. */}
                  <TimesList
                    key={`${one.id}-${progress.timesTotal}`}
                    studentId={one.id}
                    first={progress.times}
                    total={progress.timesTotal}
                    canRemove={progress.canEnterTimes}
                  />
                </div>
              </>
            )}
          </section>
        );
      })}
    </>
  );
}
