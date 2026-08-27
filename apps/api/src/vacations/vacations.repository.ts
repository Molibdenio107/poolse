import { withOrg } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';

/**
 * Leave, read and written — backlog round 3, stories 6, 7 and 8.
 *
 * Ordinary tenant-scoped SQL throughout. Nothing here needs a `SECURITY DEFINER`
 * function: every question is asked by somebody who already has a membership, so
 * RLS supplies the `WHERE organization_id` that none of these queries write out.
 */

export type VacationStatus = 'pending' | 'approved' | 'rejected' | 'withdrawn';

export interface VacationRequest {
  id: string;
  membershipId: string;
  personName: string | null;
  status: VacationStatus;
  requestedAt: string;
  decidedAt: string | null;
  decidedByName: string | null;
  decisionNote: string | null;
  /** ISO dates, ascending. */
  days: string[];
}

export interface Holiday {
  /** ISO date. */
  day: string;
  name: string;
  scope: 'national' | 'municipal';
}

export interface Balance {
  entitlement: number;
  taken: number;
  requested: number;
  remaining: number;
}

/**
 * A `date` column as the calendar day it is, not as an instant.
 *
 * node-postgres builds a Date in the server's local timezone; `toISOString()`
 * converts to UTC first, which west of Greenwich turns the 1st into the 31st of
 * the month before. Read the parts back in the timezone they were built in.
 */
function isoDate(value: Date | string): string {
  if (typeof value === 'string') return value.slice(0, 10);
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, '0');
  const day = `${value.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** The person's display name, assembled the same way everywhere. */
const NAME_SQL = `
  nullif(btrim(coalesce(u.cached_first_name, '') || ' ' || coalesce(u.cached_last_name, '')), '')
`;

interface RequestRow {
  id: string;
  membership_id: string;
  person_name: string | null;
  status: VacationStatus;
  requested_at: Date;
  decided_at: Date | null;
  decided_by_name: string | null;
  decision_note: string | null;
  days: string[] | null;
}

function toRequest(row: RequestRow): VacationRequest {
  return {
    id: row.id,
    membershipId: row.membership_id,
    personName: row.person_name,
    status: row.status,
    requestedAt: row.requested_at.toISOString(),
    decidedAt: row.decided_at?.toISOString() ?? null,
    decidedByName: row.decided_by_name,
    decisionNote: row.decision_note,
    days: (row.days ?? []).map(isoDate),
  };
}

/**
 * Selected once and reused, because the approval queue and a person's own year
 * differ only in their WHERE clause — and two copies of this join is two places
 * for the name assembly to drift.
 */
const REQUEST_SELECT = `
  SELECT vr.id,
         vr.membership_id,
         ${NAME_SQL} AS person_name,
         vr.status,
         vr.requested_at,
         vr.decided_at,
         (
           SELECT ${NAME_SQL.replace(/u\./g, 'du.')}
             FROM membership dm
             LEFT JOIN app_user du ON du.id = dm.app_user_id
            WHERE dm.id = vr.decided_by_membership_id
         ) AS decided_by_name,
         vr.decision_note,
         (
           SELECT coalesce(json_agg(vd.day ORDER BY vd.day), '[]'::json)
             FROM vacation_day vd
            WHERE vd.vacation_request_id = vr.id
              AND vd.organization_id = vr.organization_id
              AND vd.archived_at IS NULL
         ) AS days
    FROM vacation_request vr
    JOIN membership m ON m.id = vr.membership_id AND m.organization_id = vr.organization_id
    LEFT JOIN app_user u ON u.id = m.app_user_id
`;

/**
 * One person's requests touching a year.
 *
 * Filtered on the *days*, not on `requested_at`: a request made in December for
 * the following January belongs to January's year, which is the year somebody is
 * looking at when they ask "what have I booked".
 */
export async function listMyRequests(
  organizationId: string,
  membershipId: string,
  year: number,
): Promise<VacationRequest[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<RequestRow>(
      `${REQUEST_SELECT}
       WHERE vr.membership_id = $1
         AND vr.archived_at IS NULL
         AND EXISTS (
               SELECT 1 FROM vacation_day vd
                WHERE vd.vacation_request_id = vr.id
                  AND vd.organization_id = vr.organization_id
                  AND EXTRACT(year FROM vd.day) = $2
             )
       ORDER BY vr.requested_at DESC`,
      [membershipId, year],
    );
    return rows.map(toRequest);
  });
}

/** The approval queue — story 7. Oldest first: the longest wait is answered first. */
export async function listPendingRequests(organizationId: string): Promise<VacationRequest[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<RequestRow>(
      `${REQUEST_SELECT}
       WHERE vr.status = 'pending' AND vr.archived_at IS NULL
       ORDER BY vr.requested_at`,
    );
    return rows.map(toRequest);
  });
}

export interface TeamMember {
  membershipId: string;
  name: string | null;
  /** Approved days only. A pending request is not cover you can plan around. */
  days: string[];
}

/**
 * Everybody's approved leave in a year — story 8's team map.
 *
 * Approved only, deliberately. The map exists to spot gaps in cover before
 * approving anything, and a pending request is precisely what has not been
 * agreed yet — colouring it in would make the map assert something nobody has
 * decided.
 *
 * Returns every active staff member, including those with no leave, because the
 * "Mostrar todos" list needs somebody to be listed before they can be ticked.
 */
export async function listTeamYear(organizationId: string, year: number): Promise<TeamMember[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      membership_id: string;
      name: string | null;
      days: string[] | null;
    }>(
      `
      SELECT m.id AS membership_id,
             ${NAME_SQL} AS name,
             (
               SELECT coalesce(json_agg(vd.day ORDER BY vd.day), '[]'::json)
                 FROM vacation_day vd
                 JOIN vacation_request vr
                   ON vr.id = vd.vacation_request_id
                  AND vr.organization_id = vd.organization_id
                WHERE vd.membership_id = m.id
                  AND vd.organization_id = m.organization_id
                  AND vd.archived_at IS NULL
                  AND vr.status = 'approved'
                  AND EXTRACT(year FROM vd.day) = $1
             ) AS days
        FROM membership m
        LEFT JOIN app_user u ON u.id = m.app_user_id
       WHERE m.status = 'active'
         AND m.archived_at IS NULL
         AND EXISTS (
               SELECT 1 FROM membership_role mr
                WHERE mr.membership_id = m.id
                  AND mr.archived_at IS NULL
                  AND mr.role IN ('owner', 'admin', 'instructor', 'maintenance')
             )
       ORDER BY ${NAME_SQL} NULLS LAST
      `,
      [year],
    );

    return rows.map((row) => ({
      membershipId: row.membership_id,
      name: row.name,
      days: (row.days ?? []).map(isoDate),
    }));
  });
}

/**
 * Public holidays in a year, from `closure`.
 *
 * Filtered on `source`, which is the line the whole feature rests on: a closure
 * for building works is not a public holiday and must not hand anybody a free
 * day. `packages/db/test/vacations.sql` test 8 holds that.
 *
 * A holiday closure is one day, so `starts_on` is the day. A multi-day closure
 * with a holiday source would be a seeding bug rather than a case to handle.
 */
export async function listHolidays(organizationId: string, year: number): Promise<Holiday[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ day: Date; name: string; source: string }>(
      `
      SELECT starts_on AS day, reason AS name, source
        FROM closure
       WHERE source IN ('national_holiday', 'municipal_holiday')
         AND archived_at IS NULL
         AND EXTRACT(year FROM starts_on) = $1
       ORDER BY starts_on
      `,
      [year],
    );

    return rows.map((row) => ({
      day: isoDate(row.day),
      name: row.name,
      scope: row.source === 'municipal_holiday' ? ('municipal' as const) : ('national' as const),
    }));
  });
}

/**
 * How many days somebody has, has taken, and has asked for.
 *
 * Approved and pending are counted separately because story 6 asks for both, and
 * because they mean different things: one is time you have lost, the other is
 * time you may still get back if the answer is no. The balance does not drop
 * until approval, which is the whole reason approval exists.
 *
 * Carry-over from the previous year is not modelled — a deliberate v1 limit, said
 * out loud on the screen rather than left to be discovered in April.
 */
export async function balanceFor(
  organizationId: string,
  membershipId: string,
  year: number,
): Promise<Balance> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      entitlement: number;
      taken: number;
      requested: number;
    }>(
      `
      SELECT m.vacation_days_per_year AS entitlement,
             (
               SELECT count(*)::int FROM vacation_day vd
                 JOIN vacation_request vr ON vr.id = vd.vacation_request_id
                                         AND vr.organization_id = vd.organization_id
                WHERE vd.membership_id = m.id
                  AND vd.organization_id = m.organization_id
                  AND vd.archived_at IS NULL
                  AND vr.status = 'approved'
                  AND EXTRACT(year FROM vd.day) = $2
             ) AS taken,
             (
               SELECT count(*)::int FROM vacation_day vd
                 JOIN vacation_request vr ON vr.id = vd.vacation_request_id
                                         AND vr.organization_id = vd.organization_id
                WHERE vd.membership_id = m.id
                  AND vd.organization_id = m.organization_id
                  AND vd.archived_at IS NULL
                  AND vr.status = 'pending'
                  AND EXTRACT(year FROM vd.day) = $2
             ) AS requested
        FROM membership m
       WHERE m.id = $1
      `,
      [membershipId, year],
    );

    const row = rows[0] ?? { entitlement: 0, taken: 0, requested: 0 };
    return {
      entitlement: row.entitlement,
      taken: row.taken,
      requested: row.requested,
      // Pending days are not subtracted: they have not been granted, and showing
      // a balance that already spends them would make somebody plan around days
      // they may not get.
      remaining: row.entitlement - row.taken,
    };
  });
}

export class DayUnavailableError extends Error {}

/**
 * Books a request and its days in one transaction.
 *
 * The unique index does the real work — one person cannot hold one day twice,
 * including across two requests. Catching it here turns a constraint name into a
 * sentence the person can act on, and the transaction means a request never
 * survives without the days it was made for.
 */
export async function createRequest(
  organizationId: string,
  membershipId: string,
  days: string[],
): Promise<string> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO vacation_request (organization_id, membership_id)
       VALUES ($1, $2) RETURNING id`,
      [organizationId, membershipId],
    );
    const id = rows[0]!.id;

    try {
      await tx.query(
        `INSERT INTO vacation_day (organization_id, vacation_request_id, membership_id, day)
         SELECT $1, $2, $3, unnest($4::date[])`,
        [organizationId, id, membershipId, days],
      );
    } catch (error) {
      if (isUniqueViolation(error)) throw new DayUnavailableError();
      throw error;
    }

    await recordAudit(tx, {
      action: 'vacation_request.created',
      entityType: 'vacation_request',
      entityId: id,
      data: { days },
    });

    return id;
  });
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';
}

/** Who owns a request and whether it is still open — the withdrawal check. */
export async function findRequestOwner(
  organizationId: string,
  requestId: string,
): Promise<{ membershipId: string; status: VacationStatus } | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ membership_id: string; status: VacationStatus }>(
      `SELECT membership_id, status FROM vacation_request
        WHERE id = $1 AND archived_at IS NULL`,
      [requestId],
    );
    const row = rows[0];
    return row ? { membershipId: row.membership_id, status: row.status } : null;
  });
}

export type DecisionOutcome = 'decided' | 'not_found' | 'not_pending';

/**
 * Approve, reject, or withdraw.
 *
 * `WHERE status = 'pending'` is not decoration: two managers opening the queue at
 * once would otherwise both decide the same request, and the second would
 * silently overwrite the first's reason. Whoever gets there second is told it is
 * already answered.
 *
 * The days of a refused or withdrawn request are released by a database trigger,
 * not here — there are three callers and the one that forgets is the one that
 * ships.
 */
export async function decideRequest(
  organizationId: string,
  requestId: string,
  status: Exclude<VacationStatus, 'pending'>,
  deciderMembershipId: string | null,
  note: string | null,
): Promise<DecisionOutcome> {
  return withOrg(organizationId, async (tx) => {
    const { rows: exists } = await tx.query<{ status: VacationStatus }>(
      `SELECT status FROM vacation_request WHERE id = $1 AND archived_at IS NULL`,
      [requestId],
    );
    if (!exists[0]) return 'not_found';
    if (exists[0].status !== 'pending') return 'not_pending';

    const { rows } = await tx.query<{ id: string }>(
      `UPDATE vacation_request
          SET status = $2,
              decided_at = now(),
              decided_by_membership_id = $3,
              decision_note = $4
        WHERE id = $1 AND status = 'pending' AND archived_at IS NULL
       RETURNING id`,
      [requestId, status, deciderMembershipId, note],
    );
    if (!rows[0]) return 'not_pending';

    await recordAudit(tx, {
      action: `vacation_request.${status}`,
      entityType: 'vacation_request',
      entityId: requestId,
      data: { note },
    });

    return 'decided';
  });
}

export interface DecisionNotice {
  email: string | null;
  personName: string | null;
  organizationName: string;
  organizationLocale: string;
  days: string[];
}

/**
 * Everything the decision email needs, read after the decision is committed.
 *
 * Read afterwards rather than gathered during the update, because sending must
 * not be able to roll back a decision that has already been made — an approval
 * that vanished because a mail server was briefly down would be far worse than
 * an email that never arrived.
 */
export async function findDecisionNotice(
  organizationId: string,
  requestId: string,
): Promise<DecisionNotice | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      email: string | null;
      person_name: string | null;
      organization_name: string;
      organization_locale: string;
      days: string[] | null;
    }>(
      `
      SELECT u.cached_email::text AS email,
             ${NAME_SQL} AS person_name,
             o.name AS organization_name,
             o.locale AS organization_locale,
             (
               SELECT coalesce(json_agg(vd.day ORDER BY vd.day), '[]'::json)
                 FROM vacation_day vd
                WHERE vd.vacation_request_id = vr.id
                  AND vd.organization_id = vr.organization_id
             ) AS days
        FROM vacation_request vr
        JOIN membership m ON m.id = vr.membership_id AND m.organization_id = vr.organization_id
        JOIN organization o ON o.id = vr.organization_id
        LEFT JOIN app_user u ON u.id = m.app_user_id
       WHERE vr.id = $1
      `,
      [requestId],
    );

    const row = rows[0];
    if (!row) return null;

    return {
      email: row.email,
      personName: row.person_name,
      organizationName: row.organization_name,
      organizationLocale: row.organization_locale,
      // Not filtered on archived_at: a rejection archives the days, and the
      // email still has to say which days were refused.
      days: (row.days ?? []).map(isoDate),
    };
  });
}

/** Who else is already off on these days — story 7 shows this before approving. */
export async function othersOffOn(
  organizationId: string,
  membershipId: string,
  days: string[],
): Promise<{ name: string | null; day: string }[]> {
  if (days.length === 0) return [];

  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ name: string | null; day: Date }>(
      `
      SELECT ${NAME_SQL} AS name, vd.day
        FROM vacation_day vd
        JOIN vacation_request vr ON vr.id = vd.vacation_request_id
                                AND vr.organization_id = vd.organization_id
        JOIN membership m ON m.id = vd.membership_id AND m.organization_id = vd.organization_id
        LEFT JOIN app_user u ON u.id = m.app_user_id
       WHERE vd.archived_at IS NULL
         AND vr.status = 'approved'
         AND vd.membership_id <> $1
         AND vd.day = ANY($2::date[])
       ORDER BY vd.day, name
      `,
      [membershipId, days],
    );
    return rows.map((row) => ({ name: row.name, day: isoDate(row.day) }));
  });
}

/** Story 6's entitlement, set by an admin. */
export async function setEntitlement(
  organizationId: string,
  membershipId: string,
  days: number,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `UPDATE membership SET vacation_days_per_year = $2
        WHERE id = $1 AND archived_at IS NULL
       RETURNING id`,
      [membershipId, days],
    );
    if (!rows[0]) return false;

    await recordAudit(tx, {
      action: 'membership.entitlement_changed',
      entityType: 'membership',
      entityId: membershipId,
      data: { vacationDaysPerYear: days },
    });
    return true;
  });
}
