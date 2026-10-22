import { withOrg } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';
import { TOTAL_COUNT, windowed, type PageQuery, type Paginated } from '../common/pagination.js';

/**
 * Qualifications with expiry — POOLSE-27, 7b.2.
 *
 * **Every status here is read from `qualification_current`**, the view over
 * `qualification_status()` — the one definition, shared with the assignment
 * block and the daily alert job. Nothing in this file computes a colour.
 *
 * **"Em falta"** is the fourth state and is not a record: an instructor with no
 * live record of a type the club marked *required to teach*. It is derived here,
 * in SQL, from the absence — and it never blocks anything.
 */

export type QualificationStatus = 'green' | 'amber' | 'red';
export type StandingStatus = QualificationStatus | 'missing';

export interface QualificationType {
  id: string;
  name: string;
  defaultValidityMonths: number | null;
  amberDays: number | null;
  requiredToTeach: boolean;
  blocksAssignment: boolean;
}

export interface QualificationRecord {
  id: string;
  typeId: string;
  typeName: string;
  issuingBody: string | null;
  issuedOn: string | null;
  expiresOn: string | null;
  archived: boolean;
  createdAt: string;
  /** The scanned certificate, attached once — served at `/files/:id`. */
  documentFileId: string | null;
}

export interface Standing {
  typeId: string;
  typeName: string;
  status: StandingStatus;
  /** Null for `missing`. */
  qualificationId: string | null;
  expiresOn: string | null;
  issuingBody: string | null;
}

export interface PersonQualifications {
  /** One per type the person holds, plus a `missing` row per required type they lack. */
  standings: Standing[];
  /** Every record, newest first, archived included — the history. */
  history: QualificationRecord[];
}

export interface ExpiringRow extends Standing {
  membershipId: string;
  personName: string | null;
  /**
   * The record's certificate, served by `GET /files/:id` under its own read
   * rule — POOLSE-97. Null when none is on file, and always for *em falta*,
   * which has no record to carry one.
   */
  documentFileId: string | null;
  /** The file's own name, so a download is called what was uploaded. */
  documentName: string | null;
}

/** What the attention list can be narrowed to. */
export interface ExpiringFilter {
  /**
   * Only records with no certificate on file — POOLSE-97 *Sem certificado*.
   * An *em falta* row is not one: it has no record to attach a scan to, and
   * what is missing there is the qualification itself.
   */
  withoutCertificate?: boolean;
}

/** Type input, already validated by the controller. */
export interface TypeInput {
  name: string;
  defaultValidityMonths: number | null;
  amberDays: number | null;
  requiredToTeach: boolean;
  blocksAssignment: boolean;
}

export interface QualificationInput {
  typeId: string;
  issuingBody: string | null;
  issuedOn: string | null;
  expiresOn: string | null;
}

export class DuplicateTypeError extends Error {}
export class UnknownReferenceError extends Error {}

/**
 * A `date` column as `YYYY-MM-DD`. node-pg builds it at *local* midnight, so
 * `toISOString()` gives the day before on any machine east of UTC — local
 * getters read back the day that was stored (13-10-2026 sweep).
 */
function localDay(value: Date): string {
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const date = String(value.getDate()).padStart(2, '0');
  return `${value.getFullYear()}-${month}-${date}`;
}

const day = (value: Date | string | null): string | null =>
  value === null ? null : typeof value === 'string' ? value : localDay(value);

/* ------------------------------------------------------------------ types */

export async function listTypes(organizationId: string): Promise<QualificationType[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      id: string;
      name: string;
      default_validity_months: number | null;
      amber_days: number | null;
      required_to_teach: boolean;
      blocks_assignment: boolean;
    }>(
      `SELECT id, name, default_validity_months, amber_days, required_to_teach, blocks_assignment
         FROM qualification_type
        WHERE archived_at IS NULL
        ORDER BY lower(name)`,
    );
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      defaultValidityMonths: row.default_validity_months,
      amberDays: row.amber_days,
      requiredToTeach: row.required_to_teach,
      blocksAssignment: row.blocks_assignment,
    }));
  });
}

function asDuplicate(error: unknown): never {
  if ((error as { code?: string }).code === '23505') throw new DuplicateTypeError();
  throw error;
}

export async function createType(organizationId: string, input: TypeInput): Promise<string> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx
      .query<{ id: string }>(
        `INSERT INTO qualification_type
           (organization_id, name, default_validity_months, amber_days, required_to_teach,
            blocks_assignment)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [
          organizationId,
          input.name,
          input.defaultValidityMonths,
          input.amberDays,
          input.requiredToTeach,
          input.blocksAssignment,
        ],
      )
      .catch(asDuplicate);
    await recordAudit(tx, {
      action: 'qualification.typeCreated',
      entityType: 'qualification_type',
      entityId: rows[0]!.id,
      data: { name: input.name, blocksAssignment: input.blocksAssignment },
    });
    return rows[0]!.id;
  });
}

export async function updateType(
  organizationId: string,
  typeId: string,
  input: TypeInput,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rowCount } = await tx
      .query(
        `UPDATE qualification_type
            SET name = $2, default_validity_months = $3, amber_days = $4,
                required_to_teach = $5, blocks_assignment = $6
          WHERE id = $1 AND archived_at IS NULL`,
        [
          typeId,
          input.name,
          input.defaultValidityMonths,
          input.amberDays,
          input.requiredToTeach,
          input.blocksAssignment,
        ],
      )
      .catch(asDuplicate);
    if ((rowCount ?? 0) === 0) return false;
    // Turning a block on or off is a permission-shaped change; it is recorded.
    await recordAudit(tx, {
      action: 'qualification.typeUpdated',
      entityType: 'qualification_type',
      entityId: typeId,
      data: { requiredToTeach: input.requiredToTeach, blocksAssignment: input.blocksAssignment },
    });
    return true;
  });
}

export async function archiveType(organizationId: string, typeId: string): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rowCount } = await tx.query(
      `UPDATE qualification_type SET archived_at = now() WHERE id = $1 AND archived_at IS NULL`,
      [typeId],
    );
    if ((rowCount ?? 0) > 0) {
      await recordAudit(tx, {
        action: 'qualification.typeArchived',
        entityType: 'qualification_type',
        entityId: typeId,
        data: {},
      });
    }
    return (rowCount ?? 0) > 0;
  });
}

export async function readAmberDays(organizationId: string): Promise<number> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ days: number }>(
      'SELECT qualification_amber_days AS days FROM organization WHERE id = $1',
      [organizationId],
    );
    return rows[0]?.days ?? 90;
  });
}

export async function writeAmberDays(organizationId: string, days: number): Promise<void> {
  await withOrg(organizationId, async (tx) => {
    await tx.query('UPDATE organization SET qualification_amber_days = $2 WHERE id = $1', [
      organizationId,
      days,
    ]);
    await recordAudit(tx, {
      action: 'qualification.windowChanged',
      entityType: 'organization',
      entityId: organizationId,
      data: { days },
    });
  });
}

/* ---------------------------------------------------------------- records */

/**
 * A person's standing per type, and the history behind it.
 *
 * `missing` rows only for somebody who holds the instructor role: a required
 * type is required *to teach*, and an admin who never stands on the poolside is
 * not short of a TPTD.
 */
export async function personQualifications(
  organizationId: string,
  membershipId: string,
): Promise<PersonQualifications | null> {
  return withOrg(organizationId, async (tx) => {
    const exists = await tx.query('SELECT 1 FROM membership WHERE id = $1', [membershipId]);
    if ((exists.rowCount ?? 0) === 0) return null;

    const standings = await tx.query<{
      type_id: string;
      type_name: string;
      status: StandingStatus;
      qualification_id: string | null;
      expires_on: Date | null;
      issuing_body: string | null;
    }>(
      `SELECT t.id AS type_id, t.name AS type_name, c.status, c.id AS qualification_id,
              c.expires_on, c.issuing_body
         FROM qualification_current c
         JOIN qualification_type t ON t.id = c.qualification_type_id
        WHERE c.membership_id = $1
       UNION ALL
       SELECT t.id, t.name, 'missing', NULL, NULL, NULL
         FROM qualification_type t
        WHERE t.archived_at IS NULL
          AND t.required_to_teach
          AND EXISTS (SELECT 1 FROM membership_role r
                       WHERE r.membership_id = $1 AND r.role = 'instructor'
                         AND r.archived_at IS NULL)
          AND NOT EXISTS (SELECT 1 FROM qualification_current c
                           WHERE c.membership_id = $1 AND c.qualification_type_id = t.id)
        ORDER BY 2`,
      [membershipId],
    );

    const history = await tx.query<{
      id: string;
      type_id: string;
      type_name: string;
      issuing_body: string | null;
      issued_on: Date | null;
      expires_on: Date | null;
      archived_at: Date | null;
      created_at: Date;
      document_file_id: string | null;
    }>(
      `SELECT q.id, t.id AS type_id, t.name AS type_name, q.issuing_body, q.issued_on,
              q.expires_on, q.archived_at, q.created_at, q.document_file_id
         FROM qualification q
         JOIN qualification_type t ON t.id = q.qualification_type_id
        WHERE q.membership_id = $1
        ORDER BY q.created_at DESC`,
      [membershipId],
    );

    return {
      standings: standings.rows.map((row) => ({
        typeId: row.type_id,
        typeName: row.type_name,
        status: row.status,
        qualificationId: row.qualification_id,
        expiresOn: day(row.expires_on),
        issuingBody: row.issuing_body,
      })),
      history: history.rows.map((row) => ({
        id: row.id,
        typeId: row.type_id,
        typeName: row.type_name,
        issuingBody: row.issuing_body,
        issuedOn: day(row.issued_on),
        expiresOn: day(row.expires_on),
        archived: row.archived_at !== null,
        documentFileId: row.document_file_id,
        createdAt: row.created_at.toISOString(),
      })),
    };
  });
}

export async function addQualification(
  organizationId: string,
  actorMembershipId: string | null,
  membershipId: string,
  input: QualificationInput,
): Promise<string> {
  return withOrg(organizationId, async (tx) => {
    const type = await tx.query(
      'SELECT 1 FROM qualification_type WHERE id = $1 AND archived_at IS NULL',
      [input.typeId],
    );
    const person = await tx.query('SELECT 1 FROM membership WHERE id = $1', [membershipId]);
    if ((type.rowCount ?? 0) === 0 || (person.rowCount ?? 0) === 0) {
      throw new UnknownReferenceError();
    }

    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO qualification (organization_id, membership_id, qualification_type_id,
                                  issuing_body, issued_on, expires_on, created_by_membership_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        organizationId,
        membershipId,
        input.typeId,
        input.issuingBody,
        input.issuedOn,
        input.expiresOn,
        actorMembershipId,
      ],
    );
    await recordAudit(tx, {
      action: 'qualification.added',
      entityType: 'membership',
      entityId: membershipId,
      data: { typeId: input.typeId, expiresOn: input.expiresOn },
    });
    return rows[0]!.id;
  });
}

/** Archive one record. Returns the person it belonged to, or null. */
export async function archiveQualification(
  organizationId: string,
  qualificationId: string,
): Promise<string | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ membership_id: string }>(
      `UPDATE qualification SET archived_at = now()
        WHERE id = $1 AND archived_at IS NULL
      RETURNING membership_id`,
      [qualificationId],
    );
    const row = rows[0];
    if (!row) return null;
    await recordAudit(tx, {
      action: 'qualification.archived',
      entityType: 'membership',
      entityId: row.membership_id,
      data: { qualificationId },
    });
    return row.membership_id;
  });
}

/* --------------------------------------------------------------- the list */

interface ExpiringDbRow {
  total_count: number;
  membership_id: string;
  person_name: string | null;
  type_id: string;
  type_name: string;
  status: StandingStatus;
  qualification_id: string | null;
  expires_on: Date | null;
  issuing_body: string | null;
  document_file_id: string | null;
  document_name: string | null;
}

/**
 * Everybody amber or red, worst first — expired by how long ago, then amber by
 * how soon — and then the instructors missing a required type. One statement,
 * paged inside it, the certificate joined in and the filter applied before the
 * LIMIT, so page 2 of *Sem certificado* is page 2 of that list (POOLSE-97).
 */
export async function listExpiring(
  organizationId: string,
  page: PageQuery,
  filter: ExpiringFilter = {},
): Promise<Paginated<ExpiringRow>> {
  return withOrg(organizationId, (tx) =>
    windowed(
      page,
      (limit, offset) =>
        tx.query<ExpiringDbRow>(
          `WITH flagged AS (
             SELECT c.membership_id, c.qualification_type_id AS type_id, c.status,
                    c.id AS qualification_id, c.expires_on, c.issuing_body
               FROM qualification_current c
               JOIN membership m ON m.id = c.membership_id AND m.archived_at IS NULL
              WHERE c.status IN ('amber', 'red')
             UNION ALL
             SELECT r.membership_id, t.id, 'missing', NULL, NULL, NULL
               FROM qualification_type t
               JOIN membership_role r ON r.role = 'instructor' AND r.archived_at IS NULL
               JOIN membership m ON m.id = r.membership_id AND m.archived_at IS NULL
              WHERE t.archived_at IS NULL
                AND t.required_to_teach
                AND NOT EXISTS (SELECT 1 FROM qualification_current c
                                 WHERE c.membership_id = r.membership_id
                                   AND c.qualification_type_id = t.id)
           )
           SELECT f.membership_id, person_name(f.membership_id) AS person_name,
                  f.type_id, t.name AS type_name, f.status, f.qualification_id,
                  f.expires_on, f.issuing_body,
                  q.document_file_id, sf.original_name AS document_name, ${TOTAL_COUNT}
             FROM flagged f
             JOIN qualification_type t ON t.id = f.type_id
             LEFT JOIN qualification q ON q.id = f.qualification_id
             LEFT JOIN stored_file sf ON sf.id = q.document_file_id AND sf.archived_at IS NULL
            WHERE NOT $3::boolean
               OR (f.qualification_id IS NOT NULL AND q.document_file_id IS NULL)
            ORDER BY CASE f.status WHEN 'red' THEN 0 WHEN 'amber' THEN 1 ELSE 2 END,
                     f.expires_on NULLS LAST, lower(t.name), f.membership_id
            LIMIT $1 OFFSET $2`,
          [limit, offset, filter.withoutCertificate === true],
        ),
      (row: ExpiringDbRow): ExpiringRow => ({
        membershipId: row.membership_id,
        personName: row.person_name,
        typeId: row.type_id,
        typeName: row.type_name,
        status: row.status,
        qualificationId: row.qualification_id,
        expiresOn: day(row.expires_on),
        issuingBody: row.issuing_body,
        documentFileId: row.document_file_id,
        documentName: row.document_name,
      }),
    ),
  );
}

/** Counts for the dashboard card: one grouped statement. */
export interface QualificationsWidget {
  red: number;
  amber: number;
  missing: number;
  /** The five most urgent, for the card's list. */
  top: ExpiringRow[];
}

export async function readQualificationsWidget(
  organizationId: string,
): Promise<QualificationsWidget> {
  const page = await listExpiring(organizationId, { page: 1, limit: 5, offset: 0 });
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ red: number; amber: number; missing: number }>(
      `SELECT count(*) FILTER (WHERE c.status = 'red')::int AS red,
              count(*) FILTER (WHERE c.status = 'amber')::int AS amber,
              (SELECT count(*)::int
                 FROM qualification_type t
                 JOIN membership_role r ON r.role = 'instructor' AND r.archived_at IS NULL
                 JOIN membership m ON m.id = r.membership_id AND m.archived_at IS NULL
                WHERE t.archived_at IS NULL AND t.required_to_teach
                  AND NOT EXISTS (SELECT 1 FROM qualification_current q
                                   WHERE q.membership_id = r.membership_id
                                     AND q.qualification_type_id = t.id)) AS missing
         FROM qualification_current c
         JOIN membership m ON m.id = c.membership_id AND m.archived_at IS NULL`,
    );
    const counts = rows[0] ?? { red: 0, amber: 0, missing: 0 };
    return { ...counts, top: page.items };
  });
}
