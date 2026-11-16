'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Columns3 } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { distributeAction, distributionPlanAction, type DistributionItem } from './import/import.actions';
import type { ClearablePool } from './clear-calendar';

const PRIMARY =
  'inline-flex h-control items-center justify-center gap-2 rounded-sm bg-primary px-4 text-control font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const QUIET =
  'inline-flex h-control items-center justify-center rounded-sm bg-surface px-4 text-control shadow-card hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const TRIGGER =
  'inline-flex items-center gap-1.5 self-start text-sm text-primary underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/**
 * *Distribuir pelas pistas* — Rui, 16-11-2026. One per pool in the Época card,
 * owner and admin (the API refuses anybody else). It asks first, listing which
 * classes go to which free lane at their own day and hour and which have no
 * free lane and stay; then moves them as a drag would.
 */
export function DistributeLanes({ pools }: { pools: ClearablePool[] }): React.ReactElement | null {
  const t = useTranslations();
  const router = useRouter();
  const { show } = useToast();
  const [asking, setAsking] = useState<ClearablePool | null>(null);
  const [plan, setPlan] = useState<{ placeable: DistributionItem[]; unplaceable: DistributionItem[] } | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [working, setWorking] = useState(false);

  if (pools.length === 0) return null;

  const open = (pool: ClearablePool): void => {
    setAsking(pool);
    setPlan(undefined);
    setFailed(false);
    void distributionPlanAction(pool.facilityId, pool.id).then((found) => {
      if (found === undefined) setFailed(true);
      setPlan(found);
    });
  };

  const run = async (): Promise<void> => {
    if (asking === null) return;
    setWorking(true);
    const done = await distributeAction(asking.facilityId, asking.id);
    setWorking(false);
    if (!done.ok) {
      show('danger', t('timetableImport.distribute.failed'));
      return;
    }
    const message = t('timetableImport.distribute.done', { placed: done.placed ?? 0, unplaced: done.unplaced ?? 0 });
    // Something still without a lane is a warning, not a plain success.
    show((done.unplaced ?? 0) > 0 ? 'warning' : 'success', message);
    setAsking(null);
    router.refresh();
  };

  const line = (item: DistributionItem): string =>
    `${item.name} · ${t(`weekShort.${item.weekday}`)} ${item.startTime}${item.lanes === undefined ? '' : ` → ${item.lanes.join(', ')}`}`;

  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {pools.map((pool) => (
        <button key={pool.id} type="button" className={TRIGGER} onClick={() => open(pool)}>
          <Columns3 aria-hidden className="size-4" />
          {t('timetableImport.distribute.open', { pool: pool.name })}
        </button>
      ))}

      <Dialog
        open={asking !== null}
        onClose={() => setAsking(null)}
        title={t('timetableImport.distribute.ask', { pool: asking?.name ?? '' })}
        closeLabel={t('common.close')}
        className="max-w-xl"
      >
        <div className="flex flex-col gap-3 text-sm">
          <p>{t('timetableImport.distribute.explain')}</p>
          {failed && <p className="text-danger">{t('timetableImport.distribute.failed')}</p>}
          {plan === undefined && !failed && <p className="text-foreground-muted">{t('common.working')}</p>}
          {plan !== undefined && plan.placeable.length === 0 && plan.unplaceable.length === 0 && (
            <p>{t('timetableImport.distribute.none', { pool: asking?.name ?? '' })}</p>
          )}
          {plan !== undefined && plan.placeable.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="font-medium">{t('timetableImport.distribute.will', { count: plan.placeable.length })}</p>
              <ul className="max-h-48 list-disc overflow-y-auto pl-5 text-foreground-muted">
                {plan.placeable.map((item) => (
                  <li key={item.scheduleId}>{line(item)}</li>
                ))}
              </ul>
            </div>
          )}
          {plan !== undefined && plan.unplaceable.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="font-medium text-warning">{t('timetableImport.distribute.cannot', { count: plan.unplaceable.length })}</p>
              <ul className="max-h-32 list-disc overflow-y-auto pl-5 text-foreground-muted">
                {plan.unplaceable.map((item) => (
                  <li key={item.scheduleId}>{line(item)}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {plan !== undefined && plan.placeable.length > 0 && (
              <button type="button" disabled={working} className={PRIMARY} onClick={() => void run()}>
                {t('timetableImport.distribute.confirm')}
              </button>
            )}
            <button type="button" className={QUIET} onClick={() => setAsking(null)}>
              {t('common.cancel')}
            </button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
