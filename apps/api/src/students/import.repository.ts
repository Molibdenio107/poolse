import { withOrg, type Tx } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';
import { displayName } from '../people/names.js';
import { insertStudent } from './students.repository.js';
import {
  validateImportRows,
  type ExistingStudent,
  type ImportLevel,
  type ImportRow,
  type ImportSummary,
  type RawImportRow,
} from './import.js';

/**
 * Slice 1.10 — the import, against the database.
 *
 * Everything here is one `withOrg` call, and that is the design rather than a
 * tidiness preference. Two things follow from it:
 *
 * - **The preview and the commit read the same register.** Levels, the club's
 *   maioridade and the existing students are loaded inside the same transaction
 *   that writes, so a level archived between the two cannot make the commit
 *   quietly differ from what the operator approved.
 * - **An import lands whole or not at all.** `insertStudent` was lifted out of
 *   `createStudent` for exactly this: two hundred students share one
 *   transaction, so a failure on row 187 leaves nothing behind. Half an import
 *   is worse than none — nobody can tell which half, and running it again
 *   doubles what landed.
 */

export interface ImportRequest {
  rows: RawImportRow[];
  /** False previews, true writes. One endpoint, so the two cannot drift apart. */
  commit: boolean;
  /**
   * The row indexes the operator ticked, or null for "everything importable".
   *
   * Only consulted on a commit. The server still refuses any row with a problem
   * whatever arrives here — hiding a control is never the control, and a tick on
   * a broken row is a client that is out of date, not permission.
   */
  include: number[] | null;
  defaultRelationship: string;
}

export interface ImportResult {
  rows: ImportRow[];
  summary: ImportSummary;
  /** Present only on a commit. */
  created?: number;
  /** Importable rows the operator did not tick — duplicates, mostly. */
  skipped?: number;
}

/** The levels a name can match, cheapest form: no counts, no ordering to keep. */
async function levelsFor(tx: Tx): Promise<ImportLevel[]> {
  const { rows } = await tx.query<{ id: string; name: string }>(
    `SELECT id, name FROM student_level WHERE archived_at IS NULL ORDER BY sort_order`,
    [],
  );
  return rows;
}

/**
 * The whole register, for duplicate detection.
 *
 * Unpaginated on purpose. The comparison is "is this child already here", which
 * needs every child — and the bound is a club's register, hundreds rather than
 * millions, held for the length of one request. If that stops being true the
 * answer is a key comparison in SQL, not a page of it.
 */
async function existingStudents(tx: Tx): Promise<ExistingStudent[]> {
  const { rows } = await tx.query<{
    id: string;
    first_name: string;
    last_name: string;
    birth_date: string | null;
    display_name: string;
  }>(
    `SELECT s.id, s.first_name, s.last_name,
            to_char(s.birth_date, 'YYYY-MM-DD') AS birth_date,
            ${displayName('s')} AS display_name
       FROM student s
      WHERE s.archived_at IS NULL`,
    [],
  );

  return rows.map((row) => ({
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    birthDate: row.birth_date,
    displayName: row.display_name,
  }));
}

async function ageOfMajorityIn(tx: Tx, organizationId: string): Promise<number> {
  const { rows } = await tx.query<{ age_of_majority: number }>(
    `SELECT age_of_majority FROM organization WHERE id = $1`,
    [organizationId],
  );
  return rows[0]?.age_of_majority ?? 18;
}

/**
 * Today, in ISO form.
 *
 * A plain calendar date, so "born tomorrow" and "already eighteen" mean the same
 * thing here as they do on the form. UTC rather than the server's zone for the
 * reason `lib/dates.ts` gives: a date is not an instant, and doing this in local
 * time is how a request at 00:30 gets yesterday.
 */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function runImport(
  organizationId: string,
  request: ImportRequest,
): Promise<ImportResult> {
  return withOrg(organizationId, async (tx) => {
    const [levels, existing, ageOfMajority] = await Promise.all([
      levelsFor(tx),
      existingStudents(tx),
      ageOfMajorityIn(tx, organizationId),
    ]);

    const { rows, summary } = validateImportRows(request.rows, {
      levels,
      existing,
      ageOfMajority,
      defaultRelationship: request.defaultRelationship,
      today: todayIso(),
    });

    if (!request.commit) return { rows, summary };

    /*
     * A duplicate is not ticked by default, so "everything importable" is not
     * the same as "everything the operator saw". `include` being null means the
     * client sent no selection at all — an API caller rather than the screen —
     * and then the safe reading is the same one the screen defaults to: import
     * what is clean and leave the duplicates.
     */
    const ticked = request.include === null ? null : new Set(request.include);
    const chosen = rows.filter(
      (row) =>
        row.importable &&
        (ticked === null ? row.duplicate === null : ticked.has(row.index)),
    );

    for (const row of chosen) {
      const created = await insertStudent(tx, organizationId, {
        firstName: row.firstName,
        lastName: row.lastName,
        birthDate: row.birthDate,
        levelId: row.levelId,
        contactEmail: row.contactEmail,
        contactPhone: row.contactPhone,
        notes: row.notes,
        guardians:
          row.guardian === null
            ? []
            : [
                {
                  membershipId: null,
                  name: row.guardian.name,
                  relationship: row.guardian.relationship,
                  phone: row.guardian.phone,
                  email: row.guardian.email,
                  taxNumber: row.guardian.taxNumber,
                  address: null,
                  isPrimary: true,
                },
              ],
      });

      /*
       * `insertStudent` answers null when the level does not exist. It cannot
       * here — the id came from `levelsFor` inside this same transaction — so
       * this is the assertion rather than the recovery: throwing rolls the whole
       * import back, which is the only honest outcome if the impossible happens.
       */
      if (created === null) {
        throw new Error(`Level ${row.levelId ?? ''} disappeared during the import`);
      }
    }

    /*
     * One entry for the import itself, on top of the `student.created` entry
     * each row already writes.
     *
     * Without it the audit log says two hundred students appeared one after
     * another and nothing says why. "Who imported a file, when, and how much of
     * it was refused" is the question somebody asks in six months, and it has no
     * other answer.
     */
    await recordAudit(tx, {
      action: 'students.imported',
      entityType: 'organization',
      entityId: organizationId,
      data: {
        created: chosen.length,
        total: summary.total,
        refused: summary.refused,
        skipped: summary.importable - chosen.length,
      },
    });

    return {
      rows,
      summary,
      created: chosen.length,
      skipped: summary.importable - chosen.length,
    };
  });
}
