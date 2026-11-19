import { withOrg } from '@poolse/db';

/**
 * *Horário de nado livre* in the app — POOLSE-237 (Rui, 19-11-2026).
 *
 * **Counts and percentages, never a person.** Nothing here selects a member,
 * a pass, a check-in id or a name of anybody: the schedule is the calendar's
 * free-swim sessions, a closed tank is `closure_shuts_day`, and who is in the
 * water is `pool_occupancy()` — the one definition reception and the check-in
 * trigger read. The response's key set is pinned by a test, so an edit cannot
 * widen it by accident.
 *
 * **Days and times are the site's wall clock**, formatted here from
 * `facility.timezone`, so the phone shows what the club's own clock says.
 *
 * The window is today and the next 7 days: a fixed window, so the list is
 * exempt from pagination (CONVENTIONS, *Which lists paginate*).
 */

export const FREE_SWIM_DAYS = 7;
/** How old the "now" figure may be (rule 8). */
export const OCCUPANCY_CACHE_MS = 30_000;

export interface FreeSwimSession {
  /** `HH:mm` on the site's clock. */
  from: string;
  to: string;
  poolName: string | null;
  lanes: number;
}

export interface FreeSwimClosed {
  poolName: string;
  /** `yyyy-MM-dd`, the closure's last day. */
  until: string;
}

export interface FreeSwimDay {
  /** `yyyy-MM-dd` on the site's calendar. */
  date: string;
  sessions: FreeSwimSession[];
  closed: FreeSwimClosed[];
}

/** A free-swim session running now in a tank that has a capacity. */
export interface FreeSwimNow {
  poolName: string;
  from: string;
  to: string;
  occupied: number;
  capacity: number;
  /** Rounded down: a full tank is 100, never 101. */
  percent: number;
  /** `HH:mm` on the site's clock, when the figure was read. */
  readAt: string;
}

export interface FreeSwimSite {
  facilityId: string;
  name: string;
  /** `yyyy-MM-dd`: today on the site's clock, for *Hoje* and *Amanhã*. */
  today: string;
  days: FreeSwimDay[];
  now: FreeSwimNow[];
}

export interface FreeSwimSchedule {
  sites: FreeSwimSite[];
}

interface SessionRow {
  facility_id: string;
  site: string;
  today: string;
  day: string;
  from: string;
  to: string;
  pool_id: string | null;
  pool_name: string | null;
  lanes: number;
  cancelled: boolean;
  running: boolean;
}

interface Occupancy {
  occupied: number;
  capacity: number | null;
  readAt: string;
}

/**
 * Per club and tank, so one club's figure can never answer another's request.
 * Exported for the test that proves it; nothing else touches it.
 */
export const occupancyCache = new Map<string, { at: number; value: Occupancy }>();

export async function readFreeSwimSchedule(organizationId: string): Promise<FreeSwimSchedule> {
  return withOrg(organizationId, async (tx) => {
    // Every free-swim occurrence in the window, on its site's clock. The range on
    // `starts_at` is a coarse index-friendly bound; the site's own days decide.
    const { rows: sessions } = await tx.query<SessionRow>(
      `SELECT f.id AS facility_id, f.name AS site, (now() AT TIME ZONE f.timezone)::date::text AS today,
              (cs.starts_at AT TIME ZONE f.timezone)::date::text AS day,
              to_char(cs.starts_at AT TIME ZONE f.timezone, 'HH24:MI') AS "from",
              to_char((cs.starts_at + make_interval(mins => cs.duration_minutes)) AT TIME ZONE f.timezone,
                      'HH24:MI') AS "to",
              p.id AS pool_id, p.name AS pool_name,
              (SELECT count(*)::int FROM class_session_lane l
                WHERE l.session_id = cs.id AND l.organization_id = cs.organization_id
                  AND NOT l.cancelled) AS lanes,
              cs.status = 'cancelled' AS cancelled,
              (cs.status <> 'cancelled' AND now() >= cs.starts_at
               AND now() < cs.starts_at + make_interval(mins => cs.duration_minutes)) AS running
         FROM class_session cs
         JOIN class_schedule sch
           ON sch.id = cs.schedule_id AND sch.organization_id = cs.organization_id
          AND sch.subject_type = 'free_swim' AND sch.archived_at IS NULL
         JOIN facility f
           ON f.id = sch.facility_id AND f.organization_id = sch.organization_id AND f.archived_at IS NULL
         LEFT JOIN pool p
           ON p.id = sch.pool_id AND p.organization_id = sch.organization_id AND p.archived_at IS NULL
        WHERE cs.starts_at >= now() - interval '1 day'
          AND cs.starts_at < now() + make_interval(days => $1::int + 2)
          AND (cs.starts_at AT TIME ZONE f.timezone)::date
              BETWEEN (now() AT TIME ZONE f.timezone)::date
                  AND (now() AT TIME ZONE f.timezone)::date + $1::int
        ORDER BY lower(f.name), f.id, cs.starts_at, lower(p.name)`,
      [FREE_SWIM_DAYS],
    );
    if (sessions.length === 0) return { sites: [] };

    // The tanks that hold free swim in the window, and every day of it each is
    // shut for the whole day — a holiday shuts every tank (19-10-2026).
    const poolIds = [...new Set(sessions.map((row) => row.pool_id).filter((id): id is string => id !== null))];
    const { rows: closures } = await tx.query<{ facility_id: string; pool_name: string; day: string; until: string }>(
      `SELECT p.facility_id, p.name AS pool_name, d.day::text AS day,
              closure_until(c.starts_on, c.ends_on, c.repeats_annually, d.day)::text AS until
         FROM pool p
         JOIN facility f ON f.id = p.facility_id AND f.organization_id = p.organization_id
         CROSS JOIN LATERAL (
           SELECT g::date AS day
             FROM generate_series((now() AT TIME ZONE f.timezone)::date,
                                  (now() AT TIME ZONE f.timezone)::date + $2::int, interval '1 day') AS g
         ) d
         CROSS JOIN LATERAL (
           SELECT c.* FROM closure c
            WHERE c.organization_id = p.organization_id AND c.archived_at IS NULL
              AND closure_shuts_day(c, p.facility_id, ARRAY[p.id], d.day)
            ORDER BY c.ends_on DESC, c.created_at
            LIMIT 1
         ) c
        WHERE p.id = ANY($1::uuid[])
        ORDER BY d.day, lower(p.name)`,
      [poolIds, FREE_SWIM_DAYS],
    );

    // The tanks with free swim running now: their figure, at most 30 s old.
    const runningPools = [
      ...new Set(sessions.filter((row) => row.running && row.pool_id !== null).map((row) => row.pool_id!)),
    ];
    const occupancy = new Map<string, Occupancy>();
    const stale: string[] = [];
    for (const poolId of runningPools) {
      const hit = occupancyCache.get(`${organizationId}:${poolId}`);
      if (hit !== undefined && Date.now() - hit.at < OCCUPANCY_CACHE_MS) occupancy.set(poolId, hit.value);
      else stale.push(poolId);
    }
    if (stale.length > 0) {
      const { rows } = await tx.query<{ pool_id: string; capacity: number | null; occupied: number; read_at: string }>(
        `SELECT p.id AS pool_id, o.capacity, (o.swimmers + o.in_classes)::int AS occupied,
                to_char(now() AT TIME ZONE f.timezone, 'HH24:MI') AS read_at
           FROM pool p
           JOIN facility f ON f.id = p.facility_id AND f.organization_id = p.organization_id
           CROSS JOIN LATERAL pool_occupancy(p.organization_id, p.id) o
          WHERE p.id = ANY($1::uuid[])`,
        [stale],
      );
      for (const row of rows) {
        const value = { occupied: row.occupied, capacity: row.capacity, readAt: row.read_at };
        occupancyCache.set(`${organizationId}:${row.pool_id}`, { at: Date.now(), value });
        occupancy.set(row.pool_id, value);
      }
    }

    return { sites: assemble(sessions, closures, occupancy) };
  });
}

function assemble(
  sessions: SessionRow[],
  closures: { facility_id: string; pool_name: string; day: string; until: string }[],
  occupancy: Map<string, Occupancy>,
): FreeSwimSite[] {
  const sites = new Map<string, FreeSwimSite & { byDay: Map<string, FreeSwimDay> }>();
  const day = (site: FreeSwimSite & { byDay: Map<string, FreeSwimDay> }, date: string): FreeSwimDay => {
    let found = site.byDay.get(date);
    if (found === undefined) {
      found = { date, sessions: [], closed: [] };
      site.byDay.set(date, found);
    }
    return found;
  };

  for (const row of sessions) {
    let site = sites.get(row.facility_id);
    if (site === undefined) {
      site = { facilityId: row.facility_id, name: row.site, today: row.today, days: [], now: [], byDay: new Map() };
      sites.set(row.facility_id, site);
    }
    // A cancelled session is not shown; its closure, when it has one, is.
    if (!row.cancelled) {
      day(site, row.day).sessions.push({ from: row.from, to: row.to, poolName: row.pool_name, lanes: row.lanes });
    }
    if (row.running && row.pool_id !== null && row.pool_name !== null) {
      const figure = occupancy.get(row.pool_id);
      // No capacity, no percentage and no number (rule 4).
      if (figure !== undefined && figure.capacity !== null && figure.capacity > 0) {
        site.now.push({
          poolName: row.pool_name,
          from: row.from,
          to: row.to,
          occupied: figure.occupied,
          capacity: figure.capacity,
          percent: Math.floor((figure.occupied * 100) / figure.capacity),
          readAt: figure.readAt,
        });
      }
    }
  }
  for (const closure of closures) {
    const site = sites.get(closure.facility_id);
    if (site === undefined) continue;
    const date = day(site, closure.day);
    if (!date.closed.some((one) => one.poolName === closure.pool_name)) {
      date.closed.push({ poolName: closure.pool_name, until: closure.until });
    }
  }

  return [...sites.values()].map(({ byDay, ...site }) => ({
    ...site,
    days: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)),
  }));
}
