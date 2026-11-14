'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Dialog } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { ARCHIVE_ICON, ARCHIVE_TRIGGER } from '@/lib/archive-trigger';
import { Eraser } from 'lucide-react';
import { calendarToClearAction, clearCalendarAction, type PoolCalendar } from './import/import.actions';

const DANGER =
  'inline-flex h-control items-center justify-center gap-2 rounded-sm bg-destructive px-4 text-control font-medium text-destructive-foreground hover:opacity-90 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const QUIET =
  'inline-flex h-control items-center justify-center rounded-sm bg-surface px-4 text-control shadow-card hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

export interface ClearablePool {
  id: string;
  name: string;
  facilityId: string;
}

/**
 * *Limpar calendário* — Rui, 14-11-2026: "subtle, but there, instead of
 * deleting one slot at a time". One quiet trigger per pool in the Época card,
 * owner and admin only (the API refuses anybody else). It asks first, saying
 * what goes, and does what an import's *Substituir* does with nothing coming
 * in: the pool's turmas, slots, events, natação livre and parcerias this season
 * to Arquivados as one restorable entry. Turmas with students stay unless ticked.
 */
export function ClearCalendar({ pools }: { pools: ClearablePool[] }): React.ReactElement | null {
  const t = useTranslations();
  const router = useRouter();
  const { show } = useToast();
  const [asking, setAsking] = useState<ClearablePool | null>(null);
  // undefined: still reading, or the read failed (`failed`); null: nothing there.
  const [calendar, setCalendar] = useState<PoolCalendar | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  // Only the hours (the default, the safer) or the turmas too — asked every time (Rui, 14-11-2026).
  const [mode, setMode] = useState<'slots' | 'all'>('slots');
  const [working, setWorking] = useState(false);

  if (pools.length === 0) return null;

  const open = (pool: ClearablePool): void => {
    setAsking(pool);
    setCalendar(undefined);
    setFailed(false);
    setTicked(new Set());
    setMode('slots');
    void calendarToClearAction(pool.facilityId, pool.id).then((found) => {
      if (found === undefined) setFailed(true);
      setCalendar(found);
    });
  };

  const clear = async (): Promise<void> => {
    if (asking === null) return;
    setWorking(true);
    const done = await clearCalendarAction(asking.facilityId, asking.id, mode === 'all' ? [...ticked] : [], mode);
    setWorking(false);
    if (!done.ok) {
      show('danger', t('timetableImport.clear.failed'));
      return;
    }
    show('success', t('timetableImport.clear.done', { turmas: done.turmas ?? 0, slots: done.slots ?? 0 }));
    setAsking(null);
    router.refresh();
  };

  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {pools.map((pool) => (
        <button key={pool.id} type="button" className={ARCHIVE_TRIGGER} onClick={() => open(pool)}>
          <Eraser aria-hidden className={ARCHIVE_ICON} />
          {t('timetableImport.clear.open', { pool: pool.name })}
        </button>
      ))}

      <Dialog
        open={asking !== null}
        onClose={() => setAsking(null)}
        title={t('timetableImport.clear.ask', { pool: asking?.name ?? '' })}
        closeLabel={t('common.close')}
        className="max-w-lg"
      >
        <div className="flex flex-col gap-3 text-sm">
          {failed && <p className="text-danger">{t('timetableImport.clear.failed')}</p>}
          {calendar === undefined && !failed && <p className="text-foreground-muted">{t('common.working')}</p>}
          {calendar === null && <p>{t('timetableImport.clear.empty', { pool: asking?.name ?? '' })}</p>}
          {calendar != null && (
            <>
              <p className="font-medium">
                {t('timetableImport.clear.what', { turmas: calendar.turmas, slots: calendar.slots })}
              </p>
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 font-medium">{t('timetableImport.clear.modeTitle')}</legend>
                <label className="flex items-start gap-2">
                  <input type="radio" name="clear-mode" className="mt-1" checked={mode === 'slots'} onChange={() => setMode('slots')} />
                  <span className="flex flex-col">
                    <span>{t('timetableImport.clear.slotsOnly')}</span>
                    <span className="text-foreground-muted">{t('timetableImport.clear.slotsOnlyHint')}</span>
                  </span>
                </label>
                <label className="flex items-start gap-2">
                  <input type="radio" name="clear-mode" className="mt-1" checked={mode === 'all'} onChange={() => setMode('all')} />
                  <span className="flex flex-col">
                    <span>{t('timetableImport.clear.all')}</span>
                    <span className="text-foreground-muted">{t('timetableImport.clear.explain')}</span>
                  </span>
                </label>
              </fieldset>
              {mode === 'all' && calendar.inUse.length > 0 && (
                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-1 font-medium">{t('timetableImport.existing.inUse')}</legend>
                  {calendar.inUse.map((turma) => (
                    <label key={turma.id} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={ticked.has(turma.id)}
                        onChange={(event) =>
                          setTicked((was) => {
                            const next = new Set(was);
                            if (event.target.checked) next.add(turma.id);
                            else next.delete(turma.id);
                            return next;
                          })
                        }
                      />
                      {t('timetableImport.existing.archiveToo', { name: turma.name, count: turma.students })}
                    </label>
                  ))}
                </fieldset>
              )}
            </>
          )}
          <div className="flex flex-wrap gap-2">
            {calendar != null && (
              <button type="button" disabled={working} className={DANGER} onClick={() => void clear()}>
                {t('timetableImport.clear.confirm')}
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
