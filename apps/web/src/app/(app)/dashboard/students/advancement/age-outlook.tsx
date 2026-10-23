'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { FromLink } from '@/components/from-link';
import { AgeRangeBadge } from '@/components/age-range';
import { useToast } from '@/components/ui/toast';
import type { AdvancementOutlook } from '@/lib/api';
import { formatDate } from '@/lib/date-format';
import { proposeByAgeAction } from './advancement.actions';

/**
 * What the queue says even when it is empty — POOLSE-112 BA 3.
 *
 * One sentence about the next season change under the club's setting, then a
 * level per row: how many are above its age band today, how many below (a flag
 * — BA 5 never proposes down), and *Propor* for the office to queue the ones
 * above now rather than wait for September. Every figure is the server's; the
 * screen adds nothing up.
 */
export function AgeOutlook({
  organizationId,
  outlook,
  canPropose,
  queueEmpty,
}: {
  organizationId: string;
  outlook: AdvancementOutlook;
  canPropose: boolean;
  queueEmpty: boolean;
}): React.ReactElement {
  const t = useTranslations();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [busyLevel, setBusyLevel] = useState<string | null>(null);

  function propose(levelId: string | null): void {
    setBusyLevel(levelId ?? '*');
    start(async () => {
      const result = await proposeByAgeAction(organizationId, levelId);
      setBusyLevel(null);
      if (!result.ok) {
        toast.show('danger', t(result.errorKey ?? 'common.notSaved'));
        return;
      }
      toast.show(
        'success',
        result.queued === 0
          ? t('advancement.outlook.proposedNone')
          : t('advancement.outlook.proposed', { count: result.queued ?? 0 }),
      );
    });
  }

  const next = outlook.nextSeason;
  const anyAbove = outlook.levels.some((level) => level.movableNow > 0);
  const flagged = outlook.levels.filter((level) => level.aboveNow > 0 || level.belowNow > 0);

  return (
    <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
      <div className="flex flex-col gap-1">
        {queueEmpty && <p>{t('advancement.none')}</p>}
        <p className={queueEmpty ? 'text-sm text-foreground-muted' : undefined}>
          {next === null
            ? t('advancement.outlook.noNextSeason')
            : t(`advancement.outlook.${outlook.mode === 'apply' ? 'willApply' : 'willPropose'}`, {
                date: formatDate(next.startsOn),
                season: next.name,
                count: outlook.willMove,
              })}
        </p>
        <p className="text-sm text-foreground-muted">
          {t(`advancement.outlook.modeIs.${outlook.mode}`)}{' '}
          <FromLink
            href="/dashboard/students/levels"
            className="text-primary underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {t('advancement.outlook.changeMode')}
          </FromLink>
        </p>
      </div>

      {flagged.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
            {t('advancement.outlook.todayTitle')}
          </h2>
          <ul className="flex flex-col divide-y divide-border rounded border border-border">
            {flagged.map((level) => (
              <li
                key={level.levelId}
                className="flex flex-wrap items-center justify-between gap-3 p-3"
              >
                <span className="flex flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{level.levelName}</span>
                    <AgeRangeBadge level={level} />
                  </span>
                  <span className="text-sm text-foreground-muted">
                    {level.aboveNow > 0 &&
                      t('advancement.outlook.above', {
                        count: level.aboveNow,
                        movable: level.movableNow,
                      })}
                    {level.aboveNow > 0 && level.belowNow > 0 && ' · '}
                    {level.belowNow > 0 && t('advancement.outlook.below', { count: level.belowNow })}
                  </span>
                </span>
                {canPropose && level.movableNow > 0 && (
                  <button
                    type="button"
                    onClick={() => propose(level.levelId)}
                    disabled={pending}
                    className="inline-flex h-control items-center justify-center px-4 text-control gap-2 rounded border border-border hover:bg-surface-muted disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  >
                    {busyLevel === level.levelId
                      ? t('advancement.outlook.proposing')
                      : t('advancement.outlook.propose')}
                  </button>
                )}
              </li>
            ))}
          </ul>
          {canPropose && anyAbove && (
            <div>
              <button
                type="button"
                onClick={() => propose(null)}
                disabled={pending}
                className="inline-flex h-control items-center justify-center px-4 text-control gap-2 rounded bg-primary text-primary-foreground disabled:opacity-60"
              >
                {busyLevel === '*'
                  ? t('advancement.outlook.proposing')
                  : t('advancement.outlook.proposeAll')}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
