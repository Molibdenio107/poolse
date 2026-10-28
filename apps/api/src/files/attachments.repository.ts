import { withOrg, type Tx } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';
import { currentTenant } from '../tenant/tenant.context.js';
import type { FilePurpose } from './files.repository.js';
import { CURRENT_AGREEMENT } from '../facilities/partners.repository.js';

/**
 * Attaching an uploaded file to the thing it belongs to — 12 October 2026.
 *
 * Upload and attach are two steps on purpose: the upload is the same call for
 * every purpose, and attaching is the feature's own write, checked by the
 * feature's own rule. Each attach below reads the file **inside its own
 * transaction** and refuses one of the wrong purpose — a logo cannot be filed
 * as an apólice by sending its id — and RLS makes another club's file
 * indistinguishable from none.
 */

/** The file named is not this club's, is archived, or is not for this. */
export class WrongFileError extends Error {
  constructor() {
    super('No such file for this purpose');
  }
}

async function fileKey(tx: Tx, fileId: string, purpose: FilePurpose): Promise<string> {
  const { rows } = await tx.query<{ storage_key: string }>(
    `SELECT storage_key FROM stored_file
      WHERE id = $1 AND purpose = $2::file_purpose AND archived_at IS NULL`,
    [fileId, purpose],
  );
  if (rows[0] === undefined) throw new WrongFileError();
  return rows[0].storage_key;
}

// ---------------------------------------------------------------------------
// Photographs of a site and of a tank
// ---------------------------------------------------------------------------

const PHOTO_TABLES = {
  facility: { table: 'facility_photo', parent: 'facility', column: 'facility_id', purpose: 'facility_photo' },
  pool: { table: 'pool_photo', parent: 'pool', column: 'pool_id', purpose: 'pool_photo' },
} as const;

export type PhotoOwner = keyof typeof PHOTO_TABLES;

/** Adds a photograph at the end of the gallery. Null when the parent is not this club's. */
export async function addPhoto(
  organizationId: string,
  owner: PhotoOwner,
  parentId: string,
  fileId: string,
  caption: string | null,
): Promise<{ id: string } | null> {
  const spec = PHOTO_TABLES[owner];
  return withOrg(organizationId, async (tx) => {
    const parent = await tx.query(
      `SELECT 1 FROM ${spec.parent} WHERE id = $1 AND archived_at IS NULL`,
      [parentId],
    );
    if (parent.rowCount === 0) return null;
    const key = await fileKey(tx, fileId, spec.purpose);

    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO ${spec.table}
         (organization_id, ${spec.column}, storage_key, caption, sort_order, uploaded_by_membership_id)
       VALUES ($1, $2, $3, $4,
               (SELECT coalesce(max(sort_order), 0) + 1 FROM ${spec.table}
                 WHERE ${spec.column} = $2 AND archived_at IS NULL),
               $5)
       RETURNING id`,
      [organizationId, parentId, key, caption, currentTenant().membershipId],
    );
    await recordAudit(tx, {
      action: `${spec.table}.added`,
      entityType: spec.parent,
      entityId: parentId,
      data: { fileId },
    });
    return { id: rows[0]!.id };
  });
}

/** Takes a photograph out of the gallery. The file itself is kept — history. */
export async function removePhoto(
  organizationId: string,
  owner: PhotoOwner,
  parentId: string,
  photoId: string,
): Promise<boolean> {
  const spec = PHOTO_TABLES[owner];
  return withOrg(organizationId, async (tx) => {
    const { rowCount } = await tx.query(
      `UPDATE ${spec.table} SET archived_at = now()
        WHERE id = $1 AND ${spec.column} = $2 AND archived_at IS NULL`,
      [photoId, parentId],
    );
    if (rowCount === 0) return false;
    await recordAudit(tx, {
      action: `${spec.table}.removed`,
      entityType: spec.parent,
      entityId: parentId,
      data: { photoId },
    });
    return true;
  });
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

/**
 * The apólice's own document. Replaceable — a renewed policy is re-scanned,
 * and the previous file stays in `stored_file` and in the audit trail.
 */
export async function setPolicyDocument(
  organizationId: string,
  facilityId: string,
  policyId: string,
  fileId: string | null,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    if (fileId !== null) await fileKey(tx, fileId, 'policy_document');
    const { rowCount } = await tx.query(
      `UPDATE insurance_policy SET document_file_id = $3
        WHERE id = $2 AND facility_id = $1 AND archived_at IS NULL`,
      [facilityId, policyId, fileId],
    );
    if (rowCount === 0) return false;
    await recordAudit(tx, {
      action: fileId === null ? 'insurance_policy.document_removed' : 'insurance_policy.document_attached',
      entityType: 'insurance_policy',
      entityId: policyId,
      data: { fileId },
    });
    return true;
  });
}

/**
 * The signed contract, on the agreement in force — POOLSE-105.
 *
 * **Available from the partner's first day:** with no agreement yet, the
 * upload makes one with no terms (*termos por preencher*), so the paper is
 * filed before the rates are typed. **Replacing keeps the old file:** the
 * current version is closed with who replaced it and when, the new one opened,
 * and `document_key` moved to it. Removing closes the current version and
 * opens none. Null when there is no such partner.
 */
export async function setAgreementDocument(
  organizationId: string,
  partnerId: string,
  fileId: string | null,
): Promise<boolean> {
  const { membershipId } = currentTenant();
  return withOrg(organizationId, async (tx) => {
    const partner = await tx.query('SELECT 1 FROM partner WHERE id = $1 AND archived_at IS NULL', [partnerId]);
    if (partner.rowCount === 0) return false;

    const key = fileId === null ? null : await fileKey(tx, fileId, 'agreement_document');

    let agreementId = (await tx.query<{ id: string }>(CURRENT_AGREEMENT, [partnerId])).rows[0]?.id;
    let createdPending = false;
    if (agreementId === undefined) {
      if (fileId === null) return true; // nothing filed, nothing to remove
      agreementId = (
        await tx.query<{ id: string }>(
          `INSERT INTO partner_agreement (organization_id, partner_id) VALUES ($1, $2) RETURNING id`,
          [organizationId, partnerId],
        )
      ).rows[0]!.id;
      createdPending = true;
    }

    await tx.query(
      `UPDATE partner_contract_version SET replaced_at = now(), replaced_by = $2
        WHERE agreement_id = $1 AND replaced_at IS NULL`,
      [agreementId, membershipId],
    );
    if (fileId !== null) {
      await tx.query(
        `INSERT INTO partner_contract_version (organization_id, agreement_id, file_id, attached_by)
         VALUES ($1, $2, $3, $4)`,
        [organizationId, agreementId, fileId, membershipId],
      );
    }
    await tx.query(`UPDATE partner_agreement SET document_key = $2 WHERE id = $1`, [agreementId, key]);

    await recordAudit(tx, {
      action: fileId === null ? 'partner.agreement.document_removed' : 'partner.agreement.document_attached',
      entityType: 'partner',
      entityId: partnerId,
      data: { agreementId, fileId, ...(createdPending ? { termsPending: true } : {}) },
    });
    return true;
  });
}

/** Raised by `qualification_document_once` — a certificate is attached once. */
export class CertificateAlreadyAttachedError extends Error {
  constructor() {
    super('This qualification already has its certificate');
  }
}

/**
 * A qualification's certificate, attached once. The record is never edited
 * (POOLSE-27); a scan arriving after the record is the same record completed,
 * and the trigger refuses a second one — a different certificate is a new record.
 */
export async function setQualificationDocument(
  organizationId: string,
  qualificationId: string,
  fileId: string,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    await fileKey(tx, fileId, 'qualification_document');
    let rowCount: number | null;
    try {
      ({ rowCount } = await tx.query(
        `UPDATE qualification SET document_file_id = $2
          WHERE id = $1 AND archived_at IS NULL`,
        [qualificationId, fileId],
      ));
    } catch (error) {
      if ((error as { detail?: string }).detail === 'qualification_document_set') {
        throw new CertificateAlreadyAttachedError();
      }
      throw error;
    }
    if (rowCount === 0) return false;
    await recordAudit(tx, {
      action: 'qualification.document_attached',
      entityType: 'qualification',
      entityId: qualificationId,
      data: { fileId },
    });
    return true;
  });
}

/** The club's logo, or none. */
export async function setLogo(organizationId: string, fileId: string | null): Promise<void> {
  await withOrg(organizationId, async (tx) => {
    if (fileId !== null) await fileKey(tx, fileId, 'logo');
    await tx.query(`UPDATE organization SET logo_file_id = $2 WHERE id = $1`, [organizationId, fileId]);
    await recordAudit(tx, {
      action: fileId === null ? 'organization.logo_removed' : 'organization.logo_set',
      entityType: 'organization',
      entityId: organizationId,
      data: { fileId },
    });
  });
}

export async function logoFileId(organizationId: string): Promise<string | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ logo_file_id: string | null }>(
      `SELECT logo_file_id FROM organization WHERE id = $1`,
      [organizationId],
    );
    return rows[0]?.logo_file_id ?? null;
  });
}


// ---------------------------------------------------------------------------
// A person's photograph — Rui, 28-10-2026
// ---------------------------------------------------------------------------

/** A student's photograph needs a live photo consent first: it could not be shown without one. */
export class PhotoNeedsConsentError extends Error {
  constructor() {
    super('This student has no photo consent');
  }
}

/** Somebody with a login sets their own photograph, as they set their own name. */
export class PhotoIsTheirsError extends Error {
  constructor() {
    super('This person sets their own photograph');
  }
}

/**
 * A student's photograph, or none. Null when the student is not this club's.
 * Filing one is refused without a live photo consent: a photograph the club
 * may not show is a photograph it should not be keeping. Removing one never is.
 */
export async function setStudentPhoto(
  organizationId: string,
  studentId: string,
  fileId: string | null,
): Promise<boolean | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ consented: boolean }>(
      `SELECT EXISTS (
                SELECT 1 FROM consent c
                 WHERE c.organization_id = s.organization_id AND c.student_id = s.id
                   AND c.kind = 'photo' AND c.granted AND c.withdrawn_at IS NULL
              ) AS consented
         FROM student s
        WHERE s.id = $1 AND s.archived_at IS NULL AND s.anonymised_at IS NULL
        FOR UPDATE OF s`,
      [studentId],
    );
    if (rows[0] === undefined) return null;
    if (fileId !== null) {
      await fileKey(tx, fileId, 'student_photo');
      if (!rows[0].consented) throw new PhotoNeedsConsentError();
    }
    await tx.query(`UPDATE student SET photo_file_id = $2 WHERE id = $1`, [studentId, fileId]);
    await recordAudit(tx, {
      action: fileId === null ? 'student.photo_removed' : 'student.photo_set',
      entityType: 'student',
      entityId: studentId,
      data: { fileId },
    });
    return true;
  });
}

/**
 * A staff member's photograph, or none — only for somebody with no login.
 * Null when the person is not this club's staff.
 */
export async function setStaffPhoto(
  organizationId: string,
  membershipId: string,
  fileId: string | null,
): Promise<boolean | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ has_login: boolean }>(
      `SELECT m.app_user_id IS NOT NULL AS has_login
         FROM membership m
        WHERE m.id = $1 AND m.archived_at IS NULL AND m.support_grant_id IS NULL
        FOR UPDATE`,
      [membershipId],
    );
    if (rows[0] === undefined) return null;
    if (rows[0].has_login) throw new PhotoIsTheirsError();
    if (fileId !== null) await fileKey(tx, fileId, 'staff_photo');
    await tx.query(`UPDATE membership SET photo_file_id = $2 WHERE id = $1`, [membershipId, fileId]);
    await recordAudit(tx, {
      action: fileId === null ? 'membership.photo_removed' : 'membership.photo_set',
      entityType: 'membership',
      entityId: membershipId,
      data: { fileId },
    });
    return true;
  });
}
