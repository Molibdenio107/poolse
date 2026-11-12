// `.ts` on the specifier: reached by `node --test` (see timetable-grid.ts).
import { clockMinutes, type TimetableReading } from './timetable-reading.ts';

/**
 * The mapping step of a timetable import — POOLSE-223, rule 4.
 *
 * After the reading and before the preview, a person says which Poolse pool each
 * pool the document names is, and what each activity becomes. This module is
 * the pure half: what is suggested, what the step lists, and the rows the API
 * gets once it is answered. The dialog only draws it.
 */

/** What an activity becomes. `skip` is *Não importar*. */
export type ActivityKind = 'evento' | 'free_swim' | 'skip';

/** A pool's choice: a Poolse pool id, `skip` (*Não importar*), or '' (not chosen yet). */
export type PoolChoice = string;

export const SKIP = 'skip';

export interface MappingPool {
  id: string;
  name: string;
}

/** Accents, case and punctuation off — the fold every name match here uses. */
export function foldName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** What the mapping step lists for a reading. */
export interface MappingOutline {
  /** The pools the document names, in order of first appearance. Empty: none named. */
  sourcePools: string[];
  /** Each activity with how many rows it has, in order of first appearance. */
  activities: { name: string; rows: number }[];
  /** Closed blocks, never imported (decided 2): only counted. */
  closed: number;
}

export function outline(reading: TimetableReading): MappingOutline {
  const sourcePools: string[] = [];
  const activities = new Map<string, number>();
  let closed = 0;
  for (const row of reading.rows) {
    if (row.sourcePool !== '' && !sourcePools.includes(row.sourcePool)) sourcePools.push(row.sourcePool);
    if (row.closed) closed += 1;
    else activities.set(row.activity, (activities.get(row.activity) ?? 0) + 1);
  }
  return { sourcePools, activities: [...activities].map(([name, rows]) => ({ name, rows })), closed };
}

/**
 * Each source pool's suggested Poolse pool. A name that matches one pool — the
 * same fold as lane names, whole or one inside the other ("Aprendizagem" in
 * "Piscina de Aprendizagem") — is preselected. Then, when exactly one source
 * pool and one Poolse pool are left, they are paired ("Piscina de 25 m" and
 * "Piscina principal"). Anything else is '' and must be chosen: two timetables
 * in one tank by default is how the first real file clashed everywhere.
 */
export function suggestPools(sourcePools: readonly string[], pools: readonly MappingPool[]): Record<string, PoolChoice> {
  const chosen: Record<string, PoolChoice> = {};
  const used = new Set<string>();
  const words = (name: string): string => foldName(name).replace(/\b(piscina|tanque|pool|de|da|do)\b/g, ' ').replace(/\s+/g, ' ').trim();

  for (const source of sourcePools) {
    const key = foldName(source);
    const core = words(source);
    const matches = pools.filter((pool) => {
      if (used.has(pool.id)) return false;
      const name = foldName(pool.name);
      const poolCore = words(pool.name);
      return name === key || (core !== '' && poolCore !== '' && (core.includes(poolCore) || poolCore.includes(core)));
    });
    if (matches.length === 1) {
      chosen[source] = matches[0]!.id;
      used.add(matches[0]!.id);
    } else {
      chosen[source] = '';
    }
  }

  const openSources = sourcePools.filter((source) => chosen[source] === '');
  const openPools = pools.filter((pool) => !used.has(pool.id));
  if (openSources.length === 1 && openPools.length === 1) chosen[openSources[0]!] = openPools[0]!.id;
  return chosen;
}

/** *Natação livre* / *Nado livre* / *Livre* are free swim (decided 1); everything else an evento. */
export function suggestKind(activity: string): ActivityKind {
  return /^((natacao|nado) )?livre$/.test(foldName(activity)) ? 'free_swim' : 'evento';
}

export function suggestKinds(activities: readonly { name: string }[]): Record<string, ActivityKind> {
  return Object.fromEntries(activities.map((activity) => [activity.name, suggestKind(activity.name)]));
}

/** One row as the API's import takes it (`RawTimetableRow`). */
export interface MappedRow {
  weekday: number;
  startTime: string;
  durationMinutes: number;
  name: string;
  laneNames: string[];
  laneCount: number | null;
  poolId: string | null;
  kind: 'evento' | 'free_swim';
  line: number;
}

/**
 * The rows the API gets: closed blocks out, *Não importar* out, each row with its
 * pool (a row with no source pool takes `defaultPoolId`, the dialog's step zero)
 * and kind. Null while a named pool is still unchosen.
 */
export function mapRows(
  reading: TimetableReading,
  pools: Record<string, PoolChoice>,
  kinds: Record<string, ActivityKind>,
  defaultPoolId: string | null,
): MappedRow[] | null {
  const rows: MappedRow[] = [];
  for (const row of reading.rows) {
    if (row.closed) continue;
    const kind = kinds[row.activity] ?? suggestKind(row.activity);
    if (kind === SKIP) continue;
    const pool = row.sourcePool === '' ? defaultPoolId : (pools[row.sourcePool] ?? '');
    if (pool === '') return null;
    if (pool === SKIP) continue;
    rows.push({
      weekday: row.weekday,
      startTime: row.start,
      durationMinutes: (clockMinutes(row.end) ?? 0) - (clockMinutes(row.start) ?? 0),
      name: row.activity,
      laneNames: row.laneNames,
      laneCount: row.laneNames.length > 0 ? null : row.lanes,
      poolId: pool,
      kind,
      line: row.line,
    });
  }
  return rows;
}
