'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { FromLink } from '@/components/from-link';
import type { PoolCalendar } from './import.actions';

const BUTTON =
  'inline-flex h-control items-center justify-center gap-2 rounded-sm bg-primary px-4 text-control font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const QUIET =
  'inline-flex h-control items-center justify-center gap-2 rounded-sm bg-surface px-4 text-control shadow-card hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/**
 * An import onto a pool that already has a calendar — Rui, 12-11-2026.
 *
 * Never merged silently: the operator replaces the current calendar (every
 * turma, slot, event, natação livre and parceria of the pool this season goes
 * to Arquivados, restorable as one entry) or creates a new pool for the file.
 * Turmas with students are listed and stay unless ticked.
 */
export function ExistingCalendar({
  calendars,
  facilityId,
  working,
  onReplace,
}: {
  calendars: PoolCalendar[];
  facilityId: string;
  working: boolean;
  onReplace: (keepTurmaIds: string[]) => void;
}): React.ReactElement {
  const t = useTranslations();
  const inUse = calendars.flatMap((calendar) => calendar.inUse);
  const [ticked, setTicked] = useState<Set<string>>(new Set());

  return (
    <section role="alert" className="flex flex-col gap-3 rounded border border-warning/40 bg-warning/10 p-4">
      <h3 className="text-sm font-semibold">{t('timetableImport.existing.title')}</h3>
      <ul className="flex flex-col gap-1 text-sm">
        {calendars.map((calendar) => (
          <li key={calendar.poolId}>
            {t('timetableImport.existing.pool', { pool: calendar.poolName, turmas: calendar.turmas, slots: calendar.slots })}
          </li>
        ))}
      </ul>
      <p className="text-sm text-foreground-muted">{t('timetableImport.existing.explain')}</p>

      {inUse.length > 0 && (
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">{t('timetableImport.existing.inUse')}</legend>
          {inUse.map((turma) => (
            <label key={turma.id} className="flex items-center gap-2 text-sm">
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

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={working}
          className={BUTTON}
          onClick={() => onReplace(inUse.map((turma) => turma.id).filter((id) => !ticked.has(id)))}
        >
          {t('timetableImport.existing.replace')}
        </button>
        <FromLink href={`/dashboard/facilities/pools/new?facilityId=${facilityId}`} className={QUIET}>
          {t('timetableImport.existing.newPool')}
        </FromLink>
      </div>
      <p className="text-xs text-foreground-muted">{t('timetableImport.existing.newPoolHint')}</p>
    </section>
  );
}
