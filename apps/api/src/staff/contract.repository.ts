import { withOrg, type Tx } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';
import { storeFile } from '../files/files.repository.js';
import { currentTenant } from '../tenant/tenant.context.js';
import { personName } from '../people/names.js';
import { visibleToViewer } from './compensation.repository.js';

/**
 * A staff member's contract — POOLSE-149 slice C (Rui, 02-11-2026).
 *
 * The signed document with its earlier versions, and three facts said beside
 * it: kind, start and end. **Informative only**: nothing in salaries or
 * vacations reads this file.
 *
 * **Who reads is the pay rule** (`visibleToViewer`): owner and admin, and the
 * person — but an Admin never the Owner's, which is **absent** (null, a 404)
 * rather than blanked. Writing is owner and admin, through the same predicate,
 * so a write whose result the writer could not read is refused the same way.
 */

export const CONTRACT_KINDS = ['open_ended', 'fixed_term', 'uncertain_term', 'services', 'internship'] as const;
export type ContractKind = (typeof CONTRACT_KINDS)[number];

export interface ContractFacts {
  kind: ContractKind | null;
  startsOn: string | null;
  endsOn: string | null;
}

export interface ContractVersion {
  id: string;
  fileId: string;
  contentType: string;
  originalName: string;
  attachedAt: string;
  attachedByName: string | null;
  replacedAt: string | null;
}

export interface StaffContract {
  facts: ContractFacts | null;
  current: ContractVersion | null;
  /** Earlier files, newest first. */
  history: ContractVersion[];
  /** Whether this reader may file and edit it — the guard's own answer (set by the controller). */
  canEdit: boolean;
}

/** The membership, if it is live and this viewer may see its contract. */
async function visible(tx: Tx, membershipId: string, viewerIsOwner: boolean): Promise<boolean> {
  const { rows } = await tx.query(
    `SELECT 1 FROM membership m WHERE m.id = $1 AND m.archived_at IS NULL AND ${visibleToViewer('$2')}`,
    [membershipId, viewerIsOwner],
  );
  return rows.length > 0;
}

export async function readContract(
  organizationId: string,
  membershipId: string,
  viewerIsOwner: boolean,
): Promise<StaffContract | null> {
  return withOrg(organizationId, async (tx) => {
    if (!(await visible(tx, membershipId, viewerIsOwner))) return null;

    const { rows: facts } = await tx.query<{ kind: ContractKind | null; starts_on: string | null; ends_on: string | null }>(
      `SELECT kind::text AS kind, to_char(starts_on, 'YYYY-MM-DD') AS starts_on, to_char(ends_on, 'YYYY-MM-DD') AS ends_on
         FROM staff_contract WHERE membership_id = $1`,
      [membershipId],
    );
    const { rows: versions } = await tx.query<{
      id: string;
      file_id: string;
      content_type: string;
      original_name: string;
      attached_at: Date;
      attached_by_name: string | null;
      replaced_at: Date | null;
    }>(
      `SELECT v.id, v.file_id, f.content_type, f.original_name, v.attached_at,
              ${personName('v.attached_by')} AS attached_by_name, v.replaced_at
         FROM staff_contract_version v
         JOIN stored_file f ON f.organization_id = v.organization_id AND f.id = v.file_id
        WHERE v.membership_id = $1
        ORDER BY v.attached_at DESC, v.id`,
      [membershipId],
    );

    const shaped = versions.map((v) => ({
      id: v.id,
      fileId: v.file_id,
      contentType: v.content_type,
      originalName: v.original_name,
      attachedAt: v.attached_at.toISOString(),
      attachedByName: v.attached_by_name,
      replacedAt: v.replaced_at?.toISOString() ?? null,
    }));
    const fact = facts[0];
    return {
      facts: fact === undefined ? null : { kind: fact.kind, startsOn: fact.starts_on, endsOn: fact.ends_on },
      current: shaped.find((v) => v.replacedAt === null) ?? null,
      history: shaped.filter((v) => v.replacedAt !== null),
      canEdit: false,
    };
  });
}

/** Writes the facts; false when the membership is not there for this viewer. */
export async function writeContractFacts(
  organizationId: string,
  membershipId: string,
  viewerIsOwner: boolean,
  facts: ContractFacts,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    if (!(await visible(tx, membershipId, viewerIsOwner))) return false;
    const { rows: before } = await tx.query<{ kind: string | null; starts_on: string | null; ends_on: string | null }>(
      `SELECT kind::text AS kind, to_char(starts_on, 'YYYY-MM-DD') AS starts_on, to_char(ends_on, 'YYYY-MM-DD') AS ends_on
         FROM staff_contract WHERE membership_id = $1 FOR UPDATE`,
      [membershipId],
    );
    const was = before[0];
    if (was === undefined) {
      await tx.query(
        `INSERT INTO staff_contract (organization_id, membership_id, kind, starts_on, ends_on)
         VALUES ($1, $2, $3::staff_contract_kind, $4::date, $5::date)`,
        [organizationId, membershipId, facts.kind, facts.startsOn, facts.endsOn],
      );
    } else {
      await tx.query(
        `UPDATE staff_contract SET kind = $2::staff_contract_kind, starts_on = $3::date, ends_on = $4::date
          WHERE membership_id = $1`,
        [membershipId, facts.kind, facts.startsOn, facts.endsOn],
      );
    }
    const moved = (
      [
        ['kind', was?.kind ?? null, facts.kind],
        ['startsOn', was?.starts_on ?? null, facts.startsOn],
        ['endsOn', was?.ends_on ?? null, facts.endsOn],
      ] as const
    )
      .filter(([, from, to]) => from !== to)
      .map(([field]) => field);
    if (moved.length > 0) {
      // Named, never valued: the log is every admin's, and the Owner's
      // contract is not (the pay rule).
      await recordAudit(tx, {
        action: 'staff.contract_updated',
        entityType: 'membership',
        entityId: membershipId,
        data: { withheld: moved },
      });
    }
    return true;
  });
}

/**
 * Files a new contract: the current version, if any, is closed as replaced,
 * and the new one opened — with the file's registration, in one transaction.
 * Null when the membership is not there for this viewer.
 */
export async function attachContract(
  organizationId: string,
  membershipId: string,
  viewerIsOwner: boolean,
  bytes: Buffer,
  contentType: string,
  originalName: string,
): Promise<{ fileId: string } | null> {
  const allowed = await withOrg(organizationId, (tx) => visible(tx, membershipId, viewerIsOwner));
  if (!allowed) return null;
  const actor = currentTenant().membershipId;
  const stored = await storeFile(organizationId, 'staff_contract', bytes, contentType, originalName, async (tx, fileId) => {
    await tx.query(
      `UPDATE staff_contract_version SET replaced_at = now(), replaced_by = $2
        WHERE membership_id = $1 AND replaced_at IS NULL`,
      [membershipId, actor],
    );
    await tx.query(
      `INSERT INTO staff_contract_version (organization_id, membership_id, file_id, attached_by)
       VALUES ($1, $2, $3, $4)`,
      [organizationId, membershipId, fileId, actor],
    );
    await recordAudit(tx, {
      action: 'staff.contract_filed',
      entityType: 'membership',
      entityId: membershipId,
      data: { fileId },
    });
  });
  return { fileId: stored.id };
}

/** Closes the current version; the file stays in the history. False when there was none. */
export async function removeContract(
  organizationId: string,
  membershipId: string,
  viewerIsOwner: boolean,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    if (!(await visible(tx, membershipId, viewerIsOwner))) return false;
    const { rowCount } = await tx.query(
      `UPDATE staff_contract_version SET replaced_at = now(), replaced_by = $2
        WHERE membership_id = $1 AND replaced_at IS NULL`,
      [membershipId, currentTenant().membershipId],
    );
    if (rowCount === 0) return false;
    await recordAudit(tx, { action: 'staff.contract_removed', entityType: 'membership', entityId: membershipId });
    return true;
  });
}
