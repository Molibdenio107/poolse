import { withOrg } from '@poolse/db';
import type { IdDocumentType } from '@poolse/rules';
import { recordAudit } from '../audit/audit.js';
import { decryptSensitive, encryptSensitive } from '../sensitive/cipher.js';
import { storeFile } from '../files/files.repository.js';

/**
 * A staff member's date of birth and identity document — POOLSE-100.
 *
 * **Who** is decided by the controller (owner, admin, or the person). This file
 * decides **what**: the date of birth comes from the login's own record where
 * there is one (`app_user`, theirs — *O meu perfil*), else from the club's
 * membership row, and only the second is written here. The ID document is the
 * club's, encrypted at rest, and a read by anybody but the person is audited in
 * the same transaction that decrypted it.
 */

export interface StaffIdentity {
  birthDate: string | null;
  /** `login`: the person's own, edited in *O meu perfil*. `record`: the club's, edited here. */
  birthDateSource: 'login' | 'record';
  idDocument: { type: IdDocumentType; number: string } | null;
  /** Months after the membership is archived that the document is erased. */
  retentionMonths: number;
  /**
   * The document's photographs — POOLSE-149. Sealed files, read at
   * `/files/<fileId>` under their own rule; null when none is on file.
   */
  photos: { front: IdPhoto | null; back: IdPhoto | null };
}

export interface IdPhoto {
  fileId: string;
  contentType: string;
  originalName: string;
  createdAt: string;
}

export const ID_PHOTO_SIDES = ['front', 'back'] as const;
export type IdPhotoSide = (typeof ID_PHOTO_SIDES)[number];

const PHOTO_COLUMN: Record<IdPhotoSide, string> = {
  front: 'id_document_front_file_id',
  back: 'id_document_back_file_id',
};

const photoOf = (side: 'front' | 'back'): string => `(
  SELECT jsonb_build_object('fileId', f.id, 'contentType', f.content_type,
                            'originalName', f.original_name, 'createdAt', f.created_at)
    FROM stored_file f
   WHERE f.organization_id = m.organization_id AND f.id = m.${PHOTO_COLUMN[side]}
     AND f.archived_at IS NULL
)`;

export async function readIdentity(
  organizationId: string,
  membershipId: string,
  readerMembershipId: string,
): Promise<StaffIdentity | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      login: boolean;
      birth_date: string | null;
      id_document_type: IdDocumentType | null;
      id_document_number_encrypted: string | null;
      retention_months: number;
      front: IdPhoto | null;
      back: IdPhoto | null;
    }>(
      `SELECT m.app_user_id IS NOT NULL AS login,
              to_char(CASE WHEN m.app_user_id IS NULL THEN m.birth_date ELSE au.birth_date END, 'YYYY-MM-DD') AS birth_date,
              m.id_document_type, m.id_document_number_encrypted,
              o.id_document_retention_months AS retention_months,
              ${photoOf('front')} AS front,
              ${photoOf('back')} AS back
         FROM membership m
         JOIN organization o ON o.id = m.organization_id
         LEFT JOIN app_user au ON au.id = m.app_user_id
        WHERE m.id = $1`,
      [membershipId],
    );
    const row = rows[0];
    if (row === undefined) return null;

    const number = decryptSensitive(row.id_document_number_encrypted);
    if (number !== null && readerMembershipId !== membershipId) {
      // The reading is the record (AC 2): who opened whose document, never the number.
      await recordAudit(tx, {
        action: 'membership.id_document_read',
        entityType: 'membership',
        entityId: membershipId,
      });
    }

    return {
      birthDate: row.birth_date,
      birthDateSource: row.login ? 'login' : 'record',
      idDocument: row.id_document_type === null || number === null ? null : { type: row.id_document_type, number },
      retentionMonths: row.retention_months,
      photos: { front: row.front, back: row.back },
    };
  });
}

export interface IdentityEdit {
  /** Undefined: not asked about. Null: clear it. Only for a person without a login. */
  birthDate?: string | null;
  /** Undefined: not asked about. Null: clear it. */
  idDocument?: { type: IdDocumentType; number: string } | null;
}

export class BirthDateIsTheirsError extends Error {}

/** Writes what was asked, and audits which fields moved — never their values. */
export async function writeIdentity(
  organizationId: string,
  membershipId: string,
  edit: IdentityEdit,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ login: boolean }>(
      `SELECT app_user_id IS NOT NULL AS login FROM membership WHERE id = $1 FOR UPDATE`,
      [membershipId],
    );
    const row = rows[0];
    if (row === undefined) return false;

    const changed: string[] = [];
    if (edit.birthDate !== undefined) {
      if (row.login) throw new BirthDateIsTheirsError();
      await tx.query(`UPDATE membership SET birth_date = $2 WHERE id = $1`, [membershipId, edit.birthDate]);
      changed.push('birthDate');
    }
    if (edit.idDocument !== undefined) {
      await tx.query(
        `UPDATE membership SET id_document_type = $2, id_document_number_encrypted = $3 WHERE id = $1`,
        [membershipId, edit.idDocument?.type ?? null, encryptSensitive(edit.idDocument?.number ?? null)],
      );
      changed.push('idDocument');
    }
    if (changed.length > 0) {
      await recordAudit(tx, {
        action: 'membership.identity_updated',
        entityType: 'membership',
        entityId: membershipId,
        data: { withheld: changed },
      });
    }
    return true;
  });
}

/**
 * Files a photograph of the document on one side — POOLSE-149. Sealed by
 * `storeFile`, registered and attached in one transaction; the side's previous
 * photograph is shredded by the database as the column lets it go
 * (`membership_id_document_photo_shreds`). Null when there is no such live
 * staff member.
 */
export async function attachIdPhoto(
  organizationId: string,
  membershipId: string,
  side: IdPhotoSide,
  bytes: Buffer,
  contentType: string,
  originalName: string,
): Promise<{ fileId: string } | null> {
  const live = await withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query(`SELECT 1 FROM membership WHERE id = $1 AND archived_at IS NULL`, [membershipId]);
    return rows.length > 0;
  });
  if (!live) return null;

  const stored = await storeFile(organizationId, 'staff_id_document', bytes, contentType, originalName, async (tx, fileId) => {
    await tx.query(`UPDATE membership SET ${PHOTO_COLUMN[side]} = $2 WHERE id = $1`, [membershipId, fileId]);
    await recordAudit(tx, {
      action: 'membership.id_document_photo_filed',
      entityType: 'membership',
      entityId: membershipId,
      data: { side },
    });
  });
  return { fileId: stored.id };
}

/** Takes a side's photograph off, which shreds it. False when there was none. */
export async function removeIdPhoto(organizationId: string, membershipId: string, side: IdPhotoSide): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rowCount } = await tx.query(
      `UPDATE membership SET ${PHOTO_COLUMN[side]} = NULL
        WHERE id = $1 AND archived_at IS NULL AND ${PHOTO_COLUMN[side]} IS NOT NULL`,
      [membershipId],
    );
    if (rowCount === 0) return false;
    await recordAudit(tx, {
      action: 'membership.id_document_photo_removed',
      entityType: 'membership',
      entityId: membershipId,
      data: { side },
    });
    return true;
  });
}
