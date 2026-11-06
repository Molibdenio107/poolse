import { getTranslations } from 'next-intl/server';
import { Medal } from 'lucide-react';
import { formatSwimTime } from '@poolse/rules';
import { apiFetch, type Progression } from '@/lib/api';
import { formatDate } from '@/lib/date-format';
import { outcome } from '@/lib/load-failure';
import { PageError } from '@/components/page-shell';
import { ChildFilter } from '../child-filter';

/**
 * *Progressos* — the triangle tab (Rui, 06-11-2026). Each child's best times, per
 * stroke, distance and pool length, as `GET /students/:id/progression` gives them
 * to a family. A club with competition off, or a child with no times, reads one
 * short line. Health integrations come here after go-live.
 */
export default async function FamilyRecords({
  searchParams,
}: {
  searchParams: Promise<{ child?: string }>;
}): Promise<React.ReactElement> {
  const t = await getTranslations();
  const { child } = await searchParams;

  const family = await outcome(apiFetch<{ students: { id: string; name: string }[] }>('/family'));
  if (family.state !== 'ok') return <PageError message={t('app.records.failed')} />;
  const everyone = family.data.students;
  const shown = child === undefined ? everyone : everyone.filter((one) => one.id === child);
  const several = shown.length > 1;

  const rows = await Promise.all(
    shown.map(async (one) => ({
      ...one,
      progress: await outcome(apiFetch<Progression>(`/students/${one.id}/progression`)),
    })),
  );

  return (
    <>
      <h1>{t('app.tabs.familia.progressos')}</h1>
      <ChildFilter base="/app/familia/progressos" children={everyone} chosen={child} />

      {rows.map((one) => {
        const bests = one.progress.state === 'ok' ? one.progress.data.bests : [];
        return (
          <section key={one.id} className="flex flex-col gap-1 rounded bg-surface p-4 shadow-card">
            {several && <h2 className="font-bold">{one.name}</h2>}
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
                      <span className="text-sm text-foreground-muted">{formatDate(best.swumOn)}</span>
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums">{formatSwimTime(best.timeMs)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </>
  );
}
