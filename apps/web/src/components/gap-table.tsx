import { getTranslations } from 'next-intl/server';
import { CircleCheck, CircleDashed, CircleMinus } from 'lucide-react';
import { formatGap, formatSwimTime } from '@poolse/rules';
import type { GapRow } from '@/lib/api';
import { formatDate } from '@/lib/date-format';

/**
 * A swimmer's gap to one qualifying standard — POOLSE-85.
 *
 * Every figure here came from the API (`qualifying_gaps()` in SQL); nothing is
 * subtracted on this side. Three states, each with words and an icon so colour
 * never carries it: qualified, still to find, and no valid time — which is not
 * a gap and is never drawn as one.
 */
export async function GapTable({ rows }: { rows: GapRow[] }): Promise<React.ReactElement> {
  const t = await getTranslations();
  const showGroup = new Set(rows.map((row) => row.ageGroup)).size > 1;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[32rem] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-foreground-muted">
            <th scope="col" className="py-2 pr-4 font-normal">{t('qualifying.event')}</th>
            <th scope="col" className="py-2 pr-4 font-normal">{t('qualifying.gap')}</th>
            <th scope="col" className="py-2 pr-4 font-normal">{t('qualifying.entryTime')}</th>
            <th scope="col" className="py-2 pr-4 font-normal">{t('qualifying.bestValid')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={`${row.ageGroup}-${row.stroke}-${row.distanceM}-${row.course}`}
              className="border-b border-border align-top last:border-0"
            >
              <th scope="row" className="py-2 pr-4 text-left font-normal">
                {t('qualifying.eventName', {
                  distance: row.distanceM,
                  stroke: t(`progress.strokes.${row.stroke}`),
                })}
                <span className="block text-foreground-muted">
                  {t(`progress.course.${row.course}`)}
                  {showGroup ? ` · ${row.ageGroup}` : ''}
                </span>
              </th>
              <td className="py-2 pr-4">
                <GapCell gapMs={row.gapMs} />
              </td>
              <td className="py-2 pr-4 font-mono">{formatSwimTime(row.entryMs)}</td>
              <td className="py-2 pr-4">
                {row.bestMs === null ? (
                  <span className="text-foreground-muted">{t('qualifying.noValidTime')}</span>
                ) : (
                  <>
                    <span className="font-mono">{formatSwimTime(row.bestMs)}</span>
                    <span className="block text-foreground-muted">
                      {[row.bestMeet, row.bestSwumOn === null ? null : formatDate(row.bestSwumOn)]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export async function GapCell({ gapMs }: { gapMs: number | null }): Promise<React.ReactElement> {
  const t = await getTranslations();
  if (gapMs === null) {
    return (
      <span className="inline-flex items-center gap-1.5 text-foreground-muted">
        <CircleDashed className="size-4" aria-hidden />
        {t('qualifying.noGap')}
      </span>
    );
  }
  if (gapMs <= 0) {
    return (
      <span className="inline-flex items-center gap-1.5 text-success">
        <CircleCheck className="size-4" aria-hidden />
        {t('qualifying.qualified')}
        <span className="font-mono">{formatGap(gapMs)}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <CircleMinus className="size-4 text-foreground-muted" aria-hidden />
      {t('qualifying.toFind', { gap: formatGap(gapMs) })}
    </span>
  );
}
