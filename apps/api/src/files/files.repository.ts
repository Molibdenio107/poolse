import { randomUUID } from 'node:crypto';
import { withOrg } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';
import { currentTenant } from '../tenant/tenant.context.js';
import { hasRole, type MemberRole } from '../tenant/roles.js';
import { EXTENSION, getObject, putObject } from './storage.js';
import type { Readable } from 'node:stream';

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
  | 'incident_attachment';

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
  agreement_document: { write: OFFICE, read: OFFICE },
  qualification_document: { write: OFFICE, read: OFFICE },
  facility_photo: { write: OFFICE, read: STAFF },
  pool_photo: { write: OFFICE, read: STAFF },
  logo: { write: OFFICE, read: ANYONE },
  student_photo: { write: null, read: OFFICE },
  incident_attachment: { write: null, read: OFFICE },
};

export interface StoredFile {
  id: string;
  purpose: FilePurpose;
  contentType: string;
  byteSize: number;
  originalName: string;
  createdAt: string;
}

export async function storeFile(
  organizationId: string,
  purpose: FilePurpose,
  bytes: Buffer,
  contentType: string,
  originalName: string,
): Promise<StoredFile> {
  const id = randomUUID();
  // Under the club's own prefix — the CHECK on stored_file refuses anything else.
  const key = `${organizationId}/${purpose}/${id}.${EXTENSION[contentType] ?? 'bin'}`;

  // The object first: a row naming an object that never arrived would be a
  // broken link; an object with no row is an orphan nobody can reach.
  await putObject(key, bytes, contentType);

  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ created_at: Date }>(
      `INSERT INTO stored_file (id, organization_id, purpose, storage_key, content_type, byte_size,
                                original_name, uploaded_by)
       VALUES ($1, $2, $3::file_purpose, $4, $5, $6, $7, $8)
       RETURNING created_at`,
      [id, organizationId, purpose, key, contentType, bytes.length, originalName, currentTenant().membershipId],
    );
    await recordAudit(tx, {
      action: 'file.uploaded',
      entityType: 'stored_file',
      entityId: id,
      data: { purpose, contentType, byteSize: bytes.length },
    });
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
  const row = await withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      purpose: FilePurpose;
      storage_key: string;
      content_type: string;
      original_name: string;
      byte_size: number;
      uploaded_by: string;
      own_certificate: boolean;
    }>(
      `SELECT f.purpose::text AS purpose, f.storage_key, f.content_type, f.original_name,
              f.byte_size, f.uploaded_by,
              EXISTS (SELECT 1 FROM qualification q
                       WHERE q.document_file_id = f.id AND q.organization_id = f.organization_id
                         AND q.membership_id = $2) AS own_certificate
         FROM stored_file f
        WHERE f.id = $1 AND f.archived_at IS NULL`,
      [fileId, currentTenant().membershipId],
    );
    return rows[0] ?? null;
  });
  if (row === null) return null;

  const allowed =
    hasRole(...RULES[row.purpose].read) ||
    // A certificate is readable by the person it certifies.
    row.own_certificate ||
    // A file just uploaded, before it is attached, is its uploader's.
    row.uploaded_by === currentTenant().membershipId;
  if (!allowed) return 'refused';

  return {
    body: await getObject(row.storage_key),
    contentType: row.content_type,
    originalName: row.original_name,
    byteSize: row.byte_size,
  };
}
