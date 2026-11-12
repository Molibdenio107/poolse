import { withOrg } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';

/**
 * A gas meter's conversion factors — kWh per m³, as each gas bill prints it,
 * effective from a date until the next (Rui, 12-11-2026). The factor live on a
 * reading's day turns its m³ into kWh (`listReadings`). Owner and Admin set
 * them, as they set a tariff: the figure decides every kWh the module reports.
 */

export interface GasFactor {
  id: string;
  kwhPerUnit: number;
  effectiveFrom: string;
  note: string | null;
}

export class GasFactorTakenError extends Error {
  constructor() {
    super('A factor already starts on that day');
  }
}

export async function listGasFactors(organizationId: string, meterId: string): Promise<GasFactor[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ id: string; kwh_per_unit: number; effective_from: string; note: string | null }>(
      `SELECT id, kwh_per_unit::float8 AS kwh_per_unit, to_char(effective_from, 'YYYY-MM-DD') AS effective_from, note
         FROM energy_gas_factor
        WHERE meter_id = $1 AND archived_at IS NULL
        ORDER BY effective_from DESC`,
      [meterId],
    );
    return rows.map((row) => ({
      id: row.id,
      kwhPerUnit: row.kwh_per_unit,
      effectiveFrom: row.effective_from,
      note: row.note,
    }));
  });
}

/** Null when the meter is not this club's, or is archived. */
export async function addGasFactor(
  organizationId: string,
  meterId: string,
  membershipId: string,
  input: { kwhPerUnit: number; effectiveFrom: string; note: string | null },
): Promise<{ id: string } | null> {
  return withOrg(organizationId, async (tx) => {
    const meter = await tx.query(`SELECT 1 FROM energy_meter WHERE id = $1 AND archived_at IS NULL`, [meterId]);
    if (meter.rowCount === 0) return null;
    try {
      await tx.query('SAVEPOINT gas_factor');
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO energy_gas_factor (organization_id, meter_id, kwh_per_unit, effective_from, note, created_by_membership_id)
         VALUES ($1, $2, $3, $4::date, $5, $6) RETURNING id`,
        [organizationId, meterId, input.kwhPerUnit, input.effectiveFrom, input.note, membershipId],
      );
      await tx.query('RELEASE SAVEPOINT gas_factor');
      await recordAudit(tx, {
        action: 'energy.gasFactorSet',
        entityType: 'energy_meter',
        entityId: meterId,
        data: { kwhPerUnit: input.kwhPerUnit, effectiveFrom: input.effectiveFrom },
      });
      return { id: rows[0]!.id };
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        await tx.query('ROLLBACK TO SAVEPOINT gas_factor');
        throw new GasFactorTakenError();
      }
      throw error;
    }
  });
}

export async function archiveGasFactor(organizationId: string, meterId: string, factorId: string): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rowCount } = await tx.query(
      `UPDATE energy_gas_factor SET archived_at = now() WHERE id = $1 AND meter_id = $2 AND archived_at IS NULL`,
      [factorId, meterId],
    );
    if (rowCount === 0) return false;
    await recordAudit(tx, { action: 'energy.gasFactorArchived', entityType: 'energy_meter', entityId: meterId, data: { factorId } });
    return true;
  });
}
