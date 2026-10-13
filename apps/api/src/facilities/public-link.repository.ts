import { randomBytes } from 'node:crypto';
import { withOrg, withoutTenantScope, type Tx } from '@poolse/db';
import {
  excursions,
  gradeLabResult,
  ORGANISMS,
  POOL_METRICS,
  POOL_USES,
  resolveBands,
  type Band,
  type BandOverride,
  type LabGrade,
  type Organism,
  type PoolKind,
  type PoolMetric,
  type PoolUse,
} from '@poolse/rules';
import { recordAudit } from '../audit/audit.js';
import {
  complaintsFor,
  regulationFrom,
  type PublicComplaints,
  type PublicRegulation,
} from './public-notices.js';

/**
 * A tank's public water page — POOLSE-71.
 *
 * Two halves that must never meet in code. The **tenant half** — turn the link
 * on, replace it, switch it off — runs inside `withOrg` like every other write.
 * The **public half** has no tenant at all and reads through exactly one
 * function, `public_water_page()`, a `SECURITY DEFINER` with a fixed body and a
 * fixed result shape. Nothing here looks a tenant up from a token and then opens
 * a tenant transaction: that would be a second cross-tenant read path, and the
 * whole point of the function is that there is one.
 */

/** 256 bits, base64url — 43 characters, inside the table's CHECK. */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export interface PublicLink {
  /** Null when the page is switched off. */
  token: string | null;
  createdAt: string | null;
}

/** Thrown when the pool is not this club's, or is archived. */
export class NoSuchPoolError extends Error {}

async function assertPool(tx: Tx, poolId: string): Promise<void> {
  const { rowCount } = await tx.query('SELECT 1 FROM pool WHERE id = $1 AND archived_at IS NULL', [
    poolId,
  ]);
  if ((rowCount ?? 0) === 0) throw new NoSuchPoolError();
}

export async function getPublicLink(organizationId: string, poolId: string): Promise<PublicLink> {
  return withOrg(organizationId, async (tx) => {
    await assertPool(tx, poolId);
    const { rows } = await tx.query<{ token: string; created_at: Date }>(
      `SELECT token, created_at FROM pool_public_link
        WHERE pool_id = $1 AND revoked_at IS NULL`,
      [poolId],
    );
    const row = rows[0];
    return row === undefined
      ? { token: null, createdAt: null }
      : { token: row.token, createdAt: row.created_at.toISOString() };
  });
}

/**
 * Turn the page on, or give it a new link.
 *
 * `replace` false is idempotent: a tank that already has a live link keeps it,
 * so pressing the switch twice does not kill a QR. `replace` true revokes the
 * live link and issues a new one in the same transaction — the printed QR stops
 * working the moment this commits.
 */
export async function issuePublicLink(
  organizationId: string,
  membershipId: string | null,
  poolId: string,
  replace: boolean,
): Promise<PublicLink> {
  return withOrg(organizationId, async (tx) => {
    await assertPool(tx, poolId);

    if (!replace) {
      const { rows } = await tx.query<{ token: string; created_at: Date }>(
        `SELECT token, created_at FROM pool_public_link
          WHERE pool_id = $1 AND revoked_at IS NULL`,
        [poolId],
      );
      if (rows[0]) return { token: rows[0].token, createdAt: rows[0].created_at.toISOString() };
    }

    const revoked = await tx.query(
      `UPDATE pool_public_link SET revoked_at = now()
        WHERE pool_id = $1 AND revoked_at IS NULL`,
      [poolId],
    );

    const { rows } = await tx.query<{ id: string; token: string; created_at: Date }>(
      `INSERT INTO pool_public_link (organization_id, pool_id, token, created_by_membership_id)
       VALUES ($1, $2, $3, $4) RETURNING id, token, created_at`,
      [organizationId, poolId, newToken(), membershipId],
    );
    const row = rows[0]!;

    // The token itself stays out of the trail — it is a capability, and the
    // table is the record of it.
    await recordAudit(tx, {
      action: (revoked.rowCount ?? 0) > 0 ? 'pool.publicLinkReplaced' : 'pool.publicLinkEnabled',
      entityType: 'pool',
      entityId: poolId,
      data: {},
    });

    return { token: row.token, createdAt: row.created_at.toISOString() };
  });
}

/** Switch the page off. True when there was a live link to revoke. */
export async function revokePublicLink(organizationId: string, poolId: string): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    await assertPool(tx, poolId);
    const { rowCount } = await tx.query(
      `UPDATE pool_public_link SET revoked_at = now()
        WHERE pool_id = $1 AND revoked_at IS NULL`,
      [poolId],
    );
    if ((rowCount ?? 0) > 0) {
      await recordAudit(tx, {
        action: 'pool.publicLinkDisabled',
        entityType: 'pool',
        entityId: poolId,
        data: {},
      });
    }
    return (rowCount ?? 0) > 0;
  });
}

/* ---------------------------------------------------------------------------
 * The public half
 * ------------------------------------------------------------------------- */

/** How old a reading may be before the page says so — the ticket's 24 hours. */
export const STALE_AFTER_HOURS = 24;

export type ReadingState = 'inside' | 'low' | 'high' | 'unjudged';

export interface PublicReading {
  metric: PoolMetric;
  value: number;
  unit: string;
  takenAt: string;
  /** The band this pool is judged by for this metric; null when not judged. */
  band: { from: number | null; to: number | null } | null;
  state: ReadingState;
  /** Older than `STALE_AFTER_HOURS`, decided here so the page does not recompute it. */
  stale: boolean;
}

export interface PublicWaterPage {
  facilityName: string;
  poolName: string;
  timezone: string;
  readings: PublicReading[];
  /**
   * The latest laboratory grade and the day it was sampled — POOLSE-72. The
   * grade and the date and nothing else from the report. Null when the tank has
   * no lab result, or the latest one has nothing gradeable in it.
   */
  lab: { grade: LabGrade; sampledAt: string } | null;
  /** Where a complaint goes — POOLSE-73. Always present. */
  complaints: PublicComplaints;
  /** The facility's operating regulation in force, or null when none is published. */
  regulation: PublicRegulation | null;
}

interface RawPage {
  facilityName: string;
  poolName: string;
  timezone: string;
  poolKind: string | null;
  poolUse: string | null;
  readings: { metric: string; value: number | string; unit: string; takenAt: string }[];
  bands: { metric: string; from: number | string | null; to: number | string | null }[];
  complaintsRegime: string | null;
  complaintsUrl: string | null;
  regulation: { effectiveFrom: string; body: string } | null;
  lab: {
    sampledAt: string;
    values: { parameter: string; value: number | string; unit: string }[];
  } | null;
}

const asNumber = (value: number | string | null): number | null =>
  value === null ? null : Number(value);

const isMetric = (value: string): value is PoolMetric =>
  (POOL_METRICS as readonly string[]).includes(value);

/**
 * One live token's page, or null — and null for every kind of miss.
 *
 * Judged with `resolveBands` and `excursions()`, the same two calls the pool's
 * own page and the alert email make, so the wall and the office cannot disagree
 * about whether the water is in range. The response is built field by field,
 * never by spreading what the function returned.
 */
export async function readPublicWaterPage(
  token: string,
  now: Date = new Date(),
): Promise<PublicWaterPage | null> {
  const raw = await withoutTenantScope(async (tx) => {
    const { rows } = await tx.query<{ page: RawPage | null }>(
      'SELECT public_water_page($1) AS page',
      [token],
    );
    return rows[0]?.page ?? null;
  });
  if (raw === null) return null;

  const overrides: BandOverride[] = raw.bands
    .filter((band) => isMetric(band.metric))
    .map((band) => ({
      metric: band.metric as PoolMetric,
      from: asNumber(band.from),
      to: asNumber(band.to),
    }));
  const pool = {
    kind: raw.poolKind === 'indoor' || raw.poolKind === 'outdoor' ? (raw.poolKind as PoolKind) : null,
    use: (POOL_USES as readonly string[]).includes(raw.poolUse ?? '') ? (raw.poolUse as PoolUse) : null,
  };
  const bands = resolveBands(overrides, pool);
  /*
   * The latest value of each metric may come from different analyses. Free
   * chlorine is judged by pH only when both were taken in the same analysis —
   * the same instant — and otherwise by the widest band, as `excursions()`
   * does for an analysis with no pH.
   */
  const phReading = raw.readings.find((reading) => reading.metric === 'ph');
  const staleBefore = now.getTime() - STALE_AFTER_HOURS * 60 * 60 * 1000;

  const readings: PublicReading[] = raw.readings
    .filter((reading) => isMetric(reading.metric))
    .map((reading): PublicReading => {
      const metric = reading.metric as PoolMetric;
      const value = Number(reading.value);
      const band = bands[metric] ?? null;
      const sameAnalysisPh =
        metric !== 'ph' && phReading !== undefined && phReading.takenAt === reading.takenAt
          ? [{ metric: 'ph' as const, value: Number(phReading.value), unit: phReading.unit }]
          : [];
      const [excursion] = excursions(
        [...sameAnalysisPh, { metric, value, unit: reading.unit }],
        bands,
      ).filter((one) => one.metric === metric);
      const takenAt = new Date(reading.takenAt);
      return {
        metric,
        value,
        unit: reading.unit,
        takenAt: takenAt.toISOString(),
        // For free chlorine judged by a pH from the same analysis, the side of
        // the split it was judged against — not the union, which would show a
        // reading "inside 0,5–2" that is in fact above its 1,2.
        band: band === null ? null : shownBand(band, sameAnalysisPh[0]?.value ?? null),
        state: band === null ? 'unjudged' : excursion === undefined ? 'inside' : excursion.direction,
        stale: takenAt.getTime() < staleBefore,
      };
    })
    // The published order, so every tank's page reads the same way down.
    .sort((a, b) => POOL_METRICS.indexOf(a.metric) - POOL_METRICS.indexOf(b.metric));

  return {
    facilityName: raw.facilityName,
    poolName: raw.poolName,
    timezone: raw.timezone,
    readings,
    lab: gradePublicLab(raw.lab, pool),
    complaints: complaintsFor(raw.complaintsRegime, raw.complaintsUrl),
    regulation: regulationFrom(raw.regulation),
  };
}

function shownBand(band: Band, ph: number | null): { from: number | null; to: number | null } {
  if (band.byPh !== undefined && ph !== null) {
    const side = ph <= band.byPh.at ? band.byPh.atOrBelow : band.byPh.above;
    return { from: side.from, to: side.to };
  }
  return { from: band.from, to: band.to };
}

function gradePublicLab(
  lab: RawPage['lab'],
  pool: { kind: PoolKind | null; use: PoolUse | null },
): PublicWaterPage['lab'] {
  if (lab === null) return null;
  const organisms: Partial<Record<Organism, number>> = {};
  const chemistry: { metric: PoolMetric; value: number; unit: string }[] = [];
  for (const entry of lab.values) {
    if ((ORGANISMS as readonly string[]).includes(entry.parameter)) {
      organisms[entry.parameter as Organism] = Number(entry.value);
    } else if (isMetric(entry.parameter)) {
      chemistry.push({ metric: entry.parameter, value: Number(entry.value), unit: entry.unit });
    }
  }
  const { grade } = gradeLabResult({ organisms, chemistry }, pool);
  return grade === null ? null : { grade, sampledAt: new Date(lab.sampledAt).toISOString() };
}
