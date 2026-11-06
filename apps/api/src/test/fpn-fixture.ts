import pg from 'pg';
import { encryptSensitive } from '../sensitive/cipher.js';
import type { ScratchTenant } from './harness.js';

/**
 * Everything the FPN form needs — POOLSE-193, where a family cannot take or send
 * it with a mandatory field empty. The club's two fields are the owner login's to
 * write in a test, as every club setting is.
 */
export async function completeFpnForm(tenant: ScratchTenant, studentId: string): Promise<void> {
  const owner = new pg.Client({ connectionString: process.env['DATABASE_URL'] });
  await owner.connect();
  try {
    await owner.query(`UPDATE organization SET fpn_association = 'ANNP', fpn_club_code = 'CL01' WHERE id = $1`, [
      tenant.organizationId,
    ]);
    await owner.query(
      `UPDATE student
          SET address_line = 'Rua das Flores 1', locality = 'Porto', postal_code = '4000-001',
              id_document_type = 'cc', id_document_number_encrypted = $2,
              id_document_valid_until = club_today() + 365, fpn_disciplines = '{pura}'
        WHERE id = $1`,
      [studentId, encryptSensitive('12345678')],
    );
  } finally {
    await owner.end();
  }
}
