import { Logger } from '@nestjs/common';
import { withOrg, withoutTenantScope, type Tx } from '@poolse/db';
import { LENEX_MAX_BYTES, parseLenex } from '@poolse/rules/lenex';
import { recordAudit } from '../audit/audit.js';
import { TOTAL_COUNT, windowed, type PageQuery, type Paginated } from '../common/pagination.js';
import { storeFile } from '../files/files.repository.js';
import { getObjectBytes, storageConfigured } from '../files/storage.js';
import { sendEmail } from '../notifications/notifier.js';
import { noLenexReply } from '../notifications/meet-inbox-reply-email.js';
import { tenantStorage } from '../tenant/tenant.context.js';

/**
 * Results by email — POOLSE-114.
 *
 * Each club has one address, `resultados-<token>@<INBOUND_DOMAIN>`. A coach
 * forwards the email that carries a meet's LENEX file; the file lands in
 * *Recebidos por email* on the Competição page and is imported from there
 * through the ordinary dialog — a person always confirms.
 *
 * **The whole receiving path is `receiveResults`**, called by the Resend
 * webhook and by the dev endpoint alike, so staging tests the path production
 * runs. It decides, in order:
 *   1. which club — the token, through `meet_inbox_organization()`, the one
 *      read before a tenant is known (an unknown token, a closed club and a club
 *      without the competition module are one answer);
 *   2. whether this message was seen before — the provider's id, per club;
 *   3. who sent it — `From`, never `Reply-To`, matched to a live owner, admin or
 *      instructor of that club; anybody else is dropped with no reply, because
 *      a reply to a stranger is backscatter;
 *   4. what it carried — every `.lef`/`.lxf` within `LENEX_MAX_BYTES` that the
 *      parser reads and that names a meet. Everything else is ignored; an
 *      accepted sender whose message held nothing usable is told so, once.
 *
 * A drop writes nothing in the club's tables — a stranger's address has no
 * business there — and is logged with the club and the reason.
 *
 * **`From` can be forged**, as on any email. The rule keeps a stranger's junk
 * out of the list; it is not what protects the data — nothing reaches a
 * swimmer's record until a signed-in member presses *Importar* and confirms.
 */

const logger = new Logger('MeetInbox');

export const ADDRESS_PREFIX = 'resultados-';
const SENDER_ROLES = ['owner', 'admin', 'instructor'] as const;
/** A pending file older than this is tagged *antigo* (BA 5). Nothing is deleted. */
export const STALE_DAYS = 90;

export function inboundDomain(): string | null {
  const domain = (process.env['INBOUND_DOMAIN'] ?? '').trim().toLowerCase();
  return domain === '' ? null : domain;
}

export function inboxAddress(token: string): string | null {
  const domain = inboundDomain();
  return domain === null ? null : `${ADDRESS_PREFIX}${token}@${domain}`;
}

/** The bare address inside `Name <a@b>`, lowercased, or null. */
export function bareAddress(raw: string): string | null {
  const inside = /<([^<>\s]+@[^<>\s]+)>/.exec(raw)?.[1] ?? raw.trim();
  return /^[^\s@<>]+@[^\s@<>]+$/.test(inside) ? inside.toLowerCase() : null;
}

/**
 * The club tokens a message was addressed to. The domain must be ours when one
 * is configured; with none (a dev machine) any domain is accepted, because the
 * dev endpoint is how that machine tests the path.
 */
export function tokensIn(recipients: readonly string[]): string[] {
  const domain = inboundDomain();
  const tokens = new Set<string>();
  for (const raw of recipients) {
    const address = bareAddress(raw);
    if (address === null) continue;
    const match = /^resultados-([a-z0-9]{20})@(.+)$/.exec(address);
    if (match === null) continue;
    if (domain !== null && match[2] !== domain) continue;
    tokens.add(match[1]!);
  }
  return [...tokens];
}

export interface IncomingAttachment {
  filename: string;
  /** What the provider says, when it says it — checked again on the bytes. */
  size: number | null;
  load: () => Promise<Buffer>;
}

export interface IncomingMessage {
  providerMessageId: string;
  from: string;
  to: readonly string[];
  attachments: readonly IncomingAttachment[];
}

export type DropReason = 'unknown_token' | 'unknown_sender' | 'storage_off' | 'no_message_id';

export type ReceiveOutcome =
  | { status: 'dropped'; reason: DropReason; organizationId: string | null }
  | { status: 'duplicate'; organizationId: string }
  | { status: 'no_lenex'; organizationId: string; rejected: RejectedFile[] }
  | { status: 'accepted'; organizationId: string; inboxIds: string[]; rejected: RejectedFile[] };

export interface RejectedFile {
  filename: string;
  reason: 'too_big' | 'not_lenex' | 'no_meet';
}

interface Sender {
  membershipId: string;
  appUserId: string | null;
  roles: string[];
  locale: string;
  organizationName: string;
}

/** One message, every club it was addressed to. */
export async function receiveResults(message: IncomingMessage): Promise<ReceiveOutcome[]> {
  const tokens = tokensIn(message.to);
  if (tokens.length === 0) {
    logger.warn(`dropped: no club address among the recipients (reason unknown_token)`);
    return [{ status: 'dropped', reason: 'unknown_token', organizationId: null }];
  }
  const outcomes: ReceiveOutcome[] = [];
  for (const token of tokens) outcomes.push(await receiveFor(token, message));
  return outcomes;
}

async function receiveFor(token: string, message: IncomingMessage): Promise<ReceiveOutcome> {
  const organizationId = await withoutTenantScope(async (tx) => {
    const { rows } = await tx.query<{ id: string | null }>('SELECT meet_inbox_organization($1) AS id', [token]);
    return rows[0]?.id ?? null;
  });
  const sender = bareAddress(message.from);
  const drop = (reason: DropReason, org: string | null): ReceiveOutcome => {
    logger.warn(`dropped: club ${org ?? '(none)'}, sender ${sender ?? '(unreadable)'}, reason ${reason}`);
    return { status: 'dropped', reason, organizationId: org };
  };

  if (organizationId === null) return drop('unknown_token', null);
  if (message.providerMessageId.trim() === '') return drop('no_message_id', organizationId);

  const found = await withOrg(organizationId, async (tx) => {
    const { rows: seen } = await tx.query(
      `SELECT 1 FROM meet_inbox_message WHERE provider_message_id = $1`,
      [message.providerMessageId],
    );
    if (seen.length > 0) return 'duplicate' as const;
    return sender === null ? null : findSender(tx, organizationId, sender);
  });
  if (found === 'duplicate') return { status: 'duplicate', organizationId };
  if (found === null) return drop('unknown_sender', organizationId);
  if (!storageConfigured()) return drop('storage_off', organizationId);

  // What the message carried. Read one at a time — a results file is a few MB.
  const rejected: RejectedFile[] = [];
  const files: { filename: string; bytes: Buffer; meetName: string; startsOn: string }[] = [];
  for (const attachment of message.attachments) {
    const filename = attachment.filename.trim().slice(0, 200);
    if (!/\.(lef|lxf)$/i.test(filename)) continue;
    if (attachment.size !== null && attachment.size > LENEX_MAX_BYTES) {
      rejected.push({ filename, reason: 'too_big' });
      continue;
    }
    const bytes = await attachment.load();
    if (bytes.length === 0) {
      rejected.push({ filename, reason: 'not_lenex' });
      continue;
    }
    if (bytes.length > LENEX_MAX_BYTES) {
      rejected.push({ filename, reason: 'too_big' });
      continue;
    }
    let meetName: string;
    let startsOn: string | null;
    try {
      const parsed = parseLenex(new Uint8Array(bytes));
      meetName = parsed.meet.name.trim().slice(0, 200);
      startsOn = parsed.meet.startsOn;
    } catch {
      rejected.push({ filename, reason: 'not_lenex' });
      continue;
    }
    if (meetName === '' || startsOn === null) {
      rejected.push({ filename, reason: 'no_meet' });
      continue;
    }
    files.push({ filename, bytes, meetName, startsOn });
  }
  for (const file of rejected) {
    logger.warn(`rejected attachment: club ${organizationId}, file ${file.filename}, reason ${file.reason}`);
  }

  // The work is done as the sender — the stored file and the audit entry name
  // them, as an upload from the page would.
  const outcome = await tenantStorage.run(
    { organizationId, membershipId: found.membershipId, appUserId: found.appUserId ?? '', roles: found.roles },
    async () => {
      const stored: { fileId: string; filename: string; meetName: string; startsOn: string }[] = [];
      for (const file of files) {
        // A `.lxf` is a zip; a `.lef` is the XML — judged by the bytes, not the name.
        const zip = file.bytes.length >= 4 && file.bytes.readUInt32LE(0) === 0x04034b50;
        const record = await storeFile(
          organizationId,
          'meet_results',
          file.bytes,
          zip ? 'application/zip' : 'application/xml',
          file.filename,
        );
        stored.push({ fileId: record.id, filename: file.filename, meetName: file.meetName, startsOn: file.startsOn });
      }

      return withOrg(organizationId, async (tx) => {
        const { rows } = await tx.query<{ id: string }>(
          `INSERT INTO meet_inbox_message (organization_id, provider_message_id, sender_membership_id,
                                           received_from, file_count)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (organization_id, provider_message_id) DO NOTHING
           RETURNING id`,
          [organizationId, message.providerMessageId, found.membershipId, sender, stored.length],
        );
        // A second delivery racing the first: it wrote its files, and lost.
        if (rows.length === 0) return { status: 'duplicate' as const, organizationId };
        const messageId = rows[0]!.id;

        const inboxIds: string[] = [];
        for (const file of stored) {
          const { rows: inserted } = await tx.query<{ id: string }>(
            `INSERT INTO meet_inbox (organization_id, message_id, file_id, file_name, meet_name, meet_starts_on)
             VALUES ($1, $2, $3, $4, $5, $6::date)
             RETURNING id`,
            [organizationId, messageId, file.fileId, file.filename, file.meetName, file.startsOn],
          );
          inboxIds.push(inserted[0]!.id);
        }
        if (inboxIds.length === 0) return { status: 'no_lenex' as const, organizationId, rejected };

        await recordAudit(tx, {
          action: 'meet_inbox.received',
          entityType: 'meet_inbox_message',
          entityId: messageId,
          data: { files: stored.map((file) => file.filename), rejected: rejected.length },
        });
        return { status: 'accepted' as const, organizationId, inboxIds, rejected };
      });
    },
  );

  if (outcome.status === 'no_lenex' && sender !== null) {
    // After the commit, once — the message row is what makes it once.
    await sendEmail(noLenexReply({ to: sender, organizationName: found.organizationName, locale: found.locale }));
  }
  if (outcome.status === 'accepted') {
    logger.log(`accepted: club ${organizationId}, ${outcome.inboxIds.length} file(s)`);
  }
  return outcome;
}

async function findSender(tx: Tx, organizationId: string, address: string): Promise<Sender | null> {
  const { rows } = await tx.query<{
    membership_id: string;
    app_user_id: string | null;
    roles: string[];
    locale: string;
    organization_name: string;
  }>(
    `SELECT m.id AS membership_id, m.app_user_id,
            array_agg(DISTINCT r.role::text ORDER BY r.role::text) AS roles,
            coalesce(u.locale, o.locale) AS locale, o.name AS organization_name
       FROM membership m
       JOIN membership_role r
         ON r.membership_id = m.id AND r.organization_id = m.organization_id
       JOIN organization o ON o.id = m.organization_id
       LEFT JOIN app_user u ON u.id = m.app_user_id
      WHERE m.organization_id = $1
        AND m.archived_at IS NULL
        AND m.status = 'active'
        AND r.archived_at IS NULL
        AND r.role::text = ANY ($3::text[])
        AND lower(coalesce(u.cached_email::text, m.email::text, '')) = $2
      GROUP BY m.id, m.app_user_id, u.locale, o.locale, o.name
      ORDER BY m.id
      LIMIT 1`,
    [organizationId, address, [...SENDER_ROLES]],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    membershipId: row.membership_id,
    appUserId: row.app_user_id,
    roles: row.roles,
    locale: row.locale,
    organizationName: row.organization_name,
  };
}

// ---------------------------------------------------------------------------
// The club's side
// ---------------------------------------------------------------------------

export type InboxStatus = 'pending' | 'imported' | 'discarded';

export interface InboxItem {
  id: string;
  fileName: string;
  meetName: string;
  meetStartsOn: string;
  status: Exclude<InboxStatus, 'discarded'>;
  meetId: string | null;
  senderName: string;
  receivedAt: string;
  /** Pending for longer than `STALE_DAYS` — the quiet *antigo* tag. */
  stale: boolean;
}

export interface InboxList extends Paginated<InboxItem> {
  /** Null where the deployment has no `INBOUND_DOMAIN` — the page says so. */
  address: string | null;
  pendingCount: number;
}

export async function listInbox(organizationId: string, page: PageQuery): Promise<InboxList> {
  return withOrg(organizationId, async (tx) => {
    const { rows: org } = await tx.query<{ token: string; pending: number }>(
      `SELECT o.meet_inbox_token AS token,
              (SELECT count(*)::int FROM meet_inbox i
                WHERE i.organization_id = o.id AND i.status = 'pending') AS pending
         FROM organization o WHERE o.id = $1`,
      [organizationId],
    );
    const list = await windowed(
      page,
      (limit, offset) =>
        tx.query<{
          total_count: number;
          id: string;
          file_name: string;
          meet_name: string;
          meet_starts_on: string;
          status: 'pending' | 'imported';
          meet_id: string | null;
          sender_name: string;
          received_at: Date;
          stale: boolean;
        }>(
          `SELECT ${TOTAL_COUNT}, i.id, i.file_name, i.meet_name,
                  to_char(i.meet_starts_on, 'YYYY-MM-DD') AS meet_starts_on,
                  i.status::text AS status, i.meet_id,
                  coalesce(nullif(btrim(concat_ws(' ', coalesce(u.cached_first_name, m.first_name),
                                                       coalesce(u.cached_last_name, m.last_name))), ''),
                           msg.received_from::text) AS sender_name,
                  msg.received_at,
                  (i.status = 'pending' AND msg.received_at < now() - make_interval(days => $3)) AS stale
             FROM meet_inbox i
             JOIN meet_inbox_message msg
               ON msg.id = i.message_id AND msg.organization_id = i.organization_id
             JOIN membership m
               ON m.id = msg.sender_membership_id AND m.organization_id = msg.organization_id
             LEFT JOIN app_user u ON u.id = m.app_user_id
            WHERE i.status <> 'discarded'
            ORDER BY msg.received_at DESC, i.file_name, i.id
            LIMIT $1 OFFSET $2`,
          [limit, offset, STALE_DAYS],
        ),
      (row) => ({
        id: row.id,
        fileName: row.file_name,
        meetName: row.meet_name,
        meetStartsOn: row.meet_starts_on,
        status: row.status,
        meetId: row.meet_id,
        senderName: row.sender_name,
        receivedAt: row.received_at.toISOString(),
        stale: row.stale,
      }),
    );
    return {
      ...list,
      address: org[0] ? inboxAddress(org[0].token) : null,
      pendingCount: org[0]?.pending ?? 0,
    };
  });
}

/** The count the Competição menu entry carries — one indexed count. */
export async function pendingInboxCount(organizationId: string): Promise<number> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM meet_inbox WHERE status = 'pending'`,
    );
    return rows[0]?.n ?? 0;
  });
}

/** The file of a row not discarded, for the import dialog. Null when there is none. */
export async function inboxFile(
  organizationId: string,
  id: string,
): Promise<{ fileName: string; bytes: Buffer } | null> {
  const row = await withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ file_name: string; storage_key: string }>(
      `SELECT i.file_name, f.storage_key
         FROM meet_inbox i
         JOIN stored_file f ON f.id = i.file_id AND f.organization_id = i.organization_id
        WHERE i.id = $1 AND i.status <> 'discarded'`,
      [id],
    );
    return rows[0] ?? null;
  });
  if (row === null) return null;
  return { fileName: row.file_name, bytes: await getObjectBytes(row.storage_key) };
}

/**
 * Marks a row imported, inside the import's own transaction, so the meet and
 * the row agree. False when there is no such live row — the import refuses.
 */
export async function markImportedIn(tx: Tx, inboxId: string, meetId: string, membershipId: string): Promise<boolean> {
  const { rowCount } = await tx.query(
    `UPDATE meet_inbox
        SET status = 'imported', meet_id = $2, imported_at = now(), imported_by_membership_id = $3
      WHERE id = $1 AND status <> 'discarded'`,
    [inboxId, meetId, membershipId],
  );
  return (rowCount ?? 0) > 0;
}

/** Whether a row exists and is not discarded — the import's preview asks first. */
export async function inboxRowIsLive(tx: Tx, inboxId: string): Promise<boolean> {
  const { rows } = await tx.query(`SELECT 1 FROM meet_inbox WHERE id = $1 AND status <> 'discarded'`, [inboxId]);
  return rows.length > 0;
}

/** *Rejeitar* — owner and admin. Soft, with an optional reason, audited. */
export async function discardInbox(
  organizationId: string,
  membershipId: string,
  id: string,
  reason: string | null,
): Promise<boolean> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ file_name: string }>(
      `UPDATE meet_inbox
          SET status = 'discarded', discarded_at = now(), discarded_by_membership_id = $2, discard_reason = $3
        WHERE id = $1 AND status = 'pending'
        RETURNING file_name`,
      [id, membershipId, reason],
    );
    if (rows.length === 0) return false;
    await recordAudit(tx, {
      action: 'meet_inbox.discarded',
      entityType: 'meet_inbox',
      entityId: id,
      data: { file: rows[0]!.file_name, reason },
    });
    return true;
  });
}

/** A new address; the old one stops at once. The token itself is never logged. */
export async function regenerateInboxAddress(organizationId: string): Promise<string | null> {
  return withOrg(organizationId, async (tx) => {
    const { rows } = await tx.query<{ token: string }>(
      `UPDATE organization SET meet_inbox_token = new_inbox_token() WHERE id = $1 RETURNING meet_inbox_token AS token`,
      [organizationId],
    );
    await recordAudit(tx, {
      action: 'meet_inbox.address_regenerated',
      entityType: 'organization',
      entityId: organizationId,
      data: {},
    });
    return inboxAddress(rows[0]!.token);
  });
}
