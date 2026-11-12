'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Undo2 } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { formatStamp } from '@/lib/date-format';
import { ARCHIVE_ICON, ARCHIVE_TRIGGER } from '@/lib/archive-trigger';
import {
  importInUseAction,
  listImportsAction,
  undoImportAction,
  type TimetableImportRecord,
} from './import.actions';

const DANGER =
  'inline-flex h-control items-center justify-center gap-2 rounded-sm bg-destructive px-4 text-control font-medium text-destructive-foreground hover:opacity-90 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const QUIET =
  'inline-flex h-control items-center justify-center rounded-sm bg-surface px-4 text-control shadow-card hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/**
 * *Importações anteriores* — Rui, 12-11-2026. Every confirmed timetable import
 * of the site, newest first, each with *Desfazer*: it archives what that import
 * wrote (its turmas and every slot it added), one restorable entry in
 * Arquivados. Turmas that have students since are listed and stay unless ticked.
 */
export function ImportHistory({ facilityIds, refreshKey }: { facilityIds: string[]; refreshKey: number }): React.ReactElement | null {
  const t = useTranslations();
  const router = useRouter();
  const { show } = useToast();
  const [imports, setImports] = useState<TimetableImportRecord[] | null>(null);
  const [asking, setAsking] = useState<TimetableImportRecord | null>(null);
  const [inUse, setInUse] = useState<{ id: string; name: string; students: number }[] | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [working, setWorking] = useState(false);

  // Every site the operator may import into, newest import first (12-11-2026).
  const sites = facilityIds.join(',');
  useEffect(() => {
    let live = true;
    void Promise.all(sites.split(',').filter((id) => id !== '').map((id) => listImportsAction(id))).then((found) => {
      if (!live) return;
      const all = found.flatMap((list) => list ?? []);
      setImports(all.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    });
    return () => {
      live = false;
    };
  }, [sites, refreshKey]);

  const open = (record: TimetableImportRecord): void => {
    setAsking(record);
    setInUse(null);
    setTicked(new Set());
    void importInUseAction(record.id).then(setInUse);
  };

  const undo = async (): Promise<void> => {
    if (asking === null) return;
    setWorking(true);
    const done = await undoImportAction(asking.id, [...ticked]);
    setWorking(false);
    if (!done.ok) {
      show('danger', t(done.errorKey ?? 'timetableImport.history.undoFailed'));
      return;
    }
    show('success', t('timetableImport.history.undone', { turmas: done.turmas ?? 0, slots: done.slots ?? 0 }));
    setAsking(null);
    setImports((was) => (was ?? []).map((one) => (one.id === asking.id ? { ...one, undone: true } : one)));
    router.refresh();
  };

  if (imports === null || imports.length === 0) return null;

  return (
    <section className="flex flex-col gap-2 border-t border-border pt-4">
      <h3 className="text-sm font-semibold">{t('timetableImport.history.title')}</h3>
      <ul className="flex flex-col divide-y divide-border rounded border border-border">
        {imports.map((record) => (
          <li key={record.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
            <span className="flex min-w-0 flex-col">
              <span className="font-medium">
                {record.fileName ?? t('timetableImport.history.noName')} · {formatStamp(new Date(record.createdAt))}
              </span>
              <span className="text-xs text-foreground-muted">
                {t('timetableImport.history.line', {
                  pools: record.poolNames.join(', '),
                  slots: record.slotsCreated,
                  turmas: record.turmasCreated,
                })}
                {record.replaced && ` · ${t('timetableImport.history.replaced')}`}
                {record.createdByName !== null && ` · ${record.createdByName}`}
              </span>
            </span>
            {record.undone ? (
              <span className="text-xs text-foreground-muted">{t('timetableImport.history.isUndone')}</span>
            ) : (
              <button type="button" className={ARCHIVE_TRIGGER} onClick={() => open(record)}>
                <Undo2 aria-hidden className={ARCHIVE_ICON} />
                {t('timetableImport.history.undo')}
              </button>
            )}
          </li>
        ))}
      </ul>

      <Dialog
        open={asking !== null}
        onClose={() => setAsking(null)}
        title={t('timetableImport.history.undoTitle')}
        description={asking?.fileName ?? undefined}
        closeLabel={t('common.close')}
        className="max-w-lg"
      >
        <div className="flex flex-col gap-3 text-sm">
          <p>{t('timetableImport.history.undoExplain')}</p>
          {inUse !== null && inUse.length > 0 && (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 font-medium">{t('timetableImport.existing.inUse')}</legend>
              {inUse.map((turma) => (
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
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={working || inUse === null} className={DANGER} onClick={() => void undo()}>
              {t('timetableImport.history.undoConfirm')}
            </button>
            <button type="button" className={QUIET} onClick={() => setAsking(null)}>
              {t('common.cancel')}
            </button>
          </div>
        </div>
      </Dialog>
    </section>
  );
}
