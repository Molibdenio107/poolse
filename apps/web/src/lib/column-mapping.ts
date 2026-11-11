/**
 * Which spreadsheet column feeds which field — the one rule every column-mapping
 * importer applies (Rui, 11-11-2026: "other imports must work the same way").
 *
 * A column feeds at most one field and a field takes at most one column, so a
 * choice at either end clears the other. The importers show the same choice two
 * ways: column by column (the questions, and the salary list) and field by
 * field (the full grid, the water importer). Each way has its own function here,
 * because the bug this file exists for was a column view that said "no field"
 * by passing no column either, which changed nothing: *Não importar* on a column
 * the matcher had guessed snapped straight back to the guess. Keeping the column
 * in the call is now the helper's job, not each wizard's.
 */

export type ColumnMapping<F extends string> = Record<F, number | null>;

/** The field a column currently feeds, or null. */
export function fieldAtColumn<F extends string>(
  mapping: ColumnMapping<F>,
  fields: readonly F[],
  column: number,
): F | null {
  return fields.find((field) => mapping[field] === column) ?? null;
}

/**
 * Field view: this field takes this column, or none. A column it takes is
 * freed from whichever field had it.
 */
export function chooseColumnForField<F extends string>(
  mapping: ColumnMapping<F>,
  fields: readonly F[],
  field: F,
  column: number | null,
): ColumnMapping<F> {
  const next = { ...mapping };
  if (column !== null) {
    for (const other of fields) if (next[other] === column) next[other] = null;
  }
  next[field] = column;
  return next;
}

/**
 * Column view: this column feeds this field, or — with null — nothing
 * (*Não importar*). Whatever fed from the column before is cleared either way.
 */
export function chooseFieldForColumn<F extends string>(
  mapping: ColumnMapping<F>,
  fields: readonly F[],
  column: number,
  field: F | null,
): ColumnMapping<F> {
  const next = { ...mapping };
  for (const other of fields) if (next[other] === column) next[other] = null;
  if (field !== null) {
    next[field] = column;
  }
  return next;
}
