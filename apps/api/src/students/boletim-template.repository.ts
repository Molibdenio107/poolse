import { withOrg, type Tx } from '@poolse/db';
import type { BoletimField, BoletimPlacement, TemplateKind } from '@poolse/rules';
import { recordAudit } from '../audit/audit.js';
import { WrongFileError } from '../files/attachments.repository.js';
import { currentTenant } from '../tenant/tenant.context.js';

/**
 * A club's own forms — POOLSE-142: the boletim de sócio and the FPN's
 * declaration (adult and minor), by `kind`. One live template per club and
 * kind (an image of one A4 page) and its placements. Replacing the template archives the
 * old one and its placements; saving placements archives the live set and
 * inserts the new one. Nothing is edited in place or deleted, by grant.
 */
export interface BoletimTemplate {
  id: string;
  kind: TemplateKind;
  fileId: string;
  fields: BoletimPlacement[];
}

/** The kind's live template and its live placements, in `tx`. */
export async function liveTemplateIn(tx: Tx, kind: TemplateKind): Promise<BoletimTemplate | null> {
  const { rows } = await tx.query<{ id: string; file_id: string }>(
    `SELECT id, file_id FROM boletim_template WHERE kind = $1 AND archived_at IS NULL`,
    [kind],
  );
  const template = rows[0];
  if (template === undefined) return null;
  const placed = await tx.query<{ field: BoletimField; x: string; y: string; size_pt: string; width: string | null }>(
    `SELECT field::text AS field, x, y, size_pt, width FROM boletim_template_field
      WHERE template_id = $1 AND archived_at IS NULL
      ORDER BY y, x, field`,
    [template.id],
  );
  return {
    id: template.id,
    kind,
    fileId: template.file_id,
    fields: placed.rows.map((row) => ({
      field: row.field,
      x: Number(row.x),
      y: Number(row.y),
      sizePt: Number(row.size_pt),
      width: row.width === null ? null : Number(row.width),
    })),
  };
}

export async function readTemplate(organizationId: string, kind: TemplateKind): Promise<BoletimTemplate | null> {
  return withOrg(organizationId, (tx) => liveTemplateIn(tx, kind));
}

async function archiveLive(tx: Tx, kind: TemplateKind): Promise<string | null> {
  const { rows } = await tx.query<{ id: string }>(
    `UPDATE boletim_template SET archived_at = now() WHERE kind = $1 AND archived_at IS NULL RETURNING id`,
    [kind],
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
export async function setTemplate(organizationId: string, kind: TemplateKind, fileId: string | null): Promise<void> {
  await withOrg(organizationId, async (tx) => {
    if (fileId !== null) {
      const file = await tx.query(
        `SELECT 1 FROM stored_file WHERE id = $1 AND purpose = 'boletim_template' AND archived_at IS NULL`,
        [fileId],
      );
      if (file.rowCount === 0) throw new WrongFileError();
    }
    const replaced = await archiveLive(tx, kind);
    if (fileId !== null) {
      await tx.query(
        `INSERT INTO boletim_template (organization_id, kind, file_id, created_by) VALUES ($1, $2, $3, $4)`,
        [organizationId, kind, fileId, currentTenant().membershipId],
      );
    }
    await recordAudit(tx, {
      action: fileId === null ? 'organization.boletim_template_removed' : 'organization.boletim_template_set',
      entityType: 'organization',
      entityId: organizationId,
      data: { kind, fileId, replaced },
    });
  });
}

/** Saves the placements as a set. False when the club has no live template. */
export async function savePlacements(
  organizationId: string,
  kind: TemplateKind,
  fields: readonly BoletimPlacement[],
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    // Locks the live template, so two saves at once cannot both archive the
    // same set and leave two sets live.
    const { rows } = await tx.query<{ id: string }>(
      `SELECT id FROM boletim_template WHERE kind = $1 AND archived_at IS NULL FOR UPDATE`,
      [kind],
    );
    const template = rows[0];
    if (template === undefined) return false;
    await tx.query(
      `UPDATE boletim_template_field SET archived_at = now() WHERE template_id = $1 AND archived_at IS NULL`,
      [template.id],
    );
    if (fields.length > 0) {
      await tx.query(
        `INSERT INTO boletim_template_field (organization_id, template_id, field, x, y, size_pt, width)
         SELECT $1, $2, f.field::boletim_field, f.x, f.y, f.size_pt, f.width
           FROM unnest($3::text[], $4::numeric[], $5::numeric[], $6::numeric[], $7::numeric[])
                AS f(field, x, y, size_pt, width)`,
        [
          organizationId,
          template.id,
          fields.map((f) => f.field),
          fields.map((f) => f.x),
          fields.map((f) => f.y),
          fields.map((f) => f.sizePt),
          fields.map((f) => f.width ?? null),
        ],
      );
    }
    await recordAudit(tx, {
      action: 'organization.boletim_template_fields_saved',
      entityType: 'organization',
      entityId: organizationId,
      data: { kind, templateId: template.id, fields: fields.map((f) => f.field) },
    });
    return true;
  });
}
