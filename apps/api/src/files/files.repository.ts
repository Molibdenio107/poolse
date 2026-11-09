import { fileOpensInView } from '../tenant/app-view.js';
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
  | 'staff_photo'
  | 'incident_attachment'
  | 'medical_certificate'
  | 'meet_results'
  | 'student_document'
  | 'boletim_template'
  | 'staff_id_document'
  | 'student_id_document'
  | 'staff_contract';

/**
 * Health data, sealed at rest — POOLSE-109. The bucket holds ciphertext, the
 * row holds the file's own wrapped key (`sensitive/envelope.ts`), every read is
 * audited, and the uploader rule does not apply: a family that uploaded an
 * atestado and has since been unlinked from the child reads it no longer.
 * Incident attachments switch on by joining (and the `stored_file_sealed`
 * CHECK names them already).
 */
export const SEALED_PURPOSES: ReadonlySet<FilePurpose> = new Set<FilePurpose>([
  'medical_certificate',
  'incident_attachment',
  // POOLSE-149: a staff member's ID document photograph. Not health data, but
  // a copy of an identity card is the document fraud starts from.
  'staff_id_document',
  // POOLSE-179: a student's ID document photograph — a child's Cartão de
  // Cidadão. Its own purpose so the FPN forms and boletim stay plain.
  'student_id_document',
]);

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
  // A person sends their own certificate from the phone (Rui, 07-11-2026); the
  // route that attaches it checks it is theirs, and reading stays the office's
  // and the holder's (`own_certificate`).
  qualification_document: { write: STAFF, read: OFFICE },
  // Every member since 15 October 2026 (Rui): the Instalações list is
  // everybody's, families included, and the picture of the place is part of
  // the card. A tank's photographs sit on its page, which is staff only.
  facility_photo: { write: OFFICE, read: ANYONE },
  pool_photo: { write: OFFICE, read: STAFF },
  logo: { write: OFFICE, read: ANYONE },
  // Rui, 28-10-2026. A student's photograph: staff, and the child's own family
  // (a question about a row, see openFile) — and only while the photo consent
  // stands, checked again on every read. A staff member's: staff.
  student_photo: { write: OFFICE, read: STAFF },
  staff_photo: { write: OFFICE, read: STAFF },
  incident_attachment: { write: null, read: OFFICE },
  // Never through POST /files: an atestado is uploaded by its leave's own route,
  // which a family may use for its own child (POOLSE-109). Read by the office,
  // and — a question about a row — by the child's own family (see openFile).
  // A coach is told it exists and never given it.
  medical_certificate: { write: null, read: OFFICE },
  // A meet's LENEX file that arrived by email (POOLSE-114). Never through
  // POST /files — the inbound path stores it — and read by the people who
  // import a meet, through the inbox's own route.
  meet_results: { write: null, read: ['owner', 'admin', 'instructor'] },
  // POOLSE-132: a signed FPN declaration or boletim de sócio — the office's
  // file. It carries an ID number and a signature, so not a coach's.
  student_document: { write: OFFICE, read: OFFICE },
  // POOLSE-142: the club's own boletim, an image of its paper form, which holds
  // nobody's details. Written by the office; read by anyone since POOLSE-179,
  // because a family's filled form is drawn on it.
  boletim_template: { write: OFFICE, read: ANYONE },
  // POOLSE-149: the photograph of a staff member's ID document. Never through
  // POST /files — the staff record's own route stores and attaches it — and
  // read by the office and, a question about a row, the person (see openFile).
  staff_id_document: { write: null, read: OFFICE },
  // POOLSE-179: a student's ID document photograph, sealed. Uploaded by the
  // office through POST /files and filed by the record's own route, which
  // refuses it under any other kind (and the database refuses a plain file
  // as an ID photo). Read by the office only; every read audited.
  student_id_document: { write: OFFICE, read: OFFICE },
  // POOLSE-149: a staff member's contract, PDF or Word. Never through POST
  // /files — the record's own route files it as a version — and read as pay is:
  // owner and admin, an Admin never the Owner's, and the person (see openFile).
  staff_contract: { write: null, read: OFFICE },
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
  | 'viewing_as'
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
      photo_attached: boolean;
      photo_consented: boolean;
      own_child_photo: boolean;
      classmate_photo: boolean;
      teaches_mine: boolean;
      id_document_holder: string | null;
      id_document_student: string | null;
      contract_holder: string | null;
      contract_holder_is_owner: boolean;
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
                 OR EXISTS (SELECT 1 FROM guardian_access gl
                             WHERE gl.student_id = l.student_id AND gl.guardian_membership_id = $2
                               AND gl.archived_at IS NULL))) AS own_child_certificate,
              -- A student's photograph (Rui, 28-10-2026): shown only while its
              -- photo consent stands, and to the child's own family as to staff.
              sp.id IS NOT NULL AS photo_attached,
              (sp.id IS NOT NULL AND EXISTS (
                 SELECT 1 FROM consent pc
                  WHERE pc.organization_id = sp.organization_id AND pc.student_id = sp.id
                    AND pc.kind = 'photo' AND pc.granted AND pc.withdrawn_at IS NULL)) AS photo_consented,
              (sp.id IS NOT NULL AND (
                 sp.membership_id = $2
                 OR EXISTS (SELECT 1 FROM guardian_access gl
                             WHERE gl.student_id = sp.id AND gl.guardian_membership_id = $2
                               AND gl.archived_at IS NULL))) AS own_child_photo,
              -- POOLSE-194: an adult's photo, to someone in their turma now. A
              -- minor's never reaches another family, whoever asks.
              (sp.id IS NOT NULL AND student_is_adult_path(sp.organization_id, sp.id) AND EXISTS (
                 SELECT 1 FROM enrollment them
                   JOIN enrollment us
                     ON us.organization_id = them.organization_id AND us.class_group_id = them.class_group_id
                    AND us.status = 'active'
                   JOIN student my ON my.id = us.student_id AND my.organization_id = us.organization_id
                  WHERE them.organization_id = sp.organization_id AND them.student_id = sp.id
                    AND them.status = 'active' AND my.archived_at IS NULL
                    AND (my.membership_id = $2
                         OR EXISTS (SELECT 1 FROM guardian_access gl
                                     WHERE gl.student_id = my.id AND gl.guardian_membership_id = $2
                                       AND gl.archived_at IS NULL)))) AS classmate_photo,
              -- POOLSE-194: the photo of whoever teaches a child of this family,
              -- this week or the next, a stand-in included.
              EXISTS (
                SELECT 1 FROM membership im
                  JOIN class_session cs
                    ON cs.organization_id = im.organization_id AND cs.resolved_instructor_id = im.id
                   AND cs.occurs_on BETWEEN club_today() - 7 AND club_today() + 14
                  JOIN enrollment us
                    ON us.organization_id = cs.organization_id AND us.class_group_id = cs.class_group_id
                   AND us.status = 'active'
                  JOIN student my ON my.id = us.student_id AND my.organization_id = us.organization_id
                 WHERE im.organization_id = f.organization_id AND im.photo_file_id = f.id
                   AND my.archived_at IS NULL
                   AND (my.membership_id = $2
                        OR EXISTS (SELECT 1 FROM guardian_access gl
                                    WHERE gl.student_id = my.id AND gl.guardian_membership_id = $2
                                      AND gl.archived_at IS NULL))) AS teaches_mine,
              -- Whose ID document this photograph is (POOLSE-149).
              (SELECT m.id FROM membership m
                WHERE m.organization_id = f.organization_id
                  AND (m.id_document_front_file_id = f.id OR m.id_document_back_file_id = f.id)
                LIMIT 1) AS id_document_holder,
              -- Whose ID document photograph this is, for the audit (POOLSE-179).
              (SELECT d.student_id FROM student_document d
                WHERE d.organization_id = f.organization_id AND d.file_id = f.id
                LIMIT 1) AS id_document_student,
              -- Whose contract this file is, and whether that is the Owner (POOLSE-149).
              cv.membership_id AS contract_holder,
              EXISTS (SELECT 1 FROM membership_role r
                       WHERE r.membership_id = cv.membership_id AND r.organization_id = f.organization_id
                         AND r.archived_at IS NULL AND r.role = 'owner') AS contract_holder_is_owner
         FROM stored_file f
         LEFT JOIN LATERAL (
           SELECT v.membership_id FROM staff_contract_version v
            WHERE v.organization_id = f.organization_id AND v.file_id = f.id
            LIMIT 1
         ) cv ON true
         LEFT JOIN student sp
           ON sp.organization_id = f.organization_id AND sp.photo_file_id = f.id
          AND sp.archived_at IS NULL
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
  // POOLSE-188: under a view the purpose answers first, rule 10a.
  if (!fileOpensInView(row.purpose)) return 'viewing_as';

  const sealed = SEALED_PURPOSES.has(row.purpose);
  const allowed = row.purpose === 'student_photo'
    ? row.photo_attached
      ? row.photo_consented && (hasRole(...RULES.student_photo.read) || row.own_child_photo || row.classmate_photo)
      : row.uploaded_by === membershipId
    : row.purpose === 'staff_contract'
    ? row.contract_holder === membershipId ||
      hasRole('owner') ||
      (hasRole('admin') && row.contract_holder !== null && !row.contract_holder_is_owner)
    : row.purpose === 'staff_id_document'
    ? hasRole(...RULES.staff_id_document.read) || row.id_document_holder === membershipId
    : sealed
    ? hasRole(...RULES[row.purpose].read) || row.own_child_certificate
    : hasRole(...RULES[row.purpose].read) ||
      // POOLSE-194: a family sees who teaches its child.
      (row.purpose === 'staff_photo' && row.teaches_mine) ||
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
  // An ID document's photograph is audited as its number is (POOLSE-100): who
  // opened whose, and never the person's own look at theirs.
  if (row.purpose !== 'staff_id_document' || row.id_document_holder !== membershipId) {
    await withOrg(organizationId, (tx) =>
      recordAudit(
        tx,
        row.purpose === 'staff_id_document'
          ? {
              action: 'membership.id_document_read',
              entityType: 'membership',
              entityId: row.id_document_holder ?? fileId,
              data: { fileId },
            }
          : row.purpose === 'student_id_document'
          ? {
              // As the number is read (POOLSE-132): who opened whose.
              action: 'student.id_document_read',
              entityType: row.id_document_student === null ? 'stored_file' : 'student',
              entityId: row.id_document_student ?? fileId,
              data: { fileId, photo: true },
            }
          : {
              action: 'file.read',
              entityType: 'stored_file',
              entityId: fileId,
              data: { purpose: row.purpose, studentId: row.leave_student_id },
            },
      ),
    );
  }
  const body = openSealedFile(
    await getObjectBytes(row.storage_key),
    row.wrapped_key,
    fileContext(organizationId, fileId),
  );
  // One chunk: Readable.from never iterates a Buffer byte by byte.
  return { body: Readable.from(body), contentType: row.content_type, originalName: row.original_name, byteSize: body.length };
}
