import { withOrg } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';

/**
 * A staff member's personal details — POOLSE-149 slice A (Rui, 02-11-2026).
 *
 * Morada, localidade, código postal, NIF, NISS, nacionalidade, naturalidade and
 * an emergency contact. **Who** is the controller's (owner, admin, or the
 * person); this file decides **what**. Morada and NIF are the person row's own
 * `address` and `tax_number`, shared with a guardian hat, so a person has one of
 * each in a club. Every field is personal data, so the change log names what
 * moved and never the values, as POOLSE-100's identity does.
 */

export interface StaffDetails {
  address: string | null;
  locality: string | null;
  postalCode: string | null;
  taxNumber: string | null;
  niss: string | null;
  nationality: string | null;
  birthplace: string | null;
  emergencyName: string | null;
  emergencyPhone: string | null;
  emergencyRelation: string | null;
}

/** The API field and its column, in the one order every path uses. */
export const DETAIL_COLUMNS = [
  ['address', 'address'],
  ['locality', 'locality'],
  ['postalCode', 'postal_code'],
  ['taxNumber', 'tax_number'],
  ['niss', 'niss'],
  ['nationality', 'nationality'],
  ['birthplace', 'birthplace'],
  ['emergencyName', 'emergency_name'],
  ['emergencyPhone', 'emergency_phone'],
  ['emergencyRelation', 'emergency_relation'],
] as const satisfies readonly (readonly [keyof StaffDetails, string])[];

/** The club's to set, never the person's own: what the payroll is keyed on. */
export const CLUB_DETAIL_FIELDS: readonly (keyof StaffDetails)[] = ['taxNumber', 'niss'];

const SELECT = DETAIL_COLUMNS.map(([field, column]) => `m.${column} AS "${field}"`).join(', ');

export async function readDetails(organizationId: string, membershipId: string): Promise<StaffDetails | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<StaffDetails>(
      `SELECT ${SELECT} FROM membership m WHERE m.id = $1 AND m.archived_at IS NULL`,
      [membershipId],
    );
    return rows[0] ?? null;
  });
}

/** A NIF another person in this club already holds (`membership_tax_number_uq`). */
export class TaxNumberTakenError extends Error {}

/**
 * Writes the fields in `edit` (an absent key is not asked about) and audits
 * which moved. Answers false when there is no such live staff member.
 */
export async function writeDetails(
  organizationId: string,
  membershipId: string,
  edit: Partial<StaffDetails>,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<StaffDetails>(
      `SELECT ${SELECT} FROM membership m WHERE m.id = $1 AND m.archived_at IS NULL FOR UPDATE`,
      [membershipId],
    );
    const was = rows[0];
    if (was === undefined) return false;

    const moved = DETAIL_COLUMNS.filter(
      ([field]) => edit[field] !== undefined && (edit[field] ?? null) !== (was[field] ?? null),
    );
    if (moved.length === 0) return true;

    try {
      await tx.query(
        `UPDATE membership SET ${moved.map(([, column], index) => `${column} = $${index + 2}`).join(', ')}
          WHERE id = $1`,
        [membershipId, ...moved.map(([field]) => edit[field] ?? null)],
      );
    } catch (error) {
      if ((error as { constraint?: string }).constraint === 'membership_tax_number_uq') {
        throw new TaxNumberTakenError();
      }
      throw error;
    }

    await recordAudit(tx, {
      action: 'membership.details_updated',
      entityType: 'membership',
      entityId: membershipId,
      data: { withheld: moved.map(([field]) => field) },
    });
    return true;
  });
}
