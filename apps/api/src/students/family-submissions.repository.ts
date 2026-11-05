import { withOrg, type Tx } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';
import { clubToday } from '../common/club-day.js';
import { storeFile, type FilePurpose } from '../files/files.repository.js';
import { fileCopyIn, readDocuments, type StudentDocumentKind } from './documents.repository.js';
import { insertExamIn, type ExamResult } from './medical-exams.repository.js';

/**
 * What a family sends — POOLSE-179 slice 2. A signed form, the ID photo or the
 * exame médico, kept in `family_submission` and changing **nothing** the office
 * holds until the office accepts it (Rui, 05-11-2026: "don't break anything").
 * Accepting files it through the office's own paths (`fileCopyIn`,
 * `insertExamIn`); rejecting it shreds a sealed file (the table's trigger).
 */

/** What a family may send. The FPN declaration's adult or minor form is the server's choice. */
export type SendableKind = 'fpn_declaration' | 'socio_form' | 'id_document' | 'medical_exam';
export const SENDABLE: readonly SendableKind[] = ['fpn_declaration', 'socio_form', 'id_document', 'medical_exam'];

type StoredKind = StudentDocumentKind | 'medical_exam';

const PURPOSE: Record<StoredKind, FilePurpose> = {
  fpn_declaration: 'student_document',
  fpn_declaration_minor: 'student_document',
  socio_form: 'student_document',
  id_document: 'student_id_document',
  medical_exam: 'medical_certificate',
};

/**
 * Whether this membership may send for this student: a live encarregado, or
 * the student themself once 18 (the adult path). A minor's own login reads its
 * statuses and never sends (BA 1).
 */
async function maySend(tx: Tx, membershipId: string, studentId: string): Promise<boolean> {
  const { rows } = await tx.query<{ allowed: boolean }>(
    `SELECT EXISTS (
              SELECT 1 FROM guardian_link gl
               WHERE gl.student_id = $2 AND gl.guardian_membership_id = $1 AND gl.archived_at IS NULL
              UNION ALL
              SELECT 1 FROM student s
               WHERE s.id = $2 AND s.membership_id = $1 AND s.archived_at IS NULL
                 AND s.birth_date IS NOT NULL
                 AND s.birth_date <= ($3::date - interval '18 years')::date
            ) AS allowed`,
    [membershipId, studentId, clubToday()],
  );
  return rows[0]?.allowed ?? false;
}

export async function maySendFor(organizationId: string, membershipId: string, studentId: string): Promise<boolean> {
  return withOrg(organizationId, (tx) => maySend(tx, membershipId, studentId));
}

export type SendOutcome = { sent: true; id: string } | 'not_found' | 'pending' | 'no_season';

export async function sendDocument(
  organizationId: string,
  membershipId: string,
  studentId: string,
  kind: SendableKind,
  examinedOn: string | null,
  bytes: Buffer,
  contentType: string,
  originalName: string,
): Promise<SendOutcome> {
  if (!(await maySendFor(organizationId, membershipId, studentId))) return 'not_found';

  // Which form, and for which season: the same reading *Documentos* shows.
  let stored: StoredKind = kind;
  let seasonId: string | null = null;
  if (kind === 'fpn_declaration') {
    const held = await readDocuments(organizationId, studentId);
    if (held === null) return 'not_found';
    seasonId = held.seasons.find((one) => one.published)?.id ?? null;
    if (seasonId === null) return 'no_season';
    // No birth date is the guardian path: the minor's form, never a guess at adult.
    stored = held.minor === false ? 'fpn_declaration' : 'fpn_declaration_minor';
  }

  let outcome: SendOutcome = 'pending';
  try {
    // Sealed or plain by purpose, registered and recorded in one transaction:
    // a family leaves no orphan file in the bucket's registry.
    await storeFile(organizationId, PURPOSE[stored], bytes, contentType, originalName, async (tx, fileId) => {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO family_submission (organization_id, student_id, kind, season_id, file_id, examined_on, submitted_by)
         VALUES ($1, $2, $3::family_submission_kind, $4, $5, $6::date, $7) RETURNING id`,
        [organizationId, studentId, stored, seasonId, fileId, examinedOn, membershipId],
      );
      const id = rows[0]!.id;
      await recordAudit(tx, {
        action: 'student.document_sent',
        entityType: 'student',
        entityId: studentId,
        data: { kind: stored, submissionId: id },
      });
      outcome = { sent: true, id };
    });
  } catch (error) {
    // One waiting per child and kind (`family_submission_one_pending`).
    if ((error as { code?: string }).code === '23505') return 'pending';
    throw error;
  }
  return outcome;
}

/** The kinds a family has sent and the office has not yet decided, for *Documentos*' statuses. */
export async function pendingKinds(organizationId: string, studentId: string): Promise<Set<StoredKind>> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ kind: StoredKind }>(
      'SELECT kind::text AS kind FROM family_submission WHERE student_id = $1 AND decision IS NULL',
      [studentId],
    );
    return new Set(rows.map((row) => row.kind));
  });
}

export interface Submission {
  id: string;
  kind: StoredKind;
  seasonId: string | null;
  fileId: string;
  contentType: string;
  originalName: string;
  examinedOn: string | null;
  submittedAt: string;
  submittedByName: string | null;
}

/** What waits for the office on one student. */
export async function listPending(organizationId: string, studentId: string): Promise<Submission[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<Submission>(
      `SELECT s.id, s.kind::text AS kind, s.season_id AS "seasonId", s.file_id AS "fileId",
              f.content_type AS "contentType", f.original_name AS "originalName",
              s.examined_on::text AS "examinedOn", s.submitted_at AS "submittedAt",
              nullif(btrim(concat_ws(' ', m.first_name, m.last_name)), '') AS "submittedByName"
         FROM family_submission s
         JOIN stored_file f ON f.organization_id = s.organization_id AND f.id = s.file_id
         LEFT JOIN membership m ON m.organization_id = s.organization_id AND m.id = s.submitted_by
        WHERE s.student_id = $1 AND s.decision IS NULL
        ORDER BY s.submitted_at`,
      [studentId],
    );
    return rows;
  });
}

export type DecideOutcome = 'done' | 'not_found' | 'needs_result' | 'bad_file';

/**
 * Accept: file the copy through the office's own path, then close the sending,
 * in one transaction. An exam takes the result the office reads off it.
 */
export async function acceptSubmission(
  organizationId: string,
  membershipId: string,
  studentId: string,
  submissionId: string,
  exam: { result: ExamResult; validUntil: string | null } | null,
): Promise<DecideOutcome> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ kind: StoredKind; season_id: string | null; file_id: string; examined_on: string | null }>(
      `SELECT kind::text AS kind, season_id, file_id, examined_on::text AS examined_on
         FROM family_submission
        WHERE id = $1 AND student_id = $2 AND decision IS NULL
        FOR UPDATE`,
      [submissionId, studentId],
    );
    const sent = rows[0];
    if (sent === undefined) return 'not_found';

    if (sent.kind === 'medical_exam') {
      if (exam === null) return 'needs_result';
      const examId = await insertExamIn(
        tx,
        organizationId,
        studentId,
        { examinedOn: sent.examined_on!, result: exam.result, validUntil: exam.validUntil, note: null },
        membershipId,
      );
      await tx.query('UPDATE medical_exam SET file_id = $2 WHERE id = $1', [examId, sent.file_id]);
    } else {
      const filed = await fileCopyIn(tx, organizationId, membershipId, studentId, sent.kind, sent.season_id, sent.file_id);
      if (filed === 'not_found') return 'not_found';
      if (filed !== 'filed') return 'bad_file';
    }

    await tx.query(
      `UPDATE family_submission SET decision = 'accepted', decided_by = $2, decided_at = now() WHERE id = $1`,
      [submissionId, membershipId],
    );
    await recordAudit(tx, {
      action: 'student.document_accepted',
      entityType: 'student',
      entityId: studentId,
      data: { kind: sent.kind, submissionId },
    });
    return 'done';
  });
}

/** Reject: the sending closes and, sealed, its file is shredded (the table's trigger). */
export async function rejectSubmission(
  organizationId: string,
  membershipId: string,
  studentId: string,
  submissionId: string,
): Promise<DecideOutcome> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ kind: string }>(
      `UPDATE family_submission SET decision = 'rejected', decided_by = $3, decided_at = now()
        WHERE id = $1 AND student_id = $2 AND decision IS NULL
        RETURNING kind::text AS kind`,
      [submissionId, studentId, membershipId],
    );
    if (rows[0] === undefined) return 'not_found';
    // A plain form (a signed declaration, a boletim) cannot be shredded, so it is
    // archived: `openFile` serves nobody an archived file (review, 05-11-2026).
    // A sealed one was shredded by the decision's trigger.
    await tx.query(
      `UPDATE stored_file SET archived_at = coalesce(archived_at, now())
        WHERE id = (SELECT file_id FROM family_submission WHERE id = $1) AND purpose = 'student_document'`,
      [submissionId],
    );
    await recordAudit(tx, {
      action: 'student.document_rejected',
      entityType: 'student',
      entityId: studentId,
      data: { kind: rows[0].kind, submissionId },
    });
    return 'done';
  });
}
