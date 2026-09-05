import { withOrg } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';
import { displayName, nameOrder, shortName } from '../people/names.js';

/**
 * The lost-property box — round 5, ticket 6.1.
 *
 * Its own table beside the inventory rather than a flag on it. They look alike
 * and are not: an inventory item is club property with a count, and a lost item
 * is one specific object belonging to somebody else, with a date, a status and
 * possibly a name attached. Sharing a table would put a `WHERE kind = …` on
 * every inventory query and a quantity of 1 on every lost-property row.
 */

export type LostAndFoundStatus = 'found' | 'returned';

export interface LostAndFoundItem {
  id: string;
  description: string;
  locationFound: string | null;
  foundOn: string;
  notes: string | null;
  studentId: string | null;
  /** Composed by the server, never assembled from parts by the client. */
  studentName: string | null;
  /**
   * When the student was told, or null.
   *
   * A stamp rather than a notification row: the notifications subsystem is phase
   * 3.0 and is meant to be built once. This records the same fact — when, and
   * therefore whether — and the mobile app reads it when that lands.
   */
  studentNotifiedAt: string | null;
  status: LostAndFoundStatus;
  returnedAt: string | null;
}

export interface LostAndFoundInput {
  description: string;
  locationFound: string | null;
  foundOn: string | null;
  notes: string | null;
  studentId: string | null;
}

const COLUMNS = `
  l.id, l.description, l.location_found, l.found_on, l.notes,
  l.student_id, l.student_notified_at, l.status, l.returned_at`;

interface Row {
  id: string;
  description: string;
  location_found: string | null;
  found_on: Date;
  notes: string | null;
  student_id: string | null;
  student_name: string | null;
  student_notified_at: Date | null;
  status: LostAndFoundStatus;
  returned_at: Date | null;
}

function toItem(row: Row): LostAndFoundItem {
  return {
    id: row.id,
    description: row.description,
    locationFound: row.location_found,
    // A date, and a date only. `found_on` is a `date` column precisely so this
    // never grows a time nobody entered.
    foundOn: row.found_on.toISOString().slice(0, 10),
    notes: row.notes,
    studentId: row.student_id,
    studentName: row.student_name,
    studentNotifiedAt: row.student_notified_at?.toISOString() ?? null,
    status: row.status,
    returnedAt: row.returned_at?.toISOString() ?? null,
  };
}

/**
 * A site's lost property, open items first.
 *
 * Open first because that is the list somebody is working: the returned ones are
 * history and belong under them. Within each, newest first — a towel found this
 * morning is likelier to be claimed than one from March.
 *
 * Not paginated. The bound is what a club has failed to give back, which stays
 * small precisely because this screen exists; if it ever does not, the pattern
 * to follow is `listStudents`.
 */
export async function listLostAndFound(
  organizationId: string,
  facilityId: string,
): Promise<LostAndFoundItem[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<Row>(
      `SELECT ${COLUMNS},
              ${displayName('s')} AS student_name
         FROM lost_and_found_item l
         LEFT JOIN student s
                ON s.id = l.student_id AND s.organization_id = l.organization_id
        WHERE l.facility_id = $1 AND l.archived_at IS NULL
        ORDER BY (l.status = 'returned'), l.found_on DESC, ${nameOrder('s')}`,
      [facilityId],
    );
    return rows.map(toItem);
  });
}

/** Returns null when the site does not exist in this organization. */
export async function createLostAndFound(
  organizationId: string,
  facilityId: string,
  input: LostAndFoundInput,
): Promise<string | null> {
  return withOrg(organizationId, async (tx) => {
    const facility = await tx.query(
      `SELECT id FROM facility WHERE id = $1 AND archived_at IS NULL`,
      [facilityId],
    );
    if (!facility.rows[0]) return null;

    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO lost_and_found_item
         (organization_id, facility_id, description, location_found, found_on, notes, student_id)
       VALUES ($1, $2, $3, $4, coalesce($5::date, CURRENT_DATE), $6, $7)
       RETURNING id`,
      [
        organizationId,
        facilityId,
        input.description,
        input.locationFound,
        input.foundOn,
        input.notes,
        input.studentId,
      ],
    );

    const id = rows[0]?.id;
    if (!id) throw new Error('Could not record the item');

    /*
     * Telling the student is part of recording it, not a second decision.
     *
     * Stamped here rather than by a later call, because an item that names a
     * student and has not been marked as notified is a state nobody would ever
     * mean — and a screen offering "tell them" as a separate button is a button
     * people forget. The check constraint keeps the pair honest either way.
     */
    if (input.studentId !== null) {
      await tx.query(
        `UPDATE lost_and_found_item SET student_notified_at = now() WHERE id = $1`,
        [id],
      );
    }

    await recordAudit(tx, {
      action: 'lostAndFound.recorded',
      entityType: 'lost_and_found_item',
      entityId: id,
      data: { facilityId, studentId: input.studentId },
    });

    return id;
  });
}

/**
 * Give it back.
 *
 * The status and its timestamp move together — the schema refuses one without
 * the other, so there is no code path that can leave a returned item with no
 * date on it.
 *
 * Idempotent by the `status = 'found'` guard: pressing it twice is not an error
 * worth showing anybody, and the second press must not move the date.
 */
export async function returnLostAndFound(
  organizationId: string,
  itemId: string,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rowCount } = await tx.query(
      `UPDATE lost_and_found_item
          SET status = 'returned', returned_at = now()
        WHERE id = $1 AND status = 'found' AND archived_at IS NULL`,
      [itemId],
    );
    if (rowCount === 0) return false;

    await recordAudit(tx, {
      action: 'lostAndFound.returned',
      entityType: 'lost_and_found_item',
      entityId: itemId,
    });
    return true;
  });
}

/** Soft delete, as everything an operator can see is. */
export async function archiveLostAndFound(
  organizationId: string,
  itemId: string,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rowCount } = await tx.query(
      `UPDATE lost_and_found_item SET archived_at = now()
        WHERE id = $1 AND archived_at IS NULL`,
      [itemId],
    );
    if (rowCount === 0) return false;

    await recordAudit(tx, {
      action: 'lostAndFound.archived',
      entityType: 'lost_and_found_item',
      entityId: itemId,
    });
    return true;
  });
}

/**
 * This club's students, for the picker.
 *
 * Complete, not paginated — `docs/backlog/CONVENTIONS.md` exempts a form's
 * dropdown options by name, because a half-filled `<select>` is a form that
 * silently cannot say what somebody means. The bound is a club's register.
 *
 * `shortName` rather than the full legal name: "Maria Santos" fits a dropdown
 * and "Maria Joana Ferreira Silva Santos" does not, and the picker is for
 * recognising somebody rather than for identifying them on a document.
 *
 * Not filtered by facility: `student` has no `facility_id`, and a child enrolled
 * at one site can perfectly well leave their goggles at another.
 */
export async function studentsForPicker(
  organizationId: string,
): Promise<{ id: string; name: string }[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ id: string; name: string }>(
      `SELECT s.id, ${shortName('s')} AS name
         FROM student s
        WHERE s.archived_at IS NULL
        ORDER BY ${nameOrder('s')}`,
      [],
    );
    return rows;
  });
}
