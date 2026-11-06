import { withOrg, type Tx } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';

/**
 * A medical exam scheduled, before it happens — POOLSE-192 (Rui, 06-11-2026).
 *
 * *Marcado para* or *fazer até*, at most one open per student: a change is a
 * cancel and a new one, so a reminder already sent never quietly means another
 * date. **Health data:** the API serves it to owner and admin alone, and the log
 * names it and never its date or place. A warning, never a gate: nothing else in
 * the product reads it.
 */

export type ScheduleKind = 'appointment' | 'deadline';
export const SCHEDULE_KINDS: readonly ScheduleKind[] = ['appointment', 'deadline'];

export interface ExamSchedule {
  id: string;
  kind: ScheduleKind;
  dueOn: string;
  dueTime: string | null;
  place: string | null;
  note: string | null;
  /** The date has gone by and no exam is recorded: *Por registar*. */
  overdue: boolean;
  /** The aviso's last day, while it is still live in the app. */
  avisoUntil: string | null;
  reminded: boolean;
  /** The day after the date: the last an aviso may show (rule 5). */
  avisoLastDay: string;
}

export interface ScheduleInput {
  kind: ScheduleKind;
  dueOn: string;
  dueTime: string | null;
  place: string | null;
  note: string | null;
}

/** The one open schedule, or null. */
export async function readOpenSchedule(organizationId: string, studentId: string): Promise<ExamSchedule | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      id: string;
      kind: ScheduleKind;
      due_on: string;
      due_time: string | null;
      place: string | null;
      note: string | null;
      overdue: boolean;
      aviso_until: string | null;
      reminded: boolean;
      aviso_last_day: string;
    }>(
      `SELECT x.id, x.kind::text AS kind, x.due_on::text AS due_on, to_char(x.due_time, 'HH24:MI') AS due_time,
              x.place, x.note, x.due_on < club_today() AS overdue,
              x.aviso_message_id IS NOT NULL AS reminded,
              (x.due_on + 1)::text AS aviso_last_day,
              (SELECT m.shown_until::text FROM message m
                WHERE m.id = x.aviso_message_id AND m.organization_id = x.organization_id
                  AND m.archived_at IS NULL AND m.shown_until >= club_today()) AS aviso_until
         FROM medical_exam_schedule x
        WHERE x.student_id = $1 AND x.archived_at IS NULL AND x.recorded_exam_id IS NULL`,
      [studentId],
    );
    const row = rows[0];
    if (row === undefined) return null;
    return {
      id: row.id,
      kind: row.kind,
      dueOn: row.due_on,
      dueTime: row.due_time,
      place: row.place,
      note: row.note,
      overdue: row.overdue,
      avisoUntil: row.aviso_until,
      reminded: row.reminded,
      avisoLastDay: row.aviso_last_day,
    };
  });
}

/** Null when the student is not this club's; `taken` when one is already open. */
export async function createSchedule(
  organizationId: string,
  membershipId: string | null,
  studentId: string,
  input: ScheduleInput,
): Promise<{ id: string } | 'not_found' | 'taken' | 'past'> {
  return withOrg(organizationId, async (tx) => {
    const student = await tx.query<{ today: string }>(
      `SELECT club_today()::text AS today FROM student WHERE id = $1 AND archived_at IS NULL`,
      [studentId],
    );
    const today = student.rows[0]?.today;
    if (today === undefined) return 'not_found';
    if (input.dueOn < today) return 'past';
    // No ON CONFLICT error: a second open one is an answer, not a failure.
    const { rows } = await tx.query<{ id: string }>(
      `INSERT INTO medical_exam_schedule (organization_id, student_id, kind, due_on, due_time, place, note, created_by)
       VALUES ($1, $2, $3::medical_exam_schedule_kind, $4::date, $5::time, $6, $7, $8)
       ON CONFLICT (organization_id, student_id) WHERE archived_at IS NULL AND recorded_exam_id IS NULL DO NOTHING
       RETURNING id`,
      [organizationId, studentId, input.kind, input.dueOn, input.dueTime, input.place, input.note, membershipId],
    );
    const row = rows[0];
    if (row === undefined) return 'taken';
    await recordAudit(tx, {
      action: 'student.medical_exam_scheduled',
      entityType: 'student',
      entityId: studentId,
      data: { scheduleId: row.id },
    });
    return { id: row.id };
  });
}

/** Ends the aviso a schedule raised, if it is still up. */
async function endAvisoIn(tx: Tx, scheduleId: string): Promise<void> {
  await tx.query(
    `UPDATE message SET archived_at = now()
      WHERE archived_at IS NULL
        AND id = (SELECT aviso_message_id FROM medical_exam_schedule WHERE id = $1)`,
    [scheduleId],
  );
}

export async function cancelSchedule(organizationId: string, studentId: string, scheduleId: string): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rowCount } = await tx.query(
      `UPDATE medical_exam_schedule SET archived_at = now()
        WHERE id = $1 AND student_id = $2 AND archived_at IS NULL AND recorded_exam_id IS NULL`,
      [scheduleId, studentId],
    );
    if ((rowCount ?? 0) === 0) return false;
    await endAvisoIn(tx, scheduleId);
    await recordAudit(tx, {
      action: 'student.medical_exam_schedule_cancelled',
      entityType: 'student',
      entityId: studentId,
      data: { scheduleId },
    });
    return true;
  });
}

/**
 * An exam was recorded: the open schedule closes and its aviso ends, in the same
 * transaction, whichever way the exam arrived (`insertExamIn`, POOLSE-192 rule 6).
 */
export async function closeScheduleIn(tx: Tx, studentId: string, examId: string): Promise<void> {
  const { rows } = await tx.query<{ id: string }>(
    `UPDATE medical_exam_schedule SET recorded_exam_id = $2
      WHERE student_id = $1 AND archived_at IS NULL AND recorded_exam_id IS NULL
      RETURNING id`,
    [studentId, examId],
  );
  if (rows[0] !== undefined) await endAvisoIn(tx, rows[0].id);
}

/** The open schedule's own row for a reminder: its last day, and whether an aviso exists. */
export async function linkAvisoIn(tx: Tx, scheduleId: string, avisoId: string): Promise<void> {
  await tx.query(`UPDATE medical_exam_schedule SET aviso_message_id = $2 WHERE id = $1`, [scheduleId, avisoId]);
}
