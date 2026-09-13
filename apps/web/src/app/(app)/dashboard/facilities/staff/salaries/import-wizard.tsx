'use client';

import { useActionState, useMemo, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { AlertTriangle, Check, ShieldAlert, Upload } from 'lucide-react';
import { CONTROL_LINE, FIELD_COLUMN, FIELD_LABEL } from '@/components/ui/field';
import { cn } from '@/lib/utils';
import { formatCents } from '@/lib/money';
import {
  EMPTY_SALARY_MAPPING,
  SALARY_FIELDS,
  hasKeyAndAmount,
  type SalaryField,
  type SalaryMapping,
} from '@/lib/salary-sheet';
import type { MatchResult, NamedSheet, Sheet } from '@/lib/sheet';
import { useImportWizard, type ImportStage } from '@/lib/use-import-wizard';
import {
  matchSheetAction,
  readSheetAction,
  runImportAction,
  type ImportState,
  type MatchState,
  type ReadState,
  type SalaryPreviewRow,
} from './import.actions';

/**
 * The pay list, in four steps — POOLSE-59.
 *
 * The partnerships' wizard with the vocabulary changed. The machine is
 * `useImportWizard`, shared with the register, the store room and the parcerias;
 * what is different here is what the preview has to say, and it is different in
 * three ways worth stating:
 *
 * **A row that changes nothing is not a problem.** Re-importing an exported file
 * is the ordinary case — a club exports in December, edits one column and sends
 * it back — so *sem alterações* is its own quiet state, unticked, alongside
 * *sem valor* for the lines belonging to somebody who has no rate yet.
 *
 * **A rejected row says who it could not pay and why.** Never a silent skip: a
 * payroll file is the wrong place to learn that a name went unmatched.
 *
 * **One person twice refuses the whole file.** Which of the two rows is their pay
 * is not something to guess, so the commit button shuts and says so — the same
 * shape as the timetable importer's unresolved clash.
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
 * The two keys first, because they are what the import turns on, and the three
 * numeric columns adjacent, because they are the ones somebody gets the wrong
 * way round — an amount, a count of hours and a count of months are all digits.
 */
const FIELD_ORDER: SalaryField[] = [
  'email',
  'taxNumber',
  'name',
  'kind',
  'amount',
  'weeklyHours',
  'payPeriods',
  'effectiveFrom',
  'provenance',
  'note',
];

function Problem({ errorKey, detail }: { errorKey?: string; detail?: string }): React.ReactElement | null {
  const t = useTranslations();
  if (errorKey === undefined) return null;

  return (
    <p className="flex items-start gap-2 rounded border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
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

export function SalaryImportWizard({
  initialFile = null,
  locale,
  onClose,
}: {
  /**
   * A file the operator dropped on the screen, handed straight in.
   *
   * The upload step is skipped for it — they have already chosen the file, and
   * showing them a picker to choose it again would be the screen not believing
   * what they just did.
   */
  initialFile?: File | null;
  /** For the amounts on the preview. A wage is read in the reader's own locale. */
  locale: string;
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
    restart,
  } = useImportWizard<SalaryField, SalaryPreviewRow>({
    empty: EMPTY_SALARY_MAPPING,
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

      {/*
        Said once, at the top, and it is the rule that surprises people: the file
        pays the staff the club already has. It cannot create a person, and it is
        deliberately not a way to add one.
      */}
      <p className="flex items-start gap-2 rounded border border-border bg-surface-muted p-3 text-sm">
        <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
        {t('salaries.import.matchedBy')}
      </p>

      {stage === 'upload' && (
        <section className="rounded border border-border bg-surface p-5">
          <form action={readAction} className="flex flex-col gap-4">
            <div className={cn(FIELD_COLUMN, 'max-w-form')}>
              <label htmlFor="salary-import-file" className={FIELD_LABEL}>
                {t('students.import.fileLabel')}
              </label>
              <input
                id="salary-import-file"
                name="file"
                type="file"
                required
                accept=".xlsx,.csv,text/csv"
                className={cn(
                  CONTROL_LINE,
                  'py-1.5 file:mr-3 file:rounded file:border-0 file:bg-surface-muted file:px-3 file:py-1 file:text-sm file:text-foreground',
                )}
              />
              <p className="text-sm text-foreground-muted">{t('salaries.import.fileHint')}</p>
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
          locale={locale}
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
            {t('salaries.import.doneCount', { count: created })}
          </p>
          <p className="text-sm text-foreground-muted">{t('salaries.import.doneHint')}</p>
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

function useRows(sheet: Sheet): string {
  return useMemo(() => JSON.stringify(sheet.rows), [sheet]);
}

function settingsJson(mapping: SalaryMapping, commit: boolean, include: number[]): string {
  return JSON.stringify({ mapping, commit, include });
}

function RequestFields({ rows, settings }: { rows: string; settings: string }): React.ReactElement {
  return (
    <>
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
  mapping: SalaryMapping,
  field: SalaryField | null,
  column: number | null,
): SalaryMapping {
  const next: SalaryMapping = { ...mapping };

  if (column !== null) {
    for (const other of SALARY_FIELDS) {
      if (next[other] === column) next[other] = null;
    }
  }
  if (field !== null) next[field] = column;
  return next;
}

function fieldOf(mapping: SalaryMapping, column: number): SalaryField | null {
  return SALARY_FIELDS.find((field) => mapping[field] === column) ?? null;
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
  match,
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
  mapping: SalaryMapping;
  onMapping: (mapping: SalaryMapping) => void;
  match: MatchResult<SalaryField> | null;
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

  // A key and an amount. Without a key there is nobody to pay; without an amount
  // there is nothing to record, and either way the preview would be one
  // complaint repeated forty times.
  const ready = hasKeyAndAmount(mapping);

  const settled = (match?.matches ?? []).filter((entry) => entry.confidence !== 'unsure');
  const doubtful = (match?.matches ?? []).filter((entry) => entry.confidence === 'unsure');
  const questions = [...doubtful.map((entry) => entry.column), ...(match?.unmatched ?? [])].sort(
    (a, b) => a - b,
  );

  const fieldOptions = [
    { value: '', label: t('students.import.notImported') },
    ...FIELD_ORDER.map((field) => ({ value: field, label: t(`salaries.field.${field}`) })),
  ];

  return (
    <form action={action} className="flex flex-col gap-5 rounded border border-border bg-surface p-5">
      <RequestFields rows={rows} settings={settingsJson(mapping, false, [])} />

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
          <label htmlFor="salary-map-sheet" className={FIELD_LABEL}>
            {t('students.import.sheetLabel')}
          </label>
          <select
            id="salary-map-sheet"
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
            <p className="mt-1 text-sm text-foreground-muted">{t('students.import.questionsHint')}</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {questions.map((column) => (
              <div key={column} className={cn(FIELD_COLUMN, 'max-w-none')}>
                <label htmlFor={`salary-col-${column}`} className={FIELD_LABEL}>
                  {sheet.headers[column] === ''
                    ? t('students.import.columnUnnamed', { number: column + 1 })
                    : sheet.headers[column]}
                </label>
                <select
                  id={`salary-col-${column}`}
                  value={fieldOf(mapping, column) ?? ''}
                  onChange={(event) =>
                    onMapping(
                      assign(
                        mapping,
                        event.target.value === '' ? null : (event.target.value as SalaryField),
                        event.target.value === '' ? null : column,
                      ),
                    )
                  }
                  className={CONTROL_LINE}
                >
                  {fieldOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {/* The sample is the whole reason the question is answerable at a glance. */}
                <p className="text-sm text-foreground-muted">
                  {t('students.import.sample', { value: sampleOf(sheet, column) })}
                </p>
              </div>
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
              <label htmlFor={`salary-map-${field}`} className={FIELD_LABEL}>
                {t(`salaries.field.${field}`)}
              </label>
              <select
                id={`salary-map-${field}`}
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

      {!ready && (
        <p className="flex items-start gap-2 text-sm text-danger">
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
          {t('salaries.import.keyRequired')}
        </p>
      )}

      <Problem
        {...(state.errorKey !== undefined ? { errorKey: state.errorKey } : {})}
        {...(state.detail !== undefined ? { detail: state.detail } : {})}
      />

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

/**
 * The preview — every row exactly as it will be saved, and nothing written yet.
 *
 * Four states, and each is a different thing for the operator to do:
 *
 * - **a change**, ticked, showing old → new;
 * - **sem alterações**, unticked, because the file agrees with what is recorded;
 * - **sem valor**, unticked, because the line has no amount — an exported row
 *   for somebody who has no rate yet, which makes the file a template;
 * - **a refusal**, which cannot be ticked at all and says why.
 */
function PreviewStep({
  locale,
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
  locale: string;
  rows: SalaryPreviewRow[];
  selected: Set<number>;
  onSelected: (selected: Set<number>) => void;
  sheet: Sheet;
  mapping: SalaryMapping;
  action: (formData: FormData) => void;
  pending: boolean;
  state: ImportState;
  onBack: () => void;
}): React.ReactElement {
  const t = useTranslations();
  const format = useFormatter();
  const sheetRows = useRows(sheet);

  const money = (cents: number): string => formatCents(locale, cents);
  const day = (value: string): string => format.dateTime(new Date(`${value}T00:00:00`), 'short');

  const refused = state.refusal !== null && state.refusal !== undefined;
  const summary = state.summary;

  const toggle = (index: number): void => {
    const next = new Set(selected);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    onSelected(next);
  };

  return (
    <form action={action} className="flex flex-col gap-5 rounded border border-border bg-surface p-5">
      <RequestFields rows={sheetRows} settings={settingsJson(mapping, true, [...selected])} />

      {summary !== undefined && (
        <p className="text-sm text-foreground-muted">
          {t('salaries.import.summary', {
            total: summary.total,
            importable: summary.importable,
            unchanged: summary.unchanged,
            rejected: summary.rejected,
          })}
        </p>
      )}

      {/*
        The whole file refused, said before the table rather than discovered at
        the bottom of it. The commit button is shut while it stands — which of
        two rows is somebody's pay is not a thing to guess.
      */}
      {refused && (
        <p className="flex items-start gap-2 rounded border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
          {t('salaries.import.refusedDuplicate')}
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-foreground-muted">
              <th scope="col" className="px-2 py-2 font-medium">
                <span className="sr-only">{t('salaries.import.include')}</span>
              </th>
              <th scope="col" className="px-2 py-2 font-medium">#</th>
              <th scope="col" className="px-2 py-2 font-medium">{t('salaries.field.name')}</th>
              <th scope="col" className="px-2 py-2 font-medium">{t('salaries.import.change')}</th>
              <th scope="col" className="px-2 py-2 font-medium">{t('salaries.field.effectiveFrom')}</th>
              <th scope="col" className="px-2 py-2 font-medium">{t('salaries.import.state')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.index} className="border-b border-border/60 last:border-0 align-top">
                <td className="px-2 py-2">
                  <input
                    type="checkbox"
                    checked={selected.has(row.index)}
                    disabled={!row.importable || refused}
                    onChange={() => toggle(row.index)}
                    aria-label={t('salaries.import.includeLine', { line: row.line })}
                    className="size-4 accent-primary disabled:opacity-40"
                  />
                </td>
                <td className="px-2 py-2 tabular-nums text-foreground-muted">{row.line}</td>
                <td className="px-2 py-2">
                  {/*
                    Who the club says it is, not who the file says. A file with a
                    misspelled name matched by email is right; showing the file's
                    spelling would hide that it found the right person.
                  */}
                  <span className="font-medium">{row.matchedName ?? row.name}</span>
                  {row.email !== null && (
                    <span className="block text-xs text-foreground-muted">{row.email}</span>
                  )}
                </td>
                <td className="px-2 py-2 tabular-nums">
                  {row.amountCents === null ? (
                    <span className="text-foreground-muted">—</span>
                  ) : (
                    <>
                      {row.current !== null && (
                        <span className="text-foreground-muted line-through">
                          {money(row.current.amountCents)}
                        </span>
                      )}{' '}
                      <span>{money(row.amountCents)}</span>
                      {row.kind !== null && (
                        <span className="block text-xs text-foreground-muted">
                          {t(`salaries.kind.${row.kind}`)}
                        </span>
                      )}
                    </>
                  )}
                </td>
                <td className="px-2 py-2 tabular-nums">
                  {row.effectiveFrom === null ? (
                    <span className="text-foreground-muted">—</span>
                  ) : (
                    day(row.effectiveFrom)
                  )}
                </td>
                <td className="px-2 py-2">
                  {row.problems.length > 0 ? (
                    <ul className="space-y-0.5">
                      {row.problems.map((problem) => (
                        <li key={problem} className="text-danger">
                          {problem === 'duplicateInFile' && row.repeatOfLine !== null
                            ? t('salaries.import.problem.duplicateInFile', {
                                line: row.repeatOfLine,
                              })
                            : t(`salaries.import.problem.${problem}`)}
                        </li>
                      ))}
                    </ul>
                  ) : row.unchanged ? (
                    <span className="text-foreground-muted">{t('salaries.import.unchanged')}</span>
                  ) : row.blank ? (
                    <span className="text-foreground-muted">{t('salaries.import.noAmount')}</span>
                  ) : (
                    <span className="text-primary">{t('salaries.import.willWrite')}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Problem
        {...(state.errorKey !== undefined ? { errorKey: state.errorKey } : {})}
        {...(state.detail !== undefined ? { detail: state.detail } : {})}
      />

      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={pending || refused || selected.size === 0}
          className={BUTTON}
        >
          {pending
            ? t('students.import.importing')
            : t('salaries.import.commit', { count: selected.size })}
        </button>
        <button type="button" onClick={onBack} className={BUTTON_QUIET}>
          {t('students.import.backToMapping')}
        </button>
      </div>
    </form>
  );
}
