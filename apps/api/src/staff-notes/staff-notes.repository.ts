import { withOrg } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';

/**
 * The staff's post-it board — POOLSE-169 (Rui, 04-11-2026).
 *
 * Any working role pins a note every other one reads; it stays until its
 * author or the office takes it down. Written once — there is no edit, by
 * column grant — and taken down by archiving, so the bin can bring it back.
 */

export const NOTE_COLOURS = ['yellow', 'orange', 'green', 'blue'] as const;
export type NoteColour = (typeof NOTE_COLOURS)[number];

/** The most the board draws: a wall, not an archive. */
export const BOARD_LIMIT = 24;

export interface StaffNote {
  id: string;
  body: string;
  colour: NoteColour;
  createdAt: string;
  authorName: string | null;
  /** Whether this reader may take it down: their own, or the office's any. */
  canRemove: boolean;
}

/** The live notes, newest first. `office` is owner or admin, who may take any down. */
export async function listStaffNotes(
  organizationId: string,
  readerMembershipId: string,
  office: boolean,
): Promise<StaffNote[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      id: string;
      body: string;
      colour: NoteColour;
      created_at: Date;
      author_name: string | null;
      mine: boolean;
    }>(
      `SELECT n.id, n.body, n.colour, n.created_at,
              person_name(n.author_membership_id) AS author_name,
              n.author_membership_id = $1 AS mine
         FROM staff_note n
        WHERE n.archived_at IS NULL
        ORDER BY n.created_at DESC, n.id
        LIMIT $2`,
      [readerMembershipId, BOARD_LIMIT],
    );
    return rows.map((row) => ({
      id: row.id,
      body: row.body,
      colour: row.colour,
      createdAt: row.created_at.toISOString(),
      authorName: row.author_name,
      canRemove: office || row.mine,
    }));
  });
}

export async function pinStaffNote(
  organizationId: string,
  authorMembershipId: string,
  body: string,
  colour: NoteColour,
): Promise<{ id: string }> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO staff_note (organization_id, author_membership_id, body, colour)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [organizationId, authorMembershipId, body, colour],
    );
    const id = rows[0]!.id;
    // The words stay on the row: the log says that a note was pinned, not what it said.
    await recordAudit(tx, { action: 'staff_note.pinned', entityType: 'staff_note', entityId: id, data: { colour } });
    return { id };
  });
}

/**
 * Takes a note down. `onlyBy` set means a reader who is not the office, who may
 * take down only their own; another's answers `'forbidden'`. Answers the audit
 * entry's id, which is what the bin restores.
 */
export async function removeStaffNote(
  organizationId: string,
  noteId: string,
  onlyBy: string | null,
): Promise<{ archiveEntryId: string } | 'not_found' | 'forbidden'> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ author_membership_id: string; body: string }>(
      `SELECT author_membership_id, body FROM staff_note
        WHERE id = $1 AND archived_at IS NULL
        FOR UPDATE`,
      [noteId],
    );
    const row = rows[0];
    if (!row) return 'not_found';
    if (onlyBy !== null && row.author_membership_id !== onlyBy) return 'forbidden';

    await tx.query('UPDATE staff_note SET archived_at = now() WHERE id = $1', [noteId]);
    const archiveEntryId = await recordAudit(tx, {
      action: 'staff_note.archived',
      entityType: 'staff_note',
      entityId: noteId,
      // The bin names an entry by its first words.
      data: { name: row.body.length > 60 ? `${row.body.slice(0, 59)}…` : row.body },
    });
    return { archiveEntryId };
  });
}
