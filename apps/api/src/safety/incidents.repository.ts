import { withOrg, type Tx } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';
import { currentTenant } from '../tenant/tenant.context.js';
import { decryptSensitive, encryptSensitive } from '../sensitive/cipher.js';
import { personName } from '../people/names.js';
import { TOTAL_COUNT, windowed, type PageQuery, type Paginated } from '../common/pagination.js';

/**
 * Bather incidents — POOLSE-70, slice 1.
 *
 * **Two halves, read under two rules.** The facts (when, where, who, whether
 * emergency services came, who was on duty) are ordinary columns any staff
 * member reads. What happened, the injury and the first aid live encrypted in
 * `incident_detail`, and so does every addendum; reading them is
 * `readIncidentDetail`, which decides — Owner/Admin, or the incident's author —
 * and writes `incident_detail.read` to the audit log on every decrypting read.
 *
 * **Nothing here updates a row.** The grants say so (`invoice`'s arrangement);
 * a correction is `addAddendum`, and archiving is the one column the
 * application may change.
 */

export interface IncidentSummary {
  id: string;
  occurredAt: string;
  /** The tank's or space's name; null when it happened elsewhere on the site. */
  placeName: string | null;
  personName: string;
  /** Whether the person is a student, another member, or a visitor typed by name. */
  personKind: 'student' | 'member' | 'visitor';
  emergencyCalled: boolean;
  lifeguardName: string | null;
  recordedByName: string | null;
  addendaCount: number;
  archived: boolean;
}

export interface IncidentFacts extends IncidentSummary {
  facilityId: string;
  facilityName: string;
  poolId: string | null;
  spaceId: string | null;
  lifeguardMembershipId: string | null;
  policyReference: string | null;
  recordedBy: string;
  createdAt: string;
  /** Who added a correction and when — the words are behind the detail rule. */
  addenda: { id: string; writtenByName: string | null; createdAt: string }[];
}

export interface IncidentDetail {
  whatHappened: string;
  injury: string | null;
  firstAid: string | null;
  addenda: { id: string; body: string; writtenByName: string | null; createdAt: string }[];
}

export interface IncidentInput {
  /** The site's local wall time, `YYYY-MM-DDTHH:mm`. */
  occurredAt: string;
  poolId: string | null;
  spaceId: string | null;
  studentId: string | null;
  membershipId: string | null;
  visitorName: string | null;
  emergencyCalled: boolean;
  lifeguardMembershipId: string | null;
  policyReference: string | null;
  whatHappened: string;
  injury: string | null;
  firstAid: string | null;
}

/** An incident in the future — a typo in the date, said rather than stored. */
export class OccurredInFutureError extends Error {}
/** The tank or space is not at this site. */
export class PlaceOffSiteError extends Error {}

const SUMMARY_COLUMNS = `
  i.id, i.occurred_at,
  coalesce(p.name, sp.name) AS place_name,
  CASE
    WHEN i.student_id IS NOT NULL THEN btrim(st.first_name || ' ' || st.last_name)
    WHEN i.membership_id IS NOT NULL THEN ${personName('i.membership_id')}
    ELSE i.visitor_name
  END AS person_name,
  CASE
    WHEN i.student_id IS NOT NULL THEN 'student'
    WHEN i.membership_id IS NOT NULL THEN 'member'
    ELSE 'visitor'
  END AS person_kind,
  i.emergency_called,
  CASE WHEN i.lifeguard_membership_id IS NULL THEN NULL
       ELSE ${personName('i.lifeguard_membership_id')} END AS lifeguard_name,
  ${personName('i.recorded_by')} AS recorded_by_name,
  (SELECT count(*)::int FROM incident_addendum a
    WHERE a.incident_id = i.id AND a.organization_id = i.organization_id) AS addenda_count,
  i.archived_at IS NOT NULL AS archived`;

const SUMMARY_JOINS = `
  LEFT JOIN pool p ON p.id = i.pool_id AND p.organization_id = i.organization_id
  LEFT JOIN space sp ON sp.id = i.space_id AND sp.organization_id = i.organization_id
  LEFT JOIN student st ON st.id = i.student_id AND st.organization_id = i.organization_id`;

interface SummaryRow {
  id: string;
  occurred_at: Date;
  place_name: string | null;
  person_name: string | null;
  person_kind: IncidentSummary['personKind'];
  emergency_called: boolean;
  lifeguard_name: string | null;
  recorded_by_name: string | null;
  addenda_count: number;
  archived: boolean;
}

function toSummary(row: SummaryRow): IncidentSummary {
  return {
    id: row.id,
    occurredAt: row.occurred_at.toISOString(),
    placeName: row.place_name,
    personName: row.person_name ?? '',
    personKind: row.person_kind,
    emergencyCalled: row.emergency_called,
    lifeguardName: row.lifeguard_name,
    recordedByName: row.recorded_by_name,
    addendaCount: row.addenda_count,
    archived: row.archived,
  };
}

/**
 * A site's incidents, newest first, paginated — the list grows as the club
 * runs, so it carries a window (CONVENTIONS, POOLSE-29). Archived ones are left
 * out unless asked for: an archived record still exists, it is just not today's.
 */
export async function listIncidents(
  organizationId: string,
  facilityId: string,
  page: PageQuery,
): Promise<Paginated<IncidentSummary>> {
  return withOrg(organizationId, (tx) =>
    windowed<SummaryRow & { total_count: number }, IncidentSummary>(
      page,
      (limit, offset) =>
        tx.query<SummaryRow & { total_count: number }>(
          `SELECT ${SUMMARY_COLUMNS}, ${TOTAL_COUNT}
             FROM incident i ${SUMMARY_JOINS}
            WHERE i.facility_id = $1 AND i.archived_at IS NULL
            ORDER BY i.occurred_at DESC, i.id
            LIMIT $2 OFFSET $3`,
          [facilityId, limit, offset],
        ),
      toSummary,
    ),
  );
}

export async function recordIncident(
  organizationId: string,
  facilityId: string,
  input: IncidentInput,
): Promise<string | null> {
  // Encrypted here, before the statement — the database never sees the words.
  const whatHappened = encryptSensitive(input.whatHappened);
  const injury = encryptSensitive(input.injury);
  const firstAid = encryptSensitive(input.firstAid);
  if (whatHappened === null) throw new Error('whatHappened is required');

  return withOrg(organizationId, async (tx) => {
    const { rows: site } = await tx.query<{ at: Date; future: boolean }>(
      `SELECT ($2::timestamp AT TIME ZONE f.timezone) AS at,
              ($2::timestamp AT TIME ZONE f.timezone) > now() + interval '5 minutes' AS future
         FROM facility f WHERE f.id = $1 AND f.archived_at IS NULL`,
      [facilityId, input.occurredAt],
    );
    if (site[0] === undefined) return null;
    if (site[0].future) throw new OccurredInFutureError();

    let id: string;
    try {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO incident
           (organization_id, facility_id, pool_id, space_id, occurred_at, student_id,
            membership_id, visitor_name, emergency_called, lifeguard_membership_id,
            policy_reference, recorded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING id`,
        [
          organizationId,
          facilityId,
          input.poolId,
          input.spaceId,
          site[0].at,
          input.studentId,
          input.membershipId,
          input.visitorName,
          input.emergencyCalled,
          input.lifeguardMembershipId,
          input.policyReference,
          currentTenant().membershipId,
        ],
      );
      id = rows[0]!.id;
    } catch (error) {
      if ((error as { detail?: string }).detail === 'incident_place_off_site') {
        throw new PlaceOffSiteError();
      }
      throw error;
    }

    await tx.query(
      `INSERT INTO incident_detail
         (organization_id, incident_id, what_happened_encrypted, injury_encrypted,
          first_aid_encrypted)
       VALUES ($1, $2, $3, $4, $5)`,
      [organizationId, id, whatHappened, injury, firstAid],
    );

    // The facts only. The words are the record and are not copied into the trail.
    await recordAudit(tx, {
      action: 'incident.recorded',
      entityType: 'incident',
      entityId: id,
      data: { facilityId, emergencyCalled: input.emergencyCalled },
    });
    return id;
  });
}

async function factsOf(tx: Tx, incidentId: string): Promise<IncidentFacts | null> {
  const { rows } = await tx.query<
    SummaryRow & {
      facility_id: string;
      facility_name: string;
      pool_id: string | null;
      space_id: string | null;
      lifeguard_membership_id: string | null;
      policy_reference: string | null;
      recorded_by: string;
      created_at: Date;
    }
  >(
    `SELECT ${SUMMARY_COLUMNS},
            i.facility_id, f.name AS facility_name, i.pool_id, i.space_id,
            i.lifeguard_membership_id, i.policy_reference, i.recorded_by, i.created_at
       FROM incident i ${SUMMARY_JOINS}
       JOIN facility f ON f.id = i.facility_id AND f.organization_id = i.organization_id
      WHERE i.id = $1`,
    [incidentId],
  );
  const row = rows[0];
  if (row === undefined) return null;

  const { rows: addenda } = await tx.query<{
    id: string;
    written_by_name: string | null;
    created_at: Date;
  }>(
    `SELECT a.id, ${personName('a.written_by')} AS written_by_name, a.created_at
       FROM incident_addendum a
      WHERE a.incident_id = $1
      ORDER BY a.created_at, a.id`,
    [incidentId],
  );

  return {
    ...toSummary(row),
    facilityId: row.facility_id,
    facilityName: row.facility_name,
    poolId: row.pool_id,
    spaceId: row.space_id,
    lifeguardMembershipId: row.lifeguard_membership_id,
    policyReference: row.policy_reference,
    recordedBy: row.recorded_by,
    createdAt: row.created_at.toISOString(),
    addenda: addenda.map((a) => ({
      id: a.id,
      writtenByName: a.written_by_name,
      createdAt: a.created_at.toISOString(),
    })),
  };
}

/** The facts, for any staff member. Null when it is not this club's. */
export async function readIncident(
  organizationId: string,
  incidentId: string,
): Promise<IncidentFacts | null> {
  return withOrg(organizationId, (tx) => factsOf(tx, incidentId));
}

/** Owner/Admin, or whoever wrote it — the answer of 12-10-2026. */
export function mayReadDetail(facts: Pick<IncidentFacts, 'recordedBy'>, owns: boolean): boolean {
  return owns || facts.recordedBy === currentTenant().membershipId;
}

/**
 * The health detail and every addendum, decrypted — and the read recorded.
 *
 * `'refused'` when the reader may not, decided here on the row rather than by
 * a role list, because "the person who wrote it" cannot be written as a role.
 * The audit row is written in the same transaction as the read, so there is no
 * decrypted read without its trace.
 */
export async function readIncidentDetail(
  organizationId: string,
  incidentId: string,
  owns: boolean,
): Promise<IncidentDetail | 'refused' | null> {
  return withOrg(organizationId, async (tx) => {
    const facts = await factsOf(tx, incidentId);
    if (facts === null) return null;
    if (!mayReadDetail(facts, owns)) return 'refused';

    const { rows } = await tx.query<{
      what_happened_encrypted: string;
      injury_encrypted: string | null;
      first_aid_encrypted: string | null;
    }>(
      `SELECT what_happened_encrypted, injury_encrypted, first_aid_encrypted
         FROM incident_detail WHERE incident_id = $1`,
      [incidentId],
    );
    const { rows: addenda } = await tx.query<{
      id: string;
      body_encrypted: string;
      written_by_name: string | null;
      created_at: Date;
    }>(
      `SELECT a.id, a.body_encrypted, ${personName('a.written_by')} AS written_by_name,
              a.created_at
         FROM incident_addendum a
        WHERE a.incident_id = $1
        ORDER BY a.created_at, a.id`,
      [incidentId],
    );

    await recordAudit(tx, {
      action: 'incident_detail.read',
      entityType: 'incident',
      entityId: incidentId,
      data: {},
    });

    const detail = rows[0];
    return {
      whatHappened: decryptSensitive(detail?.what_happened_encrypted ?? null) ?? '',
      injury: decryptSensitive(detail?.injury_encrypted ?? null),
      firstAid: decryptSensitive(detail?.first_aid_encrypted ?? null),
      addenda: addenda.map((a) => ({
        id: a.id,
        body: decryptSensitive(a.body_encrypted) ?? '',
        writtenByName: a.written_by_name,
        createdAt: a.created_at.toISOString(),
      })),
    };
  });
}

/** A correction, under the same rule as reading the detail it corrects. */
export async function addAddendum(
  organizationId: string,
  incidentId: string,
  body: string,
  owns: boolean,
): Promise<'added' | 'refused' | null> {
  const encrypted = encryptSensitive(body);
  if (encrypted === null) throw new Error('body is required');

  return withOrg(organizationId, async (tx) => {
    const facts = await factsOf(tx, incidentId);
    if (facts === null) return null;
    if (!mayReadDetail(facts, owns)) return 'refused';

    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO incident_addendum (organization_id, incident_id, body_encrypted, written_by)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [organizationId, incidentId, encrypted, currentTenant().membershipId],
    );
    await recordAudit(tx, {
      action: 'incident.addendum_added',
      entityType: 'incident',
      entityId: incidentId,
      data: { addendumId: rows[0]!.id },
    });
    return 'added';
  });
}

/** Filed away — the record stays, as every record here does. Owner/Admin. */
export async function archiveIncident(organizationId: string, incidentId: string): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rowCount } = await tx.query(
      `UPDATE incident SET archived_at = now() WHERE id = $1 AND archived_at IS NULL`,
      [incidentId],
    );
    if ((rowCount ?? 0) === 0) return false;
    await recordAudit(tx, {
      action: 'incident.archived',
      entityType: 'incident',
      entityId: incidentId,
      data: {},
    });
    return true;
  });
}
