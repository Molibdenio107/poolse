import { withOrg, type Tx } from '@poolse/db';
import type { BoletimField, BoletimPlacement } from '@poolse/rules';
import { recordAudit } from '../audit/audit.js';
import { WrongFileError } from '../files/attachments.repository.js';
import { currentTenant } from '../tenant/tenant.context.js';

/**
 * A club's own boletim de sócio — POOLSE-142. One live template per club (an
 * image of one A4 page) and its placements. Replacing the template archives the
 * old one and its placements; saving placements archives the live set and
 * inserts the new one. Nothing is edited in place or deleted, by grant.
 */
export interface BoletimTemplate {
  id: string;
  fileId: string;
  fields: BoletimPlacement[];
}

/** The live template and its live placements, in `tx`. */
export async function liveTemplateIn(tx: Tx): Promise<BoletimTemplate | null> {
  const { rows } = await tx.query<{ id: string; file_id: string }>(
    `SELECT id, file_id FROM boletim_template WHERE archived_at IS NULL`,
  );
  const template = rows[0];
  if (template === undefined) return null;
  const placed = await tx.query<{ field: BoletimField; x: string; y: string; size_pt: string }>(
    `SELECT field::text AS field, x, y, size_pt FROM boletim_template_field
      WHERE template_id = $1 AND archived_at IS NULL
      ORDER BY y, x, field`,
    [template.id],
  );
  return {
    id: template.id,
    fileId: template.file_id,
    fields: placed.rows.map((row) => ({ field: row.field, x: Number(row.x), y: Number(row.y), sizePt: Number(row.size_pt) })),
  };
}

export async function readTemplate(organizationId: string): Promise<BoletimTemplate | null> {
  return withOrg(organizationId, (tx) => liveTemplateIn(tx));
}

async function archiveLive(tx: Tx): Promise<string | null> {
  const { rows } = await tx.query<{ id: string }>(
    `UPDATE boletim_template SET archived_at = now() WHERE archived_at IS NULL RETURNING id`,
  );
  const old = rows[0]?.id ?? null;
  if (old !== null) {
    await tx.query(
      `UPDATE boletim_template_field SET archived_at = now() WHERE template_id = $1 AND archived_at IS NULL`,
      [old],
    );
  }
  return old;
}

/**
 * Files a new template, archiving the one before and its placements (rule 6),
 * or — with `fileId` null — removes the template, so the print falls back to
 * Poolse's own boletim.
 */
export async function setTemplate(organizationId: string, fileId: string | null): Promise<void> {
  await withOrg(organizationId, async (tx) => {
    if (fileId !== null) {
      const file = await tx.query(
        `SELECT 1 FROM stored_file WHERE id = $1 AND purpose = 'boletim_template' AND archived_at IS NULL`,
        [fileId],
      );
      if (file.rowCount === 0) throw new WrongFileError();
    }
    const replaced = await archiveLive(tx);
    if (fileId !== null) {
      await tx.query(
        `INSERT INTO boletim_template (organization_id, file_id, created_by) VALUES ($1, $2, $3)`,
        [organizationId, fileId, currentTenant().membershipId],
      );
    }
    await recordAudit(tx, {
      action: fileId === null ? 'organization.boletim_template_removed' : 'organization.boletim_template_set',
      entityType: 'organization',
      entityId: organizationId,
      data: { fileId, replaced },
    });
  });
}

/** Saves the placements as a set. False when the club has no live template. */
export async function savePlacements(organizationId: string, fields: readonly BoletimPlacement[]): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    // Locks the live template, so two saves at once cannot both archive the
    // same set and leave two sets live.
    const { rows } = await tx.query<{ id: string }>(
      `SELECT id FROM boletim_template WHERE archived_at IS NULL FOR UPDATE`,
    );
    const template = rows[0];
    if (template === undefined) return false;
    await tx.query(
      `UPDATE boletim_template_field SET archived_at = now() WHERE template_id = $1 AND archived_at IS NULL`,
      [template.id],
    );
    if (fields.length > 0) {
      await tx.query(
        `INSERT INTO boletim_template_field (organization_id, template_id, field, x, y, size_pt)
         SELECT $1, $2, f.field::boletim_field, f.x, f.y, f.size_pt
           FROM unnest($3::text[], $4::numeric[], $5::numeric[], $6::numeric[]) AS f(field, x, y, size_pt)`,
        [
          organizationId,
          template.id,
          fields.map((f) => f.field),
          fields.map((f) => f.x),
          fields.map((f) => f.y),
          fields.map((f) => f.sizePt),
        ],
      );
    }
    await recordAudit(tx, {
      action: 'organization.boletim_template_fields_saved',
      entityType: 'organization',
      entityId: organizationId,
      data: { templateId: template.id, fields: fields.map((f) => f.field) },
    });
    return true;
  });
}
