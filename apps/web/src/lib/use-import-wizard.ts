'use client';

import { startTransition, useEffect, useRef, useState } from 'react';
import type { MatchResult, NamedSheet } from './sheet';

/**
 * The four steps every importer walks, in one place — round 5.
 *
 * The register's wizard and the store room's each carried their own copy of this
 * machine: the same four stages, the same nine pieces of state, the same three
 * effects keyed on `attempt`, and the same rule for what is ticked when the
 * preview opens. Two files, ~950 lines each, differing in what they *render* and
 * not at all in how they get there.
 *
 * **A hook rather than a component, and that is the whole design decision.** The
 * state machine is genuinely identical; the previews genuinely are not. The
 * register resolves duplicate people and merges guardians, the store room
 * decides whether a row updates a count or adds a line, and a shared component
 * would have had to grow a flag for each. So this owns the machine and each
 * wizard goes on owning its own screen.
 *
 * The calendar's importer is deliberately not a caller: it reads a grid layout
 * rather than columns, so it has no mapping step to share. The water log's is
 * not either — it matches in the browser, having no model call to keep on the
 * server, and is small enough that routing it through here would cost more than
 * it saved. Both are noted so the next reader knows they were considered rather
 * than missed.
 */

export type ImportStage = 'upload' | 'map' | 'preview' | 'done';

/**
 * The least a preview row must be for the machine to seed the tick boxes.
 *
 * `duplicate` is deliberately `unknown`: the two importers describe one very
 * differently, and all this needs to know is whether there is one.
 */
export interface ImportPreviewRow {
  index: number;
  importable: boolean;
  duplicate: unknown;
}

/** What the read action reports back. Both importers' shapes satisfy this. */
export interface ReadLike<F extends string> {
  ok: boolean;
  attempt: number;
  sheets?: NamedSheet[] | undefined;
  match?: MatchResult<F> | undefined;
  fileName?: string | undefined;
}

/** What the match action reports back, when a different sheet is chosen. */
export interface MatchLike<F extends string> {
  attempt: number;
  match?: MatchResult<F> | undefined;
}

/** What the preview-or-commit action reports back. */
export interface RunLike<R> {
  ok: boolean;
  attempt: number;
  committed?: boolean | undefined;
  result?: { rows: R[]; created?: number | undefined; updated?: number | undefined } | undefined;
}

export interface ImportWizard<F extends string, R> {
  stage: ImportStage;
  setStage: (stage: ImportStage) => void;
  sheets: NamedSheet[];
  /** The sheet being mapped, or null before a file has been read. */
  sheet: NamedSheet | null;
  sheetIndex: number;
  chooseSheet: (index: number) => void;
  match: MatchResult<F> | null;
  mapping: Record<F, number | null> | null;
  setMapping: (mapping: Record<F, number | null>) => void;
  rows: R[];
  selected: Set<number>;
  setSelected: (selected: Set<number>) => void;
  fileName: string;
  created: number;
  updated: number;
  /**
   * Back to the beginning, for "import another file".
   *
   * Every wizard had its own three-line version of this and each forgot a
   * different field — one left the sheets behind, so the picker still offered
   * tabs from a file that was no longer open.
   */
  restart: () => void;
}

export function useImportWizard<F extends string, R extends ImportPreviewRow>({
  empty,
  initialFile,
  readState,
  readAction,
  matchState,
  matchAction,
  runState,
}: {
  /** The empty mapping, which also names the fields. */
  empty: Record<F, number | null>;
  /** A file dropped on the page, read through the same action as a chosen one. */
  initialFile: File | null;
  readState: ReadLike<F>;
  readAction: (formData: FormData) => void;
  matchState: MatchLike<F>;
  matchAction: (formData: FormData) => void;
  runState: RunLike<R>;
}): ImportWizard<F, R> {
  const [stage, setStage] = useState<ImportStage>('upload');
  const [sheets, setSheets] = useState<NamedSheet[]>([]);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [match, setMatch] = useState<MatchResult<F> | null>(null);
  const [fileName, setFileName] = useState('');
  const [mapping, setMapping] = useState<Record<F, number | null> | null>(null);
  const [rows, setRows] = useState<R[]>([]);
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

  // Every effect keys on `attempt` rather than on `ok`, so a second upload of
  // the same file still moves the wizard on.
  useEffect(() => {
    if (readState.attempt === readAt.current) return;
    readAt.current = readState.attempt;
    if (!readState.ok || readState.sheets === undefined || readState.sheets.length === 0) return;

    setSheets(readState.sheets);
    setSheetIndex(0);
    setMatch(readState.match ?? null);
    setMapping(readState.match?.mapping ?? { ...empty });
    setFileName(readState.fileName ?? '');
    setStage('map');
    // `empty` is a module constant in both callers; listing it would re-run this
    // on every render if one ever inlined the object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
     * is not already there. Unticking the duplicates is the default both screens
     * argue for and the one the API takes when a caller sends no selection at
     * all — the three agree on purpose.
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

  const chooseSheet = (index: number): void => {
    const chosen = sheets[index];
    if (chosen === undefined) return;

    setSheetIndex(index);
    // Cleared rather than carried: the previous sheet's mapping is a set of
    // column *indexes* into a grid that no longer has those columns.
    setMapping({ ...empty });
    setMatch(null);

    const formData = new FormData();
    formData.set('sheet', JSON.stringify({ headers: chosen.headers, rows: chosen.rows }));
    startTransition(() => matchAction(formData));
  };

  const restart = (): void => {
    setSheets([]);
    setSheetIndex(0);
    setMatch(null);
    setMapping(null);
    setRows([]);
    setSelected(new Set());
    setFileName('');
    setStage('upload');
  };

  return {
    stage,
    setStage,
    sheets,
    sheet: sheets[sheetIndex] ?? null,
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
  };
}
