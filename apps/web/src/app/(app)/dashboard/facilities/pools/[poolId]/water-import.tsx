'use client';

import { useActionState, useEffect, useMemo, useRef, useState, startTransition } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, Check, Upload, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DropOverlay, useFileDrop } from '@/components/file-drop';
import { CONTROL_LINE, FIELD_COLUMN, FIELD_LABEL } from '@/components/ui/field';
import type { NamedSheet } from '@/lib/sheet';
import {
  applyWaterMapping,
  matchWaterColumns,
  hasReadings,
  EMPTY_WATER_MAPPING,
  WATER_FIELDS,
  type WaterField,
  type WaterMapping,
} from '@/lib/water-sheet';
import {
  readWaterFileAction,
  runWaterImportAction,
  type WaterImportState,
  type WaterReadState,
} from './water-import.actions';

/**
 * Importing a club's water log — round 5, ticket 5.
 *
 * The fourth importer, and deliberately the smallest. The register's has to
 * resolve duplicate people and merge guardians; the store room's has to decide
 * whether a row updates a count or adds a line. A water log has neither: every
 * row is a new analysis, so the middle of this wizard is a mapping step and a
 * preview and nothing else.
 *
 * **The matching runs here, in the browser.** `matchWaterColumns` is pure and
 * there is no model call to keep server-side, so a round trip would be a network
 * request to run a function this bundle already has. `water-import.actions.ts`
 * says more about why this differs from its siblings.
 *
 * **A drop asks before it reads anything.** Files get dragged by accident, and a
 * screen that starts parsing one nobody meant to give it is a screen people stop
 * dragging onto — the same rule the Calendar's importer follows.
 */

const ACCEPTED = ['.xlsx', '.csv'];

const BUTTON =
  'inline-flex items-center gap-2 rounded bg-primary px-4 py-2 text-sm font-medium ' +
  'text-primary-foreground hover:bg-primary/90 disabled:opacity-60 ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

const BUTTON_QUIET =
  'inline-flex items-center gap-2 rounded border border-border px-4 py-2 text-sm ' +
  'hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 ' +
  'focus-visible:outline-offset-2 focus-visible:outline-primary';

function isAccepted(file: File): boolean {
  const name = file.name.toLowerCase();
  return ACCEPTED.some((extension) => name.endsWith(extension));
}

type Step = 'closed' | 'reading' | 'mapping' | 'preview' | 'done';

export function WaterImport({
  poolId,
  canManage,
}: {
  poolId: string;
  canManage: boolean;
}): React.ReactElement | null {
  const t = useTranslations();

  const [step, setStep] = useState<Step>('closed');
  const [sheetAt, setSheetAt] = useState(0);
  const [mapping, setMapping] = useState<WaterMapping>(EMPTY_WATER_MAPPING);
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const fileInput = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const [read, readAction, reading] = useActionState(readWaterFileAction, {
    ok: false,
    attempt: 0,
  } as WaterReadState);

  const [result, importAction, importing] = useActionState(runWaterImportAction, {
    ok: false,
    attempt: 0,
  } as WaterImportState);

  const sheets = read.sheets ?? [];
  const sheet: NamedSheet | undefined = sheets[sheetAt];

  /*
   * A dropped file opens the picker rather than being read.
   *
   * The browser's own default for a dropped spreadsheet is to navigate away and
   * render it, losing the page — so the overlay and this handler exist as much
   * to prevent that as to offer the feature.
   */
  const { dragging } = useFileDrop((file) => {
    if (!canManage || !isAccepted(file)) return;

    const transfer = new DataTransfer();
    transfer.items.add(file);
    if (fileInput.current !== null) {
      fileInput.current.files = transfer.files;
      setStep('reading');
      startTransition(() => formRef.current?.requestSubmit());
    }
  });

  // A freshly read file proposes its mapping, and a freshly chosen sheet re-proposes it.
  useEffect(() => {
    if (sheet === undefined) return;
    setMapping(matchWaterColumns(sheet).mapping);
    setStep('mapping');
  }, [sheet]);

  useEffect(() => {
    if (result.rows === undefined) return;
    setStep(result.created === undefined ? 'preview' : 'done');
  }, [result.attempt, result.rows, result.created]);

  const rows = useMemo(
    () => (sheet === undefined ? [] : sheet.rows.map((row) => applyWaterMapping(row, mapping))),
    [sheet, mapping],
  );

  const importable = (result.rows ?? []).filter((row) => row.importable);
  const ticked = importable.filter((row) => !excluded.has(row.index)).map((row) => row.index);

  if (!canManage) return null;

  return (
    <>
      <DropOverlay shown={dragging} label={t('facilities.waterImport.drop')} />

      {/*
        Always visible, primary, in the page header — the ticket's own words. The
        old control was a text link inside a card most operators never scrolled
        to. `bg-primary` with `text-primary-foreground` is a token pair, so it
        carries its own contrast in both themes rather than being a colour that
        happens to work in one.
      */}
      <button type="button" className={BUTTON} onClick={() => setStep('reading')}>
        <Upload aria-hidden className="size-4" />
        {t('facilities.waterImport.action')}
      </button>

      <form ref={formRef} action={readAction} className="hidden">
        <input
          ref={fileInput}
          type="file"
          name="file"
          accept=".xlsx,.csv,text/csv"
          onChange={() => startTransition(() => formRef.current?.requestSubmit())}
        />
      </form>

      {step !== 'closed' && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('facilities.waterImport.action')}
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8"
        >
          <div className="w-full max-w-4xl rounded-lg border border-border bg-surface p-5 shadow-lg">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-medium">{t('facilities.waterImport.action')}</h2>
                <p className="text-sm text-foreground-muted">
                  {read.fileName === undefined || read.fileName === ''
                    ? t('facilities.waterImport.hint')
                    : read.fileName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setStep('closed')}
                aria-label={t('common.close')}
                className="rounded p-1 hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                <X aria-hidden className="size-4" />
              </button>
            </div>

            {read.errorKey !== undefined && (
              <p className="mb-4 flex items-center gap-2 rounded border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
                <AlertTriangle aria-hidden className="size-4 shrink-0" />
                {t(read.errorKey)}
              </p>
            )}

            {result.errorKey !== undefined && (
              <p className="mb-4 flex items-center gap-2 rounded border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
                <AlertTriangle aria-hidden className="size-4 shrink-0" />
                {t(result.errorKey)}
                {result.detail !== undefined && (
                  <span className="font-mono text-xs text-foreground-muted">{result.detail}</span>
                )}
              </p>
            )}

            {step === 'reading' && sheets.length === 0 && (
              <div className="flex flex-col items-start gap-3 py-6">
                <p className="text-sm text-foreground-muted">
                  {t('facilities.waterImport.choose')}
                </p>
                <button
                  type="button"
                  className={BUTTON}
                  disabled={reading}
                  onClick={() => fileInput.current?.click()}
                >
                  <Upload aria-hidden className="size-4" />
                  {t('facilities.waterImport.pick')}
                </button>
              </div>
            )}

            {step === 'mapping' && sheet !== undefined && (
              <Mapping
                sheet={sheet}
                sheets={sheets}
                sheetAt={sheetAt}
                onSheet={setSheetAt}
                mapping={mapping}
                onMapping={setMapping}
              />
            )}

            {(step === 'preview' || step === 'done') && result.rows !== undefined && (
              <Preview
                rows={result.rows}
                summary={result.summary}
                created={result.created}
                skipped={result.skipped}
                excluded={excluded}
                onToggle={(index) =>
                  setExcluded((was) => {
                    const next = new Set(was);
                    if (next.has(index)) next.delete(index);
                    else next.add(index);
                    return next;
                  })
                }
              />
            )}

            <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
              {step === 'mapping' && (
                <form action={importAction}>
                  <input type="hidden" name="poolId" value={poolId} />
                  <input type="hidden" name="rows" value={JSON.stringify(rows)} />
                  <input type="hidden" name="commit" value="false" />
                  <button
                    type="submit"
                    className={BUTTON}
                    disabled={importing || !hasReadings(mapping)}
                  >
                    {t('facilities.waterImport.check')}
                  </button>
                </form>
              )}

              {step === 'preview' && (
                <>
                  <button type="button" className={BUTTON_QUIET} onClick={() => setStep('mapping')}>
                    {t('common.back')}
                  </button>
                  <form action={importAction}>
                    <input type="hidden" name="poolId" value={poolId} />
                    <input type="hidden" name="rows" value={JSON.stringify(rows)} />
                    <input type="hidden" name="include" value={JSON.stringify(ticked)} />
                    <input type="hidden" name="commit" value="true" />
                    <button
                      type="submit"
                      className={BUTTON}
                      disabled={importing || ticked.length === 0}
                    >
                      <Check aria-hidden className="size-4" />
                      {t('facilities.waterImport.commit', { count: ticked.length })}
                    </button>
                  </form>
                </>
              )}

              {step === 'done' && (
                <button type="button" className={BUTTON} onClick={() => setStep('closed')}>
                  {t('common.close')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Which column is which.
 *
 * Every field is a `<select>` over the file's own headers, seeded with what the
 * matcher proposed. A proposal is never a decision: the operator sees every one
 * and can change any of them, which is the whole point of the mapping step
 * existing at all.
 */
function Mapping({
  sheet,
  sheets,
  sheetAt,
  onSheet,
  mapping,
  onMapping,
}: {
  sheet: NamedSheet;
  sheets: NamedSheet[];
  sheetAt: number;
  onSheet: (at: number) => void;
  mapping: WaterMapping;
  onMapping: (mapping: WaterMapping) => void;
}): React.ReactElement {
  const t = useTranslations();

  return (
    <div className="flex flex-col gap-4">
      {/* A workbook with a tab per tank is ordinary, so the tab is chosen, not guessed. */}
      {sheets.length > 1 && (
        <div className={FIELD_COLUMN + ' sm:max-w-64'}>
          <label htmlFor="water-sheet" className={FIELD_LABEL}>
            {t('facilities.waterImport.sheet')}
          </label>
          <select
            id="water-sheet"
            className={CONTROL_LINE}
            value={sheetAt}
            onChange={(event) => onSheet(Number(event.target.value))}
          >
            {sheets.map((candidate, at) => (
              <option key={candidate.name} value={at}>
                {candidate.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {WATER_FIELDS.map((field) => (
          <div key={field} className={FIELD_COLUMN}>
            <label htmlFor={`map-${field}`} className={FIELD_LABEL}>
              {t(`facilities.waterImport.field.${field}`)}
            </label>
            <select
              id={`map-${field}`}
              className={CONTROL_LINE}
              value={mapping[field] ?? ''}
              onChange={(event) =>
                onMapping({
                  ...mapping,
                  [field]: event.target.value === '' ? null : Number(event.target.value),
                } as WaterMapping)
              }
            >
              <option value="">{t('facilities.waterImport.unmapped')}</option>
              {sheet.headers.map((header, at) => (
                <option key={`${header}-${at}`} value={at}>
                  {header === '' ? t('facilities.waterImport.column', { at: at + 1 }) : header}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      {!hasReadings(mapping) && (
        <p className="text-sm text-foreground-muted">{t('facilities.waterImport.needBoth')}</p>
      )}
    </div>
  );
}

/** What will be written, and what will not, before anything is. */
function Preview({
  rows,
  summary,
  created,
  skipped,
  excluded,
  onToggle,
}: {
  rows: NonNullable<WaterImportState['rows']>;
  summary: WaterImportState['summary'];
  created: number | undefined;
  skipped: number | undefined;
  excluded: Set<number>;
  onToggle: (index: number) => void;
}): React.ReactElement {
  const t = useTranslations();

  return (
    <div className="flex flex-col gap-3">
      {created === undefined ? (
        <p className="text-sm">
          {t('facilities.waterImport.summary', {
            total: summary?.total ?? 0,
            importable: summary?.importable ?? 0,
            refused: summary?.refused ?? 0,
          })}
        </p>
      ) : (
        <p className="flex items-center gap-2 rounded border border-success/40 bg-success/10 p-3 text-sm">
          <Check aria-hidden className="size-4 shrink-0" />
          {t('facilities.waterImport.done', { created, skipped: skipped ?? 0 })}
        </p>
      )}

      <div className="max-h-96 overflow-y-auto rounded border border-border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-surface-muted text-left">
            <tr>
              <th scope="col" className="p-2 font-medium">
                {t('facilities.waterImport.line')}
              </th>
              <th scope="col" className="p-2 font-medium">
                {t('facilities.waterImport.field.takenOn')}
              </th>
              <th scope="col" className="p-2 font-medium">
                {t('facilities.waterImport.readings')}
              </th>
              <th scope="col" className="p-2 font-medium">
                {t('facilities.waterImport.state')}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.index} className="border-t border-border align-top">
                <td className="p-2 tabular-nums text-foreground-muted">{row.line}</td>
                <td className="p-2 tabular-nums">
                  {row.takenOn}
                  {row.takenTime !== null && ` ${row.takenTime}`}
                </td>
                <td className="p-2">
                  {row.values.length === 0
                    ? '—'
                    : row.values
                        .map(
                          (value) =>
                            `${t(`facilities.metric.${value.metric}`)} ${value.value}`,
                        )
                        .join(' · ')}
                </td>
                <td className="p-2">
                  {/*
                    Never colour alone: every state carries its own words, so a
                    reader who cannot tell the red row from the amber one still
                    knows which is refused and which is merely repeated.
                  */}
                  {row.problems.length > 0 ? (
                    <span className="text-danger">
                      {row.problems
                        .map((problem) =>
                          problem === 'valueInvalid'
                            ? t('facilities.waterImport.problem.valueInvalid', {
                                metrics: row.badMetrics
                                  .map((metric) => t(`facilities.metric.${metric}`))
                                  .join(', '),
                              })
                            : t(`facilities.waterImport.problem.${problem}`),
                        )
                        .join(' · ')}
                    </span>
                  ) : (
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={created === undefined ? !excluded.has(row.index) : false}
                        disabled={created !== undefined}
                        onChange={() => onToggle(row.index)}
                        className="size-4 accent-primary"
                      />
                      <span
                        className={cn(
                          row.warnings.length > 0 ? 'text-warning' : 'text-foreground-muted',
                        )}
                      >
                        {row.warnings.length === 0
                          ? t('facilities.waterImport.willImport')
                          : row.warnings
                              .map((warning) => t(`facilities.waterImport.warning.${warning}`))
                              .join(' · ')}
                      </span>
                    </label>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
