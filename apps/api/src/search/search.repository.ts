import { withOrg } from '@poolse/db';
import { displayName, nameOrder, personName, personOrder, shortName } from '../people/names.js';
import { PHONE_KEY } from '../invitations/invitations.repository.js';

/**
 * Ctrl+K's data search — POOLSE-235 (Rui, 19-11-2026).
 *
 * **What it finds, and what it never shows.** A person is found by a name (a
 * folded, accent-insensitive substring through the same `strip_accents` the
 * lists use — `strpos`, so `%` and `_` are literal), or, for the office only, by
 * an exact NIF or the last nine digits of a phone. A result carries a name and
 * one context fact; the NIF, phone, birth date, email and anything medical never
 * leave this file. Each group is one statement with its scope and its `LIMIT`
 * together (POOLSE-30), under the request's tenant (RLS).
 *
 * The instructor's reach is the one their *Alunos* tab already has — a live
 * enrolment in a live turma they teach (`teaching-students.repository.ts`) — by
 * name only: they may not read a family's NIF or phone, so those never match.
 */

export const SEARCH_LIMIT = 5;
export const MAX_SEARCH_LENGTH = 100;

export interface SearchTerm {
  /** The typed words, for names. */
  text: string;
  /** Nine digits and nothing else: a NIF. */
  nif: string | null;
  /** Nine or more digits once the rest is stripped: a phone's last nine. */
  phone: string | null;
}

/** What a term can mean. A NIF or phone is only ever an exact key, never a fragment. */
export function readTerm(raw: string): SearchTerm {
  const text = raw.trim();
  const digits = text.replace(/\D/g, '');
  const onlyNumber = /^[+\d\s().-]+$/.test(text);
  return {
    text,
    nif: /^\d{9}$/.test(text.replace(/\s/g, '')) ? text.replace(/\s/g, '') : null,
    phone: onlyNumber && digits.length >= 9 ? digits.slice(-9) : null,
  };
}

export interface SearchHit {
  id: string;
  name: string;
}
export interface StudentHit extends SearchHit {
  level: string | null;
}
export interface GuardianHit extends SearchHit {
  /** The child whose record opens, and whose name is the context line. */
  studentId: string;
  of: string;
}
export interface StaffHit extends SearchHit {
  role: string;
}
export interface TurmaHit extends SearchHit {
  level: string | null;
  instructor: string | null;
}

export interface SearchResults {
  students: StudentHit[];
  guardians: GuardianHit[];
  staff: StaffHit[];
  turmas: TurmaHit[];
}

const NAME = (expression: string): string =>
  `strpos(lower(strip_accents(${expression})), lower(strip_accents($1::text))) > 0`;

/** The roles that make somebody staff, in the order the badge names them. */
const STAFF_ROLES = `ARRAY['owner', 'admin', 'maintenance', 'instructor']::text[]`;

export async function search(
  organizationId: string,
  reader: { membershipId: string; office: boolean },
  term: SearchTerm,
): Promise<SearchResults> {
  const { membershipId, office } = reader;
  // An instructor matches by name only: their keys stay null.
  const nif = office ? term.nif : null;
  const phone = office ? term.phone : null;

  return withOrg(organizationId, async (tx) => {
    const studentsQuery = office
      ? tx.query<StudentHit>(
          `SELECT s.id, ${displayName('s')} AS name, l.name AS level
             FROM student_person s
             LEFT JOIN student_level l ON l.id = s.level_id AND l.organization_id = s.organization_id
            WHERE s.archived_at IS NULL AND s.anonymised_at IS NULL
              AND (${NAME(`s.first_name || ' ' || s.last_name`)}
                   OR ($2::text IS NOT NULL AND s.tax_number = $2)
                   OR ($3::text IS NOT NULL AND ${PHONE_KEY('s.contact_phone')} = $3))
            ORDER BY ${nameOrder('s')}
            LIMIT ${SEARCH_LIMIT}`,
          [term.text, nif, phone],
        )
      : tx.query<StudentHit>(
          `SELECT s.id, ${displayName('s')} AS name, min(l.name) AS level
             FROM student_person s
             JOIN enrollment e ON e.student_id = s.id AND e.organization_id = s.organization_id
             JOIN class_group cg ON cg.id = e.class_group_id AND cg.organization_id = e.organization_id
             LEFT JOIN student_level l ON l.id = s.level_id AND l.organization_id = s.organization_id
            WHERE cg.instructor_membership_id = $2
              AND cg.archived_at IS NULL AND s.archived_at IS NULL AND s.anonymised_at IS NULL
              AND (e.ended_on IS NULL OR e.ended_on >= current_date)
              AND ${NAME(`s.first_name || ' ' || s.last_name`)}
            GROUP BY s.id, s.organization_id, s.first_name, s.last_name
            ORDER BY ${nameOrder('s')}
            LIMIT ${SEARCH_LIMIT}`,
          [term.text, membershipId],
        );

    const guardiansQuery = office
      ? tx.query<GuardianHit>(
          `SELECT DISTINCT ON (${personOrder('m.id')}, m.id)
                  m.id, ${personName('m.id')} AS name, s.id AS "studentId", ${shortName('s')} AS of
             FROM membership m
             JOIN membership_role r ON r.membership_id = m.id AND r.organization_id = m.organization_id
                                   AND r.role = 'guardian' AND r.archived_at IS NULL
             JOIN guardian_link g ON g.guardian_membership_id = m.id AND g.organization_id = m.organization_id
                                 AND g.archived_at IS NULL
             JOIN student_person s ON s.id = g.student_id AND s.organization_id = g.organization_id
                                  AND s.archived_at IS NULL
            WHERE m.archived_at IS NULL AND m.support_grant_id IS NULL
              AND (${NAME(personName('m.id'))}
                   OR ($2::text IS NOT NULL AND m.tax_number = $2)
                   OR ($3::text IS NOT NULL AND ${PHONE_KEY('person_phone(m.id)')} = $3))
            ORDER BY ${personOrder('m.id')}, m.id, g.is_primary DESC, ${nameOrder('s')}
            LIMIT ${SEARCH_LIMIT}`,
          [term.text, nif, phone],
        )
      : Promise.resolve({ rows: [] as GuardianHit[] });

    const staffQuery = tx.query<StaffHit>(
      `SELECT m.id, ${personName('m.id')} AS name,
              (SELECT r.role::text FROM membership_role r
                WHERE r.membership_id = m.id AND r.organization_id = m.organization_id AND r.archived_at IS NULL
                  AND r.role::text = ANY(${STAFF_ROLES})
                ORDER BY array_position(${STAFF_ROLES}, r.role::text) LIMIT 1) AS role
         FROM membership m
        WHERE m.archived_at IS NULL AND m.support_grant_id IS NULL
          AND EXISTS (SELECT 1 FROM membership_role r
                       WHERE r.membership_id = m.id AND r.organization_id = m.organization_id
                         AND r.archived_at IS NULL AND r.role::text = ANY(${STAFF_ROLES}))
          AND ${NAME(personName('m.id'))}
        ORDER BY ${personOrder('m.id')}
        LIMIT ${SEARCH_LIMIT}`,
      [term.text],
    );

    const turmasQuery = tx.query<TurmaHit>(
      `SELECT cg.id, cg.name, l.name AS level,
              CASE WHEN cg.instructor_membership_id IS NULL THEN NULL
                   ELSE ${personName('cg.instructor_membership_id')} END AS instructor
         FROM class_group cg
         LEFT JOIN student_level l ON l.id = cg.level_id AND l.organization_id = cg.organization_id
        WHERE cg.archived_at IS NULL
          AND ($2::uuid IS NULL OR cg.instructor_membership_id = $2)
          AND (${NAME('cg.name')}
               OR ${NAME(`coalesce(l.name, '')`)}
               OR (cg.instructor_membership_id IS NOT NULL
                   AND ${NAME(`coalesce(${personName('cg.instructor_membership_id')}, '')`)}))
        ORDER BY lower(cg.name)
        LIMIT ${SEARCH_LIMIT}`,
      [term.text, office ? null : membershipId],
    );

    const [students, guardians, staff, turmas] = await Promise.all([
      studentsQuery,
      guardiansQuery,
      staffQuery,
      turmasQuery,
    ]);
    return { students: students.rows, guardians: guardians.rows, staff: staff.rows, turmas: turmas.rows };
  });
}
