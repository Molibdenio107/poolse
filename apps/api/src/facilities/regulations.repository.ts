import { withOrg } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';

/**
 * A facility's operating regulation — POOLSE-73.
 *
 * **Versioned by publication, never edited.** Each publication is a row with
 * the day it takes effect; the version in force is the latest whose day has
 * come. A correction is a new version, so "what did the regulation say on the
 * day of the incident" always has an answer, and a version not yet in force can
 * be published ahead of the season. Archiving withdraws a version published by
 * mistake; it is never deleted.
 */

export interface RegulationVersion {
  id: string;
  /** `YYYY-MM-DD` — a day, never an instant. */
  effectiveFrom: string;
  body: string;
  publishedAt: string;
  publishedByName: string | null;
  /** In force today: the latest live version whose day has come. */
  current: boolean;
}

export class DuplicateEffectiveDateError extends Error {}

export async function listRegulations(
  organizationId: string,
  facilityId: string,
): Promise<RegulationVersion[] | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows: facilities } = await tx.query<{ timezone: string }>(
      'SELECT timezone FROM facility WHERE id = $1 AND archived_at IS NULL',
      [facilityId],
    );
    if (!facilities[0]) return null;

    const { rows } = await tx.query<{
      id: string;
      effective_from: string;
      body: string;
      created_at: Date;
      published_by_name: string | null;
      current: boolean;
    }>(
      `SELECT r.id, r.effective_from::text AS effective_from, r.body, r.created_at,
              (SELECT display_name(u.cached_first_name, u.cached_last_name)
                 FROM membership m LEFT JOIN app_user u ON u.id = m.app_user_id
                WHERE m.id = r.published_by_membership_id) AS published_by_name,
              r.id = facility_regulation_current(r.facility_id) AS current
         FROM facility_regulation r
        WHERE r.facility_id = $1 AND r.archived_at IS NULL
        ORDER BY r.effective_from DESC`,
      [facilityId],
    );
    return rows.map((row) => ({
      id: row.id,
      effectiveFrom: row.effective_from,
      body: row.body,
      publishedAt: row.created_at.toISOString(),
      publishedByName: row.published_by_name,
      current: row.current,
    }));
  });
}

export async function publishRegulation(
  organizationId: string,
  facilityId: string,
  input: { effectiveFrom: string; body: string },
  membershipId: string,
): Promise<string | null> {
  try {
    return await withOrg(organizationId, async (tx) => {
      const { rows: facilities } = await tx.query(
        'SELECT 1 FROM facility WHERE id = $1 AND archived_at IS NULL',
        [facilityId],
      );
      if (facilities.length === 0) return null;

      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO facility_regulation
           (organization_id, facility_id, effective_from, body, published_by_membership_id)
         VALUES ($1, $2, $3::date, $4, $5)
         RETURNING id`,
        [organizationId, facilityId, input.effectiveFrom, input.body, membershipId],
      );
      const id = rows[0]!.id;
      // The figure-free fact; the text itself is the row.
      await recordAudit(tx, {
        action: 'facility.regulation_published',
        entityType: 'facility',
        entityId: facilityId,
        data: { regulationId: id, effectiveFrom: input.effectiveFrom },
      });
      return id;
    });
  } catch (error) {
    const pg = error as { code?: string; constraint?: string };
    if (pg.code === '23505' && pg.constraint === 'facility_regulation_one_per_day') {
      throw new DuplicateEffectiveDateError();
    }
    throw error;
  }
}

export async function archiveRegulation(
  organizationId: string,
  facilityId: string,
  regulationId: string,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rowCount } = await tx.query(
      `UPDATE facility_regulation SET archived_at = now()
        WHERE id = $1 AND facility_id = $2 AND archived_at IS NULL`,
      [regulationId, facilityId],
    );
    if ((rowCount ?? 0) === 0) return false;
    await recordAudit(tx, {
      action: 'facility.regulation_withdrawn',
      entityType: 'facility',
      entityId: facilityId,
      data: { regulationId },
    });
    return true;
  });
}

// ---------------------------------------------------------------------------
// Where a complaint goes — the club's regime
// ---------------------------------------------------------------------------

export interface ComplaintsSettings {
  regime: 'private' | 'public_service';
  /** A public service's own platform; null for a private operator. */
  url: string | null;
}

export async function readComplaintsSettings(organizationId: string): Promise<ComplaintsSettings> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ regime: 'private' | 'public_service'; url: string | null }>(
      `SELECT complaints_regime::text AS regime, complaints_url AS url FROM organization WHERE id = $1`,
      [organizationId],
    );
    return { regime: rows[0]!.regime, url: rows[0]!.url };
  });
}

export async function updateComplaintsSettings(
  organizationId: string,
  settings: ComplaintsSettings,
): Promise<ComplaintsSettings> {
  return withOrg(organizationId, async (tx) => {
    await tx.query(
      `UPDATE organization
          SET complaints_regime = $2::complaints_regime, complaints_url = $3
        WHERE id = $1`,
      [organizationId, settings.regime, settings.url],
    );
    await recordAudit(tx, {
      action: 'organization.complaints_updated',
      entityType: 'organization',
      entityId: organizationId,
      data: { ...settings },
    });
    return settings;
  });
}
