import { withOrg } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';
import { currentTenant } from '../tenant/tenant.context.js';
import { decryptSensitive, encryptSensitive } from './cipher.js';

export type ConsentKind = 'photo' | 'medical_data' | 'parent_sharing';
export const CONSENT_KINDS: ConsentKind[] = ['photo', 'medical_data', 'parent_sharing'];

export interface ConsentRecord {
  id: string;
  kind: ConsentKind;
  granted: boolean;
  grantedAt: string;
  grantedByName: string | null;
  evidenceNote: string | null;
  withdrawnAt: string | null;
  withdrawnByName: string | null;
}

export interface SensitiveNotes {
  medicalNotes: string | null;
  /**
   * Mobility and physical limitations — POOLSE-23 AC3.
   *
   * Beside the medical notes rather than in a table of their own, because they
   * are the same class of fact: something about a person's body that whoever is
   * at the poolside needs to know before that person is in the water. Same
   * encryption, same audited read, same permission.
   */
  mobilityNotes: string | null;
  recordedAt: string | null;
  recordedByName: string | null;
}

/**
 * Which path this student is on, and therefore which consent applies.
 *
 * Computed once on the server, by `student_is_adult_path` — the enrolment flow,
 * the consent form and the guardian block all branch on the same question, and
 * three screens deriving it from scattered fields is how they end up disagreeing
 * about one person.
 *
 * **There is no `is_adult` column.** An adult is a student at or above the
 * club's age of majority with no live guardian link; the absence of the edge is
 * the definition. A boolean would drift the first time a birth date is
 * corrected — which is exactly QA 23.12.
 */
export interface EnrolmentContext {
  adultPath: boolean;
  /** Whole years today, in the club's own terms. Null when no birth date is on file. */
  ageYears: number | null;
  ageOfMajority: number;
  hasGuardian: boolean;
  /** Which form to present, and the only one the API will accept back. */
  consentForm: 'self' | 'guardian';
}

/**
 * Reading a child's medical notes is itself an event worth recording.
 *
 * This is the unusual part of the slice and it is deliberate: `docs/product.md`
 * says "every read or change of them is logged", because when a parent asks who
 * has seen their child's health information, "we do not keep track" is not an
 * answer a school can give its DPO. Ordinary tables do not get this — it would
 * be noise — and that is exactly why sensitive data sits in its own table with
 * its own read path.
 *
 * The note itself is never written to the audit log. The log records that a read
 * happened, by whom; it is readable by every admin, and copying the contents
 * into it would defeat the separation the whole slice exists to create.
 */
export async function readSensitive(
  organizationId: string,
  studentId: string,
): Promise<SensitiveNotes | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      medical_notes_encrypted: string | null;
      mobility_notes_encrypted: string | null;
      recorded_at: Date;
      recorded_by_name: string | null;
      student_exists: boolean;
    }>(
      `
      SELECT ss.medical_notes_encrypted,
             ss.mobility_notes_encrypted,
             ss.recorded_at,
             display_name(u.cached_first_name, u.cached_last_name) AS recorded_by_name,
             true AS student_exists
        FROM student s
        LEFT JOIN student_sensitive ss
               ON ss.student_id = s.id AND ss.organization_id = s.organization_id
        LEFT JOIN membership m
               ON m.id = ss.recorded_by_membership_id AND m.organization_id = ss.organization_id
        LEFT JOIN app_user u ON u.id = m.app_user_id
       WHERE s.id = $1 AND s.archived_at IS NULL
      `,
      [studentId],
    );

    const row = rows[0];
    // No such student in this tenant — RLS makes "not ours" and "not there"
    // indistinguishable, which is the correct amount to reveal.
    if (!row) return null;

    await recordAudit(tx, {
      action: 'student_sensitive.read',
      entityType: 'student',
      entityId: studentId,
      // Which kinds were there, never what they said. The log is readable by
      // every admin, and copying the contents in would defeat the separation
      // this whole table exists to create.
      data: {
        hasNotes: row.medical_notes_encrypted !== null,
        hasMobilityNotes: row.mobility_notes_encrypted !== null,
      },
    });

    const written =
      row.medical_notes_encrypted !== null || row.mobility_notes_encrypted !== null;

    return {
      medicalNotes: decryptSensitive(row.medical_notes_encrypted),
      mobilityNotes: decryptSensitive(row.mobility_notes_encrypted),
      recordedAt: written ? row.recorded_at.toISOString() : null,
      recordedByName: row.recorded_by_name,
    };
  });
}

export async function writeSensitive(
  organizationId: string,
  studentId: string,
  medicalNotes: string | null,
  mobilityNotes: string | null,
): Promise<boolean> {
  const { membershipId } = currentTenant();
  // Encrypted out here, before the value is anywhere near a query. Postgres is
  // never handed the plaintext or the key.
  const ciphertext = encryptSensitive(medicalNotes);
  const mobilityCiphertext = encryptSensitive(mobilityNotes);

  return withOrg(organizationId, async (tx) => {
    const student = await tx.query(
      'SELECT 1 FROM student WHERE id = $1 AND archived_at IS NULL',
      [studentId],
    );
    if (student.rows.length === 0) return false;

    await tx.query(
      `INSERT INTO student_sensitive (
         student_id, organization_id, medical_notes_encrypted, mobility_notes_encrypted,
         recorded_by_membership_id, recorded_at
       )
       VALUES ($1, $2, $3, $5, $4, now())
       ON CONFLICT (student_id) DO UPDATE
          SET medical_notes_encrypted   = excluded.medical_notes_encrypted,
              mobility_notes_encrypted  = excluded.mobility_notes_encrypted,
              recorded_by_membership_id = excluded.recorded_by_membership_id,
              recorded_at               = excluded.recorded_at`,
      [studentId, organizationId, ciphertext, membershipId, mobilityCiphertext],
    );

    /*
     * Both fields are written together, and both are cleared together.
     *
     * The form carries both boxes, so a save is the whole panel — sending only
     * one and leaving the other alone would mean a caller that omits a field
     * silently keeps a stale value, which on encrypted notes nobody can read
     * back is the worst place for that to happen.
     */
    const anything = ciphertext !== null || mobilityCiphertext !== null;

    await recordAudit(tx, {
      action: anything ? 'student_sensitive.updated' : 'student_sensitive.cleared',
      entityType: 'student',
      entityId: studentId,
      // Again: whether there are notes, never what they say.
      data: { hasNotes: ciphertext !== null, hasMobilityNotes: mobilityCiphertext !== null },
    });

    return true;
  });
}

// ---------------------------------------------------------------------------
// Consent
// ---------------------------------------------------------------------------

export async function listConsent(
  organizationId: string,
  studentId: string,
): Promise<ConsentRecord[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      id: string;
      kind: ConsentKind;
      granted: boolean;
      granted_at: Date;
      granted_by_name: string | null;
      evidence_note: string | null;
      withdrawn_at: Date | null;
      withdrawn_by_name: string | null;
    }>(
      `
      SELECT c.id, c.kind, c.granted, c.granted_at, c.evidence_note, c.withdrawn_at,
             display_name(g.cached_first_name, g.cached_last_name)   AS granted_by_name,
             display_name(w.cached_first_name, w.cached_last_name)   AS withdrawn_by_name
        FROM consent c
        LEFT JOIN membership gm
               ON gm.id = c.granted_by_membership_id AND gm.organization_id = c.organization_id
        LEFT JOIN app_user g ON g.id = gm.app_user_id
        LEFT JOIN membership wm
               ON wm.id = c.withdrawn_by_membership_id AND wm.organization_id = c.organization_id
        LEFT JOIN app_user w ON w.id = wm.app_user_id
       WHERE c.student_id = $1
       ORDER BY c.granted_at DESC
      `,
      [studentId],
    );

    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      granted: row.granted,
      grantedAt: row.granted_at.toISOString(),
      grantedByName: row.granted_by_name,
      evidenceNote: row.evidence_note,
      withdrawnAt: row.withdrawn_at?.toISOString() ?? null,
      withdrawnByName: row.withdrawn_by_name,
    }));
  });
}

export class ConsentAlreadyRecordedError extends Error {}

/**
 * Records a decision. Never edits one.
 *
 * If a live record of this kind already exists, this is refused rather than
 * overwritten — the caller withdraws the old one first, which leaves both facts
 * in the history. The database enforces the same thing twice over: a partial
 * unique index on the live record, and a trigger that refuses to let any field
 * but withdrawal change.
 */
export async function recordConsent(
  organizationId: string,
  studentId: string,
  kind: ConsentKind,
  granted: boolean,
  evidenceNote: string | null,
): Promise<boolean> {
  const { membershipId } = currentTenant();

  try {
    return await withOrg(organizationId, async (tx) => {
      const student = await tx.query(
        'SELECT 1 FROM student WHERE id = $1 AND archived_at IS NULL',
        [studentId],
      );
      if (student.rows.length === 0) return false;

      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO consent (
           organization_id, student_id, kind, granted,
           granted_by_membership_id, evidence_note
         )
         VALUES ($1, $2, $3::consent_kind, $4, $5, $6)
         RETURNING id`,
        [organizationId, studentId, kind, granted, membershipId, evidenceNote],
      );

      await recordAudit(tx, {
        action: 'consent.recorded',
        entityType: 'student',
        entityId: studentId,
        data: { kind, granted, consentId: rows[0]?.id },
      });

      return true;
    });
  } catch (error) {
    if (error instanceof Error && (error as { code?: string }).code === '23505') {
      throw new ConsentAlreadyRecordedError(kind);
    }
    throw error;
  }
}

export async function withdrawConsent(
  organizationId: string,
  studentId: string,
  consentId: string,
): Promise<boolean> {
  const { membershipId } = currentTenant();

  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ kind: ConsentKind }>(
      `UPDATE consent
          SET withdrawn_at = now(), withdrawn_by_membership_id = $3
        WHERE id = $1 AND student_id = $2 AND withdrawn_at IS NULL
      RETURNING kind`,
      [consentId, studentId, membershipId],
    );

    const record = rows[0];
    if (!record) return false;

    await recordAudit(tx, {
      action: 'consent.withdrawn',
      entityType: 'student',
      entityId: studentId,
      data: { kind: record.kind, consentId },
    });

    return true;
  });
}

/*
 * The local displayName() that used to live here is gone — POOLSE-32.
 *
 * It composed a name in TypeScript while the rest of the app composed one in
 * SQL, which is exactly the split the ticket names: two implementations, and
 * the day somebody fixes one is the day they disagree. The queries above call
 * `display_name()` instead.
 */

/**
 * Which path a student is on — POOLSE-23 AC1, AC2.
 *
 * One server-computed answer that the enrolment flow, the consent form and the
 * guardian block all read. The alternative is each of them deciding it from
 * scattered fields, which is how three screens end up disagreeing about one
 * person — and the ticket names it as the thing most likely to be got wrong.
 *
 * `student_is_adult_path` is the definition and it lives in SQL: at or above the
 * club's own `age_of_majority`, with no live guardian link. There is deliberately
 * no `is_adult` column; the absence of the edge is what "adult" means here, so
 * correcting a birth date moves somebody between paths with nothing to migrate.
 */
export async function enrolmentContext(
  organizationId: string,
  studentId: string,
): Promise<EnrolmentContext | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      adult_path: boolean;
      age_years: number | null;
      age_of_majority: number;
      has_guardian: boolean;
    }>(
      `SELECT student_is_adult_path(s.organization_id, s.id) AS adult_path,
              CASE WHEN s.birth_date IS NULL THEN NULL
                   ELSE extract(year FROM age(current_date, s.birth_date))::int
              END AS age_years,
              o.age_of_majority,
              EXISTS (
                SELECT 1 FROM guardian_link g
                 WHERE g.student_id = s.id
                   AND g.organization_id = s.organization_id
                   AND g.archived_at IS NULL
              ) AS has_guardian
         FROM student s
         JOIN organization o ON o.id = s.organization_id
        WHERE s.id = $1 AND s.archived_at IS NULL`,
      [studentId],
    );

    const row = rows[0];
    if (row === undefined) return null;

    return {
      adultPath: row.adult_path,
      ageYears: row.age_years,
      ageOfMajority: row.age_of_majority,
      hasGuardian: row.has_guardian,
      // The form to present, and the only one the API will take back. A minor
      // with a guardian cannot self-sign, whatever a client sends — QA 23.3.
      consentForm: row.adult_path ? 'self' : 'guardian',
    };
  });
}

/**
 * The emergency contact — POOLSE-23 AC3, and what it deliberately is not.
 *
 * **Naming somebody here grants them nothing**: no role, no login, no access to
 * this student's record, and no place in any guardian list. That is a property
 * of the shape rather than of a check — three columns on `student`, touching
 * neither `membership_role` nor `guardian_link`, so there is no path by which
 * this could confer anything. QA 23.4 asserts it from the other end.
 *
 * A link **or** free text. A club with the person already in its system points
 * at them and gets a name that stays right when they change it; a club with a
 * number on a paper form types the number. Both at once would make "which is
 * authoritative" a question every reader answers differently, and the CHECK on
 * the table refuses it.
 */
export interface EmergencyContact {
  membershipId: string | null;
  /** Resolved from the membership when it is a link; the typed name otherwise. */
  name: string | null;
  phone: string | null;
  relationship: string | null;
}

export async function readEmergencyContact(
  organizationId: string,
  studentId: string,
): Promise<EmergencyContact | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      membership_id: string | null;
      name: string | null;
      phone: string | null;
      relationship: string | null;
    }>(
      `SELECT s.emergency_contact_membership_id AS membership_id,
              -- The link's own name where there is one, so a person who marries
              -- and changes it does not leave a stale copy on a child's record.
              coalesce(
                display_name(u.cached_first_name, u.cached_last_name),
                display_name(m.first_name, m.last_name),
                s.emergency_contact_name
              ) AS name,
              coalesce(m.phone, s.emergency_contact_phone) AS phone,
              s.emergency_contact_relationship AS relationship
         FROM student s
         LEFT JOIN membership m
                ON m.id = s.emergency_contact_membership_id
               AND m.organization_id = s.organization_id
         LEFT JOIN app_user u ON u.id = m.app_user_id
        WHERE s.id = $1 AND s.archived_at IS NULL`,
      [studentId],
    );

    const row = rows[0];
    if (row === undefined) return null;

    return {
      membershipId: row.membership_id,
      name: row.name,
      phone: row.phone,
      relationship: row.relationship,
    };
  });
}

export interface EmergencyContactInput {
  membershipId: string | null;
  name: string | null;
  phone: string | null;
  relationship: string | null;
}

export async function writeEmergencyContact(
  organizationId: string,
  studentId: string,
  input: EmergencyContactInput,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    /*
     * A link wins and clears the free text, rather than the CHECK refusing the
     * pair with a constraint name. The two are alternatives and the operator
     * has just chosen one; making them delete the other first would be asking
     * them to tidy up after a rule they cannot see.
     */
    const linked = input.membershipId !== null;

    const { rows } = await tx.query<{ id: string }>(
      `UPDATE student
          SET emergency_contact_membership_id = $2,
              emergency_contact_name          = CASE WHEN $2::uuid IS NULL THEN $3 END,
              emergency_contact_phone         = CASE WHEN $2::uuid IS NULL THEN $4 END,
              emergency_contact_relationship  = $5
        WHERE id = $1 AND archived_at IS NULL
      RETURNING id`,
      [
        studentId,
        input.membershipId,
        input.name,
        input.phone,
        input.relationship,
      ],
    );
    if (rows[0] === undefined) return false;

    await recordAudit(tx, {
      action: 'student.emergency_contact_set',
      entityType: 'student',
      entityId: studentId,
      // Whether there is one and which kind, never the number itself.
      data: { linked, cleared: !linked && input.name === null },
    });
    return true;
  });
}

/**
 * Everybody in the club, for the emergency-contact picker.
 *
 * Complete, not a page. `People` next door says why in its own comment: a picker
 * built from one page of a paginated list offers only the people who happened to
 * land on page 1, and the operator concludes the person is not in the system and
 * types their name in by hand. A club has tens of memberships, not thousands.
 *
 * Read only for a caller who may write the contact — an instructor reading a
 * student's notes has no need for the club's staff list, and this travels on the
 * same response.
 */
export async function contactCandidates(
  organizationId: string,
): Promise<{ id: string; name: string }[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ id: string; name: string }>(
      `SELECT m.id,
              coalesce(
                display_name(u.cached_first_name, u.cached_last_name),
                display_name(m.first_name, m.last_name)
              ) AS name
         FROM membership m
         LEFT JOIN app_user u ON u.id = m.app_user_id
        WHERE m.status = 'active'
        ORDER BY lower(strip_accents(coalesce(m.last_name, ''))),
                 lower(strip_accents(coalesce(m.first_name, '')))`,
    );
    return rows.filter((row) => row.name !== null && row.name.trim() !== '');
  });
}
