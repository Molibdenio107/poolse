'use client';

import type { PoolseSport } from '@poolse/rules';
import { sportNameKey } from '@/components/sport-icon';
import { startTransition, useActionState, useCallback, useEffect, useRef, useState } from 'react';
import { useBusyWhile } from '@/lib/busy';
import { useTranslations } from 'next-intl';
import { FileSpreadsheet, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DropOverlay, useFileDrop } from '@/components/file-drop';
import {
  readOtherSheetAction,
  extendHoursAction,
  readTimetableAction,
  runTimetableImportAction,
  type ImportState,
  type ReadState,
  type TimetableRow,
} from './import.actions';
import { Dialog } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { ConflictGroups } from './conflict-groups';
import { SelectField } from '@/components/ui/field';

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

const ACCEPTED = ['.xlsx', '.csv', '.pdf'];

const BUTTON =
   'inline-flex h-control items-center justify-center px-4 text-control gap-2 rounded bg-primary text-primary-foreground disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary font-semibold';

const BUTTON_QUIET =
   'inline-flex h-control items-center justify-center px-4 text-control gap-2 rounded hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary bg-surface shadow-card';

function isAccepted(file: File): boolean {
  const name = file.name.toLowerCase();
  return ACCEPTED.some((extension) => name.endsWith(extension));
}

/**
 * A recinto a timetable file may be for — 02-11-2026. A pool's id is the
 * pool's (its lanes are what a file names); another sport's recinto is listed
 * and not choosable (`bookable` false) until its units exist (POOLSE-123).
 */
export interface ImportRecinto {
  id: string;
  name: string;
  sportId: PoolseSport;
  facilityId: string;
  facilityName: string;
  bookable: boolean;
}

export function TimetableImport({
  pools,
  canManage,
  compact = false,
}: {
  /**
   * Every live pool, with its site (Rui, 02-11-2026): a timetable file is one
   * tank's, so the import asks which, and "Pista 2" then means that pool's lane
   * 2 — never whichever pool at the site happens to have one.
   */
  pools: ImportRecinto[];
  canManage: boolean;
  /** In the page header, where there is no room for the hint beside it — 9.0. */
  compact?: boolean;
}): React.ReactElement | null {
  const t = useTranslations();
  const toast = useToast();

  const [open, setOpen] = useState(false);
  /** The dropped file waiting for a yes or a no. */
  const [pending, setPending] = useState<File | null>(null);
  /*
   * Which recinto — always asked (Rui, 02-11-2026: "obrigar" a choice), never
   * remembered or guessed, so a file never lands in a tank nobody picked. A
   * club with one recinto has nothing to choose.
   */
  const [poolId, setPoolId] = useState(pools.length === 1 && pools[0]!.bookable ? pools[0]!.id : '');
  const facilityId = pools.find((pool) => pool.id === poolId)?.facilityId ?? '';
  const multiSite = new Set(pools.map((pool) => pool.facilityId)).size > 1;
  const multiSport = new Set(pools.map((pool) => pool.sportId)).size > 1;
  const poolOptions = [
    ...(pools.length === 1 && pools[0]!.bookable ? [] : [{ value: '', label: t('timetableImport.choosePool'), disabled: true }]),
    ...pools.map((pool) => ({
      value: pool.id,
      label: [
        multiSport ? t(sportNameKey(pool.sportId)) : null,
        multiSite ? pool.facilityName : null,
        pool.bookable ? pool.name : t('timetableImport.notYet', { name: pool.name }),
      ]
        .filter((part) => part !== null)
        .join(' · '),
      disabled: !pool.bookable,
    })),
  ];
  const poolPicker = (
    <SelectField
      name="poolId"
      label={multiSport ? t('timetableImport.recinto') : t('timetableImport.pool')}
      hint={multiSport ? t('timetableImport.recintoHint') : t('timetableImport.poolHint')}
      initial={poolId}
      options={poolOptions}
      onValueChange={setPoolId}
    />
  );
  const readButton = useRef<HTMLButtonElement | null>(null);

  const onFile = useCallback((file: File) => setPending(file), []);
  const { dragging } = useFileDrop(onFile);

  const [read, readAction, readPending] = useActionState(readTimetableAction, { ok: false, attempt: 0 });
  // A PDF goes to the model and takes seconds: the corner says so, and so does the button (11-11-2026).
  // Reading and checking wash the page and this dialog, so the wait is seen and not clicked through.
  useBusyWhile(readPending, 'load', 'navigate');
  const [other, otherAction] = useActionState(readOtherSheetAction, { ok: false, attempt: 0 });
  const [run, runAction, running] = useActionState(runTimetableImportAction, {
    ok: false,
    attempt: 0,
  });
  useBusyWhile(running, 'load', 'navigate');

  /** Rows the operator has dropped in the dialog — decision 2's only verb. */
  const [dropped, setDropped] = useState<number[]>([]);
  const [extending, setExtending] = useState(false);

  // A switched sheet counts only for the file it was switched on.
  const otherIsCurrent = other.fromFile === read.attempt;
  const reading = (other.ok && otherIsCurrent ? other.reading : undefined) ?? read.reading;
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
  }, [read.attempt, other.attempt]);

  /*
   * Reading a file always opens the panel; the drop is how most people will.
   * A refusal opens it too (Rui, 11-11-2026): a dropped PDF with the reader off
   * was refused into a closed dialog, and nothing at all appeared.
   */
  useEffect(() => {
    if (read.attempt > 0) setOpen(true);
  }, [read.attempt]);

  /** Check again with these rows left out, or import with them left out — one request. */
  const recheck = (drop: number[], commit: boolean): void => {
    setDropped(drop);
    const data = new FormData();
    data.set('facilityId', facilityId);
    data.set('poolId', poolId);
    data.set('rows', JSON.stringify(candidates));
    data.set('settings', JSON.stringify({ commit, drop }));
    startTransition(() => runAction(data));
  };

  /** *Alargar o horário*, then check again: the rows it held back come in. */
  const extendHours = async (): Promise<void> => {
    const needed = run.result?.hoursNeeded ?? [];
    if (needed.length === 0) return;
    setExtending(true);
    const answer = await extendHoursAction(facilityId, needed);
    setExtending(false);
    if (!answer.ok) {
      toast.show('danger', t(answer.errorKey ?? 'facilities.hoursSaveFailed'));
      return;
    }
    recheck(dropped, false);
  };
  useBusyWhile(extending, 'save');

  if (!canManage) return null;

  const blocked = result === undefined ? 0 : result.summary.blocked + result.summary.refused;
  const held = blocked;

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
        {/*
          The hint stays out of the page header — round 5, ticket 9.0.

          It earned its place beside the button when both sat above the grid
          with room to spare. In the header it would push the title, and the
          same sentence is the first thing the panel says when it opens, so
          nothing is lost by holding it until then.
        */}
        {!open && !compact && (
          <span className="text-sm text-foreground-muted">{t('timetableImport.hint')}</span>
        )}
      </div>

      {/*
        The confirmation a drop gets before anything is read — the same rule the
        register's importer set. Files are dragged by accident.
      */}
      <Dialog
        open={pending !== null}
        onClose={() => setPending(null)}
        title={t('timetableImport.confirmTitle')}
        closeLabel={t('common.close')}
        initialFocus={readButton}
        className="max-w-md"
      >
        {pending !== null && (
          <div className="flex flex-col gap-4">
            <p className="flex items-start gap-2 break-all text-sm text-foreground-muted">
              <FileSpreadsheet aria-hidden className="mt-0.5 size-4 shrink-0" />
              {pending.name}
            </p>

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
                className="flex flex-col gap-3"
              >
                {poolPicker}
                <div className="flex flex-wrap gap-3">
                <button ref={readButton} type="submit" disabled={poolId === ''} className={BUTTON}>
                  {t('timetableImport.confirmRead')}
                </button>
                <button type="button" onClick={() => setPending(null)} className={BUTTON_QUIET}>
                  {t('common.cancel')}
                </button>
                </div>
              </form>
            )}
          </div>
        )}
      </Dialog>

      {/*
        A dialog, not a panel in the header — Rui, 02-11-2026: opened inside the
        page header it spilled off the right edge and cut its own text. A bottom
        sheet on a phone. The clash and drop questions open over it; only the
        topmost dialog answers the keyboard.
      */}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t('timetableImport.title')}
        description={t('timetableImport.subtitle')}
        closeLabel={t('common.close')}
        placement="sheet"
        className="md:max-w-3xl"
      >
        <div className="flex flex-col gap-4">

          {/* Step zero — which pool (02-11-2026): the file's lanes are this pool's. */}
          <div className="max-w-md">{poolPicker}</div>

          {/* Step one — the file. */}
          {/*
            onSubmit, not action (11-11-2026): a form action resets the form, which
            emptied the file box after every read — it said "no file chosen" beside
            a result, and Ler again was refused as a missing field.
          */}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              startTransition(() => readAction(data));
            }}
            className="flex flex-wrap items-center gap-3"
          >
            <input
              type="file"
              name="file"
              aria-label={t('timetableImport.file')}
              accept={ACCEPTED.join(',')}
              required
              className="text-sm file:mr-3 file:rounded file:border file:border-border file:bg-surface-muted file:px-3 file:py-1.5 file:text-sm"
            />
            <button type="submit" disabled={poolId === '' || readPending} aria-busy={readPending} className={BUTTON_QUIET}>
              {readPending ? t('timetableImport.reading') : t('timetableImport.read')}
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
              <input type="hidden" name="fileAttempt" value={read.attempt} />
              {/* Controlled, and remounted per file so it starts on that file's first tab. */}
              <SelectField
                key={read.attempt}
                name="sheet"
                label={t('timetableImport.sheet')}
                initial={read.sheets[0] === undefined ? '' : JSON.stringify(read.sheets[0])}
                options={read.sheets.map((sheet) => ({
                  value: JSON.stringify(sheet),
                  label: sheet.name,
                }))}
              />
              <button type="submit" className={BUTTON_QUIET}>
                {t('timetableImport.readSheet')}
              </button>
            </form>
          )}

          {otherIsCurrent && other.errorKey !== undefined && (
            <p role="alert" className="text-sm text-danger">
              {t(other.errorKey)}
            </p>
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
                    {read.fileName !== undefined && read.fileName !== '' && (
                      <span className="font-medium text-foreground">{read.fileName}: </span>
                    )}
                    {t('timetableImport.found', {
                      days: reading.days.length,
                      bookings: candidates.length,
                    })}
                  </p>

                  {/*
                    Why nothing can be checked, in words (11-11-2026): "0 marcações"
                    beside a greyed button said that something failed, not what.
                  */}
                  {candidates.length === 0 && (
                    <p role="alert" className="text-sm text-danger">
                      {reading.timeColumn === null
                        ? t('timetableImport.noTimes', {
                            days: reading.days.map((day) => day.heading).join(', '),
                          })
                        : t('timetableImport.noBookings')}
                    </p>
                  )}

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
                      data.set('poolId', poolId);
                      data.set('rows', JSON.stringify(candidates));
                      data.set('settings', JSON.stringify({ commit: false, drop: dropped }));
                      runAction(data);
                    }}
                  >
                    <button type="submit" disabled={running || candidates.length === 0 || poolId === ''} className={BUTTON}>
                      {t('timetableImport.check')}
                    </button>
                    {poolId === '' && (
                      <p className="mt-2 text-sm text-foreground-muted">{t('timetableImport.poolRequired')}</p>
                    )}
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

                  {/*
                    By cause, one action each (Rui, 11-11-2026), instead of a card per row.
                    The commit shows once nothing is held back; *Importar as N sem
                    conflito* is the one-click way there.
                  */}
                  <ConflictGroups
                    rows={result.rows}
                    dropped={dropped}
                    hoursNeeded={result.hoursNeeded ?? []}
                    working={running || extending}
                    onDrop={(indexes) => recheck([...new Set([...dropped, ...indexes])], false)}
                    onKeep={(indexes) => recheck(dropped.filter((one) => !indexes.includes(one)), false)}
                    onExtendHours={() => void extendHours()}
                    onImportClean={(indexes) => recheck([...new Set([...dropped, ...indexes])], true)}
                  />
                  {held > 0 ? null : (
                    <form
                      action={(data) => {
                        data.set('facilityId', facilityId);
                        data.set('poolId', poolId);
                        data.set('rows', JSON.stringify(candidates));
                        data.set('settings', JSON.stringify({ commit: true, drop: dropped }));
                        runAction(data);
                      }}
                    >
                      <button type="submit" disabled={running || poolId === ''} className={BUTTON}>
                        {t('timetableImport.commit', { count: result.summary.importable })}
                      </button>
                    </form>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </Dialog>

    </>
  );
}
