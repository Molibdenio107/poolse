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
  recordedAt: string | null;
  recordedByName: string | null;
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
      recorded_at: Date;
      recorded_by_name: string | null;
      student_exists: boolean;
    }>(
      `
      SELECT ss.medical_notes_encrypted,
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
      data: { hasNotes: row.medical_notes_encrypted !== null },
    });

    return {
      medicalNotes: decryptSensitive(row.medical_notes_encrypted),
      recordedAt: row.medical_notes_encrypted === null ? null : row.recorded_at.toISOString(),
      recordedByName: row.recorded_by_name,
    };
  });
}

export async function writeSensitive(
  organizationId: string,
  studentId: string,
  medicalNotes: string | null,
): Promise<boolean> {
  const { membershipId } = currentTenant();
  // Encrypted out here, before the value is anywhere near a query. Postgres is
  // never handed the plaintext or the key.
  const ciphertext = encryptSensitive(medicalNotes);

  return withOrg(organizationId, async (tx) => {
    const student = await tx.query(
      'SELECT 1 FROM student WHERE id = $1 AND archived_at IS NULL',
      [studentId],
    );
    if (student.rows.length === 0) return false;

    await tx.query(
      `INSERT INTO student_sensitive (
         student_id, organization_id, medical_notes_encrypted,
         recorded_by_membership_id, recorded_at
       )
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (student_id) DO UPDATE
          SET medical_notes_encrypted   = excluded.medical_notes_encrypted,
              recorded_by_membership_id = excluded.recorded_by_membership_id,
              recorded_at               = excluded.recorded_at`,
      [studentId, organizationId, ciphertext, membershipId],
    );

    await recordAudit(tx, {
      action: ciphertext === null ? 'student_sensitive.cleared' : 'student_sensitive.updated',
      entityType: 'student',
      entityId: studentId,
      // Again: whether there are notes, never what they say.
      data: { hasNotes: ciphertext !== null },
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
