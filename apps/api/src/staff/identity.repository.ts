import { withOrg } from '@poolse/db';
import type { IdDocumentType } from '@poolse/rules';
import { recordAudit } from '../audit/audit.js';
import { decryptSensitive, encryptSensitive } from '../sensitive/cipher.js';

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
}

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
    }>(
      `SELECT m.app_user_id IS NOT NULL AS login,
              to_char(CASE WHEN m.app_user_id IS NULL THEN m.birth_date ELSE au.birth_date END, 'YYYY-MM-DD') AS birth_date,
              m.id_document_type, m.id_document_number_encrypted,
              o.id_document_retention_months AS retention_months
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
