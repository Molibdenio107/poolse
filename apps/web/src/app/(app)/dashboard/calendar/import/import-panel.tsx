'use client';

import { useActionState, useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, FileSpreadsheet, Upload, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DropOverlay, useFileDrop } from '@/components/file-drop';
import {
  readOtherSheetAction,
  readTimetableAction,
  runTimetableImportAction,
  type ImportState,
  type ReadState,
  type TimetableRow,
} from './import.actions';

/**
 * Importing the wall timetable — POOLSE-57, the interface.
 *
 * Rui's two decisions are the whole shape of this screen:
 *
 * **Nothing is written while a conflict is unresolved.** The commit button is
 * disabled while `committable` is false and says how many clashes remain. It is
 * never a matter of the operator being careful — the API refuses the same file
 * for the same reason, and this is the courtesy.
 *
 * **A clash is resolved in a dialog, never by overwriting.** The dialog lists
 * each conflict specifically: what is arriving, what is already there, why they
 * collide, and — the part that makes it decidable — whether the other side is a
 * booking on the grid or another line of the same file. Its one verb is *drop
 * this row*, because the incoming class yielding is the only resolution that
 * never destroys something the club already has.
 *
 * The file is dropped anywhere on the Calendar. A drop **asks before it reads
 * anything**: files are dragged by accident, and a screen that starts reading
 * one nobody meant to give it is a screen people stop dragging onto.
 */

const ACCEPTED = ['.xlsx', '.csv'];

const BUTTON =
  'rounded bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-60 ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

const BUTTON_QUIET =
  'rounded border border-border px-4 py-2 text-sm hover:bg-surface-muted ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

function isAccepted(file: File): boolean {
  const name = file.name.toLowerCase();
  return ACCEPTED.some((extension) => name.endsWith(extension));
}

export function TimetableImport({
  facilityId,
  canManage,
}: {
  facilityId: string;
  canManage: boolean;
}): React.ReactElement | null {
  const t = useTranslations();

  const [open, setOpen] = useState(false);
  /** The dropped file waiting for a yes or a no. */
  const [pending, setPending] = useState<File | null>(null);

  const onFile = useCallback((file: File) => setPending(file), []);
  const { dragging } = useFileDrop(onFile);

  const [read, readAction] = useActionState(readTimetableAction, { ok: false, attempt: 0 });
  const [other, otherAction] = useActionState(readOtherSheetAction, { ok: false, attempt: 0 });
  const [run, runAction, running] = useActionState(runTimetableImportAction, {
    ok: false,
    attempt: 0,
  });

  /** Rows the operator has dropped in the dialog — decision 2's only verb. */
  const [dropped, setDropped] = useState<number[]>([]);
  const [showConflicts, setShowConflicts] = useState(false);

  const reading = (other.ok ? other.reading : undefined) ?? read.reading;
  const candidates = reading?.candidates ?? [];
  const result = run.result;

  /*
   * A fresh file starts a fresh set of decisions.
   *
   * Carrying `dropped` across would silently drop rows of the *new* file at the
   * old indexes — the kind of bug that only shows up on the second import
   * somebody does, which is the one they do unsupervised.
   */
  useEffect(() => {
    setDropped([]);
    setShowConflicts(false);
  }, [read.attempt, other.attempt]);

  // Reading a file always opens the panel; the drop is how most people will.
  useEffect(() => {
    if (read.ok) setOpen(true);
  }, [read.ok, read.attempt]);

  if (!canManage) return null;

  const rows = result?.rows ?? [];
  const conflicted = rows.filter((row) => !row.importable);
  const blocked = result === undefined ? 0 : result.summary.blocked + result.summary.refused;

  return (
    <>
      <DropOverlay shown={dragging} label={t('timetableImport.dropHere')} />

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => setOpen((was) => !was)} className={BUTTON_QUIET}>
          <span className="flex items-center gap-2">
            <Upload aria-hidden className="size-4" />
            {t('timetableImport.open')}
          </span>
        </button>
        {!open && <span className="text-sm text-foreground-muted">{t('timetableImport.hint')}</span>}
      </div>

      {/*
        The confirmation a drop gets before anything is read — the same rule the
        register's importer set. Files are dragged by accident.
      */}
      {pending !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="drop-title"
            className="flex w-full max-w-md flex-col gap-4 rounded-lg border border-border bg-surface p-6 shadow-lg"
          >
            <h2 id="drop-title" className="flex items-center gap-2 text-lg font-medium">
              <FileSpreadsheet aria-hidden className="size-5" />
              {t('timetableImport.confirmTitle')}
            </h2>
            <p className="break-all text-sm text-foreground-muted">{pending.name}</p>

            {!isAccepted(pending) ? (
              <>
                <p className="text-sm text-danger">{t('students.import.errorFileType')}</p>
                <button type="button" onClick={() => setPending(null)} className={BUTTON_QUIET}>
                  {t('common.cancel')}
                </button>
              </>
            ) : (
              <form
                action={(data) => {
                  data.set('file', pending);
                  setPending(null);
                  readAction(data);
                }}
                className="flex flex-wrap gap-3"
              >
                <button type="submit" className={BUTTON}>
                  {t('timetableImport.confirmRead')}
                </button>
                <button type="button" onClick={() => setPending(null)} className={BUTTON_QUIET}>
                  {t('common.cancel')}
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {open && (
        <section className="flex flex-col gap-4 rounded border border-border bg-surface p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
                {t('timetableImport.title')}
              </h2>
              <p className="mt-1 text-sm text-foreground-muted">{t('timetableImport.subtitle')}</p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t('common.cancel')}
              className="rounded p-1 hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <X aria-hidden className="size-4" />
            </button>
          </div>

          {/* Step one — the file. */}
          <form action={readAction} className="flex flex-wrap items-center gap-3">
            <input
              type="file"
              name="file"
              accept={ACCEPTED.join(',')}
              required
              className="text-sm file:mr-3 file:rounded file:border file:border-border file:bg-surface-muted file:px-3 file:py-1.5 file:text-sm"
            />
            <button type="submit" className={BUTTON_QUIET}>
              {t('timetableImport.read')}
            </button>
          </form>

          {read.errorKey !== undefined && (
            <p role="alert" className="text-sm text-danger">
              {t(read.errorKey)}
            </p>
          )}

          {/* A workbook with a tab per tank — pick the one that holds the grid. */}
          {read.sheets !== undefined && read.sheets.length > 1 && (
            <form action={otherAction} className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-sm">
                {t('timetableImport.sheet')}
                <select
                  name="sheet"
                  className="h-control rounded border border-border-strong bg-background px-2.5 text-sm"
                >
                  {read.sheets.map((sheet) => (
                    <option key={sheet.name} value={JSON.stringify(sheet)}>
                      {sheet.name}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" className={BUTTON_QUIET}>
                {t('timetableImport.readSheet')}
              </button>
            </form>
          )}

          {/* Step two — what the reader made of the layout. */}
          {reading !== undefined && (
            <div className="flex flex-col gap-3 border-t border-border pt-4">
              {reading.days.length === 0 ? (
                <p role="alert" className="text-sm text-danger">
                  {t('timetableImport.noGrid')}
                </p>
              ) : (
                <>
                  <p className="text-sm text-foreground-muted">
                    {t('timetableImport.found', {
                      days: reading.days.length,
                      bookings: candidates.length,
                    })}
                  </p>

                  {reading.unplaced.length > 0 && (
                    <details className="text-sm">
                      <summary className="cursor-pointer text-foreground-muted">
                        {t('timetableImport.unplaced', { count: reading.unplaced.length })}
                      </summary>
                      <ul className="mt-1 flex flex-col gap-0.5 pl-4 text-foreground-muted">
                        {reading.unplaced.map((entry) => (
                          <li key={entry.line}>
                            {entry.line}: {entry.text}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}

                  <form
                    action={(data) => {
                      data.set('facilityId', facilityId);
                      data.set('rows', JSON.stringify(candidates));
                      data.set('settings', JSON.stringify({ commit: false, drop: dropped }));
                      runAction(data);
                    }}
                  >
                    <button type="submit" disabled={running || candidates.length === 0} className={BUTTON}>
                      {t('timetableImport.check')}
                    </button>
                  </form>
                </>
              )}
            </div>
          )}

          {run.errorKey !== undefined && (
            <p role="alert" className="text-sm text-danger">
              {t(run.errorKey)}
            </p>
          )}

          {/* Step three — the verdict, and the commit. */}
          {result !== undefined && (
            <div className="flex flex-col gap-3 border-t border-border pt-4">
              {run.committed === true ? (
                <p role="status" className="text-sm font-medium text-success">
                  {t('timetableImport.done', { count: result.created ?? 0 })}
                </p>
              ) : (
                <>
                  <p className="text-sm">
                    {t('timetableImport.summary', {
                      importable: result.summary.importable,
                      total: result.summary.total,
                    })}
                  </p>

                  {blocked > 0 ? (
                    <div className="flex flex-col items-start gap-3 rounded border border-warning/40 bg-warning/5 p-4">
                      <p className="flex items-start gap-2 text-sm">
                        <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
                        {/*
                          Decision 1, said out loud. The button below is disabled
                          and this is why — an operator should never be left
                          hunting for the reason a control will not work.
                        */}
                        <span>{t('timetableImport.blocked', { count: blocked })}</span>
                      </p>
                      <button
                        type="button"
                        onClick={() => setShowConflicts(true)}
                        className={BUTTON_QUIET}
                      >
                        {t('timetableImport.resolve')}
                      </button>
                    </div>
                  ) : (
                    <form
                      action={(data) => {
                        data.set('facilityId', facilityId);
                        data.set('rows', JSON.stringify(candidates));
                        data.set('settings', JSON.stringify({ commit: true, drop: dropped }));
                        runAction(data);
                      }}
                    >
                      <button type="submit" disabled={running} className={BUTTON}>
                        {t('timetableImport.commit', { count: result.summary.importable })}
                      </button>
                    </form>
                  )}
                </>
              )}
            </div>
          )}
        </section>
      )}

      {showConflicts && result !== undefined && (
        <ConflictDialog
          rows={conflicted}
          dropped={dropped}
          onDrop={(index) => setDropped((was) => [...new Set([...was, index])])}
          onKeep={(index) => setDropped((was) => was.filter((one) => one !== index))}
          onClose={() => setShowConflicts(false)}
          onRecheck={() => {
            setShowConflicts(false);
            const data = new FormData();
            data.set('facilityId', facilityId);
            data.set('rows', JSON.stringify(candidates));
            data.set('settings', JSON.stringify({ commit: false, drop: dropped }));
            runAction(data);
          }}
        />
      )}
    </>
  );
}

/**
 * "Listing which conflict happens, and then the user decides" — decision 2.
 *
 * Each row names both sides. `withLine` is what makes a clash decidable: a
 * collision with **another line of this file** is a choice between two things
 * arriving, and a collision with **the grid** is a choice about something the
 * club already has. Those are different decisions and the dialog says which.
 *
 * One verb — *drop this row*. Overwriting is not offered, because the class
 * already on the grid may have a register, a reposição booked against it and a
 * parent who was told about it, and none of that is visible from a spreadsheet.
 */
function ConflictDialog({
  rows,
  dropped,
  onDrop,
  onKeep,
  onClose,
  onRecheck,
}: {
  rows: TimetableRow[];
  dropped: number[];
  onDrop: (index: number) => void;
  onKeep: (index: number) => void;
  onClose: () => void;
  onRecheck: () => void;
}): React.ReactElement {
  const t = useTranslations();

  const clock = (minutes: number): string =>
    `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="clash-title"
        className="flex max-h-[80vh] w-full max-w-2xl flex-col gap-4 overflow-auto rounded-lg border border-border bg-surface p-6 shadow-lg"
      >
        <h2 id="clash-title" className="text-lg font-medium">
          {t('timetableImport.conflictsTitle', { count: rows.length })}
        </h2>
        <p className="text-sm text-foreground-muted">{t('timetableImport.conflictsHint')}</p>

        <ul className="flex flex-col gap-3">
          {rows.map((row) => {
            const isDropped = dropped.includes(row.index);

            return (
              <li
                key={row.index}
                className={cn(
                  'flex flex-col gap-2 rounded border p-3',
                  isDropped ? 'border-border bg-surface-muted opacity-70' : 'border-warning/40',
                )}
              >
                <div className="flex flex-wrap items-baseline gap-x-3 text-sm">
                  <span className="font-medium">{row.name}</span>
                  <span className="text-foreground-muted">
                    {t(`week.${row.weekday}`)} · {clock(row.startMinutes)} ·{' '}
                    {row.laneNames.join(', ')}
                  </span>
                  <span className="text-foreground-muted">
                    {t('timetableImport.line', { line: row.line })}
                  </span>
                </div>

                {/* Why it collides, and with what — both sides, always. */}
                <ul className="flex flex-col gap-1 text-sm">
                  {row.problems.map((problem) => (
                    <li key={problem.code} className="text-danger">
                      {t(`timetableImport.problem.${problem.code}`, {
                        value: problem.value ?? '',
                      })}
                    </li>
                  ))}
                  {row.clashes.map((clash, at) => (
                    <li key={`${clash.code}:${at}`} className="text-foreground">
                      {t(`grid.reason.${clash.code}`, {
                        holder: clash.with ?? '—',
                        lane: clash.lane ?? '—',
                        reason: '',
                        count: 0,
                        limit: 0,
                        headcount: 0,
                        capacity: 0,
                      })}
                      {clash.withLine !== null && (
                        <span className="text-foreground-muted">
                          {' '}
                          — {t('timetableImport.sameFile', { line: clash.withLine })}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>

                <div className="flex flex-wrap gap-2">
                  {isDropped ? (
                    <button type="button" onClick={() => onKeep(row.index)} className={BUTTON_QUIET}>
                      {t('timetableImport.keepRow')}
                    </button>
                  ) : (
                    <button type="button" onClick={() => onDrop(row.index)} className={BUTTON_QUIET}>
                      {t('timetableImport.dropRow')}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        <div className="flex flex-wrap gap-3 border-t border-border pt-4">
          <button type="button" onClick={onRecheck} className={BUTTON}>
            {t('timetableImport.recheck')}
          </button>
          <button type="button" onClick={onClose} className={BUTTON_QUIET}>
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
