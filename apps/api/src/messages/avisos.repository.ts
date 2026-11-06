import { withOrg, type Tx } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';
import { NoRecipientsError, targetParams, type MessageAudience, type MessageTarget } from './messages.repository.js';

/**
 * Avisos — POOLSE-166 (Rui, 04-11-2026).
 *
 * A `message` with `channel = 'app'` and a window of club days. Never emailed:
 * the recipient rows it writes are a snapshot of who it reached, **with no
 * address**, so `deliverMessage` (which reads only `channel = 'email'`) and the
 * delivery retry (which reads only rows with an email) both pass it by. Who sees
 * it is decided live by `message_recipients_all()`, so a child enrolled in the
 * turma after it was posted sees it too.
 */

/** The audiences an aviso may take: the people the club teaches. */
export const AVISO_AUDIENCES = ['class_group', 'level', 'facility', 'organization', 'sport'] as const;

export type AvisoState = 'live' | 'upcoming' | 'past';

export interface AvisoSummary {
  id: string;
  audience: MessageAudience;
  targetId: string | null;
  targetName: string | null;
  subject: string;
  body: string;
  shownFrom: string;
  shownUntil: string;
  state: AvisoState;
  sentAt: string;
  sentByName: string | null;
  /** Students the aviso reached when it was posted. */
  studentCount: number;
  /** Whether this reader may end it: the office any, an instructor their own. */
  canArchive: boolean;
}

/** One aviso as the app shows it — POOLSE-166 rule 3. */
export interface AppAviso {
  id: string;
  subject: string;
  body: string;
  shownUntil: string;
  /** Which of the reader's own students it is about, by first name. */
  studentNames: string[];
}

/**
 * Posts an aviso: the message and its snapshot in one statement, as a send is.
 * Throws `NoRecipientsError` when the audience holds nobody today.
 */
export async function postAviso(
  organizationId: string,
  sentByMembershipId: string,
  target: MessageTarget,
  subject: string,
  body: string,
  shownFrom: string,
  shownUntil: string,
): Promise<{ id: string; studentCount: number }> {
  return withOrg(organizationId, (tx) =>
    insertAvisoIn(tx, organizationId, sentByMembershipId, target, subject, body, shownFrom, shownUntil),
  );
}

/** The same, in the caller's transaction: POOLSE-191 sends one with its message. */
export async function insertAvisoIn(
  tx: Tx,
  organizationId: string,
  sentByMembershipId: string,
  target: MessageTarget,
  subject: string,
  body: string,
  shownFrom: string,
  shownUntil: string,
  /** POOLSE-192: a medical exam's aviso. */
  health = false,
): Promise<{ id: string; studentCount: number }> {
  {
    const params = targetParams(target);
    const studentId = target.audience === 'student' ? target.targetId : null;
    const { rows } = await tx.query<{ id: string | null; student_count: number }>(
      `WITH r AS (
              SELECT DISTINCT ON (a.student_id, a.guardian_membership_id)
                     a.student_id, a.guardian_membership_id, a.student_name, a.name
                FROM message_recipients_all($1, $2::message_audience, $3, $4, $5, $6, $7, $13::uuid) a
               WHERE a.student_id IS NOT NULL
            ),
            n AS (SELECT count(DISTINCT student_id)::int AS student_count FROM r),
            m AS (
              INSERT INTO message (organization_id, audience, class_group_id, level_id, facility_id,
                                   sport_id, subject, body, sent_by_membership_id, address_count,
                                   channel, shown_from, shown_until, student_id, health)
              SELECT $1, $2::message_audience, $3, $4, $5, $7, $8, $9, $10, 0,
                     'app', $11::date, $12::date, $13::uuid, $14::boolean
                FROM n
               WHERE n.student_count > 0
              RETURNING id
            ),
            ins AS (
              -- No address: nothing is sent, so nothing is kept (POOLSE-166).
              INSERT INTO message_recipient (organization_id, message_id, student_id,
                                             guardian_membership_id, student_name, name, email)
              SELECT $1, m.id, r.student_id, r.guardian_membership_id, r.student_name, r.name, NULL
                FROM r CROSS JOIN m
              RETURNING 1
            )
       SELECT m.id, n.student_count
         FROM n LEFT JOIN m ON true
        CROSS JOIN (SELECT count(*) FROM ins) AS written`,
      [organizationId, ...params, subject, body, sentByMembershipId, shownFrom, shownUntil, studentId, health],
    );
    const row = rows[0]!;
    if (row.id === null) throw new NoRecipientsError();

    await recordAudit(tx, {
      action: 'aviso.posted',
      entityType: 'aviso',
      entityId: row.id,
      data: { audience: target.audience, targetId: target.targetId, shownFrom, shownUntil },
    });
    return { id: row.id, studentCount: row.student_count };
  }
}

/**
 * Every aviso not ended, newest window first. `turmaIds` null is the office;
 * a list is an instructor, who sees the avisos to their turmas (the office's
 * included) and may end only their own.
 */
export async function listAvisos(
  organizationId: string,
  turmaIds: string[] | null,
  readerMembershipId: string | null,
): Promise<AvisoSummary[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      id: string;
      audience: MessageAudience;
      target_id: string | null;
      target_name: string | null;
      subject: string;
      body: string;
      shown_from: string;
      shown_until: string;
      state: AvisoState;
      sent_at: Date;
      sent_by_name: string | null;
      mine: boolean;
      student_count: number;
    }>(
      `SELECT m.id, m.audience,
              coalesce(coalesce(m.class_group_id, m.level_id, m.facility_id)::text, m.sport_id) AS target_id,
              coalesce(cg.name, lv.name, f.name, m.sport_id) AS target_name,
              m.subject, m.body,
              to_char(m.shown_from, 'YYYY-MM-DD') AS shown_from,
              to_char(m.shown_until, 'YYYY-MM-DD') AS shown_until,
              CASE WHEN m.shown_until < club_today() THEN 'past'
                   WHEN m.shown_from > club_today() THEN 'upcoming'
                   ELSE 'live' END AS state,
              m.sent_at, person_name(m.sent_by_membership_id) AS sent_by_name,
              m.sent_by_membership_id = $2 AS mine,
              (SELECT count(DISTINCT mr.student_id)::int FROM message_recipient mr
                WHERE mr.message_id = m.id AND mr.organization_id = m.organization_id) AS student_count
         FROM message m
         LEFT JOIN class_group cg ON cg.id = m.class_group_id AND cg.organization_id = m.organization_id
         LEFT JOIN student_level lv ON lv.id = m.level_id AND lv.organization_id = m.organization_id
         LEFT JOIN facility f ON f.id = m.facility_id AND f.organization_id = m.organization_id
        WHERE m.channel = 'app' AND m.archived_at IS NULL
          AND m.audience <> 'student'
          AND ($1::uuid[] IS NULL OR m.class_group_id = ANY($1::uuid[]))
        ORDER BY m.shown_until DESC, m.sent_at DESC, m.id`,
      [turmaIds, readerMembershipId],
    );
    return rows.map((row) => ({
      id: row.id,
      audience: row.audience,
      targetId: row.target_id,
      targetName: row.target_name,
      subject: row.subject,
      body: row.body,
      shownFrom: row.shown_from,
      shownUntil: row.shown_until,
      state: row.state,
      sentAt: row.sent_at.toISOString(),
      sentByName: row.sent_by_name,
      studentCount: row.student_count,
      canArchive: turmaIds === null || row.mine,
    }));
  });
}

/**
 * Ends an aviso early — POOLSE-166 rule 4. `onlyBy` set means an instructor,
 * who may end only their own; a row that is not theirs answers `'forbidden'`.
 * Answers the audit entry's id, which is what the bin's *Anular* restores.
 */
export async function archiveAviso(
  organizationId: string,
  avisoId: string,
  onlyBy: string | null,
): Promise<{ archiveEntryId: string } | 'not_found' | 'forbidden'> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ sent_by_membership_id: string; subject: string }>(
      `SELECT sent_by_membership_id, subject FROM message
        WHERE id = $1 AND channel = 'app' AND archived_at IS NULL
        FOR UPDATE`,
      [avisoId],
    );
    const row = rows[0];
    if (!row) return 'not_found';
    if (onlyBy !== null && row.sent_by_membership_id !== onlyBy) return 'forbidden';

    await tx.query('UPDATE message SET archived_at = now() WHERE id = $1', [avisoId]);
    const archiveEntryId = await recordAudit(tx, {
      action: 'aviso.archived',
      entityType: 'aviso',
      entityId: avisoId,
      data: { name: row.subject },
    });
    return { archiveEntryId };
  });
}

/**
 * The live avisos for the reader's own students — the student's own record or
 * a live guardian's — POOLSE-166 rule 3. Decided now, by the audience rule, so
 * the reader sees what reaches their child today.
 */
export async function avisosForReader(organizationId: string, membershipId: string): Promise<AppAviso[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ id: string; subject: string; body: string; shown_until: string; names: string[] }>(
      `WITH mine AS (
              SELECT s.id, s.first_name
                FROM student_person s
               WHERE s.archived_at IS NULL
                 AND (s.membership_id = $1
                      OR EXISTS (SELECT 1 FROM guardian_link g
                                  WHERE g.student_id = s.id AND g.organization_id = s.organization_id
                                    AND g.guardian_membership_id = $1 AND g.archived_at IS NULL))
            )
       SELECT m.id, m.subject, m.body, to_char(m.shown_until, 'YYYY-MM-DD') AS shown_until,
              array_agg(DISTINCT mine.first_name ORDER BY mine.first_name) AS names
         FROM message m
         CROSS JOIN LATERAL message_recipients_all(m.organization_id, m.audience, m.class_group_id,
                                                   m.level_id, m.facility_id, NULL, m.sport_id,
                                                   m.student_id) r
         JOIN mine ON mine.id = r.student_id
        WHERE m.channel = 'app' AND m.archived_at IS NULL
          AND club_today() BETWEEN m.shown_from AND m.shown_until
        GROUP BY m.id, m.subject, m.body, m.shown_until, m.sent_at
        ORDER BY m.sent_at DESC`,
      [membershipId],
    );
    return rows.map((row) => ({
      id: row.id,
      subject: row.subject,
      body: row.body,
      shownUntil: row.shown_until,
      studentNames: row.names,
    }));
  });
}

