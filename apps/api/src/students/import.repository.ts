import { withOrg, type Tx } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';
import { displayName } from '../people/names.js';
import { fillStudentBlanks, insertStudent } from './students.repository.js';
import {
  normaliseKey,
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
}

export interface ImportResult {
  rows: ImportRow[];
  summary: ImportSummary;
  /** Present only on a commit. */
  created?: number;
  /** Importable rows the operator did not tick — duplicates, mostly. */
  skipped?: number;
  /** Levels this commit created, by name. Present only on a commit. */
  levelsCreated?: string[];
  /** Students this commit filled in blanks on, rather than created. */
  updated?: number;
}

/**
 * The next free position on the club's programme ladder.
 *
 * New levels go on the end. A spreadsheet's column order is not a considered
 * progression — "Adultos" appearing before "Adaptação" is an accident of who
 * typed the file — and guessing at where a level belongs would reorder a ladder
 * the club already thinks in. The operator drags them into place afterwards,
 * which is one gesture on a screen built for it.
 */
async function nextSortOrder(tx: Tx): Promise<number> {
  const { rows } = await tx.query<{ next: number }>(
    'SELECT coalesce(max(sort_order), 0) + 1 AS next FROM student_level',
    [],
  );
  return rows[0]?.next ?? 1;
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
    tax_number: string | null;
    display_name: string;
    level_id: string | null;
    contact_email: string | null;
    contact_phone: string | null;
    notes: string | null;
  }>(
    `SELECT s.id, s.first_name, s.last_name,
            to_char(s.birth_date, 'YYYY-MM-DD') AS birth_date,
            s.tax_number, s.level_id,
            s.contact_email::text AS contact_email, s.contact_phone, s.notes,
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
    taxNumber: row.tax_number,
    displayName: row.display_name,
    levelId: row.level_id,
    contactEmail: row.contact_email,
    contactPhone: row.contact_phone,
    notes: row.notes,
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

    /*
     * A row of the file that repeats an earlier row is never written.
     *
     * Not skipped as a courtesy — structurally excluded. A sheet with one line
     * per class attended lists the same child four times, and inserting the
     * second, third and fourth is the exact duplicate this feature exists to
     * prevent. The earlier row is the one that acts.
     */
    const actionable = rows.filter((row) => row.importable && row.duplicate?.kind !== 'file');

    /*
     * With no explicit selection — an API caller rather than the screen — this
     * creates the students the club does not have and touches nobody it does.
     *
     * The same default the preview ticks. Filling in an existing student's
     * blanks is something a caller has to ask for row by row, because an import
     * that edited records nobody mentioned would be doing more than it says.
     */
    const chosen = actionable.filter((row) =>
      ticked === null ? row.duplicate === null : ticked.has(row.index),
    );

    const toCreate = chosen.filter((row) => row.duplicate === null);
    const toUpdate = chosen.filter(
      (row) => row.duplicate?.kind === 'register' && row.updates.length > 0,
    );

    /*
     * Levels the file names and the club does not have yet.
     *
     * Created before the students, inside the same transaction, so an import
     * either brings the whole programme and its people or brings neither. A
     * level created by a commit that then failed would be a ghost on the ladder
     * with nobody in it.
     *
     * Keyed by the normalised name, so a file that spells "Iniciação" three
     * different ways creates one level rather than three.
     */
    const wanted = new Map<string, string>();
    for (const row of chosen) {
      if (row.levelId === null && row.levelName !== null) {
        const levelKey = normaliseKey(row.levelName);
        // First spelling wins. `set` unconditionally would name the level after
        // whichever row happened to be last, so a file with "Pré-competição"
        // and "pre competicao" in it would put the unaccented one on the ladder.
        if (!wanted.has(levelKey)) wanted.set(levelKey, row.levelName);
      }
    }

    const createdLevels = new Map<string, string>();
    let order = await nextSortOrder(tx);

    for (const [levelKey, name] of wanted) {
      const { rows: made } = await tx.query<{ id: string }>(
        `INSERT INTO student_level (organization_id, name, sort_order)
         VALUES ($1, $2, $3) RETURNING id`,
        [organizationId, name, order],
      );
      const id = made[0]?.id;
      if (id === undefined) throw new Error(`Could not create the level "${name}"`);

      createdLevels.set(levelKey, id);
      order += 1;
    }

    for (const row of toCreate) {
      const levelId =
        row.levelId ??
        (row.levelName === null
          ? null
          : (createdLevels.get(normaliseKey(row.levelName)) ?? null));

      const created = await insertStudent(tx, organizationId, {
        firstName: row.firstName,
        lastName: row.lastName,
        birthDate: row.birthDate,
        levelId,
        contactEmail: row.contactEmail,
        contactPhone: row.contactPhone,
        taxNumber: row.taxNumber,
        notes: row.notes,
        // Whatever the sheet said, and null when it said nothing. Never guessed
        // from a first name — that is a guess with a person's identity in it.
        gender: row.gender,
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
       * Sócio, where the sheet said so — POOLSE-42.
       *
       * A second statement rather than a column on `insertStudent`, because
       * membership is not part of creating a student: it is a fact about them
       * that a file may or may not carry, and threading it through the shared
       * create path would put it on the form's shoulders too.
       */
      if (created !== null && (row.isSocio || row.socioNumber !== null)) {
        await tx.query(
          `UPDATE student SET is_socio = $2, socio_number = $3 WHERE id = $1`,
          [created, row.isSocio, row.socioNumber],
        );
      }

      /*
       * "Pago", where the sheet said so — round 5.
       *
       * A newly created student has no mensalidade to settle: there is no
       * enrolment yet, and inventing a price from a level name would be
       * inventing the club's price list. So the fact is stored as what the file
       * claimed — paid up to this month — and the register reads it for students
       * who have no fee line. The moment one exists, the line and its payments
       * are the better answer and this stops being read.
       */
      if (created !== null && row.isPaid) {
        await tx.query(
          `UPDATE student SET paid_through_month = date_trunc('month', current_date)::date
            WHERE id = $1`,
          [created],
        );
      }

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
     * Filling in the blanks on students who were already here.
     *
     * After the creations, so a level this file introduced exists by the time a
     * matched student is pointed at it. Every write is a blank being filled —
     * `fillStudentBlanks` refuses to overwrite — so the worst an update can do
     * is nothing.
     */
    let updated = 0;
    for (const row of toUpdate) {
      const studentId = row.duplicate?.studentId;
      if (studentId === undefined) continue;

      const levelName = row.updates.find((update) => update.field === 'levelId')?.value ?? null;
      const levelId =
        levelName === null
          ? null
          : (levels.find((level) => normaliseKey(level.name) === normaliseKey(levelName))?.id ??
            createdLevels.get(normaliseKey(levelName)) ??
            null);

      /*
       * The same two facts for a student who was already here.
       *
       * Both are written outright rather than filled in like the rest: they are
       * this month's answer to a question that changes every month, so a blank
       * on the record is not a fact worth protecting. Where the student has a
       * real fee line, the current occurrence is settled properly as well — the
       * spreadsheet and the ledger then say the same thing.
       */
      if (row.isPaid) {
        await tx.query(
          `UPDATE student SET paid_through_month = date_trunc('month', current_date)::date
            WHERE id = $1`,
          [studentId],
        );

        await tx.query(
          `INSERT INTO student_fee_payment (organization_id, student_fee_id, period_start)
           SELECT $1, sf.id, cur.period_start
             FROM student_fee sf
             JOIN fee_period fp ON fp.id = sf.fee_period_id
             CROSS JOIN LATERAL (
               SELECT current_period_start(sf.starts_on, sf.ends_on, fp.months) AS period_start
             ) cur
            WHERE sf.student_id = $2 AND sf.archived_at IS NULL
              AND cur.period_start IS NOT NULL
           ON CONFLICT (student_fee_id, period_start) DO NOTHING`,
          [organizationId, studentId],
        );
      }

      if (row.gender !== null) {
        // Filled in, never overwritten — the record is the better source once
        // somebody has answered it there.
        await tx.query(
          `UPDATE student SET gender = coalesce(gender, $2::student_gender) WHERE id = $1`,
          [studentId, row.gender],
        );
      }

      const filled = await fillStudentBlanks(tx, studentId, {
        birthDate: row.updates.find((update) => update.field === 'birthDate')?.value ?? null,
        levelId,
        contactEmail:
          row.updates.find((update) => update.field === 'contactEmail')?.value ?? null,
        contactPhone:
          row.updates.find((update) => update.field === 'contactPhone')?.value ?? null,
        taxNumber: row.updates.find((update) => update.field === 'taxNumber')?.value ?? null,
        notes: row.updates.find((update) => update.field === 'notes')?.value ?? null,
      });
      if (filled) updated += 1;
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
        created: toCreate.length,
        updated,
        total: summary.total,
        refused: summary.refused,
        skipped: summary.importable - chosen.length,
        // A file that quietly added four levels to the club's programme is
        // exactly the kind of thing somebody asks about in six months.
        levelsCreated: [...createdLevels.keys()].length,
        levelNames: [...wanted.values()],
      },
    });

    return {
      rows,
      summary,
      created: toCreate.length,
      updated,
      skipped: summary.importable - chosen.length,
      levelsCreated: [...wanted.values()],
    };
  });
}
