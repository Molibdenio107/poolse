import { withOrg, type Tx } from '@poolse/db';

/**
 * When a water sample was taken — 13-10-2026 sweep.
 *
 * **A wall-clock string is the facility's clock, never the server's.** The web
 * sends a `datetime-local` value ("2026-07-14T10:30") with no zone, and
 * `new Date()` on it reads the *server's* zone — UTC on Railway and in the
 * database — so a Lisbon summer sample landed an hour early, a sample taken in
 * the last hour was refused as "in the future", and the 48-hour alert window
 * and the public page's stale flag were an hour out. The incident form already
 * did this right (`incidents.repository.ts`); this is the same conversion, done
 * by Postgres in `facility.timezone`.
 *
 * A string that names its own zone ("…Z", "…+01:00") is already an instant and
 * is kept as one: the API's tests and any machine client send those.
 */
export interface SampleMoment {
  raw: string;
  /** True when the string carries no zone and is the facility's wall clock. */
  local: boolean;
}

const WITH_ZONE = /(Z|[+-]\d{2}:?\d{2})$/i;
const SHAPE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/i;

/** The string as a moment to resolve, or null when it is not a date and time. */
export function sampleMoment(value: unknown): SampleMoment | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!SHAPE.test(raw) || Number.isNaN(new Date(raw).getTime())) return null;
  return { raw, local: !WITH_ZONE.test(raw) };
}

export class SampleInFutureError extends Error {}

/**
 * The instant, resolved in the pool's facility timezone; refuses a sample more
 * than a minute ahead of now (slack for a client clock) and one before 2000.
 * Null when the pool is not this club's.
 */
export async function resolveSample(tx: Tx, poolId: string, moment: SampleMoment): Promise<Date | null> {
  const { rows } = await tx.query<{ at: Date; future: boolean; ancient: boolean }>(
    `SELECT at, at > now() + interval '1 minute' AS future, at < TIMESTAMPTZ '2000-01-01' AS ancient
       FROM (
         SELECT CASE WHEN $3::boolean
                     THEN ($2::timestamp AT TIME ZONE coalesce(f.timezone, 'Europe/Lisbon'))
                     ELSE $2::timestamptz
                END AS at
           FROM pool p
           JOIN facility f ON f.id = p.facility_id AND f.organization_id = p.organization_id
          WHERE p.id = $1
       ) resolved`,
    [poolId, moment.raw, moment.local],
  );
  const row = rows[0];
  if (!row) return null;
  if (row.future || row.ancient) throw new SampleInFutureError();
  return row.at;
}

/** A pool's facility timezone, for converting a sheet's wall-clock times. */
export async function poolTimezone(tx: Tx, poolId: string): Promise<string> {
  const { rows } = await tx.query<{ tz: string }>(
    `SELECT coalesce(f.timezone, 'Europe/Lisbon') AS tz
       FROM pool p JOIN facility f ON f.id = p.facility_id AND f.organization_id = p.organization_id
      WHERE p.id = $1`,
    [poolId],
  );
  return rows[0]?.tz ?? 'Europe/Lisbon';
}

/** Where a wall-clock moment belongs, for `localInstant`. */
type Anchor = 'energy_meter' | 'maintenance_task';

/**
 * A moment typed on a facility's wall clock, as an ISO instant — for a meter
 * reading or a task completion, whose site is found through the row. A string
 * that already names its zone passes through. An unknown row falls back to
 * Lisbon, and the caller's own lookup then answers 404 as before.
 */
export async function localInstant(
  organizationId: string,
  anchor: Anchor,
  id: string,
  moment: SampleMoment,
): Promise<string> {
  if (!moment.local) return new Date(moment.raw).toISOString();
  const table = anchor === 'energy_meter' ? 'energy_meter' : 'maintenance_task';
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ at: Date }>(
      `SELECT ($2::timestamp AT TIME ZONE coalesce(
                 (SELECT f.timezone FROM ${table} x
                    JOIN facility f ON f.id = x.facility_id AND f.organization_id = x.organization_id
                   WHERE x.id::text = $1), 'Europe/Lisbon')) AS at`,
      [id, moment.raw],
    );
    return rows[0]!.at.toISOString();
  });
}
