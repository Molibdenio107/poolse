import { withOrg, type Tx } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';
import { decryptSensitive, encryptSensitive } from '../sensitive/cipher.js';
import { displayName } from '../people/names.js';

/**
 * *Documentos* on a student's record — POOLSE-132 (Rui, 30-10-2026).
 *
 * The identification document (number encrypted, every decrypting read
 * audited), the FPN disciplines, and the signed copies of the FPN's Anexo 2 —
 * one current per student, kind and season, older ones kept. What prints is
 * read here once (`fpnPrint`) so the page and the API cannot disagree about a
 * field.
 */

export const FPN_DISCIPLINES = ['pura', 'open_water', 'water_polo', 'artistic', 'adapted', 'masters', 'diving'] as const;
export type FpnDiscipline = (typeof FPN_DISCIPLINES)[number];
export const STUDENT_ID_DOCUMENT_TYPES = ['cc', 'bi', 'passport', 'other'] as const;
export type StudentIdDocumentType = (typeof STUDENT_ID_DOCUMENT_TYPES)[number];
/** `id_document`: the ID's photograph, filed with no season (30-10-2026). */
export type StudentDocumentKind = 'fpn_declaration' | 'fpn_declaration_minor' | 'socio_form' | 'id_document';

export interface FiledCopy {
  id: string;
  kind: StudentDocumentKind;
  seasonId: string | null;
  fileId: string;
  filedAt: string;
  filedByName: string | null;
  replacedAt: string | null;
}

export interface StudentDocuments {
  studentName: string;
  minor: boolean | null;
  disciplines: FpnDiscipline[];
  idDocument: {
    type: StudentIdDocumentType | null;
    hasNumber: boolean;
    issuedOn: string | null;
    validUntil: string | null;
  };
  club: { association: string | null; clubCode: string | null };
  seasons: { id: string; name: string; published: boolean }[];
  copies: FiledCopy[];
  /** What the Anexo 2 would print blank, as keys for the screen to list. */
  missing: string[];
}

/** Null when the student is not this club's (or not live). */
export async function readDocuments(organizationId: string, studentId: string): Promise<StudentDocuments | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      name: string;
      minor: boolean | null;
      disciplines: string[];
      id_document_type: StudentIdDocumentType | null;
      has_number: boolean;
      issued_on: string | null;
      valid_until: string | null;
      address_line: string | null;
      locality: string | null;
      postal_code: string | null;
      association: string | null;
      club_code: string | null;
    }>(
      `SELECT ${displayName('s')} AS name,
              CASE WHEN s.birth_date IS NULL THEN NULL
                   ELSE s.birth_date > club_today() - make_interval(years => o.age_of_majority) END AS minor,
              s.fpn_disciplines::text[] AS disciplines,
              s.id_document_type, s.id_document_number_encrypted IS NOT NULL AS has_number,
              s.id_document_issued_on::text AS issued_on, s.id_document_valid_until::text AS valid_until,
              s.address_line, s.locality, s.postal_code,
              o.fpn_association AS association, o.fpn_club_code AS club_code
         FROM student s JOIN organization o ON o.id = s.organization_id
        WHERE s.id = $1 AND s.archived_at IS NULL`,
      [studentId],
    );
    const row = rows[0];
    if (!row) return null;

    const seasons = await tx.query<{ id: string; name: string; published: boolean }>(
      `SELECT id, name, status::text = 'published' AS published
         FROM season
        WHERE archived_at IS NULL AND status::text <> 'archived' AND sport_id IS NULL
        ORDER BY starts_on DESC`,
    );
    const copies = await tx.query<{
      id: string;
      kind: StudentDocumentKind;
      season_id: string | null;
      file_id: string;
      filed_at: Date;
      filed_by_name: string | null;
      replaced_at: Date | null;
    }>(
      `SELECT d.id, d.kind, d.season_id, d.file_id, d.filed_at, person_name(d.filed_by) AS filed_by_name, d.replaced_at
         FROM student_document d
        WHERE d.student_id = $1
        ORDER BY d.filed_at DESC`,
      [studentId],
    );

    const missing: string[] = [];
    if (row.address_line === null) missing.push('addressLine');
    if (row.locality === null) missing.push('locality');
    if (row.postal_code === null) missing.push('postalCode');
    if (!row.has_number) missing.push('idDocumentNumber');
    if (row.valid_until === null) missing.push('idDocumentValidUntil');
    if (row.disciplines.length === 0) missing.push('disciplines');
    if (row.association === null) missing.push('fpnAssociation');
    if (row.club_code === null) missing.push('fpnClubCode');

    return {
      studentName: row.name,
      minor: row.minor,
      disciplines: row.disciplines as FpnDiscipline[],
      idDocument: {
        type: row.id_document_type,
        hasNumber: row.has_number,
        issuedOn: row.issued_on,
        validUntil: row.valid_until,
      },
      club: { association: row.association, clubCode: row.club_code },
      seasons: seasons.rows,
      copies: copies.rows.map((c) => ({
        id: c.id,
        kind: c.kind,
        seasonId: c.season_id,
        fileId: c.file_id,
        filedAt: c.filed_at.toISOString(),
        filedByName: c.filed_by_name,
        replacedAt: c.replaced_at?.toISOString() ?? null,
      })),
      missing,
    };
  });
}

export interface IdDocumentEdit {
  type: StudentIdDocumentType | null;
  /** Undefined keeps the number on file; null clears it with the type. */
  number?: string | null;
  issuedOn: string | null;
  validUntil: string | null;
}

/** The ID document and the disciplines, one save. Fields named, never valued. */
export async function saveDocumentFields(
  organizationId: string,
  studentId: string,
  edit: { idDocument?: IdDocumentEdit; disciplines?: FpnDiscipline[] },
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const current = await tx.query<{ id: string }>(
      'SELECT id FROM student WHERE id = $1 AND archived_at IS NULL FOR UPDATE',
      [studentId],
    );
    if (current.rowCount === 0) return false;
    const moved: string[] = [];

    if (edit.idDocument !== undefined) {
      const doc = edit.idDocument;
      if (doc.number === undefined) {
        await tx.query(
          `UPDATE student SET id_document_type = CASE WHEN id_document_number_encrypted IS NULL THEN NULL ELSE coalesce($2, id_document_type) END,
                  id_document_issued_on = $3::date, id_document_valid_until = $4::date
            WHERE id = $1`,
          [studentId, doc.type, doc.issuedOn, doc.validUntil],
        );
      } else {
        const sealed = doc.number === null || doc.type === null ? null : encryptSensitive(doc.number);
        await tx.query(
          `UPDATE student SET id_document_type = $2, id_document_number_encrypted = $3,
                  id_document_issued_on = $4::date, id_document_valid_until = $5::date
            WHERE id = $1`,
          [studentId, sealed === null ? null : doc.type, sealed, doc.issuedOn, doc.validUntil],
        );
        moved.push('idDocumentNumber');
      }
      moved.push('idDocumentType', 'idDocumentDates');
    }

    if (edit.disciplines !== undefined) {
      await tx.query(`UPDATE student SET fpn_disciplines = $2::fpn_discipline[] WHERE id = $1`, [
        studentId,
        edit.disciplines,
      ]);
      moved.push('fpnDisciplines');
    }

    await recordAudit(tx, {
      action: 'student.updated',
      entityType: 'student',
      entityId: studentId,
      data: { before: {}, after: {}, withheld: moved },
    });
    return true;
  });
}

export async function saveFpnClubSettings(
  organizationId: string,
  settings: { association: string | null; clubCode: string | null },
): Promise<void> {
  await withOrg(organizationId, async (tx) => {
    await tx.query(`UPDATE organization SET fpn_association = $2, fpn_club_code = $3 WHERE id = $1`, [
      organizationId,
      settings.association,
      settings.clubCode,
    ]);
    await recordAudit(tx, {
      action: 'organization.fpn_settings',
      entityType: 'organization',
      entityId: organizationId,
      data: settings,
    });
  });
}

export type FileOutcome = 'filed' | 'not_found' | 'bad_file' | 'bad_season';

/**
 * Files a signed copy: the current one for that student, kind and season is
 * closed and the new one opened, in one transaction (the POOLSE-105 shape).
 */
export async function fileCopy(
  organizationId: string,
  membershipId: string,
  studentId: string,
  kind: StudentDocumentKind,
  seasonId: string | null,
  fileId: string,
): Promise<FileOutcome> {
  return withOrg(organizationId, async (tx) => {
    const student = await tx.query('SELECT 1 FROM student WHERE id = $1 AND archived_at IS NULL', [studentId]);
    if (student.rowCount === 0) return 'not_found';
    const file = await tx.query(`SELECT 1 FROM stored_file WHERE id = $1 AND purpose = 'student_document'`, [fileId]);
    if (file.rowCount === 0) return 'bad_file';
    if (seasonId !== null) {
      const season = await tx.query('SELECT 1 FROM season WHERE id = $1 AND archived_at IS NULL', [seasonId]);
      if (season.rowCount === 0) return 'bad_season';
    }

    await tx.query(
      `UPDATE student_document SET replaced_at = now(), replaced_by = $4
        WHERE student_id = $1 AND kind = $2::student_document_kind
          AND season_id IS NOT DISTINCT FROM $3::uuid AND replaced_at IS NULL`,
      [studentId, kind, seasonId, membershipId],
    );
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO student_document (organization_id, student_id, kind, season_id, file_id, filed_by)
       VALUES ($1, $2, $3::student_document_kind, $4, $5, $6) RETURNING id`,
      [organizationId, studentId, kind, seasonId, fileId, membershipId],
    );
    await recordAudit(tx, {
      action: 'student.document_filed',
      entityType: 'student',
      entityId: studentId,
      data: { kind, seasonId, documentId: rows[0]!.id },
    });
    return 'filed';
  });
}

export interface FpnPrint {
  signerName: string;
  studentName: string;
  minor: boolean;
  addressLine: string | null;
  locality: string | null;
  postalCode: string | null;
  idDocumentType: StudentIdDocumentType | null;
  idDocumentNumber: string | null;
  issuedOn: string | null;
  validUntil: string | null;
  seasonName: string | null;
  disciplines: FpnDiscipline[];
  association: string | null;
  clubCode: string | null;
  place: string | null;
}

/**
 * Everything the Anexo 2 prints, the ID number decrypted — and that read
 * written to the audit log in the same transaction (`student.id_document_read`).
 * For a minor the signer is the primary guardian, acting for the student.
 */
export async function fpnPrint(
  organizationId: string,
  studentId: string,
  seasonId: string | null,
  minor: boolean,
): Promise<FpnPrint | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      name: string;
      guardian_name: string | null;
      address_line: string | null;
      locality: string | null;
      postal_code: string | null;
      id_document_type: StudentIdDocumentType | null;
      id_number: string | null;
      issued_on: string | null;
      valid_until: string | null;
      disciplines: string[];
      association: string | null;
      club_code: string | null;
      place: string | null;
    }>(
      `SELECT ${displayName('s')} AS name,
              (SELECT person_name(gl.guardian_membership_id) FROM guardian_link gl
                WHERE gl.student_id = s.id AND gl.archived_at IS NULL
                ORDER BY gl.is_primary DESC, gl.created_at LIMIT 1) AS guardian_name,
              s.address_line, s.locality, s.postal_code,
              s.id_document_type, s.id_document_number_encrypted AS id_number,
              s.id_document_issued_on::text AS issued_on, s.id_document_valid_until::text AS valid_until,
              s.fpn_disciplines::text[] AS disciplines,
              o.fpn_association AS association, o.fpn_club_code AS club_code,
              (SELECT f.city FROM facility f WHERE f.archived_at IS NULL ORDER BY f.created_at LIMIT 1) AS place
         FROM student s JOIN organization o ON o.id = s.organization_id
        WHERE s.id = $1 AND s.archived_at IS NULL`,
      [studentId],
    );
    const row = rows[0];
    if (!row) return null;
    const season = seasonId === null
      ? await tx.query<{ name: string }>(`SELECT name FROM season WHERE status::text = 'published' AND sport_id IS NULL AND archived_at IS NULL LIMIT 1`)
      : await tx.query<{ name: string }>('SELECT name FROM season WHERE id = $1', [seasonId]);

    const number = decryptSensitive(row.id_number);
    if (number !== null) {
      await recordAudit(tx, {
        action: 'student.id_document_read',
        entityType: 'student',
        entityId: studentId,
        data: { purpose: 'fpn_declaration' },
      });
    }

    return {
      signerName: minor ? (row.guardian_name ?? '') : row.name,
      studentName: row.name,
      minor,
      addressLine: row.address_line,
      locality: row.locality,
      postalCode: row.postal_code,
      idDocumentType: row.id_document_type,
      idDocumentNumber: number,
      issuedOn: row.issued_on,
      validUntil: row.valid_until,
      seasonName: season.rows[0]?.name ?? null,
      disciplines: row.disciplines as FpnDiscipline[],
      association: row.association,
      clubCode: row.club_code,
      place: row.place,
    };
  });
}

/** For tests and the change-free read: the number as stored, decrypted. */
export async function readIdNumberIn(tx: Tx, studentId: string): Promise<string | null> {
  const { rows } = await tx.query<{ n: string | null }>(
    'SELECT id_document_number_encrypted AS n FROM student WHERE id = $1',
    [studentId],
  );
  return decryptSensitive(rows[0]?.n ?? null);
}

export interface BoletimPrint {
  clubName: string;
  socioNumber: string | null;
  socioSince: string | null;
  isSocio: boolean;
  name: string;
  birthDate: string | null;
  taxNumber: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  addressLine: string | null;
  locality: string | null;
  postalCode: string | null;
  parentOneName: string | null;
  parentTwoName: string | null;
  maritalStatus: string | null;
  profession: string | null;
  education: string | null;
  birthplace: string | null;
  nationality: string | null;
  minor: boolean;
  guardian: { name: string; phone: string | null; email: string | null; relationship: string | null } | null;
}

/**
 * Everything the boletim de sócio prints — POOLSE-134. The record's own fields
 * and the sócio columns, nothing held by the form. The SNS number is never
 * printed; for a minor, the primary guardian.
 */
export async function boletimPrint(organizationId: string, studentId: string): Promise<BoletimPrint | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      club_name: string;
      socio_number: string | null;
      socio_since: string | null;
      is_socio: boolean;
      name: string;
      birth_date: string | null;
      tax_number: string | null;
      contact_email: string | null;
      contact_phone: string | null;
      address_line: string | null;
      locality: string | null;
      postal_code: string | null;
      parent_one_name: string | null;
      parent_two_name: string | null;
      marital_status: string | null;
      profession: string | null;
      education: string | null;
      birthplace: string | null;
      nationality: string | null;
      minor: boolean | null;
      guardian: { name: string; phone: string | null; email: string | null; relationship: string | null } | null;
    }>(
      `SELECT o.name AS club_name, s.socio_number, s.socio_since::text, s.is_socio,
              ${displayName('s')} AS name, s.birth_date::text, s.tax_number,
              s.contact_email::text AS contact_email, s.contact_phone,
              s.address_line, s.locality, s.postal_code, s.parent_one_name, s.parent_two_name,
              s.marital_status::text, s.profession, s.education, s.birthplace, s.nationality,
              CASE WHEN s.birth_date IS NULL THEN NULL
                   ELSE s.birth_date > club_today() - make_interval(years => o.age_of_majority) END AS minor,
              (SELECT jsonb_build_object(
                        'name', person_name(gl.guardian_membership_id),
                        'phone', m.phone,
                        'email', person_email(gl.guardian_membership_id)::text,
                        'relationship', gl.relationship)
                 FROM guardian_link gl
                 JOIN membership m ON m.id = gl.guardian_membership_id
                WHERE gl.student_id = s.id AND gl.archived_at IS NULL
                ORDER BY gl.is_primary DESC, gl.created_at LIMIT 1) AS guardian
         FROM student s JOIN organization o ON o.id = s.organization_id
        WHERE s.id = $1 AND s.archived_at IS NULL`,
      [studentId],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      clubName: row.club_name,
      socioNumber: row.socio_number,
      socioSince: row.socio_since,
      isSocio: row.is_socio,
      name: row.name,
      birthDate: row.birth_date,
      taxNumber: row.tax_number,
      contactEmail: row.contact_email,
      contactPhone: row.contact_phone,
      addressLine: row.address_line,
      locality: row.locality,
      postalCode: row.postal_code,
      parentOneName: row.parent_one_name,
      parentTwoName: row.parent_two_name,
      maritalStatus: row.marital_status,
      profession: row.profession,
      education: row.education,
      birthplace: row.birthplace,
      nationality: row.nationality,
      minor: row.minor === true,
      guardian: row.minor === true ? row.guardian : null,
    };
  });
}

export interface IdDocumentFull {
  type: StudentIdDocumentType | null;
  number: string | null;
  issuedOn: string | null;
  validUntil: string | null;
}

/**
 * The ID document with its number in full — Rui, 30-10-2026, for the General
 * tab: shown to owner and admin, and every read that decrypts a number is a
 * `student.id_document_read` line in the activity log, in the same transaction.
 */
export async function readIdDocumentFull(organizationId: string, studentId: string): Promise<IdDocumentFull | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      type: StudentIdDocumentType | null;
      number: string | null;
      issued_on: string | null;
      valid_until: string | null;
    }>(
      `SELECT id_document_type AS type, id_document_number_encrypted AS number,
              id_document_issued_on::text AS issued_on, id_document_valid_until::text AS valid_until
         FROM student WHERE id = $1 AND archived_at IS NULL`,
      [studentId],
    );
    const row = rows[0];
    if (!row) return null;
    const number = decryptSensitive(row.number);
    if (number !== null) {
      await recordAudit(tx, {
        action: 'student.id_document_read',
        entityType: 'student',
        entityId: studentId,
        data: { purpose: 'record' },
      });
    }
    return { type: row.type, number, issuedOn: row.issued_on, validUntil: row.valid_until };
  });
}
