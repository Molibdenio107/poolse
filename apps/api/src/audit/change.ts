/**
 * What an edit changed, in the shape `audit_log.data` holds it — POOLSE-80.
 *
 * `{ before, after, withheld }`: `before` and `after` carry only the fields that
 * moved, and `withheld` names the ones that moved but whose values are kept out
 * of the log. Three kinds of field, decided per entity in one `ChangeSpec`:
 *
 * - **`values`** are recorded and can be reverted (a student's level, a turma's
 *   capacity, a register mark).
 * - **`shown`** are recorded and never reverted — money, which is corrected by
 *   its own history and never by a field revert (a turma's fee category).
 * - **`withheld`** are named and never valued: a person's phone, NIF, notes and
 *   name. An audit entry is readable by every admin, and a child's contact
 *   details do not belong in it twice — Rui, 16 October 2026.
 *
 * An entry with no `before` cannot be reverted, which is every entry written
 * before this file existed. The screen shows no *Reverter* for it.
 */

export interface ChangeSpec<F extends string> {
  values: readonly F[];
  shown?: readonly F[];
  withheld?: readonly F[];
}

export interface Change {
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  withheld: string[];
}

export function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** Null when nothing moved, so a save that changed nothing records no change. */
export function describeChange<F extends string>(
  spec: ChangeSpec<F>,
  before: Record<F, unknown>,
  after: Record<F, unknown>,
): Change | null {
  const change: Change = { before: {}, after: {}, withheld: [] };
  for (const field of [...spec.values, ...(spec.shown ?? [])]) {
    if (sameValue(before[field], after[field])) continue;
    change.before[field] = before[field] ?? null;
    change.after[field] = after[field] ?? null;
  }
  for (const field of spec.withheld ?? []) {
    if (!sameValue(before[field], after[field])) change.withheld.push(field);
  }
  const moved = Object.keys(change.before).length + change.withheld.length;
  return moved === 0 ? null : change;
}

/**
 * What a revert adds to the entry its own update writes: the entry it reverts.
 * That entry is then an ordinary change, which is what makes a revert revertible.
 */
export interface ChangeContext {
  revertOf?: string;
  /**
   * An advancement's context — POOLSE-112: why the level moved, which proposal
   * asked, and whether a machine did it on the season's first day (`automatic`,
   * actor null — *sistema*) rather than a person confirming.
   */
  reason?: 'skills' | 'age';
  proposalId?: string;
  automatic?: boolean;
}
