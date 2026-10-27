import { withOrg, type Tx } from '@poolse/db';
import { recordAudit } from '../audit/audit.js';
import { TOTAL_COUNT, windowed, type PageQuery, type Paginated } from '../common/pagination.js';

/**
 * Messages to families — POOLSE-67.
 *
 * **Who a message reaches is one SQL function, `message_recipients()`**, read by
 * the preview and by the send. The count somebody confirmed in the dialog and the
 * rows written afterwards come from the same query, so they cannot disagree about
 * what "the families of Cadetes" means — deduplicating in TypeScript after
 * counting in SQL is the bug this arrangement exists to make impossible.
 *
 * **The send is one statement.** The message, its address count and its
 * recipient rows are written by a single data-modifying CTE over one call of that
 * function, so they share one snapshot: an enrolment committed by somebody else
 * between two statements cannot make the stored count disagree with the rows.
 * The database checks that agreement anyway, at commit.
 *
 * **Email leaves after the commit**, in `deliverMessage`, and can never undo the
 * record. A row whose `delivered_at` is null was recorded and not sent, and the
 * screens say so.
 */

/**
 * `closure` (12 October 2026) is the families of turmas a closure took a lesson
 * from. It is written from the closure itself, never offered in the composer.
 */
export type MessageAudience = 'class_group' | 'level' | 'facility' | 'organization' | 'closure' | 'session';

/**
 * What a person may address a message to. `session` is not here: a cancellation
 * notice is written by Poolse when a lesson is cancelled (POOLSE-90 slice 4),
 * through `sendSessionNoticeIn`, never composed by hand.
 */
export const MESSAGE_AUDIENCES: readonly MessageAudience[] = [
  'class_group',
  'level',
  'facility',
  'organization',
  'closure',
];

/** What a message is addressed to. `targetId` is null only for the whole club. */
export interface MessageTarget {
  audience: MessageAudience;
  targetId: string | null;
}

/**
 * Who a message is written *for*. A student's family, and — only on a closure's
 * warning, POOLSE-84 — a partner (through its contacts) or a trial lead.
 */
export type RecipientKind = 'student' | 'partner' | 'lead';

export interface UnreachableStudent {
  /** The student's, partner's or lead's id, by `kind`. */
  studentId: string;
  name: string;
  kind: RecipientKind;
}

export interface MessagePreview {
  /** Students the audience reaches, whether or not anybody can be written to. */
  studentCount: number;
  /** Partners a closure's warning reaches — POOLSE-84. Zero for every other audience. */
  partnerCount: number;
  /** Trial leads a closure's warning reaches — POOLSE-84. */
  leadCount: number;
  /** Distinct addresses — what will actually be sent, and what the ceiling counts. */
  addressCount: number;
  /** Addresses left out because they opted out of club messages — POOLSE-86. Never on a closure. */
  optedOutCount: number;
  /** Named, never only counted: "3 alunos sem contacto" is something a club acts on. */
  unreachable: UnreachableStudent[];
}

export interface MessageSummary {
  id: string;
  audience: MessageAudience;
  targetId: string | null;
  /** The turma's, level's or site's own name; null for the whole club. */
  targetName: string | null;
  subject: string;
  sentAt: string;
  sentByName: string | null;
  addressCount: number;
  deliveredCount: number;
  unreachableCount: number;
}

export interface MessageRecipient {
  /** The student's name — or the partner's, or the trial swimmer's, by `kind`. */
  studentName: string;
  name: string;
  /** True when this row is a guardian; false is the student themselves. */
  isGuardian: boolean;
  kind: RecipientKind;
  email: string | null;
  deliveredAt: string | null;
}

export interface MessageDetail extends MessageSummary {
  body: string;
  recipients: MessageRecipient[];
}

export interface AudienceOption {
  id: string;
  name: string;
  /** A turma's site and season, so two "Cadetes" in two years can be told apart. */
  detail: string | null;
}

export interface AudienceOptions {
  classGroups: AudienceOption[];
  levels: AudienceOption[];
  facilities: AudienceOption[];
}

/** The send would cross the daily ceiling. The figures come from the database. */
export interface QuotaRefusal {
  kind: 'messages' | 'addresses';
  limit: number;
  used: number;
  requested: number;
}

/** Read `message_quota|<kind>|<limit>|<used>|<requested>` off a pg error. */
export function quotaRefusal(error: unknown): QuotaRefusal | null {
  const detail = (error as { detail?: unknown }).detail;
  if (typeof detail !== 'string' || !detail.startsWith('message_quota|')) return null;

  const [, kind, limit, used, requested] = detail.split('|');
  if (kind !== 'messages' && kind !== 'addresses') return null;
  const figures = [limit, used, requested].map(Number);
  if (figures.some((n) => !Number.isFinite(n))) return null;

  return { kind, limit: figures[0]!, used: figures[1]!, requested: figures[2]! };
}

/** The five columns `message_recipients()` takes after the organization. */
function targetParams(
  target: MessageTarget,
): [string, string | null, string | null, string | null, string | null] {
  return [
    target.audience,
    target.audience === 'class_group' ? target.targetId : null,
    target.audience === 'level' ? target.targetId : null,
    target.audience === 'facility' ? target.targetId : null,
    target.audience === 'closure' ? target.targetId : null,
  ];
}

/**
 * Does the target exist in this club?
 *
 * Asked before a preview, because a turma id from another club resolves to
 * nobody rather than to an error — RLS hides it — and "this message reaches 0
 * people" is the wrong answer to a target that is not there. A 404 is the right
 * one. The send would be refused by the composite key regardless.
 */
export async function targetExists(organizationId: string, target: MessageTarget): Promise<boolean> {
  if (target.audience === 'organization') return true;
  const table =
    target.audience === 'class_group'
      ? 'class_group'
      : target.audience === 'level'
        ? 'student_level'
        : target.audience === 'closure'
          ? 'closure'
          : 'facility';

  return withOrg(organizationId, async (tx) => {
    const { rowCount } = await tx.query(
      `SELECT 1 FROM ${table} WHERE id = $1 AND archived_at IS NULL`,
      [target.targetId],
    );
    return (rowCount ?? 0) > 0;
  });
}

/**
 * Who a message is written to, out of `everyone` the audience names — POOLSE-86.
 * An address that opted out is left out, and so is a no-address row beside it:
 * that family chose to stop and is not "sem contacto". Read by the preview and
 * the send alike, so the count confirmed is the count written.
 */
const REACHED = `SELECT * FROM everyone e
  WHERE NOT e.opted_out
    AND NOT (e.email IS NULL AND EXISTS (
      SELECT 1 FROM everyone o
       WHERE o.opted_out
         AND coalesce(o.student_id, o.partner_id, o.lead_id)
           = coalesce(e.student_id, e.partner_id, e.lead_id)))`;

export async function previewMessage(
  organizationId: string,
  target: MessageTarget,
): Promise<MessagePreview> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      student_count: number;
      partner_count: number;
      lead_count: number;
      address_count: number;
      opted_out_count: number;
      unreachable: UnreachableStudent[] | null;
    }>(
      `WITH everyone AS (SELECT * FROM message_recipients($1, $2::message_audience, $3, $4, $5, $6)),
            -- Who is written to: REACHED, above, shared by the preview and the send.
            r AS (${REACHED}),
            -- One row per person written *for*: a student, a partner or a lead —
            -- everyone the audience names, so an opted-out family still counts as
            -- a student, and "unreachable" means no address on file at all.
            per_subject AS (
              SELECT coalesce(student_id, partner_id, lead_id) AS subject_id,
                     CASE WHEN partner_id IS NOT NULL THEN 'partner'
                          WHEN lead_id IS NOT NULL THEN 'lead'
                          ELSE 'student' END AS kind,
                     min(student_name) AS student_name,
                     bool_or(email IS NOT NULL) AS reachable
                FROM everyone GROUP BY 1, 2
            )
       SELECT (SELECT count(*) FROM per_subject WHERE kind = 'student')::int AS student_count,
              (SELECT count(*) FROM per_subject WHERE kind = 'partner')::int AS partner_count,
              (SELECT count(*) FROM per_subject WHERE kind = 'lead')::int AS lead_count,
              (SELECT count(DISTINCT email) FROM r WHERE email IS NOT NULL)::int AS address_count,
              (SELECT count(DISTINCT email) FROM everyone WHERE opted_out)::int AS opted_out_count,
              (SELECT json_agg(json_build_object('studentId', subject_id, 'name', student_name,
                                                 'kind', kind)
                               ORDER BY student_name)
                 FROM per_subject WHERE NOT reachable) AS unreachable`,
      [organizationId, ...targetParams(target)],
    );
    const row = rows[0]!;
    return {
      studentCount: row.student_count,
      partnerCount: row.partner_count,
      leadCount: row.lead_count,
      addressCount: row.address_count,
      optedOutCount: row.opted_out_count,
      unreachable: row.unreachable ?? [],
    };
  });
}

/** Thrown when the audience resolves to no address at all. */
export class NoRecipientsError extends Error {}

/**
 * Write the message and everybody it reaches, in one statement. Returns the id.
 *
 * Refused by the database — not here — when the daily ceiling would be crossed;
 * `quotaRefusal` reads the figures back off the error.
 */
export async function sendMessage(
  organizationId: string,
  sentByMembershipId: string,
  target: MessageTarget,
  subject: string,
  body: string,
): Promise<{ id: string; addressCount: number }> {
  return withOrg(organizationId, async (tx) => {
    const params = targetParams(target);
    return insertMessageIn(tx, organizationId, sentByMembershipId, params, params[1], null, subject, body, {
      audience: target.audience,
      targetId: target.targetId,
    });
  });
}

/**
 * A cancelled lesson's notice — POOLSE-90 slice 4, written by Poolse inside the
 * cancelling transaction. Recipients are the lesson's turma's families
 * (`message_recipients()`'s `session` branch); the row names the lesson. Exempt
 * from the daily ceiling and from the opt-out, by the database. Throws
 * `NoRecipientsError` when nobody is reachable — the caller ignores it.
 */
export async function sendSessionNoticeIn(
  tx: Tx,
  organizationId: string,
  sentByMembershipId: string,
  sessionId: string,
  classGroupId: string,
  subject: string,
  body: string,
): Promise<{ id: string; addressCount: number }> {
  return insertMessageIn(
    tx,
    organizationId,
    sentByMembershipId,
    ['session', classGroupId, null, null, null],
    null,
    sessionId,
    subject,
    body,
    { audience: 'session', targetId: sessionId },
  );
}

async function insertMessageIn(
  tx: Tx,
  organizationId: string,
  sentByMembershipId: string,
  recipientParams: [string, string | null, string | null, string | null, string | null],
  rowClassGroupId: string | null,
  rowSessionId: string | null,
  subject: string,
  body: string,
  audit: { audience: MessageAudience; targetId: string | null },
): Promise<{ id: string; addressCount: number }> {
  {
    const { rows } = await tx.query<{ id: string | null; address_count: number }>(
      `WITH everyone AS (SELECT * FROM message_recipients($1, $2::message_audience, $3, $4, $5, $6)),
            -- Who is written to: REACHED, above, shared by the preview and the send.
            r AS (${REACHED}),
            n AS (SELECT count(DISTINCT email)::int AS address_count FROM r WHERE email IS NOT NULL),
            m AS (
              INSERT INTO message (organization_id, audience, class_group_id, level_id,
                                   facility_id, closure_id, class_session_id, subject, body,
                                   sent_by_membership_id, address_count)
              SELECT $1, $2::message_audience, $10, $4, $5, $6, $11, $7, $8, $9, n.address_count
                FROM n
               WHERE n.address_count > 0
              RETURNING id, address_count
            ),
            ins AS (
              INSERT INTO message_recipient (organization_id, message_id, student_id,
                                             guardian_membership_id, student_name, name, email,
                                             partner_id, lead_id)
              SELECT $1, m.id, r.student_id, r.guardian_membership_id, r.student_name,
                     r.name, r.email, r.partner_id, r.lead_id
                FROM r CROSS JOIN m
              RETURNING 1
            ),
            -- POOLSE-86: the opt-out link's token for every address a general message
            -- reaches, made here in the send's own transaction so delivery only reads.
            tok AS (
              INSERT INTO email_preference (organization_id, email, token)
              SELECT DISTINCT ON (r.email) $1, r.email,
                     replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
                FROM r CROSS JOIN m
               WHERE r.email IS NOT NULL AND $2::message_audience NOT IN ('closure', 'session')
              ON CONFLICT (organization_id, email) DO NOTHING
              RETURNING 1
            )
       SELECT m.id, n.address_count
         FROM n LEFT JOIN m ON true
        -- Forces the recipient insert to run; a CTE nobody reads still runs, but
        -- saying so costs nothing.
        CROSS JOIN (SELECT count(*) FROM ins) AS written
        CROSS JOIN (SELECT count(*) FROM tok) AS tokens`,
      [organizationId, ...recipientParams, subject, body, sentByMembershipId, rowClassGroupId, rowSessionId],
    );

    const row = rows[0]!;
    if (row.id === null) throw new NoRecipientsError();

    await recordAudit(tx, {
      action: 'message.sent',
      entityType: 'message',
      entityId: row.id,
      data: { audience: audit.audience, targetId: audit.targetId, addressCount: row.address_count },
    });

    return { id: row.id, addressCount: row.address_count };
  }
}

interface SummaryRow {
  total_count: number;
  id: string;
  audience: MessageAudience;
  target_id: string | null;
  target_name: string | null;
  subject: string;
  sent_at: Date;
  sent_by_name: string | null;
  address_count: number;
  delivered_count: number;
  unreachable_count: number;
}

const SUMMARY_COLUMNS = `
  m.id, m.audience,
  coalesce(m.class_group_id, m.level_id, m.facility_id, m.closure_id, m.class_session_id) AS target_id,
  coalesce(cg.name, lv.name, f.name, cl.reason, scg.name) AS target_name,
  m.subject, m.sent_at,
  person_name(m.sent_by_membership_id) AS sent_by_name,
  m.address_count,
  (SELECT count(DISTINCT mr.email)::int FROM message_recipient mr
    WHERE mr.message_id = m.id AND mr.organization_id = m.organization_id
      AND mr.delivered_at IS NOT NULL) AS delivered_count,
  (SELECT count(*)::int FROM (
     SELECT coalesce(mr.student_id, mr.partner_id, mr.lead_id) FROM message_recipient mr
      WHERE mr.message_id = m.id AND mr.organization_id = m.organization_id
      GROUP BY 1 HAVING bool_and(mr.email IS NULL)) u) AS unreachable_count`;

const SUMMARY_JOINS = `
  LEFT JOIN class_group cg ON cg.id = m.class_group_id AND cg.organization_id = m.organization_id
  LEFT JOIN student_level lv ON lv.id = m.level_id AND lv.organization_id = m.organization_id
  LEFT JOIN facility f ON f.id = m.facility_id AND f.organization_id = m.organization_id
  LEFT JOIN closure cl ON cl.id = m.closure_id AND cl.organization_id = m.organization_id
  -- A cancellation notice is named by its lesson's turma (POOLSE-90 slice 4).
  LEFT JOIN class_session ms ON ms.id = m.class_session_id AND ms.organization_id = m.organization_id
  LEFT JOIN class_group scg ON scg.id = ms.class_group_id AND scg.organization_id = ms.organization_id`;

function toSummary(row: Omit<SummaryRow, 'total_count'>): MessageSummary {
  return {
    id: row.id,
    audience: row.audience,
    targetId: row.target_id,
    targetName: row.target_name,
    subject: row.subject,
    sentAt: row.sent_at.toISOString(),
    sentByName: row.sent_by_name,
    addressCount: row.address_count,
    deliveredCount: row.delivered_count,
    unreachableCount: row.unreachable_count,
  };
}

/**
 * The history, newest first.
 *
 * `turmaIds` null means every message (owner, admin). A list means an instructor,
 * who sees messages addressed to those turmas — the office's included, so they
 * know the families were told — and nothing else. The scope is in the statement
 * that carries the window, never applied to the page afterwards.
 */
export async function listMessages(
  organizationId: string,
  page: PageQuery,
  turmaIds: string[] | null,
): Promise<Paginated<MessageSummary>> {
  return withOrg(organizationId, (tx) =>
    windowed(
      page,
      (limit, offset) =>
        tx.query<SummaryRow>(
          `SELECT ${SUMMARY_COLUMNS}, ${TOTAL_COUNT}
             FROM message m
             ${SUMMARY_JOINS}
            WHERE m.archived_at IS NULL
              AND ($1::uuid[] IS NULL OR m.class_group_id = ANY($1::uuid[]))
            ORDER BY m.sent_at DESC, m.id
            LIMIT $2 OFFSET $3`,
          [turmaIds, limit, offset],
        ),
      (row: SummaryRow) => toSummary(row),
    ),
  );
}

/** One message and everybody it was written to. Null when absent or out of scope. */
export async function getMessage(
  organizationId: string,
  messageId: string,
  turmaIds: string[] | null,
): Promise<MessageDetail | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<Omit<SummaryRow, 'total_count'> & { body: string }>(
      `SELECT ${SUMMARY_COLUMNS}, m.body
         FROM message m
         ${SUMMARY_JOINS}
        WHERE m.id = $1
          AND m.archived_at IS NULL
          AND ($2::uuid[] IS NULL OR m.class_group_id = ANY($2::uuid[]))`,
      [messageId, turmaIds],
    );
    const row = rows[0];
    if (!row) return null;

    const recipients = await tx.query<{
      student_name: string;
      name: string;
      is_guardian: boolean;
      kind: RecipientKind;
      email: string | null;
      delivered_at: Date | null;
    }>(
      `SELECT student_name, name, guardian_membership_id IS NOT NULL AS is_guardian,
              CASE WHEN partner_id IS NOT NULL THEN 'partner'
                   WHEN lead_id IS NOT NULL THEN 'lead'
                   ELSE 'student' END AS kind,
              email::text AS email, delivered_at
         FROM message_recipient
        WHERE message_id = $1
        ORDER BY student_name, guardian_membership_id IS NULL, name`,
      [messageId],
    );

    return {
      ...toSummary(row),
      body: row.body,
      recipients: recipients.rows.map((r) => ({
        studentName: r.student_name,
        name: r.name,
        isGuardian: r.is_guardian,
        kind: r.kind,
        email: r.email,
        deliveredAt: r.delivered_at === null ? null : r.delivered_at.toISOString(),
      })),
    };
  });
}

export async function archiveMessage(organizationId: string, messageId: string): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `UPDATE message SET archived_at = now()
        WHERE id = $1 AND archived_at IS NULL
      RETURNING id`,
      [messageId],
    );
    if (!rows[0]) return false;

    await recordAudit(tx, {
      action: 'message.archived',
      entityType: 'message',
      entityId: messageId,
      data: {},
    });
    return true;
  });
}

/**
 * What the composer can address, for this reader.
 *
 * Whole lists, as every picker in this product is. `turmaIds` narrows the turmas
 * to an instructor's own and empties the other three, because an instructor may
 * write to their turmas and nothing else.
 */
export async function listAudienceOptions(
  organizationId: string,
  turmaIds: string[] | null,
): Promise<AudienceOptions> {
  return withOrg(organizationId, async (tx) => {
    const groups = await tx.query<{ id: string; name: string; detail: string | null }>(
      `SELECT cg.id, cg.name,
              nullif(concat_ws(' · ', f.name, se.name), '') AS detail
         FROM class_group cg
         LEFT JOIN facility f ON f.id = cg.facility_id AND f.organization_id = cg.organization_id
         LEFT JOIN season se ON se.id = cg.season_id AND se.organization_id = cg.organization_id
        WHERE cg.archived_at IS NULL
          AND (se.id IS NULL OR se.status <> 'archived')
          AND ($1::uuid[] IS NULL OR cg.id = ANY($1::uuid[]))
        ORDER BY cg.name, f.name, se.starts_on DESC`,
      [turmaIds],
    );

    if (turmaIds !== null) {
      return { classGroups: groups.rows, levels: [], facilities: [] };
    }

    const levels = await tx.query<AudienceOption>(
      `SELECT id, name, NULL AS detail FROM student_level
        WHERE archived_at IS NULL ORDER BY sort_order, name`,
    );
    const facilities = await tx.query<AudienceOption>(
      `SELECT id, name, NULL AS detail FROM facility
        WHERE archived_at IS NULL ORDER BY name`,
    );

    return { classGroups: groups.rows, levels: levels.rows, facilities: facilities.rows };
  });
}

/** What `deliverMessage` needs to write the emails. */
export interface MessageDelivery {
  subject: string;
  body: string;
  organizationName: string;
  organizationLocale: string;
  /** Distinct addresses not yet delivered to. */
  pending: string[];
  /** Each pending address's opt-out token, where it has one — POOLSE-86. */
  tokens: Record<string, string>;
  /** A closure warning carries no opt-out link: it always goes — POOLSE-86. */
  optOutAllowed: boolean;
}

export async function findDelivery(
  organizationId: string,
  messageId: string,
): Promise<MessageDelivery | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{
      subject: string;
      body: string;
      organization_name: string;
      organization_locale: string;
      pending: string[] | null;
      tokens: Record<string, string> | null;
      audience: string;
    }>(
      `SELECT m.subject, m.body, o.name AS organization_name, o.locale AS organization_locale,
              m.audience::text AS audience,
              -- The opt-out tokens the send made, in this one read (sweep 19-10b).
              (SELECT jsonb_object_agg(ep.email::text, ep.token)
                 FROM email_preference ep
                WHERE ep.organization_id = m.organization_id
                  AND ep.email IN (SELECT mr.email FROM message_recipient mr
                                    WHERE mr.message_id = m.id AND mr.organization_id = m.organization_id
                                      AND mr.email IS NOT NULL AND mr.delivered_at IS NULL)) AS tokens,
              -- DISTINCT on the citext itself, then cast: on text, Ana@x.pt and
              -- ana@x.pt were two emails to one person (13-10-2026 sweep).
              (SELECT array_agg(d.email::text)
                 FROM (SELECT DISTINCT mr.email
                         FROM message_recipient mr
                        WHERE mr.message_id = m.id AND mr.organization_id = m.organization_id
                          AND mr.email IS NOT NULL AND mr.delivered_at IS NULL) d) AS pending
         FROM message m
         JOIN organization o ON o.id = m.organization_id
        WHERE m.id = $1`,
      [messageId],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      subject: row.subject,
      body: row.body,
      organizationName: row.organization_name,
      organizationLocale: row.organization_locale,
      pending: row.pending ?? [],
      optOutAllowed: row.audience !== 'closure',
      tokens: row.tokens ?? {},
    };
  });
}

/** Stamp every row written to `email` — two siblings' rows share one send. */
export async function markDelivered(
  organizationId: string,
  messageId: string,
  email: string,
): Promise<void> {
  await withOrg(organizationId, async (tx) => {
    await tx.query(
      `UPDATE message_recipient SET delivered_at = now()
        WHERE message_id = $1 AND email = $2::citext AND delivered_at IS NULL`,
      [messageId, email],
    );
  });
}
