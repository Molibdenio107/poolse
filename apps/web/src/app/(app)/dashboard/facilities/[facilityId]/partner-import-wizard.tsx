'use client';

import { useActionState, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, Building2, Check, Copy, RefreshCw, Upload } from 'lucide-react';
import { CONTROL_LINE, FIELD_COLUMN, FIELD_LABEL } from '@/components/ui/field';
import { cn } from '@/lib/utils';
import type { PartnerImportTree } from '@/lib/api';
import {
  EMPTY_PARTNER_MAPPING,
  PARTNER_FIELDS,
  type PartnerField,
  type PartnerMapping,
} from '@/lib/partner-sheet';
import type { ColumnMatch, MatchResult, NamedSheet, Sheet } from '@/lib/sheet';
import { useImportWizard, type ImportStage } from '@/lib/use-import-wizard';
import {
  matchSheetAction,
  readSheetAction,
  runImportAction,
  type ImportState,
  type MatchState,
  type PartnerPreviewRow,
  type ReadState,
} from './partner-import.actions';

/**
 * The partnerships sheet, in four steps — POOLSE-48.
 *
 * The inventory's wizard with the vocabulary changed, and one real difference
 * that is the whole reason the ticket calls this the thing most likely to be got
 * wrong:
 *
 * **The preview is a tree, not a list.** A school sends a row per class with its
 * own name repeating down the column, so twelve rows across three schools is
 * *three partnerships with twelve turmas*. Drawn as a flat table, twelve rows
 * would each say "this partnership already exists" from the second row onwards —
 * technically true and completely misleading, because it reads as twelve
 * problems when it is the file being ordinary. So partnerships are headings and
 * their turmas are the rows beneath them, and the button counts both.
 *
 * The two standing rules are the same as every other importer's:
 *
 * - **Nothing is written until the last step**, and the step before it shows
 *   every row exactly as it will be saved.
 * - **A problem and a stocktake are different things.** A problem refuses the
 *   row, on the server, whatever this screen ticks. A stocktake is a turma the
 *   club already has with a different headcount in the file — shown as `24 → 31`
 *   and unticked by default, because an unasked-for overwrite of somebody's
 *   numbers is not a favour.
 */

const READ_INITIAL: ReadState = { ok: false, attempt: 0 };
const RUN_INITIAL: ImportState = { ok: false, attempt: 0 };
const MATCH_INITIAL: MatchState = { attempt: 0 };

const BUTTON =
  'rounded bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50 ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

const BUTTON_QUIET =
  'rounded border border-border px-4 py-2 text-sm hover:bg-surface-muted ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/**
 * The order the mapping step lists the fields in.
 *
 * The two names first and adjacent, deliberately: `partnerName` and `groupName`
 * are the pair somebody gets the wrong way round, and putting them side by side
 * is the cheapest way to make that visible before it is committed.
 */
const FIELD_ORDER: PartnerField[] = [
  'partnerName',
  'groupName',
  'participantCount',
  'partnerType',
  'levelName',
  'tag',
  'ownInstructorName',
  'contactName',
  'contactEmail',
  'contactPhone',
  'notes',
];

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

export function PartnerImportWizard({
  facilityId,
  facilityName,
  initialFile = null,
  onClose,
}: {
  /** The site being imported into. A partner belongs to one building. */
  facilityId: string;
  facilityName: string;
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

  const {
    stage,
    setStage,
    sheets,
    sheet,
    sheetIndex,
    chooseSheet,
    match,
    mapping,
    setMapping,
    rows,
    selected,
    setSelected,
    fileName,
    created,
    updated,
    restart,
  } = useImportWizard<PartnerField, PartnerPreviewRow>({
    empty: EMPTY_PARTNER_MAPPING,
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

      <p className="text-sm text-foreground-muted">
        {t('partnerImport.intoSite', { site: facilityName })}
      </p>

      {stage === 'upload' && (
        <section className="rounded border border-border bg-surface p-5">
          <form action={readAction} className="flex flex-col gap-4">
            <div className={cn(FIELD_COLUMN, 'max-w-form')}>
              <label htmlFor="partner-import-file" className={FIELD_LABEL}>
                {t('students.import.fileLabel')}
              </label>
              <input
                id="partner-import-file"
                name="file"
                type="file"
                required
                accept=".xlsx,.csv,text/csv"
                className={cn(
                  CONTROL_LINE,
                  'py-1.5 file:mr-3 file:rounded file:border-0 file:bg-surface-muted file:px-3 file:py-1 file:text-sm file:text-foreground',
                )}
              />
              <p className="text-sm text-foreground-muted">{t('partnerImport.fileHint')}</p>
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
          action={runAction}
          pending={running}
          state={runState}
          onRestart={restart}
        />
      )}

      {stage === 'preview' && sheet !== null && mapping !== null && (
        <PreviewStep
          facilityId={facilityId}
          rows={rows}
          partners={runState.partners ?? []}
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
            {t('partnerImport.doneCount', {
              partners: runState.createdPartners ?? 0,
              groups: created,
            })}
          </p>
          {updated > 0 && (
            <p className="flex items-center gap-2 text-sm">
              <RefreshCw aria-hidden className="size-4 text-primary" />
              {t('partnerImport.doneUpdated', { count: updated })}
            </p>
          )}
          <p className="text-sm text-foreground-muted">{t('partnerImport.doneHint')}</p>
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

function settingsJson(mapping: PartnerMapping, commit: boolean, include: number[]): string {
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
  mapping: PartnerMapping,
  field: PartnerField | null,
  column: number | null,
): PartnerMapping {
  const next: PartnerMapping = { ...mapping };

  if (column !== null) {
    for (const other of PARTNER_FIELDS) {
      if (next[other] === column) next[other] = null;
    }
  }
  if (field !== null) next[field] = column;
  return next;
}

/** The field a column currently feeds, or null. */
function fieldOf(mapping: PartnerMapping, column: number): PartnerField | null {
  return PARTNER_FIELDS.find((field) => mapping[field] === column) ?? null;
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
  mapping: PartnerMapping;
  onMapping: (mapping: PartnerMapping) => void;
  match: MatchResult<PartnerField> | null;
  matching: boolean;
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

  // Criterion 7: both names, and only both names. A sheet with no headcount
  // column is the list of which classes come, which is worth having.
  const namesMapped = mapping.partnerName !== null && mapping.groupName !== null;

  const settled = (match?.matches ?? []).filter((entry) => entry.confidence !== 'unsure');
  const doubtful = (match?.matches ?? []).filter((entry) => entry.confidence === 'unsure');
  const questions = [...doubtful.map((entry) => entry.column), ...(match?.unmatched ?? [])].sort(
    (a, b) => a - b,
  );

  const fieldOptions = [
    { value: '', label: t('students.import.notImported') },
    ...FIELD_ORDER.map((field) => ({ value: field, label: t(`partners.field.${field}`) })),
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
        Said before the mapping rather than discovered on the preview: one row is
        one turma, and the school's name repeats. It is the single thing about
        this importer that differs from every other one, and an operator who has
        used the register's expects a repeated name to be a duplicate.
      */}
      <p className="flex items-start gap-2 rounded border border-border bg-surface-muted p-3 text-sm">
        <Building2 aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
        {t('partnerImport.oneRowPerGroup')}
      </p>

      {sheets.length > 1 && (
        <div className={cn(FIELD_COLUMN, 'max-w-form')}>
          <label htmlFor="partner-map-sheet" className={FIELD_LABEL}>
            {t('students.import.sheetLabel')}
          </label>
          <select
            id="partner-map-sheet"
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
              <label htmlFor={`partner-map-${field}`} className={FIELD_LABEL}>
                {t(`partners.field.${field}`)}
              </label>
              <select
                id={`partner-map-${field}`}
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
                  : t('students.import.sample', { value: sampleOf(sheet, mapping[field] ?? 0) })}
              </p>
            </div>
          ))}
        </div>
      )}

      {!namesMapped && (
        <p className="flex items-start gap-2 text-sm text-danger">
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
          {t('partnerImport.namesRequiredHint')}
        </p>
      )}

      <Problem
        {...(state.errorKey !== undefined ? { errorKey: state.errorKey } : {})}
        {...(state.detail !== undefined ? { detail: state.detail } : {})}
      />

      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={pending || matching || !namesMapped} className={BUTTON}>
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
  chosen: PartnerField | null;
  guessed: ColumnMatch<PartnerField> | null;
  onChoose: (field: PartnerField | null) => void;
}): React.ReactElement {
  const t = useTranslations();
  const header = sheet.headers[column] ?? '';
  const sample = sampleOf(sheet, column);

  return (
    <div className={cn(FIELD_COLUMN, 'max-w-none')}>
      <label htmlFor={`partner-question-${column}`} className="text-sm font-medium">
        {header === '' ? t('students.import.columnUnnamed', { number: column + 1 }) : header}
      </label>
      <p className="text-sm text-foreground-muted">
        {sample === ''
          ? t('students.import.sampleNone')
          : t('students.import.sample', { value: sample })}
      </p>
      <select
        id={`partner-question-${column}`}
        value={chosen ?? ''}
        onChange={(event) =>
          onChoose(event.target.value === '' ? null : (event.target.value as PartnerField))
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

/**
 * The preview — criterion 3, and the shape of it is the criterion.
 *
 * Partnerships are headings and their turmas are the rows underneath. A refused
 * row belongs to no partnership — the API leaves it out of the tree precisely
 * because it cannot be committed — so those are collected in a section of their
 * own at the end, each naming why.
 */
function PreviewStep({
  facilityId,
  rows,
  partners,
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
  rows: PartnerPreviewRow[];
  partners: PartnerImportTree[];
  selected: Set<number>;
  onSelected: (next: Set<number>) => void;
  sheet: Sheet;
  mapping: PartnerMapping;
  action: (formData: FormData) => void;
  pending: boolean;
  state: ImportState;
  onBack: () => void;
}): React.ReactElement {
  const t = useTranslations();
  const sheetRows = useRows(sheet);

  const byIndex = new Map(rows.map((row) => [row.index, row]));
  const refused = rows.filter((row) => !row.importable);
  const include = [...selected].sort((a, b) => a - b);

  /*
   * Counted from the ticks rather than from the file's own summary — criterion 9.
   *
   * A partnership counts as one a commit will create only if at least one of its
   * turmas is still ticked, which mirrors what the API actually does: it creates
   * a partner lazily, when the first row that needs it is written. A school in
   * the list with every class unticked is a row nobody asked for.
   */
  const creating = rows.filter((row) => selected.has(row.index) && !row.existing).length;
  const updating = rows.filter(
    (row) => selected.has(row.index) && row.existing && row.updates.length > 0,
  ).length;
  const newPartners = partners.filter(
    (node) => node.isNew && node.rows.some((index) => selected.has(index)),
  ).length;

  const toggle = (index: number): void => {
    const next = new Set(selected);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    onSelected(next);
  };

  /** Every turma of one partnership, ticked or cleared in one go. */
  const togglePartner = (node: PartnerImportTree, on: boolean): void => {
    const next = new Set(selected);
    for (const index of node.rows) {
      if (on) next.add(index);
      else next.delete(index);
    }
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
        <Count label={t('partnerImport.countPartners')} value={newPartners} />
        <Count label={t('partnerImport.countGroups')} value={creating} />
        <Count label={t('partnerImport.countUpdate')} value={updating} />
        <Count label={t('students.import.countRefused')} value={refused.length} />
      </section>

      <p className="text-sm text-foreground-muted">{t('partnerImport.stocktakeHint')}</p>

      {partners.map((node) => (
        <PartnerBlock
          key={node.key}
          node={node}
          rows={node.rows
            .map((index) => byIndex.get(index))
            .filter((row): row is PartnerPreviewRow => row !== undefined)}
          selected={selected}
          onToggle={toggle}
          onToggleAll={(on) => togglePartner(node, on)}
        />
      ))}

      {refused.length > 0 && (
        <section className="flex flex-col gap-3 rounded border border-danger/40 bg-danger/5 p-4">
          <h3 className="text-sm font-medium">
            {t('partnerImport.refusedTitle', { count: refused.length })}
          </h3>
          <p className="text-sm text-foreground-muted">{t('partnerImport.refusedNote')}</p>
          <ul className="flex flex-col gap-2 text-sm">
            {refused.map((row) => (
              <li key={row.index} className="flex flex-col gap-0.5">
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className="tabular-nums text-foreground-muted">
                    {t('students.import.columnLine')} {row.line}
                  </span>
                  <span className="font-medium">
                    {row.partnerName === '' ? t('partnerImport.noName') : row.partnerName}
                  </span>
                  {row.groupName !== '' && (
                    <span className="text-foreground-muted">· {row.groupName}</span>
                  )}
                </span>
                <RowNotes row={row} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <Problem
        {...(state.errorKey !== undefined ? { errorKey: state.errorKey } : {})}
        {...(state.detail !== undefined ? { detail: state.detail } : {})}
      />

      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={pending || creating + updating === 0} className={BUTTON}>
          {pending
            ? t('students.import.importing')
            : t('partnerImport.importCount', {
                partners: newPartners,
                groups: creating + updating,
              })}
        </button>
        <button type="button" onClick={onBack} className={BUTTON_QUIET}>
          {t('students.import.backToMapping')}
        </button>
      </div>
    </form>
  );
}

/**
 * One partnership and its turmas.
 *
 * The heading says whether the partnership is new or one the club already has,
 * in words rather than by a colour — and the turmas underneath say the same
 * about themselves, because "a new school" and "a new class at a school we know"
 * are different facts and a commit does different things with them.
 */
function PartnerBlock({
  node,
  rows,
  selected,
  onToggle,
  onToggleAll,
}: {
  node: PartnerImportTree;
  rows: PartnerPreviewRow[];
  selected: Set<number>;
  onToggle: (index: number) => void;
  onToggleAll: (on: boolean) => void;
}): React.ReactElement {
  const t = useTranslations();
  const ticked = rows.filter((row) => selected.has(row.index)).length;

  return (
    <section className="overflow-hidden rounded border border-border bg-surface">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border bg-surface-muted px-4 py-3">
        <div className="flex items-center gap-2">
          <Building2 aria-hidden className="size-4 shrink-0 text-primary" />
          <h3 className="font-medium">{node.name}</h3>
          <span className="text-sm text-foreground-muted">
            {t(`partners.kind.${node.type}`)} ·{' '}
            {node.isNew ? t('partnerImport.partnerNew') : t('partnerImport.partnerKnown')}
          </span>
        </div>

        <div className="flex items-center gap-3 text-sm">
          <span className="text-foreground-muted">
            {t('partnerImport.groupsTicked', { ticked, total: rows.length })}
          </span>
          <button
            type="button"
            onClick={() => onToggleAll(ticked < rows.length)}
            className="rounded border border-border px-2 py-1 hover:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {ticked < rows.length
              ? t('partnerImport.tickAll')
              : t('partnerImport.untickAll')}
          </button>
        </div>
      </header>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-foreground-muted">
            <th scope="col" className="w-10 px-3 py-2">
              <span className="sr-only">{t('students.import.columnInclude')}</span>
            </th>
            <th scope="col" className="w-14 px-3 py-2">
              {t('students.import.columnLine')}
            </th>
            <th scope="col" className="px-3 py-2">
              {t('partners.field.groupName')}
            </th>
            <th scope="col" className="px-3 py-2">
              {t('partners.field.participantCount')}
            </th>
            <th scope="col" className="px-3 py-2">
              {t('students.import.columnState')}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.index} className="border-b border-border align-top last:border-0">
              <td className="px-3 py-2">
                <input
                  type="checkbox"
                  checked={selected.has(row.index)}
                  onChange={() => onToggle(row.index)}
                  aria-label={t('students.import.includeRow', { line: row.line })}
                  className="size-4 accent-[rgb(var(--primary))]"
                />
              </td>
              <td className="px-3 py-2 tabular-nums text-foreground-muted">{row.line}</td>
              <td className="px-3 py-2 font-medium">{row.groupName}</td>
              <td className="px-3 py-2 tabular-nums">
                <Headcount row={row} />
              </td>
              <td className="px-3 py-2">
                <RowNotes row={row} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/**
 * The headcount, and what a commit would change it to — criterion 5 / QA 48.3.
 *
 * `24 → 31` rather than "will update", because the two numbers are the entire
 * reason a club runs this a second time, and a promise without them is one the
 * operator cannot check.
 */
function Headcount({ row }: { row: PartnerPreviewRow }): React.ReactElement {
  const change = row.updates.find((update) => update.field === 'participantCount');
  if (change === undefined) return <span>{row.participantCount}</span>;

  return (
    <span className="flex items-center gap-1 text-primary">
      <span className="text-foreground-muted line-through">{change.before}</span>
      <span aria-hidden>→</span>
      <span className="font-medium">{change.after}</span>
    </span>
  );
}

/** Every problem, warning and stocktake note a row carries, in one column. */
function RowNotes({ row }: { row: PartnerPreviewRow }): React.ReactElement {
  const t = useTranslations();

  /*
   * The count has its own column, and `levelId` is a uuid.
   *
   * A level change is shown as the level's *name* — which the row already
   * carries, because the API resolved it — rather than as the two identifiers
   * the update actually names. A uuid in a preview is a cell nobody can check,
   * which is the same reason the export writes `levelName` and not `levelId`.
   */
  const otherUpdates = row.updates.filter(
    (update) => update.field !== 'participantCount' && update.field !== 'levelId',
  );
  const levelChanged = row.updates.some((update) => update.field === 'levelId');

  return (
    <div className="flex flex-col gap-1">
      {row.problems.map((problem, at) => (
        <span key={`p-${at}`} className="flex items-start gap-1.5 text-danger">
          <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          {t(`partnerImport.problem.${problem.code}`, { value: problem.value ?? '' })}
        </span>
      ))}

      {row.warnings.map((warning, at) => (
        <span key={`w-${at}`} className="flex items-start gap-1.5 text-warning">
          <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          {t(`partnerImport.warning.${warning.code}`, { value: warning.value ?? '' })}
        </span>
      ))}

      {row.repeatOfLine !== null && (
        <span className="flex items-start gap-1.5 text-foreground-muted">
          <Copy aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          {t('partnerImport.repeatOfLine', { line: row.repeatOfLine })}
        </span>
      )}

      {row.existing && (
        <span className="flex items-start gap-1.5 text-primary">
          <RefreshCw aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <span>
            {row.updates.length === 0
              ? t('partnerImport.nothingToChange')
              : t('partnerImport.stocktake')}
            {otherUpdates.length > 0 && (
              <span className="ml-1 text-foreground-muted">
                {otherUpdates
                  .map(
                    (update) =>
                      `${t(`partners.field.${update.field}`)}: ${
                        update.before === '' ? '—' : update.before
                      } → ${update.after === '' ? '—' : update.after}`,
                  )
                  .join(' · ')}
              </span>
            )}
            {levelChanged && (
              <span className="ml-1 text-foreground-muted">
                {t('partners.field.levelName')}: {row.levelName ?? '—'}
              </span>
            )}
          </span>
        </span>
      )}
    </div>
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
