import { withOrg, type Tx } from '@poolse/db';
import { whatsappUrl } from '@poolse/rules';
import { recordAudit } from '../audit/audit.js';
import { insertAvisoIn } from './avisos.repository.js';
import { insertMessageIn, NoRecipientsError, type MessageTarget } from './messages.repository.js';

/**
 * A message to one student, from their page — POOLSE-191 (Rui, 06-11-2026).
 *
 * The same `message` and the same `message_recipients()`: guardians, else the
 * student. **Email** is a record first and leaves after the commit. **WhatsApp**
 * is a record of a link opened: a person presses send on their own phone, so the
 * row carries no address and never says delivered.
 *
 * `audience = 'student'` is on neither general list: the student's *Mensagens* tab
 * is its only reader. A `health` one is a medical exam's reminder (POOLSE-192):
 * the office's alone, so an instructor's list leaves it out.
 */

export interface StudentMessageRecipient {
  name: string;
  isGuardian: boolean;
  hasEmail: boolean;
  hasPhone: boolean;
}

export interface StudentMessage {
  id: string;
  channel: 'email' | 'app' | 'whatsapp';
  subject: string;
  body: string;
  sentAt: string;
  sentByName: string | null;
  recipients: string[];
  /** Email only: addresses written to, and how many have left. */
  addressCount: number;
  deliveredCount: number;
  /** An aviso's last day. */
  shownUntil: string | null;
}

/** The newest messages: a person's list stays short, and this keeps it so. */
const LIST_LIMIT = 50;

function target(studentId: string): MessageTarget {
  return { audience: 'student', targetId: studentId };
}

interface RecipientRow {
  name: string;
  guardian_membership_id: string | null;
  email: string | null;
  phone: string | null;
}

/** Who a message about this student reaches, with their phone. Null when absent. */
async function readRecipients(organizationId: string, studentId: string): Promise<RecipientRow[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<RecipientRow>(
      `SELECT r.name, r.guardian_membership_id, r.email::text AS email,
              nullif(btrim(CASE WHEN r.guardian_membership_id IS NOT NULL THEN person_phone(r.guardian_membership_id)
                                ELSE coalesce(person_phone(s.membership_id), s.contact_phone) END), '') AS phone
         FROM message_recipients($1, 'student', NULL, NULL, NULL, NULL, NULL, $2) r
         JOIN student s ON s.id = r.student_id AND s.organization_id = $1
        ORDER BY r.guardian_membership_id IS NULL, r.name`,
      [organizationId, studentId],
    );
    return rows;
  });
}

/** Names and whether each can be reached: an address stays on the record. */
export async function studentMessageRecipients(
  organizationId: string,
  studentId: string,
): Promise<StudentMessageRecipient[]> {
  return (await readRecipients(organizationId, studentId)).map((row) => ({
    name: row.name,
    isGuardian: row.guardian_membership_id !== null,
    hasEmail: row.email !== null,
    hasPhone: whatsappUrl(row.phone, '') !== null,
  }));
}

/** What was sent about this student. `sentBy` narrows it to one person's own. */
export async function listStudentMessages(
  organizationId: string,
  studentId: string,
  sentBy: string | null,
): Promise<StudentMessage[]> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      id: string;
      channel: StudentMessage['channel'];
      subject: string;
      body: string;
      sent_at: Date;
      sent_by_name: string | null;
      recipients: string[] | null;
      address_count: number;
      delivered_count: number;
      shown_until: string | null;
    }>(
      `SELECT m.id, m.channel::text AS channel, m.subject, m.body, m.sent_at,
              person_name(m.sent_by_membership_id) AS sent_by_name, m.address_count,
              to_char(m.shown_until, 'YYYY-MM-DD') AS shown_until,
              (SELECT array_agg(DISTINCT mr.name) FROM message_recipient mr
                WHERE mr.message_id = m.id AND mr.organization_id = m.organization_id) AS recipients,
              (SELECT count(DISTINCT mr.email)::int FROM message_recipient mr
                WHERE mr.message_id = m.id AND mr.organization_id = m.organization_id
                  AND mr.delivered_at IS NOT NULL) AS delivered_count
         FROM message m
        WHERE m.student_id = $1 AND m.audience = 'student' AND m.archived_at IS NULL
          AND ($2::uuid IS NULL OR (m.sent_by_membership_id = $2 AND NOT m.health))
        ORDER BY m.sent_at DESC, m.id
        LIMIT ${LIST_LIMIT}`,
      [studentId, sentBy],
    );
    return rows.map((row) => ({
      id: row.id,
      channel: row.channel,
      subject: row.subject,
      body: row.body,
      sentAt: row.sent_at.toISOString(),
      sentByName: row.sent_by_name,
      recipients: row.recipients ?? [],
      addressCount: row.address_count,
      deliveredCount: row.delivered_count,
      shownUntil: row.shown_until,
    }));
  });
}

/** Whether this student has an active enrolment in one of these turmas. */
export async function isInTurmas(organizationId: string, studentId: string, turmaIds: string[]): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rowCount } = await tx.query(
      `SELECT 1 FROM enrollment e
        WHERE e.student_id = $1 AND e.status = 'active' AND e.class_group_id = ANY($2::uuid[])
        LIMIT 1`,
      [studentId, turmaIds],
    );
    return (rowCount ?? 0) > 0;
  });
}

export async function studentIsLive(organizationId: string, studentId: string): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rowCount } = await tx.query('SELECT 1 FROM student WHERE id = $1 AND archived_at IS NULL', [studentId]);
    return (rowCount ?? 0) > 0;
  });
}

interface Words {
  subject: string;
  body: string;
}

export interface SendOptions {
  /** The aviso's last day, or null for none. */
  shownUntil: string | null;
  health?: boolean;
  /** Told the aviso's id, inside the transaction. */
  onAviso?: (tx: Tx, avisoId: string) => Promise<void>;
}

async function raiseAvisoIn(
  tx: Tx,
  organizationId: string,
  sentBy: string,
  studentId: string,
  words: Words,
  today: string,
  options: SendOptions,
): Promise<void> {
  if (options.shownUntil === null) return;
  const { id } = await insertAvisoIn(
    tx,
    organizationId,
    sentBy,
    target(studentId),
    words.subject,
    words.body,
    today,
    options.shownUntil,
    options.health === true,
  );
  await options.onAviso?.(tx, id);
}

/** Throws `NoRecipientsError` with no address; the aviso shares the transaction. */
export async function sendStudentEmail(
  organizationId: string,
  sentBy: string,
  studentId: string,
  words: Words,
  today: string,
  options: SendOptions,
): Promise<{ id: string }> {
  return withOrg(organizationId, async (tx) => {
    const { id } = await insertMessageIn(
      tx,
      organizationId,
      sentBy,
      ['student', null, null, null, null, null],
      null,
      null,
      words.subject,
      words.body,
      { audience: 'student', targetId: studentId },
      studentId,
      options.health === true,
    );
    await raiseAvisoIn(tx, organizationId, sentBy, studentId, words, today, options);
    return { id };
  });
}

/**
 * Records that WhatsApp was opened, and answers the links. A record first, so a
 * link never exists without one. Throws `NoRecipientsError` with no usable phone.
 */
export async function recordStudentWhatsApp(
  organizationId: string,
  sentBy: string,
  studentId: string,
  words: Words,
  today: string,
  options: SendOptions,
): Promise<{ id: string; links: { name: string; url: string }[] }> {
  const text = `${words.subject}\n\n${words.body}`;
  const people = (await readRecipients(organizationId, studentId)).flatMap((row) => {
    const url = whatsappUrl(row.phone, text);
    return url === null ? [] : [{ ...row, url }];
  });
  if (people.length === 0) throw new NoRecipientsError();

  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ id: string; student_name: string }>(
      `INSERT INTO message (organization_id, audience, student_id, subject, body,
                            sent_by_membership_id, address_count, channel, health)
       SELECT $1, 'student', s.id, $3, $4, $5, 0, 'whatsapp', $6
         FROM student s WHERE s.id = $2 AND s.archived_at IS NULL
       RETURNING id, (SELECT btrim(first_name || ' ' || last_name) FROM student WHERE id = $2) AS student_name`,
      [organizationId, studentId, words.subject, words.body, sentBy, options.health === true],
    );
    const row = rows[0];
    if (row === undefined) throw new NoRecipientsError();
    // No address: nothing is sent from here, so nothing is kept (as an aviso).
    for (const person of people) {
      await tx.query(
        `INSERT INTO message_recipient (organization_id, message_id, student_id, guardian_membership_id,
                                        student_name, name, email)
         VALUES ($1, $2, $3, $4, $5, $6, NULL)`,
        [organizationId, row.id, studentId, person.guardian_membership_id, row.student_name, person.name],
      );
    }
    await recordAudit(tx, {
      action: 'message.whatsapp_opened',
      entityType: 'message',
      entityId: row.id,
      data: { studentId, people: people.length },
    });
    await raiseAvisoIn(tx, organizationId, sentBy, studentId, words, today, options);
    return { id: row.id, links: people.map((person) => ({ name: person.name, url: person.url })) };
  });
}
