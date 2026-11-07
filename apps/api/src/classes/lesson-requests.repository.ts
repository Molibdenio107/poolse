import { withOrg, type Tx } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';
import { personShortName } from '../people/names.js';

/**
 * What a teacher asks of the office about one lesson — POOLSE-198.
 *
 * `substitute`: they cannot come. The office names who does, through the stand-in
 * it already has, and that closes the request. `cancelled`: they cancelled it
 * themselves, and the row is how the office is told; *Visto* closes it. Either way
 * it is a circle on the menu until somebody answers.
 */

export type CoverOutcome = 'opened' | 'already_open' | 'not_open' | 'over';

export interface LessonRequest {
  id: string;
  sessionId: string;
  kind: 'substitute' | 'cancelled';
  note: string | null;
  requestedBy: string;
  className: string;
  localDate: string;
  localTime: string;
  createdAt: string;
}

/** The teacher asks. A cancelled lesson, or one already over, needs no cover. */
export async function requestCover(
  organizationId: string,
  sessionId: string,
  membershipId: string,
  note: string | null,
): Promise<CoverOutcome> {
  return withOrg(organizationId, async (tx) => {
    const { rows: session } = await tx.query(
      `SELECT 1 FROM class_session WHERE id = $1 AND status <> 'cancelled' AND ends_at > now()`,
      [sessionId],
    );
    if (session.length === 0) return 'over';
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO lesson_request (organization_id, class_session_id, kind, requested_by_membership_id, note)
       VALUES ($1, $2, 'substitute', $3, $4)
       ON CONFLICT (organization_id, class_session_id, kind) WHERE closed_at IS NULL DO NOTHING
       RETURNING id`,
      [organizationId, sessionId, membershipId, note],
    );
    if (rows[0] === undefined) return 'already_open';
    await recordAudit(tx, {
      action: 'lesson_request.opened',
      entityType: 'class_session',
      entityId: sessionId,
      data: { kind: 'substitute' },
    });
    return 'opened';
  });
}

/** The teacher can come after all. Theirs to withdraw, and nobody else's. */
export async function withdrawCover(
  organizationId: string,
  sessionId: string,
  membershipId: string,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query(
      `UPDATE lesson_request
          SET closed_at = now(), closed_by_membership_id = $2, outcome = 'withdrawn'
        WHERE class_session_id = $1 AND requested_by_membership_id = $2
          AND kind = 'substitute' AND closed_at IS NULL
      RETURNING id`,
      [sessionId, membershipId],
    );
    if (rows.length === 0) return false;
    await recordAudit(tx, {
      action: 'lesson_request.withdrawn',
      entityType: 'class_session',
      entityId: sessionId,
    });
    return true;
  });
}

/**
 * Somebody was named, or the lesson was called off: an open request is answered.
 * Returns who asked, so they can be told.
 */
export async function closeCover(
  organizationId: string,
  sessionId: string,
  membershipId: string,
  outcome: 'assigned' | 'withdrawn',
): Promise<string | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ requested_by_membership_id: string }>(
      `UPDATE lesson_request
          SET closed_at = now(), closed_by_membership_id = $2, outcome = $3::lesson_request_outcome
        WHERE class_session_id = $1 AND kind = 'substitute' AND closed_at IS NULL
      RETURNING requested_by_membership_id`,
      [sessionId, membershipId, outcome],
    );
    return rows[0]?.requested_by_membership_id ?? null;
  });
}

/**
 * A lesson was called off, in the cancel's own transaction: an open request for
 * cover closes, and a teacher's cancellation becomes the office's circle.
 */
export async function closeOnCancelIn(
  tx: Tx,
  organizationId: string,
  sessionId: string,
  membershipId: string,
  /** The teacher's reason; null when the office cancelled it. */
  teacherReason: string | null,
): Promise<void> {
  await tx.query(
    `UPDATE lesson_request
        SET closed_at = now(), closed_by_membership_id = $2, outcome = 'withdrawn'
      WHERE class_session_id = $1 AND kind = 'substitute' AND closed_at IS NULL`,
    [sessionId, membershipId],
  );
  if (teacherReason === null) return;
  await tx.query(
    `INSERT INTO lesson_request (organization_id, class_session_id, kind, requested_by_membership_id, note)
     VALUES ($1, $2, 'cancelled', $3, $4)
     ON CONFLICT (organization_id, class_session_id, kind) WHERE closed_at IS NULL DO NOTHING`,
    [organizationId, sessionId, membershipId, teacherReason.slice(0, 500)],
  );
}

/** SQL: an open row still asks something of somebody. Cover for a lesson that is gone does not. */
export const REQUEST_WAITING = `r.closed_at IS NULL AND (r.kind = 'cancelled' OR EXISTS (
  SELECT 1 FROM class_session live
   WHERE live.id = r.class_session_id AND live.organization_id = r.organization_id
     AND live.status <> 'cancelled' AND live.ends_at > now()))`;

/** The office has read a cancellation. A request for cover closes by assigning. */
export async function markSeen(organizationId: string, id: string, membershipId: string): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query(
      `UPDATE lesson_request
          SET closed_at = now(), closed_by_membership_id = $2, outcome = 'seen'
        WHERE id = $1 AND kind = 'cancelled' AND closed_at IS NULL
      RETURNING id`,
      [id, membershipId],
    );
    return rows.length > 0;
  });
}

/** What is waiting for the office, oldest first. */
export async function openRequests(organizationId: string): Promise<LessonRequest[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      id: string;
      class_session_id: string;
      kind: 'substitute' | 'cancelled';
      note: string | null;
      requested_by: string;
      class_name: string;
      local_date: string;
      local_time: string;
      created_at: Date;
    }>(
      `SELECT r.id, r.class_session_id, r.kind, r.note,
              ${personShortName('r.requested_by_membership_id')} AS requested_by,
              coalesce(cg.name, '?') AS class_name,
              to_char(cs.starts_at AT TIME ZONE coalesce(f.timezone, 'Europe/Lisbon'), 'YYYY-MM-DD') AS local_date,
              to_char(cs.starts_at AT TIME ZONE coalesce(f.timezone, 'Europe/Lisbon'), 'HH24:MI') AS local_time,
              r.created_at
         FROM lesson_request r
         JOIN class_session cs ON cs.id = r.class_session_id AND cs.organization_id = r.organization_id
         LEFT JOIN class_group cg ON cg.id = cs.class_group_id AND cg.organization_id = cs.organization_id
         LEFT JOIN pool p ON p.id = cs.pool_id AND p.organization_id = cs.organization_id
         LEFT JOIN facility f ON f.id = p.facility_id AND f.organization_id = cs.organization_id
        WHERE ${REQUEST_WAITING}
        ORDER BY r.created_at`,
    );
    return rows.map((row) => ({
      id: row.id,
      sessionId: row.class_session_id,
      kind: row.kind,
      note: row.note,
      requestedBy: row.requested_by,
      className: row.class_name,
      localDate: row.local_date,
      localTime: row.local_time,
      createdAt: row.created_at.toISOString(),
    }));
  });
}

/** The request open on one lesson, for the lesson's own screens. */
export async function coverRequestOf(
  organizationId: string,
  sessionId: string,
): Promise<{ note: string | null; requestedBy: string } | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ note: string | null; requested_by: string }>(
      `SELECT r.note, ${personShortName('r.requested_by_membership_id')} AS requested_by
         FROM lesson_request r
        WHERE r.class_session_id = $1 AND r.kind = 'substitute' AND r.closed_at IS NULL`,
      [sessionId],
    );
    const row = rows[0];
    return row === undefined ? null : { note: row.note, requestedBy: row.requested_by };
  });
}
