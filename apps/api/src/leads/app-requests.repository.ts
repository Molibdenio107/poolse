import { withOrg, type Tx } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';
import { shortName } from '../people/names.js';
import { LEAD_RETENTION_MONTHS } from './leads.controller.js';

/**
 * Asking to join a class from the app — POOLSE-121, the enrolment half
 * (Rui, 29-10-2026).
 *
 * A family member or adult student picks one of their own people, or a new
 * child, and a turma with a free place; the request lands in Pedidos de
 * inscrição as an ordinary `lead` naming the turma. Nobody is enrolled here: the
 * office checks the level and presses Inscrever, which runs `placeLead`.
 *
 * Offered: every live turma of the published shared season with a free place
 * (no ceiling counts as free — a null ceiling is "not measured"), the child's own
 * level first on the screen (Rui's call). A child the club has is named by
 * `student_id`, so conversion attaches the turma to them; a new child carries the
 * reader as guardian, and the guardian sync links them on conversion.
 */

export interface AppClassOption {
  id: string;
  name: string;
  levelId: string | null;
  levelName: string | null;
  /** Position on the ladder, for grouping; null with no level. */
  levelOrder: number | null;
  capacity: number | null;
  active: number;
  slots: { weekday: number; startTime: string }[];
  instructorName: string | null;
  facilityName: string;
}

export interface AppRequestPerson {
  id: string;
  name: string;
  self: boolean;
  levelId: string | null;
}

export interface AppRequestSent {
  id: string;
  swimmerName: string;
  className: string | null;
  createdAt: string;
  status: string;
}

export interface AppRequestOptions {
  /** For the consent sentence, which names the club. */
  clubName: string;
  /** How long a request that never becomes an enrolment is kept — the public form's sentence. */
  retentionMonths: number;
  people: AppRequestPerson[];
  classes: AppClassOption[];
  /** This reader's requests from the app, newest first — the last ten. */
  sent: AppRequestSent[];
}

/** The reader's own people: themselves on the adult path, and the children they answer for. */
async function peopleOf(tx: Tx, membershipId: string): Promise<AppRequestPerson[]> {
  const { rows } = await tx.query<AppRequestPerson>(
    `SELECT s.id, ${shortName('s')} AS name, true AS self, s.level_id AS "levelId"
       FROM student s
      WHERE s.membership_id = $1 AND s.archived_at IS NULL
     UNION
     SELECT s.id, ${shortName('s')} AS name, false AS self, s.level_id AS "levelId"
       FROM guardian_link gl
       JOIN student s ON s.id = gl.student_id AND s.organization_id = gl.organization_id
      WHERE gl.guardian_membership_id = $1 AND gl.archived_at IS NULL AND s.archived_at IS NULL
      ORDER BY self DESC, name`,
    [membershipId],
  );
  return rows;
}

/** Live turmas of the published shared season, with their fill. `free` keeps only those with room. */
async function classesWith(tx: Tx, where: string, params: unknown[]): Promise<AppClassOption[]> {
  const { rows } = await tx.query<AppClassOption & { level_order: number | null }>(
    `SELECT cg.id, cg.name, cg.level_id AS "levelId", sl.name AS "levelName",
            CASE WHEN sl.id IS NULL THEN NULL
                 ELSE (SELECT count(*)::int FROM student_level o
                        WHERE o.organization_id = sl.organization_id AND o.archived_at IS NULL
                          AND o.sport_id = sl.sport_id
                          AND (o.sort_order, o.name) < (sl.sort_order, sl.name)) END AS "levelOrder",
            cg.capacity,
            (SELECT count(*)::int FROM enrollment e
              WHERE e.organization_id = cg.organization_id AND e.class_group_id = cg.id
                AND e.status = 'active') AS active,
            coalesce((SELECT json_agg(json_build_object('weekday', cs.weekday,
                                                        'startTime', to_char(cs.start_time, 'HH24:MI'))
                                      ORDER BY cs.weekday, cs.start_time)
                        FROM class_schedule cs
                       WHERE cs.organization_id = cg.organization_id AND cs.class_group_id = cg.id
                         AND cs.archived_at IS NULL), '[]'::json) AS slots,
            nullif(btrim(coalesce(iu.cached_first_name, im.first_name, '') || ' ' ||
                         coalesce(iu.cached_last_name, im.last_name, '')), '') AS "instructorName",
            f.name AS "facilityName"
       FROM class_group cg
       JOIN season se ON se.id = cg.season_id AND se.organization_id = cg.organization_id
       JOIN facility f ON f.id = cg.facility_id AND f.organization_id = cg.organization_id
       LEFT JOIN student_level sl ON sl.id = cg.level_id AND sl.organization_id = cg.organization_id
       LEFT JOIN membership im
         ON im.id = cg.instructor_membership_id AND im.organization_id = cg.organization_id
       LEFT JOIN app_user iu ON iu.id = im.app_user_id
      WHERE cg.archived_at IS NULL
        AND se.status = 'published' AND se.sport_id IS NULL AND se.archived_at IS NULL
        AND ${where}
      ORDER BY sl.sort_order NULLS LAST, sl.name, cg.name`,
    params,
  );
  return rows;
}

const HAS_ROOM = `(cg.capacity IS NULL OR cg.capacity > (
  SELECT count(*) FROM enrollment e
   WHERE e.organization_id = cg.organization_id AND e.class_group_id = cg.id AND e.status = 'active'))`;

export async function appRequestOptions(
  organizationId: string,
  membershipId: string,
): Promise<AppRequestOptions> {
  return withOrg(organizationId, async (tx) => {
    const people = await peopleOf(tx, membershipId);
    const classes = await classesWith(tx, HAS_ROOM, []);
    const { rows: sent } = await tx.query<AppRequestSent & { created_at: Date }>(
      `SELECT l.id, btrim(l.swimmer_first_name || ' ' || l.swimmer_last_name) AS "swimmerName",
              cg.name AS "className", l.created_at, l.status::text AS status
         FROM lead l
         LEFT JOIN class_group cg
           ON cg.id = l.requested_class_group_id AND cg.organization_id = l.organization_id
          AND cg.archived_at IS NULL
        WHERE l.requested_by_membership_id = $1 AND l.archived_at IS NULL
        ORDER BY l.created_at DESC
        LIMIT 10`,
      [membershipId],
    );
    const { rows: club } = await tx.query<{ name: string }>(
      'SELECT name FROM organization WHERE id = $1',
      [organizationId],
    );
    return {
      clubName: club[0]?.name ?? '',
      retentionMonths: LEAD_RETENTION_MONTHS,
      people,
      classes,
      sent: sent.map(({ created_at, ...row }) => ({ ...row, createdAt: created_at.toISOString() })),
    };
  });
}

export interface AppRequestInput {
  classGroupId: string;
  /** One of the reader's people, or null with `newChild`. */
  studentId: string | null;
  newChild: { firstName: string; lastName: string; birthDate: string; relationship: string } | null;
  note: string | null;
  consentTextVersion: string;
  locale: 'pt-PT' | 'en';
}

/** Open requests one login may have waiting at once. A family of five asking twice each still fits. */
export const MAX_OPEN_APP_REQUESTS = 10;

export class AppRequestRefused extends Error {
  constructor(
    readonly code: 'not_yours' | 'class_unavailable' | 'already_enrolled' | 'already_requested' | 'no_email' | 'too_many',
  ) {
    super(code);
  }
}

/**
 * Write the request. Every refusal is decided in this transaction: the person
 * is the reader's, the turma is live and has room now, the person is not already
 * in it, and they have not asked for it already (the partial unique index).
 */
export async function submitAppRequest(
  organizationId: string,
  membershipId: string,
  input: AppRequestInput,
): Promise<string> {
  try {
    return await withOrg(organizationId, async (tx) => {
      const { rows: me } = await tx.query<{ name: string; email: string | null; phone: string | null }>(
        `SELECT btrim(coalesce(u.cached_first_name, m.first_name, '') || ' ' ||
                      coalesce(u.cached_last_name, m.last_name, '')) AS name,
                coalesce(u.cached_email, m.email)::text AS email, m.phone
           FROM membership m LEFT JOIN app_user u ON u.id = m.app_user_id
          WHERE m.id = $1`,
        [membershipId],
      );
      const reader = me[0];
      if (reader === undefined || reader.email === null) throw new AppRequestRefused('no_email');

      /*
       * A ceiling on what one login may leave waiting (security sweep, 29-10-2026):
       * the public form has its per-club ceiling, and a new child asked for from
       * the app has no unique key to stop a loop filling the office's queue.
       * Locked on the membership so two at once count each other.
       */
      await tx.query('SELECT 1 FROM membership WHERE id = $1 FOR UPDATE', [membershipId]);
      const { rows: open } = await tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM lead
          WHERE requested_by_membership_id = $1 AND archived_at IS NULL
            AND status IN ('new', 'trial_booked')`,
        [membershipId],
      );
      if (open[0]!.n >= MAX_OPEN_APP_REQUESTS) throw new AppRequestRefused('too_many');

      let swimmer: {
        studentId: string | null;
        first: string;
        last: string;
        birth: string | null;
        guardianName: string | null;
        relationship: string | null;
      };
      if (input.studentId !== null) {
        const people = await peopleOf(tx, membershipId);
        if (!people.some((one) => one.id === input.studentId)) throw new AppRequestRefused('not_yours');
        const { rows } = await tx.query<{ first_name: string; last_name: string; birth_date: string | null }>(
          `SELECT first_name, last_name, birth_date::text AS birth_date FROM student WHERE id = $1`,
          [input.studentId],
        );
        const enrolled = await tx.query(
          `SELECT 1 FROM enrollment
            WHERE class_group_id = $1 AND student_id = $2 AND status IN ('active', 'waiting')`,
          [input.classGroupId, input.studentId],
        );
        if (enrolled.rows.length > 0) throw new AppRequestRefused('already_enrolled');
        swimmer = {
          studentId: input.studentId,
          first: rows[0]!.first_name,
          last: rows[0]!.last_name,
          birth: rows[0]!.birth_date,
          guardianName: null,
          relationship: null,
        };
      } else {
        const child = input.newChild!;
        swimmer = {
          studentId: null,
          first: child.firstName,
          last: child.lastName,
          birth: child.birthDate,
          // A login with no name still answers for the child: its address names it,
          // or the student form refuses the conversion as a minor with no guardian.
          guardianName: reader.name === '' ? reader.email : reader.name,
          relationship: child.relationship,
        };
      }

      // After the person, so a stranger's child is a 404 whatever turma was named.
      const [turma] = await classesWith(tx, `cg.id = $1 AND ${HAS_ROOM}`, [input.classGroupId]);
      if (turma === undefined) throw new AppRequestRefused('class_unavailable');

      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO lead (
           organization_id, facility_id, level_id, swimmer_first_name, swimmer_last_name,
           swimmer_birth_date, guardian_name, guardian_relationship, email, phone, note, locale,
           consent_text_version, consented_at, student_id,
           requested_class_group_id, requested_by_membership_id)
         SELECT $1, cg.facility_id, cg.level_id, $3, $4, $5::date, $6, $7, $8, $9, $10, $11,
                $12, now(), $13, cg.id, $14
           FROM class_group cg WHERE cg.id = $2
         RETURNING id`,
        [
          organizationId,
          input.classGroupId,
          swimmer.first,
          swimmer.last,
          swimmer.birth,
          swimmer.guardianName,
          swimmer.relationship,
          reader.email,
          reader.phone,
          input.note,
          input.locale,
          input.consentTextVersion,
          swimmer.studentId,
          membershipId,
        ],
      );
      const id = rows[0]!.id;
      await recordAudit(tx, {
        action: 'lead.requested_in_app',
        entityType: 'lead',
        entityId: id,
        data: { classGroupId: input.classGroupId, studentId: swimmer.studentId, newChild: swimmer.studentId === null },
      });
      return id;
    });
  } catch (error) {
    const pg = error as { code?: string; constraint?: string };
    if (pg.code === '23505' && pg.constraint === 'lead_one_open_app_request') {
      throw new AppRequestRefused('already_requested');
    }
    throw error;
  }
}
