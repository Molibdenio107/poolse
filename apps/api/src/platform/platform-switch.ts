import { withPlatform, withoutTenantScope } from '@poolse/db';
import { currentAuth } from '../auth/auth.context.js';
import { deliverAlert, recordAlert } from './platform-alert.js';

/**
 * Platform-wide switches, set from /admin — Rui, 30-10-2026.
 *
 * One today: `id_document_ai`, reading an ID document's photograph with the
 * model. Off by default; the web app still needs `ANTHROPIC_API_KEY` beside it.
 * A new switch is a value here and in the table's CHECK.
 */
export const PLATFORM_SWITCHES = ['id_document_ai'] as const;
export type PlatformSwitchName = (typeof PLATFORM_SWITCHES)[number];

export function isPlatformSwitch(value: unknown): value is PlatformSwitchName {
  return typeof value === 'string' && (PLATFORM_SWITCHES as readonly string[]).includes(value);
}

export interface PlatformSwitch {
  name: PlatformSwitchName;
  enabled: boolean;
  changedAt: string | null;
}

/** For /admin, on the platform login. */
export async function listSwitches(): Promise<PlatformSwitch[]> {
  return withPlatform(async (tx) => {
    const { rows } = await tx.query<{ name: PlatformSwitchName; enabled: boolean; changed_at: Date | null }>(
      'SELECT name, enabled, changed_at FROM platform_switch ORDER BY name',
    );
    return rows.map((row) => ({ name: row.name, enabled: row.enabled, changedAt: row.changed_at?.toISOString() ?? null }));
  });
}

/**
 * For /me, on the app login: every switch by name, a missing row read as off.
 * A failure reads as off too — a switch that cannot be read must not spend.
 */
export async function readSwitchesForClubs(): Promise<Record<PlatformSwitchName, boolean>> {
  const off = Object.fromEntries(PLATFORM_SWITCHES.map((name) => [name, false])) as Record<PlatformSwitchName, boolean>;
  try {
    const rows = await withoutTenantScope(async (tx) => {
      const result = await tx.query<{ name: string; enabled: boolean }>('SELECT name, enabled FROM platform_switch');
      return result.rows;
    });
    for (const row of rows) if (isPlatformSwitch(row.name)) off[row.name] = row.enabled;
  } catch {
    // Off, as above.
  }
  return off;
}

/**
 * Flip one. Audited with its before and after and alerted, in the transaction
 * that wrote it, as every platform write is (`changeTenant`'s shape).
 */
export async function setSwitch(name: PlatformSwitchName, enabled: boolean): Promise<PlatformSwitch> {
  const clerkUserId = currentAuth().clerkUserId;
  const done = await withPlatform(async (tx) => {
    const { rows: before } = await tx.query<{ enabled: boolean }>(
      'SELECT enabled FROM platform_switch WHERE name = $1 FOR UPDATE',
      [name],
    );
    const { rows } = await tx.query<{ enabled: boolean; changed_at: Date | null }>(
      `UPDATE platform_switch SET enabled = $2, changed_at = now(), changed_by = $3
        WHERE name = $1
        RETURNING enabled, changed_at`,
      [name, enabled, clerkUserId],
    );
    const action = 'platform.switch.set';
    const detail = { switch: name, changed: { enabled: { before: before[0]?.enabled ?? null, after: enabled } } };
    await tx.query(
      `INSERT INTO platform_audit_log (clerk_user_id, action, organization_id, detail)
            VALUES ($1, $2, NULL, $3::jsonb)`,
      [clerkUserId, action, JSON.stringify(detail)],
    );
    const alert = await recordAlert(tx, {
      kind: 'write',
      action,
      clerkUserId,
      organizationId: null,
      organizationName: null,
      detail,
    });
    return { row: rows[0]!, alert };
  });
  await deliverAlert(done.alert);
  return { name, enabled: done.row.enabled, changedAt: done.row.changed_at?.toISOString() ?? null };
}
