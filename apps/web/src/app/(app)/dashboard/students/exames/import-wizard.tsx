'use client';

import { useActionState, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, Check, CircleSlash, HelpCircle, ShieldAlert, Upload, XCircle } from 'lucide-react';
import { CONTROL_LINE, FIELD_COLUMN, FIELD_LABEL } from '@/components/ui/field';
import { cn } from '@/lib/utils';
import {
  EMPTY_EXAM_MAPPING,
  EXAM_FIELDS,
  hasExamKey,
  type ExamField,
  type ExamMapping,
} from '@/lib/exam-sheet';
import type { NamedSheet, Sheet } from '@/lib/sheet';
import { useImportWizard, type ImportStage } from '@/lib/use-import-wizard';
import {
  matchSheetAction,
  readSheetAction,
  runImportAction,
  type ExamPreviewRow,
  type ImportState,
  type MatchState,
  type ReadState,
} from './import.actions';

/**
 * The club's exames médicos from a spreadsheet, in four steps — POOLSE-133.
 *
 * The machine is `useImportWizard`; what is particular is the preview. A row
 * found by NIF is simply written. A row found by name and birth date is shown
 * with a tick box and written only if a person ticks it — never by name alone,
 * and never creating a student. A row the export wrote for a student with no
 * exam says so quietly, and an unchanged one too, so a round trip proposes
 * nothing and the commit button stays shut.
 */

const READ_INITIAL: ReadState = { ok: false, attempt: 0 };
const RUN_INITIAL: ImportState = { ok: false, attempt: 0 };
const MATCH_INITIAL: MatchState = { attempt: 0 };

const BUTTON =
  'inline-flex h-control items-center justify-center px-4 text-control gap-2 rounded bg-primary text-primary-foreground disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

const BUTTON_QUIET =
  'inline-flex h-control items-center justify-center px-4 text-control gap-2 rounded border border-border hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

function Problem({ errorKey, detail }: { errorKey?: string | undefined; detail?: string | undefined }): React.ReactElement | null {
  const t = useTranslations();
  if (errorKey === undefined) return null;
  return (
    <p className="flex items-start gap-2 rounded border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
      <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>
        {t(errorKey as never)}
        {detail !== undefined && detail !== '' && (
          <span className="ml-2 font-mono text-xs text-foreground-muted">{detail}</span>
        )}
      </span>
    </p>
  );
}

export function ExamImportWizard({
  initialFile = null,
  onClose,
}: {
  initialFile?: File | null;
  onClose?: (() => void) | undefined;
}): React.ReactElement {
  const t = useTranslations();
  const [readState, readAction, reading] = useActionState(readSheetAction, READ_INITIAL);
  const [runState, runAction, running] = useActionState(runImportAction, RUN_INITIAL);
  const [matchState, matchAction, matching] = useActionState(matchSheetAction, MATCH_INITIAL);

  const {
    stage,
    setStage,
    sheets,
    sheet,
    sheetIndex,
    chooseSheet,
    mapping,
    setMapping,
    rows,
    selected,
    setSelected,
    fileName,
    created,
    restart,
  } = useImportWizard<ExamField, ExamPreviewRow>({
    empty: EMPTY_EXAM_MAPPING,
    initialFile,
    readState,
    readAction,
    matchState,
    matchAction,
    runState,
  });

  return (
    <div className="flex flex-col gap-5">
      <Steps stage={stage} />

      <p className="flex items-start gap-2 rounded border border-border bg-surface-muted p-3 text-sm">
        <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
        {t('exams.import.matchedBy')}
      </p>

      {stage === 'upload' && (
        <section className="rounded border border-border bg-surface p-5">
          <form action={readAction} className="flex flex-col gap-4">
            <div className={cn(FIELD_COLUMN, 'max-w-form')}>
              <label htmlFor="exam-import-file" className={FIELD_LABEL}>
                {t('students.import.fileLabel')}
              </label>
              <input
                id="exam-import-file"
                name="file"
                type="file"
                required
                accept=".xlsx,.csv,.pdf,text/csv,application/pdf"
                className={cn(
                  CONTROL_LINE,
                  'py-1.5 file:mr-3 file:rounded file:border-0 file:bg-surface-muted file:px-3 file:py-1 file:text-sm file:text-foreground',
                )}
              />
              <p className="text-sm text-foreground-muted">{t('exams.import.fileHint')}</p>
            </div>
            <Problem errorKey={readState.errorKey} />
            <button type="submit" disabled={reading} className={cn(BUTTON, 'self-start')}>
              <Upload aria-hidden className="size-4" />
              {reading ? t('students.import.reading') : t('students.import.read')}
            </button>
          </form>
        </section>
      )}

      {stage === 'map' && sheet !== null && mapping !== null && (
        <MappingStep
          sheet={sheet}
          sheets={sheets}
          sheetIndex={sheetIndex}
          onSheet={chooseSheet}
          fileName={fileName}
          mapping={mapping}
          onMapping={setMapping}
          matching={matching}
          action={runAction}
          pending={running}
          state={runState}
          onRestart={restart}
        />
      )}

      {stage === 'preview' && sheet !== null && mapping !== null && (
        <PreviewStep
          rows={rows}
          selected={selected}
          onSelected={setSelected}
          sheet={sheet}
          mapping={mapping}
          action={runAction}
          pending={running}
          state={runState}
          onBack={() => setStage('map')}
        />
      )}

      {stage === 'done' && (
        <section className="flex flex-col items-start gap-3 rounded border border-border bg-surface p-5">
          <p className="flex items-center gap-2 font-medium">
            <Check aria-hidden className="size-5 text-primary" />
            {t('exams.import.doneCount', { count: created })}
          </p>
          {onClose !== undefined && (
            <button type="button" onClick={onClose} className={BUTTON}>
              {t('students.import.done')}
            </button>
          )}
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

function useRows(sheet: Sheet): string {
  return useMemo(() => JSON.stringify(sheet.rows), [sheet]);
}

function RequestFields({ rows, settings }: { rows: string; settings: string }): React.ReactElement {
  return (
    <>
      <input type="hidden" name="rows" value={rows} />
      <input type="hidden" name="settings" value={settings} />
    </>
  );
}

/** A column feeds one field and a field takes one column, so choosing one clears the other. */
function assign(mapping: ExamMapping, field: ExamField, column: number | null): ExamMapping {
  const next: ExamMapping = { ...mapping };
  if (column !== null) {
    for (const other of EXAM_FIELDS) {
      if (next[other] === column) next[other] = null;
    }
  }
  next[field] = column;
  return next;
}

function sampleOf(sheet: Sheet, column: number): string {
  const found = sheet.rows.find((row) => (row[column] ?? '').trim() !== '');
  return (found?.[column] ?? '').trim();
}

function MappingStep({
  sheet,
  sheets,
  sheetIndex,
  onSheet,
  fileName,
  mapping,
  onMapping,
  matching,
  action,
  pending,
  state,
  onRestart,
}: {
  sheet: Sheet;
  sheets: NamedSheet[];
  sheetIndex: number;
  onSheet: (index: number) => void;
  fileName: string;
  mapping: ExamMapping;
  onMapping: (mapping: ExamMapping) => void;
  matching: boolean;
  action: (formData: FormData) => void;
  pending: boolean;
  state: ImportState;
  onRestart: () => void;
}): React.ReactElement {
  const t = useTranslations();
  const rows = useRows(sheet);
  const ready = hasExamKey(mapping);

  const columns = sheet.headers.map((header, index) => ({
    value: String(index),
    label: header === '' ? t('students.import.columnUnnamed', { number: index + 1 }) : header,
  }));

  return (
    <form action={action} className="flex flex-col gap-5 rounded border border-border bg-surface p-5">
      <RequestFields rows={rows} settings={JSON.stringify({ mapping, commit: false, confirmed: [] })} />

      <div>
        <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
          {t('students.import.mapTitle')}
        </h2>
        <p className="mt-1 text-sm text-foreground-muted">
          {t('students.import.mapHint', { file: fileName, rows: sheet.rows.length })}
        </p>
      </div>

      {sheets.length > 1 && (
        <div className={cn(FIELD_COLUMN, 'max-w-form')}>
          <label htmlFor="exam-map-sheet" className={FIELD_LABEL}>
            {t('students.import.sheetLabel')}
          </label>
          <select
            id="exam-map-sheet"
            value={String(sheetIndex)}
            onChange={(event) => onSheet(Number(event.target.value))}
            className={CONTROL_LINE}
          >
            {sheets.map((candidate, index) => (
              <option key={candidate.name} value={String(index)}>
                {t('students.import.sheetOption', { name: candidate.name, rows: candidate.rows.length })}
              </option>
            ))}
          </select>
        </div>
      )}

      {matching && <p className="text-sm text-foreground-muted">{t('students.import.matching')}</p>}

      {/* Six fields: all shown, each with the column it reads and a sample. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {EXAM_FIELDS.map((field) => (
          <div key={field} className={cn(FIELD_COLUMN, 'max-w-none')}>
            <label htmlFor={`exam-map-${field}`} className={FIELD_LABEL}>
              {t(`exams.field.${field}`)}
            </label>
            <select
              id={`exam-map-${field}`}
              value={mapping[field] === null ? '' : String(mapping[field])}
              onChange={(event) =>
                onMapping(assign(mapping, field, event.target.value === '' ? null : Number(event.target.value)))
              }
              className={CONTROL_LINE}
            >
              <option value="">{t('students.import.notImported')}</option>
              {columns.map((column) => (
                <option key={column.value} value={column.value}>
                  {column.label}
                </option>
              ))}
            </select>
            <p className="text-sm text-foreground-muted">
              {mapping[field] === null
                ? t('students.import.sampleNone')
                : t('students.import.sample', { value: sampleOf(sheet, mapping[field] ?? 0) })}
            </p>
          </div>
        ))}
      </div>

      {!ready && (
        <p className="flex items-start gap-2 text-sm text-danger">
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
          {t('exams.import.keyRequired')}
        </p>
      )}

      <Problem errorKey={state.errorKey} detail={state.detail} />

      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={pending || matching || !ready} className={BUTTON}>
          {pending ? t('students.import.checking') : t('students.import.check')}
        </button>
        <button type="button" onClick={onRestart} className={BUTTON_QUIET}>
          {t('students.import.chooseAnother')}
        </button>
      </div>
    </form>
  );
}

function RowStatus({ row }: { row: ExamPreviewRow }): React.ReactElement {
  const t = useTranslations();
  if (row.blank) {
    return (
      <span className="flex items-center gap-1.5 text-foreground-muted">
        <CircleSlash aria-hidden className="size-4 shrink-0" />
        {t('exams.import.status.blank')}
      </span>
    );
  }
  switch (row.status) {
    case 'new':
      return (
        <span className="flex items-center gap-1.5 text-primary">
          <Check aria-hidden className="size-4 shrink-0" />
          {t('exams.import.status.new')}
        </span>
      );
    case 'unchanged':
      return (
        <span className="flex items-center gap-1.5 text-foreground-muted">
          <Check aria-hidden className="size-4 shrink-0" />
          {t('exams.import.status.unchanged')}
        </span>
      );
    case 'needs_confirmation':
      return (
        <span className="flex items-center gap-1.5 text-warning">
          <HelpCircle aria-hidden className="size-4 shrink-0" />
          {t('exams.import.status.needsConfirmation')}
        </span>
      );
    default:
      return (
        <span className="flex items-center gap-1.5 text-danger">
          <XCircle aria-hidden className="size-4 shrink-0" />
          {t((row.reason ?? 'exams.import.reason.incomplete') as never)}
        </span>
      );
  }
}

function PreviewStep({
  rows,
  selected,
  onSelected,
  sheet,
  mapping,
  action,
  pending,
  state,
  onBack,
}: {
  rows: ExamPreviewRow[];
  selected: Set<number>;
  onSelected: (selected: Set<number>) => void;
  sheet: Sheet;
  mapping: ExamMapping;
  action: (formData: FormData) => void;
  pending: boolean;
  state: ImportState;
  onBack: () => void;
}): React.ReactElement {
  const t = useTranslations();
  const sheetRows = useRows(sheet);
  const nameAt = mapping.studentName;

  const count = (status: ExamPreviewRow['status']): number =>
    rows.filter((row) => !row.blank && row.status === status).length;
  const fresh = count('new');
  const toConfirm = count('needs_confirmation');
  const refused = rows.filter((row) => !row.blank && (row.status === 'no_match' || row.status === 'invalid')).length;
  const blank = rows.filter((row) => row.blank).length;
  const writes = fresh + selected.size;

  const toggle = (index: number): void => {
    const next = new Set(selected);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    onSelected(next);
  };

  return (
    <form action={action} className="flex flex-col gap-5 rounded border border-border bg-surface p-5">
      <RequestFields
        rows={sheetRows}
        settings={JSON.stringify({ mapping, commit: true, confirmed: [...selected] })}
      />

      <p className="text-sm text-foreground-muted">
        {t('exams.import.summary', {
          total: rows.length,
          fresh,
          confirm: toConfirm,
          unchanged: count('unchanged'),
          refused,
          blank,
        })}
      </p>

      {toConfirm > 0 && <p className="text-sm">{t('exams.import.confirmHint')}</p>}

      <div className="relative overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-foreground-muted">
              <th scope="col" className="px-2 py-2 font-medium">
                <span className="sr-only">{t('exams.import.confirm')}</span>
              </th>
              <th scope="col" className="px-2 py-2 font-medium">#</th>
              <th scope="col" className="px-2 py-2 font-medium">{t('exams.import.inFile')}</th>
              <th scope="col" className="px-2 py-2 font-medium">{t('exams.import.matchedTo')}</th>
              <th scope="col" className="px-2 py-2 font-medium">{t('exams.import.state')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const sheetName = nameAt === null ? '' : (sheet.rows[row.index]?.[nameAt] ?? '').trim();
              return (
                <tr key={row.index} className="border-b border-border/60 align-top last:border-0">
                  <td className="px-2 py-2">
                    {row.importable && !row.blank && (
                      <input
                        type="checkbox"
                        checked={selected.has(row.index)}
                        onChange={() => toggle(row.index)}
                        aria-label={t('exams.import.confirmLine', { line: row.line })}
                        className="size-4 accent-primary"
                      />
                    )}
                  </td>
                  <td className="px-2 py-2 tabular-nums text-foreground-muted">{row.line}</td>
                  <td className="px-2 py-2">{sheetName === '' ? '—' : sheetName}</td>
                  <td className="px-2 py-2 font-medium">{row.studentName ?? '—'}</td>
                  <td className="px-2 py-2">
                    <RowStatus row={row} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Problem errorKey={state.errorKey} detail={state.detail} />

      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={pending || writes === 0} className={BUTTON}>
          {pending ? t('students.import.importing') : t('exams.import.commit', { count: writes })}
        </button>
        <button type="button" onClick={onBack} className={BUTTON_QUIET}>
          {t('students.import.backToMapping')}
        </button>
      </div>
    </form>
  );
}
