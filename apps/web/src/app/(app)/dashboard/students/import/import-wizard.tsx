'use client';

import { useActionState, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { AlertTriangle, Check, Copy, Upload } from 'lucide-react';
import { CONTROL_LINE, FIELD_COLUMN, FIELD_LABEL } from '@/components/ui/field';
import { cn } from '@/lib/utils';
import type { ImportRowResult, StudentLevel } from '@/lib/api';
import { IMPORT_FIELDS, type ImportField, type Mapping, type Sheet } from '@/lib/sheet';
import { readSheetAction, runImportAction, type ImportState, type ReadState } from './import.actions';

/**
 * Slice 1.10 — the import, in four steps.
 *
 * The roadmap says this deserves more time than it looks like it needs, and the
 * reason is the middle two steps. A file that goes straight from "chosen" to
 * "imported" is a feature nobody trusts twice: the first bad row teaches the
 * operator that the button is a gamble.
 *
 *   ficheiro → mapeamento → pré-visualização → importar
 *
 * Two rules shape the whole screen:
 *
 * - **Nothing is written until the last step**, and the step before it shows
 *   every row exactly as it will be saved — the resolved date, the matched
 *   level, the guardian. What is approved is what lands.
 * - **A problem and a duplicate are different things.** A problem refuses the
 *   row, on the server, whatever this screen ticks. A duplicate is a warning
 *   that unticks itself and can be ticked back — a club really does have two
 *   children with the same name and birthday sometimes, and only the operator
 *   knows.
 */

const READ_INITIAL: ReadState = { ok: false, attempt: 0 };
const RUN_INITIAL: ImportState = { ok: false, attempt: 0 };

type Stage = 'upload' | 'map' | 'preview' | 'done';

const BUTTON =
  'rounded bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50 ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

const BUTTON_QUIET =
  'rounded border border-border px-4 py-2 text-sm hover:bg-surface-muted ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/** The order the mapping step lists the fields in — the order a form asks for them. */
const FIELD_ORDER: ImportField[] = [
  'fullName',
  'firstName',
  'lastName',
  'birthDate',
  'levelName',
  'contactEmail',
  'contactPhone',
  'notes',
  'guardianName',
  'guardianRelationship',
  'guardianPhone',
  'guardianEmail',
  'guardianTaxNumber',
];

function Problem({ errorKey, detail }: { errorKey?: string; detail?: string }): React.ReactElement | null {
  const t = useTranslations();
  if (errorKey === undefined) return null;

  return (
    <p className="flex items-start gap-2 text-sm text-danger">
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

export function ImportWizard({ levels }: { levels: StudentLevel[] }): React.ReactElement {
  const t = useTranslations();

  const [readState, readAction, reading] = useActionState(readSheetAction, READ_INITIAL);
  const [runState, runAction, running] = useActionState(runImportAction, RUN_INITIAL);

  const [stage, setStage] = useState<Stage>('upload');
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [fileName, setFileName] = useState('');
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [relationship, setRelationship] = useState(t('students.import.defaultRelationship'));
  const [rows, setRows] = useState<ImportRowResult[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [created, setCreated] = useState(0);

  const readAt = useRef(0);
  const runAt = useRef(0);

  // A file arrived. Both effects key on `attempt` rather than on `ok`, so a
  // second upload of the same file still moves the wizard on.
  useEffect(() => {
    if (readState.attempt === readAt.current) return;
    readAt.current = readState.attempt;
    if (!readState.ok || readState.sheet === undefined || readState.mapping === undefined) return;

    setSheet(readState.sheet);
    setMapping(readState.mapping);
    setFileName(readState.fileName ?? '');
    setStage('map');
  }, [readState]);

  useEffect(() => {
    if (runState.attempt === runAt.current) return;
    runAt.current = runState.attempt;
    if (!runState.ok || runState.result === undefined) return;

    if (runState.committed === true) {
      setCreated(runState.result.created ?? 0);
      setStage('done');
      return;
    }

    setRows(runState.result.rows);
    /*
     * What is ticked when the preview opens: everything that can be written and
     * is not already somewhere. Unticking the duplicates is the default the
     * screen argues for and the one the API takes when a caller sends no
     * selection at all — the two agree on purpose.
     */
    setSelected(
      new Set(
        runState.result.rows
          .filter((row) => row.importable && row.duplicate === null)
          .map((row) => row.index),
      ),
    );
    setStage('preview');
  }, [runState]);

  const levelNames = levels.map((level) => level.name).join(', ');

  return (
    <div className="flex flex-col gap-5">
      <Steps stage={stage} />

      {stage === 'upload' && (
        <section className="rounded border border-border bg-surface p-5">
          <form action={readAction} className="flex flex-col gap-4">
            <div className={cn(FIELD_COLUMN, 'max-w-form')}>
              <label htmlFor="import-file" className={FIELD_LABEL}>
                {t('students.import.fileLabel')}
              </label>
              <input
                id="import-file"
                name="file"
                type="file"
                required
                accept=".xlsx,.csv,text/csv"
                className={cn(
                  CONTROL_LINE,
                  'py-1.5 file:mr-3 file:rounded file:border-0 file:bg-surface-muted file:px-3 file:py-1 file:text-sm file:text-foreground',
                )}
              />
              <p className="text-sm text-foreground-muted">{t('students.import.fileHint')}</p>
            </div>

            <Problem {...(readState.errorKey !== undefined ? { errorKey: readState.errorKey } : {})} />

            <button type="submit" disabled={reading} className={cn(BUTTON, 'self-start')}>
              <span className="flex items-center gap-2">
                <Upload aria-hidden className="size-4" />
                {reading ? t('students.import.reading') : t('students.import.read')}
              </span>
            </button>
          </form>
        </section>
      )}

      {stage === 'map' && sheet !== null && mapping !== null && (
        <MappingStep
          sheet={sheet}
          fileName={fileName}
          mapping={mapping}
          onMapping={setMapping}
          relationship={relationship}
          onRelationship={setRelationship}
          levelNames={levelNames}
          action={runAction}
          pending={running}
          state={runState}
          onRestart={() => {
            setSheet(null);
            setMapping(null);
            setStage('upload');
          }}
        />
      )}

      {stage === 'preview' && sheet !== null && mapping !== null && (
        <PreviewStep
          rows={rows}
          selected={selected}
          onSelected={setSelected}
          sheet={sheet}
          mapping={mapping}
          relationship={relationship}
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
            {t('students.import.doneCount', { count: created })}
          </p>
          <p className="text-sm text-foreground-muted">{t('students.import.doneHint')}</p>
          <Link href="/dashboard/students" className={BUTTON}>
            {t('students.import.toRegister')}
          </Link>
        </section>
      )}
    </div>
  );
}

/**
 * Where in the four steps this is.
 *
 * The current step is named in text as well as marked, because a coloured dot is
 * not a label — the same rule the rest of the app follows about colour never
 * carrying meaning on its own.
 */
function Steps({ stage }: { stage: Stage }): React.ReactElement {
  const t = useTranslations();
  const order: Stage[] = ['upload', 'map', 'preview', 'done'];
  const at = order.indexOf(stage);

  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      {order.map((step, index) => (
        <li key={step} className="flex items-center gap-2">
          {index > 0 && <span aria-hidden className="text-foreground-muted">→</span>}
          <span
            aria-current={index === at ? 'step' : undefined}
            className={cn(
              index === at && 'font-medium text-foreground',
              index < at && 'text-foreground-muted',
              index > at && 'text-foreground-muted/70',
            )}
          >
            {index + 1}. {t(`students.import.step.${step}`)}
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * The two hidden fields the mapping and preview steps post.
 *
 * Split deliberately. The rows are the whole spreadsheet — hundreds of arrays —
 * and they never change once the file is read; the settings change on every
 * keystroke in the relationship box and on every tick in the preview. Keeping
 * both in one field meant re-serialising a club's entire register on each of
 * those, which on a real file is a visible stutter while somebody types.
 *
 * `useRows` memoises the big half so it is stringified once per file; React then
 * sees an unchanged string and leaves the DOM attribute alone.
 */
function useRows(sheet: Sheet): string {
  return useMemo(() => JSON.stringify(sheet.rows), [sheet]);
}

function settingsJson(
  mapping: Mapping,
  relationship: string,
  commit: boolean,
  include: number[],
): string {
  return JSON.stringify({
    mapping,
    defaultRelationship: relationship.trim(),
    commit,
    include,
  });
}

/** Both fields together, so the two steps cannot post different shapes. */
function RequestFields({ rows, settings }: { rows: string; settings: string }): React.ReactElement {
  return (
    <>
      <input type="hidden" name="rows" value={rows} />
      <input type="hidden" name="settings" value={settings} />
    </>
  );
}

function MappingStep({
  sheet,
  fileName,
  mapping,
  onMapping,
  relationship,
  onRelationship,
  levelNames,
  action,
  pending,
  state,
  onRestart,
}: {
  sheet: Sheet;
  fileName: string;
  mapping: Mapping;
  onMapping: (mapping: Mapping) => void;
  relationship: string;
  onRelationship: (value: string) => void;
  levelNames: string;
  action: (formData: FormData) => void;
  pending: boolean;
  state: ImportState;
  onRestart: () => void;
}): React.ReactElement {
  const t = useTranslations();
  const rows = useRows(sheet);

  const columns = sheet.headers.map((header, index) => ({
    value: String(index),
    label: header === '' ? t('students.import.columnUnnamed', { number: index + 1 }) : header,
  }));

  const nameMapped = mapping.firstName !== null || mapping.fullName !== null;

  return (
    <form
      action={action}
      className="flex flex-col gap-5 rounded border border-border bg-surface p-5"
    >
      <RequestFields rows={rows} settings={settingsJson(mapping, relationship, false, [])} />

      <div>
        <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
          {t('students.import.mapTitle')}
        </h2>
        <p className="mt-1 text-sm text-foreground-muted">
          {t('students.import.mapHint', { file: fileName, rows: sheet.rows.length })}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {FIELD_ORDER.map((field) => (
          <div key={field} className={cn(FIELD_COLUMN, 'max-w-none')}>
            <label htmlFor={`map-${field}`} className={FIELD_LABEL}>
              {t(`students.import.field.${field}`)}
            </label>
            <select
              id={`map-${field}`}
              value={mapping[field] === null ? '' : String(mapping[field])}
              onChange={(event) => {
                const at = event.target.value === '' ? null : Number(event.target.value);
                /*
                 * A column can feed one field only. Choosing it here takes it
                 * away from wherever it was, rather than letting the same
                 * column silently become both the name and the guardian.
                 */
                const next: Mapping = { ...mapping };
                if (at !== null) {
                  for (const other of IMPORT_FIELDS) {
                    if (next[other] === at) next[other] = null;
                  }
                }
                next[field] = at;
                onMapping(next);
              }}
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
                : t('students.import.sample', {
                    value: sampleOf(sheet, mapping[field] ?? 0),
                  })}
            </p>
          </div>
        ))}
      </div>

      <div className={cn(FIELD_COLUMN, 'max-w-form')}>
        <label htmlFor="map-relationship" className={FIELD_LABEL}>
          {t('students.import.relationshipLabel')}
        </label>
        <input
          id="map-relationship"
          value={relationship}
          onChange={(event) => onRelationship(event.target.value)}
          maxLength={120}
          required
          className={CONTROL_LINE}
        />
        <p className="text-sm text-foreground-muted">{t('students.import.relationshipHint')}</p>
      </div>

      {levelNames !== '' && (
        <p className="text-sm text-foreground-muted">
          {t('students.import.levelsHint', { levels: levelNames })}
        </p>
      )}

      {!nameMapped && (
        <p className="flex items-start gap-2 text-sm text-danger">
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
          {t('students.import.nameRequiredHint')}
        </p>
      )}

      <Problem
        {...(state.errorKey !== undefined ? { errorKey: state.errorKey } : {})}
        {...(state.detail !== undefined ? { detail: state.detail } : {})}
      />

      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={pending || !nameMapped || relationship.trim() === ''}
          className={BUTTON}
        >
          {pending ? t('students.import.checking') : t('students.import.check')}
        </button>
        <button type="button" onClick={onRestart} className={BUTTON_QUIET}>
          {t('students.import.chooseAnother')}
        </button>
      </div>
    </form>
  );
}

/** The first non-empty value in a column, so a mapping choice can be checked at a glance. */
function sampleOf(sheet: Sheet, column: number): string {
  const found = sheet.rows.find((row) => (row[column] ?? '').trim() !== '');
  return (found?.[column] ?? '').trim();
}

function PreviewStep({
  rows,
  selected,
  onSelected,
  sheet,
  mapping,
  relationship,
  action,
  pending,
  state,
  onBack,
}: {
  rows: ImportRowResult[];
  selected: Set<number>;
  onSelected: (next: Set<number>) => void;
  sheet: Sheet;
  mapping: Mapping;
  relationship: string;
  action: (formData: FormData) => void;
  pending: boolean;
  state: ImportState;
  onBack: () => void;
}): React.ReactElement {
  const t = useTranslations();
  const sheetRows = useRows(sheet);

  const refused = rows.filter((row) => !row.importable);
  const duplicates = rows.filter((row) => row.importable && row.duplicate !== null);
  const include = [...selected].sort((a, b) => a - b);

  const toggle = (index: number): void => {
    const next = new Set(selected);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    onSelected(next);
  };

  return (
    <form action={action} className="flex flex-col gap-5">
      <RequestFields rows={sheetRows} settings={settingsJson(mapping, relationship, true, include)} />

      <section className="flex flex-wrap gap-x-8 gap-y-2 rounded border border-border bg-surface p-5">
        <Count label={t('students.import.countTotal')} value={rows.length} />
        <Count label={t('students.import.countSelected')} value={selected.size} />
        <Count label={t('students.import.countDuplicates')} value={duplicates.length} />
        <Count label={t('students.import.countRefused')} value={refused.length} />
      </section>

      {duplicates.length > 0 && (
        <p className="text-sm text-foreground-muted">{t('students.import.duplicatesHint')}</p>
      )}
      {refused.length > 0 && (
        <p className="text-sm text-foreground-muted">{t('students.import.refusedHint')}</p>
      )}

      <section className="overflow-x-auto rounded border border-border bg-surface">
        <table className="w-full min-w-[56rem] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-foreground-muted">
              <th scope="col" className="w-10 px-3 py-2">
                <span className="sr-only">{t('students.import.columnInclude')}</span>
              </th>
              <th scope="col" className="w-14 px-3 py-2">{t('students.import.columnLine')}</th>
              <th scope="col" className="px-3 py-2">{t('students.import.columnName')}</th>
              <th scope="col" className="px-3 py-2">{t('students.import.columnBirthDate')}</th>
              <th scope="col" className="px-3 py-2">{t('students.import.columnLevel')}</th>
              <th scope="col" className="px-3 py-2">{t('students.import.columnGuardian')}</th>
              <th scope="col" className="px-3 py-2">{t('students.import.columnState')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <PreviewRow
                key={row.index}
                row={row}
                checked={selected.has(row.index)}
                onToggle={() => toggle(row.index)}
              />
            ))}
          </tbody>
        </table>
      </section>

      <Problem
        {...(state.errorKey !== undefined ? { errorKey: state.errorKey } : {})}
        {...(state.detail !== undefined ? { detail: state.detail } : {})}
      />

      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={pending || selected.size === 0} className={BUTTON}>
          {pending
            ? t('students.import.importing')
            : t('students.import.importCount', { count: selected.size })}
        </button>
        <button type="button" onClick={onBack} className={BUTTON_QUIET}>
          {t('students.import.backToMapping')}
        </button>
      </div>
    </form>
  );
}

function Count({ label, value }: { label: string; value: number }): React.ReactElement {
  return (
    <div>
      <p className="text-sm text-foreground-muted">{label}</p>
      <p className="text-lg font-medium tabular-nums">{value}</p>
    </div>
  );
}

function PreviewRow({
  row,
  checked,
  onToggle,
}: {
  row: ImportRowResult;
  checked: boolean;
  onToggle: () => void;
}): React.ReactElement {
  const t = useTranslations();

  return (
    <tr
      className={cn(
        'border-b border-border last:border-0 align-top',
        !row.importable && 'bg-danger/5 text-foreground-muted',
      )}
    >
      <td className="px-3 py-2">
        <input
          type="checkbox"
          checked={checked}
          disabled={!row.importable}
          onChange={onToggle}
          aria-label={t('students.import.includeRow', { line: row.line })}
          className="size-4"
        />
      </td>
      <td className="px-3 py-2 tabular-nums text-foreground-muted">{row.line}</td>
      <td className="px-3 py-2">
        {row.firstName === '' ? (
          <span className="text-foreground-muted">{t('students.import.noName')}</span>
        ) : (
          `${row.firstName} ${row.lastName}`
        )}
      </td>
      <td className="px-3 py-2 tabular-nums">{row.birthDate ?? '—'}</td>
      <td className="px-3 py-2">{row.levelName ?? '—'}</td>
      <td className="px-3 py-2">
        {row.guardian === null ? '—' : `${row.guardian.name} (${row.guardian.relationship})`}
      </td>
      <td className="px-3 py-2">
        <div className="flex flex-col gap-1">
          {row.problems.map((problem, at) => (
            <span key={`${problem.field}-${at}`} className="flex items-start gap-1.5 text-danger">
              <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              {t(`students.import.problem.${problem.code}`, { value: problem.value ?? '' })}
            </span>
          ))}

          {row.duplicate !== null && (
            <span className="flex items-start gap-1.5 text-warning">
              <Copy aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              {row.duplicate.kind === 'register'
                ? t('students.import.duplicateRegister', { name: row.duplicate.name })
                : t('students.import.duplicateFile', { line: row.duplicate.line ?? 0 })}
            </span>
          )}

          {row.problems.length === 0 && row.duplicate === null && (
            <span className="flex items-start gap-1.5 text-foreground-muted">
              <Check aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              {t('students.import.rowReady')}
            </span>
          )}
        </div>
      </td>
    </tr>
  );
}
