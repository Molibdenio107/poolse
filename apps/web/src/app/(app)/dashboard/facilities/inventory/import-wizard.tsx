'use client';

import { useActionState, useEffect, useMemo, useRef, useState, startTransition } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, Check, Copy, RefreshCw, Upload } from 'lucide-react';
import { CONTROL_LINE, FIELD_COLUMN, FIELD_LABEL } from '@/components/ui/field';
import { cn } from '@/lib/utils';
import type { InventoryImportResult, InventoryImportRowResult } from '@/lib/api';
import {
  EMPTY_INVENTORY_MAPPING,
  INVENTORY_FIELDS,
  type InventoryField,
  type InventoryMapping,
} from '@/lib/inventory-sheet';
import type { ColumnMatch, MatchResult, NamedSheet, Sheet } from '@/lib/sheet';
import {
  matchSheetAction,
  readSheetAction,
  runImportAction,
  type ImportState,
  type MatchState,
  type ReadState,
} from './import.actions';

/**
 * The kit list, in four steps — round 6.
 *
 * The register's wizard with the vocabulary changed, and the four steps are the
 * point rather than the ceremony: a file that goes straight from "chosen" to
 * "imported" is a feature nobody trusts twice, because the first bad row teaches
 * the operator that the button is a gamble.
 *
 *   ficheiro → mapeamento → pré-visualização → importar
 *
 * Two rules, the same two:
 *
 * - **Nothing is written until the last step**, and the step before it shows
 *   every row exactly as it will be saved — the count, the unit, the tanks the
 *   item will serve. What is approved is what lands.
 * - **A problem and a duplicate are different things.** A problem refuses the
 *   row, on the server, whatever this screen ticks. A duplicate is a stocktake:
 *   the item is already recorded, the file has a different count, and the row
 *   shows the old number beside the new one. Unticked by default, because an
 *   unasked-for overwrite of somebody's counts is not a favour.
 */

const READ_INITIAL: ReadState = { ok: false, attempt: 0 };
const RUN_INITIAL: ImportState = { ok: false, attempt: 0 };
const MATCH_INITIAL: MatchState = { attempt: 0 };

type Stage = 'upload' | 'map' | 'preview' | 'done';

const BUTTON =
  'rounded bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50 ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

const BUTTON_QUIET =
  'rounded border border-border px-4 py-2 text-sm hover:bg-surface-muted ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/** The order the mapping step lists the fields in — the order a form asks for them. */
const FIELD_ORDER: InventoryField[] = ['name', 'quantity', 'unit', 'pools', 'notes'];

function Problem({
  errorKey,
  detail,
}: {
  errorKey?: string;
  detail?: string;
}): React.ReactElement | null {
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

export function InventoryImportWizard({
  facilityId,
  facilityName,
  poolNames,
  initialFile = null,
  onClose,
}: {
  /** The site being imported into. Chosen on the screen behind this panel. */
  facilityId: string;
  facilityName: string;
  /** The tanks a "Piscinas" column can name, listed so the operator can see them. */
  poolNames: string[];
  /**
   * A file the operator dropped on the screen, handed straight in.
   *
   * The upload step is skipped for it — they have already chosen the file, and
   * showing them a picker to choose it again would be the screen not believing
   * what they just did.
   */
  initialFile?: File | null;
  onClose?: (() => void) | undefined;
}): React.ReactElement {
  const t = useTranslations();

  const [readState, readAction, reading] = useActionState(readSheetAction, READ_INITIAL);
  const [runState, runAction, running] = useActionState(runImportAction, RUN_INITIAL);
  const [matchState, matchAction, matching] = useActionState(matchSheetAction, MATCH_INITIAL);

  const [stage, setStage] = useState<Stage>('upload');
  const [sheets, setSheets] = useState<NamedSheet[]>([]);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [match, setMatch] = useState<MatchResult<InventoryField> | null>(null);
  const [fileName, setFileName] = useState('');
  const [mapping, setMapping] = useState<InventoryMapping | null>(null);
  const [rows, setRows] = useState<InventoryImportRowResult[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [created, setCreated] = useState(0);
  const [updated, setUpdated] = useState(0);

  const readAt = useRef(0);
  const runAt = useRef(0);
  const matchAt = useRef(0);
  const seeded = useRef<File | null>(null);

  /*
   * A dropped file goes through exactly the same action as a chosen one.
   *
   * Not a second read path: the drop is only a different way of naming the file,
   * and everything after it has to be identical or the two ways in would drift.
   */
  useEffect(() => {
    if (initialFile === null || seeded.current === initialFile) return;
    seeded.current = initialFile;

    const formData = new FormData();
    formData.set('file', initialFile);
    startTransition(() => readAction(formData));
  }, [initialFile, readAction]);

  // Both effects key on `attempt` rather than on `ok`, so a second upload of the
  // same file still moves the wizard on.
  useEffect(() => {
    if (readState.attempt === readAt.current) return;
    readAt.current = readState.attempt;
    if (!readState.ok || readState.sheets === undefined || readState.sheets.length === 0) return;

    setSheets(readState.sheets);
    setSheetIndex(0);
    setMatch(readState.match ?? null);
    setMapping(readState.match?.mapping ?? { ...EMPTY_INVENTORY_MAPPING });
    setFileName(readState.fileName ?? '');
    setStage('map');
  }, [readState]);

  useEffect(() => {
    if (matchState.attempt === matchAt.current) return;
    matchAt.current = matchState.attempt;
    if (matchState.match === undefined) return;

    setMatch(matchState.match);
    setMapping(matchState.match.mapping);
  }, [matchState]);

  useEffect(() => {
    if (runState.attempt === runAt.current) return;
    runAt.current = runState.attempt;
    if (!runState.ok || runState.result === undefined) return;

    if (runState.committed === true) {
      setCreated(runState.result.created ?? 0);
      setUpdated(runState.result.updated ?? 0);
      setStage('done');
      return;
    }

    setRows(runState.result.rows);
    /*
     * What is ticked when the preview opens: everything that can be written and
     * is not already in the store. Unticking the stocktake rows is the default
     * the screen argues for and the one the API takes when a caller sends no
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

  const sheet = sheets[sheetIndex] ?? null;

  const chooseSheet = (index: number): void => {
    const chosen = sheets[index];
    if (chosen === undefined) return;

    setSheetIndex(index);
    // Cleared rather than carried: the previous sheet's mapping is a set of
    // column *indexes* into a grid that no longer has those columns.
    setMapping({ ...EMPTY_INVENTORY_MAPPING });
    setMatch(null);

    const formData = new FormData();
    formData.set('sheet', JSON.stringify({ headers: chosen.headers, rows: chosen.rows }));
    startTransition(() => matchAction(formData));
  };

  return (
    <div className="flex flex-col gap-5">
      <Steps stage={stage} />

      <p className="text-sm text-foreground-muted">
        {t('inventory.import.intoSite', { site: facilityName })}
      </p>

      {stage === 'upload' && (
        <section className="rounded border border-border bg-surface p-5">
          <form action={readAction} className="flex flex-col gap-4">
            <div className={cn(FIELD_COLUMN, 'max-w-form')}>
              <label htmlFor="inventory-import-file" className={FIELD_LABEL}>
                {t('students.import.fileLabel')}
              </label>
              <input
                id="inventory-import-file"
                name="file"
                type="file"
                required
                accept=".xlsx,.csv,text/csv"
                className={cn(
                  CONTROL_LINE,
                  'py-1.5 file:mr-3 file:rounded file:border-0 file:bg-surface-muted file:px-3 file:py-1 file:text-sm file:text-foreground',
                )}
              />
              <p className="text-sm text-foreground-muted">{t('inventory.import.fileHint')}</p>
            </div>

            <Problem
              {...(readState.errorKey !== undefined ? { errorKey: readState.errorKey } : {})}
            />

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
          facilityId={facilityId}
          sheet={sheet}
          sheets={sheets}
          sheetIndex={sheetIndex}
          onSheet={chooseSheet}
          fileName={fileName}
          mapping={mapping}
          onMapping={setMapping}
          match={match}
          matching={matching}
          poolNames={poolNames}
          action={runAction}
          pending={running}
          state={runState}
          onRestart={() => {
            setSheets([]);
            setMatch(null);
            setMapping(null);
            setStage('upload');
          }}
        />
      )}

      {stage === 'preview' && sheet !== null && mapping !== null && (
        <PreviewStep
          facilityId={facilityId}
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
            {t('inventory.import.doneCount', { count: created })}
          </p>
          {updated > 0 && (
            <p className="flex items-center gap-2 text-sm">
              <RefreshCw aria-hidden className="size-4 text-primary" />
              {t('inventory.import.doneUpdated', { count: updated })}
            </p>
          )}
          <p className="text-sm text-foreground-muted">{t('inventory.import.doneHint')}</p>
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
 * The hidden fields the mapping and preview steps post.
 *
 * `rows` is the whole spreadsheet and never changes once the file is read;
 * `settings` changes on every tick in the preview. Keeping both in one field
 * meant re-serialising the file on each of those.
 */
function useRows(sheet: Sheet): string {
  return useMemo(() => JSON.stringify(sheet.rows), [sheet]);
}

function settingsJson(mapping: InventoryMapping, commit: boolean, include: number[]): string {
  return JSON.stringify({ mapping, commit, include });
}

function RequestFields({
  facilityId,
  rows,
  settings,
}: {
  facilityId: string;
  rows: string;
  settings: string;
}): React.ReactElement {
  return (
    <>
      <input type="hidden" name="facilityId" value={facilityId} />
      <input type="hidden" name="rows" value={rows} />
      <input type="hidden" name="settings" value={settings} />
    </>
  );
}

/**
 * Which field a column feeds, applied to the mapping.
 *
 * A column may feed one field and a field may take one column, so choosing
 * either end has to clear the other.
 */
function assign(
  mapping: InventoryMapping,
  field: InventoryField | null,
  column: number | null,
): InventoryMapping {
  const next: InventoryMapping = { ...mapping };

  if (column !== null) {
    for (const other of INVENTORY_FIELDS) {
      if (next[other] === column) next[other] = null;
    }
  }
  if (field !== null) next[field] = column;
  return next;
}

/** The field a column currently feeds, or null. */
function fieldOf(mapping: InventoryMapping, column: number): InventoryField | null {
  return INVENTORY_FIELDS.find((field) => mapping[field] === column) ?? null;
}

function MappingStep({
  facilityId,
  sheet,
  sheets,
  sheetIndex,
  onSheet,
  fileName,
  mapping,
  onMapping,
  match,
  matching,
  poolNames,
  action,
  pending,
  state,
  onRestart,
}: {
  facilityId: string;
  sheet: Sheet;
  sheets: NamedSheet[];
  sheetIndex: number;
  onSheet: (index: number) => void;
  fileName: string;
  mapping: InventoryMapping;
  onMapping: (mapping: InventoryMapping) => void;
  match: MatchResult<InventoryField> | null;
  matching: boolean;
  poolNames: string[];
  action: (formData: FormData) => void;
  pending: boolean;
  state: ImportState;
  onRestart: () => void;
}): React.ReactElement {
  const t = useTranslations();
  const rows = useRows(sheet);
  const [showAll, setShowAll] = useState(false);

  const columns = sheet.headers.map((header, index) => ({
    value: String(index),
    label: header === '' ? t('students.import.columnUnnamed', { number: index + 1 }) : header,
  }));

  const nameMapped = mapping.name !== null;

  /*
   * The columns worth a person's attention, and only those: one the matcher
   * could not place, and one it placed without conviction. Everything it was
   * sure about is folded away.
   */
  const settled = (match?.matches ?? []).filter((entry) => entry.confidence !== 'unsure');
  const doubtful = (match?.matches ?? []).filter((entry) => entry.confidence === 'unsure');
  const questions = [...doubtful.map((entry) => entry.column), ...(match?.unmatched ?? [])].sort(
    (a, b) => a - b,
  );

  const fieldOptions = [
    { value: '', label: t('students.import.notImported') },
    ...FIELD_ORDER.map((field) => ({
      value: field,
      label: t(`inventory.field.${field}`),
    })),
  ];

  return (
    <form
      action={action}
      className="flex flex-col gap-5 rounded border border-border bg-surface p-5"
    >
      <RequestFields
        facilityId={facilityId}
        rows={rows}
        settings={settingsJson(mapping, false, [])}
      />

      <div>
        <h2 className="text-sm font-medium uppercase tracking-wider text-foreground-muted">
          {t('students.import.mapTitle')}
        </h2>
        <p className="mt-1 text-sm text-foreground-muted">
          {t('students.import.mapHint', { file: fileName, rows: sheet.rows.length })}
        </p>
      </div>

      {/*
        Only when there is a choice to make. A workbook with one sheet of data —
        which is most of them — should not grow a control asking which of the one
        it is.
      */}
      {sheets.length > 1 && (
        <div className={cn(FIELD_COLUMN, 'max-w-form')}>
          <label htmlFor="inventory-map-sheet" className={FIELD_LABEL}>
            {t('students.import.sheetLabel')}
          </label>
          <select
            id="inventory-map-sheet"
            value={String(sheetIndex)}
            onChange={(event) => onSheet(Number(event.target.value))}
            className={CONTROL_LINE}
          >
            {sheets.map((candidate, index) => (
              <option key={candidate.name} value={String(index)}>
                {t('students.import.sheetOption', {
                  name: candidate.name,
                  rows: candidate.rows.length,
                })}
              </option>
            ))}
          </select>
          <p className="text-sm text-foreground-muted">{t('students.import.sheetHint')}</p>
        </div>
      )}

      {matching ? (
        <p className="text-sm text-foreground-muted">{t('students.import.matching')}</p>
      ) : (
        <p className="flex items-center gap-2 text-sm">
          <Check aria-hidden className="size-4 shrink-0 text-primary" />
          <span>
            {t('students.import.matched', {
              matched: settled.length,
              total: sheet.headers.filter((header) => header !== '').length,
            })}
          </span>
        </p>
      )}

      {questions.length > 0 && (
        <section className="flex flex-col gap-4 rounded border border-warning/40 bg-warning/5 p-4">
          <div>
            <h3 className="text-sm font-medium">
              {t('students.import.questionsTitle', { count: questions.length })}
            </h3>
            <p className="mt-1 text-sm text-foreground-muted">
              {t('students.import.questionsHint')}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {questions.map((column) => (
              <ColumnQuestion
                key={column}
                sheet={sheet}
                column={column}
                options={fieldOptions}
                chosen={fieldOf(mapping, column)}
                guessed={doubtful.find((entry) => entry.column === column) ?? null}
                onChoose={(field) =>
                  onMapping(assign(mapping, field, field === null ? null : column))
                }
              />
            ))}
          </div>
        </section>
      )}

      <div>
        <button
          type="button"
          onClick={() => setShowAll((open) => !open)}
          aria-expanded={showAll}
          className="text-sm underline underline-offset-4 hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {showAll ? t('students.import.hideAll') : t('students.import.showAll')}
        </button>
      </div>

      {showAll && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FIELD_ORDER.map((field) => (
            <div key={field} className={cn(FIELD_COLUMN, 'max-w-none')}>
              <label htmlFor={`inventory-map-${field}`} className={FIELD_LABEL}>
                {t(`inventory.field.${field}`)}
              </label>
              <select
                id={`inventory-map-${field}`}
                value={mapping[field] === null ? '' : String(mapping[field])}
                onChange={(event) => {
                  const at = event.target.value === '' ? null : Number(event.target.value);
                  onMapping(assign(mapping, field, at));
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
      )}

      {/*
        The tank names the "Piscinas" column can actually match, listed rather
        than left to be discovered by a warning on the preview. It is the one
        column whose values have to agree with something already in Poolse.
      */}
      {poolNames.length > 0 && (
        <p className="text-sm text-foreground-muted">
          {t('inventory.import.poolsHint', { pools: poolNames.join(', ') })}
        </p>
      )}

      {!nameMapped && (
        <p className="flex items-start gap-2 text-sm text-danger">
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
          {t('inventory.import.nameRequiredHint')}
        </p>
      )}

      <Problem
        {...(state.errorKey !== undefined ? { errorKey: state.errorKey } : {})}
        {...(state.detail !== undefined ? { detail: state.detail } : {})}
      />

      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={pending || matching || !nameMapped} className={BUTTON}>
          {pending ? t('students.import.checking') : t('students.import.check')}
        </button>
        <button type="button" onClick={onRestart} className={BUTTON_QUIET}>
          {t('students.import.chooseAnother')}
        </button>
      </div>
    </form>
  );
}

/**
 * One column the matcher wants a person to confirm.
 *
 * Asked as "what is this column?" rather than "which column is this field?",
 * because that is the question somebody looking at a spreadsheet can answer.
 * The sample value is the whole reason it is answerable at a glance.
 */
function ColumnQuestion({
  sheet,
  column,
  options,
  chosen,
  guessed,
  onChoose,
}: {
  sheet: Sheet;
  column: number;
  options: { value: string; label: string }[];
  chosen: InventoryField | null;
  guessed: ColumnMatch<InventoryField> | null;
  onChoose: (field: InventoryField | null) => void;
}): React.ReactElement {
  const t = useTranslations();
  const header = sheet.headers[column] ?? '';
  const sample = sampleOf(sheet, column);

  return (
    <div className={cn(FIELD_COLUMN, 'max-w-none')}>
      <label htmlFor={`inventory-question-${column}`} className="text-sm font-medium">
        {header === '' ? t('students.import.columnUnnamed', { number: column + 1 }) : header}
      </label>
      <p className="text-sm text-foreground-muted">
        {sample === ''
          ? t('students.import.sampleNone')
          : t('students.import.sample', { value: sample })}
      </p>
      <select
        id={`inventory-question-${column}`}
        value={chosen ?? ''}
        onChange={(event) =>
          onChoose(event.target.value === '' ? null : (event.target.value as InventoryField))
        }
        className={CONTROL_LINE}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {guessed !== null && (
        <p className="text-sm text-foreground-muted">{t('students.import.reasonWeak')}</p>
      )}
    </div>
  );
}

/** The first non-empty value in a column, so a mapping choice can be checked at a glance. */
function sampleOf(sheet: Sheet, column: number): string {
  const found = sheet.rows.find((row) => (row[column] ?? '').trim() !== '');
  return (found?.[column] ?? '').trim();
}

function PreviewStep({
  facilityId,
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
  facilityId: string;
  rows: InventoryImportRowResult[];
  selected: Set<number>;
  onSelected: (next: Set<number>) => void;
  sheet: Sheet;
  mapping: InventoryMapping;
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

  /*
   * Counted from the ticks rather than from the file's own summary, so the
   * numbers move as somebody changes their mind. A count describing what the
   * *file* contains while the button does something else is the kind of small
   * lie that stops people trusting the screen.
   */
  const creating = rows.filter((row) => selected.has(row.index) && row.duplicate === null).length;
  const updating = rows.filter(
    (row) => selected.has(row.index) && row.duplicate?.kind === 'store',
  ).length;

  const toggle = (index: number): void => {
    const next = new Set(selected);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    onSelected(next);
  };

  return (
    <form action={action} className="flex flex-col gap-5">
      <RequestFields
        facilityId={facilityId}
        rows={sheetRows}
        settings={settingsJson(mapping, true, include)}
      />

      <section className="flex flex-wrap gap-x-8 gap-y-2 rounded border border-border bg-surface p-5">
        <Count label={t('students.import.countTotal')} value={rows.length} />
        <Count label={t('inventory.import.countCreate')} value={creating} />
        <Count label={t('inventory.import.countUpdate')} value={updating} />
        <Count label={t('students.import.countRefused')} value={refused.length} />
      </section>

      {duplicates.length > 0 && (
        <p className="text-sm text-foreground-muted">{t('inventory.import.duplicatesHint')}</p>
      )}
      {refused.length > 0 && (
        <p className="text-sm text-foreground-muted">{t('students.import.refusedHint')}</p>
      )}

      <section className="overflow-x-auto rounded border border-border bg-surface">
        <table className="w-full min-w-[48rem] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-foreground-muted">
              <th scope="col" className="w-10 px-3 py-2">
                <span className="sr-only">{t('students.import.columnInclude')}</span>
              </th>
              <th scope="col" className="w-14 px-3 py-2">
                {t('students.import.columnLine')}
              </th>
              <th scope="col" className="px-3 py-2">
                {t('inventory.field.name')}
              </th>
              <th scope="col" className="px-3 py-2">
                {t('inventory.field.quantity')}
              </th>
              <th scope="col" className="px-3 py-2">
                {t('inventory.scopeLabel')}
              </th>
              <th scope="col" className="px-3 py-2">
                {t('students.import.columnState')}
              </th>
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
        <button type="submit" disabled={pending || creating + updating === 0} className={BUTTON}>
          {pending
            ? t('students.import.importing')
            : t('inventory.import.importCount', { count: creating + updating })}
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

/** How a row's scope reads on the preview: the building, every tank, or these ones. */
function scopeText(row: InventoryImportRowResult, t: ReturnType<typeof useTranslations>): string {
  if (row.scope === 'facility') return t('inventory.scope.facility');
  if (row.scope === 'all_pools') return t('inventory.scope.all_pools');
  return row.poolNames.join(', ');
}

function PreviewRow({
  row,
  checked,
  onToggle,
}: {
  row: InventoryImportRowResult;
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
          // A row repeating an earlier row of this file is never written: the
          // earlier one is what acts, and ticking this would be the duplicate.
          disabled={!row.importable || row.duplicate?.kind === 'file'}
          onChange={onToggle}
          aria-label={t('students.import.includeRow', { line: row.line })}
          className="size-4 accent-[rgb(var(--primary))]"
        />
      </td>
      <td className="px-3 py-2 tabular-nums text-foreground-muted">{row.line}</td>
      <td className="px-3 py-2">
        {row.name === '' ? (
          <span className="text-foreground-muted">{t('inventory.import.noName')}</span>
        ) : (
          row.name
        )}
      </td>
      <td className="px-3 py-2 tabular-nums">
        {row.quantity}
        {row.unit !== null && row.unit !== '' && (
          <span className="ml-1 text-foreground-muted">{row.unit}</span>
        )}
      </td>
      <td className="px-3 py-2">{scopeText(row, t)}</td>
      <td className="px-3 py-2">
        <div className="flex flex-col gap-1">
          {row.problems.map((problem, at) => (
            <span key={`${problem.field}-${at}`} className="flex items-start gap-1.5 text-danger">
              <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              {t(`inventory.import.problem.${problem.code}`, { value: problem.value ?? '' })}
            </span>
          ))}

          {row.warnings.map((warning, at) => (
            <span key={`w-${at}`} className="flex items-start gap-1.5 text-warning">
              <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              {t(`inventory.import.warning.${warning.code}`, { value: warning.value ?? '' })}
            </span>
          ))}

          {row.duplicate?.kind === 'file' && (
            <span className="flex items-start gap-1.5 text-foreground-muted">
              <Copy aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              {t('inventory.import.duplicateFile', { line: row.duplicate.line ?? 0 })}
            </span>
          )}

          {/*
            A stocktake. Every value that would change is shown as "18 → 24",
            because "will update" without the two numbers is a promise the
            operator cannot check — and the count is the entire reason this
            feature exists.
          */}
          {row.duplicate?.kind === 'store' && (
            <span className="flex items-start gap-1.5 text-primary">
              <RefreshCw aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              <span>
                {t('inventory.import.matched', { name: row.duplicate.name })}{' '}
                {row.updates.length === 0
                  ? t('inventory.import.nothingToChange')
                  : row.updates
                      .map(
                        (update) =>
                          `${t(`inventory.field.${update.field === 'scope' ? 'pools' : update.field}`)}: ${
                            update.before === '' ? '—' : update.before
                          } → ${update.after === '' ? '—' : update.after}`,
                      )
                      .join(' · ')}
              </span>
            </span>
          )}
        </div>
      </td>
    </tr>
  );
}
