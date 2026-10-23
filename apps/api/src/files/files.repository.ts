import { randomUUID } from 'node:crypto';
import { withOrg, type Tx } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';
import { currentTenant } from '../tenant/tenant.context.js';
import { hasRole, type MemberRole } from '../tenant/roles.js';
import { fileContext, openSealedFile, sealFile } from '../sensitive/envelope.js';
import { EXTENSION, getObject, getObjectBytes, putObject } from './storage.js';
import { Readable } from 'node:stream';

/**
 * Stored files — the registry over the bucket (12 October 2026).
 *
 * **Who may write and read a file is decided by its purpose**, in one table
 * below, and for the two purposes whose answer is a row (a qualification's
 * certificate belongs to a person) by a query. A file uploaded and not yet
 * attached to anything is its uploader's and the office's.
 */

export type FilePurpose =
  | 'policy_document'
  | 'qualification_document'
  | 'agreement_document'
  | 'facility_photo'
  | 'pool_photo'
  | 'logo'
  | 'student_photo'
  | 'incident_attachment'
  | 'medical_certificate';

/**
 * Health data, sealed at rest — POOLSE-109. The bucket holds ciphertext, the
 * row holds the file's own wrapped key (`sensitive/envelope.ts`), every read is
 * audited, and the uploader rule does not apply: a family that uploaded an
 * atestado and has since been unlinked from the child reads it no longer.
 * Incident attachments switch on by joining (and the `stored_file_sealed`
 * CHECK names them already).
 */
export const SEALED_PURPOSES: ReadonlySet<FilePurpose> = new Set<FilePurpose>(['medical_certificate', 'incident_attachment']);

const OFFICE: readonly MemberRole[] = ['owner', 'admin'];
const STAFF: readonly MemberRole[] = ['owner', 'admin', 'instructor', 'maintenance'];
const ANYONE: readonly MemberRole[] = ['owner', 'admin', 'instructor', 'maintenance', 'student', 'guardian'];

/**
 * Write and read, per purpose. `null` for write means "not switched on yet":
 * student photos wait for the photo-consent rule and incident attachments for
 * encryption (Rui, 12 October 2026).
 */
export const RULES: Record<FilePurpose, { write: readonly MemberRole[] | null; read: readonly MemberRole[] }> = {
  policy_document: { write: OFFICE, read: OFFICE },
  // Staff may read the signed contract (Rui, 23-10-2026, POOLSE-105): a coach
  // needs the paper the school signed; the typed terms stay the office's.
  agreement_document: { write: OFFICE, read: STAFF },
  qualification_document: { write: OFFICE, read: OFFICE },
  // Every member since 15 October 2026 (Rui): the Instalações list is
  // everybody's, families included, and the picture of the place is part of
  // the card. A tank's photographs sit on its page, which is staff only.
  facility_photo: { write: OFFICE, read: ANYONE },
  pool_photo: { write: OFFICE, read: STAFF },
  logo: { write: OFFICE, read: ANYONE },
  student_photo: { write: null, read: OFFICE },
  incident_attachment: { write: null, read: OFFICE },
  // Never through POST /files: an atestado is uploaded by its leave's own route,
  // which a family may use for its own child (POOLSE-109). Read by the office,
  // and — a question about a row — by the child's own family (see openFile).
  // A coach is told it exists and never given it.
  medical_certificate: { write: null, read: OFFICE },
};

export interface StoredFile {
  id: string;
  purpose: FilePurpose;
  contentType: string;
  byteSize: number;
  originalName: string;
  createdAt: string;
}

/**
 * Puts a file in the bucket and registers it. `attach`, when given, runs in the
 * same transaction as the registration, so a file and the record it belongs to
 * arrive together or not at all (POOLSE-109's atestado).
 */
export async function storeFile(
  organizationId: string,
  purpose: FilePurpose,
  bytes: Buffer,
  contentType: string,
  originalName: string,
  attach?: (tx: Tx, fileId: string) => Promise<void>,
): Promise<StoredFile> {
  const id = randomUUID();
  const sealed = SEALED_PURPOSES.has(purpose) ? sealFile(bytes, fileContext(organizationId, id)) : null;
  // Under the club's own prefix — the CHECK on stored_file refuses anything else.
  // A sealed object says nothing about itself: no extension, no content type.
  const key =
    sealed === null
      ? `${organizationId}/${purpose}/${id}.${EXTENSION[contentType] ?? 'bin'}`
      : `${organizationId}/${purpose}/${id}.sealed`;

  // The object first: a row naming an object that never arrived would be a
  // broken link; an object with no row is an orphan nobody can reach.
  await putObject(key, sealed?.body ?? bytes, sealed === null ? contentType : 'application/octet-stream');

  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ created_at: Date }>(
      `INSERT INTO stored_file (id, organization_id, purpose, storage_key, content_type, byte_size,
                                original_name, uploaded_by, wrapped_key)
       VALUES ($1, $2, $3::file_purpose, $4, $5, $6, $7, $8, $9)
       RETURNING created_at`,
      [
        id,
        organizationId,
        purpose,
        key,
        contentType,
        bytes.length,
        originalName,
        currentTenant().membershipId,
        sealed?.wrappedKey ?? null,
      ],
    );
    await recordAudit(tx, {
      action: 'file.uploaded',
      entityType: 'stored_file',
      entityId: id,
      data: { purpose, contentType, byteSize: bytes.length },
    });
    if (attach !== undefined) await attach(tx, id);
    return {
      id,
      purpose,
      contentType,
      byteSize: bytes.length,
      originalName,
      createdAt: rows[0]!.created_at.toISOString(),
    };
  });
}

/**
 * The bytes of a file, if this reader may have them — else `'refused'`, or
 * null when there is no such file in this club (RLS makes another club's id
 * indistinguishable from none).
 */
export async function openFile(
  organizationId: string,
  fileId: string,
): Promise<
  | { body: Readable; contentType: string; originalName: string; byteSize: number }
  | 'refused'
  | null
> {
  const { membershipId } = currentTenant();
  const row = await withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      purpose: FilePurpose;
      storage_key: string;
      content_type: string;
      original_name: string;
      byte_size: number;
      uploaded_by: string;
      wrapped_key: string | null;
      own_certificate: boolean;
      leave_student_id: string | null;
      own_child_certificate: boolean;
    }>(
      `SELECT f.purpose::text AS purpose, f.storage_key, f.content_type, f.original_name,
              f.byte_size, f.uploaded_by, f.wrapped_key,
              EXISTS (SELECT 1 FROM qualification q
                       WHERE q.document_file_id = f.id AND q.organization_id = f.organization_id
                         AND q.membership_id = $2) AS own_certificate,
              l.student_id AS leave_student_id,
              -- An atestado is its child's family's: the student themself, or a
              -- live encarregado — the rule mayActForStudent holds (POOLSE-109).
              (l.student_id IS NOT NULL AND (
                 EXISTS (SELECT 1 FROM student s
                          WHERE s.id = l.student_id AND s.membership_id = $2 AND s.archived_at IS NULL)
                 OR EXISTS (SELECT 1 FROM guardian_link gl
                             WHERE gl.student_id = l.student_id AND gl.guardian_membership_id = $2
                               AND gl.archived_at IS NULL))) AS own_child_certificate
         FROM stored_file f
         LEFT JOIN medical_leave_certificate c
           ON c.organization_id = f.organization_id AND c.file_id = f.id
         LEFT JOIN student_medical_leave l
           ON l.organization_id = c.organization_id AND l.id = c.leave_id
        WHERE f.id = $1 AND f.archived_at IS NULL`,
      [fileId, membershipId],
    );
    return rows[0] ?? null;
  });
  if (row === null) return null;

  const sealed = SEALED_PURPOSES.has(row.purpose);
  const allowed = sealed
    ? hasRole(...RULES[row.purpose].read) || row.own_child_certificate
    : hasRole(...RULES[row.purpose].read) ||
      // A certificate is readable by the person it certifies.
      row.own_certificate ||
      // A file just uploaded, before it is attached, is its uploader's.
      row.uploaded_by === membershipId;
  if (!allowed) return 'refused';

  if (!sealed) {
    return {
      body: await getObject(row.storage_key),
      contentType: row.content_type,
      originalName: row.original_name,
      byteSize: row.byte_size,
    };
  }

  // Health data: every download is on the record — who (the audit row's
  // actor), whose, when — written before a byte leaves (POOLSE-109, BA 3).
  if (row.wrapped_key === null) return null;
  await withOrg(organizationId, (tx) =>
    recordAudit(tx, {
      action: 'file.read',
      entityType: 'stored_file',
      entityId: fileId,
      data: { purpose: row.purpose, studentId: row.leave_student_id },
    }),
  );
  const body = openSealedFile(
    await getObjectBytes(row.storage_key),
    row.wrapped_key,
    fileContext(organizationId, fileId),
  );
  // One chunk: Readable.from never iterates a Buffer byte by byte.
  return { body: Readable.from(body), contentType: row.content_type, originalName: row.original_name, byteSize: body.length };
}
