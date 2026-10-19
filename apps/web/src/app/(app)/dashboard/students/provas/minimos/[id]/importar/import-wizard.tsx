'use client';

import { useActionState, useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { AlertTriangle, Check, CircleHelp, Upload } from 'lucide-react';
import { formatSwimTime } from '@poolse/rules';
import { CONTROL_LINE, FIELD_COLUMN, FIELD_LABEL } from '@/components/ui/field';
import type { FederationAgeGroup } from '@/lib/api';
import { canImport, exportHeader, groupField, type QualifyingMapping } from '@/lib/qualifying-sheet';
import type { Sheet } from '@/lib/sheet';
import { useImportWizard, type ImportStage } from '@/lib/use-import-wizard';
import { cn } from '@/lib/utils';
import {
  matchSheetAction,
  readSheetAction,
  runImportAction,
  type ImportPreviewCell,
  type MatchState,
  type ReadState,
  type RunState,
} from './import.actions';

/**
 * Importing a standard's entry times — POOLSE-85, slice 2.
 *
 * The FPN's table as published: one row per event, one column per age group and
 * gender (Rui, 19-10-2026). The operator says which pool length the file is, the
 * columns are matched to the season's groups — a heading with no gender is asked,
 * never guessed — and the preview says, cell by cell, what is new, what changes
 * and from what, and what is refused and why. The commit is all or nothing.
 */

const READ_INITIAL: ReadState = { ok: false, attempt: 0 };
const RUN_INITIAL: RunState = { ok: false, attempt: 0 };
const MATCH_INITIAL: MatchState = { attempt: 0 };

const BUTTON =
  'inline-flex h-control items-center justify-center gap-2 rounded bg-primary px-4 text-control text-primary-foreground disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
const BUTTON_QUIET =
  'inline-flex h-control items-center justify-center gap-2 rounded border border-border px-4 text-control hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

type Course = 'scm' | 'lcm';

function Problem({ errorKey, detail }: { errorKey?: string | undefined; detail?: string | undefined }): React.ReactElement | null {
  const t = useTranslations();
  if (errorKey === undefined) return null;
  return (
    <p role="alert" className="flex items-start gap-2 text-sm text-danger">
      <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>
        {t(errorKey)}
        {detail !== undefined && detail !== '' && (
          <span className="ml-2 font-mono text-xs text-foreground-muted">{detail}</span>
        )}
      </span>
    </p>
  );
}

export function QualifyingImportWizard({
  standardId,
  ageGroups,
}: {
  standardId: string;
  ageGroups: FederationAgeGroup[];
}): React.ReactElement {
  const t = useTranslations();
  const [readState, readAction, reading] = useActionState(readSheetAction, READ_INITIAL);
  const [runState, runAction, running] = useActionState(runImportAction, RUN_INITIAL);
  const [matchState, matchAction, matching] = useActionState(matchSheetAction, MATCH_INITIAL);
  const [course, setCourse] = useState<Course>('lcm');

  const empty = useMemo(() => {
    const mapping: QualifyingMapping = { event: null, distance: null, stroke: null };
    for (const group of ageGroups) mapping[groupField(group.id)] = null;
    return mapping;
  }, [ageGroups]);

  const wizard = useImportWizard<string, ImportPreviewCell>({
    empty,
    initialFile: null,
    readState,
    readAction,
    matchState,
    // The shared machine posts only the sheet; the matcher also needs to know whose groups.
    matchAction: (formData) => {
      formData.set('standardId', standardId);
      matchAction(formData);
    },
    runState,
  });
  const { stage, sheet, mapping } = wizard;

  return (
    <div className="flex flex-col gap-5">
      <Steps stage={stage} />

      {stage === 'upload' && (
        <section className="rounded border border-border bg-surface p-5">
          <form action={readAction} className="flex flex-col gap-4">
            <input type="hidden" name="standardId" value={standardId} />
            <div className={cn(FIELD_COLUMN, 'max-w-form')}>
              <label htmlFor="qualifying-import-file" className={FIELD_LABEL}>
                {t('students.import.fileLabel')}
              </label>
              <input
                id="qualifying-import-file"
                name="file"
                type="file"
                required
                accept=".xlsx,.csv,.pdf,text/csv,application/pdf"
                className={cn(
                  CONTROL_LINE,
                  'py-1.5 file:mr-3 file:rounded file:border-0 file:bg-surface-muted file:px-3 file:py-1 file:text-sm file:text-foreground',
                )}
              />
              <p className="text-sm text-foreground-muted">{t('qualifying.import.fileHint')}</p>
            </div>
            <CourseChoice course={course} onCourse={setCourse} />
            <Problem errorKey={readState.errorKey} />
            <button type="submit" disabled={reading} className={cn(BUTTON, 'self-start')}>
              <Upload aria-hidden className="size-4" />
              {reading ? t('students.import.reading') : t('students.import.read')}
            </button>
          </form>
        </section>
      )}

      {stage === 'map' && sheet !== null && mapping !== null && (
        <form action={runAction} className="flex flex-col gap-5 rounded border border-border bg-surface p-5">
          <RequestFields standardId={standardId} sheet={sheet} mapping={mapping} course={course} commit={false} />
          <div>
            <h2 className="font-medium">{t('students.import.mapTitle')}</h2>
            <p className="mt-1 text-sm text-foreground-muted">
              {t('students.import.mapHint', { file: wizard.fileName, rows: sheet.rows.length })}
            </p>
          </div>

          {wizard.sheets.length > 1 && (
            <div className={cn(FIELD_COLUMN, 'max-w-form')}>
              <label htmlFor="qualifying-import-sheet" className={FIELD_LABEL}>
                {t('students.import.sheetLabel')}
              </label>
              <select
                id="qualifying-import-sheet"
                value={String(wizard.sheetIndex)}
                onChange={(event) => wizard.chooseSheet(Number(event.target.value))}
                className={CONTROL_LINE}
              >
                {wizard.sheets.map((candidate, index) => (
                  <option key={candidate.name} value={String(index)}>
                    {t('students.import.sheetOption', { name: candidate.name, rows: candidate.rows.length })}
                  </option>
                ))}
              </select>
            </div>
          )}

          <CourseChoice course={course} onCourse={setCourse} />

          {matching ? (
            <p className="text-sm text-foreground-muted">{t('students.import.matching')}</p>
          ) : (
            <ColumnList
              sheet={sheet}
              mapping={mapping}
              onMapping={wizard.setMapping}
              unsure={(wizard.match?.matches ?? []).filter((m) => m.confidence === 'unsure').map((m) => m.column)}
              ageGroups={ageGroups}
            />
          )}

          {!canImport(mapping) && (
            <p className="flex items-start gap-2 text-sm text-danger">
              <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
              {t('qualifying.import.needEventAndGroup')}
            </p>
          )}

          <Problem errorKey={runState.errorKey} detail={runState.detail} />

          <div className="flex flex-wrap gap-3">
            <button type="submit" disabled={running || matching || !canImport(mapping)} className={BUTTON}>
              {running ? t('students.import.checking') : t('students.import.check')}
            </button>
            <button type="button" onClick={wizard.restart} className={BUTTON_QUIET}>
              {t('students.import.chooseAnother')}
            </button>
          </div>
        </form>
      )}

      {stage === 'preview' && sheet !== null && mapping !== null && (
        <form action={runAction} className="flex flex-col gap-5 rounded border border-border bg-surface p-5">
          <RequestFields standardId={standardId} sheet={sheet} mapping={mapping} course={course} commit />
          <Preview cells={wizard.rows} summary={runState.summary} course={course} ageGroups={ageGroups} />
          <Problem errorKey={runState.errorKey} detail={runState.detail} />
          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              disabled={running || (runState.summary?.new ?? 0) + (runState.summary?.changed ?? 0) === 0}
              className={BUTTON}
            >
              {running
                ? t('common.working')
                : (runState.summary?.new ?? 0) + (runState.summary?.changed ?? 0) === 0
                  ? t('qualifying.import.nothingNew')
                  : t('qualifying.import.commit', {
                      count: (runState.summary?.new ?? 0) + (runState.summary?.changed ?? 0),
                    })}
            </button>
            <button type="button" onClick={() => wizard.setStage('map')} className={BUTTON_QUIET}>
              {t('qualifying.import.back')}
            </button>
          </div>
        </form>
      )}

      {stage === 'done' && (
        <section className="flex flex-col items-start gap-3 rounded border border-border bg-surface p-5">
          <p className="flex items-center gap-2 font-medium">
            <Check aria-hidden className="size-5 text-primary" />
            {t('qualifying.import.done', { added: wizard.created, changed: wizard.updated })}
          </p>
          <Link href={`/dashboard/students/provas/minimos/${standardId}?tab=times`} className={BUTTON}>
            {t('qualifying.import.toTimes')}
          </Link>
        </section>
      )}
    </div>
  );
}

function Steps({ stage }: { stage: ImportStage }): React.ReactElement {
  const t = useTranslations();
  const order: ImportStage[] = ['upload', 'map', 'preview', 'done'];
  const at = order.indexOf(stage);
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      {order.map((step, index) => (
        <li key={step} className="flex items-center gap-2">
          {index > 0 && (
            <span aria-hidden className="text-foreground-muted">
              →
            </span>
          )}
          <span
            aria-current={index === at ? 'step' : undefined}
            className={cn(index === at ? 'font-medium text-foreground' : 'text-foreground-muted')}
          >
            {index + 1}. {t(`students.import.step.${step}`)}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** The pool length the whole file is — said once, because the FPN publishes the two apart. */
function CourseChoice({ course, onCourse }: { course: Course; onCourse: (course: Course) => void }): React.ReactElement {
  const t = useTranslations();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className={FIELD_LABEL}>{t('qualifying.import.course')}</legend>
      <div className="flex flex-wrap gap-4">
        {(['lcm', 'scm'] as const).map((value) => (
          <label key={value} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="course-choice"
              value={value}
              checked={course === value}
              onChange={() => onCourse(value)}
              className="size-4"
            />
            {t(`progress.course.${value}`)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function RequestFields({
  standardId,
  sheet,
  mapping,
  course,
  commit,
}: {
  standardId: string;
  sheet: Sheet;
  mapping: QualifyingMapping;
  course: Course;
  commit: boolean;
}): React.ReactElement {
  const rows = useMemo(() => JSON.stringify(sheet.rows), [sheet]);
  return (
    <>
      <input type="hidden" name="standardId" value={standardId} />
      <input type="hidden" name="rows" value={rows} />
      <input type="hidden" name="settings" value={JSON.stringify({ mapping, course, commit })} />
    </>
  );
}

/**
 * Every column with a heading, as "what is this column?" — the question a person
 * holding the spreadsheet can answer. A column the matcher was unsure of is
 * marked, in words and with an icon, and so is one nothing claimed.
 */
function ColumnList({
  sheet,
  mapping,
  onMapping,
  unsure,
  ageGroups,
}: {
  sheet: Sheet;
  mapping: QualifyingMapping;
  onMapping: (mapping: QualifyingMapping) => void;
  unsure: number[];
  ageGroups: FederationAgeGroup[];
}): React.ReactElement {
  const t = useTranslations();
  const options = [
    { value: '', label: t('students.import.notImported') },
    { value: 'event', label: t('qualifying.field.event') },
    { value: 'distance', label: t('qualifying.field.distance') },
    { value: 'stroke', label: t('qualifying.field.stroke') },
    ...ageGroups.map((group) => ({ value: groupField(group.id), label: exportHeader(group) })),
  ];
  const fieldAt = (column: number): string =>
    Object.entries(mapping).find(([, at]) => at === column)?.[0] ?? '';
  const choose = (column: number, field: string): void => {
    const next: QualifyingMapping = { ...mapping };
    for (const key of Object.keys(next)) if (next[key] === column) next[key] = null;
    if (field !== '') next[field] = column;
    onMapping(next);
  };

  return (
    <ul className="flex flex-col divide-y divide-border">
      {sheet.headers.map((header, column) => {
        if (header === '') return null;
        const sample = sheet.rows.find((row) => (row[column] ?? '').trim() !== '')?.[column] ?? '';
        const chosen = fieldAt(column);
        const doubtful = unsure.includes(column) || chosen === '';
        return (
          <li key={column} className="grid grid-cols-1 items-center gap-2 py-3 sm:grid-cols-[1fr_16rem]">
            <div className="flex flex-col gap-0.5">
              <label htmlFor={`qualifying-column-${column}`} className="font-medium">
                {header}
              </label>
              <span className="text-sm text-foreground-muted">
                {sample === '' ? t('students.import.sampleNone') : t('students.import.sample', { value: sample })}
              </span>
              {doubtful && (
                <span className="flex items-center gap-1.5 text-sm text-warning">
                  <CircleHelp aria-hidden className="size-4" />
                  {chosen === '' ? t('qualifying.import.unmatched') : t('qualifying.import.confirm')}
                </span>
              )}
            </div>
            <select
              id={`qualifying-column-${column}`}
              value={chosen}
              onChange={(event) => choose(column, event.target.value)}
              className={CONTROL_LINE}
            >
              {options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </li>
        );
      })}
    </ul>
  );
}

function Preview({
  cells,
  summary,
  course,
  ageGroups,
}: {
  cells: ImportPreviewCell[];
  summary: RunState['summary'];
  course: Course;
  ageGroups: FederationAgeGroup[];
}): React.ReactElement {
  const t = useTranslations();
  const [showUnchanged, setShowUnchanged] = useState(false);
  const shown = cells.filter((cell) => showUnchanged || cell.status !== 'unchanged');

  return (
    <>
      <div className="flex flex-col gap-1">
        <h2 className="font-medium">{t('qualifying.import.previewTitle', { course: t(`progress.course.${course}`) })}</h2>
        <p className="text-sm">
          {t('qualifying.import.summary', {
            added: summary?.new ?? 0,
            changed: summary?.changed ?? 0,
            unchanged: summary?.unchanged ?? 0,
            refused: summary?.refused ?? 0,
          })}
        </p>
        <p className="text-sm text-foreground-muted">{t('qualifying.import.emptyKept')}</p>
      </div>
      {(summary?.unchanged ?? 0) > 0 && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showUnchanged}
            onChange={(event) => setShowUnchanged(event.target.checked)}
            className="size-4"
          />
          {t('qualifying.import.showUnchanged')}
        </label>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-foreground-muted">
              <th scope="col" className="py-2 pr-4 font-normal">{t('qualifying.import.row')}</th>
              <th scope="col" className="py-2 pr-4 font-normal">{t('qualifying.event')}</th>
              <th scope="col" className="py-2 pr-4 font-normal">{t('qualifying.import.ageGroup')}</th>
              <th scope="col" className="py-2 pr-4 font-normal">{t('qualifying.entryTime')}</th>
              <th scope="col" className="py-2 font-normal">{t('qualifying.import.status')}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((cell) => (
              <tr key={cell.index} className="border-b border-border align-top last:border-0">
                <td className="py-2 pr-4 tabular-nums text-foreground-muted">{cell.row + 2}</td>
                <td className="py-2 pr-4">
                  {cell.stroke !== null && cell.distanceM !== null
                    ? t('qualifying.eventName', {
                        distance: cell.distanceM,
                        stroke: t(`progress.strokes.${cell.stroke}`),
                      })
                    : cell.eventLabel}
                </td>
                <td className="py-2 pr-4">
                  {(() => {
                    // Name and gender: two Juvenis columns must not read alike.
                    const group = ageGroups.find((entry) => entry.id === cell.ageGroupId);
                    return group === undefined ? (cell.ageGroup ?? '—') : exportHeader(group);
                  })()}
                </td>
                <td className="py-2 pr-4 font-mono">{cell.timeMs === null ? cell.time : formatSwimTime(cell.timeMs)}</td>
                <td className="py-2">
                  <Status cell={cell} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Status({ cell }: { cell: ImportPreviewCell }): React.ReactElement {
  const t = useTranslations();
  if (cell.status === 'refused') {
    return (
      <span className="flex items-start gap-1.5 text-danger">
        <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
        {t(`qualifying.import.refused.${cell.reason ?? 'event'}`)}
      </span>
    );
  }
  if (cell.status === 'changed') {
    return (
      <span>
        {t('qualifying.import.changed', { from: formatSwimTime(cell.previousMs ?? 0) })}
      </span>
    );
  }
  return (
    <span className={cell.status === 'unchanged' ? 'text-foreground-muted' : ''}>
      {t(`qualifying.import.${cell.status}`)}
    </span>
  );
}

